import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { AdditiveBlending } from 'three'
import { AU_KM } from '../src/contracts'
import type { Vec3 } from '../src/contracts'
import {
  J2000_JD, JULIAN_YEAR_DAYS, PARSEC_KM, StarField, apparentStar, daylightExtinction, parseStarCatalog,
  starColor, starDirection, starTemperature, sunGlareFactor, temperatureColor,
} from '../src/render/stars'
import type { StarRow } from '../src/render/stars'
import { SolarRenderer } from '../src/render/SolarRenderer'

const raw = JSON.parse(await readFile('public/assets/stars/bright-star-catalogue.json', 'utf8'))
const catalog = parseStarCatalog(raw)
const star = (hr: number) => catalog.stars.find(row => row[0] === hr)!
const ARCSEC = Math.PI / 648000
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const separation = (a: Vec3, b: Vec3) => Math.atan2(Math.hypot(a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]), dot(a, b))
const sexagesimal = (h: number, m: number, s: number, sign: number, d: number, dm: number, ds: number) =>
  starDirection(15 * (h + m / 60 + s / 3600), sign * (d + dm / 60 + ds / 3600))
const luminance = ([r, g, b]: Vec3) => .2126 * r + .7152 * g + .0722 * b
const SIRIUS = 2491, BETELGEUSE = 2061, RIGEL = 1713, ARCTURUS = 5340, ALPHA_CEN_A = 5459

describe('Bright Star Catalogue package', () => {
  it('keeps every positioned catalog entry and the pinned source checksum', async () => {
    const script = await readFile('scripts/prepare_stars.py', 'utf8')
    expect(catalog.source.sha256).toBe(/SOURCE_SHA256 = "([0-9a-f]{64})"/.exec(script)![1])
    expect(catalog.source.records).toBe(9110)
    expect(catalog.stars).toHaveLength(9096)
    expect(catalog.removed_hr).toHaveLength(14)
    const kept = new Set(catalog.stars.map(row => row[0]))
    expect(catalog.removed_hr.every(hr => !kept.has(hr))).toBe(true)
    expect(catalog.stars.filter(row => row[3] <= 6.5).length).toBeGreaterThan(8400)
    const brightest = catalog.stars.reduce((a, b) => b[3] < a[3] ? b : a)
    expect(brightest[0]).toBe(SIRIUS)
    expect(brightest[3]).toBe(-1.46)
  })

  it('matches independent SIMBAD ICRS J2000 positions within the catalog rounding', () => {
    const reference: [number, Vec3][] = [
      [SIRIUS, sexagesimal(6, 45, 8.917, -1, 16, 42, 58.02)],
      [BETELGEUSE, sexagesimal(5, 55, 10.305, 1, 7, 24, 25.43)],
      [RIGEL, sexagesimal(5, 14, 32.272, -1, 8, 12, 5.90)],
      [ARCTURUS, sexagesimal(14, 15, 39.672, 1, 19, 10, 56.67)],
      [7001, sexagesimal(18, 36, 56.336, 1, 38, 47, 1.28)],
      [424, sexagesimal(2, 31, 49.095, 1, 89, 15, 50.79)],
    ]
    for (const [hr, expected] of reference) {
      const row = star(hr)
      expect(separation(starDirection(row[1], row[2]), expected) / ARCSEC, `HR ${hr}`).toBeLessThan(1.5)
    }
  })

  it('rejects malformed rows instead of drawing them', () => {
    const copy = () => structuredClone(raw)
    const shortRow = copy(); shortRow.stars[0] = shortRow.stars[0].slice(0, 8)
    const reordered = copy(); reordered.stars[1][0] = 1
    const pole = copy(); pole.stars[0][2] = 91
    const columns = copy(); columns.columns.reverse()
    for (const value of [shortRow, reordered, pole, columns]) expect(() => parseStarCatalog(value)).toThrow()
  })
})

describe('apparent star geometry', () => {
  it('propagates proper motion from J2000 over Julian years', () => {
    const row = star(ARCTURUS)
    const start = apparentStar(row, [0, 0, 0], J2000_JD).direction
    const later = apparentStar(row, [0, 0, 0], J2000_JD + 100 * JULIAN_YEAR_DAYS).direction
    expect(separation(start, later) / ARCSEC).toBeCloseTo(100 * Math.hypot(row[5], row[6]), 0)
    const dec = (v: Vec3) => Math.asin(v[2]) / ARCSEC
    const ra = (v: Vec3) => Math.atan2(v[1], v[0]) / ARCSEC
    expect(dec(later) - dec(start)).toBeCloseTo(100 * row[6], 0)
    expect((ra(later) - ra(start)) * Math.cos(row[2] * Math.PI / 180)).toBeCloseTo(100 * row[5], 0)
  })

  it('shifts nearby stars with the observer and brightens them by the inverse square', () => {
    const row = star(ALPHA_CEN_A)
    const home = apparentStar(row, [0, 0, 0], J2000_JD)
    const distanceKm = PARSEC_KM / row[7]!
    const halfway = apparentStar(row, home.direction.map(x => x * distanceKm / 2) as Vec3, J2000_JD)
    expect(separation(halfway.direction, home.direction)).toBeLessThan(1e-12)
    expect(halfway.magnitude - home.magnitude).toBeCloseTo(5 * Math.log10(.5), 9)
    const across: Vec3 = [0, 0, 1000 * AU_KM]
    const lateral = apparentStar(row, across, J2000_JD)
    const perpendicular = Math.hypot(...home.direction.slice(0, 2) as [number, number]) * 1000 * AU_KM
    const expected = Math.atan2(perpendicular, distanceKm - dot(across, home.direction))
    expect(separation(lateral.direction, home.direction) / expected).toBeCloseTo(1, 9)
    const distant = catalog.stars.find(r => r[7] === null)!
    expect(separation(apparentStar(distant, across, J2000_JD).direction, starDirection(distant[1], distant[2]))).toBeLessThan(1e-15)
  })

  it('moves no star more than 40 arcseconds while the observer stays within 50 AU', () => {
    let worst = 0
    for (const row of catalog.stars) {
      const direction = starDirection(row[1], row[2])
      const east = Math.hypot(direction[0], direction[1])
      const across: Vec3 = east > 1e-6 ? [-direction[1] / east * 50 * AU_KM, direction[0] / east * 50 * AU_KM, 0] : [50 * AU_KM, 0, 0]
      worst = Math.max(worst, separation(apparentStar(row, across, J2000_JD).direction, direction) / ARCSEC)
    }
    expect(worst).toBeGreaterThan(30)
    expect(worst).toBeLessThan(40)
  })
})

describe('star photometry', () => {
  it('converts B-V to blackbody color with unit luminance', () => {
    expect(starTemperature(.65)).toBeCloseTo(5778, -1)
    expect(luminance(temperatureColor(5778))).toBeCloseTo(1, 4)
    const sunlike = temperatureColor(5778)
    expect(Math.max(...sunlike) / Math.min(...sunlike)).toBeLessThan(1.25)
    const [r, g, b] = starColor(star(BETELGEUSE)[4])
    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
    const blue = starColor(star(RIGEL)[4])
    expect(blue[2]).toBeGreaterThan(blue[1])
    expect(blue[1]).toBeGreaterThan(blue[0])
    expect(starColor(null)).toEqual([1, 1, 1])
    for (const row of catalog.stars) expect(starColor(row[4]).every(value => Number.isFinite(value) && value >= 0)).toBe(true)
  })

  it('removes stars through twilight and restores them after astronomical twilight', () => {
    expect(daylightExtinction(-30)).toBe(0)
    expect(daylightExtinction(-18)).toBe(0)
    expect(daylightExtinction(-6)).toBe(5)
    expect(daylightExtinction(0)).toBe(9.5)
    expect(daylightExtinction(60)).toBe(12)
    let previous = 0
    for (let altitude = -30; altitude <= 60; altitude += .5) {
      expect(daylightExtinction(altitude)).toBeGreaterThanOrEqual(previous)
      previous = daylightExtinction(altitude)
    }
  })

  it('dims stars with solar glare in proportion to irradiance', () => {
    expect(-2.5 * Math.log10(sunGlareFactor(1, 1))).toBeCloseTo(9, 0)
    expect(sunGlareFactor(1, 0)).toBe(1)
    expect(sunGlareFactor(40, 1)).toBeCloseTo(1 / 3.5, 9)
    expect(sunGlareFactor(1e4, 1)).toBeGreaterThan(.9999)
  })
})

describe('star field buffers', () => {
  it('uploads every star with its direction, motion, parallax, magnitude, and color', () => {
    const field = new StarField(catalog)
    const index = catalog.stars.findIndex(row => row[0] === SIRIUS)
    const row = catalog.stars[index] as StarRow
    const position = field.geometry.getAttribute('position')
    expect(field.count).toBe(9096)
    expect(position.count).toBe(9096)
    starDirection(row[1], row[2]).forEach((value, axis) => expect(position.getComponent(index, axis)).toBeCloseTo(value, 6))
    expect(field.geometry.getAttribute('aMagnitude').getX(index)).toBeCloseTo(-1.46, 6)
    expect(field.geometry.getAttribute('aParallax').getX(index)).toBeCloseTo(.375, 6)
    expect(field.material.depthTest).toBe(false)
    expect(field.material.depthWrite).toBe(false)
    expect(field.material.blending).toBe(AdditiveBlending)
    field.update({ jdTdb: J2000_JD + 27 * JULIAN_YEAR_DAYS, observerKm: [PARSEC_KM, 0, 0], fluxScale: 2, pixelRatio: 1.5 })
    expect(field.material.uniforms.uYears!.value).toBeCloseTo(27, 12)
    expect(field.material.uniforms.uObserverPc!.value.toArray()).toEqual([1, 0, 0])
    expect(field.material.uniforms.uFluxScale!.value).toBe(2)
    expect(field.material.uniforms.uPixelRatio!.value).toBe(1.5)
    field.dispose()
  })
})

describe('renderer sky conditions', () => {
  const radius = 6378.1366
  const sky = (position: Vec3, sun: Vec3, id = 'earth', cloud = 8) => (Object.assign(Object.create(SolarRenderer.prototype), {
    assets: { manifest: { bodies: { [id]: { normalization_radius_km: radius, atmosphere_height_km: 100, cloud_height_km: cloud } } } },
  }) as unknown as { starSkyTransmission: (snapshot: unknown, camera: unknown) => number }).starSkyTransmission({ jdTdb: J2000_JD, states: {
    sun: { position: sun, velocity: [0, 0, 0], rotation: [0, 0, 0, 1] },
    [id]: { position: [0, 0, 0], velocity: [0, 0, 0], rotation: [0, 0, 0, 1] },
  } }, { position, quaternion: [0, 0, 0, 1] })
  const surface: Vec3 = [radius + .002, 0, 0]

  it('hides stars in daylight and restores them at night', () => {
    expect(sky(surface, [AU_KM, 0, 0])).toBeCloseTo(10 ** (-.4 * 12), 12)
    expect(sky(surface, [-AU_KM, 0, 0])).toBe(1)
    expect(sky([radius + 150, 0, 0], [AU_KM, 0, 0])).toBe(1)
    expect(sky(surface, [-AU_KM, 0, 0], 'venus', 65)).toBe(0)
    expect(sky([radius + 70, 0, 0], [-AU_KM, 0, 0], 'venus', 65)).toBe(1)
  })
})
