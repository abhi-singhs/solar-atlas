import * as THREE from 'three'
import type { DisplayPalette } from '../instruments'
import { mountInstruments } from '../instruments'
import { beam, box, cabinLight, matte, metal, shipGroup, torus } from '../parts'
import { bulkhead, inside, panelInstruments, polygon, switchRow, tube } from './cabin'
import type { NasaShip } from './types'

const PARKER_PALETTE: DisplayPalette = {
  background: '#120806', grid: '#3b1a10', frame: '#6b2d18', title: '#ffd2b0', primary: '#ffe6d0', secondary: '#ffae7a',
  footer: '#7fe0ff', housing: 0x26201e, screw: 0x9a8a80, gaugeFace: 0x0e0806, gaugeRing: 0xc89a80, tick: 0xffe6d0,
  needle: 0xffffff, compass: 0xd8a080, chevron: 0x7fe0ff, lampOff: 0x33140a, lampOn: 0xff7a3a, barOff: 0x2a1610, barOn: 0xffb080,
}

/**
 * An imagined pilot pod tucked behind Parker Solar Probe's heat shield. Parker flies without crew, and its real shield
 * has no window; this viewport through the carbon foam is fiction for the app. Silver blankets, coolant lines for the
 * water-cooled solar arrays, and the black shield mounting frame fill the cabin. Built from primitives.
 */
function buildCockpit(): THREE.Group {
  const group = shipGroup('Parker Solar Probe imagined cockpit')
  const foil = inside(metal(0xc7cbd0, 0.35, 0.9))
  const carbon = inside(matte(0x17181a, 0.9))
  const foam = matte(0xf2f0ea, 0.95)
  const panel = metal(0x2a2321, 0.7, 0.35)
  const frame = metal(0x8c8f93, 0.45, 0.7)
  const coolant = metal(0x5a8fb8, 0.35, 0.7)

  tube(group, 'silver-blanket-wall', 1.0, 1.1, -1.25, 0.8, foil, 24)
  bulkhead(group, 'heat-shield-back-face', polygon(8, 1.25, Math.PI / 8), [polygon(32, 0.56)], -1.3, 0.12, carbon)
  torus(group, 'heat-shield-viewport-rim', 0.6, 0.08, [0, 0, -1.4], 'z', foam, 48)
  bulkhead(group, 'heat-shield-foam-core', polygon(8, 1.25, Math.PI / 8), [polygon(32, 0.62)], -1.42, 0.28, foam)
  for (const corner of polygon(4, 0.95, Math.PI / 4)) {
    beam(group, 'shield-mounting-strut', [corner[0], corner[1], -1.24], [corner[0] * 0.8, corner[1] * 0.8, -0.7], 0.03, carbon)
  }

  const console = box(group, 'flight-console', [1.6, 0.5, 0.07], [0, -0.58, -1.12], panel)
  console.rotation.x = -0.08
  box(group, 'console-top-rail', [1.64, 0.03, 0.1], [0, -0.32, -1.1], frame)
  switchRow(group, 'console-switch-row', 8, [-0.42, -0.74, -1.07], [0.12, 0, 0], frame)
  for (const side of [-1, 1]) {
    for (const y of [0.2, 0.32, 0.44]) beam(group, 'array-coolant-line', [side * 0.92, y, -1.1], [side * 0.98, y, 0.6], 0.016, coolant)
  }

  mountInstruments(group, panelInstruments({
    displayY: -0.45, displayZ: -1.06, spread: 0.47, width: 0.38, rowY: -0.63, rowZ: -1.07, scale: 0.9,
  }), PARKER_PALETTE)
  cabinLight(group, 0xfff2e6, 1.6, 4)
  return group
}

export const parkerSolarProbe: NasaShip = {
  id: 'parker-solar-probe',
  name: 'Parker Solar Probe',
  kind: 'nasa',
  launchYear: 2018,
  model: 'assets/ships/parker-solar-probe.glb',
  source: 'Parker Solar Probe',
  blurb: 'Flies closer to the Sun than any other spacecraft, behind a 2.3 m carbon heat shield.',
  sizeM: 6.13,
  eyeHeightM: 2.44,
  chaseM: [0, 3, 14],
  buildCockpit,
}
