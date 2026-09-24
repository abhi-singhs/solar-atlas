import { kestrel } from './kestrel'
import type { ShipDesign } from './types'

// Placeholder until the Discovery One model lands. It borrows the Kestrel geometry so the registry tests pass.
export const discoveryOne: ShipDesign = {
  id: 'discovery-one',
  name: 'Discovery One',
  kind: 'tribute',
  franchise: '2001: A Space Odyssey',
  owner: 'Turner Entertainment Co.',
  blurb: 'The Jupiter mission ship. A spherical command module on a long spine.',
  sizeM: kestrel.sizeM,
  eyeHeightM: kestrel.eyeHeightM,
  chaseM: kestrel.chaseM,
  buildShip: kestrel.buildShip,
  buildCockpit: kestrel.buildCockpit,
}
