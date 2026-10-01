import type * as THREE from 'three'
import { loadShip } from './shipLoader'
import type { LoadShipOptions } from './shipLoader'
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
 * Builds an original ship's exterior in meters, +Y up, nose -Z, origin at the pilot eye. The lowest point sits at the
 * design's touchdown height below the eye. Scale by 0.001 in a kilometer scene. Defaults to the Kestrel. NASA ships
 * load from a file, so use `loadShipModel` for them.
 */
export function createShip(id?: string): THREE.Group {
  const design = shipDesign(id)
  if (design.kind !== 'original') throw new Error(`The ${design.name} exterior loads from a file. Use loadShipModel.`)
  return design.buildShip()
}

/** Builds or loads any ship's exterior in the same frame as `createShip`. Defaults to the Kestrel. */
export function loadShipModel(id?: string, options?: LoadShipOptions): Promise<THREE.Group> {
  return loadShip(shipDesign(id), options)
}
