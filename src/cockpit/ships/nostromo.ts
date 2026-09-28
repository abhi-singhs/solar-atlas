import * as THREE from 'three'
import { mountInstruments } from '../instruments'
import type { DisplayPalette } from '../instruments'
import { beam, box, cabinLight, cylinder, light, metal, plate, shipGroup, sphere, torus } from '../parts'
import type { ShipDesign } from './types'

const NOSTROMO_PALETTE: DisplayPalette = {
  background: '#020705', grid: '#15321c', frame: '#2b5a35', title: '#87f28b', primary: '#63ff64',
  secondary: '#49c96b', footer: '#eba24a',
  housing: 0x181b17, screw: 0x6f6b5c, gaugeFace: 0x030604, gaugeRing: 0x56604f, tick: 0x74db78, needle: 0xf2a34a,
  compass: 0x6de96e, chevron: 0xef9a3a, lampOff: 0x3b2818, lampOn: 0xffa23a, barOff: 0x152616, barOn: 0x69f06f,
}

function buildCockpit(): THREE.Group {
  const group = shipGroup('Nostromo industrial bridge cockpit')
  const frame = metal(0x2e332d, 0.88, 0.45)
  const dark = metal(0x151713, 0.9, 0.35)
  const grime = metal(0x3d4038, 0.92, 0.35)
  const pad = metal(0x25251f, 0.82, 0.25)
  const amber = light(0xf0a244)
  const green = light(0x5dff6a)

  const dash = box(group, 'low-chunky-switch-dashboard', [1.95, 0.28, 0.56], [0, -0.72, -1.22], frame)
  dash.rotation.x = -0.14
  box(group, 'dashboard-black-inset', [1.48, 0.035, 0.33], [0, -0.57, -1.43], dark).rotation.x = -0.14
  box(group, 'left-crt-housing-block', [0.52, 0.19, 0.18], [-0.58, -0.61, -1.21], dark).rotation.x = -0.22
  box(group, 'right-crt-housing-block', [0.52, 0.19, 0.18], [0.58, -0.61, -1.21], dark).rotation.x = -0.22
  for (let i = 0; i < 9; i++) {
    const x = -0.86 + i * 0.215
    box(group, `dashboard-toggle-stem-${i}`, [0.020, 0.070, 0.016], [x, -0.76, -1.05], grime).rotation.x = 0.45
    box(group, `dashboard-status-jewel-${i}`, [0.028, 0.012, 0.028], [x, -0.815, -1.01], i % 3 === 0 ? amber : green)
  }

  beam(group, 'upper-window-brow', [-1.12, 0.58, -1.52], [1.12, 0.58, -1.52], 0.045, frame)
  beam(group, 'left-lower-window-sill', [-1.12, -0.38, -1.20], [-0.50, -0.35, -1.27], 0.040, frame)
  beam(group, 'right-lower-window-sill', [0.50, -0.35, -1.27], [1.12, -0.38, -1.20], 0.040, frame)
  for (const side of [-1, 1]) {
    const s = side
    beam(group, 'outer-slanted-window-post', [s * 1.12, -0.38, -1.20], [s * 1.02, 0.58, -1.52], 0.043, frame)
    beam(group, 'inner-slanted-window-post', [s * 0.58, -0.34, -1.28], [s * 0.70, 0.58, -1.52], 0.035, frame)
    beam(group, 'roof-side-rail', [s * 1.03, 0.58, -1.51], [s * 1.18, 0.78, -0.08], 0.050, frame)
    beam(group, 'lower-side-rail', [s * 1.08, -0.40, -1.16], [s * 1.24, -0.49, 0.10], 0.046, frame)
    box(group, 'side-bulkhead-panel', [0.13, 1.12, 1.08], [s * 1.24, -0.06, -0.66], grime).rotation.z = s * 0.08

    const console = box(group, 'side-toggle-console', [0.42, 0.20, 1.18], [s * 0.86, -0.83, -0.37], frame)
    console.rotation.z = s * 0.10
    console.rotation.x = -0.08
    box(console, 'console-black-switch-plate', [0.32, 0.018, 0.92], [0, 0.11, -0.03], dark)
    for (let row = 0; row < 6; row++) {
      box(console, `toggle-lever-${row}`, [0.030, 0.070, 0.018], [s * 0.060, 0.155, -0.40 + row * 0.15], grime).rotation.x = 0.35
      box(console, `amber-status-lamp-${row}`, [0.030, 0.012, 0.030], [-s * 0.083, 0.164, -0.40 + row * 0.15], row % 2 === 0 ? amber : green)
    }
    beam(console, 'stubby-flight-yoke', [0, 0.11, 0.18], [0, 0.31, 0.10], 0.028, dark)
    box(console, 'flight-yoke-grip', [0.18, 0.040, 0.055], [0, 0.32, 0.09], pad)
  }

  box(group, 'padded-seat-back', [0.68, 0.78, 0.18], [0, -0.34, 0.72], pad)
  box(group, 'padded-seat-cushion', [0.78, 0.20, 0.72], [0, -0.90, 0.38], pad)
  box(group, 'seat-headrest', [0.42, 0.24, 0.16], [0, 0.20, 0.79], pad)
  box(group, 'ribbed-footwell', [1.48, 0.08, 0.92], [0, -1.08, -0.58], dark)
  for (let i = 0; i < 6; i++) {
    box(group, `footwell-rib-${i}`, [1.35, 0.026, 0.030], [0, -1.02, -0.90 + i * 0.13], grime)
  }
  for (let i = 0; i < 5; i++) {
    box(group, `overhead-duct-${i}`, [0.22, 0.12, 0.82], [-0.48 + i * 0.24, 0.82, -0.46], dark)
  }
  beam(group, 'left-overhead-pipe', [-0.82, 0.75, -1.08], [-0.92, 0.75, 0.12], 0.025, grime)
  beam(group, 'right-overhead-pipe', [0.82, 0.75, -1.08], [0.92, 0.75, 0.12], 0.025, grime)

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.55, -0.55, -1.43], rotation: [-0.32, 0, 0], width: 0.43, height: 0.22 },
      { kind: 'navigation', position: [0, -0.55, -1.44], rotation: [-0.32, 0, 0], width: 0.55, height: 0.23 },
      { kind: 'altitude', position: [0.55, -0.55, -1.43], rotation: [-0.32, 0, 0], width: 0.43, height: 0.22 },
    ],
    speedGauge: { position: [-0.33, -0.73, -1.35], rotation: [-0.27, 0, 0] },
    verticalGauge: { position: [0.33, -0.73, -1.35], rotation: [-0.27, 0, 0] },
    heading: { position: [0, -0.75, -1.35], rotation: [-0.27, 0, 0] },
    warpLamp: { position: [0.20, -0.755, -1.34], rotation: [-0.27, 0, 0] },
    throttle: { position: [-0.76, -0.755, -1.34], rotation: [-0.27, 0, 0], step: 0.021 },
    scale: 1.08,
  }, NOSTROMO_PALETTE)
  cabinLight(group, 0xa8d8a7, 2.2, 4.5, [0, 0.36, -0.10])
  return group
}

function addTank(group: THREE.Group, name: string, radius: number, length: number, position: readonly [number, number, number],
  material: THREE.Material) {
  cylinder(group, `${name}-cylinder`, radius, radius, length, position, 'z', material, 12)
  sphere(group, `${name}-front-cap`, radius, [position[0], position[1], position[2] - length / 2], material, [1, 1, 0.42], 12)
  sphere(group, `${name}-rear-cap`, radius, [position[0], position[1], position[2] + length / 2], material, [1, 1, 0.42], 12)
}

function buildShip(): THREE.Group {
  const group = shipGroup('Nostromo commercial towing vehicle')
  const hull = metal(0x77766b, 0.88, 0.52)
  const ochre = metal(0x8b8162, 0.86, 0.45)
  const dark = metal(0x30342f, 0.9, 0.45)
  const grime = metal(0x45483f, 0.92, 0.38)
  const black = metal(0x171916, 0.88, 0.32)
  const hazard = metal(0xc0a23c, 0.7, 0.4)
  const window = light(0x18261d)
  const engineGlow = light(0xc96b2b)

  box(group, 'wide-flattened-main-body', [20.5, 5.2, 22.0], [0, -5.25, 9.55], hull)
  box(group, 'shadowed-lower-keel-block', [15.6, 2.2, 25.0], [0, -8.35, 10.9], dark)
  box(group, 'port-heavy-side-shoulder', [3.5, 4.6, 19.5], [-11.0, -5.10, 10.2], ochre)
  box(group, 'starboard-heavy-side-shoulder', [3.5, 4.6, 19.5], [11.0, -5.10, 10.2], ochre)
  box(group, 'forward-lower-prow-step', [15.8, 3.3, 5.2], [0, -5.45, -3.00], hull)
  box(group, 'forward-middle-armor-step', [11.4, 2.2, 4.1], [0, -3.18, -1.45], ochre)
  box(group, 'upper-bridge-house', [6.8, 1.8, 2.8], [0, -0.78, -1.22], hull)
  box(group, 'bridge-flat-roof-cap', [7.4, 0.48, 2.2], [0, 0.16, -1.06], grime)
  const bridgeFace = plate(group, 'sloped-bridge-window-armor', [
    [-3.18, -1.12], [-2.74, 0.20], [2.74, 0.20], [3.18, -1.12],
  ], 0.18, grime)
  bridgeFace.position.set(0, -0.46, -2.72)
  bridgeFace.rotation.x = -0.12
  for (let i = 0; i < 5; i++) {
    const x = -2.10 + i * 1.05
    const pane = box(group, `dark-slanted-bridge-window-${i}`, [0.72, 0.38, 0.055], [x, -0.38, -2.86], window)
    pane.rotation.x = -0.18
    box(group, `thick-window-frame-${i}`, [0.82, 0.055, 0.075], [x, -0.13, -2.83], black).rotation.x = -0.18
    box(group, `lower-window-frame-${i}`, [0.82, 0.055, 0.075], [x, -0.63, -2.90], black).rotation.x = -0.18
  }

  box(group, 'long-dorsal-machinery-spine', [3.2, 2.6, 25.2], [0, -1.42, 10.7], grime)
  box(group, 'raised-rear-reactor-hump', [8.8, 2.7, 7.8], [0, -1.65, 20.2], hull)
  box(group, 'massive-rear-engine-block', [18.6, 8.3, 9.6], [0, -5.55, 27.72], dark)
  box(group, 'rear-engine-armored-brow', [20.0, 2.2, 6.8], [0, -1.80, 28.45], hull)
  box(group, 'rear-keel-engine-belly', [12.4, 2.0, 7.8], [0, -9.45, 28.10], black)

  for (const [x, y, radius] of [
    [0, -4.60, 1.62], [-4.35, -4.18, 1.36], [4.35, -4.18, 1.36],
    [-2.38, -6.96, 1.18], [2.38, -6.96, 1.18], [-6.55, -6.25, 1.02], [6.55, -6.25, 1.02],
  ] as const) {
    cylinder(group, `engine-nozzle-barrel-${x}-${y}`, radius * 1.04, radius * 0.80, 2.60, [x, y, 32.93], 'z', black, 24)
    torus(group, `engine-nozzle-thick-rim-${x}-${y}`, radius * 0.94, 0.13, [x, y, 34.27], 'z', grime, 24)
    cylinder(group, `dull-orange-engine-core-${x}-${y}`, radius * 0.57, radius * 0.57, 0.06, [x, y, 34.33], 'z', engineGlow, 24)
  }

  for (const side of [-1, 1]) {
    const s = side
    for (const z of [-2.3, 8.7, 21.7]) {
      const footX = s * (z < 0 ? 6.5 : 8.7)
      beam(group, `landing-strut-a-${s}-${z}`, [s * 5.6, -7.70, z], [footX, -10.64, z - 0.32], 0.095, dark)
      beam(group, `landing-strut-b-${s}-${z}`, [s * 8.0, -7.70, z + 0.42], [footX, -10.64, z - 0.32], 0.080, dark)
      box(group, `wide-landing-foot-${s}-${z}`, [2.35, 0.35, 1.55], [footX, -10.825, z - 0.32], black)
    }
    beam(group, `side-long-pipe-upper-${s}`, [s * 10.35, -2.80, 0.2], [s * 10.35, -2.60, 23.5], 0.075, grime)
    beam(group, `side-long-pipe-lower-${s}`, [s * 12.05, -6.70, 2.0], [s * 12.05, -6.55, 20.4], 0.065, dark)
    for (let i = 0; i < 9; i++) {
      box(group, `side-grime-panel-${s}-${i}`, [0.12, 1.15, 1.25], [s * 12.82, -5.10, 0.4 + i * 2.20], i % 2 === 0 ? grime : black)
      box(group, `yellow-hazard-chip-${s}-${i}`, [0.14, 0.20, 0.48], [s * 12.90, -3.55, 1.1 + i * 2.20], hazard)
    }
    for (let i = 0; i < 5; i++) {
      addTank(group, `side-pressure-tank-${s}-${i}`, 0.34, 1.80,
        [s * (6.2 + i % 2 * 1.3), -2.05, 2.3 + i * 3.65], grime)
    }
  }

  for (let i = 0; i < 14; i++) {
    const x = -7.6 + i % 7 * 2.52
    const z = 1.5 + Math.floor(i / 7) * 8.4 + i % 3 * 1.1
    box(group, `top-boxy-greeble-${i}`, [0.95 + i % 3 * 0.22, 0.58 + i % 2 * 0.32, 1.05], [x, -2.18, z], i % 2 === 0 ? dark : grime)
  }
  for (let i = 0; i < 11; i++) {
    box(group, `dorsal-vent-bank-${i}`, [2.35, 0.10, 0.18], [0, -0.05, 1.8 + i * 1.72], black)
  }
  for (let i = 0; i < 8; i++) {
    beam(group, `top-cross-pipe-${i}`, [-7.8, -2.05, 3.0 + i * 2.55], [7.8, -2.05, 3.2 + i * 2.55], 0.042, dark)
  }

  box(group, 'forward-sensor-tower', [1.15, 2.8, 1.10], [-2.20, 1.28, 5.20], dark)
  box(group, 'central-antenna-tower', [1.35, 3.6, 1.25], [1.35, 1.68, 12.4], grime)
  box(group, 'rear-mast-block', [1.55, 3.1, 1.50], [-1.70, 1.38, 18.7], dark)
  beam(group, 'forward-thin-antenna-mast', [-2.20, 2.76, 5.20], [-2.20, 5.80, 5.20], 0.034, black)
  beam(group, 'central-thin-antenna-mast', [1.35, 3.48, 12.4], [1.35, 6.50, 12.4], 0.036, black)
  beam(group, 'rear-leaning-antenna-mast', [-1.70, 2.94, 18.7], [-2.40, 5.65, 18.9], 0.032, black)
  box(group, 'forward-antenna-crossbar', [1.15, 0.060, 0.060], [-2.20, 5.55, 5.20], black)
  box(group, 'central-antenna-crossbar', [1.40, 0.060, 0.060], [1.35, 6.20, 12.4], black)

  for (let i = 0; i < 9; i++) {
    box(group, `stepped-ochre-deck-panel-${i}`, [1.65, 0.16, 1.12], [-4.8 + i * 1.2, -2.45, -0.10 + i * 2.35], ochre)
  }
  return group
}

export const nostromo: ShipDesign = {
  id: 'nostromo',
  name: 'Nostromo',
  kind: 'tribute',
  franchise: 'Alien',
  owner: '20th Century Studios',
  blurb: 'A commercial towing vehicle with a heavy block hull, dorsal machinery, and a huge engine block.',
  sizeM: 40,
  canonSizeM: 244,
  eyeHeightM: 11,
  chaseM: [0, 13, 70],
  buildShip,
  buildCockpit,
}
