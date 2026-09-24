import { kestrel } from './kestrel'
import type { ShipDesign } from './types'

// Placeholder until the TIE fighter model lands. It borrows the Kestrel geometry so the registry tests pass.
export const tieFighter: ShipDesign = {
  id: 'tie-fighter',
  name: 'TIE fighter',
  kind: 'tribute',
  franchise: 'Star Wars',
  owner: 'Lucasfilm Ltd.',
  blurb: 'A ball cockpit slung between two hexagonal solar wings.',
  sizeM: kestrel.sizeM,
  eyeHeightM: kestrel.eyeHeightM,
  chaseM: kestrel.chaseM,
  buildShip: kestrel.buildShip,
  buildCockpit: kestrel.buildCockpit,
}
