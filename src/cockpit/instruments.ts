import * as THREE from 'three'
import type { RenderOptions } from '../contracts'
import { box, light, metal, place, plate } from './parts'

export type CockpitTelemetry = NonNullable<RenderOptions['flightTelemetry']> & {
  headingDeg?: number
  targetName?: string
  referenceName?: string
}

export type DisplayKind = 'flight' | 'navigation' | 'altitude'
type Triple = readonly [number, number, number] | number[]

/** Colors for the canvas displays and the lit instruments. Canvas colors are CSS strings, the rest are hex numbers. */
export interface DisplayPalette {
  background: string
  grid: string
  frame: string
  title: string
  primary: string
  secondary: string
  footer: string
  titleFont?: string
  monoFont?: string
  housing: number
  screw: number
  gaugeFace: number
  gaugeRing: number
  tick: number
  needle: number
  compass: number
  chevron: number
  lampOff: number
  lampOn: number
  barOff: number
  barOn: number
}

export interface Placement {
  position: Triple
  /** Euler angles in radians, XYZ order. */
  rotation?: Triple
}

export interface DisplaySpec extends Placement {
  kind: DisplayKind
  width: number
  /** Screen height. The bezel adds a margin around it. */
  height?: number
}

/**
 * Where each instrument sits in the cockpit. Gauges, the heading ring and the warp lamp face +Z toward the pilot
 * before `rotation` applies. Throttle segments run along local +X from `throttle.position`.
 */
export interface InstrumentLayout {
  displays: DisplaySpec[]
  speedGauge: Placement
  verticalGauge: Placement
  heading: Placement
  warpLamp: Placement
  throttle: Placement & { step?: number }
  /** Uniform scale for gauges, heading, lamp and throttle segments. */
  scale?: number
}

interface Display {
  context: CanvasRenderingContext2D
  texture: THREE.CanvasTexture
  kind: DisplayKind
  lastText: string
  palette: DisplayPalette
}

interface Instruments {
  displays: Display[]
  speedNeedle: THREE.Object3D
  verticalNeedle: THREE.Object3D
  heading: THREE.Object3D
  warpLamp: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  throttleBars: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[]
  palette: DisplayPalette
}

const instruments = new WeakMap<THREE.Group, Instruments>()

export const KESTREL_PALETTE: DisplayPalette = {
  background: '#101819', grid: '#33433e', frame: '#33433e', title: '#a2b3a9', primary: '#e0e9dd', secondary: '#afc3b5', footer: '#efabb0',
  housing: 0x242526, screw: 0x696761, gaugeFace: 0x17191a, gaugeRing: 0x77746f, tick: 0xaeb9b5, needle: 0xfdb0b6,
  compass: 0x87928e, chevron: 0xbe8b87, lampOff: 0x53403d, lampOn: 0xf0a66c, barOff: 0x39413d, barOn: 0xd9b0a9,
}

function orient(object: THREE.Object3D, placement: Placement) {
  object.position.set(placement.position[0], placement.position[1], placement.position[2])
  if (placement.rotation) object.rotation.set(placement.rotation[0], placement.rotation[1], placement.rotation[2])
}

function display(parent: THREE.Object3D, spec: DisplaySpec, palette: DisplayPalette, displays: Display[]) {
  const height = spec.height ?? 0.226
  const glassMaterial = light(0x101516)
  const bezel = box(parent, `${spec.kind}-bezel`, [spec.width + 0.044, height + 0.046, 0.055], [0, 0, 0], metal(palette.housing, 0.7))
  orient(bezel, spec)
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(spec.width, height), glassMaterial)
  screen.name = `${spec.kind}-display`
  screen.position.set(0, 0, 0.030)
  bezel.add(screen)
  for (const side of [-1, 1]) {
    for (const row of [-1, 1]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.002, 6), metal(palette.screw))
      screw.rotation.x = Math.PI / 2
      screw.position.set(side * (spec.width / 2 + 0.010), row * (height / 2 + 0.007), 0.029)
      bezel.add(screw)
    }
  }
  if (typeof document === 'undefined') return
  const canvas = document.createElement('canvas')
  canvas.width = 768
  canvas.height = 384
  const context = canvas.getContext('2d')
  if (!context) return
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  glassMaterial.map = texture
  glassMaterial.color.setHex(0xffffff)
  glassMaterial.needsUpdate = true
  displays.push({ context, texture, kind: spec.kind, lastText: '', palette })
}

function gauge(parent: THREE.Object3D, name: string, placement: Placement, scale: number, palette: DisplayPalette) {
  const group = new THREE.Group()
  group.name = name
  orient(group, placement)
  group.scale.setScalar(scale)
  parent.add(group)
  group.add(new THREE.Mesh(new THREE.CircleGeometry(0.050, 32), light(palette.gaugeFace)))
  group.add(new THREE.Mesh(new THREE.TorusGeometry(0.053, 0.003, 6, 32), metal(palette.gaugeRing)))
  for (let i = 0; i <= 12; i++) {
    const angle = -Math.PI * 0.75 + i * Math.PI * 1.5 / 12
    const tick = box(group, `${name}-tick-${i}`, [0.002, i % 3 === 0 ? 0.010 : 0.006, 0.001],
      [Math.sin(angle) * 0.040, Math.cos(angle) * 0.040, 0.002], light(palette.tick))
    tick.rotation.z = -angle
  }
  const needle = new THREE.Group()
  needle.name = `${name}-needle`
  needle.position.z = 0.005
  box(needle, `${name}-hand`, [0.0028, 0.037, 0.001], [0, 0.016, 0], light(palette.needle))
  group.add(needle)
  return needle
}

/**
 * Adds the live instrument set to a cockpit and registers it for `updateCockpit`. Every cockpit needs the same named
 * parts: `<kind>-display` screens, `speed-gauge-needle`, `vertical-speed-gauge-needle`, `heading-indicator`,
 * `warp-indicator`, and 12 `commanded-speed-segment` meshes as direct children of `group`.
 */
export function mountInstruments(group: THREE.Group, layout: InstrumentLayout, palette: DisplayPalette): void {
  const scale = layout.scale ?? 1
  const displays: Display[] = []
  for (const spec of layout.displays) display(group, spec, palette, displays)
  const speedNeedle = gauge(group, 'speed-gauge', layout.speedGauge, scale, palette)
  const verticalNeedle = gauge(group, 'vertical-speed-gauge', layout.verticalGauge, scale, palette)
  const heading = new THREE.Group()
  heading.name = 'heading-indicator'
  const headingMount = new THREE.Group()
  headingMount.name = 'heading-mount'
  orient(headingMount, layout.heading)
  headingMount.scale.setScalar(scale)
  headingMount.add(heading)
  group.add(headingMount)
  heading.add(new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.002, 5, 40), light(palette.compass)))
  const chevron = plate(heading, 'heading-chevron', [[-0.011, 0.017], [0, 0.038], [0.011, 0.017], [0, 0.022]], 0.002, light(palette.chevron))
  chevron.position.z = 0.003

  const warpLamp = place(group, 'warp-indicator', new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), light(palette.lampOff)))
  orient(warpLamp, layout.warpLamp)
  warpLamp.scale.setScalar(scale)

  const throttleBars: Instruments['throttleBars'] = []
  const origin = new THREE.Vector3(...layout.throttle.position)
  const turn = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(layout.throttle.rotation ?? [0, 0, 0])))
  const step = (layout.throttle.step ?? 0.023) * scale
  for (let i = 0; i < 12; i++) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.015 * scale, (0.018 + i * 0.002) * scale, 0.005 * scale), light(palette.barOff))
    mesh.name = 'commanded-speed-segment'
    mesh.position.copy(origin).add(new THREE.Vector3(i * step, 0, 0).applyQuaternion(turn))
    mesh.quaternion.copy(turn)
    group.add(mesh)
    throttleBars.push(mesh)
  }
  instruments.set(group, { displays, speedNeedle, verticalNeedle, heading, warpLamp, throttleBars, palette })
  updateCockpit(group, { speedC: 0, throttleC: 0, altitudeKm: 0, verticalKmS: 0, warp: false, mode: 'free', targetId: '', referenceId: '' })
}

function compact(value: number, unit: string): string {
  if (!Number.isFinite(value)) return `-- ${unit}`
  const magnitude = Math.abs(value)
  return `${magnitude >= 1e7 ? value.toExponential(3) : value.toLocaleString('en-US', {
    maximumFractionDigits: magnitude < 1 ? 4 : magnitude < 100 ? 2 : 0,
  })} ${unit}`
}

function paintDisplay(display: Display, telemetry: CockpitTelemetry) {
  const { context: c, kind, palette } = display
  const altitude = telemetry.altitudeKm
  const target = telemetry.targetName || telemetry.targetId || 'No target'
  const reference = telemetry.referenceName || telemetry.referenceId || 'No reference'
  const heading = Number.isFinite(telemetry.headingDeg) ? `${((telemetry.headingDeg! % 360 + 360) % 360).toFixed(1)} deg` : '-- deg'
  let title: string
  let primary: string
  let secondary: string
  let footer: string
  if (kind === 'flight') {
    title = 'RELATIVE SPEED'
    primary = Number.isFinite(telemetry.speedC) ? `${telemetry.speedC.toPrecision(5)} c` : '-- c'
    secondary = compact(telemetry.speedC * 299792458, 'm/s')
    footer = `CMD ${Number.isFinite(telemetry.throttleC) ? telemetry.throttleC.toPrecision(4) : '--'} c`
  } else if (kind === 'navigation') {
    title = telemetry.warp ? 'WARP / FICTIONAL' : 'NAVIGATION'
    primary = target
    secondary = `${telemetry.mode.toUpperCase()}  /  ${heading}`
    footer = `REF ${reference}`
  } else {
    title = telemetry.mode === 'hover' ? 'SIMULATED HOVER ALT' : 'SURFACE ALTITUDE'
    primary = compact(altitude < 1 ? altitude * 1000 : altitude, altitude < 1 ? 'm' : 'km')
    secondary = `VERT ${compact(telemetry.verticalKmS * 1000, 'm/s')}`
    footer = 'EXPLORATION ASSIST'
  }
  const signature = [title, primary, secondary, footer].join('|')
  if (signature === display.lastText) return
  display.lastText = signature
  const titleFont = palette.titleFont ?? '"Segoe UI", sans-serif'
  const monoFont = palette.monoFont ?? 'Consolas, monospace'
  c.fillStyle = palette.background
  c.fillRect(0, 0, 768, 384)
  c.strokeStyle = palette.frame
  c.lineWidth = 2
  c.strokeRect(12, 12, 744, 360)
  c.strokeStyle = palette.grid
  for (let y = 80; y < 280; y += 32) {
    c.beginPath(); c.moveTo(24, y); c.lineTo(744, y); c.stroke()
  }
  c.textAlign = 'left'
  c.textBaseline = 'top'
  c.font = `600 28px ${titleFont}`
  c.fillStyle = palette.title
  c.fillText(title, 30, 30, 708)
  c.font = `600 64px ${monoFont}`
  c.fillStyle = palette.primary
  c.fillText(primary, 30, 107, 708)
  c.font = `30px ${monoFont}`
  c.fillStyle = palette.secondary
  c.fillText(secondary, 30, 203, 708)
  c.fillStyle = palette.footer
  c.font = `600 28px ${monoFont}`
  c.fillText(footer, 30, 300, 708)
  display.texture.needsUpdate = true
}

/** Updates in place. The caller owns rendering and resource disposal. */
export function updateCockpit(group: THREE.Group, telemetry: CockpitTelemetry): void {
  const instrument = instruments.get(group)
  if (!instrument) return
  const { palette } = instrument
  const speed = Number.isFinite(telemetry.speedC) ? Math.abs(telemetry.speedC) : 0
  const command = Number.isFinite(telemetry.throttleC) ? Math.abs(telemetry.throttleC) : 0
  const normalized = (value: number) => THREE.MathUtils.clamp(Math.log10(1 + value * 1e9) / 12, 0, 1)
  instrument.speedNeedle.rotation.z = Math.PI * 0.75 - normalized(speed) * Math.PI * 1.5
  instrument.verticalNeedle.rotation.z = Number.isFinite(telemetry.verticalKmS)
    ? -Math.tanh(telemetry.verticalKmS * 100) * Math.PI * 0.72 : 0
  instrument.heading.rotation.z = Number.isFinite(telemetry.headingDeg) ? -THREE.MathUtils.degToRad(telemetry.headingDeg!) : 0
  instrument.warpLamp.material.color.setHex(telemetry.warp ? palette.lampOn : palette.lampOff)
  instrument.throttleBars.forEach((bar, i) => bar.material.color.setHex(i / 12 < normalized(command) ? palette.barOn : palette.barOff))
  for (const display of instrument.displays) paintDisplay(display, telemetry)
}
