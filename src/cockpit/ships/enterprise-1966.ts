import { kestrel } from './kestrel'
import type { ShipDesign } from './types'

// Placeholder until the USS Enterprise (1966) model lands. It borrows the Kestrel geometry so the registry tests pass.
export const enterprise1966: ShipDesign = {
  id: 'enterprise-1966',
  name: 'USS Enterprise (1966)',
  kind: 'tribute',
  franchise: 'Star Trek',
  owner: 'CBS Studios',
  blurb: 'The Constitution-class starship from the original series, saucer first.',
  sizeM: kestrel.sizeM,
  eyeHeightM: kestrel.eyeHeightM,
  chaseM: kestrel.chaseM,
  buildShip: kestrel.buildShip,
  buildCockpit: kestrel.buildCockpit,
}
