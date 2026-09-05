import { Matrix4, Quaternion, Vector3 } from 'three'
import type { Quat, Vec3 } from '../contracts'

export const GLTF_TO_SOURCE = new Matrix4().makeRotationX(Math.PI / 2)

export function gltfToSource([x, y, z]: Vec3): Vec3 {
  return [x, -z, y]
}

export function relativePosition(position: Vec3, observer: Vec3, unitKm = 1): Vec3 {
  return [(position[0] - observer[0]) / unitKm, (position[1] - observer[1]) / unitKm,
    (position[2] - observer[2]) / unitKm]
}

export function projectedRadiusPixels(radiusKm: number, distanceKm: number, height: number, fov = 50): number {
  if (distanceKm <= radiusKm) return Infinity
  return height * radiusKm / Math.sqrt(distanceKm * distanceKm - radiusKm * radiusKm)
    / (2 * Math.tan(fov * Math.PI / 360))
}

export function opticalOpacity(tau: number, incidence: number): number {
  return -Math.expm1(-tau / Math.max(Math.abs(incidence), 1e-6))
}

export function commonExposure(distanceAu: number, ev: number): number {
  return Math.max(1e-8, distanceAu * distanceAu) * Math.pow(2, Math.max(-20, Math.min(20, ev)))
}

export function ringRotation(ra: number | undefined, dec: number | undefined, body: Quat): Quaternion {
  if (ra === undefined || dec === undefined) return new Quaternion(...body)
  const a = ra * Math.PI / 180
  const d = dec * Math.PI / 180
  return new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1),
    new Vector3(Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)))
}

export function rebaseVertices(source: ArrayLike<number>, cameraLocal: Vec3, radiusKm: number,
  unitKm: number, output: Float32Array): void {
  for (let i = 0; i < source.length; i += 3) {
    output[i] = (source[i]! * radiusKm - cameraLocal[0]) / unitKm
    output[i + 1] = (source[i + 1]! * radiusKm - cameraLocal[1]) / unitKm
    output[i + 2] = (source[i + 2]! * radiusKm - cameraLocal[2]) / unitKm
  }
}
