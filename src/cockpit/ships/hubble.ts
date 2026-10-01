import * as THREE from 'three'
import type { DisplayPalette } from '../instruments'
import { mountInstruments } from '../instruments'
import { beam, box, cabinLight, matte, metal, shipGroup, torus } from '../parts'
import { inside, panelInstruments, switchRow, tube } from './cabin'
import type { NasaShip } from './types'

const HUBBLE_PALETTE: DisplayPalette = {
  background: '#050a12', grid: '#16263a', frame: '#2f4a6b', title: '#bcd9ff', primary: '#9fd3ff', secondary: '#7aa8d8',
  footer: '#ffd27a', housing: 0x1a2028, screw: 0x8796a8, gaugeFace: 0x070b10, gaugeRing: 0x9fb2c8, tick: 0xd8e8ff,
  needle: 0xffffff, compass: 0x9fb8d8, chevron: 0xffd27a, lampOff: 0x1a2433, lampOn: 0x6ab8ff, barOff: 0x16202c, barOn: 0x9fd3ff,
}

/**
 * An imagined pilot pod at the front of Hubble's light shield. Hubble flies without crew; this cabin is fiction for
 * the app. The view runs down the black tube past the light baffle rings to the open aperture door, the way starlight
 * comes in. Built from primitives.
 */
function buildCockpit(): THREE.Group {
  const group = shipGroup('Hubble imagined cockpit')
  const shield = inside(matte(0x0d0f12, 0.95))
  const baffle = metal(0x1c1f24, 0.8, 0.3)
  const foil = metal(0xc3c8cf, 0.3, 0.9)
  const panel = metal(0x1f252d, 0.7, 0.35)
  const frame = metal(0x8e99a6, 0.45, 0.7)

  tube(group, 'light-shield-wall', 1.25, 1.25, -5.4, 0.8, shield, 32)
  for (const [i, z] of [-1.6, -2.5, -3.4, -4.3].entries()) torus(group, `light-baffle-${i + 1}`, 1.2, 0.045, [0, 0, z], 'z', baffle, 48)
  torus(group, 'aperture-rim', 1.26, 0.07, [0, 0, -5.4], 'z', foil, 48)
  const door = box(group, 'open-aperture-door', [2.5, 0.06, 2.5], [0, 2.55, -5.4], foil)
  door.rotation.x = -0.25
  beam(group, 'aperture-door-hinge', [-1.0, 1.28, -5.4], [1.0, 1.28, -5.4], 0.04, frame)

  const console = box(group, 'flight-console', [1.64, 0.52, 0.07], [0, -0.58, -1.15], panel)
  console.rotation.x = -0.06
  box(group, 'console-top-rail', [1.68, 0.03, 0.1], [0, -0.31, -1.13], frame)
  switchRow(group, 'console-switch-row', 8, [-0.42, -0.74, -1.11], [0.12, 0, 0], frame)
  for (const side of [-1, 1]) {
    const wing = box(group, 'side-console', [0.06, 0.62, 0.9], [side * 0.98, -0.45, -0.6], panel)
    wing.rotation.y = side * 0.25
    switchRow(group, 'side-console-switch-row', 6, [side * 0.94, -0.3, -0.92], [0, 0, 0.12], foil)
    switchRow(group, 'side-console-switch-row', 6, [side * 0.94, -0.5, -0.92], [0, 0, 0.12], foil)
  }

  mountInstruments(group, panelInstruments({
    displayY: -0.45, displayZ: -1.1, spread: 0.47, width: 0.38, rowY: -0.63, rowZ: -1.11, scale: 0.9,
  }), HUBBLE_PALETTE)
  cabinLight(group, 0xdfeaff, 1.6, 4)
  return group
}

export const hubble: NasaShip = {
  id: 'hubble',
  name: 'Hubble',
  kind: 'nasa',
  launchYear: 1990,
  model: 'assets/ships/hubble.glb',
  source: 'Hubble Space Telescope (A)',
  blurb: 'The Hubble Space Telescope, launched on Space Shuttle Discovery in 1990 and serviced in orbit five times.',
  sizeM: 13.1,
  eyeHeightM: 5.71,
  chaseM: [0, 6.5, 31],
  buildCockpit,
}
