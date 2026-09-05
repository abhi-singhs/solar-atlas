import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { Mesh, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { restoreSourceGeometry } from '../src/render/assets'

const root = 'public/'
const load = async (path: string) => JSON.parse(await readFile(path, 'utf8'))
const hash = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex')

describe('portable source asset package', () => {
  it('retains 71 bodies, 114 textures, 35 full prepared maps, and 37 source ring bands', async () => {
    const manifest = await load(`${root}assets/manifest.json`)
    const rights = await load(`${root}assets/source/data/asset_manifest.json`)
    const catalog = await load(`${root}assets/source/data/catalog.json`)
    expect(Object.keys(manifest.bodies).sort()).toEqual(catalog.bodies.map((b: { id: string }) => b.id).sort())
    expect(Object.keys(manifest.textures)).toHaveLength(114)
    expect(Object.keys(manifest.prepared_source_maps)).toHaveLength(35)
    expect(Object.keys(manifest.ring_systems)).toHaveLength(7)
    expect(Object.values(manifest.ring_systems).flat()).toHaveLength(37)
    for (const [id, body] of Object.entries<any>(manifest.bodies))
      expect(body.source_metadata).toEqual(rights.bodies[id])
    expect(manifest.bodies.earth.cloud_height_km).toBe(8)
    expect(manifest.bodies.venus.cloud_height_km).toBe(65)
    expect(manifest.bodies.saturn.atmosphere_height_km).toBe(350)
    for (const value of Object.values<any>(manifest.prepared_source_maps))
      expect(hash(await readFile(root + value.url))).toBe(value.sha256)
  })
  it('resolves both quality variants locally with finite dimensions and verified hashes', async () => {
    const manifest = await load(`${root}assets/manifest.json`)
    for (const texture of Object.values<any>(manifest.textures)) {
      for (const quality of ['low', 'high']) {
        const variant = texture.variants[quality]
        expect(variant.url.startsWith('assets/textures/')).toBe(true)
        expect(variant.width).toBeLessThanOrEqual(quality === 'low' ? 1024 : 4096)
        expect(variant.height).toBeGreaterThan(0)
        const buffer = await readFile(root + variant.url)
        expect(hash(buffer)).toBe(variant.sha256)
        expect(buffer.byteLength).toBe(variant.bytes)
      }
    }
  })
  it('matches all exported source bounds, cardinal UVs, outward winding, and full triangle counts', async () => {
    const evidence = await load(`${root}assets/geometry-validation.json`)
    expect(evidence.source_unchanged).toBe(true)
    for (const [id, body] of Object.entries<any>(evidence.bodies)) {
      const buffer = await readFile(root + body.mesh)
      expect(hash(buffer)).toBe(body.sha256)
      const jsonLength = buffer.readUInt32LE(12)
      const glb = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'))
      expect(glb.scenes, id).toHaveLength(1)
      expect(glb.meshes, id).toHaveLength(1)
      expect(glb.animations, id).toBeUndefined()
      const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '')
      const mesh = gltf.scene.children[0] as Mesh
      const geometry = restoreSourceGeometry(mesh.geometry)
      const p = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv')
      expect(geometry.index!.count / 3, id).toBe(body.triangles)
      for (let axis = 0; axis < 3; axis++) {
        const values = Array.from({ length: p.count }, (_, i) => p.getComponent(i, axis))
        expect(Math.min(...values) * body.normalization_radius_km, id)
          .toBeCloseTo(body.source_bounds_km[axis][0], Math.max(0, 4 - Math.floor(Math.log10(body.normalization_radius_km))))
        expect(Math.max(...values) * body.normalization_radius_km, id)
          .toBeCloseTo(body.source_bounds_km[axis][1], Math.max(0, 4 - Math.floor(Math.log10(body.normalization_radius_km))))
      }
      for (const probe of body.cardinal_probes) {
        let match = false
        for (let i = 0; i < p.count; i++) {
          const distance = new Vector3().fromBufferAttribute(p, i).distanceTo(new Vector3(...probe.source_position))
          if (distance < 2e-6 && Math.abs(uv.getX(i) - probe.source_uv[0]) < 2e-6
            && Math.abs(uv.getY(i) - (1 - probe.source_uv[1])) < 2e-6) match = true
        }
        expect(match, `${id} cardinal UV registration`).toBe(true)
      }
      const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3()
      for (let i = 0; i < geometry.index!.count; i += 3) {
        const j = geometry.index!.getX(i)
        a.fromBufferAttribute(p, j)
        b.fromBufferAttribute(p, geometry.index!.getX(i + 1)).sub(a)
        c.fromBufferAttribute(p, geometry.index!.getX(i + 2)).sub(a)
        n.fromBufferAttribute(normal, j)
        expect(b.cross(c).dot(n), id).toBeGreaterThanOrEqual(-1e-8)
      }
      const low = await readFile(root + body.mesh_low)
      expect(hash(low)).toBe(body.low_sha256)
      expect((await stat(root + body.mesh_low)).size).toBeLessThan(buffer.byteLength)
      geometry.dispose()
      mesh.geometry.dispose()
    }
  }, 120000)
})
