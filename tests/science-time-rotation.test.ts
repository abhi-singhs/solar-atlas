import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Quat, Vec3 } from '../src/contracts'
import { validateCatalog, validateOrientations, validateRingPoles, validateTime } from '../src/data/validate'
import { bodyRotation, orientationStatus, poleQuaternion } from '../src/simulation/orientation'
import { createTimeConverter } from '../src/simulation/time'

const json = (name: string) => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'))
const bodies = validateCatalog(json('catalog.json'))
const orientations = validateOrientations(json('orientations.json'), bodies)
const poles = validateRingPoles(json('ring-poles.json'))
const time = validateTime(json('time.json'))
const converter = createTimeConverter(time)

function rotated(q: Quat, vector: Vec3): Vec3 {
  const [x, y, z, w] = q
  const [a, b, c] = vector
  return [
    (1 - 2 * y * y - 2 * z * z) * a + (2 * x * y - 2 * z * w) * b + (2 * x * z + 2 * y * w) * c,
    (2 * x * y + 2 * z * w) * a + (1 - 2 * x * x - 2 * z * z) * b + (2 * y * z - 2 * x * w) * c,
    (2 * x * z - 2 * y * w) * a + (2 * y * z + 2 * x * w) * b + (1 - 2 * x * x - 2 * y * y) * c,
  ]
}

function expectVector(actual: Vec3, expected: Vec3, precision = 12) {
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], precision))
}

describe('source IAU body-to-ICRF rotations', () => {
  it('uses active Rz(RA+90) Rx(90-dec) Rz(W) without renderer axis swaps', () => {
    for (const [ra, dec, w] of [[0, 90, 0], [0, 0, 0], [286.13, 63.87, 84.176], [12, -30, -25]]) {
      const q = poleQuaternion(ra, dec, w)
      const rad = Math.PI / 180
      const a = (ra + 90) * rad
      const b = (90 - dec) * rad
      const c = w * rad
      const axis: Vec3 = [Math.cos(c), Math.sin(c) * Math.cos(b), Math.sin(c) * Math.sin(b)]
      expectVector(rotated(q, [1, 0, 0]), [
        Math.cos(a) * axis[0] - Math.sin(a) * axis[1],
        Math.sin(a) * axis[0] + Math.cos(a) * axis[1], axis[2],
      ])
      expectVector(rotated(q, [0, 0, 1]), [
        Math.cos(ra * rad) * Math.cos(dec * rad),
        Math.sin(ra * rad) * Math.cos(dec * rad), Math.sin(dec * rad),
      ])
      expect(Math.hypot(...q)).toBeCloseTo(1, 14)
    }
  })

  it('evaluates secular pole centuries and signed prime-meridian days', () => {
    const jd = 2451545 + 36525
    const model = orientations.bodies.venus
    expect(model.prime_meridian_deg[1]).toBeLessThan(0)
    const polynomial = (values: number[], t: number) => values[0] + values[1] * t + values[2] * t * t
    const expected = poleQuaternion(
      polynomial(model.pole_ra_deg, 1), polynomial(model.pole_dec_deg, 1),
      polynomial(model.prime_meridian_deg, 36525),
    )
    expectVector(rotated(bodyRotation('venus', jd, orientations, poles), [1, 0, 0]), rotated(expected, [1, 0, 0]))
    const pole: Vec3 = rotated(bodyRotation('venus', 2451545, orientations, poles), [0, 0, 1])
    const a = rotated(bodyRotation('venus', 2451545, orientations, poles), [1, 0, 0])
    const b = rotated(bodyRotation('venus', 2451546, orientations, poles), [1, 0, 0])
    const cross: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    expect(cross.reduce((sum, value, i) => sum + value * pole[i], 0)).toBeLessThan(0)
    const earth = orientations.bodies.earth
    expectVector(rotated(bodyRotation('earth', jd, orientations, poles), [0, 0, 1]),
      rotated(poleQuaternion(polynomial(earth.pole_ra_deg, 1), polynomial(earth.pole_dec_deg, 1)), [0, 0, 1]))
  })

  it('keeps all three ring-only poles fixed, with unknown phase and no invented spin', () => {
    for (const [id, [ra, dec]] of Object.entries(poles.poles)) {
      const first = bodyRotation(id, 2461288, orientations, poles)
      expect(bodyRotation(id, 2461653, orientations, poles)).toEqual(first)
      expectVector(rotated(first, [0, 0, 1]), rotated(poleQuaternion(ra, dec), [0, 0, 1]))
      expect(orientationStatus(id, orientations, poles)).toMatchObject({ kind: 'pole-only', phaseKnown: false })
    }
    expect(poles.warning).toContain('not a spin model')
    const unknown = bodies.filter(body => !orientations.bodies[body.id] && !poles.poles[body.id])
    expect(unknown).toHaveLength(25)
    for (const body of unknown) {
      expect(bodyRotation(body.id, 2461400, orientations, poles)).toEqual([0, 0, 0, 1])
      expect(orientationStatus(body.id, orientations, poles)).toMatchObject({ kind: 'unknown', phaseKnown: false })
    }
    expect(orientationStatus('earth', orientations, poles).warning).toContain('Not a high-precision Earth')
    expect(() => bodyRotation('earth', NaN, orientations, poles)).toThrow()
  })

  it('retains the source dimensions and rejects corrupt scientific metadata', () => {
    expect(bodies).toEqual(json('catalog.json').bodies)
    const catalog = json('catalog.json')
    catalog.bodies[0].radius_km = 0
    expect(() => validateCatalog(catalog)).toThrow()
    const orientations = json('orientations.json')
    orientations.bodies.earth.prime_meridian_deg[1] = NaN
    expect(() => validateOrientations(orientations, bodies)).toThrow()
    const poles = json('ring-poles.json')
    poles.poles.chariklo[0] = 0
    expect(() => validateRingPoles(poles)).toThrow()
  })
})

describe('pinned UTC and TDB conversion', () => {
  it('reproduces the source UTC boundaries exactly and states the time caveats', () => {
    const metadata = json('provenance.json').main_metadata
    for (const boundary of metadata.utc_boundary_conversion) {
      expect(converter.utcToJd(boundary.utc)).toBe(boundary.jd_tdb)
      expect(converter.jdToUtc(boundary.jd_tdb)).toBe(new Date(boundary.utc).toISOString())
    }
    expect(converter.warning).toContain('37 seconds')
    expect(converter.warning).toContain('30 microseconds')
    expect(converter.warning).toContain('not stored TDB states')
  })

  it.each([
    '1972-01-01T00:00:00Z', '2000-01-01T12:00:00+00:00', '2024-02-29T12:34:56.123Z',
    '2026-09-05T00:00:00.001Z', '2027-09-05T00:00:00Z',
  ])('round-trips %s to UTC millisecond display precision', iso => {
    expect(converter.jdToUtc(converter.utcToJd(iso))).toBe(new Date(iso).toISOString())
  })

  it('keeps TDB continuous through all 27 known positive leap seconds and displays seconds=60', () => {
    for (const leap of time.leaps.slice(1)) {
      const end = converter.utcToJd(leap.utc)
      const midnight = new Date(leap.utc).getTime()
      const beforeIso = new Date(midnight - 1000).toISOString()
      const before = converter.utcToJd(beforeIso)
      expect((end - before) * 86400).toBeCloseTo(2, 3)
      expect(converter.jdToUtc(before)).toBe(beforeIso)
      const during = converter.jdToUtc(end - 0.5 / 86400)
      expect(during).toBe(`${beforeIso.slice(0, 17)}60.500Z`)
      expect(converter.jdToUtc(end)).toBe(new Date(midnight).toISOString())
    }
  })

  it.each([
    '2026-09-05', '2026-09-05T00:00:00', '2026-09-05T00:00:00+05:30',
    '1971-12-31T23:59:59Z', '2016-12-31T23:59:60Z', '2026-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z', '2026-13-01T00:00:00Z', '2026-09-05T24:00:00Z',
    '2026-09-05T00:61:00Z', 'invalid',
  ])('rejects invalid calendar input %s', iso => {
    expect(() => converter.utcToJd(iso)).toThrow()
  })

  it('rejects invalid epochs or changed pinned constants', () => {
    for (const jd of [NaN, Infinity, 2440000, 1e20]) expect(() => converter.jdToUtc(jd)).toThrow()
    expect(() => validateTime({ ...time, K: [0] })).toThrow()
    expect(() => validateTime({ ...time, leaps: [] })).toThrow()
  })
})
