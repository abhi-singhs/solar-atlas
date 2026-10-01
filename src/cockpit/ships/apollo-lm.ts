import * as THREE from 'three'
import type { DisplayPalette } from '../instruments'
import { mountInstruments } from '../instruments'
import { beam, box, cabinLight, cylinder, matte, metal, shipGroup } from '../parts'
import { bulkhead, frameLoop, inside, panelInstruments, switchRow } from './cabin'
import type { Point } from './cabin'
import type { NasaShip } from './types'

const LM_PALETTE: DisplayPalette = {
  background: '#060806', grid: '#163018', frame: '#2c4a2e', title: '#a8e6a0', primary: '#9dff7a', secondary: '#6fd05a',
  footer: '#ffd257', housing: 0x2a2d2f, screw: 0x8a8e90, gaugeFace: 0x0d0f0e, gaugeRing: 0x9fa4a6, tick: 0xe9efe9,
  needle: 0xffffff, compass: 0xbfc8c0, chevron: 0xffd257, lampOff: 0x2c2410, lampOn: 0xffc23a, barOff: 0x1c2a1e, barOn: 0x9dff7a,
}

/** The commander's triangular window, wide at the top and narrowing to a point below, as on the real ascent stage. */
const WINDOW: Point[] = [[-0.72, 0.46], [0.64, 0.46], [-0.02, -0.52]]

/**
 * Lunar Module ascent stage, commander's station. The crew flew standing, held by restraint cables, looking down and
 * forward through a triangular window over the flight panels. Grey cabin, black instrument panels, circuit breakers on
 * the side wall, and the alignment telescope housing overhead. Built from primitives for this app.
 */
function buildCockpit(): THREE.Group {
  const group = shipGroup('Apollo Lunar Module cockpit')
  const cabin = inside(matte(0x8f9396, 0.85))
  const panel = metal(0x24272a, 0.72, 0.3)
  const frame = metal(0x6d7174, 0.5, 0.65)
  const white = matte(0xe8e8e2, 0.6)
  const breaker = metal(0x101112, 0.6, 0.4)
  const strap = matte(0xd6cfb8, 0.9)

  bulkhead(group, 'forward-cabin-face', [[-1.15, -1.7], [1.15, -1.7], [1.15, 0.85], [-1.15, 0.85]], [WINDOW], -1.22, 0.05, cabin)
  frameLoop(group, 'triangular-window-frame', WINDOW, -1.2, 0.028, frame)
  box(group, 'cabin-ceiling', [2.3, 0.04, 1.9], [0, 0.85, -0.3], cabin)
  box(group, 'cabin-floor', [2.3, 0.04, 1.9], [0, -1.62, -0.3], cabin)
  for (const side of [-1, 1]) {
    box(group, 'side-wall', [0.04, 2.5, 1.9], [side * 1.15, -0.4, -0.3], cabin)
  }

  box(group, 'flight-instrument-panel', [1.86, 0.5, 0.07], [0, -0.58, -1.13], panel)
  box(group, 'panel-top-rail', [1.9, 0.03, 0.09], [0, -0.32, -1.11], frame)
  switchRow(group, 'panel-toggle-row', 10, [-0.82, -0.73, -1.08], [0.18, 0, 0], white)
  const breakers = box(group, 'circuit-breaker-panel', [0.05, 0.9, 1.1], [-1.1, -0.28, -0.5], panel)
  breakers.rotation.y = 0.12
  for (let row = 0; row < 5; row++) {
    switchRow(group, 'circuit-breaker-row', 8, [-1.06, 0.06 - row * 0.16, -0.95], [0, 0, 0.12], breaker, [0.03, 0.03, 0.03])
  }
  const lower = box(group, 'right-switch-panel', [0.05, 0.7, 0.9], [1.1, -0.42, -0.55], panel)
  lower.rotation.y = -0.12
  switchRow(group, 'right-switch-row', 7, [1.06, -0.22, -0.92], [0, 0, 0.12], white)
  switchRow(group, 'right-switch-row', 7, [1.06, -0.42, -0.92], [0, 0, 0.12], white)

  cylinder(group, 'alignment-telescope-housing', 0.1, 0.13, 0.5, [0.05, 0.62, -0.95], 'y', frame)
  box(group, 'telescope-eyepiece', [0.12, 0.1, 0.16], [0.05, 0.4, -0.88], panel)
  for (const side of [-1, 1]) {
    beam(group, 'restraint-cable', [side * 0.42, -1.6, -0.2], [side * 0.3, -0.75, -0.05], 0.012, strap)
    box(group, 'armrest', [0.08, 0.05, 0.42], [side * 0.42, -0.82, -0.52], frame)
  }
  box(group, 'attitude-controller-grip', [0.06, 0.16, 0.07], [0.42, -0.72, -0.62], panel)
  box(group, 'thrust-controller-grip', [0.06, 0.12, 0.09], [-0.42, -0.74, -0.62], panel)

  mountInstruments(group, panelInstruments({
    displayY: -0.45, displayZ: -1.07, spread: 0.5, width: 0.4, rowY: -0.63, rowZ: -1.08,
  }), LM_PALETTE)
  cabinLight(group, 0xe8f1ff, 1.6, 4)
  return group
}

export const apolloLm: NasaShip = {
  id: 'apollo-lm',
  name: 'Apollo Lunar Module',
  kind: 'nasa',
  launchYear: 1969,
  model: 'assets/ships/apollo-lm.glb',
  source: 'Apollo Lunar Module',
  blurb: 'The lander that put twelve astronauts on the Moon between 1969 and 1972.',
  sizeM: 8.95,
  eyeHeightM: 5.08,
  chaseM: [0, 3, 19],
  buildCockpit,
}
