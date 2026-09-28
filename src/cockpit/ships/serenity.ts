import * as THREE from 'three'
import { mountInstruments, type DisplayPalette } from '../instruments'
import { beam, box, cabinLight, cylinder, glass, light, metal, plate, shipGroup, sphere, torus } from '../parts'
import type { ShipDesign } from './types'

const SERENITY_PALETTE: DisplayPalette = {
  background: '#1d160e', grid: '#5a3a1b', frame: '#6f4820', title: '#f0bc6c', primary: '#ffd994', secondary: '#d89245', footer: '#f37032',
  housing: 0x32261b, screw: 0x9c7950, gaugeFace: 0x15100c, gaugeRing: 0x9a6840, tick: 0xf1b765, needle: 0xff8b39,
  compass: 0xcb8743, chevron: 0xffb35b, lampOff: 0x4e2c16, lampOn: 0xffa13a, barOff: 0x4a311f, barOn: 0xffc06c,
}

function buildCockpit(): THREE.Group {
  const group = shipGroup('Serenity cockpit')
  const frame = metal(0x46382b, 0.78, 0.34)
  const dark = metal(0x211a15, 0.85, 0.22)
  const tan = metal(0x8b6d48, 0.68, 0.36)
  const brass = metal(0xb0814c, 0.44, 0.58)
  const amber = light(0xff9c38)
  const redLamp = light(0xcf4026)
  const greenLamp = light(0x8eca5a)
  const dino = metal(0x4f9b4d, 0.7, 0.08)

  const dash = plate(group, 'well-worn-dashboard', [
    [-1.18, -0.78], [-1.12, -0.51], [-0.88, -0.41], [-0.29, -0.42],
    [-0.22, -0.47], [0.22, -0.47], [0.29, -0.42], [0.88, -0.41],
    [1.12, -0.51], [1.18, -0.78],
  ], 0.24, frame)
  dash.position.z = -1.67
  box(group, 'dashboard-front-lip', [2.18, 0.06, 0.10], [0, -0.80, -1.38], tan)
  box(group, 'dashboard-center-cubby', [0.42, 0.09, 0.20], [0, -0.70, -1.39], dark)
  box(group, 'floor-plate', [1.55, 0.08, 1.15], [0, -1.13, -0.50], dark)

  for (const side of [-1, 1]) {
    const s = side
    beam(group, 'front-window-side-post', [s * 1.14, -0.24, -1.74], [s * 1.00, 0.79, -1.74], 0.031, frame)
    beam(group, 'bridge-side-rib', [s * 1.03, 0.76, -1.73], [s * 1.20, 0.58, -0.52], 0.034, frame)
    beam(group, 'bridge-lower-sill', [s * 0.22, -0.26, -1.74], [s * 1.14, -0.24, -1.74], 0.026, frame)
    beam(group, 'off-center-window-mullion', [s < 0 ? -0.66 : 0.78, -0.23, -1.75], [s < 0 ? -0.61 : 0.82, 0.72, -1.75], 0.014, tan)
    beam(group, 'angled-corner-mullion', [s * 0.78, 0.30, -1.75], [s * 1.03, 0.74, -1.75], 0.012, tan)
    const console = box(group, 'side-console', [0.34, 0.22, 1.12], [s * 0.87, -0.83, -0.53], frame)
    console.rotation.z = s * 0.12
    box(console, 'console-inset', [0.25, 0.014, 0.89], [0, 0.12, -0.03], dark)
    for (let i = 0; i < 6; i++) {
      box(console, 'console-toggle', [0.035, 0.040, 0.013], [s * 0.056, 0.151, -0.39 + i * 0.12], i % 2 ? brass : tan)
      box(console, 'console-status-lamp', [0.016, 0.012, 0.016], [-s * 0.071, 0.151, -0.39 + i * 0.12], i % 3 === 0 ? redLamp : amber)
    }
    beam(console, 'stick-controller', [0, 0.12, 0.22], [0, 0.32, 0.13], 0.020, dark)
    sphere(console, 'stick-knob', 0.045, [0, 0.335, 0.12], brass, [1, 0.8, 1], 12)
  }
  beam(group, 'top-window-brow-left', [-1.00, 0.78, -1.74], [-0.10, 0.82, -1.74], 0.030, frame)
  beam(group, 'top-window-brow-right', [0.10, 0.82, -1.74], [1.00, 0.78, -1.74], 0.030, frame)
  beam(group, 'upper-split-mullion', [-0.52, 0.34, -1.75], [0.64, 0.35, -1.75], 0.010, tan)
  beam(group, 'roof-rail', [-0.92, 0.82, -1.18], [0.92, 0.82, -1.18], 0.028, frame)

  for (let i = 0; i < 8; i++) {
    box(group, 'dash-toggle-bank', [0.030, 0.045, 0.014], [-0.78 + i * 0.08, -0.62, -1.26], i % 2 ? brass : tan)
    box(group, 'dash-pin-light', [0.018, 0.012, 0.018], [-0.78 + i * 0.08, -0.56, -1.25], i % 3 === 0 ? greenLamp : amber)
  }
  for (let i = 0; i < 5; i++) {
    box(group, 'right-panel-switch', [0.027, 0.040, 0.014], [0.72 + i * 0.055, -0.63, -1.25], brass)
  }

  beam(group, 'trinket-cord', [-0.86, 0.74, -1.12], [-0.84, 0.31, -1.14], 0.004, dark, 6)
  sphere(group, 'hanging-trinket', 0.045, [-0.84, 0.25, -1.14], amber, [0.7, 1.2, 0.7], 12)

  sphere(group, 'toy-dinosaur-body', 0.070, [0.94, -0.48, -1.18], dino, [1.25, 0.70, 0.55], 14)
  sphere(group, 'toy-dinosaur-head', 0.040, [1.02, -0.43, -1.23], dino, [1.1, 0.8, 0.8], 12)
  beam(group, 'toy-dinosaur-neck', [0.985, -0.455, -1.205], [1.01, -0.43, -1.23], 0.018, dino, 8)
  beam(group, 'toy-dinosaur-tail', [0.87, -0.48, -1.15], [0.77, -0.46, -1.09], 0.016, dino, 8)
  for (const x of [0.90, 0.98]) {
    beam(group, 'toy-dinosaur-leg', [x, -0.53, -1.18], [x - 0.015, -0.61, -1.17], 0.011, dino, 6)
  }

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.54, -0.55, -1.42], rotation: [-0.18, 0, 0], width: 0.42, height: 0.21 },
      { kind: 'navigation', position: [0, -0.56, -1.43], rotation: [-0.18, 0, 0], width: 0.50, height: 0.22 },
      { kind: 'altitude', position: [0.54, -0.55, -1.42], rotation: [-0.18, 0, 0], width: 0.42, height: 0.21 },
    ],
    speedGauge: { position: [-0.31, -0.73, -1.34], rotation: [-0.18, 0, 0] },
    verticalGauge: { position: [0.31, -0.73, -1.34], rotation: [-0.18, 0, 0] },
    heading: { position: [0, -0.745, -1.34], rotation: [-0.18, 0, 0] },
    warpLamp: { position: [0.20, -0.745, -1.34], rotation: [-0.18, 0, 0] },
    throttle: { position: [-0.76, -0.755, -1.34], rotation: [-0.18, 0, 0], step: 0.020 },
    scale: 0.94,
  }, SERENITY_PALETTE)
  cabinLight(group, 0xffb45c, 2.4, 5.4, [0, 0.28, -0.62])
  return group
}

function addExteriorPanelLines(group: THREE.Group, seam: THREE.Material, rust: THREE.Material) {
  for (const z of [8.5, 11.2, 14.0, 16.8, 19.6]) {
    box(group, 'cargo-bay-panel-line', [7.7, 0.035, 0.045], [0, 0.72, z], seam)
  }
  for (const x of [-2.9, -1.4, 1.4, 2.9]) {
    box(group, 'cargo-back-long-panel-line', [0.040, 0.035, 10.8], [x, 0.75, 14.2], seam)
  }
  for (const side of [-1, 1]) {
    const s = side
    for (let i = 0; i < 4; i++) {
      box(group, 'side-panel-line', [0.050, 0.040, 1.40], [s * 4.23, -1.55 + i * 0.33, 10.0 + i * 2.9], seam)
    }
    box(group, 'rust-stained-cargo-patch', [0.060, 0.42, 1.08], [s * 4.40, -2.34, 13.1], rust)
    box(group, 'rust-streak-below-engine-arm', [0.065, 0.34, 0.84], [s * 4.60, -2.82, 20.0], rust)
  }
}

function buildShip(): THREE.Group {
  const group = shipGroup('Serenity Firefly-class transport')
  const hull = metal(0x87917b, 0.74, 0.34)
  const tan = metal(0xb29c78, 0.72, 0.30)
  const dark = metal(0x333b39, 0.80, 0.28)
  const seam = metal(0x4b5149, 0.82, 0.20)
  const rust = metal(0x9b5534, 0.86, 0.14)
  const windowGlass = glass(0x1e353d, 0.82)
  const amber = light(0xff9f34)
  const hotCore = light(0xffd36c)

  const head = plate(group, 'rounded-bridge-head', [
    [-1.28, -1.08], [-1.88, -0.31], [-1.62, 0.66], [-0.92, 1.04],
    [0.92, 1.04], [1.62, 0.66], [1.88, -0.31], [1.28, -1.08],
  ], 4.65, hull)
  head.position.set(0, -0.05, -4.62)
  box(group, 'bridge-window-band', [2.56, 0.58, 0.055], [0, 0.18, -4.66], windowGlass)
  for (const x of [-0.90, -0.28, 0.47, 0.98]) {
    box(group, 'bridge-window-mullion', [0.045, 0.62, 0.080], [x, 0.18, -4.70], dark)
  }
  box(group, 'bridge-window-brow', [2.85, 0.090, 0.090], [0, 0.51, -4.70], dark)
  box(group, 'bridge-window-lower-sill', [2.65, 0.070, 0.090], [0, -0.16, -4.70], dark)
  box(group, 'bridge-underjaw-tan-panel', [2.50, 0.50, 0.16], [0, -0.83, -2.60], tan)

  box(group, 'slim-neck-spine', [1.35, 0.72, 6.40], [0, -0.32, 3.15], hull)
  box(group, 'neck-dark-inset', [1.10, 0.20, 5.80], [0, -0.82, 3.35], dark)
  for (const side of [-1, 1]) {
    beam(group, 'neck-side-pipe', [side * 0.82, -0.30, 0.55], [side * 0.96, -1.28, 6.15], 0.075, seam)
  }

  sphere(group, 'bulbous-cargo-belly', 1, [0, -2.10, 14.30], hull, [4.35, 3.05, 8.55], 32)
  box(group, 'flat-topped-cargo-back', [7.85, 0.82, 11.65], [0, 0.52, 14.85], hull)
  box(group, 'cargo-top-tan-cover', [6.75, 0.12, 8.80], [0, 1.01, 14.55], tan)
  box(group, 'front-cargo-ramp-outline', [3.10, 0.060, 1.70], [0, -4.92, 7.00], seam)
  box(group, 'cargo-ramp-inner-line', [2.46, 0.070, 0.060], [0, -4.86, 6.16], dark)
  for (const x of [-1.22, 1.22]) {
    box(group, 'cargo-ramp-side-line', [0.060, 0.070, 1.34], [x, -4.86, 7.00], dark)
  }
  addExteriorPanelLines(group, seam, rust)

  cylinder(group, 'aft-drive-drum', 2.15, 2.40, 7.80, [0, -1.07, 28.75], 'z', hull, 32)
  cylinder(group, 'aft-drive-dark-band', 2.25, 2.25, 0.60, [0, -1.07, 32.92], 'z', dark, 32)
  torus(group, 'aft-glowing-drive-ring', 2.23, 0.145, [0, -1.07, 35.48], 'z', amber, 48)
  torus(group, 'aft-drive-outer-rim', 2.50, 0.095, [0, -1.07, 35.43], 'z', seam, 48)
  cylinder(group, 'aft-glowing-core', 0.76, 0.98, 0.11, [0, -1.07, 35.63], 'z', hotCore, 32)
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI * 2 / 8
    box(group, 'aft-ring-segment', [0.22, 0.18, 0.20], [Math.cos(angle) * 2.25, -1.07 + Math.sin(angle) * 2.25, 35.40], seam)
  }

  for (const side of [-1, 1]) {
    const s = side
    beam(group, 'swing-engine-forward-arm', [s * 3.80, -2.42, 18.35], [s * 6.35, -2.66, 20.90], 0.18, seam, 12)
    beam(group, 'swing-engine-rear-arm', [s * 3.70, -2.16, 20.85], [s * 6.35, -2.58, 22.55], 0.16, seam, 12)
    cylinder(group, 'engine-arm-hinge', 0.55, 0.55, 0.70, [s * 3.78, -2.30, 19.45], 'x', dark, 20)
    cylinder(group, 'tilt-engine-pod', 1.25, 1.40, 4.30, [s * 7.35, -2.72, 21.85], 'z', dark, 28)
    cylinder(group, 'engine-pod-tan-cowling', 1.34, 1.34, 0.55, [s * 7.35, -2.72, 19.72], 'z', tan, 28)
    torus(group, 'engine-pod-front-ring', 1.24, 0.080, [s * 7.35, -2.72, 19.53], 'z', seam, 28)
    torus(group, 'engine-pod-rear-ring', 1.14, 0.085, [s * 7.35, -2.72, 24.05], 'z', seam, 28)
    cylinder(group, 'engine-pod-warm-core', 0.54, 0.70, 0.10, [s * 7.35, -2.72, 24.12], 'z', amber, 24)
    box(group, 'engine-pod-side-panel', [0.08, 0.76, 1.65], [s * 8.73, -2.72, 21.75], hull)
    box(group, 'engine-pod-rust-patch', [0.085, 0.34, 0.70], [s * 8.78, -2.30, 20.92], rust)
  }

  for (const [name, x, z] of [
    ['front-left-landing-pad', -1.55, 6.20],
    ['front-right-landing-pad', 1.55, 6.20],
    ['rear-left-landing-pad', -2.70, 20.95],
    ['rear-right-landing-pad', 2.70, 20.95],
  ] as const) {
    beam(group, `${name}-strut`, [x * 0.78, -3.95, z], [x, -5.50, z + 0.24], 0.070, seam, 10)
    box(group, name, [1.05, 0.16, 1.22], [x, -5.72, z + 0.24], dark)
  }

  for (let i = 0; i < 7; i++) {
    box(group, 'dorsal-cooling-slot', [0.72, 0.035, 0.080], [0, 1.12, 10.0 + i * 1.15], dark)
  }
  return group
}

export const serenity: ShipDesign = {
  id: 'serenity',
  name: 'Serenity',
  kind: 'tribute',
  franchise: 'Firefly',
  owner: '20th Television',
  blurb: 'Firefly-class transport with a birdlike bridge, cargo belly, side pods, and a glowing aft ring.',
  sizeM: 40,
  canonSizeM: 82,
  eyeHeightM: 5.8,
  chaseM: [0, 15, 74],
  buildShip,
  buildCockpit,
}
