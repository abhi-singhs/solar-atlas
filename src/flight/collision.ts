import { Quaternion, Vector3 } from 'three'
import { bodyRadius } from '../contracts'
import type { Body, BodyState, Snapshot, SurfaceHit, SurfaceProvider, Vec3 } from '../contracts'

export const CLEARANCE_KM = 0.003
export const finiteVector = (v: readonly number[]): boolean => v.length === 3 && v.every(Number.isFinite)
export const vector = (v: Vec3): Vector3 => new Vector3(...v)
export const tuple = (v: Vector3): Vec3 => [v.x, v.y, v.z]
export const rotation = (state: BodyState): Quaternion => {
  const q = new Quaternion(...state.rotation)
  return state.rotation.every(Number.isFinite) && q.lengthSq() > 0 ? q.normalize() : new Quaternion()
}

export function stateAt(a: Snapshot, b: Snapshot, id: string, t: number): BodyState | undefined {
  const end = b.states[id]
  if (!end || !finiteVector(end.position) || !finiteVector(end.velocity)) return undefined
  const candidate = a.states[id]
  const start = candidate && finiteVector(candidate.position) && finiteVector(candidate.velocity) ? candidate : end
  return {
    position: tuple(vector(start.position).lerp(vector(end.position), t)),
    velocity: tuple(vector(start.velocity).lerp(vector(end.velocity), t)),
    rotation: rotation(start).slerp(rotation(end), t).toArray() as BodyState['rotation'],
  }
}

export function sampleSurface(surface: SurfaceProvider, body: Body, localDirection: Vector3): SurfaceHit | null {
  const direction = localDirection.lengthSq() > 1e-20 ? localDirection.clone().normalize() : new Vector3(0, 1, 0)
  try {
    const hit = surface.sample(body.id, tuple(direction))
    if (!hit || !finiteVector(hit.point) || !finiteVector(hit.normal)) return null
    if (vector(hit.point).lengthSq() < 1e-20 || vector(hit.normal).lengthSq() < 1e-20) return null
    const normal = vector(hit.normal).normalize()
    if (normal.dot(direction) < 0) normal.negate()
    return { point: [...hit.point], normal: tuple(normal) }
  } catch {
    return null
  }
}

export function zoneAltitude(body: Body): number {
  return Math.max(1, bodyRadius(body) * 0.2)
}

export function approachSpeed(body: Body): number {
  return Math.max(0.02, Math.min(1000, bodyRadius(body) * 0.05))
}

// Solve in closest-point form to avoid subtracting two nearly equal quadratic roots.
function sphereInterval(start: Vector3, end: Vector3, radius: number): [number, number] | null {
  const d = end.clone().sub(start)
  const length = d.length()
  if (length < 1e-15) return start.length() <= radius ? [0, 1] : null
  const axis = d.multiplyScalar(1 / length)
  const projection = -start.dot(axis)
  const closest = start.clone().addScaledVector(axis, projection).lengthSq()
  const discriminant = radius * radius - closest
  if (discriminant < 0) return null
  const half = Math.sqrt(discriminant)
  const lo = Math.max(0, (projection - half) / length)
  const hi = Math.min(1, (projection + half) / length)
  return lo <= hi ? [lo, hi] : null
}

export interface SweptHit {
  body: Body
  fraction: number
  normal: Vector3
  state: BodyState
  zone: boolean
}

export function sweep(
  bodies: Body[],
  surface: SurfaceProvider,
  start: Vector3,
  end: Vector3,
  before: Snapshot,
  after: Snapshot,
  alpha0: number,
  alpha1: number,
  warp: boolean,
): SweptHit | null {
  let nearest: SweptHit | null = null
  for (const body of bodies) {
    const a = stateAt(before, after, body.id, alpha0)
    const b = stateAt(before, after, body.id, alpha1)
    if (!a || !b) continue
    const r0 = start.clone().sub(vector(a.position))
    const r1 = end.clone().sub(vector(b.position))
    if (warp) {
      const interval = sphereInterval(r0, r1, bodyRadius(body) + zoneAltitude(body))
      if (interval && (!nearest || interval[0] < nearest.fraction)) {
        const fraction = interval[0]
        const state = stateAt(before, after, body.id, alpha0 + (alpha1 - alpha0) * fraction)!
        const normal = start.clone().lerp(end, fraction).sub(vector(state.position)).normalize()
        nearest = { body, fraction, state, normal, zone: true }
      }
    }
    const interval = sphereInterval(r0, r1, bodyRadius(body) * 1.25 + CLEARANCE_KM)
    if (!interval || (nearest && interval[0] > nearest.fraction)) continue
    const signedDistance = (t: number): { distance: number; normal: Vector3; state: BodyState } => {
      const state = stateAt(before, after, body.id, alpha0 + (alpha1 - alpha0) * t)!
      const q = rotation(state)
      const relative = start.clone().lerp(end, t).sub(vector(state.position))
      const local = relative.clone().applyQuaternion(q.clone().invert())
      const hit = sampleSurface(surface, body, local)
      const radius = hit ? vector(hit.point).length() : bodyRadius(body)
      const normal = hit ? vector(hit.normal).applyQuaternion(q) : relative.clone().normalize()
      if (normal.lengthSq() < 1e-20) normal.set(0, 1, 0)
      return { distance: local.length() - radius - CLEARANCE_KM, normal, state }
    }
    const [lo, hi] = interval
    let previous = lo
    const initial = signedDistance(lo)
    let previousDistance = initial.distance
    const relativeTravel = r1.clone().sub(r0).length() + rotation(a).angleTo(rotation(b)) * bodyRadius(body)
    const resolution = Math.max(0.001, Math.min(0.02, bodyRadius(body) * 0.002))
    const samples = Math.max(2, Math.min(48, Math.ceil(relativeTravel * (hi - lo) / resolution)))
    // The samples lie only inside the broadphase interval, even for a 1,000c segment.
    for (let i = 0; i <= samples; i++) {
      const current = lo + (hi - lo) * i / samples
      const value = i === 0 ? initial : signedDistance(current)
      if (value.distance <= 0) {
        let left = previous
        let right = current
        if (previousDistance > 0) {
          for (let j = 0; j < 36; j++) {
            const mid = (left + right) / 2
            if (signedDistance(mid).distance > 0) left = mid
            else right = mid
          }
        }
        const fraction = previousDistance <= 0 ? previous : right
        if (!nearest || fraction < nearest.fraction) {
          const contact = signedDistance(fraction)
          nearest = { body, fraction, normal: contact.normal, state: contact.state, zone: false }
        }
        break
      }
      previous = current
      previousDistance = value.distance
    }
  }
  return nearest
}
