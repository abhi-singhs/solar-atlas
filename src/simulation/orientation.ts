import type { Quat } from '../contracts'
import type { OrientationCatalog, RingPoles } from '../data/types'

export const UNKNOWN_ORIENTATION_WARNING =
  'No supported pole or absolute phase. Identity is a display-coordinate convention, not a measured attitude.'

function polynomial(coefficients: number[], argument: number): number {
  let result = 0
  for (let i = coefficients.length - 1; i >= 0; i--) result = result * argument + coefficients[i]
  return result
}

export function multiplyQuaternion(a: Quat, b: Quat): Quat {
  const [x, y, z, w] = a
  const [i, j, k, r] = b
  return [w * i + x * r + y * k - z * j, w * j - x * k + y * r + z * i,
    w * k + x * j - y * i + z * r, w * r - x * i - y * j - z * k]
}

export function poleQuaternion(ra: number, dec: number, meridian = 0): Quat {
  const a = ((ra + 90) % 360) * Math.PI / 360
  const b = ((90 - dec) % 360) * Math.PI / 360
  const c = (meridian % 360) * Math.PI / 360
  const q = multiplyQuaternion(multiplyQuaternion(
    [0, 0, Math.sin(a), Math.cos(a)], [Math.sin(b), 0, 0, Math.cos(b)],
  ), [0, 0, Math.sin(c), Math.cos(c)])
  const length = Math.hypot(...q)
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length]
}

export function bodyRotation(
  id: string, jd: number, orientations: OrientationCatalog, ringPoles: RingPoles,
): Quat {
  if (!Number.isFinite(jd)) throw new RangeError('Orientation epoch must be finite')
  const model = orientations.bodies[id]
  if (model) {
    const days = jd - model.epoch_jd_tdb
    return poleQuaternion(
      polynomial(model.pole_ra_deg, days / 36525),
      polynomial(model.pole_dec_deg, days / 36525),
      polynomial(model.prime_meridian_deg, days),
    )
  }
  const pole = ringPoles.poles[id]
  if (pole) return poleQuaternion(pole[0], pole[1])
  return [0, 0, 0, 1]
}

export function orientationStatus(
  id: string, orientations: OrientationCatalog, ringPoles: RingPoles,
): { kind: 'secular' | 'pole-only' | 'unknown'; phaseKnown: boolean; warning: string } {
  const model = orientations.bodies[id]
  if (model) return { kind: 'secular', phaseKnown: true, warning: model.notes }
  if (ringPoles.poles[id]) return { kind: 'pole-only', phaseKnown: false, warning: ringPoles.warning }
  return { kind: 'unknown', phaseKnown: false, warning: UNKNOWN_ORIENTATION_WARNING }
}
