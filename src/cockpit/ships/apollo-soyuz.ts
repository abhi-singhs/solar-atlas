import * as THREE from 'three'
import type { DisplayPalette } from '../instruments'
import { mountInstruments } from '../instruments'
import { beam, box, cabinLight, matte, metal, shipGroup } from '../parts'
import { bulkhead, frameLoop, inside, panelInstruments, polygon, switchRow, tube } from './cabin'
import type { Point } from './cabin'
import type { NasaShip } from './types'

const APOLLO_PALETTE: DisplayPalette = {
  background: '#07090a', grid: '#1d2a24', frame: '#3d4a44', title: '#cfe8d8', primary: '#7dff6a', secondary: '#cfe8d8',
  footer: '#ffcc33', housing: 0x3f4447, screw: 0x9a9fa2, gaugeFace: 0x0b0c0d, gaugeRing: 0xb4b8bb, tick: 0xf4f4f0,
  needle: 0xffffff, compass: 0xd0d4d2, chevron: 0xffcc33, lampOff: 0x352a0e, lampOn: 0xffcc33, barOff: 0x26302b, barOn: 0x7dff6a,
}

/** The forward rendezvous window, here centered for the pilot. */
const WINDOW: Point[] = [[-0.34, -0.2], [0.34, -0.2], [0.34, 0.24], [-0.34, 0.24]]

/**
 * Apollo command module cabin from the docked Apollo-Soyuz stack. The crew lay on couches facing the docking tunnel,
 * under the wide three-part main display console. Beta-cloth walls, grey panels, and couch struts below. Built from
 * primitives for this app.
 */
function buildCockpit(): THREE.Group {
  const group = shipGroup('Apollo-Soyuz command module cockpit')
  const cloth = inside(matte(0xd8d2c4, 0.95))
  const panel = metal(0x4c5154, 0.65, 0.35)
  const dark = metal(0x1a1c1e, 0.8, 0.25)
  const frame = metal(0x9a9fa2, 0.45, 0.7)
  const white = matte(0xf0efe8, 0.6)
  const strut = metal(0x5a5e60, 0.55, 0.6)

  tube(group, 'conical-cabin-wall', 1.0, 1.7, -1.3, 0.9, cloth, 32)
  bulkhead(group, 'forward-hatch-bulkhead', polygon(32, 1.02), [WINDOW], -1.28, 0.05, cloth)
  frameLoop(group, 'rendezvous-window-frame', WINDOW, -1.26, 0.025, frame)
  box(group, 'rendezvous-window-hood', [0.78, 0.04, 0.16], [0, 0.27, -1.2], dark)

  box(group, 'center-display-console', [1.0, 0.5, 0.07], [0, -0.55, -1.18], panel)
  for (const side of [-1, 1]) {
    const wing = box(group, 'side-display-console', [0.9, 0.62, 0.07], [side * 0.92, -0.46, -0.94], panel)
    wing.rotation.y = -side * 0.62
    switchRow(group, 'side-console-switch-row', 6, [side * 0.66, -0.26, -1.08], [side * 0.11, 0, 0.075], white)
    switchRow(group, 'side-console-switch-row', 6, [side * 0.66, -0.68, -1.08], [side * 0.11, 0, 0.075], white)
    beam(group, 'couch-strut', [side * 0.55, -1.3, -0.9], [side * 0.45, -0.85, 0.3], 0.03, strut)
    box(group, 'couch-armrest', [0.1, 0.06, 0.5], [side * 0.5, -0.82, -0.2], dark)
  }
  box(group, 'console-glare-shield', [1.04, 0.035, 0.12], [0, -0.29, -1.14], dark)
  switchRow(group, 'center-console-switch-row', 8, [-0.42, -0.74, -1.13], [0.12, 0, 0], white)
  box(group, 'rotation-hand-controller', [0.07, 0.15, 0.08], [0.38, -0.82, -0.45], dark)
  box(group, 'translation-hand-controller', [0.09, 0.08, 0.12], [-0.38, -0.84, -0.45], dark)

  mountInstruments(group, panelInstruments({
    displayY: -0.45, displayZ: -1.12, spread: 0.46, width: 0.36, rowY: -0.63, rowZ: -1.13, scale: 0.9,
  }), APOLLO_PALETTE)
  cabinLight(group, 0xfff4e0, 1.8, 4)
  return group
}

export const apolloSoyuz: NasaShip = {
  id: 'apollo-soyuz',
  name: 'Apollo-Soyuz',
  kind: 'nasa',
  launchYear: 1975,
  model: 'assets/ships/apollo-soyuz.glb',
  source: 'Apollo Soyuz',
  blurb: 'An Apollo command and service module docked to Soyuz 19 for the first joint U.S. and Soviet flight, in 1975.',
  sizeM: 20.11,
  eyeHeightM: 2.4,
  chaseM: [0, 4.5, 22],
  buildCockpit,
}
