import * as THREE from 'three'
import { mountInstruments } from '../instruments'
import type { DisplayPalette } from '../instruments'
import { beam, box, cabinLight, cylinder, light, metal, plate, shipGroup, sphere, torus } from '../parts'
import type { ShipDesign } from './types'

const ROCINANTE_PALETTE: DisplayPalette = {
  background: '#06111c', grid: '#11304a', frame: '#1d7192', title: '#84ddff', primary: '#d2f6ff', secondary: '#73c9ef', footer: '#3df0ff',
  housing: 0x0b1420, screw: 0x7ca9b6, gaugeFace: 0x07101a, gaugeRing: 0x245a76, tick: 0x72d9ff, needle: 0xd5fbff,
  compass: 0x34b4dc, chevron: 0xb7f4ff, lampOff: 0x102536, lampOn: 0x73efff, barOff: 0x12324a, barOn: 0x54dfff,
}

function buildPdc(parent: THREE.Object3D, name: string, x: number, y: number, z: number, side: number,
  housing: THREE.Material, barrel: THREE.Material) {
  const turret = sphere(parent, `${name}-rounded-turret`, 0.24, [x, y, z], housing, [1, 0.72, 1], 16)
  turret.rotation.z = side === 0 ? 0 : side * 0.38
  const barrelEndZ = z + (side === 0 ? -0.72 : -0.36)
  const barrelEndX = x + side * 0.72
  for (const offset of [-0.055, 0.055]) {
    beam(parent, `${name}-barrel`, [x + offset, y + 0.02, z - 0.03], [barrelEndX + offset, y + 0.02, barrelEndZ], 0.022, barrel, 8)
  }
}

interface HullSection {
  z: number
  width: number
  height: number
  centerY: number
}

function sectionPoints(section: HullSection): THREE.Vector2[] {
  const w = section.width
  const h = section.height
  const y = section.centerY
  return [
    new THREE.Vector2(-w * 0.42, y + h / 2),
    new THREE.Vector2(w * 0.42, y + h / 2),
    new THREE.Vector2(w / 2, y + h * 0.38),
    new THREE.Vector2(w / 2, y - h * 0.38),
    new THREE.Vector2(w * 0.42, y - h / 2),
    new THREE.Vector2(-w * 0.42, y - h / 2),
    new THREE.Vector2(-w / 2, y - h * 0.38),
    new THREE.Vector2(-w / 2, y + h * 0.38),
  ]
}

function facetedSegment(parent: THREE.Object3D, name: string, front: HullSection, rear: HullSection, material: THREE.Material) {
  const frontPoints = sectionPoints(front)
  const rearPoints = sectionPoints(rear)
  const vertices: number[] = []
  for (const point of frontPoints) vertices.push(point.x, point.y, front.z)
  for (const point of rearPoints) vertices.push(point.x, point.y, rear.z)
  const indices: number[] = []
  for (let i = 1; i < 7; i++) {
    indices.push(0, i + 1, i)
    indices.push(8, 8 + i, 8 + i + 1)
  }
  for (let i = 0; i < 8; i++) {
    const next = (i + 1) % 8
    indices.push(i, next, 8 + next, i, 8 + next, 8 + i)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  parent.add(mesh)
  return mesh
}

function buildShip(): THREE.Group {
  const group = shipGroup('Rocinante corvette-class frigate')
  const hull = metal(0x7d838c, 0.5, 0.32)
  const darkHull = metal(0x626973, 0.6, 0.3)
  const edge = metal(0x9aa1aa, 0.42, 0.38)
  const shadow = metal(0x3a424c, 0.7, 0.25)
  const marking = metal(0x7a6d62, 0.72, 0.35)
  const cyan = light(0xa9f4ff)
  const blue = light(0x7edfff)
  const amber = light(0xe4c28a)

  facetedSegment(group, 'sloped-wedge-nose-hull', { z: -4.95, width: 0.18, height: 0.30, centerY: -0.34 },
    { z: -1.05, width: 1.86, height: 3.95, centerY: -0.08 }, hull)
  facetedSegment(group, 'forward-flat-sided-armor-stack', { z: -1.05, width: 1.86, height: 3.95, centerY: -0.08 },
    { z: 5.3, width: 2.34, height: 4.80, centerY: 0.02 }, hull)
  facetedSegment(group, 'midships-stepped-armor-stack', { z: 5.3, width: 2.34, height: 4.80, centerY: 0.02 },
    { z: 12.6, width: 2.70, height: 5.36, centerY: 0.04 }, darkHull)
  facetedSegment(group, 'weapons-deck-faceted-stack', { z: 12.6, width: 2.70, height: 5.36, centerY: 0.04 },
    { z: 20.8, width: 2.98, height: 5.76, centerY: 0.02 }, hull)
  facetedSegment(group, 'engineering-tall-armor-stack', { z: 20.8, width: 2.98, height: 5.76, centerY: 0.02 },
    { z: 30.6, width: 2.82, height: 5.52, centerY: -0.02 }, darkHull)
  facetedSegment(group, 'drive-neck-faceted-taper', { z: 30.6, width: 2.82, height: 5.52, centerY: -0.02 },
    { z: 33.15, width: 1.92, height: 4.04, centerY: -0.02 }, shadow)

  const bands = [
    { z: -1.05, width: 1.90, height: 4.05, centerY: -0.08 },
    { z: 5.3, width: 2.40, height: 4.92, centerY: 0.02 },
    { z: 12.6, width: 2.78, height: 5.50, centerY: 0.04 },
    { z: 20.8, width: 3.06, height: 5.88, centerY: 0.02 },
    { z: 30.6, width: 2.90, height: 5.62, centerY: -0.02 },
  ]
  bands.forEach((band, i) => {
    box(group, `segmented-hull-top-band-${i}`, [band.width * 0.72, 0.08, 0.20], [0, band.centerY + band.height / 2 + 0.04, band.z], edge)
    box(group, `segmented-hull-keel-band-${i}`, [band.width * 0.72, 0.08, 0.20], [0, band.centerY - band.height / 2 - 0.04, band.z], edge)
    box(group, `segmented-hull-port-band-${i}`, [0.08, band.height * 0.62, 0.20], [-band.width / 2 - 0.04, band.centerY, band.z], edge)
    box(group, `segmented-hull-starboard-band-${i}`, [0.08, band.height * 0.62, 0.20], [band.width / 2 + 0.04, band.centerY, band.z], edge)
  })

  box(group, 'cockpit-armored-brow', [1.20, 0.14, 0.55], [0, 0.28, -3.38], darkHull)
  box(group, 'cockpit-window-slit-dark', [0.92, 0.10, 0.045], [0, 0.02, -3.68], light(0x0a1b24))
  box(group, 'cockpit-window-inner-glow', [0.44, 0.032, 0.052], [0, 0.02, -3.71], cyan)
  box(group, 'nose-keel-fairing', [0.62, 0.38, 2.2], [0, -2.02, -2.55], darkHull)
  box(group, 'nose-dorsal-armor-plate', [0.82, 0.12, 2.0], [0, 1.92, -1.65], edge)

  for (let i = 0; i < 8; i++) {
    const z = 1.1 + i * 3.45
    box(group, `dorsal-faceted-armor-${i}`, [1.14 + (i % 3) * 0.12, 0.10, 2.18], [0, 2.52 + Math.min(i, 4) * 0.045, z], i % 2 === 0 ? darkHull : hull)
    box(group, `keel-armor-block-${i}`, [0.80 + (i % 2) * 0.14, 0.09, 1.82], [0, -2.62 - Math.min(i, 4) * 0.045, z + 0.38], shadow)
  }

  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const z = 1.7 + i * 4.0
      const sidePlate = box(group, 'side-armor-facet', [0.075, 0.96, 2.25], [side * (1.24 + i * 0.04), 0.48 - (i % 2) * 0.16, z], i % 2 === 0 ? darkHull : hull)
      sidePlate.rotation.z = side * 0.10
      box(group, 'light-grey-panel-edge', [0.045, 0.055, 1.72], [side * (1.31 + i * 0.04), 1.04 - (i % 2) * 0.16, z], edge)
      box(group, 'muted-armor-marking', [0.052, 0.28, 0.85], [side * (1.34 + i * 0.04), -0.84, z - 0.44], marking)
    }

    for (const z of [3.4, 14.6, 25.8]) {
      box(group, 'airlock-hatch-vertical-edge', [0.04, 0.82, 0.06], [side * 1.54, 0.05, z - 0.42], edge)
      box(group, 'airlock-hatch-vertical-edge', [0.04, 0.82, 0.06], [side * 1.54, 0.05, z + 0.42], edge)
      box(group, 'airlock-hatch-horizontal-edge', [0.04, 0.06, 0.84], [side * 1.54, 0.46, z], edge)
      box(group, 'airlock-hatch-horizontal-edge', [0.04, 0.06, 0.84], [side * 1.54, -0.36, z], edge)
    }

    for (const z of [-1.0, 9.8, 21.5, 30.2]) {
      box(group, 'maneuvering-thruster-block', [0.36, 0.44, 0.52], [side * 1.62, 1.18, z], shadow)
      box(group, 'maneuvering-thruster-glow', [0.038, 0.20, 0.22], [side * 1.81, 1.18, z], blue)
      box(group, 'lower-maneuvering-thruster-block', [0.32, 0.36, 0.46], [side * 1.32, -1.78, z + 0.72], shadow)
      box(group, 'lower-maneuvering-thruster-glow', [0.034, 0.15, 0.18], [side * 1.48, -1.78, z + 0.72], blue)
    }

    for (const z of [6.8, 18.4, 29.5]) {
      box(group, 'dorsal-rcs-thruster-block', [0.30, 0.22, 0.44], [side * 0.64, 2.92, z], shadow)
      box(group, 'dorsal-rcs-thruster-face', [0.16, 0.026, 0.18], [side * 0.64, 3.04, z], blue)
      box(group, 'keel-rcs-thruster-block', [0.28, 0.20, 0.40], [side * 0.54, -2.92, z + 0.5], shadow)
      box(group, 'keel-rcs-thruster-face', [0.14, 0.024, 0.16], [side * 0.54, -3.03, z + 0.5], blue)
    }

    beam(group, 'forward-antenna-spar', [side * 0.34, 0.90, -3.9], [side * 0.82, 1.30, -4.78], 0.022, edge, 8)
    beam(group, 'aft-antenna-spar', [side * 0.58, 1.92, 19.0], [side * 1.32, 2.68, 18.35], 0.018, edge, 8)
    beam(group, 'dorsal-antenna-mast', [side * 0.22, 2.86, 23.8], [side * 0.40, 3.72, 23.2], 0.014, edge, 8)
    beam(group, 'landing-forward-strut', [side * 0.72, -2.25, 3.0], [side * 1.10, -5.22, 4.10], 0.055, edge, 8)
    beam(group, 'landing-mid-strut', [side * 0.90, -2.48, 15.4], [side * 1.22, -5.22, 15.8], 0.060, edge, 8)
    beam(group, 'landing-aft-strut', [side * 0.94, -2.55, 26.8], [side * 1.28, -5.22, 26.4], 0.060, edge, 8)
    box(group, 'landing-pad-forward', [0.86, 0.16, 0.92], [side * 1.13, -5.32, 4.12], shadow)
    box(group, 'landing-pad-mid', [0.96, 0.16, 1.05], [side * 1.24, -5.32, 15.82], shadow)
    box(group, 'landing-pad-aft', [1.05, 0.16, 1.18], [side * 1.30, -5.32, 26.42], shadow)
  }

  box(group, 'keel-mounted-railgun-spine', [0.36, 0.22, 28.7], [0, -3.03, 11.85], shadow)
  box(group, 'railgun-forward-muzzle', [0.56, 0.32, 1.10], [0, -3.06, -2.12], shadow)
  box(group, 'railgun-left-rail', [0.10, 0.12, 26.6], [-0.26, -2.84, 12.80], edge)
  box(group, 'railgun-right-rail', [0.10, 0.12, 26.6], [0.26, -2.84, 12.80], edge)

  buildPdc(group, 'dorsal-forward-pdc', 0, 2.55, 3.7, 0, shadow, edge)
  buildPdc(group, 'dorsal-mid-pdc', 0, 2.82, 14.8, 0, shadow, edge)
  buildPdc(group, 'dorsal-aft-pdc', 0, 2.84, 26.4, 0, shadow, edge)
  buildPdc(group, 'port-forward-pdc', -1.45, 0.70, 6.1, -1, shadow, edge)
  buildPdc(group, 'starboard-forward-pdc', 1.45, 0.70, 6.1, 1, shadow, edge)
  buildPdc(group, 'port-aft-pdc', -1.56, -0.24, 22.8, -1, shadow, edge)
  buildPdc(group, 'starboard-aft-pdc', 1.56, -0.24, 22.8, 1, shadow, edge)

  const bell = cylinder(group, 'wide-epstein-drive-bell', 2.05, 1.10, 2.8, [0, 0, 33.6], 'z', shadow, 32)
  bell.scale.set(0.78, 1, 1.08)
  const bellRim = torus(group, 'epstein-drive-rim', 1.98, 0.09, [0, 0, 34.98], 'z', edge, 40)
  bellRim.scale.set(0.78, 1.08, 1)
  const engineCore = new THREE.Mesh(new THREE.CircleGeometry(1.74, 40), light(0xbdeeff))
  engineCore.name = 'blue-white-epstein-drive-glow'
  engineCore.scale.set(0.78, 1.08, 1)
  engineCore.position.set(0, 0, 35.08)
  group.add(engineCore)
  const innerGlow = new THREE.Mesh(new THREE.CircleGeometry(1.02, 32), light(0xf0fdff))
  innerGlow.name = 'white-hot-drive-core'
  innerGlow.scale.set(0.72, 0.98, 1)
  innerGlow.position.set(0, 0, 35.09)
  group.add(innerGlow)

  for (let i = 0; i < 6; i++) {
    box(group, 'epstein-cooling-rib', [0.08, 1.05, 0.38], [Math.sin(i * Math.PI / 3) * 1.42, Math.cos(i * Math.PI / 3) * 1.92, 31.0], edge)
  }

  box(group, 'pilot-eye-cyan-glint', [0.10, 0.06, 0.025], [0, 0, -0.02], amber)
  return group
}

function buildCockpit(): THREE.Group {
  const group = shipGroup('Rocinante armored cockpit')
  const navy = metal(0x0b1420, 0.78, 0.38)
  const dark = metal(0x050b12, 0.86, 0.26)
  const armor = metal(0x2d3841, 0.66, 0.62)
  const trim = metal(0x516979, 0.52, 0.58)
  const cyan = light(0x41dfff)
  const softCyan = light(0x8ceeff)

  box(group, 'armored-window-top-brow', [1.74, 0.040, 0.16], [0, 0.55, -1.27], armor)
  box(group, 'armored-window-lower-sill', [1.74, 0.035, 0.15], [0, -0.68, -1.23], armor)
  for (const side of [-1, 1]) {
    box(group, 'window-side-cheek-armor', [0.10, 0.78, 0.20], [side * 1.01, -0.02, -1.23], armor)
    beam(group, 'slit-window-canted-brace', [side * 0.86, 0.52, -1.31], [side * 1.18, 0.68, -0.48], 0.025, trim, 8)
    beam(group, 'lower-cockpit-brace', [side * 0.88, -0.52, -1.25], [side * 1.13, -0.73, -0.20], 0.027, trim, 8)
    box(group, 'side-bulkhead-armor', [0.16, 1.34, 1.26], [side * 1.22, -0.18, -0.38], navy)
    box(group, 'side-console-body', [0.42, 0.26, 1.12], [side * 0.78, -0.73, -0.40], navy)
    box(group, 'side-console-touch-panel', [0.29, 0.016, 0.76], [side * 0.78, -0.59, -0.46], light(0x0e3248))
    box(group, 'upper-side-touch-panel', [0.018, 0.26, 0.40], [side * 1.05, -0.14, -0.72], light(0x0b2a3d))
    box(group, 'upper-side-panel-cyan-readout', [0.020, 0.035, 0.28], [side * 1.04, -0.18, -0.72], cyan)
    for (let i = 0; i < 5; i++) {
      box(group, 'cyan-touch-control', [0.016, 0.019, 0.10], [side * (0.66 + i * 0.045), -0.574, -0.77 + i * 0.13], i % 2 === 0 ? cyan : softCyan)
    }
    box(group, 'crash-couch-armrest', [0.16, 0.18, 0.82], [side * 0.44, -0.48, 0.20], dark)
    box(group, 'crash-couch-arm-console', [0.13, 0.035, 0.34], [side * 0.44, -0.36, 0.03], light(0x0d344a))
    box(group, 'armrest-cyan-strip', [0.028, 0.032, 0.48], [side * 0.44, -0.36, -0.02], cyan)
    box(group, 'crash-couch-thumb-panel', [0.11, 0.020, 0.16], [side * 0.44, -0.332, -0.25], light(0x15506d))
    box(group, 'crash-couch-warning-tile', [0.030, 0.022, 0.060], [side * 0.44, -0.318, -0.32], light(0xffb46d))
    box(group, 'side-peripheral-touch-panel', [0.014, 0.18, 0.34], [side * 0.96, -0.40, -0.18], light(0x0f3f57))
    box(group, 'side-peripheral-cyan-readout', [0.016, 0.030, 0.22], [side * 0.95, -0.42, -0.18], softCyan)
  }

  const dash = plate(group, 'angled-touch-dashboard', [
    [-1.02, -0.80], [-1.02, -0.47], [-0.74, -0.35], [-0.30, -0.35], [-0.22, -0.41],
    [0.22, -0.41], [0.30, -0.35], [0.74, -0.35], [1.02, -0.47], [1.02, -0.80],
  ], 0.19, navy)
  dash.position.z = -1.62
  box(group, 'dashboard-keel-shadow', [0.45, 0.09, 0.32], [0, -0.82, -1.35], dark)
  box(group, 'dashboard-cyan-status-strip', [1.52, 0.020, 0.030], [0, -0.365, -1.40], cyan)
  box(group, 'floor-pressure-deck', [1.36, 0.08, 1.48], [0, -1.12, -0.20], dark)
  box(group, 'crash-couch-seat-pan', [0.70, 0.18, 0.70], [0, -0.84, 0.32], dark)
  box(group, 'crash-couch-back', [0.68, 0.82, 0.16], [0, -0.38, 0.70], dark)
  box(group, 'crash-couch-headrest', [0.44, 0.24, 0.18], [0, 0.16, 0.78], dark)
  box(group, 'headrest-cyan-trim', [0.34, 0.025, 0.030], [0, 0.28, 0.68], cyan)
  beam(group, 'overhead-roll-cage-left', [-0.70, 0.55, -1.20], [-0.50, 0.91, 0.42], 0.030, armor, 8)
  beam(group, 'overhead-roll-cage-right', [0.70, 0.55, -1.20], [0.50, 0.91, 0.42], 0.030, armor, 8)
  beam(group, 'overhead-crossbar', [-0.58, 0.82, -0.36], [0.58, 0.82, -0.36], 0.026, armor, 8)

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.54, -0.52, -1.34], rotation: [-0.28, 0.03, 0], width: 0.43, height: 0.23 },
      { kind: 'navigation', position: [0, -0.50, -1.36], rotation: [-0.30, 0, 0], width: 0.52, height: 0.25 },
      { kind: 'altitude', position: [0.54, -0.52, -1.34], rotation: [-0.28, -0.03, 0], width: 0.43, height: 0.23 },
    ],
    speedGauge: { position: [-0.33, -0.72, -1.31], rotation: [-0.18, 0, 0] },
    verticalGauge: { position: [0.33, -0.72, -1.31], rotation: [-0.18, 0, 0] },
    heading: { position: [0, -0.735, -1.31], rotation: [-0.18, 0, 0] },
    warpLamp: { position: [0.20, -0.735, -1.31], rotation: [-0.18, 0, 0] },
    throttle: { position: [-0.75, -0.742, -1.31], rotation: [-0.18, 0, 0], step: 0.023 },
    scale: 1.02,
  }, ROCINANTE_PALETTE)
  cabinLight(group, 0x5fdfff, 2.5, 5, [0, 0.18, -0.22])
  return group
}

export const rocinante: ShipDesign = {
  id: 'rocinante',
  name: 'Rocinante',
  kind: 'tribute',
  franchise: 'The Expanse',
  owner: 'Alcon Entertainment',
  blurb: 'Martian corvette-class frigate with a tall armored hull, PDCs, keel railgun, and Epstein drive.',
  sizeM: 40,
  canonSizeM: 46,
  eyeHeightM: 5.4,
  chaseM: [0, 16, 72],
  buildShip,
  buildCockpit,
}
