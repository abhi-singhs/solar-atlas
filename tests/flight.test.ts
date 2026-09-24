import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import type { Body, BodyState, CameraPose, Snapshot, SurfaceProvider, Vec3 } from '../src/contracts'
import { C_KM_S } from '../src/contracts'
import { FlightController, MAX_FLIGHT_DT_SECONDS, NORMAL_LIMIT_C, WARP_LIMIT_C } from '../src/flight/FlightController'
import type { FlightInput, LandingSurfaceProvider } from '../src/flight/FlightController'
import { CLEARANCE_KM, sweep } from '../src/flight/collision'
import { createTerrainPatch, createTerrainSurface } from '../src/terrain'
import type { TerrainPatch } from '../src/terrain'

const IDENTITY: BodyState['rotation'] = [0, 0, 0, 1]
const input: FlightInput = { pitch: 0, yaw: 0, roll: 0, forward: 0, vertical: 0, lateral: 0, brake: false, lookX: 0, lookY: 0 }
const body = (id: string, radius = 1, category = 'moon'): Body => ({ id, name: id, category, radius_km: radius, parent_id: null })
const earth = body('earth')
const pose = (position: Vec3, quaternion = IDENTITY): CameraPose => ({ position, quaternion })
const state = (position: Vec3 = [0, 0, 0], velocity: Vec3 = [0, 0, 0], q = IDENTITY): BodyState => ({ position, velocity, rotation: q })
const snap = (states: Record<string, BodyState> = { earth: state() }, seconds = 0): Snapshot => ({ jdTdb: 2461288 + seconds / 86400, states })
const spheres = (bodies: Body[]): SurfaceProvider => ({
  sample(id, direction) {
    const b = bodies.find(candidate => candidate.id === id)
    if (!b) return null
    const n = new Vector3(...direction).normalize()
    return { point: n.clone().multiplyScalar(b.radius_km).toArray() as Vec3, normal: n.toArray() as Vec3 }
  },
})
const vector = (a: Vec3): Vector3 => new Vector3(...a)
function setup(bodies = [earth], snapshot = snap(), observer = pose([0, 0, 10000]), surface = spheres(bodies)) {
  const flight = new FlightController(bodies, surface)
  flight.enter(snapshot, bodies[0]!.id, observer)
  return flight
}
function advance(flight: FlightController, seconds: number, snapshot = snap(), controls = input): void {
  const count = Math.ceil(seconds / 0.1)
  for (let i = 0; i < count; i++) flight.update(Math.min(0.1, seconds - i * 0.1), snapshot, controls)
}

describe('flight command and input contracts', () => {
  it('uses exact c and reports actual speed separately from the bounded command', () => {
    expect(C_KM_S).toBe(299792.458)
    const flight = setup([earth], snap(), pose([0, 0, 1e12]))
    flight.setThrottle(2)
    expect(flight.telemetry(snap()).throttleC).toBe(NORMAL_LIMIT_C)
    expect(flight.telemetry(snap()).speedC).toBe(0)
    flight.update(0.1, snap(), input)
    expect(flight.telemetry(snap()).speedC).toBeGreaterThan(0)
    expect(flight.telemetry(snap()).speedC).toBeLessThan(NORMAL_LIMIT_C)
    advance(flight, 6)
    expect(flight.telemetry(snap()).speedC).toBeCloseTo(NORMAL_LIMIT_C, 10)
    flight.setThrottle(-10)
    expect(flight.telemetry(snap()).throttleC).toBe(0)
    flight.setThrottle(Number.NaN)
    expect(flight.telemetry(snap()).message).toContain('finite')
  })

  it('requires explicit warp, caps at 1000c, and clamps when disabled', () => {
    const flight = setup([earth], snap(), pose([0, 0, 1e12]))
    flight.setThrottle(1000)
    expect(flight.telemetry(snap()).throttleC).toBe(NORMAL_LIMIT_C)
    flight.setWarp(true)
    flight.setThrottle(10000)
    expect(flight.telemetry(snap()).throttleC).toBe(WARP_LIMIT_C)
    advance(flight, 4)
    expect(flight.telemetry(snap()).speedC).toBeCloseTo(WARP_LIMIT_C, 7)
    flight.setWarp(false)
    expect(flight.telemetry(snap()).throttleC).toBe(NORMAL_LIMIT_C)
    const before = vector(flight.pose().position)
    flight.update(0.1, snap(), input)
    expect(flight.telemetry(snap()).speedC).toBeLessThanOrEqual(NORMAL_LIMIT_C + 1e-12)
    expect(vector(flight.pose().position).distanceTo(before)).toBeLessThanOrEqual(C_KM_S * 0.1 + 0.001)
  })

  it('supports fine speed, forward thrust, vertical thrust, yaw, pitch, and roll', () => {
    const flight = setup()
    flight.setThrottle(1e-9)
    advance(flight, 1)
    expect(flight.telemetry(snap()).speedC).toBeCloseTo(1e-9, 12)
    const before = flight.pose()
    advance(flight, 1, snap(), { ...input, yaw: 0.6, pitch: 0.3, roll: -0.4, vertical: 1, forward: 1, lateral: 1 })
    expect(flight.pose().quaternion).not.toEqual(before.quaternion)
    expect(vector(flight.pose().position).distanceTo(vector(before.position))).toBeGreaterThan(0.01)
    expect(flight.pose().position[1]).toBeGreaterThan(before.position[1])
    expect(new Quaternion(...flight.pose().quaternion).length()).toBeCloseTo(1, 12)
  })

  it('free-look works while paused without steering or moving the ship', () => {
    const flight = setup()
    const ship = flight.pose()
    flight.update(0, snap(), { ...input, yaw: 1, forward: 1, lookX: 0.5, lookY: -0.2 })
    expect(flight.pose()).toEqual(ship)
    expect(flight.camera('cockpit').quaternion).not.toEqual(ship.quaternion)
    expect(vector(flight.camera('chase').position).distanceTo(vector(ship.position))).toBeCloseTo(Math.hypot(0.02, 0.007), 10)
    flight.resetLook()
    expect(flight.camera('cockpit').quaternion).toEqual(ship.quaternion)
  })

  it('uses positive right/up look rates consistently across render frame rates while paused', () => {
    const a = setup()
    const b = setup()
    const controls = { ...input, lookX: 0.4, lookY: 0.3 }
    for (let i = 0; i < 60; i++) a.update(0, snap(), controls, 1 / 60)
    for (let i = 0; i < 30; i++) b.update(0, snap(), controls, 1 / 30)
    const qa = new Quaternion(...a.camera('cockpit').quaternion)
    const qb = new Quaternion(...b.camera('cockpit').quaternion)
    expect(qa.angleTo(qb)).toBeLessThan(1e-7)
    const direction = new Vector3(0, 0, -1).applyQuaternion(qa)
    expect(direction.x).toBeGreaterThan(0)
    expect(direction.y).toBeGreaterThan(0)
    expect(a.pose()).toEqual(b.pose())
    expect(a.pose().quaternion).toEqual(IDENTITY)
    a.update(0, snap(), controls, Number.NaN)
    expect(a.camera('cockpit').quaternion.every(Number.isFinite)).toBe(true)
  })

  it('treats held look as a rate even when a caller omits render time, without consuming input', () => {
    const flight = setup()
    const controls = { ...input, lookX: 1 }
    flight.update(0, snap(), controls)
    const angle = new Quaternion(...flight.camera('cockpit').quaternion).angleTo(new Quaternion())
    expect(angle).toBeCloseTo(1.5 / 60, 10)
    expect(controls.lookX).toBe(1)
    flight.update(0, snap(), controls, 1000)
    const bounded = new Quaternion(...flight.camera('cockpit').quaternion).angleTo(new Quaternion())
    expect(bounded).toBeCloseTo(1.5 / 60 + 0.075, 10)
    flight.resetLook()
    flight.update(0.025, snap(), controls)
    const fallback = new Quaternion(...flight.camera('cockpit').quaternion).angleTo(new Quaternion())
    expect(fallback).toBeCloseTo(0.025 * 1.5, 10)
  })

  it('launches outside the reference geometry without changing valid observer poses', () => {
    const inside = setup([earth], snap(), pose([0, 0, 0]))
    expect(vector(inside.pose().position).length()).toBeGreaterThan(1.003)
    const valid = pose([5, 8, 11])
    const outside = setup([earth], snap(), valid)
    expect(outside.pose()).toEqual(valid)
  })

  it('rejects invalid and unbounded elapsed time rather than jumping after a suspended tab', () => {
    const flight = setup()
    flight.setThrottle(0.1)
    const before = flight.pose()
    for (const dt of [-1, Infinity, NaN, MAX_FLIGHT_DT_SECONDS + 1]) {
      flight.update(dt, snap(), input)
      expect(flight.pose()).toEqual(before)
      expect(flight.telemetry(snap()).message).toContain('step rejected')
    }
    flight.update(0.1, snap(), { ...input, yaw: NaN, lookX: NaN, lateral: Infinity })
    expect(flight.pose().position.every(Number.isFinite)).toBe(true)
    expect(flight.pose().quaternion.every(Number.isFinite)).toBe(true)
  })

  it('integrates the same elapsed simulation time independent of frame subdivision', () => {
    const a = setup([earth], snap(), pose([0, 0, 1e9]))
    const b = setup([earth], snap(), pose([0, 0, 1e9]))
    a.setThrottle(1e-4)
    b.setThrottle(1e-4)
    a.update(2, snap(), input)
    advance(b, 2)
    expect(a.telemetry(snap()).speedC).toBeCloseTo(b.telemetry(snap()).speedC, 12)
    expect(vector(a.pose().position).distanceTo(vector(b.pose().position))).toBeLessThan(1e-5)
    const frozen = a.pose()
    a.update(0, snap(), input)
    expect(a.pose()).toEqual(frozen)
  })

  it('changes reference without modifying inertial position or velocity', () => {
    const moon = body('moon')
    const snapshot = snap({ earth: state([0, 0, 0], [2, 0, 0]), moon: state([0, 100, 0], [-3, 0, 0]) })
    const flight = setup([earth, moon], snapshot)
    expect(flight.telemetry(snapshot).speedC).toBe(0)
    const before = flight.pose()
    flight.setReference('moon')
    expect(flight.pose()).toEqual(before)
    expect(flight.telemetry(snapshot).speedC * C_KM_S).toBeCloseTo(5, 10)
    flight.setReference('earth')
    expect(flight.telemetry(snapshot).speedC).toBe(0)
  })
})

describe('assisted transfer and collision safety', () => {
  it('estimates arrival from the remaining hold-point distance instead of distance to the body center', () => {
    const moon = body('moon', 1737.4)
    const snapshot = snap({ moon: state() })
    const flight = setup([moon], snapshot, pose([0, 0, 1737.4 * 1.05 + 1]))
    flight.transfer('moon', snapshot)
    flight.update(1 / 60, snapshot, input)
    const telemetry = flight.telemetry(snapshot)
    const remaining = telemetry.separationKm - 1737.4 * 1.05
    const speedKmS = telemetry.speedC * C_KM_S
    expect(telemetry.mode).toBe('approach')
    expect(telemetry.separationKm).toBeGreaterThan(1800)
    expect(telemetry.etaSeconds).toBeCloseTo(remaining / speedKmS, 6)
    expect(telemetry.etaSeconds).toBeLessThan(5)
    advance(flight, 15, snapshot)
    expect(flight.telemetry(snapshot).mode).toBe('free')
    expect(flight.telemetry(snapshot).etaSeconds).toBe(0)
  })

  it('makes a zero-throttle transfer useful and cancel preserves instantaneous state', () => {
    const moon = body('moon')
    const snapshot = snap({ earth: state(), moon: state([10000, 1000, -10000], [0.1, 0.02, 0]) })
    const flight = setup([earth, moon], snapshot, pose([0, 0, 10]))
    flight.transfer('moon', snapshot)
    expect(flight.telemetry(snapshot).throttleC).toBe(0.001)
    advance(flight, 1, snapshot)
    expect(flight.telemetry(snapshot).mode).toBe('transfer')
    const before = flight.pose()
    const speed = flight.telemetry(snapshot).speedC
    flight.cancel()
    expect(flight.pose()).toEqual(before)
    expect(flight.telemetry(snapshot).speedC).toBe(speed)
    expect(flight.telemetry(snapshot).mode).toBe('free')
    expect(flight.telemetry(snapshot).targetId).toBe('')
    flight.brake()
    advance(flight, 10, snapshot)
    expect(flight.telemetry(snapshot).speedC).toBeLessThan(speed * 0.01)
  })

  it('tracks a moving target, brakes near it, and arrives without a teleport', () => {
    const target = body('target')
    const original = snap({ earth: state([0, 0, -1000]), target: state([0, 0, 0], [0.02, 0, 0]) })
    const flight = setup([earth, target], original, pose([0, 0, 8]))
    flight.transfer('target', original)
    let snapshot = original
    for (let i = 1; i <= 4000 && flight.telemetry(snapshot).mode !== 'free'; i++) {
      const t = i * 0.1
      snapshot = snap({ earth: original.states.earth!, target: state([0.02 * t, 0, 0], [0.02, 0, 0]) }, t)
      flight.update(0.1, snapshot, input)
    }
    const telemetry = flight.telemetry(snapshot)
    expect(telemetry.mode, JSON.stringify(telemetry)).toBe('free')
    expect(telemetry.referenceId).toBe('target')
    expect(telemetry.separationKm).toBeGreaterThan(1)
    expect(telemetry.separationKm).toBeLessThan(1.2)
    expect(telemetry.speedC).toBeLessThan(1e-8)
    expect(telemetry.message).toContain('Arrived')
  })

  it('sweeps high-speed motion through a moving planet instead of skipping it', () => {
    const moving = body('moving', 10)
    const before = snap({ moving: state([0, 2, 0], [0, -4, 0]) })
    const after = snap({ moving: state([0, -2, 0], [0, -4, 0]) }, 1)
    const hit = sweep([moving], spheres([moving]), new Vector3(-1e8, 0, 0), new Vector3(1e8, 0, 0), before, after, 0, 1, false)
    expect(hit).not.toBeNull()
    expect(hit!.fraction).toBeLessThan(0.5)
    expect(hit!.fraction).toBeGreaterThan(0.49999)
    const crossing = sweep([moving], spheres([moving]), new Vector3(), new Vector3(),
      snap({ moving: state([-100, 0, 0]) }), snap({ moving: state([100, 0, 0]) }), 0, 1, false)
    expect(crossing).not.toBeNull()
  })

  it('does not double-count the shared inertial motion of the departure and moving target', () => {
    const target = body('target')
    const original = snap({ earth: state([0, 0, -1000], [20, 2, 0.3]), target: state([0, 0, 0], [20, 2, 0.3]) })
    const flight = setup([earth, target], original, pose([0, 0, 8]))
    flight.transfer('target', original)
    let snapshot = original
    for (let i = 1; i <= 2000 && flight.telemetry(snapshot).mode !== 'free'; i++) {
      const t = i * 0.1
      snapshot = snap({
        earth: state([20 * t, 2 * t, 0.3 * t - 1000], [20, 2, 0.3]),
        target: state([20 * t, 2 * t, 0.3 * t], [20, 2, 0.3]),
      }, t)
      flight.update(0.1, snapshot, input)
    }
    expect(flight.telemetry(snapshot).mode).toBe('free')
    expect(flight.telemetry(snapshot).separationKm).toBeLessThan(1.2)
    expect(flight.telemetry(snapshot).speedC).toBeLessThan(1e-8)
  })

  it('holds a steady heading and the commanded speed during a near-c transfer', () => {
    const target = body('target', 1000)
    const moving = (t: number) => snap({ earth: state(), target: state([3e8 + 10 * t, 2e8 - 5 * t, -9e8 + 3 * t], [10, -5, 3]) }, t)
    const flight = setup([earth, target], moving(0), pose([0, 0, 10]))
    flight.setThrottle(NORMAL_LIMIT_C)
    flight.transfer('target', moving(0))
    let previous = new Quaternion(...flight.pose().quaternion)
    let largestTurn = 0
    for (let i = 1; i <= 600; i++) {
      flight.update(1 / 60, moving(i / 60), input, 1 / 60)
      const current = new Quaternion(...flight.pose().quaternion)
      if (i > 300) largestTurn = Math.max(largestTurn, previous.angleTo(current))
      previous = current
    }
    expect(flight.telemetry(moving(10)).mode).toBe('transfer')
    expect(largestTurn).toBeLessThan(1e-6)
    expect(flight.telemetry(moving(10)).speedC).toBeGreaterThan(0.9999)
  })

  it('routes a conventional near-c transfer around another body blocking the straight line', () => {
    const rock = body('rock', 6000, 'planet')
    const target = body('target', 1000)
    const snapshot = snap({ earth: state(), rock: state([0, 0, -100000]), target: state([0, 0, -1e6]) })
    const flight = setup([earth, rock, target], snapshot, pose([0, 0, 10]))
    flight.setThrottle(NORMAL_LIMIT_C)
    flight.transfer('target', snapshot)
    let closest = Number.POSITIVE_INFINITY
    let stopped = false
    for (let i = 1; i <= 7200 && flight.telemetry(snapshot).mode !== 'free'; i++) {
      flight.update(1 / 60, snapshot, input, 1 / 60)
      closest = Math.min(closest, vector(flight.pose().position).distanceTo(vector([0, 0, -100000])))
      stopped ||= flight.telemetry(snapshot).message.includes('safety stop')
    }
    const telemetry = flight.telemetry(snapshot)
    expect(telemetry.mode, JSON.stringify({ closest, ...telemetry })).toBe('free')
    expect(telemetry.message).toContain('Arrived')
    expect(stopped).toBe(false)
    expect(closest).toBeGreaterThan(6000 * 1.2)
  })

  it('disengages warp at a swept exclusion zone without tunneling', () => {
    const flight = setup([earth], snap(), pose([0, 0, 1000]))
    flight.setWarp(true)
    flight.setThrottle(1000)
    flight.update(0.1, snap(), input)
    expect(flight.telemetry(snap()).warp).toBe(false)
    expect(vector(flight.pose().position).length()).toBeGreaterThanOrEqual(2)
    expect(flight.telemetry(snap()).message).toContain('swept')
    advance(flight, 2)
    expect(vector(flight.pose().position).length()).toBeGreaterThanOrEqual(1.003 - 1e-6)
  })

  it('uses actual irregular geometry rather than colliding at a bounding sphere', () => {
    const irregular = body('rock', 3)
    const ellipsoid: SurfaceProvider = {
      sample(_id, direction) {
        const d = vector(direction)
        const scale = 1 / Math.sqrt(d.x * d.x / 9 + d.y * d.y + d.z * d.z)
        const p = d.multiplyScalar(scale)
        const n = new Vector3(p.x / 9, p.y, p.z).normalize()
        return { point: p.toArray() as Vec3, normal: n.toArray() as Vec3 }
      },
    }
    const snapshot = snap({ rock: state() })
    const hit = sweep([irregular], ellipsoid, new Vector3(0, 0, 10), new Vector3(0, 0, -10), snapshot, snapshot, 0, 1, false)
    expect(hit).not.toBeNull()
    expect(10 - hit!.fraction * 20).toBeCloseTo(1.003, 7)
  })

  it('stops a conventional high-speed crossing of a star even without loaded mesh data', () => {
    const sun = body('sun', 10, 'star')
    const snapshot = snap({ sun: state() })
    const flight = setup([sun], snapshot, pose([0, 0, 100]), { sample: () => null })
    flight.setThrottle(NORMAL_LIMIT_C)
    flight.update(0.1, snapshot, input)
    expect(flight.telemetry(snapshot).warp).toBe(false)
    expect(vector(flight.pose().position).length()).toBeGreaterThanOrEqual(10 + CLEARANCE_KM)
    expect(flight.telemetry(snapshot).throttleC).toBe(0)
    expect(flight.telemetry(snapshot).message).toContain('safety stop')
  })

  it('consumes a bounded 60-second step without dropping simulated time', () => {
    const flight = setup([earth], snap(), pose([0, 0, 1e9]))
    flight.setThrottle(1e-6)
    advance(flight, 5)
    const before = vector(flight.pose().position)
    flight.update(60, snap(), input)
    expect(vector(flight.pose().position).distanceTo(before)).toBeCloseTo(60e-6 * C_KM_S, 5)
    expect(flight.telemetry(snap()).speedC).toBeCloseTo(1e-6, 12)
  })

  it('arms warp inside an exclusion zone and engages it only after the ship is clear', () => {
    const facingAway: BodyState['rotation'] = [0, 1, 0, 0]
    const flight = setup([earth], snap(), pose([0, 0, 1.5], facingAway))
    flight.setWarp(true)
    expect(flight.telemetry(snap())).toMatchObject({ warp: false, warpArmed: true })
    expect(flight.telemetry(snap()).message).toContain('armed')
    flight.setThrottle(1000)
    expect(flight.telemetry(snap()).throttleC).toBe(WARP_LIMIT_C)
    advance(flight, 5)
    expect(flight.telemetry(snap()).warp).toBe(false)
    expect(flight.telemetry(snap()).speedC * C_KM_S).toBeLessThanOrEqual(0.05 + 1e-9)
    advance(flight, 25)
    expect(flight.telemetry(snap())).toMatchObject({ warp: true, warpArmed: false })
    expect(vector(flight.pose().position).z).toBeGreaterThan(2.25)
    flight.cancel()
    flight.setWarp(false)
    flight.setWarp(true)
    expect(flight.telemetry(snap()).warp).toBe(true)
  })

  it('keeps warp armed past the departure body of a transfer, drops it at the target, and counts the arrival', () => {
    const moon = body('moon')
    const snapshot = snap({ earth: state(), moon: state([0, 0, 1e7]) })
    const flight = setup([earth, moon], snapshot, pose([0, 0, 1.1]))
    flight.setWarp(true)
    flight.setThrottle(1000)
    flight.transfer('moon', snapshot)
    expect(flight.telemetry(snapshot)).toMatchObject({ arrivals: 0, warpArmed: true })
    let sawWarp = false
    for (let i = 0; i < 3000 && flight.telemetry(snapshot).mode !== 'free'; i++) {
      flight.update(0.1, snapshot, input)
      sawWarp ||= flight.telemetry(snapshot).warp
    }
    const telemetry = flight.telemetry(snapshot)
    expect(sawWarp).toBe(true)
    expect(telemetry).toMatchObject({ mode: 'free', arrivals: 1, arrivedId: 'moon', warp: false, warpArmed: false, referenceId: 'moon' })
    expect(telemetry.separationKm).toBeLessThan(1.2)
  })

  it('climbs out and flies around the departure body when the target is behind it', () => {
    const moon = body('moon')
    const snapshot = snap({ earth: state(), moon: state([0, 0, 1000]) })
    const flight = setup([earth, moon], snapshot, pose([0, 0, -1.05]))
    flight.setThrottle(0.001)
    flight.transfer('moon', snapshot)
    let stops = 0
    let lowest = Infinity
    for (let i = 0; i < 6000 && flight.telemetry(snapshot).mode !== 'free'; i++) {
      flight.update(0.1, snapshot, input)
      if (flight.telemetry(snapshot).message.includes('safety stop')) stops++
      lowest = Math.min(lowest, vector(flight.pose().position).length())
    }
    expect(stops).toBe(0)
    expect(lowest).toBeGreaterThan(1.04)
    expect(flight.telemetry(snapshot)).toMatchObject({ mode: 'free', arrivals: 1, arrivedId: 'moon' })
  })

  it('disarms warp when the pilot cancels assistance inside a zone', () => {
    const moon = body('moon')
    const snapshot = snap({ earth: state(), moon: state([0, 0, 1e7]) })
    const flight = setup([earth, moon], snapshot, pose([0, 0, 1.1]))
    flight.setWarp(true)
    flight.setThrottle(1000)
    flight.transfer('moon', snapshot)
    advance(flight, 1, snapshot)
    flight.cancel()
    expect(flight.telemetry(snapshot)).toMatchObject({ warp: false, warpArmed: false, throttleC: NORMAL_LIMIT_C })
  })
})

describe('landing and takeoff', () => {
  it('lands and takes off on the same registered irregular terrain triangles that the renderer draws', () => {
    const rock = { ...body('rock', 3), radii_km: [3, 2, 1] as Vec3 }
    const source: SurfaceProvider = {
      sample(_id, direction) {
        const d = vector(direction)
        const point = d.multiplyScalar(1 / Math.sqrt(d.x ** 2 / 9 + d.y ** 2 / 4 + d.z ** 2))
        return { point: point.toArray() as Vec3, normal: new Vector3(point.x / 9, point.y / 4, point.z).normalize().toArray() as Vec3 }
      },
    }
    const terrain = createTerrainSurface(source, [rock])
    let patch: TerrainPatch | undefined
    const surface: LandingSurfaceProvider = {
      sample: (id, direction) => terrain.sample(id, direction),
      prepareLanding(_id, direction) {
        patch = createTerrainPatch(rock, direction, terrain, { segments: 16 })
      },
    }
    const snapshot = snap({ rock: state() })
    const flight = setup([rock], snapshot, pose([0, 0, 1.2]), surface)
    try {
      flight.land('rock', snapshot)
      for (let i = 0; i < 2000 && flight.telemetry(snapshot).mode !== 'landed'; i++) flight.update(0.05, snapshot, input)
      expect(patch).toBeDefined()
      expect(flight.telemetry(snapshot).mode, JSON.stringify(flight.telemetry(snapshot))).toBe('landed')
      expect(flight.telemetry(snapshot).altitudeKm).toBeCloseTo(CLEARANCE_KM, 4)
      expect(vector(flight.pose().position).length()).toBeLessThan(1.01)
      const revision = terrain.getActivePatch('rock')!.revision
      flight.takeoff(snapshot)
      advance(flight, 4, snapshot)
      expect(flight.telemetry(snapshot).mode).toBe('free')
      expect(flight.telemetry(snapshot).altitudeKm).toBeGreaterThan(0.03)
      expect(terrain.getActivePatch('rock')!.revision).toBe(revision)
    } finally {
      patch?.dispose()
    }
  })

  it('activates and freezes reconstructed terrain before caching the touchdown point', () => {
    const planet = body('earth', 6371, 'planet')
    let prepared = false
    let preparations = 0
    const surface: LandingSurfaceProvider = {
      prepareLanding(id, direction) {
        expect(id).toBe('earth')
        expect(vector(direction).length()).toBeCloseTo(1, 12)
        prepared = true
        preparations++
      },
      sample(_id, direction) {
        const n = vector(direction).normalize()
        return { point: n.clone().multiplyScalar(6371 + (prepared ? 0.005 : 0)).toArray() as Vec3, normal: n.toArray() as Vec3 }
      },
    }
    const flight = setup([planet], snap(), pose([0, 0, 6380]), surface)
    flight.land('earth', snap())
    for (let i = 0; i < 6000 && flight.telemetry(snap()).mode !== 'landed'; i++) flight.update(1 / 60, snap(), input)
    expect(flight.telemetry(snap()).mode).toBe('landed')
    expect(preparations).toBe(1)
    expect(vector(flight.pose().position).length()).toBeCloseTo(6371 + 0.005 + CLEARANCE_KM, 7)
    advance(flight, 2)
    expect(preparations).toBe(1)
    expect(flight.telemetry(snap()).altitudeKm).toBeCloseTo(CLEARANCE_KM, 7)
  })

  it('completes assisted Earth landing from the default 3.5-radius observer within 90 simulated seconds', () => {
    const planet = body('earth', 6371, 'planet')
    const snapshot = snap()
    const flight = setup([planet], snapshot, pose([0, 0, 6371 * 3.5]))
    flight.land('earth', snapshot)
    expect(flight.telemetry(snapshot).throttleC).toBe(0.01)
    let elapsed = 0
    for (; elapsed < 90 && flight.telemetry(snapshot).mode !== 'landed'; elapsed += 1 / 60) {
      flight.update(1 / 60, snapshot, input)
    }
    expect(flight.telemetry(snapshot).mode, JSON.stringify({ elapsed, ...flight.telemetry(snapshot) })).toBe('landed')
    expect(flight.telemetry(snapshot).altitudeKm).toBeCloseTo(CLEARANCE_KM, 5)
    expect(flight.telemetry(snapshot).message).not.toContain('safety stop')
  })

  it('brakes a 1000c Earth-to-Moon landing without spending minutes crossing the exclusion zone', () => {
    const planet = body('earth', 6371, 'planet')
    const moon = body('moon', 1737.4)
    const snapshot = snap({ earth: state(), moon: state([0, 0, 384400]) })
    const flight = setup([planet, moon], snapshot, pose([0, 0, 6371 * 3.5]))
    flight.setWarp(true)
    flight.setThrottle(1000)
    flight.land('moon', snapshot)
    let elapsed = 0
    let leftWarp = false
    for (; elapsed < 60 && flight.telemetry(snapshot).mode !== 'landed'; elapsed += 1 / 60) {
      flight.update(1 / 60, snapshot, input)
      if (!flight.telemetry(snapshot).warp) leftWarp = true
    }
    expect(leftWarp).toBe(true)
    expect(flight.telemetry(snapshot).mode, JSON.stringify({ elapsed, ...flight.telemetry(snapshot) })).toBe('landed')
    expect(flight.telemetry(snapshot).referenceId).toBe('moon')
    expect(flight.telemetry(snapshot).altitudeKm).toBeCloseTo(CLEARANCE_KM, 5)
  })

  it('approaches and lands without requiring manual flight, then takes off smoothly', () => {
    const flight = setup([earth], snap(), pose([0, 0, 2]))
    flight.land('earth', snap())
    for (let i = 0; i < 4000 && flight.telemetry(snap()).mode !== 'landed'; i++) flight.update(0.1, snap(), input)
    expect(flight.telemetry(snap()).mode).toBe('landed')
    expect(flight.telemetry(snap()).altitudeKm).toBeCloseTo(CLEARANCE_KM, 5)
    expect(flight.telemetry(snap()).landingBodyId).toBe('earth')
    expect(flight.telemetry(snap())).toMatchObject({ arrivals: 1, arrivedId: 'earth' })
    const ground = flight.pose()
    flight.takeoff(snap())
    expect(flight.pose()).toEqual(ground)
    flight.update(0.1, snap(), input)
    expect(vector(flight.pose().position).distanceTo(vector(ground.position))).toBeCloseTo(0.001, 7)
    advance(flight, 4)
    expect(flight.telemetry(snap()).mode).toBe('free')
    expect(flight.telemetry(snap()).altitudeKm).toBeGreaterThan(CLEARANCE_KM + 0.02)
  })

  it('climbs out from a Moon-sized body in seconds and estimates the remaining climb', () => {
    const moon = body('moon', 1737.4)
    const snapshot = snap({ moon: state() })
    const flight = setup([moon], snapshot, pose([0, 0, 1737.4 * 1.3]))
    flight.land('moon', snapshot)
    for (let t = 0; t < 120 && flight.telemetry(snapshot).mode !== 'landed'; t += 1 / 60) flight.update(1 / 60, snapshot, input)
    expect(flight.telemetry(snapshot).mode).toBe('landed')
    flight.takeoff(snapshot)
    const estimate = flight.telemetry(snapshot).etaSeconds
    let elapsed = 0
    for (; elapsed < 30 && flight.telemetry(snapshot).mode !== 'free'; elapsed += 1 / 60) flight.update(1 / 60, snapshot, input)
    expect(flight.telemetry(snapshot).mode).toBe('free')
    expect(elapsed).toBeLessThan(6)
    expect(estimate).toBeGreaterThan(elapsed * 0.8)
    expect(estimate).toBeLessThan(elapsed * 1.2)
    expect(flight.telemetry(snapshot).altitudeKm).toBeGreaterThan(1.7)
  })

  it('keeps an irregular landed point and attitude fixed in rotating body coordinates, including dt0', () => {
    const rock = { ...body('rock', 3), radii_km: [3, 2, 1] as Vec3 }
    const surface: SurfaceProvider = {
      sample(_id, direction) {
        const d = vector(direction)
        const p = d.multiplyScalar(1 / Math.sqrt(d.x ** 2 / 9 + d.y ** 2 / 4 + d.z ** 2))
        return { point: p.toArray() as Vec3, normal: new Vector3(p.x / 9, p.y / 4, p.z).normalize().toArray() as Vec3 }
      },
    }
    const original = snap({ rock: state() })
    const flight = setup([rock], original, pose([0, 0, 1.08]), surface)
    flight.land('rock', original)
    for (let i = 0; i < 4000 && flight.telemetry(original).mode !== 'landed'; i++) flight.update(0.1, original, input)
    expect(flight.telemetry(original).mode).toBe('landed')
    const local = vector(flight.pose().position)
    const localQ = new Quaternion(...flight.pose().quaternion)
    const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7)
    const moved = snap({ rock: state([15, 3, -10], [0.2, 0, 0], rotation.toArray() as BodyState['rotation']) }, 5)
    flight.update(5, moved, input)
    expect(vector(flight.pose().position).sub(vector(moved.states.rock!.position)).applyQuaternion(rotation.clone().invert()).distanceTo(local)).toBeLessThan(1e-10)
    expect(new Quaternion(...flight.pose().quaternion).angleTo(rotation.clone().multiply(localQ))).toBeLessThan(1e-6)
    const rotatedPaused = snap({ rock: state([16, 3, -10], [0.2, 0, 0], IDENTITY) }, 6)
    flight.update(0, rotatedPaused, { ...input, lookX: 0.1 })
    expect(vector(flight.pose().position).sub(vector(rotatedPaused.states.rock!.position)).distanceTo(local)).toBeLessThan(1e-10)
    expect(flight.telemetry(rotatedPaused).verticalKmS).toBe(0)
    flight.takeoff(rotatedPaused)
    advance(flight, 4, rotatedPaused)
    expect(flight.telemetry(rotatedPaused).mode).toBe('free')
    expect(flight.telemetry(rotatedPaused).altitudeKm).toBeGreaterThan(0.03)
  })

  it('offers giant atmospheric hover but rejects Sun landing', () => {
    const jupiter = body('jupiter', 10, 'planet')
    const giantSnapshot = snap({ jupiter: state() })
    const flight = setup([jupiter], giantSnapshot, pose([0, 0, 12]))
    flight.land('jupiter', giantSnapshot)
    for (let i = 0; i < 4000 && flight.telemetry(giantSnapshot).mode !== 'hover'; i++) flight.update(0.1, giantSnapshot, input)
    expect(flight.telemetry(giantSnapshot).mode).toBe('hover')
    expect(flight.telemetry(giantSnapshot).altitudeKm).toBeCloseTo(1, 6)
    expect(flight.telemetry(giantSnapshot).message).toContain('simulated atmospheric')
    const sun = body('sun', 10, 'star')
    const solarSnapshot = snap({ sun: state() })
    const sunFlight = setup([sun], solarSnapshot)
    sunFlight.land('sun', solarSnapshot)
    expect(sunFlight.telemetry(solarSnapshot).mode).toBe('free')
    expect(sunFlight.telemetry(solarSnapshot).message).toContain('no landing')
  })

  it('lands on a translating, rotating oblate body using its local normal throughout descent', () => {
    const oblate = { ...body('earth', 3), radii_km: [3, 2, 3] as Vec3 }
    const surface: SurfaceProvider = {
      sample(_id, direction) {
        const d = vector(direction)
        const p = d.multiplyScalar(1 / Math.sqrt(d.x ** 2 / 9 + d.y ** 2 / 4 + d.z ** 2 / 9))
        return { point: p.toArray() as Vec3, normal: new Vector3(p.x / 9, p.y / 4, p.z / 9).normalize().toArray() as Vec3 }
      },
    }
    const original = snap({ earth: state([0, 0, 0], [0.03, 0.01, 0]) })
    const flight = setup([oblate], original, pose([0, 2, 2]), surface)
    flight.land('earth', original)
    let snapshot = original
    for (let i = 1; i <= 4000 && flight.telemetry(snapshot).mode !== 'landed'; i++) {
      const t = i * 0.1
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), t * 0.001)
      snapshot = snap({ earth: state([0.03 * t, 0.01 * t, 0], [0.03, 0.01, 0], q.toArray() as BodyState['rotation']) }, t)
      flight.update(0.1, snapshot, input)
    }
    expect(flight.telemetry(snapshot).mode, JSON.stringify(flight.telemetry(snapshot))).toBe('landed')
    expect(flight.telemetry(snapshot).altitudeKm).toBeCloseTo(CLEARANCE_KM, 4)
    const local = vector(flight.pose().position).sub(vector(snapshot.states.earth!.position))
      .applyQuaternion(new Quaternion(...snapshot.states.earth!.rotation).invert())
    const hit = surface.sample('earth', local.clone().normalize().toArray() as Vec3)!
    const upLocal = new Vector3(0, 1, 0).applyQuaternion(new Quaternion(...flight.pose().quaternion))
      .applyQuaternion(new Quaternion(...snapshot.states.earth!.rotation).invert())
    expect(upLocal.dot(vector(hit.normal))).toBeGreaterThan(0.9999)
  })

  it('does not invent a landing surface when source geometry is unavailable', () => {
    const flight = setup([earth], snap(), pose([0, 0, 2]), { sample: () => null })
    flight.land('earth', snap())
    expect(flight.telemetry(snap()).mode).toBe('free')
    expect(flight.telemetry(snap()).message).toContain('source geometry')
    expect(flight.telemetry(snap()).message).toContain('catalog-radius estimate')
    expect(flight.telemetry(snap()).altitudeKm).toBe(1)
    flight.land('missing', snap())
    expect(flight.telemetry(snap()).message).toContain('unavailable')
  })
})
