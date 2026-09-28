import type * as THREE from 'three'
import { shipDesign } from './ships'

export { updateCockpit } from './instruments'
export type { CockpitTelemetry } from './instruments'

/**
 * Builds a cockpit interior. Coordinates are meters with the pilot eye at the origin, +Y up and forward -Z.
 * Render in a separate camera scene with a near plane of about 0.01. Defaults to the Kestrel.
 */
export function createCockpit(id?: string): THREE.Group {
  return shipDesign(id).buildCockpit()
}

/**
 * Builds a ship exterior in meters, +Y up, nose -Z, origin at the pilot eye. The lowest point sits at the design's
 * touchdown height below the eye. Scale by 0.001 in a kilometer scene. Defaults to the Kestrel.
 */
export function createShip(id?: string): THREE.Group {
  return shipDesign(id).buildShip()
}
