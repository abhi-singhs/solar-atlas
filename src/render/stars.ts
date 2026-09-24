import {
  AdditiveBlending, BackSide, Sphere, BufferAttribute, BufferGeometry, ClampToEdgeWrapping, DataTexture, FloatType,
  InterleavedBuffer, InterleavedBufferAttribute, LinearFilter, LinearMipmapLinearFilter, MathUtils, Mesh,
  NearestFilter, Points, RGBAFormat, RepeatWrapping, Scene, ShaderMaterial, SphereGeometry, SRGBColorSpace,
  Vector3,
} from 'three'
import type { Texture } from 'three'
import { AU_KM } from '../contracts'
import type { Quality, Vec3 } from '../contracts'

export const STAR_MANIFEST_PATH = 'assets/stars/manifest.json'
export const J2000_JD = 2451545
export const JULIAN_YEAR_DAYS = 365.25
export const PARSEC_KM = AU_KM * 648000 / Math.PI
/** At 1 AU an unobstructed Sun in view dims stars by 2.5 log10(4000), about 9 magnitudes. */
export const SUN_GLARE_AT_1_AU = 4000

/**
 * Photographic display model. Stars and Milky Way pixels start as linear flux in units of a V = 0 star, and one
 * exposure turns flux into display intensity. SATURATION_MAGNITUDE sets that exposure: at 0 EV and the reference
 * pixel scale its star peaks at display white. Star peaks then follow intensity^STAR_GAMMA, which lifts faint
 * stars like a stretched long-exposure photograph. The Milky Way stays linear, so its brightness relative to the
 * stars keeps the NASA map's calibration.
 */
export const SATURATION_MAGNITUDE = 4
/**
 * Exposure follows the square root of the zoom, halfway between a fixed exposure and a fixed f-number. A narrow
 * view shows brighter stars on a dimmer Milky Way, a wide view the reverse, and the overall brightness stays close
 * across the 25 to 100 degree range. The reference is 4 arcminutes per CSS pixel, close to a 50 degree view in a
 * 900 pixel tall window.
 */
export const REFERENCE_PIXEL_SOLID_ANGLE = (4 / 60 * Math.PI / 180) ** 2
export const STAR_GAMMA = 0.9
/** Share of each blackbody color kept on screen. Photographs of the sky show paler colors than the pure locus. */
export const STAR_COLOR_SATURATION = 0.65
export const MILKY_WAY_COLOR_SATURATION = 0.6
/**
 * Point-spread function in CSS pixels: a Gaussian core plus a faint wide halo holding PSF_HALO of the energy,
 * like scattered light in a camera lens. Each pixel clips at display white, so bright stars grow a saturated
 * core and a visible glow while faint stars stay single points.
 */
export const PSF_SIGMA_CSS = 0.75
export const PSF_HALO = 0.3
export const PSF_HALO_SCALE = 4
/**
 * NASA SVS milkyway_2020 texels are linear flux. In the matching hiptyc_2020 4K map a V = 5.5 star sums to about
 * 0.5 texel units, so one texel unit is 2 * 10^(-0.4 * 5.5) V = 0 stars per equatorial 4K texel.
 */
export const MILKY_WAY_FLUX_PER_UNIT_SR = 2 * 10 ** (-0.4 * 5.5) / (2 * Math.PI / 4096) ** 2
/** Share of the map's darkest regions treated as the sky black point, like levels in a processed photograph. */
export const MILKY_WAY_BLACK = 0.004
/** Display gain on the Milky Way relative to that calibration, so resolved stars stand out as in long exposures. */
export const MILKY_WAY_GAIN = 0.4
const ARCSEC_RAD = Math.PI / 648000
const BRIGHT_MAGIC = 'SASTARB1'
const FAINT_MAGIC = 'SASTARF1'
const BRIGHT_FLOATS = 10
const LUT_SIZE = 256

export interface StarFile { file: string; bytes: number; sha256: string; count: number }
export interface StarManifest {
  schema_version: 2
  bright: StarFile & { epoch_jd: number; v_limit: number }
  faint: (StarFile & { v_range: [number, number] })[]
  faint_epoch_jd: number
  faint_encoding: { v_mag: { offset: number; step: number }; b_v: { offset: number; step: number; missing: number } }
  milky_way: Record<Quality, { file: string; width: number; height: number; bytes: number; sha256: string }>
  sources: Record<string, { url: string; sha256: string; bytes: number }>
  notes: string[]
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const safeFile = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9.-]+$/.test(value)

export function parseStarManifest(value: unknown): StarManifest {
  const data = value as Partial<StarManifest>
  const file = (entry: unknown) => {
    const f = entry as Partial<StarFile>
    return Boolean(f) && safeFile(f.file) && finite(f.bytes) && finite(f.count) && typeof f.sha256 === 'string'
  }
  if (!data || data.schema_version !== 2 || !file(data.bright) || !finite(data.bright?.epoch_jd)
    || !Array.isArray(data.faint) || !data.faint.every(file) || !finite(data.faint_epoch_jd)
    || !finite(data.faint_encoding?.v_mag.offset) || !finite(data.faint_encoding?.v_mag.step)
    || !finite(data.faint_encoding?.b_v.offset) || !finite(data.faint_encoding?.b_v.step)
    || !(['low', 'high'] as const).every(q => safeFile(data.milky_way?.[q]?.file))) {
    throw new Error('Star manifest does not match schema version 2')
  }
  return data as StarManifest
}

function magic(buffer: ArrayBuffer, expected: string, count: number, stride: number): void {
  const view = new DataView(buffer)
  const text = String.fromCharCode(...new Uint8Array(buffer, 0, 8))
  if (buffer.byteLength < 16 || text !== expected || view.getUint32(8, true) !== count
    || view.getUint32(12, true) !== stride) throw new Error(`Star file ${expected} header does not match the manifest`)
}

export interface BrightStars { count: number; epochJd: number; ids: Uint32Array; data: Float32Array }
export interface BrightStar { id: number; direction: Vec3; motion: Vec3; parallax: number; magnitude: number; bv: number | null }

/** Hipparcos tier: one 40-byte record per star at the Hipparcos epoch. */
export function parseBrightStars(buffer: ArrayBuffer, record: StarManifest['bright']): BrightStars {
  magic(buffer, BRIGHT_MAGIC, record.count, BRIGHT_FLOATS * 4)
  if (buffer.byteLength !== 16 + record.count * BRIGHT_FLOATS * 4) throw new Error('Hipparcos star file has the wrong length')
  const data = new Float32Array(buffer, 16, record.count * BRIGHT_FLOATS)
  const ids = new Uint32Array(buffer, 16, record.count * BRIGHT_FLOATS)
  for (let i = 0; i < record.count; i++) {
    const o = i * BRIGHT_FLOATS
    const length = Math.hypot(data[o + 1]!, data[o + 2]!, data[o + 3]!)
    if (Math.abs(length - 1) > 1e-5 || !(data[o + 8]! > -2 && data[o + 8]! < 12) || !(data[o + 7]! >= 0))
      throw new Error(`Hipparcos star ${ids[o]} is invalid`)
  }
  return { count: record.count, epochJd: record.epoch_jd, ids, data }
}

export function brightStar(stars: BrightStars, index: number): BrightStar {
  const o = index * BRIGHT_FLOATS, d = stars.data
  return { id: stars.ids[o]!, direction: [d[o + 1]!, d[o + 2]!, d[o + 3]!], motion: [d[o + 4]!, d[o + 5]!, d[o + 6]!],
    parallax: d[o + 7]!, magnitude: d[o + 8]!, bv: d[o + 9]! < -90 ? null : d[o + 9]! }
}

export interface FaintStars { count: number; octahedral: Uint16Array; codes: Uint8Array }

/** Tycho-2 tier: octahedral uint16 directions followed by uint8 V and B-V codes. */
export function parseFaintStars(buffer: ArrayBuffer, record: StarFile): FaintStars {
  magic(buffer, FAINT_MAGIC, record.count, 6)
  if (buffer.byteLength !== 16 + record.count * 6) throw new Error(`${record.file} has the wrong length`)
  return { count: record.count, octahedral: new Uint16Array(buffer, 16, record.count * 2),
    codes: new Uint8Array(buffer, 16 + record.count * 4, record.count * 2) }
}

export function decodeOctahedral(x: number, y: number): Vec3 {
  let nx = x / 65535 * 2 - 1, ny = y / 65535 * 2 - 1
  const nz = 1 - Math.abs(nx) - Math.abs(ny)
  const t = Math.max(-nz, 0)
  nx += nx >= 0 ? -t : t
  ny += ny >= 0 ? -t : t
  const length = Math.hypot(nx, ny, nz)
  return [nx / length, ny / length, nz / length]
}

export function faintStar(stars: FaintStars, index: number, encoding: StarManifest['faint_encoding']): { direction: Vec3; magnitude: number; bv: number | null } {
  const code = stars.codes[index * 2 + 1]!
  return { direction: decodeOctahedral(stars.octahedral[index * 2]!, stars.octahedral[index * 2 + 1]!),
    magnitude: encoding.v_mag.offset + stars.codes[index * 2]! * encoding.v_mag.step,
    bv: code === encoding.b_v.missing ? null : encoding.b_v.offset + code * encoding.b_v.step }
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

/**
 * Direction and V magnitude of a Hipparcos-tier star seen from an observer. The shader evaluates the same
 * expression in float32.
 */
export function apparentStar(star: BrightStar, observerKm: Vec3, jdTdb: number, epochJd: number): { direction: Vec3; magnitude: number } {
  const years = (jdTdb - epochJd) / JULIAN_YEAR_DAYS
  const p = star.direction.map((value, i) => value + star.motion[i]! * years - observerKm[i]! / PARSEC_KM * star.parallax)
  const ratio = Math.hypot(p[0]!, p[1]!, p[2]!)
  return { direction: p.map(value => value / ratio) as Vec3, magnitude: star.magnitude + 5 * Math.log10(ratio) }
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

/**
 * Camera white balance: a star at WHITE_POINT_K shows as white. 4800 K sits below daylight, like the cool balance
 * of many night-sky photographs, so F and G stars lean blue-white, hot stars blue and M stars orange.
 */
export const WHITE_POINT_K = 4800
const WHITE = temperatureColor(WHITE_POINT_K)
export function balancedColor([r, g, b]: Vec3): Vec3 {
  const balanced: Vec3 = [r / WHITE[0], g / WHITE[1], b / WHITE[2]]
  const luminance = .2126 * balanced[0] + .7152 * balanced[1] + .0722 * balanced[2]
  return balanced.map(c => c / luminance) as Vec3
}

/** Unit-luminance star color under the camera white balance. Stars without a catalog B-V render white. */
export function starColor(bv: number | null): Vec3 {
  return bv === null ? [1, 1, 1] : balancedColor(temperatureColor(starTemperature(bv)))
}

/** Linear exposure from exposure compensation and the square-root zoom rule. */
export function starExposure(fluxScale: number, pixelSolidAngle: number): number {
  return fluxScale * Math.sqrt(REFERENCE_PIXEL_SOLID_ANGLE / Math.max(pixelSolidAngle, 1e-12))
}

/** Peak display intensity of a star, for a V magnitude and a linear exposure. Above 1 the core saturates. */
export function starPeak(magnitude: number, exposure = 1): number {
  return Math.pow(exposure * 10 ** (-0.4 * (magnitude - SATURATION_MAGNITUDE)), STAR_GAMMA)
}

/**
 * Display intensity per unit NASA map texel for a linear exposure times the pixel solid angle. A star peak at
 * display white holds SATURATION_FLUX spread over the core's 2 pi sigma^2 pixels.
 */
export function milkyWayScale(exposureSolidAngle: number): number {
  return MILKY_WAY_GAIN * exposureSolidAngle * MILKY_WAY_FLUX_PER_UNIT_SR
    / (10 ** (-0.4 * SATURATION_MAGNITUDE) / (2 * Math.PI * PSF_SIGMA_CSS ** 2))
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

const CONSTANTS = `
const float SATURATION_FLUX = ${(10 ** (-0.4 * SATURATION_MAGNITUDE)).toExponential(8)};
const float STAR_GAMMA = ${STAR_GAMMA.toFixed(4)};
const float PSF_SIGMA = ${PSF_SIGMA_CSS.toFixed(4)};
const float PSF_HALO = ${PSF_HALO.toFixed(4)};
const float PSF_HALO_SCALE = ${PSF_HALO_SCALE.toFixed(4)};
const float CUTOFF = 0.002;
uniform float uFluxScale;
uniform float uPixelRatio;
uniform sampler2D uColorLut;
varying vec3 vColor;
varying float vSigma;
varying float vSize;
vec3 lutColor(float code) {
  return texelFetch(uColorLut, ivec2(int(clamp(code, 0.0, 255.0)), 0), 0).rgb;
}
float extent(float amplitude, float sigma) {
  return amplitude > CUTOFF ? sigma * sqrt(2.0 * log(amplitude / CUTOFF)) : 0.0;
}
void emit(vec3 direction, float magnitude, float distanceRatio, vec3 color) {
  float linear = uFluxScale * pow(10.0, -0.4 * magnitude) / SATURATION_FLUX / (distanceRatio * distanceRatio);
  float peak = pow(linear, STAR_GAMMA);
  float brightest = peak * max(color.r, max(color.g, color.b));
  vColor = color * peak;
  vSigma = PSF_SIGMA * uPixelRatio;
  float halo = PSF_HALO / (PSF_HALO_SCALE * PSF_HALO_SCALE);
  float radius = max(extent(brightest * (1.0 - PSF_HALO), vSigma), extent(brightest * halo, vSigma * PSF_HALO_SCALE));
  vSize = min(96.0, 2.0 * ceil(radius) + 1.0);
  gl_PointSize = vSize;
  gl_Position = radius <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * modelViewMatrix * vec4(direction, 1.0);
}`

const brightVertex = `${CONSTANTS}
attribute vec3 aMotion;
attribute float aParallax;
attribute float aMagnitude;
attribute float aColorIndex;
uniform float uYears;
uniform vec3 uObserverPc;
uniform float uBvOffset;
uniform float uBvStep;
void main() {
  vec3 p = position + aMotion * uYears - uObserverPc * aParallax;
  float ratio = length(p);
  float code = aColorIndex < -90.0 ? 255.0 : clamp(floor((aColorIndex - uBvOffset) / uBvStep + 0.5), 0.0, 254.0);
  emit(p / ratio, aMagnitude, ratio, lutColor(code));
}`

const faintVertex = `${CONSTANTS}
attribute vec2 aCodes;
uniform float uMagOffset;
uniform float uMagStep;
void main() {
  vec2 f = position.xy * 2.0 - 1.0;
  vec3 n = vec3(f, 1.0 - abs(f.x) - abs(f.y));
  float t = max(-n.z, 0.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  emit(normalize(n), uMagOffset + aCodes.x * uMagStep, 1.0, lutColor(aCodes.y));
}`

const pointFragment = `
varying vec3 vColor;
varying float vSigma;
varying float vSize;
void main() {
  vec2 offset = (gl_PointCoord - 0.5) * vSize;
  float r2 = dot(offset, offset) / (2.0 * vSigma * vSigma);
  float halo = ${PSF_HALO.toFixed(4)} / ${(PSF_HALO_SCALE ** 2).toFixed(4)};
  float profile = (1.0 - ${PSF_HALO.toFixed(4)}) * exp(-r2) + halo * exp(-r2 / ${(PSF_HALO_SCALE ** 2).toFixed(4)});
  vec3 color = min(vColor * profile, vec3(1.0));
  if (max(color.r, max(color.g, color.b)) < 0.002) discard;
  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
}`

const skyVertex = `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

const skyFragment = `
uniform sampler2D uMap;
uniform float uScale;
uniform float uBlack;
uniform vec3 uWhite;
varying vec3 vDirection;
void main() {
  vec3 d = normalize(vDirection);
  vec2 uv = vec2(0.5 - atan(d.y, d.x) / 6.28318530718, 0.5 + asin(clamp(d.z, -1.0, 1.0)) / 3.14159265359);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  dx.x -= floor(dx.x + 0.5);
  dy.x -= floor(dy.x + 0.5);
  vec3 radiance = max(textureGrad(uMap, uv, dx, dy).rgb - uBlack, 0.0);
  float luminance = dot(radiance, vec3(0.2126, 0.7152, 0.0722));
  vec3 color = mix(vec3(luminance), radiance * uWhite, ${MILKY_WAY_COLOR_SATURATION.toFixed(4)}) * uScale;
  gl_FragColor = vec4(min(color, vec3(1.0)), 1.0);
  #include <colorspace_fragment>
}`

/** 256 B-V codes to unit-luminance linear sRGB. Code 255 is white for stars without a color. */
export function colorLut(encoding: StarManifest['faint_encoding']['b_v']): DataTexture {
  const data = new Float32Array(LUT_SIZE * 4)
  for (let i = 0; i < LUT_SIZE; i++) {
    const color = starColor(i === encoding.missing ? null : encoding.offset + i * encoding.step)
    data.set([...color.map(c => 1 + (c - 1) * STAR_COLOR_SATURATION), 1], i * 4)
  }
  const texture = new DataTexture(data, LUT_SIZE, 1, RGBAFormat, FloatType)
  texture.minFilter = texture.magFilter = NearestFilter
  texture.needsUpdate = true
  return texture
}

export interface StarFrame {
  jdTdb: number
  observerKm: Vec3
  /** Linear flux multiplier from exposure compensation. */
  fluxScale: number
  /** Linear multiplier from glare and daylight, applied after the tone curve so a bright sky hides stars. */
  visibility: number
  pixelRatio: number
  /** Solid angle of one CSS pixel in steradians. */
  pixelSolidAngle: number
  quality: Quality
}

/** Background stars and Milky Way. They are scenery, not selectable destinations. */
export class StarField {
  readonly scene = new Scene()
  readonly manifest: StarManifest
  readonly lut: DataTexture
  private uniforms = {
    uFluxScale: { value: 1 }, uPixelRatio: { value: 1 }, uColorLut: { value: null as DataTexture | null },
    uYears: { value: 0 }, uObserverPc: { value: new Vector3() }, uMagOffset: { value: 0 }, uMagStep: { value: 1 },
    uBvOffset: { value: 0 }, uBvStep: { value: 1 },
  }
  private sky: Mesh<SphereGeometry, ShaderMaterial>
  private skyMaps = new Map<Quality, Texture>()
  private bright?: Points<BufferGeometry, ShaderMaterial>
  private faint: (Points<BufferGeometry, ShaderMaterial> | undefined)[] = []
  private brightEpochJd = J2000_JD

  constructor(manifest: StarManifest) {
    this.manifest = manifest
    this.lut = colorLut(manifest.faint_encoding.b_v)
    this.uniforms.uColorLut.value = this.lut
    this.uniforms.uMagOffset.value = manifest.faint_encoding.v_mag.offset
    this.uniforms.uMagStep.value = manifest.faint_encoding.v_mag.step
    this.uniforms.uBvOffset.value = manifest.faint_encoding.b_v.offset
    this.uniforms.uBvStep.value = manifest.faint_encoding.b_v.step
    this.sky = new Mesh(new SphereGeometry(1, 96, 48), new ShaderMaterial({ vertexShader: skyVertex,
      fragmentShader: skyFragment, side: BackSide, depthTest: false, depthWrite: false, toneMapped: false,
      uniforms: { uMap: { value: null }, uScale: { value: 0 }, uBlack: { value: MILKY_WAY_BLACK },
        uWhite: { value: new Vector3(...balancedColor([1, 1, 1])) } } }))
    this.sky.name = 'NASA SVS Milky Way'
    this.sky.frustumCulled = false
    this.sky.visible = false
    this.sky.renderOrder = 0
    this.scene.add(this.sky)
  }

  get brightCount(): number { return this.bright?.geometry.getAttribute('position').count ?? 0 }
  get faintCount(): number { return this.faint.reduce((sum, p) => sum + (p?.geometry.getAttribute('position').count ?? 0), 0) }

  private pointMaterial(vertexShader: string): ShaderMaterial {
    return new ShaderMaterial({ vertexShader, fragmentShader: pointFragment, uniforms: this.uniforms,
      transparent: true, depthTest: false, depthWrite: false, blending: AdditiveBlending, toneMapped: false })
  }

  setBright(stars: BrightStars): void {
    const buffer = new InterleavedBuffer(stars.data, BRIGHT_FLOATS)
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new InterleavedBufferAttribute(buffer, 3, 1))
    geometry.setAttribute('aMotion', new InterleavedBufferAttribute(buffer, 3, 4))
    geometry.setAttribute('aParallax', new InterleavedBufferAttribute(buffer, 1, 7))
    geometry.setAttribute('aMagnitude', new InterleavedBufferAttribute(buffer, 1, 8))
    geometry.setAttribute('aColorIndex', new InterleavedBufferAttribute(buffer, 1, 9))
    geometry.boundingSphere = new Sphere(new Vector3(), 1)
    this.bright = new Points(geometry, this.pointMaterial(brightVertex))
    this.bright.name = 'Hipparcos stars'
    this.bright.frustumCulled = false
    this.bright.renderOrder = 2
    this.brightEpochJd = stars.epochJd
    this.scene.add(this.bright)
  }

  setFaint(index: number, stars: FaintStars): void {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(stars.octahedral, 2, true))
    geometry.setAttribute('aCodes', new BufferAttribute(stars.codes, 2, false))
    geometry.boundingSphere = new Sphere(new Vector3(), 1)
    const points = new Points(geometry, this.pointMaterial(faintVertex))
    points.name = `Tycho-2 stars ${index + 1}`
    points.frustumCulled = false
    points.renderOrder = 1
    this.faint[index] = points
    this.scene.add(points)
  }

  setMilkyWay(quality: Quality, texture: Texture): void {
    texture.colorSpace = SRGBColorSpace
    texture.wrapS = RepeatWrapping
    texture.wrapT = ClampToEdgeWrapping
    texture.minFilter = LinearMipmapLinearFilter
    texture.magFilter = LinearFilter
    texture.anisotropy = 4
    texture.needsUpdate = true
    this.skyMaps.get(quality)?.dispose()
    this.skyMaps.set(quality, texture)
  }

  hasMilkyWay(quality: Quality): boolean { return this.skyMaps.has(quality) }
  hasFaint(index: number): boolean { return Boolean(this.faint[index]) }

  update(frame: StarFrame): void {
    const u = this.uniforms
    u.uYears.value = (frame.jdTdb - this.brightEpochJd) / JULIAN_YEAR_DAYS
    u.uObserverPc.value.set(...frame.observerKm).divideScalar(PARSEC_KM)
    const exposure = starExposure(frame.fluxScale, frame.pixelSolidAngle)
    // Visibility multiplies display intensity, so convert it back through the star tone curve.
    u.uFluxScale.value = exposure * Math.pow(Math.max(frame.visibility, 0), 1 / STAR_GAMMA)
    u.uPixelRatio.value = frame.pixelRatio
    this.faint.forEach((points, i) => { if (points) points.visible = i === 0 || frame.quality === 'high' })
    const map = this.skyMaps.get(frame.quality) ?? this.skyMaps.get('low') ?? this.skyMaps.get('high')
    this.sky.visible = Boolean(map)
    const material = this.sky.material
    material.uniforms.uMap!.value = map ?? null
    material.uniforms.uScale!.value = milkyWayScale(exposure * frame.pixelSolidAngle) * frame.visibility
  }

  dispose(): void {
    this.lut.dispose()
    this.sky.geometry.dispose()
    this.sky.material.dispose()
    for (const map of this.skyMaps.values()) map.dispose()
    for (const points of [this.bright, ...this.faint]) {
      points?.geometry.dispose()
      points?.material.dispose()
    }
  }
}
