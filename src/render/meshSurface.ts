import { Box3, BufferGeometry, Ray, Triangle, Vector2, Vector3 } from 'three'
import type { SurfaceHit, Vec3 } from '../contracts'

interface Node {
  bounds: Box3
  left?: Node
  right?: Node
  triangles?: number[]
}

export class SourceSurface {
  readonly geometry: BufferGeometry
  readonly radiusKm: number
  private root: Node
  private ray = new Ray()
  private a = new Vector3()
  private b = new Vector3()
  private c = new Vector3()
  private point = new Vector3()
  private bary = new Vector3()
  private uvA = new Vector2()
  private uvB = new Vector2()
  private uvC = new Vector2()

  constructor(geometry: BufferGeometry, radiusKm: number) {
    this.geometry = geometry
    this.radiusKm = radiusKm
    const position = geometry.getAttribute('position')
    const index = geometry.index
    const triangleCount = (index?.count ?? position.count) / 3
    const boxes = Array.from({ length: triangleCount }, (_, triangle) => {
      const bounds = new Box3()
      for (let j = 0; j < 3; j++)
        bounds.expandByPoint(new Vector3().fromBufferAttribute(position, index?.getX(triangle * 3 + j) ?? triangle * 3 + j))
      return bounds
    })
    const build = (triangles: number[]): Node => {
      const bounds = new Box3()
      for (const triangle of triangles) bounds.union(boxes[triangle]!)
      if (triangles.length <= 12) return { bounds, triangles }
      const size = bounds.getSize(new Vector3())
      const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z'
      triangles.sort((a, b) => (boxes[a]!.min[axis] + boxes[a]!.max[axis]) - (boxes[b]!.min[axis] + boxes[b]!.max[axis]))
      const middle = Math.floor(triangles.length / 2)
      return { bounds, left: build(triangles.slice(0, middle)), right: build(triangles.slice(middle)) }
    }
    this.root = build(Array.from({ length: triangleCount }, (_, i) => i))
  }

  private radial(direction: Vec3): boolean {
    const axis = new Vector3(...direction)
    if (!Number.isFinite(axis.lengthSq()) || axis.lengthSq() === 0) return false
    axis.normalize()
    const radius = Math.max(1.01, this.geometry.boundingSphere?.radius ?? 1) * 2
    this.ray.set(axis.clone().multiplyScalar(radius), axis.negate())
    return true
  }

  sample(direction: Vec3): SurfaceHit | null {
    return this.radial(direction) ? this.query()?.hit ?? null : null
  }

  uv(direction: Vec3): [number, number] | null {
    return this.radial(direction) ? this.query()?.uv ?? null : null
  }

  intersect(originNormalized: Vector3, direction: Vector3): SurfaceHit | null {
    this.ray.set(originNormalized, direction.clone().normalize())
    return this.query()?.hit ?? null
  }

  private query(): { hit: SurfaceHit; uv: [number, number] } | null {
    const position = this.geometry.getAttribute('position')
    const uv = this.geometry.getAttribute('uv')
    const index = this.geometry.index
    let nearest = Infinity
    let result: { hit: SurfaceHit; uv: [number, number] } | null = null
    const visit = (node: Node): void => {
      if (!this.ray.intersectsBox(node.bounds)) return
      if (node.left) visit(node.left)
      if (node.right) visit(node.right)
      for (const triangle of node.triangles ?? []) {
        const ia = index?.getX(triangle * 3) ?? triangle * 3
        const ib = index?.getX(triangle * 3 + 1) ?? triangle * 3 + 1
        const ic = index?.getX(triangle * 3 + 2) ?? triangle * 3 + 2
        this.a.fromBufferAttribute(position, ia)
        this.b.fromBufferAttribute(position, ib)
        this.c.fromBufferAttribute(position, ic)
        if (!this.ray.intersectTriangle(this.a, this.b, this.c, false, this.point)) continue
        const distance = this.point.distanceToSquared(this.ray.origin)
        if (distance >= nearest) continue
        nearest = distance
        Triangle.getBarycoord(this.point, this.a, this.b, this.c, this.bary)
        this.uvA.set(uv.getX(ia), uv.getY(ia)).multiplyScalar(this.bary.x)
        this.uvB.set(uv.getX(ib), uv.getY(ib)).multiplyScalar(this.bary.y)
        this.uvC.set(uv.getX(ic), uv.getY(ic)).multiplyScalar(this.bary.z)
        this.uvA.add(this.uvB).add(this.uvC)
        result = { hit: { point: this.point.clone().multiplyScalar(this.radiusKm).toArray() as Vec3,
          normal: Triangle.getNormal(this.a, this.b, this.c, new Vector3()).toArray() as Vec3 },
        uv: this.uvA.toArray() }
      }
    }
    visit(this.root)
    return result
  }

  dispose(): void {}
}
