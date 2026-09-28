import * as THREE from 'three'
import { mountInstruments } from '../instruments'
import type { DisplayPalette } from '../instruments'
import { beam, box, cabinLight, cylinder, glass, light, metal, matte, plate, shipGroup, sphere, torus, lathe } from '../parts'
import type { ShipDesign } from './types'

const PLANET_EXPRESS_PALETTE: DisplayPalette = {
  background: '#0b3b3d',
  grid: '#236f6d',
  frame: '#62aaa0',
  title: '#b9f6df',
  primary: '#eefbd2',
  secondary: '#f8a13b',
  footer: '#c6ead7',
  titleFont: '"Trebuchet MS", sans-serif',
  monoFont: '"Courier New", monospace',
  housing: 0x0f6b68,
  screw: 0xbfc7b2,
  gaugeFace: 0x063033,
  gaugeRing: 0x7bc5b2,
  tick: 0xcdf4dc,
  needle: 0xff7a28,
  compass: 0xb8ead6,
  chevron: 0xff7a28,
  lampOff: 0x38504a,
  lampOn: 0xff9b2f,
  barOff: 0x235753,
  barOn: 0xff7a28,
}

type Triple = readonly [number, number, number]

function addDome(parent: THREE.Object3D, name: string, position: Triple, scale: Triple, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), material)
  mesh.name = name
  mesh.position.set(position[0], position[1], position[2])
  mesh.scale.set(scale[0], scale[1], scale[2])
  parent.add(mesh)
  return mesh
}

function centeredVerticalPlate(parent: THREE.Object3D, name: string, points: number[][], thickness: number, material: THREE.Material) {
  const mesh = plate(parent, name, points, thickness, material)
  mesh.rotation.y = -Math.PI / 2
  mesh.position.x = thickness / 2
  return mesh
}

function roundedFoot(parent: THREE.Object3D, name: string, x: number, z: number, material: THREE.Material) {
  cylinder(parent, `${name}-round-pad`, 0.62, 0.62, 0.22, [x, -6.89, z], 'y', material, 40)
  sphere(parent, `${name}-rubber-foot-cap`, 0.38, [x, -6.79, z], material, [1.45, 0.18, 1.1], 24)
}

function buildShip(): THREE.Group {
  const group = shipGroup('Planet Express Ship tribute')
  const hull = matte(0x32b88b, 0.58)
  const darkerGreen = matte(0x217a63, 0.68)
  const trim = metal(0x8b9488, 0.43, 0.68)
  const darkTrim = metal(0x343a38, 0.54, 0.62)
  const rubber = matte(0x262825, 0.82)
  const fin = matte(0xe7552c, 0.62)
  const engineGlow = light(0xff5a22)
  const engineCore = light(0xffbd44)
  const windowGlass = glass(0x98e6f2, 0.54)

  lathe(group, 'smooth-bulbous-green-teardrop-hull', [
    [0.08, -7.35],
    [0.62, -7.10],
    [1.65, -6.42],
    [2.82, -5.30],
    [3.72, -3.78],
    [4.18, -1.55],
    [4.30, 1.20],
    [4.08, 4.25],
    [3.58, 7.70],
    [2.90, 11.45],
    [2.18, 15.45],
    [1.55, 18.95],
    [1.16, 20.60],
  ], [0, -2.66, 0], 'z', hull, 96)

  const noseBand = torus(group, 'darker-green-nose-trim-ring', 3.86, 0.050, [0, -2.66, -3.85], 'z', darkerGreen, 80)
  noseBand.scale.y = 0.98
  torus(group, 'darker-green-mid-hull-seam-ring', 3.72, 0.044, [0, -2.66, 5.70], 'z', darkerGreen, 80)
  torus(group, 'grey-tail-collar-ring', 1.56, 0.070, [0, -2.66, 18.95], 'z', trim, 64)

  addDome(group, 'domed-bubble-windshield-glass', [0, 0.12, -1.74], [2.26, 2.34, 2.36], windowGlass)
  const domeRim = torus(group, 'thin-grey-windshield-rim', 1, 0.050, [0, 0.38, -1.74], 'y', trim, 80)
  domeRim.scale.set(2.30, 1, 2.40)
  beam(group, 'left-windshield-side-frame', [-2.06, 0.20, -3.08], [-1.42, 1.12, -0.35], 0.037, trim, 12)
  beam(group, 'right-windshield-side-frame', [2.06, 0.20, -3.08], [1.42, 1.12, -0.35], 0.037, trim, 12)

  cylinder(group, 'single-flared-rear-engine-nozzle', 1.28, 0.74, 1.70, [0, -2.66, 21.42], 'z', darkTrim, 64)
  torus(group, 'thick-rear-engine-lip', 1.28, 0.105, [0, -2.66, 22.27], 'z', trim, 64)
  cylinder(group, 'orange-red-engine-glow', 0.86, 0.86, 0.08, [0, -2.66, 22.36], 'z', engineGlow, 48)
  cylinder(group, 'yellow-engine-core', 0.38, 0.38, 0.09, [0, -2.66, 22.41], 'z', engineCore, 32)

  centeredVerticalPlate(group, 'tall-swept-orange-tail-fin', [
    [14.10, -0.90],
    [20.32, -0.90],
    [18.98, 3.12],
    [15.80, 1.88],
  ], 0.18, fin)
  sphere(group, 'rounded-tail-fin-tip', 0.22, [0, 3.02, 18.90], fin, [0.50, 0.62, 1.0], 18)

  for (const side of [-1, 1]) {
    const s = side
    const sideFin = plate(group, `${s < 0 ? 'left' : 'right'}-small-side-fin`, [
      [1.70, -0.45],
      [3.10, 0.18],
      [4.90, 3.85],
      [3.18, 3.10],
      [1.62, 1.18],
    ], 0.16, darkerGreen)
    sideFin.rotation.x = -Math.PI / 2
    sideFin.scale.x = s
    sideFin.position.y = -2.38
    sideFin.position.z = 14.05
    box(group, `${s < 0 ? 'left' : 'right'}-orange-fin-edge`, [0.10, 0.075, 2.25], [s * 4.08, -2.22, 18.82], fin)

    beam(group, `${s < 0 ? 'left' : 'right'}-rear-landing-leg-forward-strut`, [s * 1.64, -5.10, 10.55], [s * 2.74, -6.78, 12.08], 0.055, trim, 12)
    beam(group, `${s < 0 ? 'left' : 'right'}-rear-landing-leg-aft-strut`, [s * 1.35, -5.00, 13.82], [s * 2.74, -6.78, 12.08], 0.055, trim, 12)
    roundedFoot(group, `${s < 0 ? 'left' : 'right'}-rear-landing-foot`, s * 2.74, 12.08, rubber)
  }

  beam(group, 'front-landing-leg-forward-strut', [0, -4.98, -5.62], [0, -6.78, -5.80], 0.058, trim, 12)
  beam(group, 'front-landing-leg-brace-left', [-0.52, -4.82, -4.86], [0, -6.78, -5.80], 0.038, trim, 10)
  beam(group, 'front-landing-leg-brace-right', [0.52, -4.82, -4.86], [0, -6.78, -5.80], 0.038, trim, 10)
  roundedFoot(group, 'front-landing-foot', 0, -5.80, rubber)

  for (let i = 0; i < 7; i++) {
    box(group, 'dark-green-belly-vent', [0.12 + i * 0.018, 0.045, 0.44], [-0.58 + i * 0.19, -6.30, 4.60 + i * 0.25], darkerGreen)
  }
  for (const side of [-1, 1]) {
    const s = side
    for (let i = 0; i < 4; i++) {
      sphere(group, 'small-grey-hull-fastener', 0.055, [s * (2.25 + i * 0.18), -0.34, 2.85 + i * 2.15], trim, [1, 0.55, 1], 10)
    }
  }

  return group
}

function buildCockpit(): THREE.Group {
  const group = shipGroup('Planet Express Ship cockpit')
  const teal = matte(0x0c7772, 0.70)
  const darkTeal = matte(0x064447, 0.78)
  const lightTeal = matte(0x5fb9a7, 0.62)
  const trim = metal(0xb7c0ad, 0.42, 0.62)
  const cream = matte(0xe5e8c7, 0.68)
  const dark = matte(0x1b2523, 0.84)
  const buttonGlow = light(0xff9b2f)

  const window = torus(group, 'wide-open-curved-window-frame', 0.70, 0.045, [0, 0.06, -1.50], 'z', trim, 72)
  window.scale.set(1.95, 0.72, 1)
  beam(group, 'left-window-side-post', [-1.30, -0.33, -1.40], [-1.54, 0.48, -1.10], 0.042, lightTeal, 12)
  beam(group, 'right-window-side-post', [1.30, -0.33, -1.40], [1.54, 0.48, -1.10], 0.042, lightTeal, 12)
  beam(group, 'upper-window-brow', [-0.96, 0.57, -1.39], [0.96, 0.57, -1.39], 0.034, lightTeal, 12)

  const dash = plate(group, 'curved-retro-teal-dashboard', [
    [-1.24, -0.96],
    [-1.24, -0.58],
    [-0.98, -0.43],
    [-0.36, -0.37],
    [0.36, -0.37],
    [0.98, -0.43],
    [1.24, -0.58],
    [1.24, -0.96],
  ], 0.24, teal)
  dash.position.z = -1.69
  box(group, 'dark-teal-dashboard-shadow-lip', [2.20, 0.060, 0.070], [0, -0.98, -1.44], darkTeal)
  box(group, 'cream-dashboard-upper-trim', [1.60, 0.050, 0.055], [0, -0.43, -1.45], cream)

  for (const x of [-0.92, -0.74, -0.56, 0.56, 0.74, 0.92]) {
    sphere(group, 'big-orange-dashboard-button', 0.044, [x, -0.60, -1.31], buttonGlow, [1, 1, 0.50], 16)
  }
  for (const x of [-0.32, -0.20, -0.08, 0.08, 0.20, 0.32]) {
    cylinder(group, 'cream-toggle-switch-base', 0.030, 0.030, 0.018, [x, -0.79, -1.30], 'z', cream, 14)
    beam(group, 'tiny-teal-toggle-switch', [x, -0.78, -1.28], [x + 0.018, -0.70, -1.30], 0.010, trim, 8)
  }

  const wheel = torus(group, 'small-retro-steering-wheel', 0.19, 0.018, [0, -0.91, -0.95], 'z', dark, 48)
  wheel.rotation.x = -0.20
  beam(group, 'steering-wheel-left-spoke', [0, -0.91, -0.93], [-0.16, -0.91, -0.95], 0.010, trim, 8)
  beam(group, 'steering-wheel-right-spoke', [0, -0.91, -0.93], [0.16, -0.91, -0.95], 0.010, trim, 8)
  beam(group, 'steering-wheel-column', [0, -1.00, -0.76], [0, -0.91, -0.95], 0.032, trim, 12)

  box(group, 'captains-chair-back-hint', [0.72, 0.78, 0.16], [0, -0.45, 0.52], darkTeal)
  box(group, 'captains-chair-seat-hint', [0.80, 0.16, 0.58], [0, -0.93, 0.28], dark)
  for (const side of [-1, 1]) {
    const s = side
    const console = box(group, `${s < 0 ? 'left' : 'right'}-rounded-side-console`, [0.36, 0.22, 1.08], [s * 0.92, -0.86, -0.42], darkTeal)
    console.rotation.z = s * 0.12
    box(console, 'teal-console-face', [0.27, 0.018, 0.82], [0, 0.12, 0], teal)
    for (let i = 0; i < 5; i++) {
      sphere(console, 'orange-console-button', 0.024, [-0.08 + i * 0.040, 0.139, -0.30 + i * 0.12], buttonGlow, [1, 1, 0.45], 10)
    }
  }
  sphere(group, 'ceiling-amber-cabin-bulb', 0.042, [0, 0.53, -0.72], buttonGlow, [1, 1, 1], 16)

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.58, -0.57, -1.37], rotation: [-0.20, 0.03, 0], width: 0.44, height: 0.210 },
      { kind: 'navigation', position: [0, -0.54, -1.39], rotation: [-0.20, 0, 0], width: 0.52, height: 0.224 },
      { kind: 'altitude', position: [0.58, -0.57, -1.37], rotation: [-0.20, -0.03, 0], width: 0.44, height: 0.210 },
    ],
    speedGauge: { position: [-0.35, -0.77, -1.31], rotation: [-0.18, 0, 0] },
    verticalGauge: { position: [0.35, -0.77, -1.31], rotation: [-0.18, 0, 0] },
    heading: { position: [0, -0.795, -1.30], rotation: [-0.18, 0, 0] },
    warpLamp: { position: [0.20, -0.80, -1.29], rotation: [-0.18, 0, 0] },
    throttle: { position: [-0.74, -0.83, -1.29], rotation: [-0.18, 0, 0], step: 0.022 },
    scale: 1.12,
  }, PLANET_EXPRESS_PALETTE)
  cabinLight(group, 0x96f5d6, 2.2, 5.5, [0, 0.32, -0.38])
  return group
}

export const planetExpress: ShipDesign = {
  id: 'planet-express',
  name: 'Planet Express Ship',
  kind: 'tribute',
  franchise: 'Futurama',
  owner: '20th Television',
  blurb: 'The delivery ship with the domed windshield and the tail fin.',
  sizeM: 30.2,
  eyeHeightM: 7,
  chaseM: [0, 17, 58],
  buildShip,
  buildCockpit,
}
