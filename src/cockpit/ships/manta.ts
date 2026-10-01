import * as THREE from 'three'
import { mountInstruments } from '../instruments'
import type { DisplayPalette } from '../instruments'
import { beam, box, cabinLight, cylinder, deck, glass, light, metal, sphere, shipGroup } from '../parts'
import type { OriginalShip } from './types'

const MANTA_PALETTE: DisplayPalette = {
  background: '#031316',
  grid: '#104047',
  frame: '#14818d',
  title: '#8efcff',
  primary: '#d3ffff',
  secondary: '#68e9ec',
  footer: '#2fc7cb',
  housing: 0x061a22,
  screw: 0x1ed8d2,
  gaugeFace: 0x041012,
  gaugeRing: 0x0a5a66,
  tick: 0x6ffaff,
  needle: 0xa8ffff,
  compass: 0x21cbd0,
  chevron: 0x8ffff7,
  lampOff: 0x063136,
  lampOn: 0x78fff4,
  barOff: 0x06282e,
  barOn: 0x27e8df,
}

function glowMaterial(color: number, opacity: number) {
  const material = light(color)
  material.transparent = true
  material.opacity = opacity
  material.depthWrite = false
  return material
}

function wingOutline() {
  return [
    [0, -5.12], [-0.58, -4.88], [-1.26, -4.75], [-2.30, -4.90],
    [-3.55, -4.35], [-5.20, -3.28], [-6.98, -1.62], [-8.48, 0.36],
    [-9.05, 1.55], [-8.12, 2.38], [-6.02, 3.06], [-3.55, 3.82],
    [-1.18, 4.36], [0, 4.52], [1.18, 4.36], [3.55, 3.82],
    [6.02, 3.06], [8.12, 2.38], [9.05, 1.55], [8.48, 0.36],
    [6.98, -1.62], [5.20, -3.28], [3.55, -4.35], [2.30, -4.90],
    [1.26, -4.75], [0.58, -4.88],
  ]
}

function buildCockpit(): THREE.Group {
  const group = shipGroup('Manta original cockpit')
  const navy = metal(0x06131d, 0.82, 0.42)
  const midnight = metal(0x02070d, 0.86, 0.35)
  const trim = metal(0x0a3540, 0.62, 0.55)
  const teal = light(0x25e8de)
  const dimTeal = light(0x0c7b82)

  const dash = deck(group, 'low-ray-dashboard', [
    [-1.18, -1.62], [-0.94, -1.38], [-0.48, -1.28], [0, -1.25],
    [0.48, -1.28], [0.94, -1.38], [1.18, -1.62], [1.03, -1.22],
    [0.34, -1.08], [0, -1.06], [-0.34, -1.08], [-1.03, -1.22],
  ], 0.10, -0.82, navy)
  dash.rotation.x = -Math.PI / 2
  dash.position.z = -2.78
  box(group, 'dashboard-front-lip', [1.86, 0.045, 0.055], [0, -0.62, -1.34], trim)
  box(group, 'dashboard-glow-slot', [1.52, 0.010, 0.020], [0, -0.585, -1.31], teal)
  beam(group, 'dashboard-slim-teal-trim', [-0.92, -0.575, -1.315], [0.92, -0.575, -1.315], 0.006, teal, 12)
  box(group, 'lower-footwell-shadow', [1.42, 0.07, 1.24], [0, -1.08, -0.46], midnight)

  for (const side of [-1, 1]) {
    const s = side
    const sideName = s < 0 ? 'left' : 'right'
    beam(group, `${sideName}-far-canopy-frame`, [s * 1.48, -0.50, -1.18], [s * 1.22, 0.60, -1.34], 0.018, navy, 12)
    beam(group, `${sideName}-far-canopy-edge-light`, [s * 1.42, -0.46, -1.15], [s * 1.18, 0.54, -1.31], 0.004, teal, 8)
    beam(group, `${sideName}-canopy-edge-frame`, [s * 1.02, -0.45, -1.36], [s * 1.27, -0.28, 0.20], 0.022, trim, 12)
    beam(group, `${sideName}-canopy-edge-light`, [s * 0.96, -0.42, -1.33], [s * 1.18, -0.28, -0.16], 0.005, teal, 8)
    beam(group, `${sideName}-canopy-aft-frame`, [s * 1.06, -0.43, -0.08], [s * 0.90, 0.66, -1.38], 0.024, navy, 12)
    beam(group, `${sideName}-canopy-roof-frame`, [s * 0.90, 0.66, -1.38], [s * 1.06, 0.82, 0.12], 0.022, trim, 12)
    beam(group, `${sideName}-roof-edge-light`, [s * 0.84, 0.61, -1.35], [s * 0.99, 0.75, -0.10], 0.004, teal, 8)

    const console = box(group, `${sideName}-side-console`, [0.32, 0.18, 1.18], [s * 0.82, -0.84, -0.32], navy)
    console.rotation.z = s * 0.10
    box(console, `${sideName}-console-glow-panel`, [0.23, 0.010, 0.86], [0, 0.096, -0.08], dimTeal)
    for (let i = 0; i < 5; i++) {
      box(console, `${sideName}-touch-control`, [0.032, 0.010, 0.060], [s * 0.058, 0.103, -0.42 + i * 0.16], teal)
    }
    beam(console, `${sideName}-slim-hand-rest`, [0, 0.11, 0.20], [0, 0.22, 0.12], 0.018, trim, 10)
  }

  beam(group, 'upper-canopy-brow', [-0.82, 0.64, -1.42], [0.82, 0.64, -1.42], 0.020, trim, 12)
  beam(group, 'upper-canopy-brow-light', [-0.68, 0.605, -1.39], [0.68, 0.605, -1.39], 0.004, teal, 8)
  beam(group, 'overhead-keel-frame', [0, 0.74, -1.34], [0, 0.92, 0.10], 0.018, navy, 12)
  box(group, 'pilot-seat-back', [0.58, 0.62, 0.12], [0, -0.50, 0.44], midnight)

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.56, -0.55, -1.43], rotation: [-0.30, 0, 0], width: 0.43, height: 0.23 },
      { kind: 'navigation', position: [0, -0.52, -1.47], rotation: [-0.28, 0, 0], width: 0.56, height: 0.25 },
      { kind: 'altitude', position: [0.56, -0.55, -1.43], rotation: [-0.30, 0, 0], width: 0.43, height: 0.23 },
    ],
    speedGauge: { position: [-0.31, -0.74, -1.34], rotation: [-0.20, 0, 0] },
    verticalGauge: { position: [0.31, -0.74, -1.34], rotation: [-0.20, 0, 0] },
    heading: { position: [0, -0.745, -1.34], rotation: [-0.20, 0, 0] },
    warpLamp: { position: [0.20, -0.76, -1.33], rotation: [-0.20, 0, 0] },
    throttle: { position: [-0.72, -0.77, -1.34], rotation: [-0.20, 0, 0], step: 0.022 },
    scale: 1.05,
  }, MANTA_PALETTE)
  cabinLight(group, 0x59fff1, 2.2, 5.5, [0, 0.25, -0.18])
  return group
}

function buildShip(): THREE.Group {
  const group = shipGroup('Manta original flying wing')
  const hull = metal(0x2a3a52, 0.45, 0.35)
  const lowerHull = metal(0x142033, 0.62, 0.38)
  const raisedHull = metal(0x30435f, 0.43, 0.34)
  const finHull = metal(0x34465e, 0.43, 0.33)
  const trim = metal(0x0f2c3f, 0.58, 0.48)
  const dark = metal(0x03080e, 0.82, 0.40)
  const canopy = glass(0x14304a, 0.86)
  const teal = light(0x00e7d8)
  const softTeal = glowMaterial(0x00d6d0, 0.62)

  deck(group, 'broad-curved-flying-wing', wingOutline(), 0.34, -0.62, hull)
  deck(group, 'shadowed-ventral-wing', wingOutline().map(([x, z]) => [x * 0.92, z * 0.94 + 0.08]), 0.10, -0.82, lowerHull)

  for (const side of [-1, 1]) {
    const s = side
    const sideName = s < 0 ? 'left' : 'right'
    deck(group, `${sideName}-cephalic-forward-fin`, [
      [s * 0.38, -4.98], [s * 0.95, -5.74], [s * 1.72, -6.34],
      [s * 2.22, -6.10], [s * 1.86, -5.32], [s * 2.76, -4.88],
      [s * 1.44, -4.68],
    ], 0.22, -0.53, finHull)
    deck(group, `${sideName}-cephalic-fin-glow-inset`, [
      [s * 0.70, -5.06], [s * 1.18, -5.66], [s * 1.70, -5.98],
      [s * 1.62, -5.58], [s * 1.10, -5.12],
    ], 0.018, -0.27, teal)
    beam(group, `${sideName}-leading-edge-glow-a`, [s * 1.30, -0.22, -4.92], [s * 3.55, -0.21, -4.20], 0.020, teal, 12)
    beam(group, `${sideName}-leading-edge-glow-b`, [s * 3.55, -0.21, -4.20], [s * 6.95, -0.25, -1.55], 0.020, teal, 16)
    beam(group, `${sideName}-leading-edge-glow-c`, [s * 6.95, -0.25, -1.55], [s * 8.72, -0.28, 1.42], 0.020, teal, 16)
    beam(group, `${sideName}-trailing-edge-glow`, [s * 7.88, -0.31, 2.26], [s * 2.90, -0.30, 4.04], 0.018, teal, 16)
    beam(group, `${sideName}-swept-panel-seam`, [s * 0.62, -0.20, -4.40], [s * 7.24, -0.24, 1.50], 0.013, teal, 16)
    beam(group, `${sideName}-inner-panel-seam`, [s * 0.78, -0.19, -2.10], [s * 3.95, -0.22, 3.48], 0.011, teal, 14)
    beam(group, `${sideName}-tail-root-seam`, [s * 0.52, -0.18, 3.72], [s * 2.55, -0.22, 4.12], 0.011, teal, 10)
    beam(group, `${sideName}-main-landing-strut`, [s * 3.35, -0.80, 1.20], [s * 3.85, -2.88, 1.48], 0.045, trim, 10)
    box(group, `${sideName}-retracted-main-pad`, [0.68, 0.10, 0.42], [s * 3.88, -2.95, 1.50], dark)
    beam(group, `${sideName}-front-landing-strut`, [s * 1.05, -0.72, -3.10], [s * 1.34, -2.88, -3.28], 0.038, trim, 10)
    box(group, `${sideName}-forward-landing-pad`, [0.48, 0.10, 0.36], [s * 1.36, -2.95, -3.30], dark)
  }

  sphere(group, 'raised-center-fairing', 1, [0, -0.40, -1.15], raisedHull, [2.20, 0.34, 3.05], 32)
  sphere(group, 'smooth-cockpit-hump', 1, [0, -0.16, -2.35], canopy, [1.18, 0.52, 1.44], 32)
  beam(group, 'central-spine-teal-seam', [0, -0.12, -4.84], [0, -0.12, 4.42], 0.014, teal, 18)
  beam(group, 'canopy-left-edge-glow', [-0.62, 0.02, -3.20], [-0.88, -0.05, -1.50], 0.010, teal, 12)
  beam(group, 'canopy-right-edge-glow', [0.62, 0.02, -3.20], [0.88, -0.05, -1.50], 0.010, teal, 12)
  beam(group, 'canopy-aft-edge-glow', [-0.78, -0.04, -1.48], [0.78, -0.04, -1.48], 0.010, teal, 12)

  box(group, 'wide-slot-engine-glow', [5.42, 0.18, 0.070], [0, -0.48, 4.54], softTeal)
  box(group, 'upper-engine-lip', [5.74, 0.060, 0.090], [0, -0.36, 4.50], trim)
  box(group, 'lower-engine-lip', [5.74, 0.055, 0.080], [0, -0.62, 4.50], dark)
  cylinder(group, 'long-tapered-tail-spike', 0.030, 0.090, 4.10, [0, -0.54, 6.58], 'z', trim, 16)
  beam(group, 'tail-spike-teal-core', [0, -0.45, 4.56], [0, -0.50, 8.46], 0.008, teal, 8)
  sphere(group, 'tail-tip-marker', 0.045, [0, -0.50, 8.65], teal, [1, 1, 1], 12)
  box(group, 'center-landing-pad', [0.62, 0.10, 0.48], [0, -2.95, 2.45], dark)
  beam(group, 'center-landing-strut', [0, -0.82, 2.22], [0, -2.88, 2.45], 0.044, trim, 10)

  return group
}

export const manta: OriginalShip = {
  id: 'manta',
  name: 'Manta',
  kind: 'original',
  blurb: 'A blue black flying wing with teal seams, cephalic fins, and a needle tail.',
  sizeM: 18.1,
  eyeHeightM: 3,
  chaseM: [0, 8.4, 28],
  buildShip,
  buildCockpit,
}
