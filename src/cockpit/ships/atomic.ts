import { kestrel } from './kestrel'
import type { ShipDesign } from './types'

// Placeholder until the Atomic model lands. It borrows the Kestrel geometry so the registry tests pass.
export const atomic: ShipDesign = {
  id: 'atomic',
  name: 'Atomic',
  kind: 'original',
  blurb: 'A 1950s pulp rocket in chrome and cream, with red fins and portholes.',
  sizeM: kestrel.sizeM,
  eyeHeightM: kestrel.eyeHeightM,
  chaseM: kestrel.chaseM,
  buildShip: kestrel.buildShip,
  buildCockpit: kestrel.buildCockpit,
}
