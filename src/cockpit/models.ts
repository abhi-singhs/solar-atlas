import * as THREE from 'three'
import type { RenderOptions } from '../contracts'

export type CockpitTelemetry = NonNullable<RenderOptions['flightTelemetry']> & {
  headingDeg?: number
  targetName?: string
  referenceName?: string
}

interface Display {
  context: CanvasRenderingContext2D
  texture: THREE.CanvasTexture
  kind: 'flight' | 'navigation' | 'altitude'
  lastText: string
}

interface Instruments {
  displays: Display[]
  speedNeedle: THREE.Object3D
  verticalNeedle: THREE.Object3D
  heading: THREE.Object3D
  warpLamp: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  throttleBars: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>[]
}

const instruments = new WeakMap<THREE.Group, Instruments>()
const metal = (color: number, roughness = 0.55, metalness = 0.6) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness })
const light = (color: number) => new THREE.MeshBasicMaterial({ color, toneMapped: false })

function box(parent: THREE.Object3D, name: string, size: number[], position: number[], material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material)
  mesh.name = name
  mesh.position.set(position[0], position[1], position[2])
  parent.add(mesh)
  return mesh
}

function beam(parent: THREE.Object3D, name: string, a: number[], b: number[], radius: number, material: THREE.Material) {
  const start = new THREE.Vector3(...a)
  const end = new THREE.Vector3(...b)
  const direction = end.clone().sub(start)
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), 8), material)
  mesh.name = name
  mesh.position.copy(start).add(end).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  parent.add(mesh)
  return mesh
}

function plate(parent: THREE.Object3D, name: string, points: number[][], depth: number, material: THREE.Material) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
  const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.1,
    bevelSize: depth * 0.12,
    bevelSegments: 1,
    steps: 1,
  }), material)
  mesh.name = name
  parent.add(mesh)
  return mesh
}

function display(parent: THREE.Object3D, kind: Display['kind'], x: number, width: number, displays: Display[]) {
  const housing = metal(0x242526, 0.7)
  const glass = light(0x101516)
  const bezel = box(parent, `${kind}-bezel`, [width + 0.044, 0.272, 0.055], [x, -0.56, -1.43], housing)
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.226), glass)
  screen.name = `${kind}-display`
  screen.position.set(0, 0, 0.030)
  bezel.add(screen)
  for (const side of [-1, 1]) {
    for (const row of [-1, 1]) {
      const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.002, 6), metal(0x696761))
      screw.rotation.x = Math.PI / 2
      screw.position.set(side * (width / 2 + 0.010), row * 0.120, 0.029)
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
  glass.map = texture
  glass.color.setHex(0xffffff)
  glass.needsUpdate = true
  displays.push({ context, texture, kind, lastText: '' })
}

function gauge(parent: THREE.Object3D, name: string, x: number, y: number) {
  const group = new THREE.Group()
  group.name = name
  group.position.set(x, y, -1.39)
  parent.add(group)
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.050, 32), light(0x17191a))
  group.add(face)
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.053, 0.003, 6, 32), metal(0x77746f))
  group.add(ring)
  for (let i = 0; i <= 12; i++) {
    const angle = -Math.PI * 0.75 + i * Math.PI * 1.5 / 12
    const tick = box(group, `${name}-tick-${i}`, [0.002, i % 3 === 0 ? 0.010 : 0.006, 0.001],
      [Math.sin(angle) * 0.040, Math.cos(angle) * 0.040, 0.002], light(0xaeb9b5))
    tick.rotation.z = -angle
  }
  const needle = new THREE.Group()
  needle.name = `${name}-needle`
  needle.position.z = 0.005
  box(needle, `${name}-hand`, [0.0028, 0.037, 0.001], [0, 0.016, 0], light(0xfdb0b6))
  group.add(needle)
  return needle
}

/**
 * Original "Kestrel" exploration cockpit, not source scientific geometry.
 * Coordinates are meters with pilot eye at origin, +Y up and forward -Z.
 * Render in a separate camera scene with near 0.01, far 10 and a 60 degree vertical FOV.
 * No center canopy strut or windshield plane blocks the forward sightline.
 */
export function createCockpit(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Kestrel original cockpit'
  group.userData = { units: 'meters', forward: '-Z', origin: 'pilot eye', reconstructed: true }
  const graphite = metal(0x27292b, 0.78, 0.35)
  const dark = metal(0x171a1d, 0.75, 0.25)
  const alloy = metal(0x878077, 0.35, 0.78)
  const trim = metal(0x9b6569, 0.44, 0.6)
  const stitching = light(0xbe8b87)
  const displays: Display[] = []

  const dash = plate(group, 'faceted-dashboard', [
    [-1.08, -0.78], [-1.08, -0.51], [-0.88, -0.37],
    [-0.36, -0.37], [-0.27, -0.41], [0.27, -0.41],
    [0.36, -0.37], [0.88, -0.37], [1.08, -0.51], [1.08, -0.78],
  ], 0.23, graphite)
  dash.position.z = -1.67
  box(group, 'dashboard-lower-edge', [1.91, 0.05, 0.06], [0, -0.79, -1.42], alloy)
  box(group, 'dashboard-crown', [0.52, 0.035, 0.28], [0, -0.395, -1.48], dark)

  for (const side of [-1, 1]) {
    const s = side
    beam(group, 'canopy-lower-side', [s * 0.98, -0.49, -1.32], [s * 1.19, -0.41, 0.18], 0.052, graphite)
    beam(group, 'canopy-pillar', [s * 1.05, -0.48, -1.38], [s * 0.92, 0.69, -1.43], 0.039, alloy)
    beam(group, 'canopy-pillar-inner-trim', [s * 1.00, -0.38, -1.365], [s * 0.885, 0.68, -1.415], 0.009, trim)
    beam(group, 'canopy-roof-side', [s * 0.92, 0.70, -1.43], [s * 1.05, 0.88, 0.12], 0.045, graphite)
    beam(group, 'canopy-sill-light', [s * 0.94, -0.41, -1.30], [s * 1.10, -0.36, -0.36], 0.006, stitching)
    const console = box(group, 'side-console', [0.33, 0.23, 1.18], [s * 0.80, -0.84, -0.40], graphite)
    console.rotation.z = s * 0.14
    box(console, 'console-inset', [0.25, 0.012, 0.95], [0, 0.12, -0.04], dark)
    for (let i = 0; i < 5; i++) {
      box(console, 'console-switch', [0.036, 0.016, 0.049], [s * 0.065, 0.137, -0.40 + i * 0.11], alloy)
      box(console, 'console-switch-light', [0.007, 0.008, 0.025], [-s * 0.07, 0.133, -0.40 + i * 0.11], stitching)
    }
    beam(console, 'hand-controller', [0, 0.12, 0.23], [0, 0.29, 0.15], 0.028, dark)
    box(console, 'hand-controller-cap', [0.070, 0.040, 0.054], [0, 0.29, 0.15], trim)
    for (let i = 0; i < 3; i++) {
      box(group, 'dashboard-vent', [0.074, 0.011, 0.012], [s * 0.91, -0.62 + i * 0.033, -1.40], dark)
    }
  }
  beam(group, 'canopy-roof-brow', [-0.93, 0.70, -1.44], [0.93, 0.70, -1.44], 0.040, graphite)
  beam(group, 'canopy-roof-brow-trim', [-0.86, 0.67, -1.42], [0.86, 0.67, -1.42], 0.005, alloy)
  box(group, 'footwell', [1.25, 0.06, 1.25], [0, -1.10, -0.49], dark)

  display(group, 'flight', -0.58, 0.45, displays)
  display(group, 'navigation', 0, 0.55, displays)
  display(group, 'altitude', 0.58, 0.45, displays)
  const speedNeedle = gauge(group, 'speed-gauge', -0.32, -0.71)
  const verticalNeedle = gauge(group, 'vertical-speed-gauge', 0.32, -0.71)
  const heading = new THREE.Group()
  heading.name = 'heading-indicator'
  heading.position.set(0, -0.729, -1.39)
  const compass = new THREE.Mesh(new THREE.TorusGeometry(0.043, 0.002, 5, 40), light(0x87928e))
  heading.add(compass)
  const headingArrow = plate(heading, 'heading-chevron', [[-0.011, 0.017], [0, 0.038], [0.011, 0.017], [0, 0.022]], 0.002, stitching)
  headingArrow.position.z = 0.003
  group.add(heading)

  const warpLamp = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), light(0x53403d))
  warpLamp.name = 'warp-indicator'
  warpLamp.position.set(0.19, -0.73, -1.39)
  group.add(warpLamp)
  const throttleBars: Instruments['throttleBars'] = []
  for (let i = 0; i < 12; i++) {
    const material = light(0x39413d)
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.018 + i * 0.002, 0.005), material)
    mesh.name = 'commanded-speed-segment'
    mesh.position.set(-0.72 + i * 0.023, -0.738, -1.39)
    group.add(mesh)
    throttleBars.push(mesh)
  }
  instruments.set(group, { displays, speedNeedle, verticalNeedle, heading, warpLamp, throttleBars })
  updateCockpit(group, { speedC: 0, throttleC: 0, altitudeKm: 0, verticalKmS: 0, warp: false, mode: 'free', targetId: '', referenceId: '' })
  return group
}

function compact(value: number, unit: string): string {
  if (!Number.isFinite(value)) return `-- ${unit}`
  const magnitude = Math.abs(value)
  return `${magnitude >= 1e7 ? value.toExponential(3) : value.toLocaleString('en-US', {
    maximumFractionDigits: magnitude < 1 ? 4 : magnitude < 100 ? 2 : 0,
  })} ${unit}`
}

function paintDisplay(display: Display, telemetry: CockpitTelemetry) {
  const { context: c, kind } = display
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
  c.fillStyle = '#101819'
  c.fillRect(0, 0, 768, 384)
  c.strokeStyle = '#33433e'
  c.lineWidth = 2
  c.strokeRect(12, 12, 744, 360)
  for (let y = 80; y < 280; y += 32) {
    c.beginPath(); c.moveTo(24, y); c.lineTo(744, y); c.stroke()
  }
  c.textAlign = 'left'
  c.textBaseline = 'top'
  c.font = '600 28px "Segoe UI", sans-serif'
  c.fillStyle = '#a2b3a9'
  c.fillText(title, 30, 30, 708)
  c.font = '600 64px Consolas, monospace'
  c.fillStyle = '#e0e9dd'
  c.fillText(primary, 30, 107, 708)
  c.font = '30px Consolas, monospace'
  c.fillStyle = '#afc3b5'
  c.fillText(secondary, 30, 203, 708)
  c.fillStyle = '#efabb0'
  c.font = '600 28px Consolas, monospace'
  c.fillText(footer, 30, 300, 708)
  display.texture.needsUpdate = true
}

/** Updates in place. The caller owns rendering and resource disposal. */
export function updateCockpit(group: THREE.Group, telemetry: CockpitTelemetry): void {
  const instrument = instruments.get(group)
  if (!instrument) return
  const speed = Number.isFinite(telemetry.speedC) ? Math.abs(telemetry.speedC) : 0
  const command = Number.isFinite(telemetry.throttleC) ? Math.abs(telemetry.throttleC) : 0
  const normalized = (value: number) => THREE.MathUtils.clamp(Math.log10(1 + value * 1e9) / 12, 0, 1)
  instrument.speedNeedle.rotation.z = Math.PI * 0.75 - normalized(speed) * Math.PI * 1.5
  instrument.verticalNeedle.rotation.z = Number.isFinite(telemetry.verticalKmS)
    ? -Math.tanh(telemetry.verticalKmS * 100) * Math.PI * 0.72 : 0
  instrument.heading.rotation.z = Number.isFinite(telemetry.headingDeg) ? -THREE.MathUtils.degToRad(telemetry.headingDeg!) : 0
  instrument.warpLamp.material.color.setHex(telemetry.warp ? 0xf0a66c : 0x53403d)
  instrument.throttleBars.forEach((bar, i) => bar.material.color.setHex(i / 12 < normalized(command) ? 0xd9b0a9 : 0x39413d))
  for (const display of instrument.displays) paintDisplay(display, telemetry)
}

/**
 * Original Kestrel survey craft in meters, +Y up, nose -Z, origin at pilot eye.
 * Hull envelope is about 7.6 m wide by 8.5 m long. Scale by 0.001 in a kilometer scene.
 */
export function createShip(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'Kestrel original exploration craft'
  group.userData = { units: 'meters', forward: '-Z', origin: 'pilot eye', reconstructed: true }
  const hull = metal(0xb3afa5, 0.54, 0.65)
  const dark = metal(0x303539, 0.65, 0.45)
  const seam = metal(0x5b5d5a, 0.65, 0.5)
  const accent = metal(0x9a515d, 0.45, 0.6)
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x25393e, roughness: 0.14, metalness: 0.7, clearcoat: 1 })
  const body = plate(group, 'lifting-body-hull', [
    [0, 4.8], [-0.65, 3.5], [-1.22, 1.6], [-1.25, -2.4],
    [-0.78, -3.5], [0.78, -3.5], [1.25, -2.4], [1.22, 1.6], [0.65, 3.5],
  ], 0.74, hull)
  body.rotation.x = -Math.PI / 2
  body.position.y = -0.92
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), glass)
  canopy.name = 'segmented-pilot-canopy'
  canopy.scale.set(0.92, 0.70, 1.50)
  canopy.position.set(0, -0.18, -1.00)
  group.add(canopy)
  for (const side of [-1, 1]) {
    const wing = plate(group, 'swept-outrigger', [[0.96, 0.8], [1.56, 1.2], [3.72, -2.35], [3.60, -3.25], [1.02, -2.15]], 0.20, hull)
    wing.rotation.x = -Math.PI / 2
    wing.scale.x = side
    wing.position.y = -0.77
    const stripe = plate(group, 'outrigger-identification-stripe', [[1.6, 0.55], [1.73, 0.4], [3.35, -2.44], [3.2, -2.4]], 0.014, accent)
    stripe.rotation.x = -Math.PI / 2
    stripe.scale.x = side
    stripe.position.y = -0.55
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.44, 1.75, 12), dark)
    engine.name = 'outrigger-engine'
    engine.rotation.x = Math.PI / 2
    engine.position.set(side * 2.74, -0.50, 2.10)
    group.add(engine)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.075, 8, 24), seam)
    rim.name = 'engine-nozzle-rim'
    rim.position.set(side * 2.74, -0.5, 3.01)
    group.add(rim)
    const nozzle = new THREE.Mesh(new THREE.CircleGeometry(0.29, 24), light(0xbf8489))
    nozzle.name = 'engine-core'
    nozzle.position.set(side * 2.74, -0.5, 3.025)
    group.add(nozzle)
    const fin = plate(group, 'canted-tail-fin', [[0, 0], [0, 0.9], [-0.72, 1.24], [-0.95, 0]], 0.065, accent)
    fin.rotation.y = Math.PI / 2
    fin.rotation.z = side * -0.19
    fin.position.set(side * 0.97, -0.1, 2.58)
    beam(group, 'canopy-longitudinal-frame', [side * 0.82, -0.08, -1.8], [side * 0.78, 0.04, 0.01], 0.035, seam)
    box(group, 'forward-running-light', [0.055, 0.035, 0.20], [side * 1.17, -0.12, -1.05], light(0xf6d6c7))
    beam(group, 'landing-strut', [side * 0.85, -0.88, 1.6], [side * 1.17, -2.92, 1.75], 0.055, seam)
    box(group, 'landing-pad', [0.36, 0.08, 0.65], [side * 1.17, -2.96, 1.75], dark)
  }
  // The pad bottoms meet the controller's ground datum, three meters below the pilot.
  beam(group, 'forward-landing-strut', [0, -0.92, -2.8], [0, -2.92, -2.85], 0.055, seam)
  box(group, 'forward-landing-pad', [0.30, 0.08, 0.50], [0, -2.96, -2.85], dark)
  for (let i = 0; i < 6; i++) {
    box(group, 'dorsal-radiator', [0.70, 0.022, 0.045], [0, -0.14, 0.95 + i * 0.20], dark)
  }
  return group
}
