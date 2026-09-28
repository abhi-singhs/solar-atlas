import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { mountInstruments, type DisplayPalette } from '../instruments'
import { beam, box, cabinLight, cylinder, lathe, light, metal, shipGroup, sphere, torus } from '../parts'
import type { ShipDesign } from './types'

type PointYZ = readonly [number, number]
type Triple = readonly [number, number, number]

const ENTERPRISE_PALETTE: DisplayPalette = {
  background: '#050507',
  grid: '#24263a',
  frame: '#f1c24c',
  title: '#f3d97a',
  primary: '#67d8ff',
  secondary: '#7cff9b',
  footer: '#ff6b4a',
  housing: 0x0b0b0f,
  screw: 0xb7aa8c,
  gaugeFace: 0x050507,
  gaugeRing: 0xd3b35d,
  tick: 0x69d7ff,
  needle: 0xff694b,
  compass: 0xf2d05c,
  chevron: 0x7cff9b,
  lampOff: 0x32120c,
  lampOn: 0xff6b31,
  barOff: 0x1b2330,
  barOn: 0x5cc7ff,
}

function prismX(parent: THREE.Object3D, name: string, points: readonly PointYZ[], halfWidth: number, material: THREE.Material) {
  const vertices: number[] = []
  for (const x of [-halfWidth, halfWidth]) {
    for (const [z, y] of points) vertices.push(x, y, z)
  }
  const n = points.length
  const indices: number[] = []
  for (let i = 1; i < n - 1; i++) indices.push(0, i + 1, i, n, n + i, n + i + 1)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    indices.push(i, j, n + j, i, n + j, n + i)
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

function panel(parent: THREE.Object3D, name: string, corners: readonly Triple[], material: THREE.Material) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flat(), 3))
  geometry.setIndex([0, 1, 2, 0, 2, 3])
  geometry.computeVertexNormals()
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  parent.add(mesh)
  return mesh
}

function mergedSpheres(parent: THREE.Object3D, name: string, radius: number, positions: readonly Triple[],
  material: THREE.Material, scale: Triple = [1, 1, 1], segments = 12) {
  const base = new THREE.SphereGeometry(radius, segments, Math.max(8, Math.floor(segments * 2 / 3)))
  const geometries = positions.map(position => {
    const geometry = base.clone()
    geometry.scale(scale[0], scale[1], scale[2])
    geometry.translate(position[0], position[1], position[2])
    return geometry
  })
  const merged = mergeGeometries(geometries)
  base.dispose()
  for (const geometry of geometries) geometry.dispose()
  if (!merged) throw new Error(`${name} geometry merge failed`)
  const mesh = new THREE.Mesh(merged, material)
  mesh.name = name
  parent.add(mesh)
  return mesh
}

function bridgeArc(parent: THREE.Object3D, name: string, radius: number, y: number, zOffset: number, material: THREE.Material,
  start = -2.2, end = 2.2, segments = 14) {
  let previous: THREE.Vector3 | undefined
  for (let i = 0; i <= segments; i++) {
    const t = start + (end - start) * i / segments
    const point = new THREE.Vector3(Math.sin(t) * radius, y, zOffset - Math.cos(t) * radius)
    if (previous) beam(parent, name, [previous.x, previous.y, previous.z], [point.x, point.y, point.z], 0.025, material, 8)
    previous = point
  }
}

function stationPanel(parent: THREE.Object3D, name: string, angle: number, material: THREE.Material) {
  const radius = 1.68
  const station = box(parent, name, [0.60, 0.42, 0.10], [Math.sin(angle) * radius, -0.30, -Math.cos(angle) * radius], material)
  station.rotation.y = -angle
  return station
}

function buildCockpit(): THREE.Group {
  const group = shipGroup('Enterprise 1966 bridge cockpit')
  const black = metal(0x07070a, 0.72, 0.35)
  const charcoal = metal(0x17171b, 0.70, 0.35)
  const blueWall = metal(0x88969e, 0.68, 0.25)
  const trim = metal(0xd3b35d, 0.38, 0.65)
  const rail = metal(0x1a1a1e, 0.52, 0.55)
  const redRail = metal(0x9b332c, 0.48, 0.55)
  const red = light(0xff4c2c)
  const yellow = light(0xffcf4a)
  const green = light(0x50ff79)
  const blue = light(0x4fc8ff)

  cylinder(group, 'round-bridge-floor', 1.78, 1.78, 0.08, [0, -1.12, -0.05], 'y', charcoal, 48)
  bridgeArc(group, 'red-bridge-railing-ring', 1.08, -0.49, -0.02, redRail, -1.85, 1.85, 12)
  beam(group, 'left-railing-post', [-1.02, -0.94, -0.28], [-1.02, -0.50, -0.28], 0.025, rail)
  beam(group, 'right-railing-post', [1.02, -0.94, -0.28], [1.02, -0.50, -0.28], 0.025, rail)

  box(group, 'viewscreen-top-frame', [1.72, 0.08, 0.08], [0, 0.56, -2.34], trim)
  box(group, 'viewscreen-bottom-frame', [1.72, 0.08, 0.08], [0, -0.58, -2.34], trim)
  box(group, 'viewscreen-left-frame', [0.08, 1.12, 0.08], [-0.90, -0.01, -2.34], trim)
  box(group, 'viewscreen-right-frame', [0.08, 1.12, 0.08], [0.90, -0.01, -2.34], trim)

  const console = box(group, 'black-helm-navigation-console', [1.38, 0.30, 0.72], [0, -0.74, -1.10], black)
  console.rotation.x = -0.10
  box(group, 'console-gold-front-lip', [1.42, 0.045, 0.08], [0, -0.56, -1.45], trim)
  box(group, 'visible-helm-button-deck', [1.20, 0.050, 0.34], [0, -0.20, -1.80], black)
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < 9; i++) {
      box(group, 'viewscreen-side-console-button', [0.052, 0.018, 0.038], [-0.48 + i * 0.12, -0.16, -1.90 + row * 0.15],
        [red, yellow, green, blue][(i + row) % 4]!)
    }
  }
  for (let row = 0; row < 3; row++) {
    const material = [red, yellow, green][row]!
    for (let i = 0; i < 8; i++) {
      box(group, 'helm-colored-button', [0.055, 0.018, 0.040], [-0.48 + i * 0.14, -0.56, -1.03 + row * 0.085], material)
    }
  }
  for (let i = 0; i < 5; i++) {
    box(group, 'navigation-blue-toggle', [0.045, 0.018, 0.11], [-0.34 + i * 0.17, -0.55, -0.78], blue)
  }

  for (const angle of [-2.45, -1.78, -1.22, 1.22, 1.78, 2.45]) {
    const station = stationPanel(group, 'round-bridge-side-station', angle, blueWall)
    box(station, 'station-black-face', [0.48, 0.26, 0.018], [0, 0.03, 0.060], black)
    for (let i = 0; i < 4; i++) {
      box(station, 'station-colored-lamp', [0.050, 0.040, 0.020], [-0.18 + i * 0.12, -0.10, 0.074], [red, yellow, green, blue][i]!)
    }
  }
  for (const side of [-1, 1]) {
    const edgeStation = box(group, 'edge-of-view-side-station', [0.42, 0.38, 0.08], [side * 1.22, -0.13, -1.82], blueWall)
    edgeStation.rotation.y = side * 0.55
    box(edgeStation, 'edge-station-black-face', [0.32, 0.24, 0.018], [0, 0.02, 0.050], black)
    for (let i = 0; i < 3; i++) {
      box(edgeStation, 'edge-station-colored-lamp', [0.046, 0.040, 0.020], [-0.10 + i * 0.10, -0.08, 0.064], [red, yellow, blue][i]!)
    }
  }
  bridgeArc(group, 'aft-red-railing-ring', 1.56, -0.78, -0.08, redRail, -2.40, 2.40, 16)

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.48, -0.40, -1.36], rotation: [-0.32, 0, 0], width: 0.38, height: 0.20 },
      { kind: 'navigation', position: [0, -0.36, -1.39], rotation: [-0.32, 0, 0], width: 0.46, height: 0.22 },
      { kind: 'altitude', position: [0.48, -0.40, -1.36], rotation: [-0.32, 0, 0], width: 0.38, height: 0.20 },
    ],
    speedGauge: { position: [-0.28, -0.68, -1.33], rotation: [-0.25, 0, 0] },
    verticalGauge: { position: [0.28, -0.68, -1.33], rotation: [-0.25, 0, 0] },
    heading: { position: [0, -0.70, -1.33], rotation: [-0.25, 0, 0] },
    warpLamp: { position: [0.48, -0.68, -1.32], rotation: [-0.25, 0, 0] },
    throttle: { position: [-0.66, -0.72, -1.30], rotation: [0, 0, 0], step: 0.024 },
    scale: 1.08,
  }, ENTERPRISE_PALETTE)
  cabinLight(group, 0xffe6bf, 2.3, 5.5, [0, 0.34, -0.35])
  return group
}

function buildShip(): THREE.Group {
  const group = shipGroup('Enterprise 1966 Constitution class starship')
  const hull = metal(0xc8c9c2, 0.62, 0.42)
  hull.side = THREE.DoubleSide
  const pale = metal(0xd8d9d2, 0.58, 0.38)
  const seam = metal(0x8f918c, 0.76, 0.28)
  const dark = metal(0x303239, 0.70, 0.36)
  const copper = metal(0xb2793f, 0.38, 0.68)
  const redGlow = light(0xff6230)
  const amberGlow = light(0xff9d34)
  const blueGlow = light(0x79cfff)
  const greenGlow = light(0x66ff77)
  const windowGlow = light(0xffefbf)

  lathe(group, 'flat-domed-primary-saucer', [
    [0, -0.42], [6.8, -0.42], [8.55, -0.34], [8.80, -0.12],
    [8.80, 0.05], [7.45, 0.26], [4.7, 0.47], [1.8, 0.60], [0, 0.60],
  ], [0, -0.82, 0], 'y', hull, 80)
  torus(group, 'thin-saucer-edge-rim-band', 8.84, 0.060, [0, -0.82, 0], 'y', seam, 112)
  torus(group, 'saucer-rim-panel-line', 8.78, 0.035, [0, -0.86, 0], 'y', seam, 96)
  torus(group, 'upper-saucer-concentric-panel-line', 5.65, 0.018, [0, -0.39, 0], 'y', seam, 96)
  torus(group, 'inner-saucer-concentric-panel-line', 3.05, 0.015, [0, -0.27, 0], 'y', seam, 80)
  const saucerWindows: Triple[] = []
  for (let i = 0; i < 64; i++) {
    const angle = i * Math.PI * 2 / 64
    saucerWindows.push([Math.sin(angle) * 8.74, -0.77, Math.cos(angle) * 8.74])
  }
  mergedSpheres(group, 'saucer-rim-lit-window-row', 0.062, saucerWindows, windowGlow, [1.35, 0.55, 1], 12)
  box(group, 'impulse-engine-dark-housing', [1.70, 0.24, 0.075], [0, -0.78, 8.86], dark)
  box(group, 'port-impulse-engine-glow', [0.70, 0.18, 0.085], [-0.48, -0.78, 8.91], redGlow)
  box(group, 'starboard-impulse-engine-glow', [0.70, 0.18, 0.085], [0.48, -0.78, 8.91], redGlow)
  sphere(group, 'port-red-navigation-light', 0.12, [-8.92, -0.70, 0], redGlow, [1, 0.75, 0.75], 16)
  sphere(group, 'starboard-green-navigation-light', 0.12, [8.92, -0.70, 0], greenGlow, [1, 0.75, 0.75], 16)
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI * 2 / 16
    const start = new THREE.Vector3(Math.sin(angle) * 2.0, -0.36, Math.cos(angle) * 2.0)
    const end = new THREE.Vector3(Math.sin(angle) * 8.35, -0.31, Math.cos(angle) * 8.35)
    beam(group, 'saucer-radial-panel-line', [start.x, start.y, start.z], [end.x, end.y, end.z], 0.010, seam, 6)
  }
  lathe(group, 'raised-b-c-deck', [[0, -0.02], [1.45, -0.02], [1.55, 0.07], [1.10, 0.18], [0.20, 0.25], [0, 0.25]],
    [0, -0.21, 0], 'y', pale, 48)
  sphere(group, 'small-bridge-dome', 0.58, [0, 0.06, 0], pale, [1, 0.42, 1], 32)
  sphere(group, 'lower-saucer-sensor-dome', 0.72, [0, -1.38, 0], pale, [1, 0.42, 1], 32)

  prismX(group, 'swept-fin-dorsal-neck', [
    [5.65, -2.30], [6.32, -1.25], [8.52, -1.32], [16.28, -5.20], [14.20, -6.18],
  ], 1.36, hull)
  beam(group, 'port-dorsal-neck-aft-edge', [-1.36, -1.32, 8.52], [-1.36, -5.20, 16.28], 0.035, seam)
  beam(group, 'starboard-dorsal-neck-aft-edge', [1.36, -1.32, 8.52], [1.36, -5.20, 16.28], 0.035, seam)
  beam(group, 'port-dorsal-neck-forward-edge', [-1.36, -2.30, 5.65], [-1.36, -6.18, 14.20], 0.035, seam)
  beam(group, 'starboard-dorsal-neck-forward-edge', [1.36, -2.30, 5.65], [1.36, -6.18, 14.20], 0.035, seam)

  lathe(group, 'cigar-engineering-hull', [
    [0, -11.10], [0.58, -11.02], [1.45, -10.30], [1.95, -8.10], [2.05, -2.10],
    [1.92, 5.70], [1.58, 10.40], [0.70, 11.10], [0, 11.10],
  ], [0, -7.15, 17.75], 'z', hull, 56)
  for (const z of [10.1, 14.8, 19.7, 24.0]) torus(group, 'engineering-hull-panel-ring', 2.03, 0.018, [0, -7.15, z], 'z', seam, 56)
  const engineeringWindows: Triple[] = []
  for (const side of [-1, 1]) {
    for (let i = 0; i < 15; i++) {
      engineeringWindows.push([side * 1.72, -6.12, 9.9 + i * 1.12])
    }
  }
  mergedSpheres(group, 'secondary-hull-lit-window-rows', 0.064, engineeringWindows, windowGlow, [1, 0.62, 0.85], 12)
  cylinder(group, 'bronze-navigation-deflector-dish', 1.28, 0.44, 0.36, [0, -7.15, 6.48], 'z', copper, 48)
  torus(group, 'deflector-outer-rim', 1.30, 0.050, [0, -7.15, 6.25], 'z', copper, 56)
  sphere(group, 'deflector-center-glow', 0.26, [0, -7.15, 6.07], blueGlow, [1, 1, 0.45], 24)
  box(group, 'rectangular-shuttle-bay-doors', [2.18, 1.08, 0.08], [0, -7.05, 28.92], dark)
  for (let i = 0; i < 4; i++) box(group, 'shuttle-bay-door-groove', [2.10, 0.035, 0.095], [0, -7.42 + i * 0.24, 28.97], seam)

  for (const side of [-1, 1]) {
    const x = side * 5.65
    panel(group, 'swept-warp-pylon', [
      [side * 1.25, -5.68, 14.05],
      [side * 1.65, -5.78, 17.60],
      [side * 5.12, -2.20, 20.50],
      [side * 4.85, -2.04, 17.05],
    ], hull)
    beam(group, 'warp-pylon-leading-edge', [side * 1.25, -5.68, 14.05], [side * 4.85, -2.04, 17.05], 0.050, seam)
    beam(group, 'warp-pylon-trailing-edge', [side * 1.65, -5.78, 17.60], [side * 5.12, -2.20, 20.50], 0.050, seam)

    cylinder(group, 'long-fat-warp-nacelle-body', 1.36, 1.36, 23.45, [x, -1.84, 19.00], 'z', pale, 56)
    sphere(group, 'rounded-nacelle-forward-cowl', 1.38, [x, -1.84, 7.18], pale, [1, 1, 0.30], 48)
    torus(group, 'nacelle-forward-cowling-ring', 1.39, 0.070, [x, -1.84, 6.88], 'z', seam, 56)
    torus(group, 'bussard-collector-copper-ring', 1.18, 0.055, [x, -1.84, 6.66], 'z', copper, 56)
    sphere(group, 'large-glowing-bussard-collector-dome', 1.30, [x, -1.84, 6.55], redGlow, [1, 1, 0.54], 48)
    sphere(group, 'bussard-hot-center', 0.66, [x, -1.84, 6.16], amberGlow, [1, 1, 0.36], 28)
    cylinder(group, 'dark-nacelle-rear-cap', 1.36, 1.36, 0.34, [x, -1.84, 30.90], 'z', dark, 56)
    torus(group, 'nacelle-rear-grille-rim', 1.18, 0.042, [x, -1.84, 31.10], 'z', seam, 56)
    for (let i = -4; i <= 4; i++) box(group, 'nacelle-rear-horizontal-grille-bar', [2.12, 0.048, 0.060], [x, -1.84 + i * 0.22, 31.15], seam)
    for (let i = -3; i <= 3; i++) box(group, 'nacelle-rear-vertical-grille-bar', [0.048, 2.08, 0.060], [x + i * 0.28, -1.84, 31.16], seam)
    box(group, 'nacelle-top-vent-strip', [0.30, 0.065, 15.80], [x, -0.45, 20.15], dark)
    for (const z of [11.8, 16.5, 21.2, 25.9]) torus(group, 'nacelle-panel-ring', 1.365, 0.020, [x, -1.84, z], 'z', seam, 56)
  }

  return group
}

export const enterprise1966: ShipDesign = {
  id: 'enterprise-1966',
  name: 'USS Enterprise (1966)',
  kind: 'tribute',
  franchise: 'Star Trek',
  owner: 'CBS Studios',
  blurb: 'The original Constitution-class starship, scaled for the atlas hangar.',
  sizeM: 40,
  canonSizeM: 289,
  eyeHeightM: 9.2,
  chaseM: [0, 4.5, 54],
  buildShip,
  buildCockpit,
}
