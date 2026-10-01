import * as THREE from 'three'
import type { DisplayPalette } from '../instruments'
import { mountInstruments } from '../instruments'
import { beam, box, cabinLight, cylinder, light, matte, metal, shipGroup, torus } from '../parts'
import { bulkhead, frameLoop, inside, panelInstruments, polygon, switchRow, tube } from './cabin'
import type { NasaShip } from './types'

const VOYAGER_PALETTE: DisplayPalette = {
  background: '#0a0703', grid: '#3a2a10', frame: '#6b4e1c', title: '#ffd27a', primary: '#ffcf6b', secondary: '#d9a548',
  footer: '#7fd3ff', housing: 0x1c1712, screw: 0xa48a52, gaugeFace: 0x0b0906, gaugeRing: 0xc8a050, tick: 0xffe0a0,
  needle: 0xfff0c8, compass: 0xd9b468, chevron: 0x7fd3ff, lampOff: 0x2b1e08, lampOn: 0xffc04a, barOff: 0x2a2214, barOn: 0xffcf6b,
}

/**
 * An imagined pilot pod inside Voyager's ten-sided bus. Voyager flew without crew; this cabin is fiction for the app.
 * The ten-sided window matches the bus, the walls carry black thermal blankets, and the golden record hangs beside the
 * window. The plasma-wave antennas reach forward outside. Built from primitives.
 */
function buildCockpit(): THREE.Group {
  const group = shipGroup('Voyager imagined cockpit')
  const blanket = inside(matte(0x1b1b1d, 0.95))
  const gold = metal(0xc9a24a, 0.35, 0.9)
  const frame = metal(0x8c8f94, 0.45, 0.7)
  const panel = metal(0x24211d, 0.7, 0.35)
  const antenna = metal(0xb9bcc0, 0.4, 0.8)

  const window = polygon(10, 0.58, Math.PI / 2)
  tube(group, 'decagonal-bus-wall', 1.02, 1.1, -1.34, 0.8, blanket, 10)
  bulkhead(group, 'forward-bus-panel', polygon(10, 1.06, Math.PI / 2), [window], -1.32, 0.05, blanket)
  frameLoop(group, 'decagonal-window-frame', window, -1.3, 0.026, gold)
  frameLoop(group, 'bus-corner-frame', polygon(10, 1.0, Math.PI / 2), -1.28, 0.02, frame)

  const console = box(group, 'flight-console', [1.6, 0.5, 0.07], [0, -0.58, -1.18], panel)
  console.rotation.x = -0.08
  box(group, 'console-gold-trim', [1.62, 0.025, 0.09], [0, -0.32, -1.16], gold)
  switchRow(group, 'console-switch-row', 8, [-0.42, -0.74, -1.13], [0.12, 0, 0], frame)

  // The golden record, mounted on the forward panel beside the window.
  box(group, 'record-mount-plate', [0.34, 0.34, 0.02], [-0.72, 0.38, -1.285], panel)
  cylinder(group, 'golden-record', 0.13, 0.13, 0.012, [-0.72, 0.38, -1.27], 'z', gold, 40)
  cylinder(group, 'golden-record-label', 0.03, 0.03, 0.014, [-0.72, 0.38, -1.268], 'z', light(0xffe7a3), 24)

  for (const side of [-1, 1]) {
    beam(group, 'plasma-wave-antenna', [side * 1.3, -0.8, -1.8], [side * 3.2, -2.2, -10], 0.018, antenna)
  }
  torus(group, 'magnetometer-boom-root', 0.08, 0.02, [0.55, 0.92, 0.2], 'y', frame, 16)

  mountInstruments(group, panelInstruments({
    displayY: -0.45, displayZ: -1.12, spread: 0.47, width: 0.38, rowY: -0.63, rowZ: -1.13, scale: 0.9,
  }), VOYAGER_PALETTE)
  cabinLight(group, 0xffe2b0, 1.6, 4)
  return group
}

export const voyager: NasaShip = {
  id: 'voyager',
  name: 'Voyager',
  kind: 'nasa',
  launchYear: 1977,
  model: 'assets/ships/voyager.glb',
  source: 'Voyager Probe (B)',
  blurb: 'Launched in 1977 and now in interstellar space. Its 3.7 m dish points home while it flies outward.',
  sizeM: 16.42,
  eyeHeightM: 3.77,
  chaseM: [4, 5.5, 25],
  buildCockpit,
}
