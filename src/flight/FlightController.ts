import { Euler, Matrix4, Quaternion, Vector3 } from 'three'
import { bodyRadius, C_KM_S } from '../contracts'
import type { Body, BodyState, CameraPose, ShipMode, Snapshot, SurfaceHit, SurfaceProvider } from '../contracts'
import type { FlightInput } from '../input/controls'
import {
  approachSpeed, CLEARANCE_KM, finiteVector, rotation, sampleSurface, stateAt, sweep, tuple, vector, zoneAltitude,
} from './collision'

export type { FlightInput } from '../input/controls'

export interface FlightTelemetry {
  mode: ShipMode
  speedC: number
  throttleC: number
  warp: boolean
  referenceId: string
  targetId: string
  altitudeKm: number
  verticalKmS: number
  separationKm: number
  etaSeconds: number
  message: string
  landingBodyId?: string
}

export interface LandingSurfaceProvider extends SurfaceProvider {
  prepareLanding?(bodyId: string, directionLocal: [number, number, number]): void
}

export const NORMAL_LIMIT_C = 0.999999
export const WARP_LIMIT_C = 1000
export const MAX_FLIGHT_DT_SECONDS = 60
const GAS_IDS = new Set(['jupiter', 'saturn', 'uranus', 'neptune'])
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : 0))
const analog = (x: number): number => clamp(x, -1, 1)
const UP = new Vector3(0, 1, 0)
const FORWARD = new Vector3(0, 0, -1)

interface Site {
  bodyId: string
  hit: SurfaceHit
  localQuaternion: Quaternion
  hover: boolean
}

/** Exploration steering in ICRF kilometers. This is not an n-body or relativistic solver. */
export class FlightController {
  private readonly bodies: Body[]
  private readonly surface: LandingSurfaceProvider
  private readonly catalog: Map<string, Body>
  private position = new Vector3()
  private velocity = new Vector3()
  private orientation = new Quaternion()
  private mode: ShipMode = 'free'
  private referenceId = ''
  private targetId = ''
  private throttleC = 0
  private warp = false
  private message = 'Exploration flight. Speeds are relative to the selected reference body.'
  private previous?: Snapshot
  private site?: Site
  private wantsLanding = false
  private braking = false
  private lookYaw = 0
  private lookPitch = 0
  private takeoffHeight = CLEARANCE_KM
  private guidanceVelocity = new Vector3()
  private guidanceVelocityBodyId = ''

  constructor(bodies: Body[], surface: SurfaceProvider) {
    this.bodies = bodies.filter(body => Number.isFinite(bodyRadius(body)) && bodyRadius(body) > 0)
    this.surface = surface
    this.catalog = new Map(this.bodies.map(body => [body.id, body]))
  }

  enter(snapshot: Snapshot, referenceId: string, pose: CameraPose): void {
    const body = this.catalog.get(referenceId)
    const state = snapshot.states[referenceId]
    if (!body || !state || !finiteVector(state.position) || !finiteVector(state.velocity) || !finiteVector(pose.position)) {
      this.message = 'Cannot launch without a valid observer pose and reference body state.'
      return
    }
    this.position.copy(vector(pose.position))
    const q = new Quaternion(...pose.quaternion)
    this.orientation.copy(pose.quaternion.every(Number.isFinite) && q.lengthSq() > 0 ? q.normalize() : new Quaternion())
    this.referenceId = referenceId
    this.velocity.copy(vector(state.velocity))
    this.previous = snapshot
    this.mode = 'free'
    this.site = undefined
    this.targetId = ''
    this.wantsLanding = false
    this.throttleC = 0
    this.warp = false
    this.braking = false
    this.resetLook()
    this.message = 'Flight ready. Flight aids are simulated; body states retain source data.'
    for (const candidate of this.bodies) {
      const candidateState = snapshot.states[candidate.id]
      if (!candidateState) continue
      const qBody = rotation(candidateState)
      const local = this.position.clone().sub(vector(candidateState.position)).applyQuaternion(qBody.clone().invert())
      if (local.lengthSq() < 1e-20) local.set(0, 1, 0)
      const hit = sampleSurface(this.surface, candidate, local)
      const radius = hit ? vector(hit.point).length() : bodyRadius(candidate)
      const clearance = Math.max(0.02, Math.min(10, radius * 0.001))
      if (this.position.distanceTo(vector(candidateState.position)) < radius + clearance) {
        const safe = hit
          ? vector(hit.point).addScaledVector(vector(hit.normal), clearance)
          : local.normalize().multiplyScalar(radius + clearance)
        this.position.copy(safe.applyQuaternion(qBody).add(vector(candidateState.position)))
        this.message = 'Launch pose moved outside the body to provide safe clearance.'
      }
    }
  }

  setThrottle(c: number): void {
    if (!Number.isFinite(c)) {
      this.message = 'Speed command must be a finite number in c.'
      return
    }
    const limit = this.warp ? WARP_LIMIT_C : NORMAL_LIMIT_C
    this.throttleC = clamp(c, 0, limit)
    this.braking = false
    if (c < 0 || c > limit) this.message = `Speed command limited to 0 through ${limit}c.`
  }

  setWarp(enabled: boolean): void {
    if (enabled && this.previous && this.nearBody(this.previous)) {
      this.warp = false
      this.throttleC = Math.min(this.throttleC, NORMAL_LIMIT_C)
      this.message = 'Warp is unavailable inside a body exclusion zone.'
      return
    }
    this.warp = enabled
    if (!enabled) this.throttleC = Math.min(this.throttleC, NORMAL_LIMIT_C)
    this.message = enabled ? 'Fictional warp enabled, maximum 1,000c.' : 'Conventional flight, below c.'
  }

  setReference(referenceId: string): void {
    if (!this.catalog.has(referenceId) || !this.previous?.states[referenceId]) {
      this.message = 'Reference body state is unavailable.'
      return
    }
    this.referenceId = referenceId
  }

  transfer(targetId: string, snapshot: Snapshot): void {
    if (!this.validTarget(targetId, snapshot)) return
    if (this.mode === 'landed' || this.mode === 'hover') {
      this.message = 'Take off before starting a transfer.'
      return
    }
    this.site = undefined
    this.targetId = targetId
    this.wantsLanding = false
    this.mode = 'transfer'
    this.braking = false
    if (this.throttleC === 0) this.throttleC = 0.001
    this.message = 'Assisted transfer. Arrival time estimates target motion, not a solved orbit.'
  }

  land(targetId: string, snapshot: Snapshot): void {
    if (!this.validTarget(targetId, snapshot)) return
    const body = this.catalog.get(targetId)!
    if (body.id.toLowerCase() === 'sun' || body.category.toLowerCase() === 'star') {
      this.message = 'The Sun has no landing or atmospheric hover endpoint.'
      return
    }
    if (this.mode === 'landed' || this.mode === 'hover') {
      this.message = 'Take off before selecting another landing site.'
      return
    }
    const state = snapshot.states[targetId]!
    const local = this.position.clone().sub(vector(state.position)).applyQuaternion(rotation(state).invert())
    if (!this.isGas(body) && !sampleSurface(this.surface, body, local)) {
      this.message = `Load ${body.name}'s source geometry before landing. No spherical landing substitute is used.`
      return
    }
    this.targetId = targetId
    this.wantsLanding = true
    this.site = undefined
    this.mode = 'transfer'
    this.braking = false
    if (this.throttleC === 0) this.throttleC = 0.01
    this.message = this.isGas(body)
      ? 'Approaching a simulated atmospheric hover shell. This body has no solid landing surface.'
      : 'Assisted landing will approach source geometry, align to the terrain normal, and descend.'
  }

  takeoff(snapshot: Snapshot): void {
    if (!this.site || (this.mode !== 'landed' && this.mode !== 'hover')) {
      this.message = 'Takeoff is available after landing or atmospheric hover.'
      return
    }
    this.attach(snapshot, 0)
    this.mode = 'takeoff'
    this.takeoffHeight = this.site.hover ? this.hoverHeight(this.catalog.get(this.site.bodyId)!) : CLEARANCE_KM
    this.throttleC = 0
    this.warp = false
    this.message = 'Taking off along the local terrain normal before releasing flight controls.'
  }

  brake(): void {
    if (this.mode === 'landed' || this.mode === 'hover') return
    this.cancel()
    this.throttleC = 0
    this.braking = true
    this.warp = false
    this.message = 'Braking relative to the active reference body.'
  }

  cancel(): void {
    if (this.mode === 'landed' || this.mode === 'hover') {
      this.message = 'The ship remains body-fixed. Use takeoff to release it.'
      return
    }
    this.mode = 'free'
    this.targetId = ''
    this.site = undefined
    this.wantsLanding = false
    this.message = 'Assistance cancelled. Position and inertial velocity are unchanged.'
  }

  resetLook(): void {
    this.lookYaw = 0
    this.lookPitch = 0
  }

  pose(): CameraPose {
    return { position: tuple(this.position), quaternion: this.orientation.toArray() as CameraPose['quaternion'] }
  }

  camera(kind: 'cockpit' | 'chase'): CameraPose {
    const look = new Quaternion().setFromEuler(new Euler(this.lookPitch, this.lookYaw, 0, 'YXZ'))
    const quaternion = this.orientation.clone().multiply(look)
    const offset = kind === 'chase' ? new Vector3(0, 0.007, 0.02).applyQuaternion(this.orientation) : new Vector3()
    return { position: tuple(this.position.clone().add(offset)), quaternion: quaternion.toArray() as CameraPose['quaternion'] }
  }

  update(dtSimSeconds: number, snapshot: Snapshot, input: FlightInput, renderDtSeconds?: number): void {
    const fallbackLookDt = Number.isFinite(dtSimSeconds) && dtSimSeconds > 0 ? dtSimSeconds : 1 / 60
    const lookScale = clamp(renderDtSeconds ?? fallbackLookDt, 0, 0.05) * 1.5
    this.lookYaw = clamp(this.lookYaw - analog(input.lookX) * lookScale, -Math.PI, Math.PI)
    this.lookPitch = clamp(this.lookPitch + analog(input.lookY) * lookScale, -1.45, 1.45)
    if (!this.previous) {
      this.previous = snapshot
      return
    }
    if (input.brake) this.brake()
    if (!Number.isFinite(dtSimSeconds) || dtSimSeconds < 0 || dtSimSeconds > MAX_FLIGHT_DT_SECONDS) {
      if (this.mode === 'landed' || this.mode === 'hover') this.attach(snapshot, 0)
      this.previous = snapshot
      this.message = `Flight step rejected. Use a forward simulation step of 0 through ${MAX_FLIGHT_DT_SECONDS} seconds.`
      return
    }
    if (this.isAttached()) {
      this.attach(snapshot, dtSimSeconds)
      this.previous = snapshot
      return
    }
    if (dtSimSeconds === 0) {
      this.previous = snapshot
      return
    }
    const steps = Math.max(1, Math.min(120, Math.ceil(dtSimSeconds / 0.5)))
    const h = dtSimSeconds / steps
    const before = this.previous
    for (let i = 0; i < steps; i++) {
      const a0 = i / steps
      const a1 = (i + 1) / steps
      const current = this.interpolate(before, snapshot, a0)
      const next = this.interpolate(before, snapshot, a1)
      if (this.isAttached()) {
        this.attach(next, h)
        continue
      }
      if (this.mode === 'takeoff') {
        this.advanceTakeoff(h, next)
        continue
      }
      const ref = current.states[this.referenceId]
      if (!ref) {
        this.message = 'Flight paused because the reference body state is unavailable.'
        break
      }
      const refVelocity = vector(ref.velocity)
      const auto = this.mode !== 'free'
      let desired: Vector3
      let acceleration: number
      if (auto) {
        const guidance = this.guidance(h, current, next)
        if (!guidance) continue
        desired = guidance.velocity
        acceleration = guidance.acceleration
      } else {
        const steering = new Quaternion().setFromEuler(new Euler(
          analog(input.pitch) * h * 0.9, analog(input.yaw) * h * 0.9, analog(input.roll) * h * 0.9, 'YXZ',
        ))
        this.orientation.multiply(steering).normalize()
        const speed = this.throttleC * C_KM_S
        desired = new Vector3(analog(input.lateral) * 0.03, analog(input.vertical) * 0.03, -speed - analog(input.forward) * 0.03)
          .applyQuaternion(this.orientation).add(refVelocity)
        acceleration = this.braking ? Math.max(0.05, this.velocity.distanceTo(refVelocity) * 2) : Math.max(0.03, speed / 3)
      }
      const nearby = this.nearBody(current)
      if (nearby) {
        if (this.warp) {
          this.warp = false
          this.throttleC = Math.min(NORMAL_LIMIT_C, this.throttleC)
          this.message = 'Warp disengaged inside a body exclusion zone.'
        }
        if (this.mode !== 'landing') {
          const relative = desired.clone().sub(vector(current.states[nearby.id]!.velocity))
          relative.clampLength(0, approachSpeed(nearby))
          desired = relative.add(vector(current.states[nearby.id]!.velocity))
        }
      }
      const previousPosition = this.position.clone()
      const previousVelocity = this.velocity.clone()
      this.velocity.add(desired.clone().sub(this.velocity).clampLength(0, acceleration * h))
      const limit = (this.warp ? WARP_LIMIT_C : NORMAL_LIMIT_C) * C_KM_S
      this.velocity.sub(refVelocity).clampLength(0, limit).add(refVelocity)
      previousVelocity.sub(refVelocity).clampLength(0, limit).add(refVelocity)
      const nextPosition = this.position.clone().addScaledVector(previousVelocity.clone().add(this.velocity), h / 2)
      const collision = sweep(this.bodies, this.surface, this.position, nextPosition, before, snapshot, a0, a1, this.warp)
      if (collision) {
        this.position.lerp(nextPosition, Math.max(0, collision.fraction - 1e-12))
        this.position.addScaledVector(collision.normal, 1e-6)
        // Carry the contact with the translating and rotating body for the unused substep.
        const finalState = next.states[collision.body.id]!
        const localContact = this.position.clone().sub(vector(collision.state.position)).applyQuaternion(rotation(collision.state).invert())
        const contactOffset = localContact.clone().applyQuaternion(rotation(collision.state))
        const finalOffset = localContact.clone().applyQuaternion(rotation(finalState))
        this.position.copy(finalOffset).add(vector(finalState.position))
        this.velocity.copy(vector(finalState.velocity))
        const remainingTime = (1 - collision.fraction) * h
        if (remainingTime > 1e-8) this.velocity.add(finalOffset.clone().sub(contactOffset).multiplyScalar(1 / remainingTime))
        this.referenceId = collision.body.id
        this.warp = false
        this.throttleC = Math.min(this.throttleC, NORMAL_LIMIT_C)
        if (collision.zone) this.message = 'Warp disengaged at a swept body exclusion zone. Approach speed is limited.'
        else {
          if (!auto) this.throttleC = 0
          this.message = 'Surface safety stop. Collision protection prevents crossing the body.'
          if (this.mode === 'landing' && this.site?.bodyId === collision.body.id) {
            const goal = this.sitePosition(this.site, finalState, this.site.hover ? this.hoverHeight(collision.body) : CLEARANCE_KM)
            if (this.position.distanceTo(goal) < 0.01) this.finishLanding(next)
            else {
              this.cancel()
              this.throttleC = 0
              this.message = 'Landing safety stop away from the selected site. Select Land to choose a new local site.'
            }
          }
          else if (!auto) this.braking = true
        }
      } else {
        this.position.copy(nextPosition)
      }
      if (!finiteVector(tuple(this.position)) || !finiteVector(tuple(this.velocity))) {
        this.position.copy(previousPosition)
        this.velocity.set(0, 0, 0)
        this.cancel()
        this.throttleC = 0
        this.message = 'Flight stopped after invalid numerical input.'
        break
      }
    }
    this.previous = snapshot
  }

  telemetry(snapshot: Snapshot): FlightTelemetry {
    const candidateRef = snapshot.states[this.referenceId]
    const ref = candidateRef && finiteVector(candidateRef.velocity) ? candidateRef : undefined
    const speed = this.velocity.clone().sub(ref ? vector(ref.velocity) : new Vector3()).length()
    const candidateTarget = snapshot.states[this.targetId]
    const target = candidateTarget && finiteVector(candidateTarget.position) ? candidateTarget : undefined
    const separation = target ? this.position.distanceTo(vector(target.position)) : 0
    const altitudeBody = this.site?.bodyId ?? (this.targetId || this.referenceId)
    const body = this.catalog.get(altitudeBody)
    const state = snapshot.states[altitudeBody]
    let altitude = 0
    let vertical = 0
    let message = this.message
    if (body && state && finiteVector(state.position) && finiteVector(state.velocity)) {
      const q = rotation(state)
      const local = this.position.clone().sub(vector(state.position)).applyQuaternion(q.clone().invert())
      const hit = sampleSurface(this.surface, body, local)
      if (!hit) message += ' Surface geometry unavailable. Altitude is a catalog-radius estimate, not terrain clearance.'
      altitude = Math.max(0, hit ? local.clone().sub(vector(hit.point)).dot(vector(hit.normal)) : local.length() - bodyRadius(body))
      const normal = hit ? vector(hit.normal).applyQuaternion(q) : local.clone().normalize().applyQuaternion(q)
      vertical = this.velocity.clone().sub(vector(state.velocity)).dot(normal)
      if (this.mode === 'landed' || this.mode === 'hover') vertical = 0
    }
    return {
      mode: this.mode, speedC: speed / C_KM_S, throttleC: this.throttleC, warp: this.warp,
      referenceId: this.referenceId, targetId: this.targetId, altitudeKm: altitude, verticalKmS: vertical,
      separationKm: separation, etaSeconds: this.estimateEta(snapshot),
      message, ...(this.site ? { landingBodyId: this.site.bodyId } : {}),
    }
  }

  private interpolate(before: Snapshot, after: Snapshot, alpha: number): Snapshot {
    const states: Snapshot['states'] = {}
    for (const body of this.bodies) {
      const state = stateAt(before, after, body.id, alpha)
      if (state) states[body.id] = state
    }

    return { jdTdb: before.jdTdb + (after.jdTdb - before.jdTdb) * alpha, states }
  }

  private isAttached(): boolean {
    return this.mode === 'landed' || this.mode === 'hover'
  }

  private estimateEta(snapshot: Snapshot): number {
    if (this.mode === 'free' || this.isAttached()) return 0
    if (this.mode === 'takeoff' && this.site) {
      const body = this.catalog.get(this.site.bodyId)!
      const startHeight = this.site.hover ? this.hoverHeight(body) : CLEARANCE_KM
      const releaseHeight = startHeight + Math.max(0.03, Math.min(2, bodyRadius(body) * 0.001))
      return Math.max(0, releaseHeight - this.takeoffHeight) / 0.01
    }
    const body = this.catalog.get(this.targetId)
    const state = snapshot.states[this.targetId]
    if (!body || !state || !finiteVector(state.position) || !finiteVector(state.velocity)) return 0
    let goal: Vector3
    let targetVelocity = vector(state.velocity)
    if (this.site) {
      const height = this.mode === 'landing'
        ? (this.site.hover ? this.hoverHeight(body) : CLEARANCE_KM)
        : this.siteStandOff(this.site, body)
      goal = this.sitePosition(this.site, state, height)
      if (this.guidanceVelocityBodyId === body.id) targetVelocity = this.guidanceVelocity.clone()
    } else {
      const radial = this.position.clone().sub(vector(state.position)).normalize()
      if (radial.lengthSq() < 1e-20) radial.copy(UP)
      goal = vector(state.position).addScaledVector(radial, bodyRadius(body) + Math.max(0.05, bodyRadius(body) * 0.05))
    }
    const remaining = goal.sub(this.position)
    const distance = remaining.length()
    if (distance < 1e-12) return 0
    const closingSpeed = this.velocity.clone().sub(targetVelocity).dot(remaining.multiplyScalar(1 / distance))
    return closingSpeed > 1e-12 ? Math.min(Number.MAX_VALUE, distance / closingSpeed) : 0
  }

  private validTarget(id: string, snapshot: Snapshot): boolean {
    if (!this.catalog.has(id) || !snapshot.states[id] || !finiteVector(snapshot.states[id]!.position) || !finiteVector(snapshot.states[id]!.velocity)) {
      this.message = 'Target body state is unavailable.'
      return false
    }
    return true
  }

  private isGas(body: Body): boolean {
    return GAS_IDS.has(body.id.toLowerCase()) || /gas.?giant|ice.?giant/i.test(body.category)
  }

  private hoverHeight(body: Body): number {
    return Math.max(1, bodyRadius(body) * 0.01)
  }

  private nearBody(snapshot: Snapshot): Body | undefined {
    return this.bodies.find(body => {
      const state = snapshot.states[body.id]
      return state && this.position.distanceTo(vector(state.position)) <= bodyRadius(body) + zoneAltitude(body) + 1e-5
    })
  }

  private selectSite(body: Body, state: BodyState): Site | undefined {
    const q = rotation(state)
    const local = this.position.clone().sub(vector(state.position)).applyQuaternion(q.clone().invert()).normalize()
    if (local.lengthSq() < 1e-20) local.copy(UP)
    const hover = this.isGas(body)
    if (!hover) {
      try {
        this.surface.prepareLanding?.(body.id, tuple(local))
      } catch {
        return undefined
      }
    }
    const hit = hover
      ? { point: tuple(local.clone().multiplyScalar(bodyRadius(body))), normal: tuple(local) }
      : sampleSurface(this.surface, body, local)
    if (!hit) return undefined
    const normal = vector(hit.normal)
    let forward = FORWARD.clone().applyQuaternion(this.orientation).applyQuaternion(q.clone().invert())
    forward.addScaledVector(normal, -forward.dot(normal))
    if (forward.lengthSq() < 1e-10) forward = new Vector3(1, 0, 0).cross(normal)
    if (forward.lengthSq() < 1e-10) forward = new Vector3(0, 0, 1).cross(normal)
    forward.normalize()
    const right = forward.clone().cross(normal).normalize()
    const localQuaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, normal, forward.negate())).normalize()
    return { bodyId: body.id, hit, localQuaternion, hover }
  }

  private sitePosition(site: Site, state: BodyState, height: number): Vector3 {
    return vector(site.hit.point).addScaledVector(vector(site.hit.normal), height).applyQuaternion(rotation(state)).add(vector(state.position))
  }

  private siteStandOff(site: Site, body: Body): number {
    return site.hover ? this.hoverHeight(body) : Math.max(0.03, Math.min(100, bodyRadius(body) * 0.01))
  }

  private guidance(h: number, current: Snapshot, next: Snapshot): { velocity: Vector3; acceleration: number } | undefined {
    const body = this.catalog.get(this.targetId)
    const state = current.states[this.targetId]
    const finalState = next.states[this.targetId]
    if (!body || !state || !finalState) {
      this.cancel()
      this.message = 'Assistance cancelled because target data is unavailable.'
      return undefined
    }
    const center = vector(state.position)
    const radial = this.position.clone().sub(center)
    const distance = radial.length()
    if (radial.lengthSq() < 1e-20) radial.copy(UP)
    radial.normalize()
    const parkingHeight = Math.max(0.05, bodyRadius(body) * 0.05)
    const near = distance < bodyRadius(body) + zoneAltitude(body) * 2
    if (near) {
      this.referenceId = body.id
      this.warp = false
      this.throttleC = Math.min(this.throttleC, NORMAL_LIMIT_C)
      if (this.mode === 'transfer') this.mode = 'approach'
    }
    if (this.wantsLanding && near && !this.site) {
      this.site = this.selectSite(body, state)
      if (!this.site) {
        this.cancel()
        this.message = 'Landing cancelled because source surface geometry is unavailable.'
        return undefined
      }
    }
    let goal = center.clone().addScaledVector(radial, bodyRadius(body) + parkingHeight)
    let goalVelocity = vector(state.velocity)
    if (this.site) {
      const standOff = this.siteStandOff(this.site, body)
      const height = this.mode === 'landing' ? (this.site.hover ? this.hoverHeight(body) : CLEARANCE_KM) : standOff
      goal = this.sitePosition(this.site, state, height)
      goalVelocity = this.sitePosition(this.site, finalState, height).sub(goal).multiplyScalar(1 / h)
      const facing = rotation(state).multiply(this.site.localQuaternion)
      this.orientation.rotateTowards(facing, h * 1.2)
      if (this.mode === 'approach' && this.position.distanceTo(goal) < Math.max(0.01, Math.min(0.1, approachSpeed(body) * h * 2))) {
        this.mode = 'landing'
        this.message = this.site.hover ? 'Matching the simulated atmospheric hover shell.' : 'Final descent. Ground attitude follows the available approximate body orientation.'
      }
    }
    this.guidanceVelocity.copy(goalVelocity)
    this.guidanceVelocityBodyId = body.id
    const delta = goal.clone().sub(this.position)
    const remaining = delta.length()
    const commandSpeed = this.throttleC * C_KM_S
    const acceleration = Math.max(0.1, commandSpeed / 3)
    if (this.mode === 'landing' && this.site) {
      const threshold = this.site.hover ? 0.01 : 0.0005
      if (remaining <= threshold && this.velocity.distanceTo(goalVelocity) < 0.03) {
        this.finishLanding(next)
        return undefined
      }
      const descentLimit = Math.max(0.02, Math.min(100, approachSpeed(body) * 0.3))
      const descentAcceleration = Math.max(0.1, descentLimit * 2)
      const descent = Math.min(descentLimit, Math.max(0.0002, remaining * 0.7), Math.sqrt(2 * descentAcceleration * remaining))
      return { velocity: goalVelocity.add(delta.normalize().multiplyScalar(Math.min(descent, remaining / h))), acceleration: descentAcceleration }
    }
    if (!this.wantsLanding && remaining < Math.max(0.01, Math.min(0.05, approachSpeed(body) * h))) {
      this.referenceId = body.id
      this.throttleC = 0
      this.velocity.copy(vector(finalState.velocity))
      this.mode = 'free'
      this.message = `Arrived near ${body.name}. Position is not a computed orbit.`
      return { velocity: this.velocity.clone(), acceleration }
    }
    const brakingDistance = Math.max(0, distance - bodyRadius(body) - zoneAltitude(body))
    const stepImpulse = acceleration * h
    const approachLimit = approachSpeed(body)
    const safeCruiseSpeed = Math.sqrt(stepImpulse ** 2 + approachLimit ** 2 + 2 * acceleration * brakingDistance) - stepImpulse
    const finalApproachSpeed = Math.sqrt(stepImpulse ** 2 + 2 * acceleration * remaining) - stepImpulse
    let speed = Math.min(commandSpeed, finalApproachSpeed, remaining * 0.8, Math.max(approachLimit, safeCruiseSpeed))
    if (near) speed = Math.min(speed, approachSpeed(body))
    if (!this.site && remaining > 0) {
      // Desired velocity already includes the target's velocity, so aim straight at the goal in the target's frame.
      // Leading by the ship's own velocity cancels the aim vector at high speed and makes the nose flip every frame.
      delta.copy(this.avoidObstacles(delta, body, current))
      this.orientation.rotateTowards(new Quaternion().setFromUnitVectors(FORWARD, delta), h * 1.2)
    }
    return { velocity: goalVelocity.add(delta.normalize().multiplyScalar(speed)), acceleration }
  }

  /** Returns a unit course that grazes the nearest other body's exclusion sphere blocking the straight path to the goal. */
  private avoidObstacles(delta: Vector3, target: Body, snapshot: Snapshot): Vector3 {
    const distance = delta.length()
    const aim = delta.clone().multiplyScalar(1 / distance)
    let entry = distance
    let course = aim
    for (const obstacle of this.bodies) {
      const state = obstacle.id === target.id ? undefined : snapshot.states[obstacle.id]
      if (!state) continue
      const offset = vector(state.position).sub(this.position)
      const range = offset.length()
      const radius = (bodyRadius(obstacle) + zoneAltitude(obstacle)) * 1.05
      const along = offset.dot(aim)
      if (along <= 0 || range < 1e-12 || offset.clone().sub(delta).length() <= radius) continue
      const miss = Math.sqrt(Math.max(0, range * range - along * along))
      if (miss >= radius) continue
      const reach = Math.max(0, along - Math.sqrt(radius * radius - miss * miss))
      if (reach >= entry) continue
      const toward = offset.multiplyScalar(1 / range)
      const side = aim.clone().addScaledVector(toward, -aim.dot(toward))
      if (side.lengthSq() < 1e-18) side.crossVectors(toward, Math.abs(toward.y) < 0.9 ? UP : new Vector3(1, 0, 0))
      side.normalize()
      const angle = range > radius ? Math.asin(radius / range) : Math.PI / 2
      entry = reach
      course = toward.multiplyScalar(Math.cos(angle)).addScaledVector(side, Math.sin(angle))
    }
    return course
  }

  private finishLanding(snapshot: Snapshot): void {
    if (!this.site) return
    this.mode = this.site.hover ? 'hover' : 'landed'
    this.referenceId = this.site.bodyId
    this.throttleC = 0
    this.warp = false
    this.wantsLanding = false
    this.attach(snapshot, 0)
    this.message = this.site.hover
      ? 'Body-fixed simulated atmospheric hover. No solid surface or measured weather is modeled.'
      : 'Landed on source geometry plus labeled reconstructed relief. Body-fixed attitude uses the source orientation approximation.'
  }

  private attach(snapshot: Snapshot, dt: number): void {
    if (!this.site) return
    const state = snapshot.states[this.site.bodyId]
    const body = this.catalog.get(this.site.bodyId)
    if (!state || !body) return
    const old = this.position.clone()
    const height = this.site.hover ? this.hoverHeight(body) : CLEARANCE_KM
    this.position.copy(this.sitePosition(this.site, state, height))
    this.orientation.copy(rotation(state).multiply(this.site.localQuaternion)).normalize()
    this.velocity.copy(dt > 0 ? this.position.clone().sub(old).multiplyScalar(1 / dt) : vector(state.velocity))
  }

  private advanceTakeoff(h: number, snapshot: Snapshot): void {
    const site = this.site
    if (!site) {
      this.mode = 'free'
      return
    }
    const body = this.catalog.get(site.bodyId)!
    const state = snapshot.states[site.bodyId]
    if (!state) return
    const old = this.position.clone()
    const startHeight = site.hover ? this.hoverHeight(body) : CLEARANCE_KM
    const releaseHeight = startHeight + Math.max(0.03, Math.min(2, bodyRadius(body) * 0.001))
    this.takeoffHeight = Math.min(releaseHeight, this.takeoffHeight + h * 0.01)
    this.position.copy(this.sitePosition(site, state, this.takeoffHeight))
    this.velocity.copy(this.position.clone().sub(old).multiplyScalar(1 / h))
    this.orientation.copy(rotation(state).multiply(site.localQuaternion))
    if (this.takeoffHeight >= releaseHeight) {
      this.mode = 'free'
      this.targetId = ''
      this.site = undefined
      this.throttleC = 0
      this.message = 'Takeoff complete. Manual flight controls released with terrain clearance.'
    }
  }
}
