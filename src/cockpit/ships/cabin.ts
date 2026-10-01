import * as THREE from 'three'
import type { InstrumentLayout } from '../instruments'
import { beam } from '../parts'

/**
 * Builders shared by the NASA ship cockpits. Like the rest of the cockpit code they work in meters with the pilot eye
 * at the origin, +Y up and the nose toward -Z.
 */
export type Point = readonly [number, number]

/** Corners of a regular polygon in the XY plane, starting at `start` radians and going counterclockwise. */
export function polygon(sides: number, radius: number, start = Math.PI / 2, scaleY = 1): Point[] {
  return Array.from({ length: sides }, (_, i) => {
    const angle = start + i * Math.PI * 2 / sides
    return [Math.cos(angle) * radius, Math.sin(angle) * radius * scaleY] as const
  })
}

/** A closed loop of round bars through `points` at depth `z`. */
export function frameLoop(parent: THREE.Object3D, name: string, points: readonly Point[], z: number, radius: number,
  material: THREE.Material, segments = 8): void {
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length]!
    beam(parent, name, [a[0], a[1], z], [b[0], b[1], z], radius, material, segments)
  })
}

/**
 * A flat wall across the view at depth `z` with window openings cut through it. The pilot side faces +Z and the wall
 * grows `depth` away from the pilot.
 */
export function bulkhead(parent: THREE.Object3D, name: string, outline: readonly Point[], windows: readonly (readonly Point[])[],
  z: number, depth: number, material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)))
  for (const window of windows) shape.holes.push(new THREE.Path(window.map(([x, y]) => new THREE.Vector2(x, y))))
  const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 24 }), material)
  mesh.name = name
  mesh.position.z = z - depth
  parent.add(mesh)
  return mesh
}

/**
 * An open-ended tube along Z, seen from inside, for cabin walls. `front` is the -Z end. Its corners sit at the same
 * angles as `polygon(sides, radius, start)`, so a matching bulkhead closes the front without gaps.
 */
export function tube(parent: THREE.Object3D, name: string, radiusFront: number, radiusBack: number, zFront: number, zBack: number,
  material: THREE.Material, sides = 24, start = Math.PI / 2): THREE.Mesh {
  // After the quarter turn about X, a cylinder vertex at angle theta lands at polar angle theta - 90 degrees.
  const geometry = new THREE.CylinderGeometry(radiusBack, radiusFront, zBack - zFront, sides, 1, true, start + Math.PI / 2)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.rotation.x = Math.PI / 2
  mesh.position.z = (zFront + zBack) / 2
  parent.add(mesh)
  return mesh
}

/** Where a cockpit puts its three displays and the row of gauges beneath them. */
export interface PanelLayout {
  /** Display centers share this height and depth. */
  displayY: number
  displayZ: number
  /** Distance of the outer displays from the center line. */
  spread: number
  /** Width of the outer displays; the navigation display is a little wider. */
  width: number
  /** Gauge row height and depth. */
  rowY: number
  rowZ: number
  /** Tilt of the whole panel about X, radians. Negative leans the top away from the pilot. */
  tilt?: number
  scale?: number
}

/**
 * The shared instrument arrangement: flight, navigation, and altitude displays left to right, then the throttle bars,
 * speed gauge, heading ring, warp lamp, and vertical-speed gauge in one row below them.
 */
export function panelInstruments(layout: PanelLayout): InstrumentLayout {
  const { displayY, displayZ, spread, width, rowY, rowZ, tilt = 0 } = layout
  const scale = layout.scale ?? 1
  const rotation = [tilt, 0, 0] as const
  return {
    displays: [
      { kind: 'flight', position: [-spread, displayY, displayZ], width, rotation },
      { kind: 'navigation', position: [0, displayY, displayZ], width: width * 1.12, rotation },
      { kind: 'altitude', position: [spread, displayY, displayZ], width, rotation },
    ],
    speedGauge: { position: [-0.3, rowY, rowZ], rotation },
    verticalGauge: { position: [0.3, rowY, rowZ], rotation },
    heading: { position: [0, rowY, rowZ], rotation },
    warpLamp: { position: [0.155, rowY, rowZ], rotation },
    throttle: { position: [-0.62, rowY, rowZ], rotation },
    scale,
  }
}
export function inside<T extends THREE.Material>(material: T): T {
  material.side = THREE.DoubleSide
  return material
}

/** A row of small toggle switches drawn as one instanced mesh. Positions are in the parent's frame. */
export function switchRow(parent: THREE.Object3D, name: string, count: number, from: readonly [number, number, number],
  step: readonly [number, number, number], material: THREE.Material, size: readonly [number, number, number] = [0.018, 0.018, 0.03]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material, count)
  mesh.name = name
  const matrix = new THREE.Matrix4()
  for (let i = 0; i < count; i++) {
    mesh.setMatrixAt(i, matrix.makeTranslation(from[0] + i * step[0], from[1] + i * step[1], from[2] + i * step[2]))
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.computeBoundingSphere()
  parent.add(mesh)
  return mesh
}
