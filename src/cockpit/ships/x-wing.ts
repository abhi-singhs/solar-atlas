import * as THREE from 'three'
import type { DisplayPalette } from '../instruments'
import { mountInstruments } from '../instruments'
import { beam, box, cabinLight, cylinder, deck, glass, light, matte, metal, shipGroup, sphere, torus } from '../parts'
import type { ShipDesign } from './types'

type Triple = readonly [number, number, number]

const EYE_HEIGHT_M = 2.75
const WING_ANGLE = THREE.MathUtils.degToRad(13)
const WING_BASE_Y = -0.58
const WING_TIP_X = 5.95

const X_WING_PALETTE: DisplayPalette = {
  background: '#031108',
  grid: '#0b3419',
  frame: '#1f6431',
  title: '#b8ff95',
  primary: '#71ff62',
  secondary: '#3fdc58',
  footer: '#ffc15a',
  housing: 0x172019,
  screw: 0x8c8a78,
  gaugeFace: 0x020806,
  gaugeRing: 0x346743,
  tick: 0x99ff86,
  needle: 0xffba4f,
  compass: 0x58e36b,
  chevron: 0xffb84a,
  lampOff: 0x261808,
  lampOn: 0xffb84a,
  barOff: 0x102715,
  barOn: 0x70ff66,
}

function rectFrustum(parent: THREE.Object3D, name: string, zFront: number, zBack: number,
  front: readonly [number, number], back: readonly [number, number], y: number, material: THREE.Material) {
  const [fw, fh] = front
  const [bw, bh] = back
  const vertices = [
    [-fw / 2, y - fh / 2, zFront], [fw / 2, y - fh / 2, zFront],
    [fw / 2, y + fh / 2, zFront], [-fw / 2, y + fh / 2, zFront],
    [-bw / 2, y - bh / 2, zBack], [bw / 2, y - bh / 2, zBack],
    [bw / 2, y + bh / 2, zBack], [-bw / 2, y + bh / 2, zBack],
  ].flat()
  const indices = [
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    3, 6, 2, 3, 7, 6,
    0, 4, 7, 0, 7, 3,
    1, 6, 5, 1, 2, 6,
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  parent.add(mesh)
  return mesh
}

function wingPoint(side: -1 | 1, upper: boolean, x: number, y: number, z: number): Triple {
  const angle = (upper ? side : -side) * WING_ANGLE
  return [
    x * Math.cos(angle) - y * Math.sin(angle),
    WING_BASE_Y + x * Math.sin(angle) + y * Math.cos(angle),
    z,
  ]
}

function addWing(group: THREE.Group, side: -1 | 1, upper: boolean, hull: THREE.Material, red: THREE.Material,
  panel: THREE.Material) {
  const sideName = side < 0 ? 'port' : 'starboard'
  const halfName = upper ? 'upper' : 'lower'
  const wing = new THREE.Group()
  wing.name = `${sideName}-${halfName}-s-foil`
  wing.position.y = WING_BASE_Y
  wing.rotation.z = (upper ? side : -side) * WING_ANGLE
  group.add(wing)

  deck(wing, `${sideName}-${halfName}-thin-tapered-wing-plate`, [
    [side * 0.82, 0.42],
    [side * WING_TIP_X, 0.95],
    [side * 5.42, 3.62],
    [side * 0.92, 4.35],
  ], 0.12, 0, hull)
  deck(wing, `${sideName}-${halfName}-red-wing-stripe`, [
    [side * 2.05, 1.10],
    [side * 5.08, 1.36],
    [side * 4.78, 1.70],
    [side * 2.00, 1.46],
  ], 0.024, 0.126, red)
  deck(wing, `${sideName}-${halfName}-grey-wing-root-panel`, [
    [side * 0.98, 2.70],
    [side * 2.55, 2.92],
    [side * 2.35, 3.54],
    [side * 1.00, 3.78],
  ], 0.022, 0.128, panel)
}

function addLaserCannon(group: THREE.Group, side: -1 | 1, upper: boolean, barrel: THREE.Material, muzzle: THREE.Material,
  glow: THREE.Material) {
  const sideName = side < 0 ? 'port' : 'starboard'
  const halfName = upper ? 'upper' : 'lower'
  const mountAft = wingPoint(side, upper, side * 5.48, 0.02, 3.52)
  const mountForward = wingPoint(side, upper, side * 5.50, 0.02, 1.08)
  const barrelCenter = wingPoint(side, upper, side * 5.55, 0.04, -2.36)
  const tip = wingPoint(side, upper, side * 5.55, 0.04, -5.98)
  beam(group, `${sideName}-${halfName}-flush-wingtip-cannon-mount`, mountAft, mountForward, 0.135, muzzle, 14)
  cylinder(group, `${sideName}-${halfName}-tapered-laser-cannon-tube`, 0.125, 0.070, 7.10, barrelCenter, 'z', barrel, 16)
  cylinder(group, `${sideName}-${halfName}-flash-suppressor-tip`, 0.100, 0.088, 0.24,
    [tip[0], tip[1], -6.08], 'z', muzzle, 14)
  sphere(group, `${sideName}-${halfName}-laser-emitter-glow`, 0.028, [tip[0], tip[1], -6.17], glow, [1, 1, 1], 10)
}

function addEngine(group: THREE.Group, side: -1 | 1, upper: boolean, body: THREE.Material, dark: THREE.Material,
  intake: THREE.Material, exhaust: THREE.Material) {
  const sideName = side < 0 ? 'port' : 'starboard'
  const halfName = upper ? 'upper' : 'lower'
  const y = upper ? -0.12 : -1.02
  const x = side * 1.28
  cylinder(group, `${sideName}-${halfName}-cylindrical-engine-body`, 0.34, 0.34, 2.24, [x, y, 3.35], 'z', body, 24)
  torus(group, `${sideName}-${halfName}-red-orange-intake-ring`, 0.31, 0.045, [x, y, 2.20], 'z', intake, 28)
  cylinder(group, `${sideName}-${halfName}-dark-intake-core`, 0.22, 0.22, 0.08, [x, y, 2.15], 'z', dark, 20)
  torus(group, `${sideName}-${halfName}-aft-nozzle-ring`, 0.30, 0.040, [x, y, 4.50], 'z', dark, 28)
  sphere(group, `${sideName}-${halfName}-glowing-engine-exhaust`, 0.22, [x, y, 4.56], exhaust, [1, 1, 0.24], 16)
}

function addAstromech(group: THREE.Group, white: THREE.Material, blue: THREE.Material, seam: THREE.Material) {
  cylinder(group, 'astromech-droid-socket', 0.42, 0.44, 0.18, [0, 0.08, 0.88], 'y', seam, 28)
  cylinder(group, 'white-astromech-body-glimpse', 0.30, 0.32, 0.28, [0, 0.25, 0.88], 'y', white, 24)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), white)
  dome.name = 'white-astromech-dome'
  dome.position.set(0, 0.38, 0.88)
  group.add(dome)
  for (const [i, angle] of [0.18, 1.30, 2.85, 4.20, 5.30].entries()) {
    const x = Math.sin(angle) * 0.25
    const z = 0.88 + Math.cos(angle) * 0.25
    const panel = box(group, `astromech-blue-dome-panel-${i}`, [0.12, 0.022, 0.070], [x, 0.58, z], blue)
    panel.rotation.y = angle
  }
  sphere(group, 'astromech-dark-optic', 0.038, [0, 0.62, 0.55], seam, [1, 0.75, 1], 10)
}

function addLandingGear(group: THREE.Group, strut: THREE.Material, pad: THREE.Material) {
  beam(group, 'forward-landing-gear-strut', [0, -0.78, -3.18], [0, -2.64, -3.55], 0.052, strut, 8)
  box(group, 'forward-landing-gear-pad', [0.54, 0.10, 0.62], [0, -2.70, -3.62], pad)
  for (const side of [-1, 1] as const) {
    beam(group, side < 0 ? 'port-main-landing-gear-strut' : 'starboard-main-landing-gear-strut',
      [side * 1.26, -0.88, 2.45], [side * 1.82, -2.62, 3.12], 0.060, strut, 8)
    box(group, side < 0 ? 'port-main-landing-gear-pad' : 'starboard-main-landing-gear-pad',
      [0.78, 0.10, 0.58], [side * 1.92, -2.70, 3.18], pad)
  }
}

function addExteriorPanelLines(group: THREE.Group, seam: THREE.Material, red: THREE.Material, dark: THREE.Material) {
  for (const side of [-1, 1] as const) {
    beam(group, side < 0 ? 'port-nose-top-panel-line' : 'starboard-nose-top-panel-line',
      [side * 0.16, -0.18, -5.72], [side * 0.48, 0.07, -1.42], 0.012, seam, 6)
    box(group, side < 0 ? 'port-forward-red-nose-stripe' : 'starboard-forward-red-nose-stripe',
      [0.070, 0.026, 3.25], [side * 0.27, 0.03, -3.95], red)
    for (let i = 0; i < 4; i++) {
      box(group, side < 0 ? `port-side-service-panel-${i}` : `starboard-side-service-panel-${i}`,
        [0.030, 0.16, 0.42], [side * 0.64, -0.30, -1.20 + i * 1.10], seam)
    }
  }
  for (let i = 0; i < 7; i++) {
    box(group, `aft-dorsal-vent-slat-${i}`, [0.54, 0.024, 0.070], [0, 0.23, 2.36 + i * 0.23], dark)
  }
  box(group, 'port-aft-greeble-box', [0.30, 0.15, 0.64], [-0.42, 0.23, 3.70], seam)
  box(group, 'starboard-aft-greeble-box', [0.25, 0.12, 0.48], [0.46, 0.20, 4.10], seam)
  beam(group, 'exposed-aft-pipe-run', [-0.42, 0.34, 2.78], [0.44, 0.34, 3.55], 0.018, dark, 6)
}

function buildShip(): THREE.Group {
  const group = shipGroup('X-wing T-65 starfighter')
  const hull = metal(0xd4d0bf, 0.66, 0.34)
  const lightGrey = metal(0xa9aaa4, 0.72, 0.32)
  const seam = metal(0x5f625c, 0.78, 0.34)
  const dark = metal(0x252b2b, 0.82, 0.30)
  const red = metal(0xa33d32, 0.68, 0.36)
  const intake = light(0xff7040)
  const exhaust = light(0xff9a38)
  const blue = matte(0x2f6faf, 0.72)
  const white = matte(0xe2e2da, 0.80)
  const canopyGlass = glass(0x36505a, 0.46)

  rectFrustum(group, 'flat-sided-tapered-blunt-nose', -6.22, -1.42, [0.30, 0.24], [1.12, 0.70], -0.32, hull)
  rectFrustum(group, 'narrow-central-fuselage', -1.42, 1.42, [1.12, 0.70], [1.34, 0.78], -0.30, hull)
  rectFrustum(group, 'boxy-aft-fuselage-spine', 1.42, 5.86, [1.34, 0.78], [1.08, 0.64], -0.36, hull)
  box(group, 'squared-rear-service-cap', [1.22, 0.58, 0.40], [0, -0.38, 6.06], lightGrey)

  sphere(group, 'smoky-bubble-canopy-glass', 0.72, [0, 0.16, -0.37], canopyGlass, [0.74, 0.48, 1.22], 24)
  for (const side of [-1, 1] as const) {
    beam(group, side < 0 ? 'port-canopy-lower-frame' : 'starboard-canopy-lower-frame',
      [side * 0.43, -0.05, -1.14], [side * 0.45, 0.04, 0.38], 0.025, seam, 8)
    beam(group, side < 0 ? 'port-canopy-side-strut' : 'starboard-canopy-side-strut',
      [side * 0.44, 0.03, -1.03], [side * 0.30, 0.54, -0.42], 0.022, seam, 8)
    beam(group, side < 0 ? 'port-canopy-rear-frame' : 'starboard-canopy-rear-frame',
      [side * 0.42, 0.04, 0.30], [side * 0.20, 0.48, 0.54], 0.022, seam, 8)
  }
  beam(group, 'canopy-overhead-frame', [-0.28, 0.52, -0.46], [0.28, 0.52, -0.46], 0.018, seam, 8)
  addAstromech(group, white, blue, seam)

  for (const side of [-1, 1] as const) {
    for (const upper of [true, false]) {
      addWing(group, side, upper, hull, red, lightGrey)
      addLaserCannon(group, side, upper, dark, seam, intake)
      addEngine(group, side, upper, lightGrey, dark, intake, exhaust)
    }
  }

  addExteriorPanelLines(group, seam, red, dark)
  addLandingGear(group, seam, dark)
  return group
}

function addCockpitSwitches(parent: THREE.Object3D, side: -1 | 1, frame: THREE.Material, lamp: THREE.Material) {
  for (let i = 0; i < 6; i++) {
    box(parent, side < 0 ? `port-side-toggle-${i}` : `starboard-side-toggle-${i}`,
      [0.035, 0.018, 0.045], [side * 0.058, 0.136, -0.40 + i * 0.13], frame)
    box(parent, side < 0 ? `port-side-amber-lamp-${i}` : `starboard-side-amber-lamp-${i}`,
      [0.014, 0.011, 0.028], [-side * 0.070, 0.138, -0.40 + i * 0.13], lamp)
  }
}

function buildCockpit(): THREE.Group {
  const group = shipGroup('X-wing T-65 cockpit')
  const dark = metal(0x141817, 0.84, 0.26)
  const graphite = metal(0x242a27, 0.78, 0.34)
  const frame = metal(0x787b72, 0.58, 0.48)
  const hull = metal(0xcfcbbc, 0.70, 0.34)
  const red = metal(0x93342e, 0.70, 0.34)
  const green = light(0x70ff66)
  const amber = light(0xffb84a)

  box(group, 'single-seat-cockpit-floor', [1.16, 0.08, 1.70], [0, -1.02, -0.22], dark)
  box(group, 'pilot-seat-back', [0.44, 0.62, 0.13], [0, -0.50, 0.36], graphite)
  box(group, 'pilot-seat-cushion', [0.54, 0.12, 0.50], [0, -0.86, 0.12], graphite)
  rectFrustum(group, 'low-forward-nose-glimpse', -4.40, -1.55, [0.34, 0.16], [0.96, 0.28], -0.94, hull)
  box(group, 'nose-glimpse-red-stripe', [0.10, 0.020, 1.90], [0, -0.78, -2.72], red)

  box(group, 'low-main-dashboard', [1.34, 0.22, 0.18], [0, -0.78, -1.38], graphite)
  box(group, 'dashboard-lower-lip', [1.22, 0.055, 0.24], [0, -0.97, -1.18], frame)
  box(group, 'dark-rudder-pedal-well', [0.72, 0.08, 0.48], [0, -1.12, -0.82], dark)

  for (const side of [-1, 1] as const) {
    const sideName = side < 0 ? 'port' : 'starboard'
    beam(group, `${sideName}-canopy-lower-rail`, [side * 0.70, -0.43, -1.24], [side * 0.94, -0.34, 0.28], 0.036, frame, 8)
    beam(group, `${sideName}-forward-canopy-strut`, [side * 0.68, -0.36, -1.24], [side * 0.50, 0.66, -1.06], 0.032, frame, 8)
    beam(group, `${sideName}-overhead-canopy-rail`, [side * 0.50, 0.66, -1.06], [side * 0.42, 0.80, 0.20], 0.034, frame, 8)
    beam(group, `${sideName}-rear-canopy-frame`, [side * 0.92, -0.28, 0.22], [side * 0.42, 0.80, 0.20], 0.030, frame, 8)
    const console = box(group, `${sideName}-side-console`, [0.34, 0.23, 1.14], [side * 0.86, -0.82, -0.34], graphite)
    console.rotation.z = side * -0.13
    box(console, `${sideName}-console-inset`, [0.24, 0.012, 0.86], [0, 0.122, -0.02], dark)
    addCockpitSwitches(console, side, frame, amber)
    beam(console, `${sideName}-control-yoke-stem`, [0, 0.12, 0.22], [0, 0.30, 0.13], 0.026, frame, 8)
    box(console, `${sideName}-control-yoke-grip`, [0.075, 0.038, 0.060], [0, 0.30, 0.13], dark)
  }
  beam(group, 'overhead-canopy-front-crossbar', [-0.48, 0.65, -1.08], [0.48, 0.65, -1.08], 0.030, frame, 8)
  beam(group, 'overhead-canopy-rear-crossbar', [-0.40, 0.80, 0.16], [0.40, 0.80, 0.16], 0.030, frame, 8)

  const computer = box(group, 'slim-stowed-targeting-computer-housing', [0.18, 0.045, 0.13], [0.72, 0.53, -1.02], dark)
  computer.rotation.y = -0.30
  computer.rotation.z = -0.23
  const computerScreen = box(group, 'slim-stowed-targeting-computer-green-display', [0.12, 0.026, 0.010], [0.69, 0.51, -1.10], green)
  computerScreen.rotation.y = -0.30
  computerScreen.rotation.z = -0.23

  for (let i = 0; i < 7; i++) {
    box(group, `dashboard-amber-toggle-${i}`, [0.034, 0.018, 0.046], [-0.42 + i * 0.14, -0.79, -1.02], frame)
    sphere(group, `dashboard-green-status-lamp-${i}`, 0.011, [-0.42 + i * 0.14, -0.74, -1.04], i % 2 === 0 ? green : amber, [1, 0.65, 1], 8)
  }

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.47, -0.42, -1.34], rotation: [-0.18, 0.10, 0], width: 0.38, height: 0.21 },
      { kind: 'navigation', position: [0, -0.43, -1.35], rotation: [-0.18, 0, 0], width: 0.45, height: 0.22 },
      { kind: 'altitude', position: [0.47, -0.42, -1.34], rotation: [-0.18, -0.10, 0], width: 0.38, height: 0.21 },
    ],
    speedGauge: { position: [-0.31, -0.70, -1.24], rotation: [-0.18, 0, 0] },
    verticalGauge: { position: [0.31, -0.70, -1.24], rotation: [-0.18, 0, 0] },
    heading: { position: [0, -0.73, -1.24], rotation: [-0.18, 0, 0] },
    warpLamp: { position: [0.50, -0.71, -1.24], rotation: [-0.18, 0, 0] },
    throttle: { position: [-0.70, -0.76, -1.21], rotation: [-0.18, 0, 0], step: 0.021 },
    scale: 1.05,
  }, X_WING_PALETTE)
  cabinLight(group, 0xb8ff95, 2.1, 4.5, [0, 0.28, -0.32])
  return group
}

export const xWing: ShipDesign = {
  id: 'x-wing',
  name: 'X-wing',
  kind: 'tribute',
  franchise: 'Star Wars',
  owner: 'Lucasfilm Ltd.',
  blurb: 'T-65 starfighter with its S-foils open in attack position.',
  sizeM: 12.5,
  eyeHeightM: EYE_HEIGHT_M,
  chaseM: [0, 6.5, 22],
  buildShip,
  buildCockpit,
}
