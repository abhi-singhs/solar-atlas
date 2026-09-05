import { describe, expect, it } from 'vitest'
import { Box3, Mesh, Vector3 } from 'three'
import { Observer } from '../src/navigation/observer'
import { AU_KM } from '../src/contracts'
import type { Body, Snapshot } from '../src/contracts'
import { distance, speed, duration } from '../src/ui/format'
import { createShip } from '../src/cockpit/models'

const bodies: Body[] = [
  { id: 'sun', name: 'Sun', category: 'star', parent_id: null, radius_km: 695700 },
  { id: 'earth', name: 'Earth', category: 'planet', parent_id: 'sun', radius_km: 6371, radii_km: [6378.1366, 6378.1366, 6356.7519] },
  { id: 'moon', name: 'Moon', category: 'moon', parent_id: 'earth', radius_km: 1737.4 },
]
const snapshot: Snapshot = { jdTdb: 2461288.5, states: {
  sun: { position: [0, 0, 0], velocity: [0, 0, 0], rotation: [0, 0, 0, 1] },
  earth: { position: [AU_KM, 1000, 10000], velocity: [0, 30, 0], rotation: [0, 0, 0, 1] },
  moon: { position: [AU_KM + 384400, 1000, 10000], velocity: [0, 31, 0], rotation: [0, 0, 0, 1] },
} }

describe('physical-scale observer', () => {
  it('frames source radius without modifying position or dimensions', () => {
    const observer = new Observer(bodies)
    observer.focus('earth', snapshot)
    const pose = observer.pose(snapshot)
    const range = new Vector3(...pose.position).distanceTo(new Vector3(...snapshot.states.earth.position))
    expect(range).toBeCloseTo(6378.1366 * 3.5, 5)
    expect(pose.quaternion.reduce((sum, n) => sum + n * n, 0)).toBeCloseTo(1, 12)
    expect(snapshot.states.earth.position).toEqual([AU_KM, 1000, 10000])
  })
  it('follows body translation and preserves camera offset', () => {
    const observer = new Observer(bodies)
    observer.focus('earth', snapshot)
    const original = observer.pose(snapshot).position
    const moved = structuredClone(snapshot)
    moved.states.earth.position[0] += 10000
    expect(observer.pose(moved).position[0] - original[0]).toBeCloseTo(10000, 8)
  })
  it('free camera retains an inertial center and uses relative movement', () => {
    const observer = new Observer(bodies)
    observer.focus('earth', snapshot)
    observer.mode = 'free'
    const original = observer.pose(snapshot)
    const moved = structuredClone(snapshot)
    moved.states.earth.position[0] += 10000
    expect(observer.pose(moved)).toEqual(original)
    observer.move(1, 0, 0, 0.1, moved)
    expect(observer.pose(moved)).not.toEqual(original)
  })
  it('frames moons at physical separations and clamps zoom outside the body', () => {
    const observer = new Observer(bodies)
    observer.focus('moon', snapshot)
    observer.system(snapshot, 'local')
    expect(observer.targetId).toBe('earth')
    expect(observer.distance).toBeCloseTo(384400 * 2.8)
    observer.zoom(-1e8)
    expect(observer.distance).toBeCloseTo(6378.1366 * 1.012)
  })
})

describe('scientific readouts', () => {
  it('places landing pads at the actual three-meter touchdown datum', () => {
    const ship = createShip()
    expect(new Box3().setFromObject(ship).min.y).toBeCloseTo(-3, 5)
    ship.traverse(object => {
      if (object instanceof Mesh) {
        object.geometry.dispose()
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
      }
    })
  })
  it('retains fine landing speeds rather than rounding to zero', () => {
    expect(speed(1e-9)).toContain('1.000e-9')
    expect(speed(0.0001945)).toBe('0.0001945 c')
    expect(speed(0)).toBe('0 c')
    expect(distance(0.004)).toBe('4 m')
  })
  it('labels astronomical distances and unavailable estimates', () => {
    expect(distance(AU_KM)).toBe('1.000 AU')
    expect(duration(Infinity)).toBe('Set a speed')
  })
})
