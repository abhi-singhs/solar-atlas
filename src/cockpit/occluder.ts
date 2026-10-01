import * as THREE from 'three'

/**
 * A flat list of boxed triangle batches for fast "does this ray hit the hull" checks. A NASA exterior arrives as a few
 * meshes of up to 60,000 triangles, and each mesh's bounding box covers most of the hull, so a plain raycast tests
 * nearly every triangle. Here a ray only tests the triangles inside the small boxes it passes through, and stops at
 * the first hit. Coordinates are in the frame of the root the occluder was built from.
 */
export interface Occluder {
  bounds: THREE.Box3
  leaves: { box: THREE.Box3; triangles: Float32Array }[]
}

const LEAF_TRIANGLES = 64

/** Collects every mesh triangle under `root`, in `root`'s own frame, and splits them into leaves by centroid. */
export function buildOccluder(root: THREE.Object3D): Occluder {
  root.updateMatrixWorld(true)
  const toRoot = root.matrixWorld.clone().invert()
  const meshes: THREE.Mesh[] = []
  root.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object) })
  const count = meshes.reduce((sum, mesh) => {
    const geometry = mesh.geometry as THREE.BufferGeometry
    return sum + (geometry.index?.count ?? geometry.getAttribute('position').count)
  }, 0)
  const corners = new Float32Array(count * 3)
  const point = new THREE.Vector3()
  let offset = 0
  for (const mesh of meshes) {
    const geometry = mesh.geometry as THREE.BufferGeometry
    const position = geometry.getAttribute('position')
    const index = geometry.index
    const matrix = toRoot.clone().multiply(mesh.matrixWorld)
    const n = index?.count ?? position.count
    for (let i = 0; i < n; i++) {
      point.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix).toArray(corners, offset)
      offset += 3
    }
  }

  const triangles = Math.floor(count / 3)
  const order = new Uint32Array(triangles).map((_, i) => i)
  const centroid = (t: number, axis: number) => corners[t * 9 + axis]! + corners[t * 9 + 3 + axis]! + corners[t * 9 + 6 + axis]!
  const leaves: Occluder['leaves'] = []
  const split = (lo: number, hi: number) => {
    if (hi - lo <= LEAF_TRIANGLES) {
      const batch = new Float32Array((hi - lo) * 9)
      for (let i = lo; i < hi; i++) batch.set(corners.subarray(order[i]! * 9, order[i]! * 9 + 9), (i - lo) * 9)
      leaves.push({ box: new THREE.Box3().setFromArray(batch), triangles: batch })
      return
    }
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = lo; i < hi; i++) {
      for (let axis = 0; axis < 3; axis++) {
        const c = centroid(order[i]!, axis)
        min[axis] = Math.min(min[axis]!, c)
        max[axis] = Math.max(max[axis]!, c)
      }
    }
    const spans = max.map((value, axis) => value - min[axis]!)
    const axis = spans.indexOf(Math.max(...spans))
    const middle = (min[axis]! + max[axis]!) / 2
    let i = lo
    let j = hi - 1
    while (i <= j) {
      if (centroid(order[i]!, axis) < middle) {
        i++
      } else {
        const swap = order[i]!
        order[i] = order[j]!
        order[j--] = swap
      }
    }
    // Triangles that share one centroid can't be separated in space, so split them by count.
    const cut = i === lo || i === hi ? (lo + hi) >> 1 : i
    split(lo, cut)
    split(cut, hi)
  }
  if (triangles) split(0, triangles)
  return { bounds: new THREE.Box3().setFromArray(corners.subarray(0, triangles * 9)), leaves }
}

const a = new THREE.Vector3()
const b = new THREE.Vector3()
const c = new THREE.Vector3()
const hit = new THREE.Vector3()

/** Whether `ray`, in the occluder's frame, crosses any triangle from either side. */
export function occluderBlocks(occluder: Occluder, ray: THREE.Ray): boolean {
  if (!ray.intersectsBox(occluder.bounds)) return false
  for (const leaf of occluder.leaves) {
    if (!ray.intersectsBox(leaf.box)) continue
    const triangles = leaf.triangles
    for (let i = 0; i < triangles.length; i += 9) {
      a.fromArray(triangles, i)
      b.fromArray(triangles, i + 3)
      c.fromArray(triangles, i + 6)
      if (ray.intersectTriangle(a, b, c, false, hit)) return true
    }
  }
  return false
}
