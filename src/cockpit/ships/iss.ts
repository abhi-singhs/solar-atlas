import * as THREE from 'three'
import type { DisplayPalette } from '../instruments'
import { mountInstruments } from '../instruments'
import { beam, box, cabinLight, matte, metal, shipGroup, torus } from '../parts'
import { frameLoop, inside, panelInstruments, polygon, switchRow, tube } from './cabin'
import type { NasaShip } from './types'

const ISS_PALETTE: DisplayPalette = {
  background: '#0b1220', grid: '#1f3350', frame: '#3b5b85', title: '#d8e6ff', primary: '#eef4ff', secondary: '#9fb8dd',
  footer: '#ffb347', housing: 0x22252a, screw: 0x6f747a, gaugeFace: 0x0c1018, gaugeRing: 0xa7b0bc, tick: 0xe8eef8,
  needle: 0xffffff, compass: 0x9fb2cc, chevron: 0xffb347, lampOff: 0x1e2a3a, lampOn: 0x5ab0ff, barOff: 0x1a2433, barOn: 0x8fc2ff,
}

/**
 * The Cupola, the station's seven-window observation module, turned to face the direction of flight. A round center
 * window sits inside a ring of six trapezoid windows. Below them is the robotics workstation, with laptop displays and
 * the two arm hand controllers. White walls and handrails. Built from primitives for this app.
 */
function buildCockpit(): THREE.Group {
  const group = shipGroup('International Space Station Cupola cockpit')
  const wall = inside(matte(0xe6e7e3, 0.85))
  const frame = metal(0xc9ccd0, 0.4, 0.75)
  const dark = metal(0x22252a, 0.7, 0.3)
  const rail = metal(0xd7b45a, 0.45, 0.6)
  const blanket = inside(matte(0xf2f1ea, 0.95))

  // The six side windows run from the center window ring out to the wider base of the dome.
  const innerZ = -1.32
  const outerZ = -0.62
  const inner = polygon(6, 0.5, Math.PI / 6)
  const outer = polygon(6, 1.12, Math.PI / 6)
  torus(group, 'center-window-ring', 0.43, 0.045, [0, 0, innerZ - 0.02], 'z', frame, 48)
  frameLoop(group, 'center-window-mount', inner, innerZ, 0.03, frame)
  frameLoop(group, 'dome-base-ring', outer, outerZ, 0.04, frame)
  inner.forEach((corner, i) => {
    const base = outer[i]!
    beam(group, 'window-mullion', [corner[0], corner[1], innerZ], [base[0], base[1], outerZ], 0.035, frame)
  })
  tube(group, 'node-wall', 1.2, 1.3, outerZ, 1.2, wall, 32)
  const shutter = polygon(6, 1.2, Math.PI / 6)
  frameLoop(group, 'dome-shutter-hinges', shutter, outerZ + 0.02, 0.02, dark)

  const desk = box(group, 'robotics-workstation', [1.5, 0.08, 0.5], [0, -0.66, -0.8], blanket)
  desk.rotation.x = 0.2
  box(group, 'laptop-bracket', [1.46, 0.46, 0.04], [0, -0.46, -1.06], dark)
  switchRow(group, 'workstation-switch-row', 8, [-0.42, -0.71, -0.86], [0.12, 0, 0], frame)
  for (const side of [-1, 1]) {
    box(group, 'hand-controller-base', [0.16, 0.08, 0.16], [side * 0.48, -0.74, -0.58], dark)
    box(group, 'hand-controller-grip', [0.05, 0.14, 0.06], [side * 0.48, -0.64, -0.58], dark)
    beam(group, 'handrail', [side * 0.95, -0.6, 0.6], [side * 0.95, -0.6, -0.4], 0.018, rail)
    beam(group, 'handrail', [side * 0.6, 0.85, 0.6], [side * 0.6, 0.85, -0.4], 0.018, rail)
  }

  mountInstruments(group, panelInstruments({
    displayY: -0.42, displayZ: -1.02, spread: 0.46, width: 0.38, rowY: -0.6, rowZ: -1.03, scale: 0.85,
  }), ISS_PALETTE)
  cabinLight(group, 0xf2f6ff, 2, 4)
  return group
}

export const iss: NasaShip = {
  id: 'iss',
  name: 'ISS',
  kind: 'nasa',
  launchYear: 1998,
  model: 'assets/ships/iss.glb',
  source: 'International Space Station (ISS) (B)',
  blurb: 'The International Space Station, crewed without a break since 2000. Its 109 m span is scaled down to fit the hangar.',
  sizeM: 40,
  canonSizeM: 109,
  eyeHeightM: 2.89,
  chaseM: [0, 12, 49],
  buildCockpit,
}
