import { FloatType, LinearSRGBColorSpace, NoToneMapping, WebGLRenderTarget, WebGLRenderer } from 'three'
import { SunFlare } from '../src/render/flare'
import type { FlareFrame } from '../src/render/flare'

type Layer = 'starburst' | 'ghosts'
interface Point { x: number; y: number }

const renderer = new WebGLRenderer({ antialias: false })
renderer.setClearColor(0x000000, 1)
renderer.autoClear = false
renderer.outputColorSpace = LinearSRGBColorSpace
renderer.toneMapping = NoToneMapping
document.body.append(renderer.domElement)
const flare = new SunFlare()
let width = 1, height = 1, buffer = new Float32Array(4)

const luminance = (i: number) => .2126 * buffer[i]! + .7152 * buffer[i + 1]! + .0722 * buffer[i + 2]!
/** Buffer offset for a CSS pixel measured from the top left corner, or -1 outside the frame. */
const offset = ({ x, y }: Point) => {
  const bx = Math.floor(x), by = height - 1 - Math.floor(y)
  return bx < 0 || by < 0 || bx >= width || by >= height ? -1 : (by * width + bx) * 4
}

/** Renders the flare alone into a linear float target the size of the frame. */
function render(frame: FlareFrame, layers: Layer[] = ['starburst', 'ghosts']) {
  width = frame.width
  height = frame.height
  const drawn = flare.update(frame)
  flare.starburst.visible = layers.includes('starburst')
  if (!layers.includes('ghosts')) flare.ghosts.visible = false
  const target = new WebGLRenderTarget(width, height, { type: FloatType })
  buffer = new Float32Array(width * height * 4)
  renderer.setRenderTarget(target)
  renderer.clear()
  if (drawn) renderer.render(flare.scene, flare.camera)
  renderer.readRenderTargetPixels(target, 0, 0, width, height, buffer)
  renderer.setRenderTarget(null)
  target.dispose()
  flare.starburst.visible = true
  let total = 0, peak = 0
  for (let i = 0; i < width * height; i++) {
    total += luminance(i * 4)
    if (luminance(i * 4) > luminance(peak * 4)) peak = i
  }
  return { drawn, total, peak: { x: peak % width + .5, y: height - Math.floor(peak / width) - .5 } }
}

/** Linear RGB and luminance at CSS pixels, zero outside the frame. */
function sample(points: Point[]) {
  return points.map(point => {
    const i = offset(point)
    return i < 0 ? { rgb: [0, 0, 0], value: 0 } : { rgb: [buffer[i]!, buffer[i + 1]!, buffer[i + 2]!], value: luminance(i) }
  })
}

/** Centers of every pixel brighter than the threshold, in CSS pixels from the top left corner. */
function lit(threshold = 1e-5): Point[] {
  const points: Point[] = []
  for (let i = 0; i < width * height; i++)
    if (luminance(i * 4) > threshold) points.push({ x: i % width + .5, y: height - Math.floor(i / width) - .5 })
  return points
}

Object.assign(window, { flareFixture: { render, sample, lit } })
