import { kestrel } from './kestrel'
import type { ShipDesign } from './types'

// Placeholder until the Viper Mk II model lands. It borrows the Kestrel geometry so the registry tests pass.
export const viperMk2: ShipDesign = {
  id: 'viper-mk2',
  name: 'Viper Mk II',
  kind: 'tribute',
  franchise: 'Battlestar Galactica',
  owner: 'Universal Content Productions',
  blurb: 'Colonial space superiority fighter with three engines.',
  sizeM: kestrel.sizeM,
  eyeHeightM: kestrel.eyeHeightM,
  chaseM: kestrel.chaseM,
  buildShip: kestrel.buildShip,
  buildCockpit: kestrel.buildCockpit,
}
