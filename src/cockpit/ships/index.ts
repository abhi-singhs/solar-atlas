import { atomic } from './atomic'
import { discoveryOne } from './discovery-one'
import { enterprise1966 } from './enterprise-1966'
import { kestrel } from './kestrel'
import { manta } from './manta'
import { millenniumFalcon } from './millennium-falcon'
import { mule } from './mule'
import { needle } from './needle'
import { nostromo } from './nostromo'
import { planetExpress } from './planet-express'
import { rocinante } from './rocinante'
import { serenity } from './serenity'
import { tieFighter } from './tie-fighter'
import { viperMk2 } from './viper-mk2'
import { xWing } from './x-wing'
import type { ShipDesign } from './types'
import type { ShipProfile } from '../../flight/FlightController'

export type { ShipDesign } from './types'

export const DEFAULT_SHIP = 'kestrel'
/** The chase camera looks this far below the ship's forward axis, in radians about +X. */
export const CHASE_PITCH = -0.17

/** Hangar order. The Kestrel comes first and is the default. */
export const SHIPS: readonly ShipDesign[] = [
  kestrel,
  millenniumFalcon, xWing, tieFighter, enterprise1966, serenity,
  planetExpress, rocinante, discoveryOne, viperMk2, nostromo,
  atomic, needle, mule, manta,
]

const byId = new Map(SHIPS.map(ship => [ship.id, ship]))

export const isShipId = (id: unknown): id is string => typeof id === 'string' && byId.has(id)

/** Unknown ids resolve to the Kestrel. */
export function shipDesign(id: string | undefined): ShipDesign {
  return (id && byId.get(id)) || kestrel
}

/** Flight settings for a ship design, converted to kilometers. */
export function shipProfile(id: string | undefined): ShipProfile {
  const design = shipDesign(id)
  return { touchdownKm: design.eyeHeightM / 1000, chaseOffsetKm: [design.chaseM[0] / 1000, design.chaseM[1] / 1000, design.chaseM[2] / 1000] }
}
