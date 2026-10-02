import { shipGroup } from '../parts'
import type { NoShip } from './types'

/**
 * Flies the camera with nothing drawn around it. Touchdown matches the flight controller's default 3 m clearance, and
 * the zero chase offset keeps the chase camera at the pilot eye because there is no hull to look at.
 */
export const noShip: NoShip = {
  id: 'none',
  name: 'None',
  kind: 'none',
  blurb: 'No ship and no cockpit. Only space is on screen.',
  sizeM: 0,
  eyeHeightM: 3,
  chaseM: [0, 0, 0],
  buildShip: () => shipGroup('No ship exterior'),
  buildCockpit: () => shipGroup('No ship cockpit'),
}
