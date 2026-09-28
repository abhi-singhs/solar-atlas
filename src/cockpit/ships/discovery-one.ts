import * as THREE from 'three'
import { mountInstruments, type DisplayPalette } from '../instruments'
import { beam, box, cabinLight, cylinder, lathe, light, matte, metal, shipGroup, sphere, torus } from '../parts'
import type { ShipDesign } from './types'

const DISCOVERY_PALETTE: DisplayPalette = {
  background: '#050505',
  grid: '#222222',
  frame: '#f2f2e8',
  title: '#ffffff',
  primary: '#ffffff',
  secondary: '#c9c9bf',
  footer: '#d23a2e',
  titleFont: '"Futura", "Century Gothic", sans-serif',
  monoFont: '"IBM Plex Mono", "Courier New", monospace',
  housing: 0xf0f0e8,
  screw: 0xa6a49b,
  gaugeFace: 0x070707,
  gaugeRing: 0xd8d6ca,
  tick: 0xffffff,
  needle: 0xd64033,
  compass: 0xf5f5ee,
  chevron: 0xd64033,
  lampOff: 0x2a1412,
  lampOn: 0xe04435,
  barOff: 0x202020,
  barOn: 0xf5f5ee,
}

function addDisk(parent: THREE.Object3D, name: string, radius: number, position: [number, number, number], material: THREE.Material, segments = 32) {
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(radius, segments), material)
  mesh.name = name
  mesh.position.set(position[0], position[1], position[2])
  parent.add(mesh)
  return mesh
}

function addSpine(parent: THREE.Group, white: THREE.Material, pale: THREE.Material, dark: THREE.Material) {
  const start = 1.75
  const pitch = 1.18
  for (let i = 0; i < 24; i++) {
    const z = start + i * pitch
    const module = box(parent, 'solid-spine-vertebra', [1.18, 1.18, 0.82], [0, 0, z], i % 3 === 0 ? pale : white)
    module.rotation.z = i % 2 === 0 ? 0.05 : -0.05
    box(parent, 'dark-spine-collar', [1.28, 1.28, 0.13], [0, 0, z + 0.47], dark)
    if (i % 4 === 2) box(parent, 'spine-service-node', [0.48, 0.32, 0.46], [0.64, -0.12, z], pale)
  }
  beam(parent, 'spine-side-conduit', [0.78, -0.43, start - 0.36], [0.78, -0.43, start + 23 * pitch + 0.52], 0.045, dark, 8)
  for (let i = 0; i < 8; i++) {
    const z = start + i * pitch * 3
    box(parent, 'spine-conduit-clamp', [0.18, 0.16, 0.08], [0.78, -0.43, z], pale)
  }
}

function addAntenna(parent: THREE.Group, white: THREE.Material, pale: THREE.Material, dark: THREE.Material, silver: THREE.Material) {
  beam(parent, 'antenna-mast', [0, 0.46, 14.7], [0, 2.08, 14.7], 0.055, silver, 10)
  beam(parent, 'antenna-forward-strut', [0, 0.40, 14.1], [0, 1.52, 14.65], 0.030, silver, 8)
  beam(parent, 'antenna-aft-strut', [0, 0.40, 15.3], [0, 1.52, 14.75], 0.030, silver, 8)
  const main = lathe(parent, 'long-range-antenna-dish', [
    [0.18, -0.22], [1.28, 0.05], [1.48, 0.20], [1.34, 0.31], [0.18, 0.42],
  ], [0, 2.25, 14.25], 'z', white, 36)
  main.rotation.x -= 0.18
  cylinder(parent, 'antenna-feed-horn', 0.08, 0.11, 0.50, [0, 2.25, 13.88], 'z', dark, 16)
  for (const side of [-1, 1]) {
    beam(parent, 'small-antenna-arm', [0, 1.52, 14.78], [side * 0.88, 1.92, 14.92], 0.025, silver, 8)
    const dish = lathe(parent, 'small-antenna-dish', [
      [0.08, -0.08], [0.48, 0.04], [0.58, 0.15], [0.10, 0.27],
    ], [side * 1.02, 1.98, 14.95], 'z', pale, 24)
    dish.rotation.y = side * 0.28
  }
}

function addLandingGear(parent: THREE.Group, dark: THREE.Material, silver: THREE.Material) {
  for (const side of [-1, 1]) {
    beam(parent, 'command-module-landing-strut', [side * 0.92, -2.10, -1.72], [side * 1.24, -3.79, -1.82], 0.045, silver, 8)
    box(parent, 'command-module-landing-pad', [0.58, 0.12, 0.78], [side * 1.24, -3.94, -1.82], dark)
    beam(parent, 'engine-module-landing-strut', [side * 1.06, -0.94, 32.55], [side * 1.42, -3.78, 33.15], 0.050, silver, 8)
    box(parent, 'engine-module-landing-pad', [0.68, 0.12, 1.06], [side * 1.42, -3.94, 33.15], dark)
  }
}

function buildShip(): THREE.Group {
  const group = shipGroup('Discovery One tribute spacecraft')
  const white = matte(0xe8e8df, 0.72)
  const offWhite = matte(0xf3f1e7, 0.68)
  const pale = metal(0xc6c5ba, 0.62, 0.25)
  const dark = metal(0x161719, 0.72, 0.35)
  const line = metal(0x5a5c5b, 0.78, 0.25)
  const silver = metal(0xb7b7ad, 0.38, 0.62)
  const engineGlow = light(0x9fc7ff)

  sphere(group, 'white-spherical-command-module', 2.45, [0, 0.04, -1.26], offWhite, [1.04, 1, 1], 48)
  torus(group, 'command-module-equator-panel-line', 2.47, 0.010, [0, 0.04, -1.26], 'y', line, 64)
  torus(group, 'command-module-vertical-panel-line', 2.48, 0.008, [0, 0.04, -1.26], 'x', line, 64)
  torus(group, 'command-module-window-meridian-line', 2.50, 0.008, [0, 0.04, -1.26], 'z', line, 64)
  cylinder(group, 'command-module-spine-collar', 0.86, 1.14, 0.55, [0, 0.02, 1.28], 'z', pale, 32)
  box(group, 'dark-forward-window-band', [2.35, 0.56, 0.055], [0, 0.74, -3.74], dark)
  for (const side of [-1, 1]) {
    const segment = box(group, 'dark-forward-window-band-side', [0.70, 0.48, 0.055], [side * 1.31, 0.71, -3.55], dark)
    segment.rotation.y = side * 0.24
    box(group, 'command-module-window-frame', [0.060, 0.64, 0.034], [side * 0.76, 0.74, -3.765], white)
  }
  box(group, 'command-module-window-top-frame', [2.70, 0.040, 0.040], [0, 1.05, -3.70], white)
  box(group, 'command-module-window-bottom-frame', [2.58, 0.040, 0.040], [0, 0.43, -3.70], white)
  for (const [index, x] of [-0.88, 0, 0.88].entries()) {
    const door = addDisk(group, `pod-bay-door-${index + 1}`, 0.36, [x, -0.85, -3.748], dark, 40)
    door.rotation.y = Math.PI
    torus(group, 'pod-bay-door-bezel', 0.37, 0.020, [x, -0.85, -3.742], 'z', pale, 40)
    box(group, 'pod-bay-door-center-line', [0.030, 0.62, 0.026], [x, -0.85, -3.715], line)
  }
  for (const y of [-1.22, -0.32, 1.28]) {
    box(group, 'command-module-fine-panel-line', [1.20, 0.018, 0.028], [0, y, -3.45], line)
  }

  addSpine(group, white, pale, dark)
  addAntenna(group, white, pale, dark, silver)

  box(group, 'reactor-module-boxy-core', [2.58, 1.54, 4.85], [0, 0, 33.28], white)
  sphere(group, 'rounded-reactor-housing', 1.25, [0, 0.10, 32.40], pale, [1.16, 0.78, 1.28], 32)
  box(group, 'reactor-module-top-ridge', [1.38, 0.40, 3.84], [0, 1.00, 33.34], offWhite)
  box(group, 'reactor-module-bottom-ridge', [1.24, 0.30, 3.20], [0, -1.00, 33.20], pale)
  for (const side of [-1, 1]) {
    box(group, 'reactor-side-equipment-bay', [0.48, 1.10, 3.36], [side * 1.52, 0, 33.30], pale)
    box(group, 'reactor-side-dark-vent', [0.055, 0.58, 0.72], [side * 1.79, 0.20, 33.98], dark)
    box(group, 'reactor-side-panel-line', [0.060, 0.86, 0.040], [side * 1.80, -0.05, 32.70], line)
  }
  box(group, 'reactor-front-neck', [1.18, 0.82, 0.72], [0, 0, 30.78], pale)
  for (const [x, y] of [[-0.74, 0.42], [0.74, 0.42], [-0.74, -0.42], [0.74, -0.42], [0, 0]] as const) {
    cylinder(group, 'engine-nozzle-barrel', 0.25, 0.34, 0.68, [x, y, 35.94], 'z', dark, 24)
    torus(group, 'engine-nozzle-rim', 0.32, 0.040, [x, y, 36.30], 'z', silver, 32)
    addDisk(group, 'engine-blue-core', 0.22, [x, y, 36.345], engineGlow, 24)
  }
  for (let i = 0; i < 6; i++) {
    box(group, 'reactor-aft-panel-line', [2.70, 0.025, 0.025], [0, -0.68 + i * 0.27, 35.48], line)
  }
  addLandingGear(group, dark, silver)
  return group
}

function buildCockpit(): THREE.Group {
  const group = shipGroup('Discovery One command module cockpit')
  const white = matte(0xf3f1e8, 0.68)
  const warmWhite = matte(0xdedbd0, 0.72)
  const black = metal(0x050505, 0.74, 0.25)
  const dark = metal(0x151515, 0.76, 0.3)
  const silver = metal(0xb9b7ac, 0.35, 0.68)
  const red = light(0xee2118)
  const green = light(0x8fdc80)
  const amber = light(0xe8c36f)
  const cyan = light(0x9fd7ff)

  box(group, 'curved-window-upper-frame', [2.14, 0.08, 0.10], [0, 0.47, -1.58], white)
  box(group, 'curved-window-lower-frame', [2.04, 0.07, 0.10], [0, -0.36, -1.58], white)
  box(group, 'dark-recessed-ceiling', [1.76, 0.09, 1.14], [0, 0.78, -0.86], dark)
  box(group, 'white-ceiling-side-left', [0.18, 0.08, 1.08], [-1.00, 0.73, -0.86], white)
  box(group, 'white-ceiling-side-right', [0.18, 0.08, 1.08], [1.00, 0.73, -0.86], white)
  for (const side of [-1, 1]) {
    const pillar = box(group, 'curved-window-side-frame', [0.08, 0.80, 0.10], [side * 1.08, 0.05, -1.56], white)
    pillar.rotation.z = side * 0.10
    const sideConsole = box(group, 'white-side-console', [0.38, 0.23, 1.02], [side * 0.86, -0.82, -0.58], warmWhite)
    sideConsole.rotation.z = side * 0.08
    box(sideConsole, 'black-side-console-inset', [0.28, 0.016, 0.72], [0, 0.13, -0.02], black)
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 3; column++) {
        const material = (row + column) % 3 === 0 ? amber : (column === 2 ? green : silver)
        box(sideConsole, 'square-side-console-button', [0.034, 0.018, 0.034], [
          -side * 0.080 + side * column * 0.070, 0.148, -0.31 + row * 0.14,
        ], material)
      }
    }
    box(group, 'upper-static-screen-housing', [0.42, 0.14, 0.050], [side * 0.72, -0.18, -1.42], warmWhite)
    box(group, 'upper-static-screen-dark-recess', [0.33, 0.085, 0.022], [side * 0.72, -0.18, -1.382], black)
    box(group, 'upper-static-screen-green-readout', [0.13, 0.050, 0.014], [side * 0.65, -0.18, -1.362], green)
    box(group, 'upper-static-screen-amber-readout', [0.13, 0.050, 0.014], [side * 0.79, -0.18, -1.362], amber)
  }
  box(group, 'white-lower-dashboard', [1.92, 0.18, 0.36], [0, -0.82, -1.28], warmWhite)
  box(group, 'black-dashboard-recess', [1.70, 0.045, 0.30], [0, -0.69, -1.30], black)
  box(group, 'cockpit-floor-shadow', [2.15, 0.08, 1.40], [0, -1.13, -0.44], dark)
  box(group, 'window-band-overhead-shadow', [1.82, 0.055, 0.08], [0, 0.60, -1.46], black)
  box(group, 'hal-panel', [0.25, 0.28, 0.052], [0.92, 0.10, -1.43], warmWhite)
  addDisk(group, 'hal-black-surround', 0.078, [0.92, 0.10, -1.399], black, 40)
  torus(group, 'hal-silver-bezel', 0.079, 0.010, [0.92, 0.10, -1.391], 'z', silver, 40)
  sphere(group, 'hal-red-lens', 0.041, [0.92, 0.10, -1.362], red, [1, 1, 0.32], 24)
  box(group, 'hal-lower-status-readout', [0.13, 0.022, 0.014], [0.92, -0.035, -1.397], cyan)

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.55, -0.48, -1.42], rotation: [-0.18, 0, 0], width: 0.42, height: 0.21 },
      { kind: 'navigation', position: [0, -0.48, -1.42], rotation: [-0.18, 0, 0], width: 0.52, height: 0.21 },
      { kind: 'altitude', position: [0.55, -0.48, -1.42], rotation: [-0.18, 0, 0], width: 0.42, height: 0.21 },
    ],
    speedGauge: { position: [-0.31, -0.74, -1.34], rotation: [-0.12, 0, 0] },
    verticalGauge: { position: [0.31, -0.74, -1.34], rotation: [-0.12, 0, 0] },
    heading: { position: [0, -0.76, -1.34], rotation: [-0.12, 0, 0] },
    warpLamp: { position: [0.19, -0.76, -1.33], rotation: [-0.12, 0, 0] },
    throttle: { position: [-0.75, -0.77, -1.33], rotation: [-0.12, 0, 0], step: 0.024 },
    scale: 1.04,
  }, DISCOVERY_PALETTE)
  cabinLight(group, 0xf0efe5, 2.25, 5, [0, 0.34, -0.55])
  return group
}

export const discoveryOne: ShipDesign = {
  id: 'discovery-one',
  name: 'Discovery One',
  kind: 'tribute',
  franchise: '2001: A Space Odyssey',
  owner: 'Turner Entertainment Co.',
  blurb: 'The Jupiter mission ship with a white command sphere, a long spine, and rear engines.',
  sizeM: 40,
  canonSizeM: 140,
  eyeHeightM: 4,
  chaseM: [0, 6.5, 52],
  buildShip,
  buildCockpit,
}
