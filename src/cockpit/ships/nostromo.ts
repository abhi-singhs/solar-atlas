import { kestrel } from './kestrel'
import type { ShipDesign } from './types'

// Placeholder until the Nostromo model lands. It borrows the Kestrel geometry so the registry tests pass.
export const nostromo: ShipDesign = {
  id: 'nostromo',
  name: 'Nostromo',
  kind: 'tribute',
  franchise: 'Alien',
  owner: '20th Century Studios',
  blurb: 'A commercial towing vehicle. Blocky, industrial, and in need of a refit.',
  sizeM: kestrel.sizeM,
  eyeHeightM: kestrel.eyeHeightM,
  chaseM: kestrel.chaseM,
  buildShip: kestrel.buildShip,
  buildCockpit: kestrel.buildCockpit,
}
