import { Matrix4, Quaternion, Vector3 } from 'three'
import { AU_KM, bodyRadius } from '../contracts'
import type { Body, CameraPose, Snapshot, Vec3 } from '../contracts'

export class Observer {
  targetId = 'earth'
  mode: 'orbit' | 'follow' | 'free' = 'orbit'
  distance = 20000
  aspect = 1
  theta = 0
  phi = 0.2
  private center: Vec3 = [0, 0, 0]
  private minimumDistance = 1
  private readonly bodies: Map<string, Body>

  constructor(bodies: Body[]) {
    this.bodies = new Map(bodies.map(body => [body.id, body]))
  }

  focus(id: string, snapshot: Snapshot): void {
    const body = this.bodies.get(id)
    if (!body || !snapshot.states[id]) throw new Error(`Cannot focus unavailable body ${id}.`)
    this.targetId = id
    this.mode = 'orbit'
    this.minimumDistance = bodyRadius(body) * 1.012
    const framing = id === 'quaoar' ? 25 : id === 'saturn' ? 7 : ['uranus', 'neptune', 'chariklo', 'haumea'].includes(id) ? 10 : 3.5
    this.distance = bodyRadius(body) * framing * Math.max(1, 0.8 / this.aspect)
    this.center = [...snapshot.states[id].position]
    const light = new Vector3(...snapshot.states.sun.position).sub(new Vector3(...this.center))
    if (light.lengthSq() < 1) light.set(1, -1, 0.5)
    light.normalize()
    if (['saturn', 'uranus', 'neptune', 'chariklo', 'quaoar', 'haumea'].includes(id)) {
      const pole = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...snapshot.states[id].rotation))
      light.addScaledVector(pole, light.dot(pole) >= 0 ? 0.7 : -0.7).normalize()
    }
    this.theta = Math.atan2(light.y, light.x) + 0.2
    this.phi = Math.max(-1.3, Math.min(1.3, Math.asin(light.z) + 0.16))
  }

  system(snapshot: Snapshot, kind: 'inner' | 'all' | 'local'): void {
    let centerId = 'sun'
    let range = kind === 'inner' ? 5 * AU_KM : 110 * AU_KM
    if (kind === 'all') {
      const sun = new Vector3(...snapshot.states.sun.position)
      range = Math.max(...Object.values(snapshot.states).map(state => sun.distanceTo(new Vector3(...state.position)))) * 3.2
    }
    if (kind === 'local') {
      const body = this.bodies.get(this.targetId)
      centerId = body?.category === 'moon' ? body.parent_id ?? this.targetId : this.targetId
      range = bodyRadius(this.bodies.get(centerId)!) * 10
      const center = new Vector3(...snapshot.states[centerId].position)
      for (const child of this.bodies.values()) {
        if (child.parent_id === centerId && child.id !== centerId) {
          range = Math.max(range, center.distanceTo(new Vector3(...snapshot.states[child.id].position)) * 2.8)
        }
      }
    }
    this.targetId = centerId
    this.mode = 'orbit'
    this.center = [...snapshot.states[centerId].position]
    this.minimumDistance = bodyRadius(this.bodies.get(centerId)!) * 1.012
    this.distance = range
    this.phi = 1.05
    this.theta = -1.2
  }

  drag(dx: number, dy: number): void {
    this.theta -= dx * 0.004
    this.phi = Math.max(-1.54, Math.min(1.54, this.phi + dy * 0.004))
  }

  zoom(delta: number): void {
    this.distance = Math.max(this.minimumDistance, Math.min(600 * AU_KM, this.distance * Math.exp(delta * 0.0015)))
  }

  pose(snapshot: Snapshot): CameraPose {
    if (this.mode !== 'free') this.center = [...snapshot.states[this.targetId].position]
    const offset = new Vector3(
      Math.cos(this.phi) * Math.cos(this.theta),
      Math.cos(this.phi) * Math.sin(this.theta),
      Math.sin(this.phi),
    ).multiplyScalar(this.distance)
    const matrix = new Matrix4().lookAt(offset, new Vector3(), new Vector3(0, 0, 1))
    const rotation = new Quaternion().setFromRotationMatrix(matrix)
    return {
      position: [this.center[0] + offset.x, this.center[1] + offset.y, this.center[2] + offset.z],
      quaternion: [rotation.x, rotation.y, rotation.z, rotation.w],
    }
  }

  move(forward: number, right: number, up: number, dt: number, snapshot: Snapshot): void {
    if (this.mode !== 'free') return
    const pose = this.pose(snapshot)
    const change = new Vector3(right, up, -forward).applyQuaternion(new Quaternion(...pose.quaternion))
      .multiplyScalar(Math.max(0.001, this.distance * 0.35) * dt)
    this.center = [this.center[0] + change.x, this.center[1] + change.y, this.center[2] + change.z]
  }
}
