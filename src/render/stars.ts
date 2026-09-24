import {
  AdditiveBlending, BufferAttribute, BufferGeometry, MathUtils, Points, Scene, ShaderMaterial, Vector3,
} from 'three'
import { AU_KM } from '../contracts'
import type { Vec3 } from '../contracts'

export const STAR_CATALOG_PATH = 'assets/stars/bright-star-catalogue.json'
export const J2000_JD = 2451545
export const JULIAN_YEAR_DAYS = 365.25
export const PARSEC_KM = AU_KM * 648000 / Math.PI
/** V magnitude whose point-spread peak reaches display white at 0 EV. Brighter stars widen instead. */
export const SATURATION_MAGNITUDE = 2.5
/** At 1 AU an unobstructed Sun in view dims stars by 2.5 log10(4000), about 9 magnitudes. */
export const SUN_GLARE_AT_1_AU = 4000
const ARCSEC_RAD = Math.PI / 648000
const COLUMNS = ['hr', 'ra_deg', 'dec_deg', 'vmag', 'b_v', 'pmra_arcsec_yr', 'pmdec_arcsec_yr',
  'parallax_arcsec', 'parallax_dynamical']
const MAX_STARS = 10000

/** [HR, RA deg, Dec deg, V, B-V | null, pmRA cos(Dec) arcsec/yr, pmDec arcsec/yr, parallax arcsec | null, dynamical 0 | 1] */
export type StarRow = [number, number, number, number, number | null, number, number, number | null, 0 | 1]

export interface StarCatalog {
  schema_version: 1
  catalog: string
  citation: string
  reference_frame: string
  epoch_jd: number
  source: { url: string; readme: string; sha256: string; bytes: number; records: number }
  removed_hr: number[]
  stars: StarRow[]
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const optional = (value: unknown): value is number | null => value === null || finite(value)

export function parseStarCatalog(value: unknown): StarCatalog {
  const data = value as Partial<StarCatalog> & { columns?: unknown }
  if (!data || typeof data !== 'object' || data.schema_version !== 1 || data.epoch_jd !== J2000_JD
    || JSON.stringify(data.columns) !== JSON.stringify(COLUMNS) || !Array.isArray(data.stars)
    || data.stars.length === 0 || data.stars.length > MAX_STARS || !Array.isArray(data.removed_hr)
    || !data.source || typeof data.source.sha256 !== 'string') {
    throw new Error('Star catalog does not match the Bright Star Catalogue schema')
  }
  let previous = 0
  for (const row of data.stars as unknown[]) {
    if (!Array.isArray(row) || row.length !== COLUMNS.length) throw new Error('Star catalog row has the wrong column count')
    const [hr, ra, dec, vmag, bv, pmRa, pmDec, parallax, dynamical] = row as unknown[]
    if (!Number.isInteger(hr) || (hr as number) <= previous || !finite(ra) || ra < 0 || ra >= 360
      || !finite(dec) || Math.abs(dec) > 90 || !finite(vmag) || vmag < -2 || vmag > 8 || !optional(bv)
      || !finite(pmRa) || !finite(pmDec) || !optional(parallax) || (dynamical !== 0 && dynamical !== 1)) {
      throw new Error(`Star catalog row after HR ${previous} is invalid`)
    }
    previous = hr as number
  }
  return data as StarCatalog
}

export async function loadStarCatalog(url: string): Promise<StarCatalog> {
  const response = await fetch(url, { credentials: 'same-origin', redirect: 'error' })
  if (!response.ok) throw new Error(`Star catalog request failed (${response.status})`)
  return parseStarCatalog(await response.json())
}

/** Unit vector in the ICRF-aligned frame used by the ephemeris and camera. */
export function starDirection(raDeg: number, decDeg: number): Vec3 {
  const a = raDeg * Math.PI / 180, d = decDeg * Math.PI / 180
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)]
}

/** Tangential proper-motion vector in radians per Julian year. */
export function properMotion(raDeg: number, decDeg: number, pmRaArcsecYr: number, pmDecArcsecYr: number): Vec3 {
  const a = raDeg * Math.PI / 180, d = decDeg * Math.PI / 180
  const east = pmRaArcsecYr * ARCSEC_RAD, north = pmDecArcsecYr * ARCSEC_RAD
  return [-Math.sin(a) * east - Math.sin(d) * Math.cos(a) * north,
    Math.cos(a) * east - Math.sin(d) * Math.sin(a) * north, Math.cos(d) * north]
}

/** Only positive parallaxes place a star at a finite distance. */
export function usableParallax(row: StarRow): number {
  return row[7] !== null && row[7] > 0 ? row[7] : 0
}

/**
 * Direction and V magnitude seen from an observer, relative to the catalog's barycentric view.
 * The shader evaluates the same expression in float32.
 */
export function apparentStar(row: StarRow, observerKm: Vec3, jdTdb: number): { direction: Vec3; magnitude: number } {
  const years = (jdTdb - J2000_JD) / JULIAN_YEAR_DAYS
  const direction = starDirection(row[1], row[2])
  const motion = properMotion(row[1], row[2], row[5], row[6])
  const parallax = usableParallax(row)
  const p = direction.map((value, i) => value + motion[i]! * years - observerKm[i]! / PARSEC_KM * parallax)
  const ratio = Math.hypot(p[0]!, p[1]!, p[2]!)
  return { direction: p.map(value => value / ratio) as Vec3, magnitude: row[3] + 5 * Math.log10(ratio) }
}

/** Ballesteros (2012) blackbody temperature for a B-V color index. */
export function starTemperature(bv: number): number {
  const x = 0.92 * MathUtils.clamp(bv, -0.4, 2)
  return 4600 * (1 / (x + 1.7) + 1 / (x + 0.62))
}

/** Linear sRGB of a blackbody with unit luminance, from the Kim et al. (2002) Planckian locus fit. */
export function temperatureColor(kelvin: number): Vec3 {
  const t = MathUtils.clamp(kelvin, 1667, 25000)
  const x = t <= 4000
    ? -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.179910
    : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.240390
  const y = t <= 2222 ? -1.1063814 * x ** 3 - 1.34811020 * x ** 2 + 2.18555832 * x - 0.20219683
    : t <= 4000 ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
      : 3.0817580 * x ** 3 - 5.87338670 * x ** 2 + 3.75112997 * x - 0.37001483
  const X = x / y, Z = (1 - x - y) / y
  return [3.2404542 * X - 1.5371385 - 0.4985314 * Z, -0.9692660 * X + 1.8760108 + 0.0415560 * Z,
    0.0556434 * X - 0.2040259 + 1.0572252 * Z].map(value => Math.max(0, value)) as Vec3
}

/** Stars without a catalog B-V render as the display white point. */
export function starColor(bv: number | null): Vec3 {
  return bv === null ? [1, 1, 1] : temperatureColor(starTemperature(bv))
}

const TWILIGHT: [number, number][] = [[-18, 0], [-12, 2], [-6, 5], [0, 9.5], [10, 12]]
/**
 * Approximate loss of naked-eye limiting magnitude with the Sun's altitude inside an atmosphere.
 * Full darkness at astronomical twilight, first-magnitude stars near the end of civil twilight, none by day.
 */
export function daylightExtinction(sunAltitudeDeg: number): number {
  if (sunAltitudeDeg <= TWILIGHT[0]![0]) return 0
  for (let i = 1; i < TWILIGHT.length; i++) {
    const [h1, m1] = TWILIGHT[i - 1]!, [h2, m2] = TWILIGHT[i]!
    if (sunAltitudeDeg <= h2) return m1 + (m2 - m1) * (sunAltitudeDeg - h1) / (h2 - h1)
  }
  return TWILIGHT.at(-1)![1]
}

/** Flux multiplier while the Sun is in view. Glare follows solar irradiance, so it fades with distance squared. */
export function sunGlareFactor(sunDistanceAu: number, visibility: number): number {
  return 1 / (1 + MathUtils.clamp(visibility, 0, 1) * SUN_GLARE_AT_1_AU / Math.max(sunDistanceAu, 1e-3) ** 2)
}

const vertexShader = `
attribute vec3 aMotion;
attribute float aParallax;
attribute float aMagnitude;
attribute vec3 aColor;
uniform float uYears;
uniform vec3 uObserverPc;
uniform float uFluxScale;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vSigma;
varying float vSize;
void main() {
  vec3 p = position + aMotion * uYears - uObserverPc * aParallax;
  float ratio = length(p);
  float flux = uFluxScale * pow(10.0, -0.4 * (aMagnitude - ${SATURATION_MAGNITUDE.toFixed(1)})) / (ratio * ratio);
  vec3 color = aColor * min(flux, 1.0);
  vColor = color / max(1.0, max(color.r, max(color.g, color.b)));
  vSigma = 0.8 * uPixelRatio * pow(max(flux, 1.0), 0.35);
  vSize = min(64.0, 2.0 * ceil(3.0 * vSigma) + 1.0);
  gl_PointSize = vSize;
  gl_Position = max(vColor.r, max(vColor.g, vColor.b)) < 0.0003
    ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * modelViewMatrix * vec4(p / ratio, 1.0);
}`

const fragmentShader = `
varying vec3 vColor;
varying float vSigma;
varying float vSize;
void main() {
  vec2 offset = (gl_PointCoord - 0.5) * vSize;
  vec3 color = vColor * exp(-dot(offset, offset) / (2.0 * vSigma * vSigma));
  if (max(color.r, max(color.g, color.b)) < 0.0003) discard;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`

export interface StarFrame {
  jdTdb: number
  observerKm: Vec3
  fluxScale: number
  pixelRatio: number
}

/** Background stars from the Bright Star Catalogue. They are scenery, not selectable destinations. */
export class StarField {
  readonly scene = new Scene()
  readonly count: number
  readonly geometry = new BufferGeometry()
  readonly material: ShaderMaterial
  private epochJd: number

  constructor(catalog: StarCatalog) {
    const count = catalog.stars.length
    const direction = new Float32Array(count * 3), motion = new Float32Array(count * 3)
    const parallax = new Float32Array(count), magnitude = new Float32Array(count), color = new Float32Array(count * 3)
    catalog.stars.forEach((row, i) => {
      direction.set(starDirection(row[1], row[2]), i * 3)
      motion.set(properMotion(row[1], row[2], row[5], row[6]), i * 3)
      parallax[i] = usableParallax(row)
      magnitude[i] = row[3]
      color.set(starColor(row[4]), i * 3)
    })
    this.geometry.setAttribute('position', new BufferAttribute(direction, 3))
    this.geometry.setAttribute('aMotion', new BufferAttribute(motion, 3))
    this.geometry.setAttribute('aParallax', new BufferAttribute(parallax, 1))
    this.geometry.setAttribute('aMagnitude', new BufferAttribute(magnitude, 1))
    this.geometry.setAttribute('aColor', new BufferAttribute(color, 3))
    this.material = new ShaderMaterial({ vertexShader, fragmentShader,
      uniforms: { uYears: { value: 0 }, uObserverPc: { value: new Vector3() }, uFluxScale: { value: 1 },
        uPixelRatio: { value: 1 } },
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending, toneMapped: false })
    const points = new Points(this.geometry, this.material)
    points.name = 'Bright Star Catalogue'
    points.frustumCulled = false
    this.scene.add(points)
    this.count = count
    this.epochJd = catalog.epoch_jd
  }

  update(frame: StarFrame): void {
    const u = this.material.uniforms
    u.uYears!.value = (frame.jdTdb - this.epochJd) / JULIAN_YEAR_DAYS
    u.uObserverPc!.value.set(...frame.observerKm).divideScalar(PARSEC_KM)
    u.uFluxScale!.value = frame.fluxScale
    u.uPixelRatio!.value = frame.pixelRatio
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
