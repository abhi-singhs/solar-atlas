import type * as THREE from 'three'

export interface ShipDesign {
  /** Stable id stored in saved settings. */
  id: string
  name: string
  kind: 'original' | 'tribute'
  /** Tributes name the franchise and its rights holder. The hangar and CREDITS.md show both. */
  franchise?: string
  owner?: string
  /** One line for the hangar card. */
  blurb: string
  /** The model's largest bounding-box dimension in meters. */
  sizeM: number
  /** The canon size when the model is scaled down to stay under the 40 m cap. */
  canonSizeM?: number
  /** Pilot eye above the model's lowest point. Flight uses it as the touchdown height. */
  eyeHeightM: number
  /** Chase camera offset from the pilot eye in the ship frame, meters: +X right, +Y up, +Z behind. */
  chaseM: readonly [number, number, number]
  /** Exterior in meters, +Y up, nose toward -Z, pilot eye at the origin. The lowest point sits at y = -eyeHeightM. */
  buildShip(): THREE.Group
  /** Interior in the same frame. Must call `mountInstruments` and keep the forward sightline clear. */
  buildCockpit(): THREE.Group
}
