import { kestrel } from './kestrel'
import type { ShipDesign } from './types'

// Placeholder until the Millennium Falcon model lands. It borrows the Kestrel geometry so the registry tests pass.
export const millenniumFalcon: ShipDesign = {
  id: 'millennium-falcon',
  name: 'Millennium Falcon',
  kind: 'tribute',
  franchise: 'Star Wars',
  owner: 'Lucasfilm Ltd.',
  blurb: 'A modified YT-1300 light freighter. Disc hull, forward mandibles, and an offset cockpit tube.',
  sizeM: kestrel.sizeM,
  eyeHeightM: kestrel.eyeHeightM,
  chaseM: kestrel.chaseM,
  buildShip: kestrel.buildShip,
  buildCockpit: kestrel.buildCockpit,
}
