import * as THREE from 'three'
import type { DisplayPalette } from '../instruments'
import { mountInstruments } from '../instruments'
import { beam, box, cabinLight, cylinder, matte, metal, shipGroup, torus } from '../parts'
import { bulkhead, frameLoop, inside, panelInstruments, polygon, switchRow, tube } from './cabin'
import type { NasaShip } from './types'

const CASSINI_PALETTE: DisplayPalette = {
  background: '#0d0904', grid: '#33260f', frame: '#5c4317', title: '#ffe2a6', primary: '#ffe7b8', secondary: '#e0b866',
  footer: '#9fd8ff', housing: 0x2a2116, screw: 0xb08d4a, gaugeFace: 0x0c0905, gaugeRing: 0xd9b062, tick: 0xfff0cc,
  needle: 0xffffff, compass: 0xe0c07a, chevron: 0x9fd8ff, lampOff: 0x33240c, lampOn: 0xffb84a, barOff: 0x2b2214, barOn: 0xffe2a6,
}

/**
 * An imagined pilot pod just behind Cassini's high-gain antenna. Cassini flew without crew; this cabin is fiction for
 * the app. Gold thermal blankets line the walls, the white dish rim curves overhead, and the Huygens probe's heat
 * shield sits on the right wall. Built from primitives.
 */
function buildCockpit(): THREE.Group {
  const group = shipGroup('Cassini-Huygens imagined cockpit')
  const blanket = inside(metal(0xb8862e, 0.42, 0.85))
  const dish = metal(0xe9e8e2, 0.5, 0.2)
  const panel = metal(0x2b241b, 0.7, 0.35)
  const frame = metal(0x9a9c9f, 0.45, 0.7)
  const huygens = matte(0xc76a2a, 0.7)

  const window = polygon(24, 0.56)
  tube(group, 'gold-blanket-wall', 1.0, 1.1, -1.34, 0.8, blanket, 24)
  bulkhead(group, 'forward-bulkhead', polygon(24, 1.02), [window], -1.32, 0.05, blanket)
  frameLoop(group, 'round-window-frame', window, -1.3, 0.03, frame, 6)
  torus(group, 'high-gain-antenna-rim', 2.0, 0.06, [0, 1.65, -2.4], 'y', dish, 64)
  for (const angle of [-2.3, -0.84]) {
    beam(group, 'antenna-feed-strut', [Math.cos(angle) * 2, 1.65, -2.4 + Math.sin(angle) * 2], [0, 2.6, -2.4], 0.025, frame)
  }

  const console = box(group, 'flight-console', [1.6, 0.5, 0.07], [0, -0.58, -1.18], panel)
  console.rotation.x = -0.08
  box(group, 'console-top-rail', [1.64, 0.03, 0.1], [0, -0.32, -1.16], frame)
  switchRow(group, 'console-switch-row', 8, [-0.42, -0.74, -1.13], [0.12, 0, 0], frame)
  cylinder(group, 'huygens-heat-shield', 0.34, 0.34, 0.06, [0.95, -0.15, -0.7], 'x', huygens, 32)
  torus(group, 'huygens-mount-ring', 0.36, 0.025, [0.93, -0.15, -0.7], 'x', frame, 32)

  mountInstruments(group, panelInstruments({
    displayY: -0.45, displayZ: -1.12, spread: 0.47, width: 0.38, rowY: -0.63, rowZ: -1.13, scale: 0.9,
  }), CASSINI_PALETTE)
  cabinLight(group, 0xffe3b8, 1.6, 4)
  return group
}

export const cassiniHuygens: NasaShip = {
  id: 'cassini-huygens',
  name: 'Cassini-Huygens',
  kind: 'nasa',
  launchYear: 1997,
  model: 'assets/ships/cassini-huygens.glb',
  source: 'Cassini-Huygens (A)',
  blurb: 'Orbited Saturn from 2004 to 2017 and dropped the Huygens probe onto Titan.',
  sizeM: 17.98,
  eyeHeightM: 2.04,
  chaseM: [0, 8.5, 27],
  buildCockpit,
}
