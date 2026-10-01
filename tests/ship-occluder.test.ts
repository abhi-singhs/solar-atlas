import { readFile } from 'node:fs/promises'
import { afterAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildOccluder, occluderBlocks } from '../src/cockpit/occluder'
import { disposeTree } from '../src/cockpit/parts'
import { loadShip, shipOccluder } from '../src/cockpit/shipLoader'
import { SHIPS, shipDesign } from '../src/cockpit/ships'
import type { ShipDesign } from '../src/cockpit/ships'

const built: THREE.Object3D[] = []
afterAll(() => { for (const object of built.splice(0)) disposeTree(object) })

async function exterior(design: ShipDesign) {
  const ship = await loadShip(design, {
    skipTextures: true,
    fetchModel: async path => {
      const data = await readFile(`public/${path}`)
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    },
  })
  built.push(ship)
  return ship
}

/** Rays from the chase camera toward a grid of points across the hull's bounding box, the way sun samples cross it. */
function chaseRays(design: ShipDesign, bounds: THREE.Box3) {
  const origin = new THREE.Vector3(...design.chaseM)
  const rays: THREE.Ray[] = []
  for (let x = 0; x <= 8; x++) for (let y = 0; y <= 8; y++) for (let z = 0; z <= 2; z++) {
    const target = new THREE.Vector3(
      THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, x / 8),
      THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, y / 8),
      THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, z / 2))
    rays.push(new THREE.Ray(origin.clone(), target.sub(origin).normalize()))
  }
  return rays
}

describe('ship occluder', () => {
  it.each(SHIPS.filter(ship => ship.kind === 'nasa').map(ship => [ship.id, ship] as const))(
    '%s blocks exactly the rays a double-sided raycast hits', async (_, design) => {
      const ship = await exterior(design)
      const occluder = shipOccluder(ship)!
      expect(occluder.leaves.length).toBeGreaterThan(0)
      ship.traverse(object => {
        if (object instanceof THREE.Mesh) for (const material of [object.material].flat()) material.side = THREE.DoubleSide
      })
      const raycaster = new THREE.Raycaster()
      let hits = 0
      for (const ray of chaseRays(design, occluder.bounds)) {
        raycaster.set(ray.origin, ray.direction)
        const expected = raycaster.intersectObject(ship, true).length > 0
        expect(occluderBlocks(occluder, ray), `ray toward ${ray.direction.toArray().map(v => v.toFixed(3)).join(',')}`).toBe(expected)
        if (expected) hits++
      }
      expect(hits, 'some rays hit the hull').toBeGreaterThan(0)
    })

  it('keeps leaves small and covers every triangle once', () => {
    const geometry = new THREE.SphereGeometry(1, 64, 48)
    const mesh = new THREE.Mesh(geometry)
    mesh.position.set(5, 0, 0)
    const root = new THREE.Group().add(mesh)
    const occluder = buildOccluder(root)
    const triangles = occluder.leaves.reduce((sum, leaf) => sum + leaf.triangles.length / 9, 0)
    expect(triangles).toBe(geometry.index!.count / 3)
    expect(Math.max(...occluder.leaves.map(leaf => leaf.triangles.length / 9))).toBeLessThanOrEqual(64)
    expect(occluder.bounds.min.x).toBeCloseTo(4, 5)
    expect(occluderBlocks(occluder, new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(1, 0, 0)))).toBe(true)
    expect(occluderBlocks(occluder, new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 1, 0)))).toBe(false)
    geometry.dispose()
  })

  it('returns no occluder for ships built in code', async () => {
    const group = await exterior(shipDesign('kestrel'))
    expect(group.children.length).toBeGreaterThan(0)
    expect(shipOccluder(group)).toBeUndefined()
  })

  it('tests 19 sun rays through the ISS hull in a few milliseconds', async () => {
    const design = shipDesign('iss')
    const ship = await exterior(design)
    const occluder = shipOccluder(ship)!
    const center = occluder.bounds.getCenter(new THREE.Vector3())
    const origin = new THREE.Vector3(...design.chaseM)
    const direction = center.clone().sub(origin).normalize()
    const rays = Array.from({ length: 19 }, (_, i) => new THREE.Ray(origin, direction.clone()
      .add(new THREE.Vector3(Math.cos(i), Math.sin(i), 0).multiplyScalar(0.002)).normalize()))
    // Repeat to get a stable average; the old raycast took about 110 ms per frame here.
    const start = performance.now()
    for (let frame = 0; frame < 20; frame++) for (const ray of rays) occluderBlocks(occluder, ray)
    expect((performance.now() - start) / 20).toBeLessThan(8)
  })
})
