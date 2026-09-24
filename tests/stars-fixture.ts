import {
  FloatType, LinearSRGBColorSpace, Matrix4, NoToneMapping, PerspectiveCamera, SRGBColorSpace, TextureLoader,
  Vector3, WebGLRenderTarget, WebGLRenderer,
} from 'three'
import type { Quality, Vec3 } from '../src/contracts'
import {
  StarField, apparentStar, brightStar, parseBrightStars, parseFaintStars, parseStarManifest, starDirection,
} from '../src/render/stars'

interface Aim {
  ra: number; dec: number; fov: number; jd?: number; observerKm?: Vec3; fluxScale?: number; visibility?: number
  pixelRatio?: number; quality?: Quality; roll?: number; layers?: ('sky' | 'bright' | 'faint')[]
}

const base = '/assets/stars/'
const manifest = parseStarManifest(await (await fetch(`${base}manifest.json`)).json())
const bytes = async (file: string) => (await fetch(base + file)).arrayBuffer()
const bright = parseBrightStars(await bytes(manifest.bright.file), manifest.bright)
const stars = new StarField(manifest)
stars.setBright(bright)
for (const [index, record] of manifest.faint.entries()) stars.setFaint(index, parseFaintStars(await bytes(record.file), record))
for (const quality of ['low', 'high'] as const)
  stars.setMilkyWay(quality, await new TextureLoader().loadAsync(base + manifest.milky_way[quality].file))
const renderer = new WebGLRenderer({ antialias: true })
renderer.setClearColor(0x000000, 1)
renderer.autoClear = false
renderer.outputColorSpace = SRGBColorSpace
renderer.setSize(innerWidth, innerHeight)
document.body.append(renderer.domElement)
const camera = new PerspectiveCamera(50, 1, .1, 10)
const layerNames = { sky: 'NASA SVS Milky Way', bright: 'Hipparcos stars', faint: 'Tycho-2 stars' }

function aim(settings: Aim, aspect: number, heightCss: number) {
  const { ra, dec, fov, jd = manifest.bright.epoch_jd, observerKm = [0, 0, 0], fluxScale = 1, visibility = 1,
    pixelRatio = 1, quality = 'high', roll = 0, layers = ['sky', 'bright', 'faint'] } = settings
  const target = new Vector3(...starDirection(ra, dec))
  const north = new Vector3(0, 0, 1)
  const up = Math.abs(target.z) > .99 ? new Vector3(1, 0, 0) : north
  up.applyAxisAngle(target, roll * Math.PI / 180)
  camera.quaternion.setFromRotationMatrix(new Matrix4().lookAt(new Vector3(), target, up))
  camera.fov = fov
  camera.aspect = aspect
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  const pixelAngle = 2 * Math.tan(fov * Math.PI / 360) / heightCss
  stars.update({ jdTdb: jd, observerKm, fluxScale, visibility, pixelRatio, quality, pixelSolidAngle: pixelAngle ** 2 })
  for (const object of stars.scene.children) {
    const layer = Object.entries(layerNames).find(([, name]) => object.name.startsWith(name))?.[0] as keyof typeof layerNames | undefined
    if (layer && !layers.includes(layer)) object.visible = false
    else if (layer === 'bright') object.visible = true
  }
}

/** Renders the chosen layers, Hipparcos by default, into a linear float target. Reports the brightest star near the center. */
function probe(settings: Aim & { size?: number }) {
  const size = settings.size ?? 96
  aim({ layers: ['bright'], ...settings }, 1, size)
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
  let peak = 0, total = 0
  for (let i = 0; i < size * size; i++) {
    total += luminance(i * 4)
    if (luminance(i * 4) > luminance(peak * 4)) peak = i
  }
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
  return { size, centroid: { x: cx / weight, y: cy / weight }, energy: weight, rgb, mean: total / (size * size),
    peakRgb: [buffer[peak * 4]!, buffer[peak * 4 + 1]!, buffer[peak * 4 + 2]!] }
}

/** Draws the sky to the visible canvas for screenshots. */
function view(settings: Aim) {
  renderer.setPixelRatio(settings.pixelRatio ?? 1)
  renderer.setSize(innerWidth, innerHeight)
  aim(settings, innerWidth / innerHeight, innerHeight)
  renderer.clear()
  renderer.render(stars.scene, camera)
}

function apparent(id: number, observerKm: Vec3 = [0, 0, 0], jd = manifest.bright.epoch_jd) {
  let index = -1
  for (let i = 0; i < bright.count && index < 0; i++) if (brightStar(bright, i).id === id) index = i
  if (index < 0) throw new Error(`Star ${id} is not in the Hipparcos tier`)
  const star = brightStar(bright, index)
  const at = (direction: Vec3) => ({ ra: (Math.atan2(direction[1], direction[0]) * 180 / Math.PI + 360) % 360,
    dec: Math.asin(direction[2]) * 180 / Math.PI })
  const { direction, magnitude } = apparentStar(star, observerKm, jd, bright.epochJd)
  return { ...at(direction), magnitude, catalog: at(star.direction) }
}

Object.assign(window, { starFixture: { bright: stars.brightCount, faint: stars.faintCount, epochJd: bright.epochJd, probe, view, apparent } })
