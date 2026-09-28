import * as THREE from 'three'
import { mountInstruments } from '../instruments'
import type { DisplayPalette } from '../instruments'
import { beam, box, cabinLight, cylinder, deck, glass, light, metal, matte, plate, shipGroup, sphere, torus, lathe } from '../parts'
import type { ShipDesign } from './types'

const NEEDLE_PALETTE: DisplayPalette = {
  background: '#030b18',
  grid: '#0e3148',
  frame: '#19d9ff',
  title: '#7ceeff',
  primary: '#d9fbff',
  secondary: '#70e7ff',
  footer: '#5aa9ff',
  titleFont: '"Segoe UI", sans-serif',
  monoFont: '"Consolas", monospace',
  housing: 0x071323,
  screw: 0x77f5ff,
  gaugeFace: 0x020812,
  gaugeRing: 0x19d9ff,
  tick: 0x8af4ff,
  needle: 0xffffff,
  compass: 0x60e7ff,
  chevron: 0xffffff,
  lampOff: 0x0a2739,
  lampOn: 0x33ecff,
  barOff: 0x11324c,
  barOn: 0x65f7ff,
}

type Triple = readonly [number, number, number]

function dorsalStripe(parent: THREE.Object3D, name: string, startZ: number, endZ: number, y: number, width: number,
  material: THREE.Material) {
  box(parent, name, [width, 0.024, endZ - startZ], [0, y, (startZ + endZ) / 2], material)
}

function sideRail(parent: THREE.Object3D, name: string, side: number, z0: number, z1: number, material: THREE.Material,
  radius = 0.020) {
  beam(parent, name, [side * 0.42, -0.50, z0], [side * 0.78, -0.51, z1], radius, material, 10)
}

function cockpitBoltRow(parent: THREE.Object3D, name: string, points: Triple[], material: THREE.Material) {
  for (const point of points) sphere(parent, name, 0.018, point, material, [1, 1, 0.55], 8)
}

function buildShip(): THREE.Group {
  const group = shipGroup('Needle original interplanetary racer')
  const hull = metal(0x092a63, 0.38, 0.72)
  const shadowBlue = metal(0x06142f, 0.50, 0.65)
  const white = matte(0xf4f7fb, 0.42)
  const cyan = light(0x33eaff)
  const dark = metal(0x07101c, 0.58, 0.52)
  const graphite = metal(0x263241, 0.40, 0.76)
  const canopyGlass = glass(0x58dfff, 0.42)
  const canopyFrame = metal(0xe8f5ff, 0.26, 0.82)

  lathe(group, 'long-needle-racer-fuselage', [
    [0.025, -5.30],
    [0.070, -5.02],
    [0.150, -4.45],
    [0.245, -3.45],
    [0.335, -2.20],
    [0.455, -0.82],
    [0.590, 0.72],
    [0.760, 2.30],
    [0.840, 3.75],
    [0.760, 4.72],
    [0.545, 5.22],
  ], [0, -0.66, 0], 'z', hull, 64)

  cylinder(group, 'dark-tail-engine-fairing', 0.58, 0.50, 0.44, [0, -0.66, 5.43], 'z', shadowBlue, 40)
  dorsalStripe(group, 'white-needle-nose-racing-stripe', -4.65, -0.66, -0.245, 0.105, white)
  dorsalStripe(group, 'white-rear-spine-racing-stripe', 0.72, 4.62, 0.045, 0.175, white)
  dorsalStripe(group, 'cyan-center-pinstripe', -5.02, 4.96, -0.180, 0.030, cyan)
  for (const side of [-1, 1]) {
    const s = side
    sideRail(group, 'white-side-racing-stripe', s, -3.92, 4.58, white, 0.026)
    sideRail(group, 'cyan-side-pinstripe', s, -4.42, 4.92, cyan, 0.011)
  }

  sphere(group, 'low-teardrop-cyan-canopy', 0.66, [0, -0.17, -0.46], canopyGlass, [0.56, 0.32, 1.18], 32)
  torus(group, 'white-canopy-forward-frame', 0.40, 0.018, [0, -0.23, -1.05], 'z', canopyFrame, 40).scale.set(0.92, 0.45, 1)
  torus(group, 'white-canopy-rear-frame', 0.45, 0.018, [0, -0.20, 0.16], 'z', canopyFrame, 40).scale.set(0.94, 0.42, 1)
  for (const side of [-1, 1]) {
    const s = side
    beam(group, 'canopy-side-spine', [s * 0.36, -0.22, -1.05], [s * 0.42, -0.19, 0.16], 0.018, canopyFrame, 10)
    beam(group, 'canopy-cyan-edge-light', [s * 0.40, -0.15, -0.86], [s * 0.47, -0.13, 0.00], 0.007, cyan, 8)
  }

  for (const side of [-1, 1]) {
    const s = side
    deck(group, 'small-forward-canard', [
      [s * 0.26, -3.58], [s * 0.36, -2.58], [s * 1.02, -2.78], [s * 0.78, -3.48],
    ], 0.055, -0.74, white)
    deck(group, 'cyan-canard-pinstripe', [
      [s * 0.36, -3.36], [s * 0.43, -2.82], [s * 0.84, -2.95], [s * 0.70, -3.30],
    ], 0.020, -0.675, cyan)
    deck(group, 'forward-swept-tail-fin', [
      [s * 0.70, 3.42], [s * 0.92, 5.14], [s * 2.18, 4.52], [s * 1.74, 3.58],
    ], 0.080, -0.88, hull)
    deck(group, 'white-tail-fin-inset', [
      [s * 0.96, 3.74], [s * 1.08, 4.78], [s * 1.76, 4.44], [s * 1.52, 3.88],
    ], 0.025, -0.785, white)
    deck(group, 'cyan-tail-fin-edge', [
      [s * 1.20, 3.54], [s * 1.98, 4.26], [s * 2.13, 4.55], [s * 1.34, 3.82],
    ], 0.016, -0.750, cyan)
  }

  for (const side of [-1, 1]) {
    const s = side
    const engine = cylinder(group, 'side-by-side-engine-pod', 0.31, 0.25, 0.82, [s * 0.43, -0.69, 5.63], 'z', graphite, 36)
    engine.scale.y = 0.90
    torus(group, 'engine-nozzle-white-rim', 0.31, 0.030, [s * 0.43, -0.69, 6.04], 'z', white, 36)
    cylinder(group, 'black-engine-throat', 0.235, 0.235, 0.050, [s * 0.43, -0.69, 6.065], 'z', dark, 32)
    cylinder(group, 'bright-cyan-exhaust-disc', 0.210, 0.210, 0.018, [s * 0.43, -0.69, 6.095], 'z', cyan, 32)
    cylinder(group, 'tapered-cyan-exhaust-glow', 0.030, 0.175, 0.38, [s * 0.43, -0.69, 6.25], 'z', cyan, 24)
    beam(group, 'engine-upper-cyan-light', [s * 0.22, -0.26, 4.70], [s * 0.31, -0.38, 5.62], 0.010, cyan, 8)
  }

  for (let i = 0; i < 6; i++) {
    box(group, 'rear-dorsal-heat-vent', [0.42 - i * 0.020, 0.018, 0.046], [0, 0.115, 2.08 + i * 0.24], dark)
  }
  for (const side of [-1, 1]) {
    const s = side
    for (let i = 0; i < 5; i++) {
      const vent = box(group, 'side-cooling-slot', [0.020, 0.060, 0.175], [s * (0.70 + i * 0.016), -0.41, 1.34 + i * 0.30], dark)
      vent.rotation.y = s * 0.16
    }
  }

  beam(group, 'slim-nose-landing-strut', [0, -1.02, -3.35], [0, -2.43, -3.24], 0.032, graphite, 10)
  box(group, 'nose-retractable-landing-pad', [0.44, 0.080, 0.36], [0, -2.46, -3.20], dark)
  for (const side of [-1, 1]) {
    const s = side
    beam(group, 'rear-landing-forward-strut', [s * 0.46, -1.12, 3.00], [s * 0.76, -2.43, 3.28], 0.032, graphite, 10)
    beam(group, 'rear-landing-aft-strut', [s * 0.58, -1.05, 3.74], [s * 0.76, -2.43, 3.28], 0.026, graphite, 10)
    box(group, 'rear-retractable-landing-pad', [0.48, 0.080, 0.42], [s * 0.76, -2.46, 3.28], dark)
  }

  return group
}

function buildCockpit(): THREE.Group {
  const group = shipGroup('Needle original racing cockpit')
  const shell = metal(0x071323, 0.68, 0.40)
  const dark = metal(0x020711, 0.72, 0.32)
  const blueTrim = metal(0x0d2a55, 0.54, 0.60)
  const alloy = metal(0xd8eef8, 0.25, 0.78)
  const cyan = light(0x33eaff)
  const white = matte(0xf4f7fb, 0.48)

  beam(group, 'left-teardrop-canopy-sill', [-0.78, -0.42, -1.30], [-0.98, -0.36, 0.10], 0.040, shell, 10)
  beam(group, 'right-teardrop-canopy-sill', [0.78, -0.42, -1.30], [0.98, -0.36, 0.10], 0.040, shell, 10)
  beam(group, 'left-teardrop-canopy-arch', [-0.78, -0.42, -1.30], [-0.42, 0.48, -1.05], 0.032, alloy, 12)
  beam(group, 'right-teardrop-canopy-arch', [0.78, -0.42, -1.30], [0.42, 0.48, -1.05], 0.032, alloy, 12)
  beam(group, 'canopy-top-brow', [-0.42, 0.48, -1.05], [0.42, 0.48, -1.05], 0.030, alloy, 12)
  beam(group, 'left-canopy-roof-rail', [-0.42, 0.48, -1.05], [-0.88, 0.38, 0.00], 0.030, shell, 10)
  beam(group, 'right-canopy-roof-rail', [0.42, 0.48, -1.05], [0.88, 0.38, 0.00], 0.030, shell, 10)
  beam(group, 'left-cyan-canopy-trace', [-0.69, -0.36, -1.20], [-0.88, -0.31, -0.16], 0.006, cyan, 8)
  beam(group, 'right-cyan-canopy-trace', [0.69, -0.36, -1.20], [0.88, -0.31, -0.16], 0.006, cyan, 8)

  beam(group, 'hud-top-frame', [-0.46, 0.28, -1.02], [0.46, 0.28, -1.02], 0.008, cyan, 8)
  beam(group, 'hud-bottom-frame', [-0.46, -0.26, -1.02], [0.46, -0.26, -1.02], 0.008, cyan, 8)
  beam(group, 'hud-left-frame', [-0.46, -0.26, -1.02], [-0.46, 0.28, -1.02], 0.008, cyan, 8)
  beam(group, 'hud-right-frame', [0.46, -0.26, -1.02], [0.46, 0.28, -1.02], 0.008, cyan, 8)
  box(group, 'hud-left-corner-marker', [0.10, 0.010, 0.010], [-0.37, 0.20, -1.02], cyan)
  box(group, 'hud-right-corner-marker', [0.10, 0.010, 0.010], [0.37, 0.20, -1.02], cyan)

  const dash = plate(group, 'narrow-racing-dashboard', [
    [-1.05, -0.94], [-1.05, -0.60], [-0.72, -0.47], [-0.35, -0.43],
    [0.35, -0.43], [0.72, -0.47], [1.05, -0.60], [1.05, -0.94],
  ], 0.22, shell)
  dash.position.z = -1.64
  box(group, 'white-dashboard-contrast-strip', [1.72, 0.026, 0.035], [0, -0.338, -1.39], white)
  box(group, 'cyan-dashboard-pinstripe', [1.90, 0.012, 0.030], [0, -0.366, -1.38], cyan)
  box(group, 'dark-dashboard-lower-lip', [1.96, 0.055, 0.060], [0, -0.94, -1.39], dark)
  cockpitBoltRow(group, 'dashboard-fastener', [
    [-0.93, -0.47, -1.38], [-0.70, -0.44, -1.38], [0.70, -0.44, -1.38], [0.93, -0.47, -1.38],
  ], alloy)

  const yoke = torus(group, 'compact-racing-yoke', 0.16, 0.016, [0, -0.50, -0.80], 'z', alloy, 32)
  yoke.scale.set(1.38, 0.62, 1)
  beam(group, 'yoke-center-stem', [0, -0.50, -0.80], [0, -0.72, -0.98], 0.025, shell, 10)
  box(group, 'yoke-cyan-center-light', [0.060, 0.020, 0.020], [0, -0.50, -0.62], cyan)

  for (const side of [-1, 1]) {
    const s = side
    const console = box(group, 'tight-side-console', [0.31, 0.18, 1.10], [s * 0.82, -0.86, -0.45], blueTrim)
    console.rotation.z = s * 0.12
    box(console, 'near-black-console-inset', [0.23, 0.012, 0.84], [0, 0.096, -0.04], dark)
    for (let i = 0; i < 5; i++) {
      box(console, 'cyan-console-switch-light', [0.028, 0.010, 0.040], [s * 0.055, 0.108, -0.38 + i * 0.13], cyan)
      box(console, 'white-console-toggle', [0.018, 0.020, 0.045], [-s * 0.055, 0.113, -0.38 + i * 0.13], white)
    }
  }

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.54, -0.50, -1.38], rotation: [-0.20, 0.03, 0], width: 0.43, height: 0.205 },
      { kind: 'navigation', position: [0, -0.49, -1.39], rotation: [-0.20, 0, 0], width: 0.52, height: 0.220 },
      { kind: 'altitude', position: [0.54, -0.50, -1.38], rotation: [-0.20, -0.03, 0], width: 0.43, height: 0.205 },
    ],
    speedGauge: { position: [-0.34, -0.69, -1.30], rotation: [-0.18, 0, 0] },
    verticalGauge: { position: [0.34, -0.69, -1.30], rotation: [-0.18, 0, 0] },
    heading: { position: [0, -0.715, -1.30], rotation: [-0.18, 0, 0] },
    warpLamp: { position: [0.21, -0.725, -1.30], rotation: [-0.18, 0, 0] },
    throttle: { position: [-0.74, -0.745, -1.30], rotation: [-0.18, 0, 0], step: 0.022 },
    scale: 1.10,
  }, NEEDLE_PALETTE)
  cabinLight(group, 0x6aefff, 2.1, 5, [0, 0.24, -0.48])
  return group
}

export const needle: ShipDesign = {
  id: 'needle',
  name: 'Needle',
  kind: 'original',
  blurb: 'A long-nosed racer with twin engines and forward-swept fins.',
  sizeM: 11.6,
  eyeHeightM: 2.5,
  chaseM: [0, 5, 17.5],
  buildShip,
  buildCockpit,
}
