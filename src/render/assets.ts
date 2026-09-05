import {
  BufferAttribute, BufferGeometry, Mesh,
  SRGBColorSpace, NoColorSpace, TextureLoader, LinearMipmapLinearFilter,
} from 'three'
import type { Texture } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js'
import type { Quality, Vec3 } from '../contracts'
import { GLTF_TO_SOURCE } from './precision'
import { SourceSurface } from './meshSurface'
export { SourceSurface } from './meshSurface'

export interface TextureVariant {
  url: string
  width: number
  height: number
  bytes: number
  sha256: string
}
export interface TextureRecord {
  srgb: boolean
  role: string
  variants: Record<Quality, TextureVariant>
  source?: Record<string, unknown>
  bake_radiance_storage_scale?: number
}
export interface RingBand {
  name: string
  inner_km: number
  outer_km: number
  optical_depth: number
  pole_ra_deg?: number
  pole_dec_deg?: number
  source_note: string
}
export interface BodyAssetRecord {
  mesh: string
  mesh_low: string
  normalization_radius_km: number
  radii_km: Vec3
  source_status: string
  source_description: string
  geometry_note: string
  kind: string
  roughness: number
  textures: Record<string, string>
  cloud_height_km?: number
  atmosphere_height_km?: number
  atmosphere_scale_height_km?: number
  atmosphere_optical_depth_rgb?: Vec3
  source_metadata: Record<string, unknown>
}
export interface AssetManifest {
  schema_version: number
  bodies: Record<string, BodyAssetRecord>
  textures: Record<string, TextureRecord>
  ring_systems: Record<string, RingBand[]>
  source_metadata: Record<string, string>
  source_file_sha256: Record<string, string>
  limitations: string[]
}

export function localAssetUrl(path: string): string {
  if (!path.startsWith('assets/') || path.includes('..') || path.includes('\\') || /[?#]/.test(path))
    throw new Error(`Invalid local asset path: ${path}`)
  return new URL(`${import.meta.env.BASE_URL}${path}`, document.baseURI).href
}

export function restoreSourceGeometry(geometry: BufferGeometry, transform = GLTF_TO_SOURCE): BufferGeometry {
  const restored = geometry.clone().applyMatrix4(transform)
  restored.setAttribute('sourcePosition', restored.getAttribute('position').clone())
  restored.computeBoundingSphere()
  restored.computeBoundingBox()
  return restored
}

export interface LoadedBody {
  id: string
  record: BodyAssetRecord
  geometry: BufferGeometry
  lowGeometry?: BufferGeometry
  surface: SourceSurface
  textures: Record<string, Texture>
  quality: Quality
  bytes: number
  touched: number
}

export class AssetStore {
  readonly ready: Promise<AssetManifest>
  manifest?: AssetManifest
  readonly bodies = new Map<string, LoadedBody>()
  private inflight = new Map<string, Promise<LoadedBody>>()
  private dead = false
  private gltf = new GLTFLoader()
  private textureLoader = new TextureLoader()
  private exr = new EXRLoader()
  private clock = 0
  private progress: (message: string) => void
  private released: (id: string) => void
  constructor(progress: (message: string) => void, released: (id: string) => void) {
    this.progress = progress
    this.released = released
    this.ready = fetch(localAssetUrl('assets/manifest.json')).then(async response => {
      if (!response.ok) throw new Error(`Asset manifest request failed (${response.status})`)
      const data = await response.json() as AssetManifest
      if (data.schema_version !== 1 || !data.bodies || Object.keys(data.bodies).length !== 71)
        throw new Error('Asset manifest does not contain the 71 source bodies')
      this.manifest = data
      this.progress('Source assets ready')
      return data
    })
  }
  get(id: string): LoadedBody | undefined {
    const value = this.bodies.get(id)
    if (value) value.touched = ++this.clock
    return value
  }
  async ensure(id: string, quality: Quality): Promise<LoadedBody> {
    const existing = this.get(id)
    if (existing && existing.quality === quality) return existing
    const current = this.inflight.get(id)
    if (current) {
      const result = await current
      return result.quality === quality ? result : this.ensure(id, quality)
    }
    const request = this.load(id, quality).finally(() => this.inflight.delete(id))
    this.inflight.set(id, request)
    return request
  }
  private async geometry(url: string): Promise<BufferGeometry> {
    const gltf = await this.gltf.loadAsync(localAssetUrl(url))
    gltf.scene.updateMatrixWorld(true)
    const meshes: Mesh[] = []
    gltf.scene.traverse(object => { if (object instanceof Mesh) meshes.push(object) })
    if (meshes.length !== 1) throw new Error(`Expected one source mesh in ${url}; found ${meshes.length}`)
    const mesh = meshes[0]!
    const result = restoreSourceGeometry(mesh.geometry, GLTF_TO_SOURCE.clone().multiply(mesh.matrixWorld))
    mesh.geometry.dispose()
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose()
    return result
  }
  private async load(id: string, quality: Quality): Promise<LoadedBody> {
    const manifest = await this.ready
    const record = manifest.bodies[id]
    if (!record) throw new Error(`No source asset for ${id}`)
    this.progress(`Loading ${id} source mesh and ${quality} maps`)
    const previous = this.bodies.get(id)
    const geometry = previous?.geometry ?? await this.geometry(record.mesh)
    let lowGeometry: BufferGeometry | undefined
    const textures: Record<string, Texture> = {}
    let bytes = geometry.getAttribute('position').count * 44
    try {
      lowGeometry = quality === 'low' ? await this.geometry(record.mesh_low) : undefined
      // Load sequentially so a 4K planet never launches an unbounded decode burst.
      for (const [role, key] of Object.entries(record.textures)) {
        const textureRecord = manifest.textures[key]!
        const variant = textureRecord.variants[quality]
        const loader = variant.url.endsWith('.exr') ? this.exr : this.textureLoader
        const texture = await loader.loadAsync(localAssetUrl(variant.url))
        texture.flipY = false
        texture.colorSpace = textureRecord.srgb ? SRGBColorSpace : NoColorSpace
        texture.minFilter = LinearMipmapLinearFilter
        texture.anisotropy = quality === 'high' ? 8 : 2
        textures[role] = texture
        bytes += variant.width * variant.height * (variant.url.endsWith('.exr') ? 8 : 4) * 4 / 3
      }
      if (this.dead) throw new Error('Renderer disposed during asset load')
      if (previous) {
        this.released(id)
        for (const texture of Object.values(previous.textures)) texture.dispose()
        previous.lowGeometry?.dispose()
        previous.surface.dispose()
      }
      const result: LoadedBody = { id, record, geometry, lowGeometry, textures, quality, bytes,
        surface: new SourceSurface(geometry, record.normalization_radius_km), touched: ++this.clock }
      this.bodies.set(id, result)
      this.progress(`${id} ready`)
      return result
    } catch (error) {
      Object.values(textures).forEach(texture => texture.dispose())
      lowGeometry?.dispose()
      if (!previous) geometry.dispose()
      throw error
    }
  }
  trim(quality: Quality, pinned: Set<string>): void {
    const budget = (quality === 'high' ? 512 : 96) * 1024 * 1024
    let bytes = [...this.bodies.values()].reduce((sum, body) => sum + body.bytes, 0)
    for (const body of [...this.bodies.values()].sort((a, b) => a.touched - b.touched)) {
      if (bytes <= budget) break
      if (pinned.has(body.id) || this.inflight.has(body.id)) continue
      bytes -= body.bytes
      this.remove(body.id)
    }
  }
  private remove(id: string): void {
    const body = this.bodies.get(id)
    if (!body) return
    this.released(id)
    body.surface.dispose()
    body.geometry.dispose()
    body.lowGeometry?.dispose()
    Object.values(body.textures).forEach(texture => texture.dispose())
    this.bodies.delete(id)
  }
  get stats(): { bodies: number; bytes: number; loading: number } {
    return { bodies: this.bodies.size, bytes: [...this.bodies.values()].reduce((n, b) => n + b.bytes, 0),
      loading: this.inflight.size }
  }
  dispose(): void {
    this.dead = true
    for (const id of this.bodies.keys()) this.remove(id)
  }
}

export function positionAttribute(geometry: BufferGeometry): BufferAttribute {
  return geometry.getAttribute('position') as BufferAttribute
}
