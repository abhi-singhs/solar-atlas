import { kestrel } from './kestrel'
import type { ShipDesign } from './types'

// Placeholder until the Planet Express Ship model lands. It borrows the Kestrel geometry so the registry tests pass.
export const planetExpress: ShipDesign = {
  id: 'planet-express',
  name: 'Planet Express Ship',
  kind: 'tribute',
  franchise: 'Futurama',
  owner: '20th Television',
  blurb: 'The delivery ship with the domed windshield and the tail fin.',
  sizeM: kestrel.sizeM,
  eyeHeightM: kestrel.eyeHeightM,
  chaseM: kestrel.chaseM,
  buildShip: kestrel.buildShip,
  buildCockpit: kestrel.buildCockpit,
}
