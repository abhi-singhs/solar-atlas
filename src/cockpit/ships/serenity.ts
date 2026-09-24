import { kestrel } from './kestrel'
import type { ShipDesign } from './types'

// Placeholder until the Serenity model lands. It borrows the Kestrel geometry so the registry tests pass.
export const serenity: ShipDesign = {
  id: 'serenity',
  name: 'Serenity',
  kind: 'tribute',
  franchise: 'Firefly',
  owner: '20th Television',
  blurb: 'Firefly-class transport. Bridge up front, cargo in the belly, engines on swinging arms.',
  sizeM: kestrel.sizeM,
  eyeHeightM: kestrel.eyeHeightM,
  chaseM: kestrel.chaseM,
  buildShip: kestrel.buildShip,
  buildCockpit: kestrel.buildCockpit,
}
