import { SHIPS } from '../cockpit/ships'
import type { ShipDesign } from '../cockpit/ships'

/** Hangar and settings order: fan tributes, then original designs with the Kestrel first. */
export const SHIP_GROUPS: [string, ShipDesign[]][] = [
  ['Fan tributes', SHIPS.filter(ship => ship.kind === 'tribute')],
  ['Original designs', SHIPS.filter(ship => ship.kind === 'original')],
]

export const meters = (value: number) => `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} m`
export const shipSize = (ship: ShipDesign) =>
  ship.canonSizeM ? `${meters(ship.sizeM)}, scaled from ${meters(ship.canonSizeM)}` : meters(ship.sizeM)
