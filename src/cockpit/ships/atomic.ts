import * as THREE from 'three'
import { mountInstruments } from '../instruments'
import type { DisplayPalette } from '../instruments'
import { beam, box, cabinLight, cylinder, deck, glass, light, metal, matte, plate, shipGroup, sphere, torus, lathe } from '../parts'
import type { OriginalShip } from './types'

const ATOMIC_PALETTE: DisplayPalette = {
  background: '#f3e4bd',
  grid: '#d2bf8b',
  frame: '#9f241f',
  title: '#8c1e19',
  primary: '#181411',
  secondary: '#8c1e19',
  footer: '#181411',
  titleFont: '"Georgia", serif',
  monoFont: '"Courier New", monospace',
  housing: 0xdcc896,
  screw: 0xb9863d,
  gaugeFace: 0xf4e4bb,
  gaugeRing: 0xb9863d,
  tick: 0x181411,
  needle: 0xb5261f,
  compass: 0x181411,
  chevron: 0xb5261f,
  lampOff: 0x4e2d21,
  lampOn: 0xff8b27,
  barOff: 0x7a5c35,
  barOn: 0xb5261f,
}

type Triple = readonly [number, number, number]

function openBand(parent: THREE.Object3D, name: string, radius: number, width: number, position: Triple, material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 64, 1, true), material)
  mesh.name = name
  mesh.rotation.x = Math.PI / 2
  mesh.position.set(position[0], position[1], position[2])
  parent.add(mesh)
  return mesh
}

function rivetsOnZ(parent: THREE.Object3D, name: string, center: Triple, radius: number, count: number, material: THREE.Material, size = 0.026) {
  for (let i = 0; i < count; i++) {
    const angle = i * Math.PI * 2 / count
    sphere(parent, name, size, [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius, center[2]], material,
      [1, 1, 0.45], 8)
  }
}

function rivetsOnX(parent: THREE.Object3D, name: string, center: Triple, radius: number, count: number, material: THREE.Material, size = 0.019) {
  for (let i = 0; i < count; i++) {
    const angle = i * Math.PI * 2 / count
    sphere(parent, name, size, [center[0], center[1] + Math.sin(angle) * radius, center[2] + Math.cos(angle) * radius], material,
      [0.45, 1, 1], 8)
  }
}

function longitudinalFin(parent: THREE.Object3D, name: string, points: number[][], depth: number, material: THREE.Material) {
  const fin = plate(parent, name, points, depth, material)
  fin.rotation.y = -Math.PI / 2
  fin.position.x = depth / 2
  return fin
}

function buildShip(): THREE.Group {
  const group = shipGroup('Atomic original pulp rocket')
  const chrome = metal(0xc9ced4, 0.30, 0.60)
  const shadowChrome = metal(0xd8dde2, 0.28, 0.62)
  const cream = matte(0xf0dfb6, 0.48)
  const red = matte(0xb52a22, 0.52)
  red.side = THREE.DoubleSide
  const brass = metal(0xb8863b, 0.28, 0.82)
  const black = matte(0x14110f, 0.72)
  const flame = light(0xff7518)
  const flameCore = light(0xffd56b)
  const blueGlass = glass(0x8fd4ff, 0.55)

  lathe(group, 'polished-cigar-rocket-body', [
    [0.02, -6.40],
    [0.22, -6.16],
    [0.55, -5.72],
    [0.92, -5.05],
    [1.22, -4.08],
    [1.38, -2.25],
    [1.43, 0.35],
    [1.41, 3.80],
    [1.26, 5.72],
    [0.95, 6.75],
    [0.58, 7.38],
    [0.44, 7.48],
  ], [0, -0.60, 0], 'z', chrome, 72)

  openBand(group, 'cream-enamel-nose-band', 1.08, 0.42, [0, -0.60, -4.55], cream)
  openBand(group, 'cream-enamel-midship-band', 1.455, 0.50, [0, -0.60, 2.95], cream)
  openBand(group, 'cream-enamel-tail-band', 1.10, 0.38, [0, -0.60, 6.28], cream)
  torus(group, 'chrome-nose-trim-ring', 1.10, 0.026, [0, -0.60, -4.30], 'z', shadowChrome, 64)
  torus(group, 'chrome-waist-trim-ring', 1.47, 0.026, [0, -0.60, 3.26], 'z', shadowChrome, 64)
  torus(group, 'chrome-tail-trim-ring', 1.13, 0.030, [0, -0.60, 6.50], 'z', shadowChrome, 64)

  torus(group, 'brass-nose-cockpit-ring', 0.32, 0.040, [0, -0.54, -5.86], 'z', brass, 40)
  cylinder(group, 'blue-nose-cockpit-glass', 0.235, 0.235, 0.036, [0, -0.54, -5.885], 'z', blueGlass, 32)
  rivetsOnZ(group, 'nose-cockpit-rivet', [0, -0.54, -5.915], 0.405, 12, brass, 0.018)

  const portZ = [-2.75, -1.55, -0.35, 0.85, 2.05]
  for (const side of [-1, 1]) {
    const s = side
    for (const z of portZ) {
      const center: Triple = [s * 1.47, -0.27, z]
      torus(group, 'brass-side-porthole-ring', 0.220, 0.026, center, 'x', brass, 32)
      cylinder(group, 'blue-side-porthole-glass', 0.155, 0.155, 0.040, [s * 1.485, -0.27, z], 'x', blueGlass, 24)
      rivetsOnX(group, 'side-porthole-rivet', [s * 1.515, -0.27, z], 0.265, 6, brass)
    }
  }

  cylinder(group, 'flared-chrome-exhaust-bell', 0.68, 0.40, 0.92, [0, -0.60, 7.86], 'z', shadowChrome, 48)
  torus(group, 'thick-exhaust-lip', 0.68, 0.065, [0, -0.60, 8.32], 'z', chrome, 48)
  cylinder(group, 'black-exhaust-throat', 0.34, 0.34, 0.08, [0, -0.60, 8.36], 'z', black, 32)
  cylinder(group, 'orange-flame-glow', 0.08, 0.42, 1.74, [0, -0.60, 8.73], 'z', flame, 32)
  cylinder(group, 'yellow-flame-core', 0.03, 0.20, 1.30, [0, -0.60, 8.56], 'z', flameCore, 24)

  deck(group, 'left-swept-red-tail-fin', [[1.05, 5.55], [1.34, 7.80], [3.10, 8.24], [2.42, 5.92]], 0.13, -1.34, red)
  deck(group, 'right-swept-red-tail-fin', [[-1.05, 5.55], [-1.34, 7.80], [-3.10, 8.24], [-2.42, 5.92]], 0.13, -1.34, red)
  sphere(group, 'left-rounded-fin-tip', 0.16, [3.08, -1.27, 8.23], red, [1.15, 0.45, 0.70], 16)
  sphere(group, 'right-rounded-fin-tip', 0.16, [-3.08, -1.27, 8.23], red, [1.15, 0.45, 0.70], 16)
  longitudinalFin(group, 'dorsal-swept-red-tail-fin', [[5.28, 0.60], [7.78, 0.44], [7.22, 1.55], [6.18, 1.25]], 0.12, red)
  longitudinalFin(group, 'belly-swept-red-tail-fin', [[5.52, -1.70], [7.70, -1.76], [7.12, -2.78], [6.02, -2.46]], 0.12, red)
  sphere(group, 'dorsal-rounded-fin-tip', 0.16, [0, 1.48, 7.25], red, [0.45, 1.0, 0.75], 16)
  sphere(group, 'belly-rounded-fin-tip', 0.14, [0, -2.78, 7.14], red, [0.55, 0.55, 0.85], 16)

  for (const side of [-1, 1]) {
    const s = side
    box(group, 'belly-skid', [0.22, 0.08, 3.25], [s * 0.55, -2.96, 1.35], black)
    beam(group, 'belly-skid-front-strut', [s * 0.55, -2.92, -0.10], [s * 0.36, -1.92, -0.22], 0.030, shadowChrome)
    beam(group, 'belly-skid-rear-strut', [s * 0.55, -2.92, 2.80], [s * 0.38, -1.86, 2.62], 0.030, shadowChrome)
  }
  beam(group, 'nose-landing-strut', [0, -1.62, -4.46], [0, -2.92, -4.56], 0.040, shadowChrome)
  box(group, 'nose-landing-pad', [0.52, 0.08, 0.40], [0, -2.96, -4.58], black)
  box(group, 'belly-fin-tip-pad', [0.52, 0.08, 0.34], [0, -2.96, 7.13], black)

  return group
}

function buildCockpit(): THREE.Group {
  const group = shipGroup('Atomic original pulp cockpit')
  const cream = matte(0xf0dfb6, 0.55)
  const red = matte(0xb52a22, 0.58)
  const brass = metal(0xb8863b, 0.30, 0.82)
  const chrome = metal(0xcfd1ca, 0.20, 0.92)
  const black = matte(0x16120f, 0.70)
  const glow = light(0xff8b27)

  torus(group, 'open-forward-porthole-brass-ring', 0.72, 0.055, [0, 0.02, -1.48], 'z', brass, 56)
  torus(group, 'cream-forward-porthole-bulkhead-ring', 0.88, 0.035, [0, 0.02, -1.50], 'z', cream, 56)
  rivetsOnZ(group, 'forward-porthole-rivet', [0, 0.02, -1.43], 0.82, 16, brass, 0.022)

  beam(group, 'left-porthole-side-frame', [-0.92, -0.36, -1.40], [-1.22, 0.54, -1.08], 0.045, chrome)
  beam(group, 'right-porthole-side-frame', [0.92, -0.36, -1.40], [1.22, 0.54, -1.08], 0.045, chrome)
  beam(group, 'upper-porthole-frame', [-0.58, 0.75, -1.32], [0.58, 0.75, -1.32], 0.040, chrome)

  const dash = plate(group, 'cream-riveted-dashboard', [
    [-1.15, -0.96], [-1.15, -0.54], [-0.86, -0.42], [0.86, -0.42], [1.15, -0.54], [1.15, -0.96],
  ], 0.22, cream)
  dash.position.z = -1.75
  box(group, 'deep-red-dashboard-band', [2.04, 0.075, 0.040], [0, -0.49, -1.50], red)
  box(group, 'black-dashboard-lower-lip', [2.10, 0.055, 0.065], [0, -0.96, -1.49], black)
  for (const x of [-0.96, -0.72, -0.48, 0.48, 0.72, 0.96]) {
    sphere(group, 'dashboard-rivet', 0.018, [x, -0.51, -1.31], brass, [1, 1, 0.45], 8)
  }

  for (const side of [-1, 1]) {
    const s = side
    const console = box(group, 'cream-side-console', [0.34, 0.22, 0.92], [s * 0.92, -0.88, -0.58], cream)
    console.rotation.z = s * 0.13
    box(console, 'red-console-inset-panel', [0.25, 0.020, 0.68], [0, 0.12, -0.02], red)
    for (let i = 0; i < 5; i++) {
      const x = -0.080 + i * 0.040
      beam(console, 'chrome-toggle-switch', [x, 0.135, -0.24], [x + s * 0.020, 0.190, -0.22], 0.008, chrome)
      sphere(console, 'toggle-red-tip', 0.014, [x + s * 0.024, 0.198, -0.22], red, [1, 1, 1], 8)
    }
  }

  beam(group, 'chunky-throttle-lever', [0.66, -0.83, -0.83], [0.78, -0.55, -0.92], 0.030, chrome)
  sphere(group, 'red-throttle-knob', 0.070, [0.80, -0.51, -0.93], red, [1, 1, 1], 16)
  box(group, 'chrome-throttle-gate', [0.34, 0.035, 0.15], [0.66, -0.85, -0.80], chrome)
  for (let i = 0; i < 6; i++) {
    box(group, 'cream-toggle-label-plate', [0.045, 0.012, 0.020], [-0.82 + i * 0.065, -0.82, -1.13], black)
  }
  sphere(group, 'amber-cabin-bulb', 0.040, [0, 0.62, -0.82], glow, [1, 1, 1], 16)

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.56, -0.56, -1.38], rotation: [-0.18, 0.03, 0], width: 0.42, height: 0.205 },
      { kind: 'navigation', position: [0, -0.53, -1.40], rotation: [-0.18, 0, 0], width: 0.50, height: 0.220 },
      { kind: 'altitude', position: [0.56, -0.56, -1.38], rotation: [-0.18, -0.03, 0], width: 0.42, height: 0.205 },
    ],
    speedGauge: { position: [-0.36, -0.78, -1.31], rotation: [-0.16, 0, 0] },
    verticalGauge: { position: [0.36, -0.78, -1.31], rotation: [-0.16, 0, 0] },
    heading: { position: [0, -0.80, -1.30], rotation: [-0.16, 0, 0] },
    warpLamp: { position: [0.20, -0.81, -1.29], rotation: [-0.16, 0, 0] },
    throttle: { position: [-0.73, -0.84, -1.29], rotation: [-0.16, 0, 0], step: 0.021 },
    scale: 1.12,
  }, ATOMIC_PALETTE)
  cabinLight(group, 0xffdfaa, 2.2, 5, [0, 0.36, -0.44])
  return group
}

export const atomic: OriginalShip = {
  id: 'atomic',
  name: 'Atomic',
  kind: 'original',
  blurb: 'Chrome, cream enamel, brass portholes, and red fins from a 1955 toy box.',
  sizeM: 16,
  eyeHeightM: 3,
  chaseM: [0, 7.2, 25],
  buildShip,
  buildCockpit,
}
