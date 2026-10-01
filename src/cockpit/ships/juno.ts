import * as THREE from 'three'
import type { DisplayPalette } from '../instruments'
import { mountInstruments } from '../instruments'
import { box, cabinLight, light, metal, shipGroup } from '../parts'
import { bulkhead, frameLoop, inside, panelInstruments, polygon, switchRow, tube } from './cabin'
import type { NasaShip } from './types'

const JUNO_PALETTE: DisplayPalette = {
  background: '#080c16', grid: '#1c2740', frame: '#38507a', title: '#f5d6a8', primary: '#ffd9a0', secondary: '#d8a868',
  footer: '#8fd0ff', housing: 0x2b2f36, screw: 0xa8adb5, gaugeFace: 0x0a0d14, gaugeRing: 0xc8ccd2, tick: 0xf8e8d0,
  needle: 0xffffff, compass: 0xd8c0a0, chevron: 0x8fd0ff, lampOff: 0x2a1e10, lampOn: 0xffa040, barOff: 0x1e2638, barOn: 0xffd9a0,
}

/**
 * An imagined pilot pod in Juno's titanium radiation vault on top of the hexagonal bus. Juno flies without crew; this
 * cabin is fiction for the app. The hexagonal window matches the bus, the walls are bare titanium, and a small plaque
 * honoring Galileo, like the one Juno carries, sits beside the console. Built from primitives.
 */
function buildCockpit(): THREE.Group {
  const group = shipGroup('Juno imagined cockpit')
  const titanium = inside(metal(0x9ea2a8, 0.45, 0.85))
  const panel = metal(0x23272e, 0.7, 0.35)
  const frame = metal(0xc8ccd2, 0.4, 0.8)
  const plaque = metal(0xd9dde2, 0.25, 0.95)

  const window = polygon(6, 0.62, 0)
  tube(group, 'titanium-vault-wall', 1.05, 1.12, -1.34, 0.8, titanium, 6, 0)
  bulkhead(group, 'forward-vault-wall', polygon(6, 1.1, 0), [window], -1.32, 0.06, titanium)
  frameLoop(group, 'hexagonal-window-frame', window, -1.3, 0.03, frame)

  const console = box(group, 'flight-console', [1.6, 0.5, 0.07], [0, -0.58, -1.18], panel)
  console.rotation.x = -0.08
  box(group, 'console-top-rail', [1.64, 0.03, 0.1], [0, -0.32, -1.16], frame)
  switchRow(group, 'console-switch-row', 8, [-0.42, -0.74, -1.13], [0.12, 0, 0], frame)
  const galileo = box(group, 'galileo-plaque', [0.2, 0.28, 0.012], [-0.78, -0.12, -0.95], plaque)
  galileo.rotation.y = 0.75
  const portrait = box(group, 'galileo-plaque-portrait', [0.1, 0.12, 0.004], [-0.772, -0.08, -0.942], light(0x8a8f96))
  portrait.rotation.y = 0.75

  mountInstruments(group, panelInstruments({
    displayY: -0.45, displayZ: -1.12, spread: 0.47, width: 0.38, rowY: -0.63, rowZ: -1.13, scale: 0.9,
  }), JUNO_PALETTE)
  cabinLight(group, 0xfff0dc, 1.6, 4)
  return group
}

export const juno: NasaShip = {
  id: 'juno',
  name: 'Juno',
  kind: 'nasa',
  launchYear: 2011,
  model: 'assets/ships/juno.glb',
  source: 'Juno (A)',
  blurb: 'The solar-powered Jupiter orbiter, flying three 9 m solar wings since its 2016 arrival.',
  sizeM: 19.48,
  eyeHeightM: 2.8,
  chaseM: [0, 7, 30],
  buildCockpit,
}
