import { kestrel } from './kestrel'
import type { ShipDesign } from './types'

// Placeholder until the Needle model lands. It borrows the Kestrel geometry so the registry tests pass.
export const needle: ShipDesign = {
  id: 'needle',
  name: 'Needle',
  kind: 'original',
  blurb: 'A long-nosed racer with twin engines and forward-swept fins.',
  sizeM: kestrel.sizeM,
  eyeHeightM: kestrel.eyeHeightM,
  chaseM: kestrel.chaseM,
  buildShip: kestrel.buildShip,
  buildCockpit: kestrel.buildCockpit,
}
