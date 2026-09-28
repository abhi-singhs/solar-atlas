import * as THREE from 'three'
import type { DisplayPalette } from '../instruments'
import { mountInstruments } from '../instruments'
import { beam, box, cabinLight, cylinder, glass, light, matte, metal, shipGroup, sphere, torus } from '../parts'
import type { ShipDesign } from './types'

type Point2 = readonly [number, number]

const TIE_PALETTE: DisplayPalette = {
  background: '#0b1110',
  grid: '#24352f',
  frame: '#4f6258',
  title: '#b8c4b1',
  primary: '#dce9d3',
  secondary: '#8fa294',
  footer: '#b6caa8',
  housing: 0x28312e,
  screw: 0x667268,
  gaugeFace: 0x0d1311,
  gaugeRing: 0x77837a,
  tick: 0xaab8ad,
  needle: 0xd6e6cb,
  compass: 0x91a397,
  chevron: 0xb8c4a6,
  lampOff: 0x24302a,
  lampOn: 0xbbe88d,
  barOff: 0x1b2924,
  barOn: 0x9fbd8c,
}

const WING_POINTS: readonly Point2[] = [
  [-0.63, -3.75],
  [0.63, -3.75],
  [0.91, 0],
  [0.63, 3.75],
  [-0.63, 3.75],
  [-0.91, 0],
]

function flatPlate(parent: THREE.Object3D, name: string, points: readonly Point2[], depth: number, material: THREE.Material) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
  const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1 }), material)
  mesh.name = name
  parent.add(mesh)
  return mesh
}

function openSphereGeometry(radius: number, widthSegments: number, heightSegments: number, openAngle: number) {
  const positions: number[] = []
  const indices: number[] = []
  const rows: number[][] = []
  const frontCos = Math.cos(openAngle)

  for (let row = 0; row <= heightSegments; row++) {
    const theta = row / heightSegments * Math.PI
    const sinTheta = Math.sin(theta)
    const y = radius * Math.cos(theta)
    rows[row] = []
    for (let column = 0; column <= widthSegments; column++) {
      const phi = column / widthSegments * Math.PI * 2
      const x = radius * sinTheta * Math.cos(phi)
      const z = radius * sinTheta * Math.sin(phi)
      rows[row]![column] = positions.length / 3
      positions.push(x, y, z)
    }
  }

  for (let row = 0; row < heightSegments; row++) {
    for (let column = 0; column < widthSegments; column++) {
      const a = rows[row]![column]!
      const b = rows[row + 1]![column]!
      const c = rows[row + 1]![column + 1]!
      const d = rows[row]![column + 1]!
      const center = new THREE.Vector3()
        .fromArray(positions, a * 3)
        .add(new THREE.Vector3().fromArray(positions, b * 3))
        .add(new THREE.Vector3().fromArray(positions, c * 3))
        .add(new THREE.Vector3().fromArray(positions, d * 3))
        .multiplyScalar(0.25)
        .normalize()
      if (-center.z > frontCos) continue
      indices.push(a, b, d, b, c, d)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function spokedWindow(parent: THREE.Object3D, prefix: string, z: number, material: THREE.Material, startAngle = 0) {
  const outerRadius = 0.82
  const innerRadius = 0.42
  torus(parent, `${prefix}-outer-ring`, outerRadius, 0.044, [0, 0, z], 'z', material, 48)
  torus(parent, `${prefix}-inner-ring`, innerRadius, 0.030, [0, 0, z - 0.012], 'z', material, 40)
  for (let i = 0; i < 8; i++) {
    const angle = startAngle + i * Math.PI / 4
    const x = Math.cos(angle)
    const y = Math.sin(angle)
    beam(parent, `${prefix}-radial-spoke-${i}`, [x * 0.46, y * 0.46, z - 0.006], [x * 0.78, y * 0.78, z - 0.006], 0.021, material)
  }
}

function wingFrame(parent: THREE.Object3D, sideName: string, centerX: number, z: number, frame: THREE.Material, hub: THREE.Material) {
  const points = WING_POINTS.map(([x, y]) => new THREE.Vector3(centerX + x, y, z))
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    beam(parent, `${sideName}-solar-rim-${i}`, a.toArray(), b.toArray(), 0.026, frame)
  }
  for (let i = 0; i < points.length; i++) {
    const target = points[i]!.clone().lerp(new THREE.Vector3(centerX, 0, z), 0.16)
    beam(parent, `${sideName}-solar-rib-${i}`, [centerX, 0, z], target.toArray(), 0.023, frame)
  }
  cylinder(parent, `${sideName}-solar-hub`, 0.19, 0.19, 0.052, [centerX, 0, z], 'z', hub, 24)
}

function buildShip(): THREE.Group {
  const group = shipGroup('TIE fighter tribute')
  const hull = metal(0x6f858d, 0.62, 0.42)
  const hullDark = metal(0x344149, 0.72, 0.35)
  const frame = metal(0x93a1a3, 0.48, 0.62)
  const darkFrame = metal(0x4f6067, 0.58, 0.48)
  const solar = matte(0x182531, 0.9)
  const black = metal(0x070b0e, 0.8, 0.3)
  const glow = light(0xa8ff8a)
  const windowGlass = glass(0x050c12, 0.92)
  windowGlass.side = THREE.DoubleSide

  sphere(group, 'blue-grey-cockpit-ball', 1.34, [0, 0, 0], hull, [1, 1, 1], 32)
  torus(group, 'cockpit-equator-band', 1.345, 0.030, [0, 0, 0], 'y', darkFrame, 48)
  torus(group, 'cockpit-midline-band', 1.350, 0.024, [0, 0, 0], 'x', darkFrame, 48)
  torus(group, 'front-window-rim-armor', 0.94, 0.055, [0, 0, -1.31], 'z', frame, 48)
  const window = new THREE.Mesh(new THREE.CircleGeometry(0.78, 48), windowGlass)
  window.name = 'dark-forward-window-glass'
  window.position.set(0, 0, -1.355)
  group.add(window)
  spokedWindow(group, 'front-window-frame', -1.39, frame)
  torus(group, 'top-access-hatch', 0.43, 0.035, [0, 1.33, -0.02], 'y', frame, 40)
  torus(group, 'rear-vent-ring', 0.58, 0.055, [0, 0, 1.34], 'z', darkFrame, 40)
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4
    const x = Math.cos(angle)
    const y = Math.sin(angle)
    beam(group, `rear-vent-bar-${i}`, [x * 0.16, y * 0.16, 1.385], [x * 0.50, y * 0.50, 1.385], 0.018, black)
  }

  for (const side of [-1, 1] as const) {
    const sideName = side < 0 ? 'port' : 'starboard'
    const centerX = side * 2.29
    const panel = flatPlate(group, `${sideName}-dark-solar-panel`, WING_POINTS, 0.14, solar)
    panel.position.set(centerX, 0, -0.07)
    wingFrame(group, `${sideName}-front`, centerX, -0.115, frame, darkFrame)
    wingFrame(group, `${sideName}-rear`, centerX, 0.115, frame, darkFrame)
    cylinder(group, `${sideName}-wing-pylon`, 0.18, 0.18, 1.36, [side * 1.72, 0, 0], 'x', hullDark, 20)
    cylinder(group, `${sideName}-inner-flared-connector`, side > 0 ? 0.38 : 0.22, side > 0 ? 0.22 : 0.38,
      0.46, [side * 1.30, 0, 0], 'x', hull, 20)
    cylinder(group, `${sideName}-outer-flared-connector`, side > 0 ? 0.44 : 0.26, side > 0 ? 0.26 : 0.44,
      0.54, [side * 2.03, 0, 0], 'x', hull, 20)
    box(group, `${sideName}-pylon-root-plate`, [0.22, 0.66, 0.46], [side * 1.13, 0, 0], hullDark)
  }

  for (const side of [-1, 1] as const) {
    cylinder(group, `chin-laser-cannon-${side}`, 0.055, 0.070, 0.74, [side * 0.31, -0.64, -1.63], 'z', hullDark, 14)
    cylinder(group, `chin-laser-muzzle-${side}`, 0.070, 0.070, 0.045, [side * 0.31, -0.64, -2.02], 'z', black, 14)
    sphere(group, `green-laser-emitter-${side}`, 0.030, [side * 0.31, -0.64, -2.055], glow, [1, 1, 1], 12)
  }

  return group
}

function buildCockpit(): THREE.Group {
  const group = shipGroup('TIE fighter cockpit')
  const shell = metal(0x465650, 0.82, 0.28)
  shell.side = THREE.DoubleSide
  const frame = metal(0x748279, 0.62, 0.45)
  const dark = metal(0x161f1c, 0.84, 0.28)
  const trim = metal(0x59675e, 0.7, 0.35)
  const dimLight = light(0x93ad8c)
  const shellMesh = new THREE.Mesh(openSphereGeometry(1.54, 48, 24, 0.68), shell)
  shellMesh.name = 'open-cockpit-ball-shell'
  group.add(shellMesh)

  spokedWindow(group, 'cockpit-forward-window', -1.08, frame, Math.PI / 8)
  torus(group, 'cockpit-rear-service-ring', 1.04, 0.034, [0, 0, 0.66], 'z', trim, 40)
  torus(group, 'cockpit-top-hatch-inner-ring', 0.40, 0.026, [0, 1.22, -0.02], 'y', trim, 40)
  box(group, 'lower-center-console', [1.22, 0.22, 0.58], [0, -0.78, -1.02], dark)
  box(group, 'console-upper-lip', [1.38, 0.060, 0.16], [0, -0.59, -1.23], trim)
  box(group, 'rudder-pedal-well', [0.76, 0.08, 0.58], [0, -1.07, -0.74], dark)

  for (const side of [-1, 1] as const) {
    const sideName = side < 0 ? 'port' : 'starboard'
    beam(group, `${sideName}-window-side-brace`, [side * 0.72, -0.52, -1.02], [side * 1.16, -0.34, -0.12], 0.035, frame)
    beam(group, `${sideName}-upper-canopy-brace`, [side * 0.68, 0.60, -1.03], [side * 1.12, 0.42, -0.06], 0.032, frame)
    const console = box(group, `${sideName}-side-console`, [0.34, 0.22, 1.04], [side * 0.91, -0.80, -0.30], dark)
    console.rotation.z = side * -0.12
    box(console, `${sideName}-side-console-inset`, [0.22, 0.018, 0.76], [0, 0.119, -0.02], trim)
    for (let i = 0; i < 5; i++) {
      box(console, `${sideName}-toggle-bank-${i}`, [0.043, 0.021, 0.040], [side * 0.060, 0.140, -0.34 + i * 0.13], frame)
      box(console, `${sideName}-status-lamp-${i}`, [0.018, 0.010, 0.030], [-side * 0.070, 0.145, -0.34 + i * 0.13], dimLight)
    }
    beam(console, `${sideName}-control-yoke`, [0, 0.12, 0.20], [0, 0.29, 0.13], 0.026, trim)
    box(console, `${sideName}-control-grip`, [0.070, 0.040, 0.055], [0, 0.30, 0.13], frame)
  }

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.48, -0.31, -1.02], rotation: [-0.22, 0.12, 0], width: 0.37, height: 0.19 },
      { kind: 'navigation', position: [0, -0.32, -1.03], rotation: [-0.22, 0, 0], width: 0.47, height: 0.20 },
      { kind: 'altitude', position: [0.48, -0.31, -1.02], rotation: [-0.22, -0.12, 0], width: 0.37, height: 0.19 },
    ],
    speedGauge: { position: [-0.31, -0.62, -1.21], rotation: [-0.18, 0, 0] },
    verticalGauge: { position: [0.31, -0.62, -1.21], rotation: [-0.18, 0, 0] },
    heading: { position: [0, -0.64, -1.21], rotation: [-0.18, 0, 0] },
    warpLamp: { position: [0.21, -0.65, -1.21], rotation: [-0.18, 0, 0] },
    throttle: { position: [-0.74, -0.67, -1.21], rotation: [-0.18, 0, 0] },
    scale: 1.05,
  }, TIE_PALETTE)
  cabinLight(group, 0xb8c7af, 2.4, 4.2, [0, 0.30, -0.25])
  return group
}

export const tieFighter: ShipDesign = {
  id: 'tie-fighter',
  name: 'TIE fighter',
  kind: 'tribute',
  franchise: 'Star Wars',
  owner: 'Lucasfilm Ltd.',
  blurb: 'A spherical cockpit clamped between twin hexagonal solar wings.',
  sizeM: 7.56,
  eyeHeightM: 3.78,
  chaseM: [0, 5.5, 16],
  buildShip,
  buildCockpit,
}
