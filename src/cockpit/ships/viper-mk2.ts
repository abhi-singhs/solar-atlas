import * as THREE from 'three'
import type { DisplayPalette } from '../instruments'
import { mountInstruments } from '../instruments'
import { beam, box, cabinLight, cylinder, glass, lathe, light, matte, metal, place, plate, shipGroup, sphere, torus } from '../parts'
import type { ShipDesign } from './types'

const VIPER_PALETTE: DisplayPalette = {
  background: '#15180e',
  grid: '#3f3a16',
  frame: '#685422',
  title: '#e2b962',
  primary: '#ffc96a',
  secondary: '#c89944',
  footer: '#8f7732',
  housing: 0x1f261a,
  screw: 0x6a653a,
  gaugeFace: 0x11140b,
  gaugeRing: 0x5d542b,
  tick: 0xd8ae55,
  needle: 0xffc15a,
  compass: 0xb58e3d,
  chevron: 0xf1b54d,
  lampOff: 0x33260b,
  lampOn: 0xffa733,
  barOff: 0x2d331a,
  barOn: 0xd48b2a,
}

function deckPlate(parent: THREE.Object3D, name: string, points: number[][], y: number, material: THREE.Material) {
  const mesh = plate(parent, name, points.map(([x, z]) => [x, -z]), 0.055, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  return mesh
}

function verticalFin(parent: THREE.Object3D, name: string, points: number[][], position: readonly [number, number, number],
  material: THREE.Material, side = 1) {
  const fin = plate(parent, name, points, 0.060, material)
  fin.rotation.y = side * Math.PI / 2
  fin.position.set(position[0], position[1], position[2])
  return fin
}

function glowingDisk(parent: THREE.Object3D, name: string, radius: number, position: readonly [number, number, number],
  material: THREE.Material) {
  return place(parent, name, new THREE.Mesh(new THREE.CircleGeometry(radius, 28), material), position)
}

function buildShip(): THREE.Group {
  const group = shipGroup('Viper Mk II tribute')
  const hull = metal(0xd6d2c2, 0.58, 0.42)
  const panel = metal(0x9da0a0, 0.64, 0.36)
  const dark = metal(0x252a28, 0.72, 0.42)
  const black = metal(0x080a09, 0.78, 0.28)
  const red = matte(0x9e2f25, 0.78)
  const exhaustGlow = light(0xff9a32)
  const canopyGlass = glass(0x1c2c31, 0.72)

  const fuselage = lathe(group, 'slim-pointed-fuselage', [
    [0.025, -2.62],
    [0.16, -2.42],
    [0.34, -1.82],
    [0.50, -0.82],
    [0.66, 0.92],
    [0.72, 3.05],
    [0.62, 4.55],
    [0.46, 5.28],
  ], [0, -0.33, 0], 'z', hull, 36)
  fuselage.scale.y = 0.66

  const noseCap = sphere(group, 'needle-nose-cap', 0.16, [0, -0.34, -2.62], hull, [0.55, 0.36, 1.45], 18)
  noseCap.rotation.x = Math.PI / 2
  deckPlate(group, 'red-nose-dorsal-flash', [[-0.18, -2.28], [0, -2.58], [0.18, -2.28], [0.13, -0.78], [-0.13, -0.78]], -0.03, red)
  deckPlate(group, 'grey-spine-panel', [[-0.21, 0.28], [0.21, 0.28], [0.25, 3.90], [-0.25, 3.90]], 0.15, panel)

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), canopyGlass)
  canopy.name = 'framed-forward-bubble-canopy'
  canopy.scale.set(0.46, 0.34, 0.82)
  canopy.position.set(0, -0.08, -0.70)
  group.add(canopy)
  for (const side of [-1, 1] as const) {
    const sideName = side < 0 ? 'port' : 'starboard'
    beam(group, `${sideName}-canopy-side-rail`, [side * 0.40, -0.10, -1.34], [side * 0.44, -0.02, 0.08], 0.026, dark)
    beam(group, `${sideName}-canopy-forward-post`, [side * 0.34, -0.11, -1.34], [side * 0.25, 0.22, -1.13], 0.020, dark)
    beam(group, `${sideName}-canopy-rear-post`, [side * 0.43, -0.02, 0.05], [side * 0.30, 0.20, -0.10], 0.020, dark)
    beam(group, `${sideName}-canopy-roof-strut`, [side * 0.22, 0.23, -1.05], [side * 0.24, 0.25, -0.10], 0.018, dark)
  }
  beam(group, 'canopy-overhead-bow', [-0.24, 0.24, -0.50], [0.24, 0.24, -0.50], 0.018, dark)

  for (const side of [-1, 1] as const) {
    const sideName = side < 0 ? 'port' : 'starboard'
    const wing = deckPlate(group, `${sideName}-stub-wing-anhedral`, [
      [0.48, 1.48],
      [2.34, 2.10],
      [2.56, 4.42],
      [0.72, 3.88],
    ], -0.66, hull)
    wing.scale.x = side
    wing.rotation.z = -side * 0.085
    const stripe = deckPlate(group, `${sideName}-red-wing-stripe`, [
      [1.06, 1.88],
      [1.40, 2.00],
      [1.64, 4.06],
      [1.28, 3.96],
    ], -0.58, red)
    stripe.scale.x = side
    stripe.rotation.z = -side * 0.085
    const tipFin = verticalFin(group, `${sideName}-small-wingtip-fin`, [
      [-0.36, -0.16],
      [0.28, -0.18],
      [0.17, 0.44],
      [-0.20, 0.30],
    ], [side * 2.50, -0.65, 3.42], hull, side)
    tipFin.rotation.z = -side * 0.07
    box(group, `${sideName}-red-wingtip-fin-flash`, [0.035, 0.38, 0.090], [side * 2.54, -0.45, 3.45], red)
    const intake = box(group, `${sideName}-dark-side-air-intake`, [0.10, 0.30, 1.24], [side * 0.78, -0.34, 1.34], black)
    intake.rotation.y = side * 0.10
    box(group, `${sideName}-intake-upper-lip`, [0.12, 0.055, 1.38], [side * 0.75, -0.16, 1.34], panel).rotation.y = side * 0.10
    box(group, `${sideName}-intake-lower-lip`, [0.12, 0.050, 1.28], [side * 0.75, -0.52, 1.38], panel).rotation.y = side * 0.10
    cylinder(group, `${sideName}-nose-gun-barrel`, 0.035, 0.045, 0.72, [side * 0.27, -0.47, -2.50], 'z', dark, 14)
    cylinder(group, `${sideName}-nose-gun-muzzle`, 0.045, 0.045, 0.045, [side * 0.27, -0.47, -2.88], 'z', black, 14)
    beam(group, `${sideName}-landing-main-strut`, [side * 0.92, -0.82, 2.62], [side * 1.22, -2.67, 2.82], 0.045, dark)
    box(group, `${sideName}-landing-main-pad`, [0.46, 0.08, 0.62], [side * 1.22, -2.71, 2.82], dark)
  }

  const tailFin = verticalFin(group, 'tall-dorsal-tail-fin', [
    [-0.72, -0.08],
    [0.76, -0.04],
    [0.48, 1.26],
    [-0.16, 1.54],
  ], [-0.03, -0.03, 4.18], hull)
  tailFin.rotation.z = 0.02
  verticalFin(group, 'red-tail-fin-flash', [
    [-0.26, 0.10],
    [0.46, 0.12],
    [0.32, 0.84],
    [-0.04, 0.96],
  ], [-0.065, 0.02, 4.36], red)

  const enginePositions: readonly (readonly [string, number, number])[] = [
    ['port-lower', -0.43, -0.48],
    ['starboard-lower', 0.43, -0.48],
    ['upper', 0, 0.18],
  ]
  for (const [name, x, y] of enginePositions) {
    cylinder(group, `${name}-rear-engine-casing`, 0.32, 0.27, 1.02, [x, y, 5.10], 'z', dark, 24)
    torus(group, `${name}-engine-rim`, 0.30, 0.045, [x, y, 5.64], 'z', panel, 28)
    glowingDisk(group, `${name}-orange-engine-exhaust`, 0.245, [x, y, 5.69], exhaustGlow)
  }
  box(group, 'tri-engine-rear-plate', [1.35, 0.18, 0.18], [0, -0.22, 4.55], dark)
  box(group, 'upper-engine-neck-fairing', [0.48, 0.38, 0.68], [0, 0.02, 4.72], dark)

  beam(group, 'nose-landing-strut', [0, -0.78, -1.42], [0, -2.67, -1.56], 0.042, dark)
  box(group, 'nose-landing-pad', [0.34, 0.08, 0.48], [0, -2.71, -1.56], dark)

  for (let i = 0; i < 5; i++) {
    box(group, `starboard-fuselage-panel-line-${i}`, [0.030, 0.018, 0.42], [0.54, -0.02, 0.38 + i * 0.62], panel)
    box(group, `port-fuselage-panel-line-${i}`, [0.030, 0.018, 0.42], [-0.54, -0.02, 0.38 + i * 0.62], panel)
  }

  return group
}

function buildCockpit(): THREE.Group {
  const group = shipGroup('Viper Mk II cockpit')
  const olive = metal(0x26301d, 0.78, 0.32)
  const darkOlive = metal(0x151a10, 0.86, 0.24)
  const trim = metal(0x4f5730, 0.68, 0.38)
  const amber = light(0xd8962f)
  const dimAmber = light(0x78571e)

  box(group, 'compact-forward-dashboard', [1.18, 0.24, 0.48], [0, -0.69, -1.22], darkOlive)
  box(group, 'dashboard-armored-brow', [1.34, 0.08, 0.20], [0, -0.50, -1.34], olive)
  box(group, 'lower-knee-panel', [0.92, 0.12, 0.62], [0, -0.92, -0.86], olive)
  box(group, 'central-pedal-well', [0.62, 0.08, 0.42], [0, -1.09, -0.62], darkOlive)

  for (const side of [-1, 1] as const) {
    const sideName = side < 0 ? 'port' : 'starboard'
    beam(group, `${sideName}-canopy-side-sill`, [side * 0.61, -0.47, -1.46], [side * 0.70, -0.40, 0.28], 0.035, olive)
    beam(group, `${sideName}-canopy-forward-strut`, [side * 0.57, -0.42, -1.43], [side * 0.46, 0.46, -1.36], 0.030, trim)
    beam(group, `${sideName}-canopy-roof-rail`, [side * 0.46, 0.46, -1.36], [side * 0.64, 0.55, 0.20], 0.032, trim)
    beam(group, `${sideName}-overhead-aft-strut`, [side * 0.42, 0.58, -0.54], [side * 0.64, 0.55, 0.20], 0.026, trim)
    const console = box(group, `${sideName}-narrow-side-console`, [0.30, 0.22, 1.10], [side * 0.74, -0.78, -0.38], darkOlive)
    console.rotation.z = side * 0.13
    box(console, `${sideName}-console-raised-lip`, [0.22, 0.018, 0.84], [0, 0.120, -0.03], trim)
    for (let i = 0; i < 5; i++) {
      box(console, `${sideName}-amber-toggle-${i}`, [0.038, 0.018, 0.044], [side * 0.052, 0.138, -0.38 + i * 0.12], amber)
      box(console, `${sideName}-dark-toggle-guard-${i}`, [0.058, 0.012, 0.060], [-side * 0.060, 0.136, -0.38 + i * 0.12], trim)
    }
  }
  beam(group, 'forward-overhead-canopy-bow', [-0.44, 0.47, -1.36], [0.44, 0.47, -1.36], 0.030, trim)
  beam(group, 'mid-overhead-canopy-bow', [-0.46, 0.59, -0.56], [0.46, 0.59, -0.56], 0.026, trim)

  beam(group, 'flight-stick-column', [0, -0.93, -0.52], [0, -0.58, -0.70], 0.030, darkOlive)
  box(group, 'flight-stick-grip', [0.10, 0.15, 0.075], [0, -0.50, -0.73], trim)
  box(group, 'flight-stick-amber-trigger', [0.040, 0.028, 0.030], [0, -0.46, -0.77], amber)
  box(group, 'left-foot-rest', [0.22, 0.025, 0.20], [-0.22, -1.03, -0.84], trim)
  box(group, 'right-foot-rest', [0.22, 0.025, 0.20], [0.22, -1.03, -0.84], trim)
  for (let i = 0; i < 4; i++) {
    box(group, `dashboard-amber-status-light-${i}`, [0.045, 0.014, 0.030], [-0.30 + i * 0.20, -0.515, -1.225], dimAmber)
  }

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.47, -0.42, -1.36], rotation: [-0.24, 0.10, 0], width: 0.36, height: 0.18 },
      { kind: 'navigation', position: [0, -0.43, -1.38], rotation: [-0.24, 0, 0], width: 0.44, height: 0.19 },
      { kind: 'altitude', position: [0.47, -0.42, -1.36], rotation: [-0.24, -0.10, 0], width: 0.36, height: 0.18 },
    ],
    speedGauge: { position: [-0.28, -0.64, -1.28], rotation: [-0.26, 0, 0] },
    verticalGauge: { position: [0.28, -0.64, -1.28], rotation: [-0.26, 0, 0] },
    heading: { position: [0, -0.65, -1.27], rotation: [-0.26, 0, 0] },
    warpLamp: { position: [0.19, -0.66, -1.27], rotation: [-0.26, 0, 0] },
    throttle: { position: [-0.66, -0.69, -1.20], rotation: [-0.26, 0, 0], step: 0.021 },
    scale: 0.95,
  }, VIPER_PALETTE)
  cabinLight(group, 0xb78137, 2.2, 4.4, [0, 0.24, -0.38])
  return group
}

export const viperMk2: ShipDesign = {
  id: 'viper-mk2',
  name: 'Viper Mk II',
  kind: 'tribute',
  franchise: 'Battlestar Galactica',
  owner: 'Universal Content Productions',
  blurb: 'Colonial space superiority fighter with three engines.',
  sizeM: 8.5,
  eyeHeightM: 2.75,
  chaseM: [0, 5.2, 17.5],
  buildShip,
  buildCockpit,
}
