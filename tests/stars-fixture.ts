import {
  FloatType, LinearSRGBColorSpace, Matrix4, NoToneMapping, PerspectiveCamera, SRGBColorSpace,
  Vector3, WebGLRenderTarget, WebGLRenderer,
} from 'three'
import type { Vec3 } from '../src/contracts'
import { J2000_JD, StarField, apparentStar, loadStarCatalog, starDirection } from '../src/render/stars'

interface Aim { ra: number; dec: number; fov: number; jd?: number; observerKm?: Vec3; fluxScale?: number; pixelRatio?: number }

const catalog = await loadStarCatalog('/assets/stars/bright-star-catalogue.json')
const stars = new StarField(catalog)
const renderer = new WebGLRenderer({ antialias: false })
renderer.setClearColor(0x000000, 1)
renderer.autoClear = false
renderer.outputColorSpace = SRGBColorSpace
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)
const camera = new PerspectiveCamera(50, 1, .1, 10)

function aim({ ra, dec, fov, jd = J2000_JD, observerKm = [0, 0, 0], fluxScale = 1, pixelRatio = 1 }: Aim, aspect: number) {
  const target = new Vector3(...starDirection(ra, dec))
  const up = Math.abs(target.z) > .99 ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1)
  camera.quaternion.setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), target, up))
  camera.fov = fov
  camera.aspect = aspect
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  stars.update({ jdTdb: jd, observerKm, fluxScale, pixelRatio })
}

/** Renders the star pass into a linear float target and reports the brightest star near the center. */
function probe(settings: Aim & { size?: number }) {
  const size = settings.size ?? 96
  aim(settings, 1)
  const target = new WebGLRenderTarget(size, size, { type: FloatType })
  const buffer = new Float32Array(size * size * 4)
  renderer.outputColorSpace = LinearSRGBColorSpace
  renderer.toneMapping = NoToneMapping
  renderer.setRenderTarget(target)
  renderer.clear()
  renderer.render(stars.scene, camera)
  renderer.readRenderTargetPixels(target, 0, 0, size, size, buffer)
  renderer.setRenderTarget(null)
  renderer.outputColorSpace = SRGBColorSpace
  target.dispose()
  const luminance = (i: number) => .2126 * buffer[i]! + .7152 * buffer[i + 1]! + .0722 * buffer[i + 2]!
  let peak = 0
  for (let i = 0; i < size * size; i++) if (luminance(i * 4) > luminance(peak * 4)) peak = i
  const px = peak % size, py = Math.floor(peak / size)
  let weight = 0, cx = 0, cy = 0
  const rgb = [0, 0, 0]
  for (let y = Math.max(0, py - 6); y <= Math.min(size - 1, py + 6); y++) {
    for (let x = Math.max(0, px - 6); x <= Math.min(size - 1, px + 6); x++) {
      const i = (y * size + x) * 4, value = luminance(i)
      weight += value
      cx += (x + .5) * value
      cy += (y + .5) * value
      for (let c = 0; c < 3; c++) rgb[c]! += buffer[i + c]!
    }
  }
  return { size, peak: { x: px + .5, y: py + .5 }, centroid: { x: cx / weight, y: cy / weight }, energy: weight, rgb,
    peakRgb: [buffer[peak * 4]!, buffer[peak * 4 + 1]!, buffer[peak * 4 + 2]!] }
}

/** Draws the star pass to the visible canvas for screenshots. */
function view(settings: Aim) {
  renderer.setPixelRatio(settings.pixelRatio ?? 1)
  renderer.setSize(innerWidth, innerHeight)
  aim(settings, innerWidth / innerHeight)
  renderer.clear()
  renderer.render(stars.scene, camera)
}

function apparent(hr: number, observerKm: Vec3 = [0, 0, 0], jd = J2000_JD) {
  const row = catalog.stars.find(star => star[0] === hr)
  if (!row) throw new Error(`HR ${hr} is not in the catalog`)
  const { direction, magnitude } = apparentStar(row, observerKm, jd)
  const [x, y, z] = direction
  return { ra: (Math.atan2(y, x) * 180 / Math.PI + 360) % 360, dec: Math.asin(z) * 180 / Math.PI, magnitude,
    catalog: { ra: row[1], dec: row[2] } }
}

Object.assign(window, { starFixture: { count: stars.count, probe, view, apparent } })
