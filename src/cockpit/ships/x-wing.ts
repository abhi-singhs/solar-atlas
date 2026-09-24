import { kestrel } from './kestrel'
import type { ShipDesign } from './types'

// Placeholder until the X-wing model lands. It borrows the Kestrel geometry so the registry tests pass.
export const xWing: ShipDesign = {
  id: 'x-wing',
  name: 'X-wing',
  kind: 'tribute',
  franchise: 'Star Wars',
  owner: 'Lucasfilm Ltd.',
  blurb: 'T-65 starfighter with its S-foils open in attack position.',
  sizeM: kestrel.sizeM,
  eyeHeightM: kestrel.eyeHeightM,
  chaseM: kestrel.chaseM,
  buildShip: kestrel.buildShip,
  buildCockpit: kestrel.buildCockpit,
}
