import * as THREE from 'three'
import type { Body, SurfaceHit, SurfaceProvider, Vec3 } from '../contracts'

export const TERRAIN_LABEL = 'Reconstructed local terrain. Not measured topography.'
export const TERRAIN_MAX_SEGMENTS = 64
export const TERRAIN_DEFAULT_SEGMENTS = 48

export interface TerrainPatchState {
  readonly bodyId: string
  readonly directionLocal: Vec3
  readonly centerLocalKm: Vec3
  readonly radiusKm: number
  readonly maxReliefKm: number
  readonly revision: number
}

interface ActivePatch extends TerrainPatchState {
  readonly referenceRadiusKm: number
  readonly seed: number
}

interface PatchGeometry {
  revision: number
  center: THREE.Vector3
  mesh: THREE.Mesh
}

export interface TerrainPatchOptions {
  segments?: number
  color?: THREE.ColorRepresentation
  map?: THREE.Texture
  uvAt?: (bodyId: string, directionLocal: Vec3, hit: SurfaceHit) => [number, number]
}

export interface TerrainPatch {
  group: THREE.Group
  centerLocalKm: Vec3
  surface: TerrainSystem
  state: TerrainPatchState
  dispose: () => void
}

export class SurfaceUnavailableError extends Error {
  readonly bodyId: string

  constructor(bodyId: string, reason = 'Source mesh surface is not ready') {
    super(`${reason} for ${bodyId}. Landing geometry is unavailable.`)
    this.name = 'SurfaceUnavailableError'
    this.bodyId = bodyId
  }
}

const NON_SOLID_IDS = new Set(['sun', 'jupiter', 'saturn', 'uranus', 'neptune'])
const EPSILON = 1e-12

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function scale(v: Vec3, amount: number): Vec3 {
  return [v[0] * amount, v[1] * amount, v[2] * amount]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function unit(v: Vec3): Vec3 | null {
  if (!v.every(Number.isFinite)) return null
  const length = Math.hypot(...v)
  if (!Number.isFinite(length) || length <= EPSILON) return null
  return scale(v, 1 / length)
}

function tangentFrame(direction: Vec3): [Vec3, Vec3] {
  const axis: Vec3 = Math.abs(direction[2]) < 0.8 ? [0, 0, 1] : [0, 1, 0]
  const east = unit(cross(axis, direction))!
  return [east, cross(direction, east)]
}

function validHit(hit: SurfaceHit | null): hit is SurfaceHit {
  return !!hit
    && hit.point.every(Number.isFinite)
    && Math.hypot(...hit.point) > EPSILON
    && unit(hit.normal) !== null
}

function copyHit(hit: SurfaceHit): SurfaceHit {
  return { point: [...hit.point], normal: [...hit.normal] }
}

function referenceRadius(body: Body): number {
  // The smaller source semiaxis keeps relief conservative on elongated bodies.
  return Math.min(body.radius_km, ...(body.radii_km ?? [body.radius_km]))
}

export function supportsTerrain(body: Body): boolean {
  return !NON_SOLID_IDS.has(body.id.toLowerCase())
    && body.category.toLowerCase() !== 'star'
    && Number.isFinite(referenceRadius(body))
    && referenceRadius(body) > EPSILON
}

function seedFromId(id: string): number {
  let seed = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    seed = Math.imul(seed ^ id.charCodeAt(i), 16777619)
  }
  return seed >>> 0
}

function hash(x: number, y: number, z: number, seed: number): number {
  let value = seed ^ Math.imul(x, 374761393)
    ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647)
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295
}

function smooth(t: number): number {
  return t * t * t * (t * (6 * t - 15) + 10)
}

function noise(point: Vec3, seed: number): number {
  const cell = point.map(Math.floor) as Vec3
  const weight = point.map((v, i) => smooth(v - cell[i])) as Vec3
  let result = 0
  for (let z = 0; z <= 1; z += 1) {
    for (let y = 0; y <= 1; y += 1) {
      for (let x = 0; x <= 1; x += 1) {
        result += hash(cell[0] + x, cell[1] + y, cell[2] + z, seed)
          * (x ? weight[0] : 1 - weight[0])
          * (y ? weight[1] : 1 - weight[1])
          * (z ? weight[2] : 1 - weight[2])
      }
    }
  }
  return result
}

function crater(point: Vec3, seed: number): number {
  const cell = point.map(Math.floor) as Vec3
  let nearest = Infinity
  for (let z = -1; z <= 1; z += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let x = -1; x <= 1; x += 1) {
        const a = cell[0] + x
        const b = cell[1] + y
        const c = cell[2] + z
        const dx = point[0] - a - hash(a, b, c, seed)
        const dy = point[1] - b - hash(a, b, c, seed + 17)
        const dz = point[2] - c - hash(a, b, c, seed + 43)
        nearest = Math.min(nearest, Math.hypot(dx, dy, dz))
      }
    }
  }
  const r = nearest / 0.52
  if (r >= 1.25) return 0
  const bowl = r < 0.82 ? -0.18 * (1 - (r / 0.82) ** 2) ** 3 : 0
  const rimDistance = Math.abs(r - 0.87) / 0.38
  const rim = rimDistance < 1 ? 0.12 * (1 - rimDistance ** 2) ** 3 : 0
  return bowl + rim
}

function distanceFromCenter(patch: ActivePatch, direction: Vec3): number {
  const delta: Vec3 = [
    direction[0] - patch.directionLocal[0],
    direction[1] - patch.directionLocal[1],
    direction[2] - patch.directionLocal[2],
  ]
  return Math.hypot(...delta) * patch.referenceRadiusKm
}

function relief(patch: ActivePatch, direction: Vec3): number {
  const radius = distanceFromCenter(patch, direction) / patch.radiusKm
  if (radius >= 1) return 0
  const edge = radius < 0.55 ? 1 : 1 - smooth((radius - 0.55) / 0.45)
  // Cartesian noise has neither longitude seams nor a singularity at a pole.
  const point = scale(direction, patch.referenceRadiusKm / (patch.radiusKm * 0.42))
  const coarse = noise(point, patch.seed)
  const fine = noise(scale(point, 3.1), patch.seed + 89)
  const detail = 0.38 + coarse * 0.24 + fine * 0.035 + crater(point, patch.seed)
  // Crater bowls cut into the reconstructed layer, never into the source mesh.
  return patch.maxReliefKm * edge * Math.max(0, Math.min(0.9, detail))
}

function publicState(patch: ActivePatch): TerrainPatchState {
  return {
    bodyId: patch.bodyId,
    directionLocal: [...patch.directionLocal],
    centerLocalKm: [...patch.centerLocalKm],
    radiusKm: patch.radiusKm,
    maxReliefKm: patch.maxReliefKm,
    revision: patch.revision,
  }
}

function intersectTriangleEdges(
  geometry: THREE.BufferGeometry,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
): { point: THREE.Vector3, normal: THREE.Vector3 } | null {
  const positions = geometry.getAttribute('position')
  const normals = geometry.getAttribute('normal')
  const indices = geometry.getIndex()!
  const a = new THREE.Vector3()
  const u = new THREE.Vector3()
  const v = new THREE.Vector3()
  const face = new THREE.Vector3()
  const offset = new THREE.Vector3()
  const point = new THREE.Vector3()
  const normal = new THREE.Vector3()
  let closest = Infinity
  let found = false
  for (let i = 0; i < indices.count; i += 3) {
    const ia = indices.getX(i)
    const ib = indices.getX(i + 1)
    const ic = indices.getX(i + 2)
    a.fromBufferAttribute(positions, ia)
    u.fromBufferAttribute(positions, ib).sub(a)
    v.fromBufferAttribute(positions, ic).sub(a)
    face.crossVectors(u, v)
    const denominator = face.dot(direction)
    if (denominator >= 0) continue
    const distance = face.dot(offset.copy(a).sub(origin)) / denominator
    if (distance < 0 || distance >= closest) continue
    offset.copy(direction).multiplyScalar(distance).add(origin).sub(a)
    const uu = u.dot(u)
    const uv = u.dot(v)
    const vv = v.dot(v)
    const determinant = uu * vv - uv * uv
    if (determinant <= 0) continue
    const b = (offset.dot(u) * vv - offset.dot(v) * uv) / determinant
    const c = (offset.dot(v) * uu - offset.dot(u) * uv) / determinant
    // Three's strict triangle-edge test can miss every face at a shared vertex
    // after body-center subtraction. This tolerance is below a micrometer here.
    if (b < -1e-8 || c < -1e-8 || b + c > 1 + 1e-8) continue
    closest = distance
    found = true
    point.copy(direction).multiplyScalar(distance).add(origin)
    normal.fromBufferAttribute(normals, ia).multiplyScalar(1 - b - c)
      .addScaledVector(offset.fromBufferAttribute(normals, ib), b)
      .addScaledVector(offset.fromBufferAttribute(normals, ic), c).normalize()
  }
  return found ? { point, normal } : null
}

export class TerrainSystem implements SurfaceProvider {
  readonly base: SurfaceProvider
  private readonly bodies: Map<string, Body>
  private readonly active = new Map<string, ActivePatch>()
  private readonly geometries = new Map<string, PatchGeometry>()
  private readonly prepared = new Map<string, TerrainPatch>()
  private readonly raycaster = new THREE.Raycaster()
  private revision = 0

  constructor(base: SurfaceProvider, bodies: Body[]) {
    this.base = base
    this.bodies = new Map(bodies.map((body) => [body.id, body]))
  }

  activate(bodyId: string, directionLocal: Vec3): TerrainPatchState | null {
    const body = this.bodies.get(bodyId)
    const direction = unit(directionLocal)
    if (!body || !supportsTerrain(body) || !direction) return null
    const source = this.base.sample(bodyId, direction)
    if (!validHit(source)) return null
    const previous = this.active.get(bodyId)
    if (previous && !this.needsRecenter(bodyId, direction)) return publicState(previous)
    const radius = referenceRadius(body)
    const radiusKm = Math.min(0.5, radius * 0.03)
    const patch: ActivePatch = {
      bodyId,
      directionLocal: direction,
      centerLocalKm: [...source.point],
      radiusKm,
      maxReliefKm: Math.min(0.005, radius * 0.0002, radiusKm * 0.008),
      referenceRadiusKm: radius,
      seed: seedFromId(bodyId),
      revision: ++this.revision,
    }
    this.active.set(bodyId, patch)
    return publicState(patch)
  }

  getActivePatch(bodyId: string): TerrainPatchState | null {
    const patch = this.active.get(bodyId)
    return patch ? publicState(patch) : null
  }

  prepareLanding(bodyId: string, directionLocal: Vec3): void {
    const body = this.bodies.get(bodyId)
    const direction = unit(directionLocal)
    if (!body || !supportsTerrain(body) || !direction) {
      throw new SurfaceUnavailableError(bodyId, 'No supported solid landing site')
    }
    if (!validHit(this.base.sample(bodyId, direction))) throw new SurfaceUnavailableError(bodyId)
    if (this.prepared.has(bodyId)) return
    // A fresh revision prevents an existing visual patch from hiding this
    // preparation behind its old revision, even when the centers are nearby.
    this.deactivate(bodyId)
    const patch = createTerrainPatch(body, direction, this)
    patch.group.userData.landingPrepared = true
    this.prepared.set(bodyId, patch)
  }

  getPreparedPatch(bodyId: string): TerrainPatch | null {
    return this.prepared.get(bodyId) ?? null
  }

  needsRecenter(bodyId: string, directionLocal: Vec3): boolean {
    if (this.prepared.has(bodyId)) return false
    const patch = this.active.get(bodyId)
    const direction = unit(directionLocal)
    return !patch || !direction
      || distanceFromCenter(patch, direction) > patch.radiusKm * 0.35
  }

  deactivate(bodyId?: string): void {
    if (bodyId === undefined) {
      const prepared = [...this.prepared.values()]
      this.prepared.clear()
      this.active.clear()
      this.geometries.clear()
      for (const patch of prepared) patch.dispose()
    } else {
      const prepared = this.prepared.get(bodyId)
      this.prepared.delete(bodyId)
      this.active.delete(bodyId)
      this.geometries.delete(bodyId)
      prepared?.dispose()
    }
  }

  sample(bodyId: string, directionLocal: Vec3): SurfaceHit | null {
    const rendered = this.geometries.get(bodyId)
    const patch = this.active.get(bodyId)
    if (!rendered || rendered.revision !== patch?.revision) {
      return this.sampleReconstruction(bodyId, directionLocal)
    }
    const direction = unit(directionLocal)
    if (!direction) return null
    const source = this.base.sample(bodyId, direction)
    if (!validHit(source)) return null
    if (distanceFromCenter(patch, direction) > patch.radiusKm * 1.001) return copyHit(source)
    const radius = Math.hypot(...source.point)
    const rayDirection = new THREE.Vector3(...direction)
    const origin = rayDirection.clone().multiplyScalar(radius + patch.radiusKm * 4)
      .sub(rendered.center)
    this.raycaster.set(origin, rayDirection.clone().negate())
    const hit = this.raycaster.intersectObject(rendered.mesh, false)[0]
      ?? intersectTriangleEdges(rendered.mesh.geometry, origin, this.raycaster.ray.direction)
    if (!hit) return copyHit(source)
    const point = hit.point.add(rendered.center)
    // The original body still renders. Its facets win wherever they protrude
    // through a patch triangle, so collision uses the same visible union.
    if (point.dot(rayDirection) <= radius) return copyHit(source)
    const normal = hit.normal
    return { point: point.toArray(), normal: normal?.normalize().toArray() ?? [...source.normal] }
  }

  sampleReconstruction(bodyId: string, directionLocal: Vec3): SurfaceHit | null {
    const direction = unit(directionLocal)
    if (!direction) return null
    const source = this.base.sample(bodyId, direction)
    if (!validHit(source)) return null
    const patch = this.active.get(bodyId)
    if (!patch) return copyHit(source)
    const height = relief(patch, direction)
    if (height === 0) return copyHit(source)
    const length = Math.hypot(...source.point)
    const sourceNormal = unit(source.normal)!
    const radialDot = dot(sourceNormal, direction)
    const point = add(source.point, scale(direction, height))
    if (radialDot <= 1e-4) return { point, normal: sourceNormal }
    const [east, north] = tangentFrame(direction)
    const step = patch.radiusKm / patch.referenceRadiusKm * 1e-4
    const gradient = (tangent: Vec3): number => {
      const positive = unit(add(direction, scale(tangent, step)))!
      const negative = unit(add(direction, scale(tangent, -step)))!
      return (relief(patch, positive) - relief(patch, negative)) / (2 * step)
    }
    const angularGradient = add(scale(east, gradient(east)), scale(north, gradient(north)))
    // Normal of q(d) = p(d) + h(d)d, retaining the source mesh's own slope.
    const normal = unit(add(
      add(scale(sourceNormal, length / (length + height)),
        scale(direction, radialDot * height / (length + height))),
      scale(angularGradient, -radialDot / (length + height)),
    )) ?? sourceNormal
    return { point, normal }
  }

  setPatchGeometry(state: TerrainPatchState, mesh: THREE.Mesh): void {
    // A separate identity-transform mesh keeps ray queries independent of the
    // renderer's camera-relative translation, rotation, and kilometer scale.
    this.geometries.set(state.bodyId, {
      revision: state.revision,
      center: new THREE.Vector3(...state.centerLocalKm),
      mesh: new THREE.Mesh(mesh.geometry, mesh.material),
    })
  }

  releasePatchGeometry(bodyId: string, geometry: THREE.BufferGeometry): void {
    const rendered = this.geometries.get(bodyId)
    if (rendered?.mesh.geometry !== geometry) return
    this.prepared.delete(bodyId)
    this.geometries.delete(bodyId)
    if (this.active.get(bodyId)?.revision === rendered.revision) this.active.delete(bodyId)
  }
}

export function createTerrainSurface(base: SurfaceProvider, bodies: Body[]): TerrainSystem {
  return new TerrainSystem(base, bodies)
}

function sphericalUv(direction: Vec3, center: Vec3): [number, number] {
  const centerU = Math.atan2(center[1], center[0]) / (2 * Math.PI) + 0.5
  let u = Math.atan2(direction[1], direction[0]) / (2 * Math.PI) + 0.5
  if (u - centerU > 0.5) u -= 1
  if (u - centerU < -0.5) u += 1
  return [u, Math.asin(Math.max(-1, Math.min(1, direction[2]))) / Math.PI + 0.5]
}

function updatePreparedAppearance(patch: TerrainPatch, options: TerrainPatchOptions): void {
  const mesh = patch.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
  if (options.uvAt) {
    const positions = mesh.geometry.getAttribute('position')
    const normals = mesh.geometry.getAttribute('normal')
    const uv = new Float32Array(positions.count * 2)
    const center = new THREE.Vector3(...patch.centerLocalKm)
    for (let i = 0; i < positions.count; i += 1) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, i).add(center)
      const hit: SurfaceHit = {
        point: point.toArray(),
        normal: new THREE.Vector3().fromBufferAttribute(normals, i).toArray(),
      }
      const coordinates = options.uvAt(patch.state.bodyId, point.normalize().toArray(), hit)
      if (!coordinates.every(Number.isFinite)) {
        throw new SurfaceUnavailableError(patch.state.bodyId, 'Source texture coordinates are invalid')
      }
      uv.set(coordinates, i * 2)
    }
    mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    patch.group.userData.textureRegistration = 'source UV query'
  }
  if (options.map !== undefined) {
    mesh.material.map = options.map
    mesh.material.color.set(options.color ?? 0xffffff)
    mesh.material.needsUpdate = true
  } else if (options.color !== undefined) {
    mesh.material.color.set(options.color)
  }
}

export function createTerrainPatch(
  body: Body,
  directionLocal: Vec3,
  base: SurfaceProvider,
  options: TerrainPatchOptions = {},
): TerrainPatch {
  if (!supportsTerrain(body)) {
    throw new SurfaceUnavailableError(body.id, 'This body has no supported solid landing surface')
  }
  const surface = base instanceof TerrainSystem ? base : createTerrainSurface(base, [body])
  const prepared = surface.getPreparedPatch(body.id)
  if (prepared) {
    // Appearance and render quality cannot retessellate a cached touchdown site.
    updatePreparedAppearance(prepared, options)
    return prepared
  }
  const prior = surface.getActivePatch(body.id)
  const state = surface.activate(body.id, directionLocal)
  if (!state) throw new SurfaceUnavailableError(body.id)
  const requestedSegments = options.segments ?? TERRAIN_DEFAULT_SEGMENTS
  const segments = Number.isFinite(requestedSegments)
    ? Math.max(16, Math.min(TERRAIN_MAX_SEGMENTS, Math.floor(requestedSegments)))
    : TERRAIN_DEFAULT_SEGMENTS
  const [east, north] = tangentFrame(state.directionLocal)
  const radius = referenceRadius(body)
  const count = (segments + 1) ** 2
  const positions = new Float32Array(count * 3)
  const normals = new Float32Array(count * 3)
  const uv = new Float32Array(count * 2)
  const localUv = new Float32Array(count * 2)
  const colors = new Float32Array(count * 3)
  const indices: number[] = []

  try {
    for (let j = 0; j <= segments; j += 1) {
      for (let i = 0; i <= segments; i += 1) {
        const index = j * (segments + 1) + i
        const x = 2 * i / segments - 1
        const y = 2 * j / segments - 1
        const diskX = x * Math.sqrt(1 - y * y / 2)
        const diskY = y * Math.sqrt(1 - x * x / 2)
        const rho = Math.hypot(diskX, diskY)
        const chord = rho * state.radiusKm / radius
        const radial = 1 - chord * chord / 2
        const tangent = Math.sqrt(Math.max(0, 1 - radial * radial))
        const along = rho > 0
          ? add(scale(east, diskX / rho), scale(north, diskY / rho))
          : east
        const direction = unit(add(scale(state.directionLocal, radial), scale(along, tangent)))!
        const hit = surface.sampleReconstruction(body.id, direction)
        if (!hit) throw new SurfaceUnavailableError(body.id, 'Source mesh has no hit in the local patch')
        for (let axis = 0; axis < 3; axis += 1) {
          positions[index * 3 + axis] = hit.point[axis] - state.centerLocalKm[axis]
          normals[index * 3 + axis] = hit.normal[axis]
        }
        const textureUv = options.uvAt?.(body.id, direction, hit)
          ?? sphericalUv(direction, state.directionLocal)
        if (!textureUv.every(Number.isFinite)) {
          throw new SurfaceUnavailableError(body.id, 'Source texture coordinates are invalid')
        }
        uv.set(textureUv, index * 2)
        localUv.set([i / segments, j / segments], index * 2)
        const shade = 0.93 + 0.07 * noise(scale(direction, radius / (state.radiusKm * 0.06)), seedFromId(body.id))
        colors.set([shade, shade, shade], index * 3)
        if (i < segments && j < segments) {
          const below = index + segments + 1
          indices.push(index, index + 1, below + 1, index, below + 1, below)
        }
      }
    }
    // Retain sharp source creases instead of bridging them with new triangles.
    // The original mesh fills these narrow gaps in both rendering and collision.
    for (let i = indices.length - 3; i >= 0; i -= 3) {
      const ids = indices.slice(i, i + 3)
      const ns = ids.map((id) => new THREE.Vector3().fromArray(normals, id * 3))
      if (ns[0].dot(ns[1]) > 0.995 && ns[1].dot(ns[2]) > 0.995 && ns[2].dot(ns[0]) > 0.995) continue
      indices.splice(i, 3)
    }
  } catch (error) {
    if (prior) {
      surface.deactivate(body.id)
      surface.activate(body.id, prior.directionLocal)
    } else {
      surface.deactivate(body.id)
    }
    throw error
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geometry.setAttribute('uv1', new THREE.BufferAttribute(localUv, 2))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const material = new THREE.MeshStandardMaterial({
    color: options.color ?? (options.map ? 0xffffff : 0x8e8b85),
    map: options.map ?? null,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = `reconstructed-terrain-${body.id}`
  mesh.receiveShadow = true
  const group = new THREE.Group()
  group.name = `terrain-patch-${body.id}`
  group.userData = {
    label: TERRAIN_LABEL,
    bodyId: body.id,
    centerLocalKm: [...state.centerLocalKm],
    radiusKm: state.radiusKm,
    maxReliefKm: state.maxReliefKm,
    revision: state.revision,
    geometryUnits: 'km relative to centerLocalKm',
    textureRegistration: options.uvAt ? 'source UV query' : 'approximate equirectangular projection',
  }
  group.add(mesh)
  surface.setPatchGeometry(state, mesh)
  let disposed = false
  return {
    group,
    centerLocalKm: [...state.centerLocalKm],
    surface,
    state,
    dispose: () => {
      if (disposed) return
      disposed = true
      group.removeFromParent()
      group.clear()
      surface.releasePatchGeometry(body.id, geometry)
      geometry.dispose()
      material.dispose()
      // Source textures belong to the renderer and may be shared by the globe.
    },
  }
}
