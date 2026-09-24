import { kestrel } from './kestrel'
import type { ShipDesign } from './types'

// Placeholder until the Rocinante model lands. It borrows the Kestrel geometry so the registry tests pass.
export const rocinante: ShipDesign = {
  id: 'rocinante',
  name: 'Rocinante',
  kind: 'tribute',
  franchise: 'The Expanse',
  owner: 'Alcon Entertainment',
  blurb: 'Corvette-class frigate. Tall armored hull, point defense cannons, and a keel railgun.',
  sizeM: kestrel.sizeM,
  eyeHeightM: kestrel.eyeHeightM,
  chaseM: kestrel.chaseM,
  buildShip: kestrel.buildShip,
  buildCockpit: kestrel.buildCockpit,
}
