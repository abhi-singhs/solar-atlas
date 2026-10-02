import { SHIPS, noShip } from '../cockpit/ships'
import type { ShipDesign } from '../cockpit/ships'

/** Hangar and settings order: NASA spacecraft by launch year, original designs with the Kestrel first, then None. */
export const SHIP_GROUPS: [string, ShipDesign[]][] = [
  ['NASA spacecraft', SHIPS.filter(ship => ship.kind === 'nasa')],
  ['Original designs', SHIPS.filter(ship => ship.kind === 'original')],
  ['No ship', [noShip]],
]

/** Second line of a hangar card. */
export const shipOrigin = (ship: ShipDesign) =>
  ship.kind === 'nasa' ? `NASA, ${ship.launchYear}` : ship.kind === 'none' ? 'Camera only' : 'Original design'

export const meters = (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} m`
export const shipSize = (ship: ShipDesign) =>
  ship.canonSizeM ? `${meters(ship.sizeM)}, scaled from ${meters(ship.canonSizeM)}` : meters(ship.sizeM)
