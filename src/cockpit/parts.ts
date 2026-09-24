import * as THREE from 'three'

/**
 * Shared builders for the ship and cockpit models. Every model uses meters, +Y up, nose toward -Z,
 * with the pilot's eye at the origin.
 */
export type Axis = 'x' | 'y' | 'z'
type Triple = readonly [number, number, number] | number[]

export const metal = (color: number, roughness = 0.55, metalness = 0.6) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness })
export const matte = (color: number, roughness = 0.85) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 })
/** Unlit and not tone mapped, for lamps, glows and screens. */
export const light = (color: number) => new THREE.MeshBasicMaterial({ color, toneMapped: false })
export const glass = (color: number, opacity = 1) => new THREE.MeshPhysicalMaterial({
  color, roughness: 0.14, metalness: 0.7, clearcoat: 1, transparent: opacity < 1, opacity,
})

const UP = new THREE.Vector3(0, 1, 0)
/** Turns a mesh whose geometry runs along +Y so that it runs along the given axis. */
function orient(mesh: THREE.Object3D, axis: Axis) {
  if (axis === 'x') mesh.rotation.z = -Math.PI / 2
  else if (axis === 'z') mesh.rotation.x = Math.PI / 2
}

export function place<T extends THREE.Object3D>(parent: THREE.Object3D, name: string, object: T, position: Triple = [0, 0, 0]): T {
  object.name = name
  object.position.set(position[0], position[1], position[2])
  parent.add(object)
  return object
}

export function box(parent: THREE.Object3D, name: string, size: Triple, position: Triple, material: THREE.Material) {
  return place(parent, name, new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material), position)
}

/** A cylinder between two points. */
export function beam(parent: THREE.Object3D, name: string, a: Triple, b: Triple, radius: number, material: THREE.Material, segments = 8) {
  const start = new THREE.Vector3(a[0], a[1], a[2])
  const end = new THREE.Vector3(b[0], b[1], b[2])
  const direction = end.clone().sub(start)
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, direction.length(), segments), material)
  mesh.name = name
  mesh.position.copy(start).add(end).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(UP, direction.normalize())
  parent.add(mesh)
  return mesh
}

/** A cylinder or cone centered on `position` whose length runs along `axis`. On Y the top radius is at +Y, on Z it is at +Z, on X at +X. */
export function cylinder(parent: THREE.Object3D, name: string, radiusTop: number, radiusBottom: number, length: number,
  position: Triple, axis: Axis, material: THREE.Material, segments = 16) {
  const mesh = place(parent, name, new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, length, segments), material), position)
  orient(mesh, axis)
  return mesh
}

export function sphere(parent: THREE.Object3D, name: string, radius: number, position: Triple, material: THREE.Material,
  scale: Triple = [1, 1, 1], segments = 24) {
  const mesh = place(parent, name, new THREE.Mesh(new THREE.SphereGeometry(radius, segments, Math.max(8, segments * 2 / 3)), material), position)
  mesh.scale.set(scale[0], scale[1], scale[2])
  return mesh
}

/** A torus whose ring lies in the plane perpendicular to `axis`. */
export function torus(parent: THREE.Object3D, name: string, radius: number, tube: number, position: Triple, axis: Axis,
  material: THREE.Material, segments = 32) {
  const mesh = place(parent, name, new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 8, segments), material), position)
  if (axis === 'x') mesh.rotation.y = Math.PI / 2
  else if (axis === 'y') mesh.rotation.x = Math.PI / 2
  return mesh
}

/** A surface of revolution. `profile` holds [radius, height] pairs; height runs along `axis`. */
export function lathe(parent: THREE.Object3D, name: string, profile: readonly (readonly [number, number])[], position: Triple,
  axis: Axis, material: THREE.Material, segments = 24) {
  const geometry = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), segments)
  const mesh = place(parent, name, new THREE.Mesh(geometry, material), position)
  orient(mesh, axis)
  return mesh
}

/** An extruded outline. Points are in the XY plane and the extrusion runs along local +Z. */
export function plate(parent: THREE.Object3D, name: string, points: number[][], depth: number, material: THREE.Material) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
  const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: depth * 0.1,
    bevelSize: depth * 0.12,
    bevelSegments: 1,
    steps: 1,
  }), material)
  mesh.name = name
  parent.add(mesh)
  return mesh
}

/** A flat panel in the XZ plane, for hull plating seen from above. `points` are [x, z] and the plate grows `depth` upward from `y`. */
export function deck(parent: THREE.Object3D, name: string, points: number[][], depth: number, y: number, material: THREE.Material) {
  const mesh = plate(parent, name, points.map(([x, z]) => [x, -z]), depth, material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  return mesh
}

/** A cockpit light that moves with the cockpit. */
export function cabinLight(parent: THREE.Object3D, color: number, intensity = 2, distance = 5, position: Triple = [0, 0.2, -0.4]) {
  const lamp = new THREE.PointLight(color, intensity, distance)
  return place(parent, 'cabin-light', lamp, position)
}

export function shipGroup(name: string, extra: Record<string, unknown> = {}): THREE.Group {
  const group = new THREE.Group()
  group.name = name
  group.userData = { units: 'meters', forward: '-Z', origin: 'pilot eye', reconstructed: true, ...extra }
  return group
}

/** Frees every geometry, material and texture under `root`. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
      material.dispose()
    }
  })
}
