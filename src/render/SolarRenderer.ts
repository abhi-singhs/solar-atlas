import * as THREE from 'three'
import type { Body, CameraPose, Dataset, Quat, RenderOptions, Snapshot, SurfaceHit, SurfaceProvider, Vec3 } from '../contracts'
import { AU_KM, bodyRadius } from '../contracts'
import { createCockpit, createShip, updateCockpit } from '../cockpit/models'
import type { CockpitTelemetry } from '../cockpit/models'
import { createTerrainPatch, createTerrainSurface } from '../terrain'
import type { TerrainPatch, TerrainPatchState, TerrainSystem } from '../terrain'
import { AssetStore, localAssetUrl, positionAttribute } from './assets'
import type { BodyAssetRecord, LoadedBody, RingBand } from './assets'
import { commonExposure, projectedRadiusPixels, rebaseVertices, relativePosition, ringRotation } from './precision'
import { ringMaterial, shellMaterial, surfaceMaterial, terrainMaterial } from './materials'
import { sha256 } from '../data/sha256'
import {
  STAR_MANIFEST_PATH, StarField, daylightExtinction, parseBrightStars, parseFaintStars, parseStarManifest, sunGlareFactor,
} from './stars'
import type { StarFile } from './stars'
import { SunFlare, flareStrength } from './flare'

interface Callbacks {
  onSelect: (id: string) => void
  onError: (message: string) => void
  onProgress?: (message: string) => void
  onSurfacePick?: (id: string, hit: SurfaceHit) => void
}
interface Component {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  rotation: THREE.Quaternion
  ring?: RingBand
  terrainPositions?: Float32Array
  terrainCenter?: Vec3
}
interface BodyVisual {
  scene: THREE.Scene
  parts: Component[]
  asset: LoadedBody
  full: boolean
}
interface ScreenBody {
  body: Body
  distance: number
  pixels: number
  x: number
  y: number
  inView: boolean
}
/** The Sun as the lens sees it this frame. */
interface SunView {
  screen: ScreenBody
  distanceAu: number
  /** On-screen fade times the unblocked share of the solar disc. */
  visibility: number
  inside: boolean
}

/**
 * Directions across the solar disc as [share of the angular radius, position angle, area weight]. A center point
 * and rings of 6 and 12 points split the disc at 0.25 and 0.65 of its radius. Weights are in 1/1600 of the disc
 * area, so an open or fully covered disc gives exactly 1 or 0.
 */
const SUN_SAMPLES: [number, number, number][] = [[0, 0, 100],
  ...Array.from({ length: 6 }, (_, i) => [.45, i * Math.PI / 3, 96] as [number, number, number]),
  ...Array.from({ length: 12 }, (_, i) => [.85, (i + .5) * Math.PI / 6, 77] as [number, number, number])]
const SUN_SAMPLE_AREA = 1600

function ringGeometry(inner: number, outer: number, segments: number): THREE.BufferGeometry {
  const positions: number[] = [], normals: number[] = [], uv: number[] = [], indices: number[] = []
  for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI * 2
    for (const [radius, v] of [[inner, 0], [outer, 1]]) {
      positions.push(radius! * Math.cos(angle), radius! * Math.sin(angle), 0)
      normals.push(0, 0, 1)
      uv.push(i / segments, v!)
    }
    if (i < segments) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('sourcePosition', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  return geometry
}

function shellGeometry(source: THREE.BufferGeometry, record: BodyAssetRecord, height: number): THREE.BufferGeometry {
  const geometry = source.clone()
  const p = positionAttribute(geometry)
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) * (1 + height / record.radii_km[0]),
      p.getY(i) * (1 + height / record.radii_km[1]), p.getZ(i) * (1 + height / record.radii_km[2]))
  }
  geometry.setAttribute('sourcePosition', p.clone())
  return geometry
}

export class SolarRenderer {
  readonly sourceSurface: SurfaceProvider
  readonly surface: SurfaceProvider & { prepareLanding: (bodyId: string, directionLocal: Vec3) => void }
  readonly domElement: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer
  private camera = new THREE.PerspectiveCamera(50, 1, .01, 1e8)
  private assets: AssetStore
  private visuals = new Map<string, BodyVisual>()
  private labels = new Map<string, HTMLButtonElement>()
  private labelLayer = document.createElement('div')
  private width = 1
  private height = 1
  private quality: RenderOptions['quality'] = 'low'
  private snapshot?: Snapshot
  private pose?: CameraPose
  private options?: RenderOptions
  private screens: ScreenBody[] = []
  private pending = new Map<string, Promise<void>>()
  private errors = new Map<string, string>()
  private disposed = false
  private pointer?: { x: number; y: number; id: number; target: EventTarget | null }
  private traces = new Map<string, Vec3[]>()
  private traceScene = new THREE.Scene()
  private traceLines = new Map<string, THREE.Line>()
  private proxyScene = new THREE.Scene()
  private proxyGeometry = new THREE.SphereGeometry(1, 20, 12)
  private proxyMaterial = new THREE.MeshBasicMaterial({ color: 0x777777 })
  private proxy = new THREE.Mesh(this.proxyGeometry, this.proxyMaterial)
  private cockpitScene = new THREE.Scene()
  private cockpit = createCockpit()
  private ship = createShip()
  private shipSun = new THREE.DirectionalLight(0xffffff, 2)
  private observer = new ResizeObserver(() => this.resize())
  private lastFrameMs = 0
  private container: HTMLElement
  private dataset: Dataset
  private callbacks: Callbacks
  private terrain?: TerrainSystem
  private terrainPatches = new Map<string, TerrainPatch>()
  private terrainErrors = new Set<string>()
  private stars?: StarField
  private starLoads = new Set<string>()
  private flare = new SunFlare()
  private raycaster = new THREE.Raycaster()

  constructor(container: HTMLElement, dataset: Dataset, callbacks: Callbacks) {
    this.container = container
    this.dataset = dataset
    this.callbacks = callbacks
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false,
        powerPreference: 'high-performance', logarithmicDepthBuffer: true })
    } catch {
      const message = 'WebGL2 could not start. Use a browser with hardware-accelerated WebGL2.'
      callbacks.onError(message)
      throw new Error(message)
    }
    this.renderer.setClearColor(0x000000, 1)
    this.renderer.autoClear = false
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.info.autoReset = false
    this.renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
      callbacks.onError(`A source material shader failed: ${gl.getProgramInfoLog(program) ?? ''} ${
        gl.getShaderInfoLog(vertex) ?? ''} ${gl.getShaderInfoLog(fragment) ?? ''}`)
    }
    this.domElement = this.renderer.domElement
    this.domElement.setAttribute('aria-label', 'Scientific solar system view. Drag to orbit. Click a body to select.')
    Object.assign(this.domElement.style, { width: '100%', height: '100%', display: 'block' })
    Object.assign(this.labelLayer.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' })
    this.labelLayer.setAttribute('aria-label', 'Body annotations, not physical sizes')
    container.append(this.domElement, this.labelLayer)
    this.assets = new AssetStore(message => callbacks.onProgress?.(message), id => this.removeVisual(id))
    this.assets.ready.catch(error => callbacks.onError(String(error)))
    void this.loadStars()
    this.sourceSurface = { sample: (id, direction) => this.assets.get(id)?.surface.sample(direction) ?? null }
    this.terrain = createTerrainSurface(this.sourceSurface, dataset.bodies)
    this.surface = {
      sample: (id, direction) => this.terrain?.sample(id, direction) ?? null,
      prepareLanding: (id, direction) => this.prepareLanding(id, direction),
    }
    this.proxyScene.add(this.proxy)
    this.cockpitScene.add(this.cockpit, this.ship, this.shipSun, new THREE.HemisphereLight(0xd0ddff, 0x252224, .7))
    const cabinLight = new THREE.PointLight(0xc2d5e2, 2, 5)
    cabinLight.position.set(0, .2, -.4)
    this.cockpit.add(cabinLight)
    for (const body of dataset.bodies) {
      const button = document.createElement('button')
      button.textContent = `· ${body.name}`
      button.title = `${body.name}. Annotation, not physical size.`
      button.setAttribute('aria-label', `Select ${body.name}`)
      Object.assign(button.style, { position: 'absolute', pointerEvents: 'auto', border: '0',
        padding: '3px 5px', background: 'transparent', color: 'var(--cp-text-muted)',
        font: '11px "Segoe UI", Aptos, sans-serif', whiteSpace: 'nowrap', cursor: 'pointer',
        textShadow: '0 1px 2px var(--cp-bg)', display: 'none' })
      button.dataset.bodyId = body.id
      this.labelLayer.append(button)
      this.labels.set(body.id, button)
    }
    container.addEventListener('pointerdown', this.onPointerDown)
    container.addEventListener('pointerup', this.onPointerUp)
    container.addEventListener('pointercancel', this.onPointerCancel)
    this.domElement.addEventListener('contextmenu', this.onContextMenu)
    this.domElement.addEventListener('webglcontextlost', this.onContextLost)
    this.observer.observe(container)
    this.resize()
  }

  async ensureBody(id: string): Promise<void> {
    if (this.disposed) throw new Error('Renderer has been disposed')
    const pending = this.pending.get(id)
    if (pending) return pending
    this.errors.delete(id)
    const request = this.assets.ensure(id, this.quality).then(() => {}).catch(error => {
      const message = `Could not load ${id}: ${error instanceof Error ? error.message : String(error)}`
      this.errors.set(id, message)
      this.callbacks.onError(message)
      throw error
    }).finally(() => this.pending.delete(id))
    this.pending.set(id, request)
    return request
  }

  getBodyAssetStatus(id: string): { state: 'ready' | 'loading' | 'error' | 'unloaded'; error?: string; record?: BodyAssetRecord } {
    return { state: this.errors.has(id) ? 'error' : this.pending.has(id) ? 'loading'
      : this.assets.bodies.has(id) ? 'ready' : 'unloaded', error: this.errors.get(id),
    record: this.assets.manifest?.bodies[id] }
  }

  get stats(): { frameMs: number; drawCalls: number; triangles: number; textureBytes: number; loadedBodies: number } {
    return { frameMs: this.lastFrameMs, drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles, textureBytes: this.assets.stats.bytes,
      loadedBodies: this.assets.stats.bodies }
  }

  resize(): void {
    if (this.disposed) return
    this.width = Math.max(1, this.container.clientWidth)
    this.height = Math.max(1, this.container.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality === 'high' ? 1.75 : 1))
    this.renderer.setSize(this.width, this.height, false)
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()
  }

  setFieldOfView(degrees: number): void {
    this.camera.fov = Math.max(25, Math.min(100, degrees))
    this.camera.updateProjectionMatrix()
  }

  attachTerrain(terrain: TerrainSystem): void {
    if (terrain.base !== this.sourceSurface)
      throw new Error('Terrain must use renderer.sourceSurface as its base, not the terrain-aware renderer.surface')
    for (const id of [...this.visuals.keys()]) this.removeVisual(id)
    for (const patch of this.terrainPatches.values()) patch.dispose()
    this.terrainPatches.clear()
    this.terrain = terrain
    this.terrainErrors.clear()
  }

  getActiveTerrainPatch(bodyId: string): TerrainPatchState | null {
    return this.terrain?.getActivePatch(bodyId) ?? null
  }

  private prepareLanding(id: string, direction: Vec3): void {
    const asset = this.assets.get(id)
    if (!asset) throw new Error(`Load the full source mesh for ${id} with ensureBody before preparing a landing`)
    this.terrain!.prepareLanding(id, direction)
    const active = this.terrain!.getActivePatch(id)
    if (!active) throw new Error(`No supported source-mesh landing point for ${id}`)
    this.terrainErrors.delete(`${id}:${active.revision}`)
    this.syncTerrain(this.getVisual(asset, true))
    const ready = this.terrainPatches.get(id)
    if (!ready || ready.state.revision !== this.terrain!.getActivePatch(id)?.revision)
      throw new Error(`The rendered collision patch for ${id} could not be prepared`)
  }

  update(snapshot: Snapshot, camera: CameraPose, options: RenderOptions): void {
    if (this.disposed) return
    const start = performance.now()
    this.snapshot = snapshot
    this.pose = camera
    this.options = options
    if (this.quality !== options.quality) { this.quality = options.quality; this.resize() }
    this.camera.position.set(0, 0, 0)
    this.camera.quaternion.fromArray(camera.quaternion)
    this.camera.updateMatrixWorld(true)
    this.renderer.info.reset()
    this.renderer.clear(true, true, true)
    const sun = snapshot.states.sun
    const selected = snapshot.states[options.selectedId]
    const selectedDistance = selected && sun && options.selectedId !== 'sun'
      ? Math.hypot(...relativePosition(selected.position, sun.position)) / AU_KM : 1
    const exposure = commonExposure(selectedDistance, options.exposure)
    this.screens = this.projectBodies(snapshot, camera)
    if (options.shipPose && (options.cockpit || options.chase)) this.poseShip(camera, options)
    const sunView = this.sunView(options)
    this.drawStars(snapshot, camera, options, sunView)
    if (options.paths) this.drawPaths(snapshot, camera, options)
    this.drawLabels(options)
    const pinned = new Set([options.selectedId, options.landingBodyId ?? ''])
    const visible = this.screens.filter(x => x.inView && (x.pixels > .15 || x.body.id === options.selectedId))
      .sort((a, b) => b.distance - a.distance)
    if (!this.pending.has(options.selectedId) && !this.errors.has(options.selectedId)) {
      const asset = this.assets.bodies.get(options.selectedId)
      if (!asset || asset.quality !== this.quality) void this.ensureBody(options.selectedId).catch(() => {})
    }
    this.updateTerrainCenter(snapshot, camera, options)
    for (const screen of visible) {
      const state = snapshot.states[screen.body.id]!
      const asset = this.assets.get(screen.body.id)
      if (screen.pixels > 1 && this.pending.size < 3 && !this.errors.has(screen.body.id)
        && (!asset || asset.quality !== this.quality)) void this.ensureBody(screen.body.id).catch(() => {})
      const close = screen.distance < bodyRadius(screen.body) * 1.015
      if (asset) {
        if (screen.pixels > 1) pinned.add(screen.body.id)
        const visual = this.getVisual(asset, close || this.quality === 'high')
        this.drawBody(visual, snapshot, camera, state.rotation, exposure, screen.distance, close)
      } else if (screen.pixels < 2) {
        this.drawProxy(screen.body, state.position, state.rotation, camera, exposure, snapshot)
      }
    }
    if (options.cockpit || options.chase) this.drawShip(snapshot, camera, options)
    if (options.lensFlare) this.drawFlare(sunView, options)
    this.assets.trim(this.quality, pinned)
    this.lastFrameMs = performance.now() - start
  }

  private updateTerrainCenter(snapshot: Snapshot, camera: CameraPose, options: RenderOptions): void {
    const mode = options.flightTelemetry?.mode
    if (!this.terrain || !options.shipPose || (mode !== 'free' && mode !== undefined)) return
    const id = options.landingBodyId ?? options.flightTelemetry?.referenceId
    if (!id || !this.terrain.getActivePatch(id)) return
    const state = snapshot.states[id]
    const asset = this.assets.bodies.get(id)
    if (!state || !asset) return
    const local = new THREE.Vector3(...relativePosition(options.shipPose.position ?? camera.position, state.position))
      .applyQuaternion(new THREE.Quaternion(...state.rotation).invert())
    const direction = local.clone().normalize().toArray() as Vec3
    const hit = asset.surface.sample(direction)
    const patch = this.terrain.getActivePatch(id)!
    if (!hit || local.length() - Math.hypot(...hit.point) > patch.radiusKm * 4) return
    const prepared = this.terrain.getPreparedPatch(id)
    if (prepared || this.terrain.needsRecenter(id, direction)) {
      try {
        if (prepared) this.terrain.deactivate(id)
        this.terrain.activate(id, direction)
        this.syncTerrain(this.getVisual(asset, true))
      }
      catch (error) { this.callbacks.onError(`Cannot recenter terrain for ${id}: ${String(error)}`) }
    }
  }

  private projectBodies(snapshot: Snapshot, camera: CameraPose): ScreenBody[] {
    const inverse = new THREE.Quaternion(...camera.quaternion).invert()
    const tan = Math.tan(this.camera.fov * Math.PI / 360)
    return this.dataset.bodies.flatMap(body => {
      const state = snapshot.states[body.id]
      if (!state) return []
      const local = new THREE.Vector3(...relativePosition(state.position, camera.position)).applyQuaternion(inverse)
      const distance = local.length()
      const pixels = projectedRadiusPixels(bodyRadius(body), distance, this.height, this.camera.fov)
      const nx = local.x / (-local.z * tan * this.camera.aspect)
      const ny = local.y / (-local.z * tan)
      return [{ body, distance, pixels, x: (nx + 1) * this.width / 2, y: (1 - ny) * this.height / 2,
        inView: distance < bodyRadius(body) * 1.1 || (local.z < 0 &&
          Math.abs(nx) < 1.2 + pixels * 2 / this.width && Math.abs(ny) < 1.2 + pixels * 2 / this.height) }]
    })
  }

  private drawLabels(options: RenderOptions): void {
    for (const button of this.labels.values()) button.style.display = 'none'
    if (!options.labels) return
    const occupied: { x: number; y: number }[] = []
    const ordered = [...this.screens].sort((a, b) =>
      Number(b.body.id === options.selectedId) - Number(a.body.id === options.selectedId) || b.pixels - a.pixels)
    for (const screen of ordered) {
      if (!screen.inView || screen.distance < bodyRadius(screen.body) * 1.5) continue
      if (this.annotationOccluded(screen)) continue
      const x = screen.x + screen.pixels + 5, y = screen.y - 9
      if (!Number.isFinite(x + y) || x < 0 || x > this.width - 25 || y < 0 || y > this.height - 20) continue
      if (screen.body.id !== options.selectedId && occupied.some(p => Math.abs(p.x - x) < 85 && Math.abs(p.y - y) < 17)) continue
      occupied.push({ x, y })
      const button = this.labels.get(screen.body.id)!
      button.style.display = 'block'
      button.style.transform = `translate(${x}px,${y}px)`
      button.style.color = screen.body.id === options.selectedId ? 'var(--cp-accent)' : 'var(--cp-text-muted)'
    }
  }

  private annotationOccluded(screen: ScreenBody): boolean {
    if (!this.snapshot || !this.pose) return false
    const target = this.snapshot.states[screen.body.id]!
    const ray = new THREE.Vector3(...relativePosition(target.position, this.pose.position)).normalize()
    return this.rayBlocked(ray, this.screens.filter(other =>
      other.body.id !== screen.body.id && other.distance < screen.distance && other.pixels >= 2))
  }

  /** Whether a camera ray hits one of these bodies. Unloaded bodies count as their bounding sphere. */
  private rayBlocked(ray: THREE.Vector3, blockers: ScreenBody[]): boolean {
    for (const other of blockers) {
      const state = this.snapshot!.states[other.body.id]!
      const center = new THREE.Vector3(...relativePosition(state.position, this.pose!.position))
      const along = center.dot(ray)
      if (along <= 0 || center.lengthSq() - along * along > bodyRadius(other.body) ** 2) continue
      const loaded = this.assets.bodies.get(other.body.id)
      if (!loaded) return true
      const inverse = new THREE.Quaternion(...state.rotation).invert()
      const origin = center.negate().divideScalar(loaded.record.normalization_radius_km).applyQuaternion(inverse)
      if (loaded.surface.intersect(origin, ray.clone().applyQuaternion(inverse))) return true
    }
    return false
  }

  private getVisual(asset: LoadedBody, full: boolean): BodyVisual {
    let visual = this.visuals.get(asset.id)
    if (visual && (visual.asset !== asset || visual.full !== full)) {
      this.removeVisual(asset.id)
      visual = undefined
    }
    if (visual) return visual
    const scene = new THREE.Scene()
    const source = full ? asset.geometry : asset.lowGeometry ?? asset.geometry
    const parts: Component[] = []
    const add = (geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial, ring?: RingBand): void => {
      const mesh = new THREE.Mesh(geometry, material)
      mesh.frustumCulled = false
      scene.add(mesh)
      parts.push({ mesh, rotation: new THREE.Quaternion(), ring })
    }
    add(source.clone(), surfaceMaterial(asset))
    if (asset.record.cloud_height_km)
      add(shellGeometry(source, asset.record, asset.record.cloud_height_km), shellMaterial(asset, true))
    if (asset.record.atmosphere_height_km)
      add(shellGeometry(source, asset.record, asset.record.atmosphere_height_km), shellMaterial(asset, false))
    for (const band of this.assets.manifest?.ring_systems[asset.id] ?? [])
      add(ringGeometry(band.inner_km / asset.record.normalization_radius_km,
        band.outer_km / asset.record.normalization_radius_km, this.quality === 'high' ? 512 : 192), ringMaterial(asset, band), band)
    visual = { scene, parts, asset, full }
    this.visuals.set(asset.id, visual)
    return visual
  }

  private drawBody(visual: BodyVisual, snapshot: Snapshot, camera: CameraPose, rotation: Quat,
    exposure: number, distance: number, close: boolean): void {
    const asset = visual.asset
    const state = snapshot.states[asset.id]!
    const radius = asset.record.normalization_radius_km
    const bodyToEye = new THREE.Vector3(...relativePosition(camera.position, state.position))
    let surfaceAltitude = Math.abs(distance - radius)
    if (close) {
      const direction = bodyToEye.clone().applyQuaternion(new THREE.Quaternion(...rotation).invert()).normalize().toArray() as Vec3
      const hit = this.terrain?.sample(asset.id, direction) ?? asset.surface.sample(direction)
      if (hit) surfaceAltitude = Math.abs(distance - Math.hypot(...hit.point))
    }
    const unit = close ? Math.max(1e-6, surfaceAltitude, radius * 1e-8) : Math.max(distance / 1000, radius / 100)
    this.camera.near = close ? 1e-5 : Math.max(1e-5, (distance - radius * 5) / unit * .01)
    this.camera.far = Math.max(1e4, (distance + radius * 20) / unit * 2)
    this.camera.updateProjectionMatrix()
    this.syncTerrain(visual)
    for (const part of visual.parts) {
      part.rotation.copy(part.ring ? ringRotation(part.ring.pole_ra_deg, part.ring.pole_dec_deg, rotation)
        : new THREE.Quaternion(...rotation))
      const inverse = part.rotation.clone().invert()
      const localEyeKm = bodyToEye.clone().applyQuaternion(inverse)
      const mesh = part.mesh
      mesh.quaternion.copy(part.rotation)
      if (part.terrainPositions && part.terrainCenter) {
        const p = positionAttribute(mesh.geometry)
        const a = part.terrainPositions, center = part.terrainCenter
        const output = p.array as Float32Array
        for (let i = 0; i < a.length; i += 3) {
          output[i] = (a[i]! + center[0] - localEyeKm.x) / unit
          output[i + 1] = (a[i + 1]! + center[1] - localEyeKm.y) / unit
          output[i + 2] = (a[i + 2]! + center[2] - localEyeKm.z) / unit
        }
        p.needsUpdate = true
        mesh.position.set(0, 0, 0)
        mesh.scale.setScalar(1)
      } else if (close) {
        const p = positionAttribute(mesh.geometry)
        rebaseVertices(mesh.geometry.getAttribute('sourcePosition').array,
          localEyeKm.toArray() as Vec3, radius, unit, p.array as Float32Array)
        p.needsUpdate = true
        mesh.position.set(0, 0, 0)
        mesh.scale.setScalar(1)
      } else {
        const p = positionAttribute(mesh.geometry)
        p.copy(mesh.geometry.getAttribute('sourcePosition') as THREE.BufferAttribute)
        p.needsUpdate = true
        mesh.position.fromArray(relativePosition(state.position, camera.position, unit))
        mesh.scale.setScalar(radius / unit)
      }
      this.updateLight(part, asset, snapshot, localEyeKm, exposure)
    }
    // Non-intersecting celestial bodies sort by physical center distance. Each body's depth range is local.
    this.renderer.clearDepth()
    this.renderer.render(visual.scene, this.camera)
  }

  private syncTerrain(visual: BodyVisual): void {
    if (!this.terrain) return
    const id = visual.asset.id
    const active = this.terrain.getActivePatch(id)
    const old = this.terrainPatches.get(id)
    if (old && old.state.revision === active?.revision && visual.parts.some(part => part.terrainPositions)) return
    if (old && old.state.revision !== active?.revision) {
      old.dispose()
      this.terrainPatches.delete(id)
      const component = visual.parts.find(part => part.terrainPositions)
      if (component) {
        component.mesh.removeFromParent()
        component.mesh.geometry.dispose()
        component.mesh.material.dispose()
        visual.parts.splice(visual.parts.indexOf(component), 1)
      }
    }
    if (!active || this.terrainErrors.has(`${id}:${active.revision}`)) return
    const body = this.dataset.bodies.find(body => body.id === id)!
    try {
      const patch = old?.state.revision === active.revision ? old : createTerrainPatch(body, active.directionLocal, this.terrain, {
        segments: this.quality === 'high' ? 48 : 32,
        uvAt: (_body, direction) => {
          const uv = visual.asset.surface.uv(direction)
          if (!uv) throw new Error('Source mesh UV query missed the selected patch')
          return uv
        },
      })
      this.terrainPatches.set(id, patch)
      const original = patch.group.children[0] as THREE.Mesh
      const geometry = original.geometry.clone()
      const originalPositions = positionAttribute(geometry).array.slice() as Float32Array
      const sourcePositions = new Float32Array(originalPositions.length)
      for (let i = 0; i < sourcePositions.length; i += 3) {
        for (let j = 0; j < 3; j++)
          sourcePositions[i + j] = (originalPositions[i + j]! + patch.centerLocalKm[j]!) / visual.asset.record.normalization_radius_km
      }
      geometry.setAttribute('sourcePosition', new THREE.BufferAttribute(sourcePositions, 3))
      const material = terrainMaterial(visual.asset)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = 'Reconstructed local terrain'
      mesh.frustumCulled = false
      visual.scene.add(mesh)
      visual.parts.push({ mesh, rotation: new THREE.Quaternion(), terrainPositions: originalPositions,
        terrainCenter: patch.centerLocalKm })
    } catch (error) {
      this.terrainErrors.add(`${id}:${active.revision}`)
      this.callbacks.onError(`Local terrain unavailable for ${id}: ${String(error)}`)
    }
  }

  private updateLight(part: Component, asset: LoadedBody, snapshot: Snapshot, eyeKm: THREE.Vector3, exposure: number): void {
    const state = snapshot.states[asset.id]!
    const radius = asset.record.normalization_radius_km
    const sun = snapshot.states.sun
    const sunlight = sun ? new THREE.Vector3(...relativePosition(sun.position, state.position)) : new THREE.Vector3(1, 0, 0)
    const solarDistance = sunlight.length()
    const inverse = part.rotation.clone().invert()
    const uniforms = part.mesh.material.uniforms
    uniforms.uSun!.value.copy(sunlight.normalize().applyQuaternion(inverse))
    uniforms.uEye!.value.copy(eyeKm).divideScalar(radius)
    uniforms.uFlux!.value = asset.id === 'sun' ? 1 : Math.pow(AU_KM / Math.max(solarDistance, 1), 2)
    uniforms.uExposure!.value = exposure
    const occluders: { center: THREE.Vector3; radius: number; distance: number }[] = []
    if (asset.id !== 'sun') {
      const direction = new THREE.Vector3().copy(uniforms.uSun!.value)
      for (const body of this.dataset.bodies) {
        if (body.id === asset.id || body.id === 'sun' || !snapshot.states[body.id]) continue
        const center = new THREE.Vector3(...relativePosition(snapshot.states[body.id]!.position, state.position))
          .applyQuaternion(inverse).divideScalar(radius)
        const t = center.dot(direction), r = bodyRadius(body) / radius
        if (t > 0 && t * radius < solarDistance && center.lengthSq() - t * t < (r + 5) ** 2)
          occluders.push({ center, radius: r, distance: t })
      }
    }
    occluders.sort((a, b) => a.distance - b.distance)
    for (let i = 0; i < 4; i++) {
      const o = occluders[i]
      uniforms.uOccluders!.value[i].set(o?.center.x ?? 0, o?.center.y ?? 0, o?.center.z ?? 0, o?.radius ?? 0)
    }
    const bands = this.assets.manifest?.ring_systems[asset.id] ?? []
    uniforms.uBandCount!.value = part.ring ? 0 : Math.min(16, bands.length)
    if (bands[0]) {
      uniforms.uRingNormal!.value.set(0, 0, 1)
        .applyQuaternion(ringRotation(bands[0].pole_ra_deg, bands[0].pole_dec_deg, state.rotation)).applyQuaternion(inverse)
      bands.slice(0, 16).forEach((band, i) =>
        uniforms.uBands!.value[i].set(band.inner_km / radius, band.outer_km / radius, band.optical_depth))
    }
  }

  private drawProxy(body: Body, position: Vec3, rotation: Quat, camera: CameraPose, exposure: number, snapshot: Snapshot): void {
    const relative = relativePosition(position, camera.position)
    const distance = Math.hypot(...relative)
    const unit = Math.max(1, distance / 1000)
    this.proxy.position.fromArray(relativePosition(position, camera.position, unit))
    this.proxy.quaternion.fromArray(rotation)
    const axes = body.radii_km ?? [body.radius_km, body.radius_km, body.radius_km]
    this.proxy.scale.set(axes[0] / unit, axes[1] / unit, axes[2] / unit)
    const sun = snapshot.states.sun
    const toSun = sun ? new THREE.Vector3(...relativePosition(sun.position, position)) : new THREE.Vector3(1, 0, 0)
    const flux = Math.pow(AU_KM / Math.max(1, toSun.length()), 2)
    const toEye = new THREE.Vector3(...relative).negate().normalize()
    const alpha = Math.acos(THREE.MathUtils.clamp(toSun.normalize().dot(toEye), -1, 1))
    const phase = (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI
    const luminance = body.id === 'sun' ? 2 * exposure : .15 * phase * flux * exposure
    this.proxyMaterial.color.setRGB(luminance, luminance, luminance)
    this.camera.near = .01
    this.camera.far = 1e5
    this.camera.updateProjectionMatrix()
    this.renderer.clearDepth()
    this.renderer.render(this.proxyScene, this.camera)
  }

  private async fetchStarFile(record: { file: string; bytes: number; sha256: string }): Promise<ArrayBuffer> {
    const response = await fetch(localAssetUrl(`assets/stars/${record.file}`), { credentials: 'same-origin', redirect: 'error' })
    if (!response.ok) throw new Error(`${record.file} request failed (${response.status})`)
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength !== record.bytes || await sha256(buffer) !== record.sha256)
      throw new Error(`${record.file} does not match the star manifest`)
    return buffer
  }

  /** The manifest and Hipparcos tier load first. Tycho-2 tiers and the Milky Way map follow the quality setting. */
  private async loadStars(): Promise<void> {
    try {
      const response = await fetch(localAssetUrl(STAR_MANIFEST_PATH), { credentials: 'same-origin', redirect: 'error' })
      if (!response.ok) throw new Error(`Star manifest request failed (${response.status})`)
      const manifest = parseStarManifest(await response.json())
      const bright = parseBrightStars(await this.fetchStarFile(manifest.bright), manifest.bright)
      if (this.disposed) return
      const field = new StarField(manifest)
      field.setBright(bright)
      this.stars = field
    } catch (error) {
      this.callbacks.onError(`Star catalog unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private loadStarPart(key: string, load: (field: StarField) => Promise<void>): void {
    const field = this.stars
    if (!field || this.starLoads.has(key)) return
    this.starLoads.add(key)
    load(field).catch(error => {
      this.callbacks.onError(`Star data unavailable: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  private ensureStarQuality(field: StarField, quality: RenderOptions['quality']): void {
    const faint = field.manifest.faint
    faint.forEach((record: StarFile, index) => {
      if ((index === 0 || quality === 'high') && !field.hasFaint(index)) this.loadStarPart(record.file, async target => {
        const stars = parseFaintStars(await this.fetchStarFile(record), record)
        if (!this.disposed) target.setFaint(index, stars)
      })
    })
    if (!field.hasMilkyWay(quality)) this.loadStarPart(`milky-way-${quality}`, async target => {
      const record = target.manifest.milky_way[quality]
      const url = URL.createObjectURL(new Blob([await this.fetchStarFile(record)], { type: 'image/jpeg' }))
      try {
        const texture = await new THREE.TextureLoader().loadAsync(url)
        if (this.disposed) texture.dispose()
        else target.setMilkyWay(quality, texture)
      } finally {
        URL.revokeObjectURL(url)
      }
    })
  }

  private drawStars(snapshot: Snapshot, camera: CameraPose, options: RenderOptions, sun?: SunView): void {
    if (!this.stars) return
    this.ensureStarQuality(this.stars, options.quality)
    const visibility = this.starSkyTransmission(snapshot, camera) * this.starSunGlare(sun, options)
    if (!(visibility > 1e-6)) return
    const pixelAngle = 2 * Math.tan(this.camera.fov * Math.PI / 360) / this.height
    this.stars.update({ jdTdb: snapshot.jdTdb, observerKm: camera.position, visibility,
      fluxScale: Math.pow(2, THREE.MathUtils.clamp(options.exposure, -20, 20)), quality: options.quality,
      pixelRatio: this.renderer.getPixelRatio(), pixelSolidAngle: pixelAngle * pixelAngle })
    this.camera.near = .1
    this.camera.far = 10
    this.camera.updateProjectionMatrix()
    this.renderer.render(this.stars.scene, this.camera)
  }

  /** Daylight inside an atmosphere hides stars. Below the Venus cloud deck they are never visible. */
  private starSkyTransmission(snapshot: Snapshot, camera: CameraPose): number {
    const records = this.assets.manifest?.bodies
    const sun = snapshot.states.sun
    if (!records || !sun) return 1
    for (const [id, record] of Object.entries(records)) {
      const state = snapshot.states[id]
      if (!record.atmosphere_height_km || !state) continue
      const up = new THREE.Vector3(...relativePosition(camera.position, state.position))
      const altitude = up.length() - record.normalization_radius_km
      if (altitude > record.atmosphere_height_km) continue
      if (id === 'venus' && altitude < (record.cloud_height_km ?? 0)) return 0
      const toSun = new THREE.Vector3(...relativePosition(sun.position, camera.position)).normalize()
      const sunAltitude = Math.asin(THREE.MathUtils.clamp(up.normalize().dot(toSun), -1, 1)) * 180 / Math.PI
      return Math.pow(10, -0.4 * daylightExtinction(sunAltitude))
    }
    return 1
  }

  /** Glare from the Sun in view dims the stars, unless the viewer turned that off. Daylight is separate. */
  private starSunGlare(sun: SunView | undefined, options: RenderOptions): number {
    if (!sun || !options.glareHidesStars) return 1
    return sunGlareFactor(sun.distanceAu, sun.visibility)
  }

  private sunView(options: RenderOptions): SunView | undefined {
    const sun = this.screens.find(screen => screen.body.id === 'sun')
    if (!sun?.inView) return undefined
    const distanceAu = sun.distance / AU_KM
    if (sun.distance <= bodyRadius(sun.body)) return { screen: sun, distanceAu, visibility: 1, inside: true }
    const edge = Math.max(Math.abs(sun.x / this.width * 2 - 1) - Math.min(1, sun.pixels * 2 / this.width),
      Math.abs(1 - sun.y / this.height * 2) - Math.min(1, sun.pixels * 2 / this.height))
    const onScreen = 1 - THREE.MathUtils.smoothstep(edge, .9, 1.1)
    if (onScreen <= 0) return undefined
    const visibility = onScreen * this.sunDiscFraction(sun, options)
    return visibility > 0 ? { screen: sun, distanceAu, visibility, inside: false } : undefined
  }

  /** Share of the solar disc that no body, and no part of the ship around the camera, blocks. */
  private sunDiscFraction(sun: ScreenBody, options: RenderOptions): number {
    if (!this.snapshot || !this.pose) return 1
    const toSun = new THREE.Vector3(...relativePosition(this.snapshot.states.sun!.position, this.pose.position))
    const distance = toSun.length()
    const center = toSun.divideScalar(distance)
    const angular = Math.asin(Math.min(1, bodyRadius(sun.body) / distance))
    const blockers = this.screens.filter(other => {
      if (other.body.id === 'sun' || other.distance >= sun.distance) return false
      const state = this.snapshot!.states[other.body.id]!
      const toBody = new THREE.Vector3(...relativePosition(state.position, this.pose!.position))
      const radius = bodyRadius(other.body)
      if (toBody.length() <= radius) return true
      const separation = Math.atan2(toBody.clone().cross(center).length(), toBody.dot(center))
      return separation < angular + Math.asin(Math.min(1, radius / toBody.length()))
    })
    const ship = options.shipPose ? [options.cockpit && this.cockpit, options.chase && this.ship]
      .filter((part): part is THREE.Group => Boolean(part)) : []
    if (!blockers.length && !ship.length) return 1
    const u = new THREE.Vector3(0, 0, 1).cross(center)
    if (u.lengthSq() < 1e-12) u.set(1, 0, 0).cross(center)
    u.normalize()
    const v = center.clone().cross(u)
    let open = 0
    for (const [share, angle, weight] of SUN_SAMPLES) {
      const theta = angular * share
      const ray = center.clone().multiplyScalar(Math.cos(theta))
        .addScaledVector(u, Math.sin(theta) * Math.cos(angle)).addScaledVector(v, Math.sin(theta) * Math.sin(angle))
      if (!this.rayBlocked(ray, blockers) && !this.shipBlocks(ray, ship)) open += weight
    }
    return open / SUN_SAMPLE_AREA
  }

  /** Cockpit and ship meshes sit in meters around the camera at the origin. */
  private shipBlocks(ray: THREE.Vector3, parts: THREE.Object3D[]): boolean {
    if (!parts.length) return false
    this.raycaster.set(new THREE.Vector3(), ray)
    return this.raycaster.intersectObjects(parts, true).some(hit => {
      if (!(hit.object instanceof THREE.Mesh)) return false
      for (let object: THREE.Object3D | null = hit.object; object; object = object.parent) if (!object.visible) return false
      return true
    })
  }

  private drawFlare(sun: SunView | undefined, options: RenderOptions): void {
    if (!sun || sun.inside) return
    const visible = this.flare.update({ x: sun.screen.x, y: sun.screen.y, width: this.width, height: this.height,
      sunPixels: sun.screen.pixels, strength: flareStrength(sun.distanceAu, sun.visibility, options.exposure) })
    if (visible) this.renderer.render(this.flare.scene, this.flare.camera)
  }

  private drawPaths(snapshot: Snapshot, camera: CameraPose, options: RenderOptions): void {
    const selected = this.dataset.bodies.find(body => body.id === options.selectedId)
    const ids = this.dataset.bodies.filter(body => body.id === options.selectedId ||
      (selected?.category === 'planet' && body.parent_id === selected.id) ||
      (options.selectedId === 'sun' && body.category === 'planet')).map(body => body.id)
    const style = getComputedStyle(this.container)
    const color = new THREE.Color(style.getPropertyValue('--cp-text-muted').trim() || '#919191')
    for (const line of this.traceLines.values()) line.visible = false
    for (const id of ids) {
      if (!snapshot.states[id]) continue
      let points = this.traces.get(id)
      if (!points) { points = this.dataset.trajectory(id, 512); this.traces.set(id, points) }
      if (points.length < 2) continue
      let line = this.traceLines.get(id)
      if (!line) {
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points.length * 3), 3))
        line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .28,
          depthTest: false, toneMapped: false }))
        line.frustumCulled = false
        this.traceLines.set(id, line)
        this.traceScene.add(line)
      }
      const positions = line.geometry.getAttribute('position') as THREE.BufferAttribute
      points.forEach((point, i) => positions.setXYZ(i, ...relativePosition(point, camera.position, AU_KM)))
      positions.needsUpdate = true
      ;(line.material as THREE.LineBasicMaterial).color.copy(color)
      line.visible = true
    }
    this.camera.near = 1e-12
    this.camera.far = 1e7
    this.camera.updateProjectionMatrix()
    this.renderer.render(this.traceScene, this.camera)
  }

  /** Places the cockpit and ship around the camera in meters and refreshes their world matrices. */
  private poseShip(camera: CameraPose, options: RenderOptions): void {
    if (!options.shipPose) return
    this.cockpit.visible = options.cockpit
    this.ship.visible = options.chase
    for (const group of [this.cockpit, this.ship]) {
      group.position.fromArray(relativePosition(options.shipPose.position, camera.position, .001))
      group.quaternion.fromArray(options.shipPose.quaternion)
      group.updateMatrixWorld(true)
    }
  }

  private drawShip(snapshot: Snapshot, camera: CameraPose, options: RenderOptions): void {
    if (!options.shipPose) return
    this.poseShip(camera, options)
    if (options.flightTelemetry) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(...options.shipPose.quaternion))
      const telemetry: CockpitTelemetry = {
        ...options.flightTelemetry,
        headingDeg: (Math.atan2(forward.y, forward.x) * 180 / Math.PI + 360) % 360,
        targetName: this.dataset.bodies.find(body => body.id === options.flightTelemetry!.targetId)?.name,
        referenceName: this.dataset.bodies.find(body => body.id === options.flightTelemetry!.referenceId)?.name,
      }
      updateCockpit(this.cockpit, telemetry)
    }
    const sun = snapshot.states.sun
    if (sun) this.shipSun.position.fromArray(relativePosition(sun.position, options.shipPose.position)).normalize()
    this.camera.near = .015
    this.camera.far = 1e7
    this.camera.updateProjectionMatrix()
    this.renderer.clearDepth()
    this.renderer.render(this.cockpitScene, this.camera)
  }

  pickSurface(clientX: number, clientY: number, bodyId: string): SurfaceHit | null {
    const snapshot = this.snapshot, camera = this.pose, asset = this.assets.get(bodyId)
    if (!snapshot || !camera || !asset || !snapshot.states[bodyId]) return null
    const rect = this.domElement.getBoundingClientRect()
    const x = (clientX - rect.left) / rect.width * 2 - 1
    const y = 1 - (clientY - rect.top) / rect.height * 2
    const tan = Math.tan(this.camera.fov * Math.PI / 360)
    const ray = new THREE.Vector3(x * tan * this.camera.aspect, y * tan, -1).normalize()
      .applyQuaternion(new THREE.Quaternion(...camera.quaternion))
    const state = snapshot.states[bodyId]!
    const inverse = new THREE.Quaternion(...state.rotation).invert()
    const origin = new THREE.Vector3(...relativePosition(camera.position, state.position,
      asset.record.normalization_radius_km)).applyQuaternion(inverse)
    return asset.surface.intersect(origin, ray.applyQuaternion(inverse))
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || (event.target !== this.domElement && !(event.target instanceof HTMLElement && event.target.dataset.bodyId))) return
    this.pointer = { x: event.clientX, y: event.clientY, id: event.pointerId, target: event.target }
  }
  private onPointerCancel = (): void => { this.pointer = undefined }
  private onPointerUp = (event: PointerEvent): void => {
    const down = this.pointer
    this.pointer = undefined
    if (!down || down.id !== event.pointerId || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return
    const label = down.target instanceof HTMLElement ? down.target.dataset.bodyId : undefined
    if (label) { this.callbacks.onSelect(label); return }
    const rect = this.domElement.getBoundingClientRect()
    const x = event.clientX - rect.left, y = event.clientY - rect.top
    const hit = this.screens.filter(s => s.inView && Math.hypot(s.x - x, s.y - y) <= Math.max(9, s.pixels))
      .sort((a, b) => a.distance - b.distance)[0]
    if (hit) this.callbacks.onSelect(hit.body.id)
  }
  private onContextMenu = (event: MouseEvent): void => {
    if (!this.options || !this.callbacks.onSurfacePick) return
    event.preventDefault()
    const id = this.options.selectedId
    const hit = this.pickSurface(event.clientX, event.clientY, id)
    if (hit) this.callbacks.onSurfacePick(id, hit)
  }
  private onContextLost = (event: Event): void => {
    event.preventDefault()
    this.callbacks.onError('The graphics context was lost. Reload the page to restore source assets.')
  }
  private removeVisual(id: string): void {
    const visual = this.visuals.get(id)
    if (!visual) return
    for (const part of visual.parts) { part.mesh.geometry.dispose(); part.mesh.material.dispose() }
    this.visuals.delete(id)
  }
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.observer.disconnect()
    this.container.removeEventListener('pointerdown', this.onPointerDown)
    this.container.removeEventListener('pointerup', this.onPointerUp)
    this.container.removeEventListener('pointercancel', this.onPointerCancel)
    this.domElement.removeEventListener('contextmenu', this.onContextMenu)
    this.domElement.removeEventListener('webglcontextlost', this.onContextLost)
    this.assets.dispose()
    for (const id of this.visuals.keys()) this.removeVisual(id)
    for (const patch of this.terrainPatches.values()) patch.dispose()
    this.terrainPatches.clear()
    for (const line of this.traceLines.values()) {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    }
    this.proxyGeometry.dispose()
    this.proxyMaterial.dispose()
    this.stars?.dispose()
    this.flare.dispose()
    this.cockpitScene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose()
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
          material.dispose()
        }
      }
    })
    this.renderer.dispose()
    this.domElement.remove()
    this.labelLayer.remove()
  }
}
