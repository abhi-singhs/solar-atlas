import * as THREE from 'three'
import { mountInstruments } from '../instruments'
import type { DisplayPalette } from '../instruments'
import { beam, box, cabinLight, cylinder, deck, glass, lathe, light, matte, metal, shipGroup, sphere, torus } from '../parts'
import type { ShipDesign } from './types'

const DISC_X = -11.7
const DISC_Z = 6.15
const EYE_HEIGHT_M = 4

const FALCON_PALETTE: DisplayPalette = {
  background: '#130b05',
  grid: '#3a2110',
  frame: '#5a3216',
  title: '#ffb35c',
  primary: '#ffd68a',
  secondary: '#ff9f45',
  footer: '#d46b25',
  housing: 0x2a2119,
  screw: 0x806345,
  gaugeFace: 0x140c07,
  gaugeRing: 0x6b5038,
  tick: 0xffbd6f,
  needle: 0xff7a28,
  compass: 0xd4833d,
  chevron: 0xffb15a,
  lampOff: 0x3b1c0c,
  lampOn: 0xffa13a,
  barOff: 0x2b1810,
  barOn: 0xff8a2d,
}

function frontWindowPoint(radius: number, angle: number, z = -1.32): [number, number, number] {
  return [Math.cos(angle) * radius, Math.sin(angle) * radius, z]
}

function buildCockpit(): THREE.Group {
  const group = shipGroup('Millennium Falcon cockpit')
  const frame = metal(0x5c554a, 0.72, 0.45)
  const dark = metal(0x211b16, 0.82, 0.25)
  const worn = metal(0x8f8777, 0.62, 0.52)
  const rubber = matte(0x16110d)
  const amber = light(0xffa64a)
  const red = light(0xd25a2a)

  box(group, 'cockpit-floor', [1.55, 0.08, 1.78], [0, -0.90, -0.36], dark)
  box(group, 'rear-bulkhead-shadow', [1.82, 1.26, 0.08], [0, -0.18, 0.45], dark)
  box(group, 'pilot-seat-back', [0.46, 0.74, 0.12], [-0.35, -0.42, 0.29], rubber)
  box(group, 'pilot-seat-cushion', [0.52, 0.13, 0.50], [-0.35, -0.80, 0.05], rubber)

  torus(group, 'round-cockpit-forward-rim', 0.84, 0.035, [0, 0, -1.32], 'z', frame, 48)
  torus(group, 'round-cockpit-inner-open-rim', 0.43, 0.018, [0, 0, -1.315], 'z', worn, 40)
  for (const angle of [0.45, 0.86, 1.31, 1.84, 2.30, 3.98, 4.45, 4.98, 5.43, 5.84]) {
    beam(group, 'cockpit-window-radial-strut', frontWindowPoint(0.45, angle), frontWindowPoint(0.82, angle), 0.014, frame, 8)
  }
  for (const z of [-0.92, -0.46, 0.04]) {
    torus(group, 'cockpit-tube-interior-ring', 0.94, 0.026, [0, 0, z], 'z', frame, 40)
  }
  for (const angle of [0.15, 0.88, 2.26, 3.02, 4.02, 5.40]) {
    beam(group, 'cockpit-longitudinal-frame',
      [Math.cos(angle) * 0.91, Math.sin(angle) * 0.91, -1.29],
      [Math.cos(angle) * 0.91, Math.sin(angle) * 0.91, 0.32],
      0.018, frame, 8)
  }

  box(group, 'overhead-switch-bank', [1.10, 0.11, 0.48], [0, 0.70, -0.72], dark)
  for (let i = 0; i < 9; i++) {
    const x = -0.44 + i * 0.11
    box(group, 'overhead-toggle', [0.030, 0.040, 0.022], [x, 0.62, -0.73], worn)
    sphere(group, 'overhead-amber-lamp', 0.018, [x, 0.60, -0.88], i % 3 === 0 ? red : amber, [1, 0.65, 1], 10)
  }

  box(group, 'low-main-console', [1.55, 0.42, 0.10], [0, -0.58, -1.28], dark)
  box(group, 'console-lower-lip', [1.42, 0.08, 0.22], [0, -0.82, -1.10], worn)
  for (const side of [-1, 1]) {
    const sidePanel = box(group, 'angled-side-console', [0.33, 0.23, 1.10], [side * 0.82, -0.72, -0.48], dark)
    sidePanel.rotation.z = side * 0.18
    box(sidePanel, 'side-console-inset', [0.24, 0.012, 0.82], [0, 0.12, -0.02], rubber)
    for (let i = 0; i < 5; i++) {
      box(sidePanel, 'side-console-toggle', [0.035, 0.018, 0.046], [side * 0.060, 0.136, -0.34 + i * 0.14], worn)
      box(sidePanel, 'side-console-status-lamp', [0.012, 0.010, 0.030], [-side * 0.068, 0.137, -0.34 + i * 0.14], i % 2 === 0 ? amber : red)
    }
    beam(group, 'control-yoke-stem', [side * 0.30, -0.70, -0.90], [side * 0.30, -0.54, -1.02], 0.025, worn, 8)
    torus(group, 'control-yoke-grip', 0.095, 0.012, [side * 0.30, -0.52, -1.04], 'z', rubber, 24)
  }

  for (let i = 0; i < 7; i++) {
    box(group, 'console-toggle-row', [0.036, 0.020, 0.052], [-0.42 + i * 0.14, -0.74, -1.01], worn)
    sphere(group, 'console-amber-lamp', 0.012, [-0.42 + i * 0.14, -0.69, -1.02], amber, [1, 0.7, 1], 8)
  }

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.47, -0.48, -1.18], width: 0.38, height: 0.22 },
      { kind: 'navigation', position: [0, -0.49, -1.18], width: 0.43, height: 0.23 },
      { kind: 'altitude', position: [0.47, -0.48, -1.18], width: 0.38, height: 0.22 },
    ],
    speedGauge: { position: [-0.28, -0.69, -1.11] },
    verticalGauge: { position: [0.28, -0.69, -1.11] },
    heading: { position: [0, -0.73, -1.10] },
    warpLamp: { position: [0.50, -0.71, -1.10] },
    throttle: { position: [-0.67, -0.76, -1.08], step: 0.020 },
    scale: 1.05,
  }, FALCON_PALETTE)
  cabinLight(group, 0xffb35c, 1.8, 4.5, [0, 0.25, -0.35])
  return group
}

function addLandingLeg(group: THREE.Group, name: string, x: number, z: number, strut: THREE.Material, pad: THREE.Material) {
  beam(group, `${name}-landing-strut`, [x * 0.98, -2.0, z], [x, -3.84, z + 0.08], 0.060, strut, 8)
  box(group, `${name}-landing-pad`, [0.78, 0.14, 0.56], [x, -3.93, z + 0.08], pad)
}

function addTopGreebles(group: THREE.Group, dark: THREE.Material, rust: THREE.Material, pipe: THREE.Material) {
  const greebles: Array<[number, number, number, number, number, THREE.Material]> = [
    [-17.4, 2.2, 1.20, 0.30, 0.60, dark],
    [-15.6, 6.0, 0.82, 0.24, 0.48, rust],
    [-13.0, 0.6, 0.54, 0.22, 1.22, dark],
    [-10.8, 2.4, 0.72, 0.20, 0.42, dark],
    [-8.6, 7.5, 1.26, 0.28, 0.50, rust],
    [-6.8, 4.8, 0.64, 0.20, 0.96, dark],
    [-18.6, 9.4, 0.92, 0.24, 0.46, dark],
    [-13.8, 12.3, 1.34, 0.26, 0.44, dark],
    [-9.2, 10.7, 0.72, 0.22, 0.80, rust],
  ]
  for (const [i, item] of greebles.entries()) {
    const [x, z, w, h, d, material] = item
    box(group, `dorsal-greeble-box-${i}`, [w, h, d], [x, 1.50 + h / 2, z], material)
  }
  for (let i = 0; i < 8; i++) {
    box(group, 'dorsal-vent-slat', [0.72, 0.035, 0.08], [DISC_X - 4.5 + i * 0.42, 1.57, DISC_Z - 2.7], dark)
  }
  beam(group, 'dorsal-pipe-run', [DISC_X - 6.2, 1.62, DISC_Z + 2.5], [DISC_X - 1.5, 1.63, DISC_Z + 5.0], 0.035, pipe, 8)
  beam(group, 'dorsal-pipe-run', [DISC_X + 1.2, 1.58, DISC_Z + 2.3], [DISC_X + 5.8, 1.58, DISC_Z + 1.0], 0.030, pipe, 8)
  beam(group, 'dorsal-pipe-run', [DISC_X - 5.6, 1.58, DISC_Z + 7.0], [DISC_X - 0.8, 1.60, DISC_Z + 8.4], 0.032, pipe, 8)
}

function addTurret(group: THREE.Group, prefix: string, y: number, top: boolean, hull: THREE.Material, dark: THREE.Material) {
  cylinder(group, `${prefix}-quad-laser-base`, 0.52, 0.58, 0.22, [DISC_X, y, DISC_Z], 'y', dark, 24)
  sphere(group, `${prefix}-quad-laser-dome`, 0.48, [DISC_X, y + (top ? 0.17 : -0.17), DISC_Z], hull, [1, 0.45, 1], 20)
  const barrelY = y + (top ? 0.34 : -0.34)
  for (const side of [-1, 1]) {
    beam(group, `${prefix}-quad-laser-barrel`, [DISC_X + side * 0.16, barrelY, DISC_Z - 0.10], [DISC_X + side * 0.16, barrelY, DISC_Z - 1.28], 0.035, dark, 8)
    beam(group, `${prefix}-quad-laser-barrel`, [DISC_X + side * 0.30, barrelY, DISC_Z - 0.05], [DISC_X + side * 0.30, barrelY, DISC_Z - 1.16], 0.032, dark, 8)
  }
}

function buildShip(): THREE.Group {
  const group = shipGroup('Millennium Falcon YT-1300 light freighter')
  const hull = metal(0xc6c3b8, 0.68, 0.44)
  const hullDark = metal(0x77766f, 0.76, 0.38)
  const seam = metal(0x474944, 0.78, 0.42)
  const rust = metal(0x9b5b45, 0.70, 0.40)
  const mutedRed = metal(0x8d4a3f, 0.72, 0.35)
  const blueGlow = light(0xa8dcff)
  const warmLamp = light(0xffc36a)
  const blackGlass = glass(0x14232a, 0.62)

  lathe(group, 'flattened-domed-disc-hull', [
    [0, 1.62], [3.5, 1.48], [7.8, 1.10], [11.2, 0.42], [12.15, -0.22],
    [11.6, -0.86], [7.7, -1.46], [3.0, -1.82], [0, -1.94],
  ], [DISC_X, -0.34, DISC_Z], 'y', hull, 64)
  torus(group, 'dark-circular-equator-band', 12.12, 0.075, [DISC_X, -0.53, DISC_Z], 'y', seam, 72)

  box(group, 'forward-mandible-root-box', [12.3, 1.05, 2.75], [DISC_X, -0.77, -4.70], hull)
  const mandibles = [
    { name: 'port-forward-mandible', x: DISC_X - 3.35, accentX: DISC_X - 4.15 },
    { name: 'starboard-forward-mandible', x: DISC_X + 3.35, accentX: DISC_X + 4.05 },
  ]
  for (const mandible of mandibles) {
    box(group, mandible.name, [4.35, 0.82, 11.75], [mandible.x, -0.82, -10.45], hull)
    box(group, `${mandible.name}-front-cap`, [4.10, 0.64, 0.42], [mandible.x, -0.70, -16.34], hullDark)
    deck(group, `${mandible.name}-top-panel`, [
      [mandible.x - 1.78, -15.35], [mandible.x + 1.78, -15.35],
      [mandible.x + 1.46, -6.35], [mandible.x - 1.46, -6.35],
    ], 0.045, -0.33, hullDark)
    deck(group, `${mandible.name}-muted-red-panel`, [
      [mandible.accentX - 0.58, -12.9], [mandible.accentX + 0.58, -12.9],
      [mandible.accentX + 0.45, -9.2], [mandible.accentX - 0.45, -9.2],
    ], 0.050, -0.27, mutedRed)
    for (let i = 0; i < 5; i++) {
      box(group, `${mandible.name}-side-greeble`, [0.32, 0.18, 0.58], [mandible.x + (i % 2 === 0 ? -1.85 : 1.85), -0.24, -13.8 + i * 1.45], seam)
    }
  }
  box(group, 'dark-slot-between-forward-mandibles', [2.25, 0.10, 9.75], [DISC_X, -0.29, -10.85], seam)

  beam(group, 'starboard-cockpit-neck', [-2.00, -0.18, 1.75], [-0.38, -0.10, -0.40], 0.76, hull, 24)
  for (const t of [0.18, 0.42, 0.66, 0.90]) {
    const x = THREE.MathUtils.lerp(-2.00, -0.38, t)
    const z = THREE.MathUtils.lerp(1.75, -0.40, t)
    torus(group, 'cockpit-neck-ring', 0.78, 0.030, [x, -0.13, z], 'z', seam, 28)
  }
  cylinder(group, 'round-starboard-cockpit-pod', 1.10, 1.18, 1.66, [0, -0.04, -0.78], 'z', hull, 32)
  torus(group, 'cockpit-forward-window-rim', 0.82, 0.055, [0, -0.04, -1.63], 'z', seam, 36)
  torus(group, 'cockpit-forward-window-inner-rim', 0.36, 0.026, [0, -0.04, -1.635], 'z', seam, 32)
  const pane = new THREE.Mesh(new THREE.CircleGeometry(0.33, 28), blackGlass)
  pane.name = 'cockpit-forward-dark-pane'
  pane.position.set(0, -0.04, -1.64)
  pane.material.side = THREE.DoubleSide
  group.add(pane)
  for (const angle of [0.42, 0.90, 1.38, 1.92, 2.46, 3.82, 4.36, 4.90, 5.38, 5.86]) {
    beam(group, 'cockpit-exterior-window-strut',
      [Math.cos(angle) * 0.40, -0.04 + Math.sin(angle) * 0.40, -1.655],
      [Math.cos(angle) * 0.78, -0.04 + Math.sin(angle) * 0.78, -1.655],
      0.016, seam, 8)
  }

  for (let i = 0; i < 18; i++) {
    const angle = i * Math.PI * 2 / 18
    if (Math.cos(angle) < -0.25 && Math.sin(angle) > -0.55) continue
    beam(group, 'raised-radial-panel-line',
      [DISC_X + Math.sin(angle) * 2.2, 1.32, DISC_Z + Math.cos(angle) * 2.2],
      [DISC_X + Math.sin(angle) * 10.9, 1.44, DISC_Z + Math.cos(angle) * 10.9],
      0.025, seam, 6)
  }
  torus(group, 'port-circular-access-ring', 1.46, 0.035, [DISC_X - 5.5, 1.48, DISC_Z + 1.8], 'y', seam, 40)
  torus(group, 'starboard-circular-access-ring', 1.28, 0.035, [DISC_X + 4.1, 1.45, DISC_Z + 2.8], 'y', seam, 40)
  torus(group, 'aft-circular-maintenance-ring', 1.10, 0.030, [DISC_X - 1.2, 1.50, DISC_Z + 7.5], 'y', seam, 36)
  deck(group, 'port-grey-hull-panel', [
    [DISC_X - 9.7, DISC_Z - 1.8], [DISC_X - 7.4, DISC_Z - 2.4],
    [DISC_X - 6.5, DISC_Z + 0.2], [DISC_X - 8.7, DISC_Z + 0.9],
  ], 0.045, 1.47, hullDark)
  deck(group, 'starboard-rust-hull-panel', [
    [DISC_X + 5.4, DISC_Z + 0.8], [DISC_X + 7.8, DISC_Z + 1.4],
    [DISC_X + 6.8, DISC_Z + 3.7], [DISC_X + 4.7, DISC_Z + 2.9],
  ], 0.045, 1.46, rust)
  deck(group, 'aft-muted-red-hull-panel', [
    [DISC_X - 3.4, DISC_Z + 9.2], [DISC_X - 0.9, DISC_Z + 8.7],
    [DISC_X - 0.2, DISC_Z + 10.8], [DISC_X - 2.8, DISC_Z + 11.3],
  ], 0.045, 1.42, mutedRed)
  addTopGreebles(group, seam, rust, hullDark)

  beam(group, 'rectangular-sensor-dish-mast', [DISC_X - 5.0, 1.55, DISC_Z - 5.0], [DISC_X - 5.2, 2.95, DISC_Z - 5.30], 0.075, seam, 8)
  const dish = box(group, 'rectangular-top-sensor-dish', [2.10, 0.12, 1.20], [DISC_X - 5.55, 3.15, DISC_Z - 5.70], hullDark)
  dish.rotation.x = -0.35
  dish.rotation.z = -0.18
  const dishFace = box(group, 'sensor-dish-face-glow', [1.70, 0.018, 0.84], [DISC_X - 5.55, 3.22, DISC_Z - 5.91], warmLamp)
  dishFace.rotation.x = -0.35

  addTurret(group, 'dorsal', 1.60, true, hull, seam)
  addTurret(group, 'ventral', -2.46, false, hull, seam)

  for (let i = 0; i < 22; i++) {
    const angle = -0.95 + i * (1.90 / 21)
    const x = DISC_X + Math.sin(angle) * 11.70
    const z = DISC_Z + Math.cos(angle) * 11.78
    const housing = box(group, 'aft-engine-dark-housing', [0.74, 0.24, 0.16], [x, -0.55, z - 0.04], seam)
    housing.rotation.y = -angle
    const glow = box(group, 'curved-aft-blue-white-engine-glow', [0.62, 0.13, 0.10], [x, -0.55, z + 0.07], blueGlow)
    glow.rotation.y = -angle
  }

  for (const [i, position] of [[DISC_X - 6.5, DISC_Z - 0.5], [DISC_X + 5.4, DISC_Z + 0.4],
    [DISC_X - 7.7, DISC_Z + 7.7], [DISC_X + 5.8, DISC_Z + 7.4], [DISC_X, DISC_Z + 2.8],
    [DISC_X - 3.4, -12.6], [DISC_X + 3.4, -12.6]].entries()) {
    addLandingLeg(group, `gear-${i}`, position[0], position[1], seam, seam)
  }

  return group
}

export const millenniumFalcon: ShipDesign = {
  id: 'millennium-falcon',
  name: 'Millennium Falcon',
  kind: 'tribute',
  franchise: 'Star Wars',
  owner: 'Lucasfilm Ltd.',
  blurb: 'A modified YT-1300 light freighter with a saucer hull, forward mandibles, and an offset cockpit.',
  sizeM: 34.75,
  eyeHeightM: EYE_HEIGHT_M,
  chaseM: [-11.4, 14.5, 58],
  buildShip,
  buildCockpit,
}
