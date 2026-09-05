import { describe, expect, it } from 'vitest'
import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { readFile } from 'node:fs/promises'
import { commonExposure, gltfToSource, opticalOpacity, projectedRadiusPixels, rebaseVertices,
  relativePosition, ringRotation } from '../src/render/precision'
import { restoreSourceGeometry, SourceSurface } from '../src/render/assets'
import type { Vec3 } from '../src/contracts'

describe('scientific render coordinates', () => {
  it('restores the glTF rotation exactly once without reflecting handedness', () => {
    expect(gltfToSource([1, 3, -2])).toEqual([1, 2, 3])
    const x = new Vector3(...gltfToSource([1, 0, 0]))
    const y = new Vector3(...gltfToSource([0, 0, -1]))
    expect(x.cross(y).distanceTo(new Vector3(0, 0, 1))).toBe(0)
  })
  it('subtracts double precision positions before GPU normalization', () => {
    const origin: Vec3 = [15e9, -20e9, 7e9]
    const relative = relativePosition([origin[0] + .001, origin[1] + .005, origin[2] - .002], origin)
    expect(relative[0]).toBeCloseTo(.001, 5)
    expect(relative[1]).toBeCloseTo(.005, 5)
    expect(relative[2]).toBeCloseTo(-.002, 5)
    expect(new Float32Array([origin[0] + .001])[0]! - new Float32Array([origin[0]])[0]!).toBe(0)
  })
  it('retains millimeter-scale local offsets through CPU vertex rebasing', () => {
    const out = new Float32Array(3)
    rebaseVertices([1, 0, 0], [6378.1366 + .000001, 0, 0], 6378.1366, .000001, out)
    expect(out[0]).toBeCloseTo(-1, 5)
  })
  it('preserves angular radius under a change of render units', () => {
    expect(projectedRadiusPixels(6378, 1e8, 1000)).toBeCloseTo(projectedRadiusPixels(.6378, 1e4, 1000), 12)
    expect(projectedRadiusPixels(1, 1e12, 1000)).toBeLessThan(1e-8)
  })
  it('uses one selected-body exposure without altering inverse-square flux', () => {
    expect(commonExposure(30, 0)).toBe(900)
    expect(commonExposure(30, 1)).toBe(1800)
    expect(commonExposure(30, 0) / 30 ** 2).toBe(1)
    expect(commonExposure(30, 0) / 15 ** 2).toBe(4)
  })
  it('does not brighten tenuous rings with a minimum opacity', () => {
    expect(opticalOpacity(1e-7, 1)).toBeCloseTo(9.9999995e-8, 15)
    expect(opticalOpacity(0, .3)).toBe(0)
    expect(opticalOpacity(2, 1)).toBeCloseTo(.8646647168, 10)
  })
  it('keeps independent ring poles in ICRF instead of body-spin coordinates', () => {
    const q = ringRotation(151.3, 41.48, [0, 0, 1, 0])
    const north = new Vector3(0, 0, 1).applyQuaternion(q)
    expect(Math.asin(north.z) * 180 / Math.PI).toBeCloseTo(41.48, 10)
    expect(Math.atan2(north.y, north.x) * 180 / Math.PI).toBeCloseTo(151.3, 10)
  })
})

describe('actual source mesh collision', () => {
  it('samples the exported Bennu mesh rather than a radius-only sphere', async () => {
    const data = await readFile('public/assets/meshes/bennu.glb')
    const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
    gltf.scene.updateMatrixWorld(true)
    const mesh = gltf.scene.children[0] as Mesh
    const geometry = restoreSourceGeometry(mesh.geometry)
    const manifest = JSON.parse(await readFile('public/assets/manifest.json', 'utf8'))
    const radius = manifest.bodies.bennu.normalization_radius_km
    const surface = new SourceSurface(geometry, radius)
    const hits = ([ [1, .3, .2], [.2, 1, -.4], [-.6, .3, 1] ] as Vec3[]).map(d => surface.sample(d)!)
    expect(hits.every(hit => !!hit && hit.point.every(Number.isFinite))).toBe(true)
    expect(hits.every(hit => Math.abs(Math.hypot(...hit.normal) - 1) < 1e-6)).toBe(true)
    const radii = hits.map(hit => Math.hypot(...hit.point))
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(radius * .01)
    expect(surface.sample([0, 0, 0])).toBeNull()
    surface.dispose()
    geometry.dispose()
  })
  it('does not mutate source coordinates when rebasing a rendering copy', () => {
    const source = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([1, 0, 0], 3))
    const restored = restoreSourceGeometry(source)
    const attribute = restored.getAttribute('position')
    rebaseVertices(restored.getAttribute('sourcePosition').array, [1, 0, 0], 1, 1, attribute.array as Float32Array)
    expect(source.getAttribute('position').getX(0)).toBe(1)
    expect(restored.getAttribute('sourcePosition').getX(0)).toBe(1)
    expect(attribute.getX(0)).toBe(0)
  })
})
