import type * as THREE from 'three'

interface ShipBase {
  /** Stable id stored in saved settings. */
  id: string
  name: string
  /** One line for the hangar card. */
  blurb: string
  /** The model's largest bounding-box dimension in meters. */
  sizeM: number
  /** The real size when the model is scaled down to stay under the 40 m cap. */
  canonSizeM?: number
  /** Pilot eye above the model's lowest point. Flight uses it as the touchdown height. */
  eyeHeightM: number
  /** Chase camera offset from the pilot eye in the ship frame, meters: +X right, +Y up, +Z behind. */
  chaseM: readonly [number, number, number]
  /** Interior in meters, +Y up, nose toward -Z, pilot eye at the origin. Must call `mountInstruments` and keep the forward sightline clear. */
  buildCockpit(): THREE.Group
}

/** A ship designed for this app and built in code. */
export interface OriginalShip extends ShipBase {
  kind: 'original'
  /** Exterior in the cockpit frame. The lowest point sits at y = -eyeHeightM. */
  buildShip(): THREE.Group
}

/** Real NASA hardware. The exterior comes from NASA 3D Resources; the cockpit is built in code for this app. */
export interface NasaShip extends ShipBase {
  kind: 'nasa'
  /** Year the hardware launched. */
  launchYear: number
  /** Processed exterior under public/, written by scripts/prepare_ships.mjs in the cockpit frame. */
  model: string
  /** Title of the NASA 3D Resources model the exterior comes from. */
  source: string
}

export type ShipDesign = OriginalShip | NasaShip
