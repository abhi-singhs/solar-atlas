import * as THREE from 'three'
import type { DisplayPalette } from '../instruments'
import { mountInstruments } from '../instruments'
import { beam, box, cabinLight, matte, metal, shipGroup, torus } from '../parts'
import { bulkhead, frameLoop, inside, panelInstruments, polygon, switchRow, tube } from './cabin'
import type { Point } from './cabin'
import type { NasaShip } from './types'

const GEMINI_PALETTE: DisplayPalette = {
  background: '#0b0c0c', grid: '#2a2d2d', frame: '#4a4f4f', title: '#d8d4c3', primary: '#f4f1e6', secondary: '#b8b4a4',
  footer: '#ffb000', housing: 0x1b1c1d, screw: 0x7b7d7e, gaugeFace: 0x0c0c0c, gaugeRing: 0x9a9a96, tick: 0xf2f0e6,
  needle: 0xffffff, compass: 0xc9c6b9, chevron: 0xffb000, lampOff: 0x3a2a12, lampOn: 0xffa630, barOff: 0x2a2b2c, barOn: 0xf4f1e6,
}

/** The command pilot's hatch window, which narrows toward the top like the real Gemini hatch windows. */
const WINDOW: Point[] = [[-0.44, -0.2], [0.44, -0.2], [0.3, 0.34], [-0.3, 0.34]]

/**
 * Gemini cabin styled after the McDonnell two-seat capsule: a conical grey cabin, the hatch window over the main panel,
 * a center pedestal between the seats, and the yellow-and-black ejection D-ring. Built from primitives for this app.
 */
function buildCockpit(): THREE.Group {
  const group = shipGroup('Gemini cockpit')
  const wall = inside(matte(0x3d4043, 0.9))
  const panel = metal(0x1f2123, 0.7, 0.3)
  const frame = metal(0x8c9093, 0.45, 0.7)
  const dark = metal(0x121314, 0.8, 0.2)
  const white = matte(0xe3e0d6, 0.6)
  const yellow = matte(0xf2c230, 0.5)

  tube(group, 'conical-cabin-wall', 0.8, 1.08, -1.32, 0.7, wall, 28)
  bulkhead(group, 'forward-bulkhead', polygon(28, 0.82), [WINDOW], -1.3, 0.04, wall)
  frameLoop(group, 'hatch-window-frame', WINDOW, -1.28, 0.022, frame)
  box(group, 'hatch-window-sill', [0.98, 0.04, 0.1], [0, -0.23, -1.25], frame)

  box(group, 'main-instrument-panel', [1.4, 0.46, 0.06], [0, -0.53, -1.17], panel)
  box(group, 'panel-glare-shield', [1.44, 0.035, 0.14], [0, -0.29, -1.13], dark)
  switchRow(group, 'panel-toggle-row', 9, [-0.6, -0.71, -1.12], [0.15, 0, 0], frame)
  for (const side of [-1, 1]) {
    const wing = box(group, 'side-switch-panel', [0.34, 0.5, 0.05], [side * 0.82, -0.36, -0.78], panel)
    wing.rotation.y = -side * 0.9
    switchRow(group, 'side-breaker-row', 6, [side * 0.73, -0.24, -0.86], [side * 0.03, -0.05, 0.04], white, [0.016, 0.016, 0.02])
    beam(group, 'hatch-sill-rail', [side * 0.36, 0.58, -1.15], [side * 0.48, 0.74, 0.5], 0.02, frame)
    box(group, 'hatch-handle', [0.03, 0.03, 0.22], [side * 0.36, 0.56, -0.25], white)
  }

  box(group, 'center-pedestal', [0.3, 0.32, 0.9], [0, -0.86, -0.55], panel)
  switchRow(group, 'pedestal-switch-row', 5, [0, -0.69, -0.85], [0, 0, 0.13], white, [0.03, 0.016, 0.03])
  torus(group, 'ejection-d-ring', 0.065, 0.012, [0, -0.66, -0.3], 'z', yellow, 16)
  box(group, 'ejection-d-ring-stripe', [0.13, 0.02, 0.006], [0, -0.66, -0.29], dark)

  mountInstruments(group, panelInstruments({
    displayY: -0.44, displayZ: -1.12, spread: 0.45, width: 0.36, rowY: -0.61, rowZ: -1.12, scale: 0.85,
  }), GEMINI_PALETTE)
  cabinLight(group, 0xfff1d8, 1.6, 3)
  return group
}

export const gemini: NasaShip = {
  id: 'gemini',
  name: 'Gemini',
  kind: 'nasa',
  launchYear: 1965,
  model: 'assets/ships/gemini.glb',
  source: 'Gemini',
  blurb: 'The two-seat capsule that rehearsed rendezvous and docking for Apollo in 1965 and 1966.',
  sizeM: 5.77,
  eyeHeightM: 1.91,
  chaseM: [0, 1.75, 10.5],
  buildCockpit,
}
