import type { Vec3 } from '../contracts'
import type { PackedTrack } from '../data/types'

export function assertCoverage(jd: number, firstJd: number, lastJd: number): void {
  if (!Number.isFinite(jd) || jd < firstJd || jd > lastJd) {
    throw new RangeError(`TDB epoch ${jd} is outside cached coverage [${firstJd}, ${lastJd}]`)
  }
}

export function evaluateTrack(track: PackedTrack, jd: number): { position: Vec3; velocity: Vec3 } {
  assertCoverage(jd, track.firstJd, track.lastJd)
  const { samples: s, count } = track
  const lastOffset = (count - 1) * 7
  if (jd <= s[0]) return sampleAt(s, 0)
  if (jd >= s[lastOffset]) return sampleAt(s, lastOffset)
  let low = 0
  let high = count - 1
  while (high - low > 1) {
    const middle = (low + high) >>> 1
    if (s[middle * 7] <= jd) low = middle
    else high = middle
  }
  const a = low * 7
  const b = high * 7
  if (jd === s[a]) return sampleAt(s, a)
  const h = (s[b] - s[a]) * 86400
  const u = (jd - s[a]) / (s[b] - s[a])
  const u2 = u * u
  const u3 = u2 * u
  const position: Vec3 = [0, 0, 0]
  const velocity: Vec3 = [0, 0, 0]
  for (let axis = 0; axis < 3; axis++) {
    const p0 = s[a + 1 + axis]
    const p1 = s[b + 1 + axis]
    const v0 = s[a + 4 + axis]
    const v1 = s[b + 4 + axis]
    position[axis] = (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * h * v0
      + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * h * v1
    velocity[axis] = (6 * u2 - 6 * u) * (p0 - p1) / h
      + (3 * u2 - 4 * u + 1) * v0 + (3 * u2 - 2 * u) * v1
  }
  return { position, velocity }
}

function sampleAt(samples: Float64Array, offset: number): { position: Vec3; velocity: Vec3 } {
  return {
    position: [samples[offset + 1], samples[offset + 2], samples[offset + 3]],
    velocity: [samples[offset + 4], samples[offset + 5], samples[offset + 6]],
  }
}
