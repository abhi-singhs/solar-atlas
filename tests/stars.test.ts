import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { AdditiveBlending, Texture } from 'three'
import type { Points, ShaderMaterial, Mesh } from 'three'
import { AU_KM } from '../src/contracts'
import type { Vec3 } from '../src/contracts'
import {
  J2000_JD, JULIAN_YEAR_DAYS, PARSEC_KM, REFERENCE_PIXEL_SOLID_ANGLE, SATURATION_MAGNITUDE, STAR_GAMMA, StarField,
  WHITE_POINT_K, apparentStar, balancedColor, brightStar, colorLut, daylightExtinction, decodeOctahedral, faintStar,
  milkyWayScale, parseBrightStars, parseFaintStars, parseStarManifest, properMotion, starColor, starDirection,
  starExposure, starPeak, starTemperature, sunGlareFactor, temperatureColor,
} from '../src/render/stars'
import type { BrightStar, FaintStars } from '../src/render/stars'
import { SolarRenderer } from '../src/render/SolarRenderer'

const dir = 'public/assets/stars/'
const bytes = async (file: string) => {
  const buffer = await readFile(dir + file)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}
const rawManifest = JSON.parse(await readFile(`${dir}manifest.json`, 'utf8'))
const manifest = parseStarManifest(rawManifest)
const bright = parseBrightStars(await bytes(manifest.bright.file), manifest.bright)
const faint: FaintStars[] = []
for (const record of manifest.faint) faint.push(parseFaintStars(await bytes(record.file), record))
const stars: BrightStar[] = Array.from({ length: bright.count }, (_, i) => brightStar(bright, i))
const hip = (id: number) => stars.find(star => star.id === id)!
const ARCSEC = Math.PI / 648000
const BSC = 2 ** 31
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const separation = (a: Vec3, b: Vec3) => Math.atan2(Math.hypot(a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]), dot(a, b))
const luminance = ([r, g, b]: Vec3) => .2126 * r + .7152 * g + .0722 * b
const SIRIUS = 32349, BETELGEUSE = 27989, RIGEL = 24436, ARCTURUS = 69673, VEGA = 91262, POLARIS = 11767
const ALPHA_CEN_A = 71683

/** The faint-tier star nearest a direction, searched over every file. */
function nearestFaint(target: Vec3) {
  let best = { angle: Infinity, magnitude: 0, bv: null as number | null }
  faint.forEach(tier => {
    for (let i = 0; i < tier.count; i++) {
      const star = faintStar(tier, i, manifest.faint_encoding)
      const angle = separation(star.direction, target)
      if (angle < best.angle) best = { angle, magnitude: star.magnitude, bv: star.bv }
    }
  })
  return best
}

/** SIMBAD ICRS J2000 position moved to the faint-tier epoch with its proper motion in mas per year. */
function atFaintEpoch([ra, dec]: [number, number], pmRa: number, pmDec: number): Vec3 {
  const years = (manifest.faint_epoch_jd - J2000_JD) / JULIAN_YEAR_DAYS
  const m = properMotion(ra, dec, pmRa / 1000, pmDec / 1000)
  const p = starDirection(ra, dec).map((value, i) => value + m[i]! * years)
  const length = Math.hypot(...p)
  return p.map(value => value / length) as Vec3
}

describe('star package', () => {
  it('pins every download in the build script and every output in the manifest', async () => {
    const script = await readFile('scripts/prepare_stars.py', 'utf8')
    expect(Object.keys(manifest.sources)).toHaveLength(24)
    for (const [name, source] of Object.entries(manifest.sources)) expect(script, name).toContain(source.sha256)
    const outputs = [manifest.bright, ...manifest.faint, manifest.milky_way.low, manifest.milky_way.high]
    for (const record of outputs) {
      const raw = await readFile(dir + record.file)
      expect(raw.byteLength, record.file).toBe(record.bytes)
      expect(createHash('sha256').update(raw).digest('hex'), record.file).toBe(record.sha256)
    }
    expect(manifest.milky_way.high).toMatchObject({ width: 4096, height: 2048 })
    expect(manifest.milky_way.low).toMatchObject({ width: 2048, height: 1024 })
  })

  it('keeps Hipparcos stars to V 8 sorted by magnitude, led by Sirius', () => {
    expect(bright.count).toBe(41075)
    expect(bright.epochJd).toBe(2448349.0625)
    for (let i = 1; i < stars.length; i++) expect(stars[i]!.magnitude).toBeGreaterThanOrEqual(stars[i - 1]!.magnitude)
    expect(stars[0]).toMatchObject({ id: SIRIUS, magnitude: expect.closeTo(-1.44, 5) })
    expect(stars.at(-1)!.magnitude).toBeLessThan(8)
    expect(stars.filter(star => star.magnitude <= 6.5).length).toBeGreaterThan(8500)
  })

  it('adds the 18 Bright Star Catalogue stars missing from Hipparcos-2, with Eta Carinae at V 4.30', () => {
    const additions = stars.filter(star => star.id >= BSC).map(star => star.id - BSC).sort((a, b) => a - b)
    expect(additions).toEqual([1704, 1982, 2322, 2341, 2366, 2950, 4210, 4374, 4375, 4619, 4729, 5034, 5343,
      5977, 5978, 6263, 6660, 6848])
    const eta = hip(BSC + 4210)
    expect(eta.magnitude).toBeCloseTo(4.3, 5)
    const seen = apparentStar(eta, [0, 0, 0], J2000_JD, bright.epochJd).direction
    expect(separation(seen, starDirection(161.2647742, -59.6844309)) / ARCSEC).toBeLessThan(1.5)
  })

  it('keeps Tycho-2 and remaining Hipparcos stars to V 11.5 in two magnitude files', () => {
    expect(manifest.faint.map(record => record.count)).toEqual([313311, 1131432])
    expect(faint.reduce((sum, tier) => sum + tier.count, 0)).toBe(1444743)
    const range = (tier: FaintStars) => {
      let lo = Infinity, hi = -Infinity
      for (let i = 0; i < tier.count; i++) {
        const v = manifest.faint_encoding.v_mag.offset + tier.codes[i * 2]! * manifest.faint_encoding.v_mag.step
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
      return [lo, hi]
    }
    const [a, b] = faint.map(range)
    expect(a![1]).toBeLessThanOrEqual(10)
    expect(b![0]).toBeGreaterThanOrEqual(10)
    expect(b![1]).toBeLessThanOrEqual(11.5)
  })

  it('rejects files that do not match the manifest', async () => {
    const copy = () => structuredClone(rawManifest)
    const version = copy(); version.schema_version = 1
    const path = copy(); path.faint[0].file = '../faint-a.bin'
    const sky = copy(); delete sky.milky_way.low
    for (const value of [version, path, sky]) expect(() => parseStarManifest(value)).toThrow()
    const raw = await bytes(manifest.bright.file)
    expect(() => parseBrightStars(raw.slice(0, raw.byteLength - 40), manifest.bright)).toThrow()
    const renamed = raw.slice(0)
    new Uint8Array(renamed)[7] = 0x30
    expect(() => parseBrightStars(renamed, manifest.bright)).toThrow()
    const invalid = raw.slice(0)
    new Float32Array(invalid, 16)[8] = Number.NaN
    expect(() => parseBrightStars(invalid, manifest.bright)).toThrow()
    const tycho = await bytes(manifest.faint[0]!.file)
    expect(() => parseFaintStars(tycho.slice(0, tycho.byteLength - 6), manifest.faint[0]!)).toThrow()
    expect(() => parseFaintStars(tycho, manifest.faint[1]!)).toThrow()
  })
})

describe('star positions', () => {
  it('matches independent SIMBAD ICRS J2000 positions for Hipparcos stars', () => {
    const reference: [number, [number, number]][] = [
      [SIRIUS, [101.2871553333, -16.7161158611]],
      [BETELGEUSE, [88.7929389908, 7.4070639953]],
      [RIGEL, [78.6344670669, -8.2016383647]],
      [ARCTURUS, [213.9153002949, 19.1824091615]],
      [VEGA, [279.2347347870, 38.7836889562]],
      [POLARIS, [37.9545606702, 89.2641089699]],
    ]
    for (const [id, [ra, dec]] of reference) {
      const seen = apparentStar(hip(id), [0, 0, 0], J2000_JD, bright.epochJd).direction
      expect(separation(seen, starDirection(ra, dec)) / ARCSEC, `HIP ${id}`).toBeLessThan(.1)
    }
  })

  it('places high proper-motion faint stars at the faint-tier epoch within the direction quantization', () => {
    const reference: [string, [number, number], number, number, number][] = [
      ['Barnard', [269.4520769586, 4.6933649666], -801.551, 10362.394, 9.5],
      ['Proxima Centauri', [217.4289422216, -62.6794901891], -3781.741, 769.465, 11],
      ['Kapteyn', [77.9191243315, -45.0184338152], 6491.223, -5708.614, 8.9],
      ['Ross 128', [176.9349886173, 0.8045556493], 607.299, -1223.028, 11.1],
    ]
    for (const [name, position, pmRa, pmDec, v] of reference) {
      const found = nearestFaint(atFaintEpoch(position, pmRa, pmDec))
      expect(found.angle / ARCSEC, name).toBeLessThan(8)
      expect(found.magnitude, name).toBeCloseTo(v, 0)
      expect(found.bv!, name).toBeGreaterThan(1.4)
    }
  })

  it('decodes octahedral directions to unit vectors on both hemispheres', () => {
    const close = (actual: Vec3, expected: Vec3) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 12))
    close(decodeOctahedral(65535, 32767.5), [1, 0, 0])
    close(decodeOctahedral(32767.5, 32767.5), [0, 0, 1])
    close(decodeOctahedral(0, 0), [0, 0, -1])
    close(decodeOctahedral(65535, 65535), [0, 0, -1])
    for (let i = 0; i < 1000; i++) {
      const v = decodeOctahedral(faint[1]!.octahedral[i * 2]!, faint[1]!.octahedral[i * 2 + 1]!)
      expect(Math.hypot(...v)).toBeCloseTo(1, 12)
    }
  })

  it('propagates Hipparcos proper motion over Julian years', () => {
    const star = hip(ARCTURUS)
    const start = apparentStar(star, [0, 0, 0], J2000_JD, bright.epochJd).direction
    const later = apparentStar(star, [0, 0, 0], J2000_JD + 100 * JULIAN_YEAR_DAYS, bright.epochJd).direction
    expect(Math.hypot(...star.motion) / ARCSEC).toBeCloseTo(2.279, 3)
    expect(separation(start, later) / ARCSEC).toBeCloseTo(227.9, 0)
  })

  it('shifts nearby stars with the observer and brightens them by the inverse square', () => {
    const star = hip(ALPHA_CEN_A)
    expect(star.parallax).toBeCloseTo(.7548, 4)
    const home = apparentStar(star, [0, 0, 0], bright.epochJd, bright.epochJd)
    const distanceKm = PARSEC_KM / star.parallax
    const halfway = apparentStar(star, home.direction.map(x => x * distanceKm / 2) as Vec3, bright.epochJd, bright.epochJd)
    expect(separation(halfway.direction, home.direction)).toBeLessThan(1e-7)
    expect(halfway.magnitude - home.magnitude).toBeCloseTo(5 * Math.log10(.5), 5)
    const across: Vec3 = [0, 0, 1000 * AU_KM]
    const lateral = apparentStar(star, across, bright.epochJd, bright.epochJd)
    const perpendicular = Math.hypot(home.direction[0], home.direction[1]) * 1000 * AU_KM
    const expected = Math.atan2(perpendicular, distanceKm - dot(across, home.direction))
    expect(separation(lateral.direction, home.direction) / expected).toBeCloseTo(1, 4)
    const distant = stars.find(s => s.parallax === 0)!
    expect(separation(apparentStar(distant, across, bright.epochJd, bright.epochJd).direction, distant.direction)).toBeLessThan(1e-7)
  })

  it('moves no Hipparcos star more than 40 arcseconds while the observer stays within 50 AU', () => {
    let worst = 0
    for (const star of stars) {
      const d = star.direction
      const east = Math.hypot(d[0], d[1])
      const across: Vec3 = east > 1e-6 ? [-d[1] / east * 50 * AU_KM, d[0] / east * 50 * AU_KM, 0] : [50 * AU_KM, 0, 0]
      worst = Math.max(worst, separation(apparentStar(star, across, bright.epochJd, bright.epochJd).direction, d) / ARCSEC)
    }
    expect(worst).toBeGreaterThan(35)
    expect(worst).toBeLessThan(40)
  })
})

describe('star photometry', () => {
  it('converts B-V to blackbody color under the camera white balance', () => {
    expect(starTemperature(.65)).toBeCloseTo(5778, -1)
    expect(luminance(temperatureColor(5778))).toBeCloseTo(1, 4)
    balancedColor(temperatureColor(WHITE_POINT_K)).forEach(value => expect(value).toBeCloseTo(1, 6))
    expect(luminance(balancedColor(temperatureColor(3000)))).toBeCloseTo(1, 6)
    const [r, g, b] = starColor(hip(BETELGEUSE).bv)
    expect(r).toBeGreaterThan(g)
    expect(g).toBeGreaterThan(b)
    const blue = starColor(hip(RIGEL).bv)
    expect(blue[2]).toBeGreaterThan(blue[1])
    expect(blue[1]).toBeGreaterThan(blue[0])
    expect(starColor(null)).toEqual([1, 1, 1])
    for (const star of stars) expect(starColor(star.bv).every(value => Number.isFinite(value) && value >= 0)).toBe(true)
  })

  it('builds a 256-entry color table with white for missing colors', () => {
    const lut = colorLut(manifest.faint_encoding.b_v)
    const data = lut.image.data as Float32Array
    expect(lut.image.width).toBe(256)
    expect(Array.from(data.slice(255 * 4, 256 * 4))).toEqual([1, 1, 1, 1])
    expect(data.every(Number.isFinite)).toBe(true)
    expect(data[2]).toBeGreaterThan(data[0]!)
    expect(data[250 * 4]).toBeGreaterThan(data[250 * 4 + 2]!)
    lut.dispose()
  })

  it('saturates a star of the saturation magnitude at the reference pixel scale', () => {
    expect(starExposure(1, REFERENCE_PIXEL_SOLID_ANGLE)).toBe(1)
    expect(starPeak(SATURATION_MAGNITUDE)).toBeCloseTo(1, 12)
    expect(starPeak(SATURATION_MAGNITUDE + 2.5)).toBeCloseTo(.1 ** STAR_GAMMA, 12)
    expect(starPeak(SATURATION_MAGNITUDE, 4)).toBeCloseTo(4 ** STAR_GAMMA, 12)
  })

  it('splits the zoom between star and Milky Way brightness', () => {
    expect(starExposure(1, REFERENCE_PIXEL_SOLID_ANGLE / 4)).toBeCloseTo(2, 12)
    expect(starExposure(2, REFERENCE_PIXEL_SOLID_ANGLE * 4)).toBeCloseTo(1, 12)
    const sky = (solidAngle: number) => milkyWayScale(starExposure(1, solidAngle) * solidAngle)
    expect(sky(REFERENCE_PIXEL_SOLID_ANGLE * 4) / sky(REFERENCE_PIXEL_SOLID_ANGLE)).toBeCloseTo(2, 12)
    expect(milkyWayScale(2) / milkyWayScale(1)).toBeCloseTo(2, 12)
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

describe('star field scene', () => {
  it('uploads both tiers and drives exposure, motion, and the Milky Way from one frame', () => {
    const field = new StarField(manifest)
    const object = <T>(name: string) => field.scene.getObjectByName(name) as T
    const sky = object<Mesh<never, ShaderMaterial>>('NASA SVS Milky Way')
    expect(sky.visible).toBe(false)
    field.setBright(bright)
    field.setFaint(0, faint[0]!)
    field.setFaint(1, faint[1]!)
    expect(field.brightCount).toBe(41075)
    expect(field.faintCount).toBe(1444743)
    const points = object<Points<never, ShaderMaterial>>('Hipparcos stars')
    const sirius = stars.findIndex(star => star.id === SIRIUS)
    const position = points.geometry.getAttribute('position')
    hip(SIRIUS).direction.forEach((value, axis) => expect(position.getComponent(sirius, axis)).toBeCloseTo(value, 6))
    expect(points.geometry.getAttribute('aMagnitude').getX(sirius)).toBeCloseTo(-1.44, 5)
    expect(points.geometry.getAttribute('aParallax').getX(sirius)).toBeCloseTo(.3792, 4)
    for (const material of [points.material, object<Points<never, ShaderMaterial>>('Tycho-2 stars 1').material]) {
      expect(material.depthTest).toBe(false)
      expect(material.depthWrite).toBe(false)
      expect(material.blending).toBe(AdditiveBlending)
    }
    field.setMilkyWay('low', new Texture())
    const frame = { jdTdb: bright.epochJd + 27 * JULIAN_YEAR_DAYS, observerKm: [PARSEC_KM, 0, 0] as Vec3,
      fluxScale: 2, visibility: .25, pixelRatio: 1.5, pixelSolidAngle: REFERENCE_PIXEL_SOLID_ANGLE / 4, quality: 'low' as const }
    field.update(frame)
    const u = points.material.uniforms
    expect(u.uYears!.value).toBeCloseTo(27, 12)
    expect(u.uObserverPc!.value.toArray()).toEqual([1, 0, 0])
    expect(u.uFluxScale!.value).toBeCloseTo(4 * .25 ** (1 / STAR_GAMMA), 12)
    expect(u.uPixelRatio!.value).toBe(1.5)
    expect(object<Points>('Tycho-2 stars 2').visible).toBe(false)
    expect(sky.visible).toBe(true)
    expect(sky.material.uniforms.uScale!.value).toBeCloseTo(milkyWayScale(4 * REFERENCE_PIXEL_SOLID_ANGLE / 4) * .25, 12)
    field.update({ ...frame, quality: 'high' })
    expect(object<Points>('Tycho-2 stars 2').visible).toBe(true)
    expect(sky.material.uniforms.uMap!.value).toBeInstanceOf(Texture)
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
