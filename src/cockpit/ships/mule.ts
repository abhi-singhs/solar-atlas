import { kestrel } from './kestrel'
import type { ShipDesign } from './types'

// Placeholder until the Mule model lands. It borrows the Kestrel geometry so the registry tests pass.
export const mule: ShipDesign = {
  id: 'mule',
  name: 'Mule',
  kind: 'original',
  blurb: 'A boxy heavy hauler with a container frame and big landing legs.',
  sizeM: kestrel.sizeM,
  eyeHeightM: kestrel.eyeHeightM,
  chaseM: kestrel.chaseM,
  buildShip: kestrel.buildShip,
  buildCockpit: kestrel.buildCockpit,
}
