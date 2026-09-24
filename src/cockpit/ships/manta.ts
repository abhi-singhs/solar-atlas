import { kestrel } from './kestrel'
import type { ShipDesign } from './types'

// Placeholder until the Manta model lands. It borrows the Kestrel geometry so the registry tests pass.
export const manta: ShipDesign = {
  id: 'manta',
  name: 'Manta',
  kind: 'original',
  blurb: 'A smooth flying wing with glowing seams and wraparound glass.',
  sizeM: kestrel.sizeM,
  eyeHeightM: kestrel.eyeHeightM,
  chaseM: kestrel.chaseM,
  buildShip: kestrel.buildShip,
  buildCockpit: kestrel.buildCockpit,
}
