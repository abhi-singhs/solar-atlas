import * as THREE from 'three'
import { mountInstruments } from '../instruments'
import type { DisplayPalette } from '../instruments'
import { beam, box, cabinLight, cylinder, glass, light, metal, plate, shipGroup, sphere, torus } from '../parts'
import type { OriginalShip } from './types'

type Triple = readonly [number, number, number]

const MULE_PALETTE: DisplayPalette = {
  background: '#17130e', grid: '#514128', frame: '#6e5427', title: '#ffcf62', primary: '#ffd88a', secondary: '#f58a32', footer: '#d9b247',
  housing: 0x252526, screw: 0x8b7e63, gaugeFace: 0x141414, gaugeRing: 0x6d685d, tick: 0xf0c45d, needle: 0xff7b2c,
  compass: 0xdbad45, chevron: 0xff8f34, lampOff: 0x4b3320, lampOn: 0xff9f2f, barOff: 0x463622, barOn: 0xf7b531,
}

function hazardStripes(parent: THREE.Object3D, prefix: string, count: number, startX: number, y: number, z: number,
  yellow: THREE.Material, black: THREE.Material, scale: Triple = [0.17, 0.62, 0.045]) {
  for (let i = 0; i < count; i++) {
    const stripe = box(parent, `${prefix}-hazard-stripe-${i}`, scale, [startX + i * scale[0] * 1.55, y, z], i % 2 === 0 ? yellow : black)
    stripe.rotation.z = 0.54
  }
}

function cargoContainer(parent: THREE.Object3D, name: string, x: number, z: number, shell: THREE.Material,
  rib: THREE.Material, corner: THREE.Material) {
  box(parent, `${name}-container-shell`, [5.15, 1.72, 3.78], [x, -0.10, z], shell)
  box(parent, `${name}-front-door-frame`, [5.28, 1.84, 0.08], [x, -0.10, z - 1.94], corner)
  box(parent, `${name}-rear-door-frame`, [5.28, 1.84, 0.08], [x, -0.10, z + 1.94], corner)
  box(parent, `${name}-top-edge-rail`, [5.35, 0.09, 3.96], [x, 0.81, z], corner)
  box(parent, `${name}-bottom-edge-rail`, [5.35, 0.09, 3.96], [x, -1.01, z], corner)
  for (const side of [-1, 1]) {
    box(parent, `${name}-side-edge-rail-${side}`, [0.09, 1.88, 3.96], [x + side * 2.65, -0.10, z], corner)
    for (let i = 0; i < 8; i++) {
      const ribZ = z - 1.48 + i * 0.42
      box(parent, `${name}-side-corrugation-${side}-${i}`, [0.07, 1.54, 0.052], [x + side * 2.71, -0.10, ribZ], rib)
    }
  }
  for (let i = 0; i < 8; i++) {
    const ribZ = z - 1.48 + i * 0.42
    box(parent, `${name}-roof-corrugation-${i}`, [4.94, 0.055, 0.052], [x, 0.91, ribZ], rib)
  }
  for (const side of [-1, 1]) {
    for (const row of [-1, 1]) {
      box(parent, `${name}-corner-casting-${side}-${row}-front`, [0.28, 0.24, 0.20], [x + side * 2.46, -0.10 + row * 0.76, z - 1.84], corner)
      box(parent, `${name}-corner-casting-${side}-${row}-rear`, [0.28, 0.24, 0.20], [x + side * 2.46, -0.10 + row * 0.76, z + 1.84], corner)
    }
  }
}

function buildShip(): THREE.Group {
  const group = shipGroup('Mule original cargo hauler')
  const safetyYellow = metal(0xc7a328, 0.72, 0.34)
  const fadedYellow = metal(0xa98225, 0.84, 0.22)
  const charcoal = metal(0x202225, 0.78, 0.42)
  const frame = metal(0x565b59, 0.62, 0.62)
  const darkFrame = metal(0x2f3334, 0.74, 0.55)
  const blackRubber = metal(0x101112, 0.86, 0.25)
  const hazardYellow = light(0xffc51f)
  const amber = light(0xff8f28)
  const workLamp = light(0xffe29a)
  const glassBlue = glass(0x21414a, 0.72)
  const containerBlue = metal(0x476477, 0.88, 0.16)
  const containerOrange = metal(0x9d5531, 0.90, 0.16)
  const containerGreen = metal(0x5f6d55, 0.88, 0.14)
  const blueRib = metal(0x355061, 0.92, 0.14)
  const orangeRib = metal(0x7b3f29, 0.93, 0.14)
  const greenRib = metal(0x485443, 0.91, 0.14)

  box(group, 'cab-main-block', [5.25, 3.02, 5.18], [0, -0.88, -2.62], safetyYellow)
  box(group, 'cab-roof-cap', [4.72, 0.34, 3.92], [0, 0.79, -2.54], fadedYellow)
  box(group, 'cab-armored-chin', [5.55, 0.74, 1.05], [0, -1.92, -5.08], fadedYellow)
  box(group, 'cab-front-bumper', [5.80, 0.48, 0.34], [0, -2.20, -5.58], blackRubber)
  hazardStripes(group, 'cab-bumper', 16, -2.38, -2.18, -5.79, hazardYellow, blackRubber)
  box(group, 'wide-windshield-glass', [4.16, 0.96, 0.07], [0, 0.02, -5.24], glassBlue)
  box(group, 'windshield-top-frame', [4.58, 0.14, 0.14], [0, 0.58, -5.31], darkFrame)
  box(group, 'windshield-bottom-frame', [4.58, 0.13, 0.14], [0, -0.55, -5.31], darkFrame)
  for (const side of [-1, 1]) {
    box(group, `windshield-side-frame-${side}`, [0.14, 1.17, 0.15], [side * 2.20, 0.02, -5.31], darkFrame)
    box(group, `cab-side-window-${side}`, [0.07, 0.62, 1.12], [side * 2.66, 0.03, -4.20], glassBlue)
    box(group, `cab-side-crash-bar-${side}`, [0.12, 0.18, 2.85], [side * 2.71, -0.82, -3.24], darkFrame)
    box(group, `cab-battered-side-panel-${side}`, [0.10, 0.72, 1.08], [side * 2.72, -1.38, -1.74], side < 0 ? containerOrange : frame)
    box(group, `cab-roof-work-light-${side}`, [0.38, 0.20, 0.12], [side * 1.72, 0.72, -5.44], workLamp)
    box(group, `front-rcs-thruster-block-${side}`, [0.42, 0.34, 0.42], [side * 2.86, 0.32, -5.03], charcoal)
    box(group, `front-rcs-side-port-${side}`, [0.045, 0.13, 0.13], [side * 3.09, 0.32, -5.03], amber)
  }
  for (let i = 0; i < 5; i++) {
    box(group, `cab-roof-vent-${i}`, [0.72, 0.055, 0.10], [0, 1.00, -3.80 + i * 0.48], charcoal)
  }

  for (const side of [-1, 1]) {
    for (const y of [-1.34, 1.02]) {
      beam(group, `cargo-longitudinal-rail-${side}-${y}`, [side * 3.15, y, 0.05], [side * 3.15, y, 16.85], 0.075, frame)
    }
    for (let i = 0; i < 6; i++) {
      const z = 0.95 + i * 2.85
      beam(group, `cargo-side-diagonal-up-${side}-${i}`, [side * 3.15, -1.34, z], [side * 3.15, 1.02, z + 2.32], 0.045, frame)
      beam(group, `cargo-side-diagonal-down-${side}-${i}`, [side * 3.15, 1.02, z], [side * 3.15, -1.34, z + 2.32], 0.045, darkFrame)
    }
  }
  for (let i = 0; i < 7; i++) {
    const z = 0.35 + i * 2.70
    beam(group, `cargo-top-crossbeam-${i}`, [-3.15, 1.02, z], [3.15, 1.02, z], 0.065, frame)
    beam(group, `cargo-bottom-crossbeam-${i}`, [-3.15, -1.34, z], [3.15, -1.34, z], 0.075, darkFrame)
  }
  box(group, 'front-frame-hazard-cap', [6.65, 0.30, 0.24], [0, -1.32, 0.10], blackRubber)
  box(group, 'rear-frame-hazard-cap', [6.65, 0.30, 0.24], [0, -1.32, 16.88], blackRubber)
  hazardStripes(group, 'front-frame-end', 18, -2.75, -1.32, -0.04, hazardYellow, blackRubber, [0.15, 0.34, 0.04])
  hazardStripes(group, 'rear-frame-end', 18, -2.75, -1.32, 17.02, hazardYellow, blackRubber, [0.15, 0.34, 0.04])

  cargoContainer(group, 'blue-forward', -0.10, 2.80, containerBlue, blueRib, darkFrame)
  cargoContainer(group, 'rust-middle', 0.16, 7.20, containerOrange, orangeRib, darkFrame)
  cargoContainer(group, 'green-aft', -0.04, 11.62, containerGreen, greenRib, darkFrame)

  for (const side of [-1, 1]) {
    for (const z of [-1.25, 13.85]) {
      beam(group, `landing-leg-forward-strut-${side}-${z}`, [side * 2.20, -2.15, z - 0.35], [side * 2.84, -3.82, z], 0.090, frame)
      beam(group, `landing-leg-aft-strut-${side}-${z}`, [side * 2.20, -2.15, z + 0.35], [side * 2.84, -3.82, z], 0.090, frame)
      cylinder(group, `landing-leg-hydraulic-${side}-${z}`, 0.075, 0.075, 1.46, [side * 2.62, -3.02, z], 'y', darkFrame, 12)
      box(group, `landing-pad-${side}-${z}`, [0.86, 0.18, 0.98], [side * 2.84, -3.91, z], blackRubber)
      box(group, `landing-pad-yellow-cap-${side}-${z}`, [0.56, 0.035, 0.58], [side * 2.84, -3.80, z], hazardYellow)
    }
  }

  for (const side of [-1, 1]) {
    for (const y of [-0.88, 0.58]) {
      cylinder(group, `rear-thruster-nozzle-${side}-${y}`, 0.43, 0.55, 1.08, [side * 1.55, y, 17.42], 'z', charcoal, 24)
      torus(group, `rear-thruster-rim-${side}-${y}`, 0.46, 0.052, [side * 1.55, y, 17.98], 'z', frame, 24)
      cylinder(group, `rear-thruster-orange-core-${side}-${y}`, 0.32, 0.32, 0.045, [side * 1.55, y, 18.03], 'z', amber, 24)
      sphere(group, `rear-thruster-glow-halo-${side}-${y}`, 0.26, [side * 1.55, y, 18.09], amber, [1, 1, 0.35], 16)
    }
    box(group, `rear-rcs-thruster-block-${side}`, [0.48, 0.36, 0.44], [side * 3.42, 0.88, 16.45], charcoal)
    box(group, `rear-rcs-side-port-${side}`, [0.045, 0.14, 0.14], [side * 3.68, 0.88, 16.45], amber)
    box(group, `side-work-light-${side}`, [0.16, 0.14, 0.10], [side * 3.25, 0.42, 6.30], workLamp)
    box(group, `aft-work-light-${side}`, [0.18, 0.14, 0.10], [side * 2.35, 0.66, 15.75], workLamp)
  }

  return group
}

function buildCockpit(): THREE.Group {
  const group = shipGroup('Mule original industrial cockpit')
  const charcoal = metal(0x191b1d, 0.82, 0.35)
  const dark = metal(0x0f1011, 0.86, 0.28)
  const steel = metal(0x6f716c, 0.54, 0.65)
  const wornYellow = metal(0xb98f24, 0.78, 0.28)
  const orange = metal(0xb55b25, 0.70, 0.35)
  const rubber = metal(0x0a0a0a, 0.92, 0.16)
  const amber = light(0xffa232)
  const paper = metal(0xc7b58d, 0.85, 0.05)

  const dash = plate(group, 'heavy-dashboard-face', [
    [-1.22, -0.86], [-1.22, -0.54], [-0.98, -0.42], [-0.36, -0.42],
    [-0.25, -0.47], [0.25, -0.47], [0.36, -0.42], [0.98, -0.42],
    [1.22, -0.54], [1.22, -0.86],
  ], 0.28, charcoal)
  dash.position.z = -1.58
  box(group, 'dashboard-rubber-bumper', [2.52, 0.08, 0.10], [0, -0.86, -1.32], rubber)
  box(group, 'dashboard-yellow-crash-rail', [2.18, 0.075, 0.10], [0, -0.43, -1.39], wornYellow)
  box(group, 'footwell-ribbed-floor', [2.15, 0.08, 1.58], [0, -1.18, -0.36], dark)
  for (let i = 0; i < 7; i++) {
    box(group, `floor-rib-${i}`, [2.02, 0.018, 0.035], [0, -1.12, -0.96 + i * 0.18], steel)
  }

  beam(group, 'windshield-lower-sill', [-1.32, -0.36, -1.31], [1.32, -0.36, -1.31], 0.052, steel)
  beam(group, 'windshield-roof-brow', [-1.34, 0.66, -1.36], [1.34, 0.66, -1.36], 0.060, steel)
  for (const side of [-1, 1]) {
    beam(group, `windshield-side-pillar-${side}`, [side * 1.28, -0.36, -1.31], [side * 1.18, 0.66, -1.36], 0.058, steel)
    beam(group, `roof-side-rail-${side}`, [side * 1.18, 0.66, -1.36], [side * 1.10, 0.84, -0.05], 0.050, charcoal)
    beam(group, `grab-handle-${side}`, [side * 0.92, 0.54, -1.14], [side * 0.92, 0.54, -0.68], 0.026, wornYellow)
    box(group, `side-console-${side}`, [0.38, 0.26, 1.12], [side * 0.90, -0.85, -0.56], charcoal)
    box(group, `side-console-inset-${side}`, [0.30, 0.020, 0.84], [side * 0.90, -0.70, -0.56], dark)
    for (let i = 0; i < 4; i++) {
      box(group, `side-console-toggle-${side}-${i}`, [0.045, 0.030, 0.065], [side * (0.82 + i * 0.055), -0.67, -0.80 + i * 0.13], steel)
    }
  }
  const cupHolder = torus(group, 'left-console-cup-holder', 0.105, 0.012, [-0.91, -0.65, -0.35], 'y', orange, 28)
  cupHolder.scale.z = 0.76
  box(group, 'right-console-clipboard', [0.30, 0.022, 0.42], [0.92, -0.63, -0.62], paper)
  box(group, 'clipboard-top-clip', [0.24, 0.030, 0.045], [0.92, -0.60, -0.83], steel)

  box(group, 'overhead-switch-panel', [1.18, 0.12, 0.46], [0, 0.52, -1.16], charcoal)
  for (let i = 0; i < 8; i++) {
    const x = -0.46 + i * 0.13
    box(group, `overhead-toggle-${i}`, [0.034, 0.048, 0.050], [x, 0.45, -1.16], i % 2 === 0 ? steel : orange)
    box(group, `overhead-status-lamp-${i}`, [0.026, 0.020, 0.026], [x, 0.43, -0.95], i % 3 === 0 ? amber : dark)
  }

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.59, -0.43, -1.18], rotation: [-0.30, 0, 0], width: 0.46 },
      { kind: 'navigation', position: [0, -0.405, -1.20], rotation: [-0.30, 0, 0], width: 0.58 },
      { kind: 'altitude', position: [0.59, -0.43, -1.18], rotation: [-0.30, 0, 0], width: 0.46 },
    ],
    speedGauge: { position: [-0.35, -0.76, -1.31], rotation: [-0.18, 0, 0] },
    verticalGauge: { position: [0.35, -0.76, -1.31], rotation: [-0.18, 0, 0] },
    heading: { position: [0, -0.782, -1.31], rotation: [-0.18, 0, 0] },
    warpLamp: { position: [0.22, -0.79, -1.31], rotation: [-0.18, 0, 0] },
    throttle: { position: [-0.78, -0.80, -1.31], rotation: [-0.18, 0, 0], step: 0.026 },
    scale: 1.08,
  }, MULE_PALETTE)
  cabinLight(group, 0xffc46a, 2.3, 5.4, [0, 0.25, -0.42])
  return group
}

export const mule: OriginalShip = {
  id: 'mule',
  name: 'Mule',
  kind: 'original',
  blurb: 'A boxy space truck with an open cargo frame, battered containers, and hard-working lights.',
  sizeM: 24,
  eyeHeightM: 4,
  chaseM: [0, 6, 33],
  buildShip,
  buildCockpit,
}
