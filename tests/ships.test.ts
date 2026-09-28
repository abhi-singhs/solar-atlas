import { afterEach, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { CHASE_PITCH, DEFAULT_SHIP, SHIPS, isShipId, shipDesign, shipProfile } from '../src/cockpit/ships'
import { DEFAULT_SHIP_PROFILE } from '../src/flight/FlightController'
import type { ShipDesign } from '../src/cockpit/ships'
import { updateCockpit } from '../src/cockpit/models'
import { disposeTree } from '../src/cockpit/parts'

const built: THREE.Object3D[] = []
const keep = <T extends THREE.Object3D>(object: T) => { built.push(object); object.updateMatrixWorld(true); return object }
afterEach(() => { for (const object of built.splice(0)) disposeTree(object) })

const corners = (box: THREE.Box3) => [0, 1, 2, 3, 4, 5, 6, 7].map(i => new THREE.Vector3(
  i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z))
const meshes = (root: THREE.Object3D) => {
  const found: THREE.Mesh[] = []
  root.traverse(object => { if (object instanceof THREE.Mesh) found.push(object) })
  return found
}
/** The desktop chase view: 50 degree vertical field of view on a 1440 by 1000 viewport. */
function chaseCamera(design: ShipDesign) {
  const camera = new THREE.PerspectiveCamera(50, 1.44, 0.1, 2000)
  camera.position.set(...design.chaseM)
  camera.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), CHASE_PITCH)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return camera
}

describe('ship registry', () => {
  it('lists unique ids with the Kestrel first and as the fallback', () => {
    expect(SHIPS).toHaveLength(15)
    expect(new Set(SHIPS.map(ship => ship.id)).size).toBe(SHIPS.length)
    expect(SHIPS[0]!.id).toBe(DEFAULT_SHIP)
    expect(shipDesign(undefined).id).toBe(DEFAULT_SHIP)
    expect(shipDesign('not-a-ship').id).toBe(DEFAULT_SHIP)
    expect(isShipId('x-wing')).toBe(true)
    expect(isShipId('not-a-ship')).toBe(false)
    expect(isShipId(3)).toBe(false)
  })

  it('converts each design to a flight profile in kilometers, with the Kestrel matching the flight defaults', () => {
    expect(shipProfile(DEFAULT_SHIP).touchdownKm).toBeCloseTo(DEFAULT_SHIP_PROFILE.touchdownKm, 12)
    shipProfile(DEFAULT_SHIP).chaseOffsetKm.forEach((value, i) => expect(value).toBeCloseTo(DEFAULT_SHIP_PROFILE.chaseOffsetKm[i]!, 12))
    for (const design of SHIPS) {
      const profile = shipProfile(design.id)
      expect(profile.touchdownKm).toBeCloseTo(design.eyeHeightM / 1000, 12)
      expect(profile.chaseOffsetKm.map(km => km * 1000)).toEqual(design.chaseM.map(m => expect.closeTo(m, 9)))
    }
  })

  it.each(SHIPS.map(ship => [ship.id, ship] as const))('%s credits its source and states plausible sizes', (_, design) => {
    expect(design.name.trim()).not.toBe('')
    expect(design.blurb.trim()).not.toBe('')
    if (design.kind === 'tribute') {
      expect(design.franchise?.trim()).toBeTruthy()
      expect(design.owner?.trim()).toBeTruthy()
    } else {
      expect(design.franchise).toBeUndefined()
      expect(design.owner).toBeUndefined()
    }
    expect(design.sizeM).toBeGreaterThan(3)
    expect(design.sizeM).toBeLessThanOrEqual(41)
    if (design.canonSizeM !== undefined) expect(design.canonSizeM).toBeGreaterThan(design.sizeM)
    expect(design.eyeHeightM).toBeGreaterThanOrEqual(1.5)
    expect(design.eyeHeightM).toBeLessThanOrEqual(12)
    expect(design.chaseM.every(Number.isFinite)).toBe(true)
  })
})

describe.each(SHIPS.map(ship => [ship.id, ship] as const))('%s', (_, design) => {
  it('builds a finite, named, meter-scale exterior that rests on its touchdown height', () => {
    const ship = keep(design.buildShip())
    expect(ship.userData).toMatchObject({ units: 'meters', forward: '-Z', origin: 'pilot eye' })
    for (const mesh of meshes(ship)) {
      expect(mesh.name, 'every exterior mesh has a name').not.toBe('')
      const position = mesh.geometry.getAttribute('position')
      expect(Array.from(position.array as ArrayLike<number>).every(Number.isFinite), mesh.name).toBe(true)
    }
    const bounds = new THREE.Box3().setFromObject(ship, true)
    const size = bounds.getSize(new THREE.Vector3())
    expect(meshes(ship).length, 'exterior draw calls').toBeLessThanOrEqual(450)
    expect(Math.abs(bounds.min.y + design.eyeHeightM), 'lowest point meets the touchdown datum').toBeLessThan(0.01)
    const largest = Math.max(size.x, size.y, size.z)
    expect(Math.abs(largest - design.sizeM) / design.sizeM, `largest dimension ${largest.toFixed(2)} m`).toBeLessThan(0.05)
    expect(largest).toBeLessThanOrEqual(41)
  })

  it('frames the whole hull from the chase camera', () => {
    const ship = keep(design.buildShip())
    const bounds = new THREE.Box3().setFromObject(ship, true)
    const camera = chaseCamera(design)
    expect(bounds.clone().expandByScalar(0.5).containsPoint(camera.position), 'camera sits outside the hull').toBe(false)
    const projected = corners(bounds).map(corner => {
      expect(corner.clone().applyMatrix4(camera.matrixWorldInverse).z, 'hull is in front of the camera').toBeLessThan(0)
      return corner.project(camera)
    })
    for (const point of projected) {
      expect(Math.abs(point.x), 'hull fits horizontally').toBeLessThanOrEqual(1)
      expect(Math.abs(point.y), 'hull fits vertically').toBeLessThanOrEqual(1)
    }
    const span = (axis: 'x' | 'y') => Math.max(...projected.map(p => p[axis])) - Math.min(...projected.map(p => p[axis]))
    expect(Math.max(span('x'), span('y')) / 2, 'hull fills a useful share of the frame').toBeGreaterThanOrEqual(0.35)
  })

  it('keeps the forward sightline clear and every display in direct view', () => {
    const cockpit = keep(design.buildCockpit())
    expect(cockpit.userData).toMatchObject({ units: 'meters', forward: '-Z', origin: 'pilot eye' })
    expect(meshes(cockpit).length, 'cockpit draw calls').toBeLessThanOrEqual(450)
    for (const x of [-0.2, 0, 0.2]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(x, 0, -1).normalize(), 0.01, 10)
      expect(ray.intersectObject(cockpit, true).map(hit => hit.object.name), `forward ray at x=${x}`).toEqual([])
    }
    // The default 50 degree view on a 1440 by 1000 window must show every display.
    const view = new THREE.PerspectiveCamera(50, 1.44, 0.01, 10)
    view.updateMatrixWorld(true)
    for (const kind of ['flight', 'navigation', 'altitude']) {
      const screens = meshes(cockpit).filter(mesh => mesh.name === `${kind}-display`)
      expect(screens, `${kind} display`).toHaveLength(1)
      const point = screens[0]!.getWorldPosition(new THREE.Vector3())
      const ray = new THREE.Raycaster(new THREE.Vector3(), point.clone().normalize(), 0.01, 10)
      expect(ray.intersectObject(cockpit, true)[0]?.object.name, `${kind} display is the first hit`).toBe(`${kind}-display`)
      const projected = point.clone().project(view)
      expect(point.z, `${kind} display is ahead of the pilot`).toBeLessThan(0)
      expect(Math.max(Math.abs(projected.x), Math.abs(projected.y)), `${kind} display is inside the default view`).toBeLessThanOrEqual(0.95)
    }
  })

  it('wires the live instruments that updateCockpit drives', () => {
    const cockpit = keep(design.buildCockpit())
    for (const name of ['speed-gauge-needle', 'vertical-speed-gauge-needle', 'heading-indicator', 'warp-indicator'])
      expect(cockpit.getObjectByName(name), name).toBeDefined()
    expect(cockpit.children.filter(object => object.name === 'commanded-speed-segment')).toHaveLength(12)
    const speed = cockpit.getObjectByName('speed-gauge-needle')!
    const heading = cockpit.getObjectByName('heading-indicator')!
    const before = speed.rotation.z
    updateCockpit(cockpit as THREE.Group, { speedC: 0.004, throttleC: 0.01, altitudeKm: 1, verticalKmS: 0, warp: false,
      mode: 'free', targetId: 'moon', referenceId: 'earth', headingDeg: 90 })
    expect(speed.rotation.z).not.toBe(before)
    expect(heading.rotation.z).toBeCloseTo(-Math.PI / 2)
  })
})
