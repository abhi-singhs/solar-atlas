import * as THREE from 'three'
import type { DisplayPalette } from '../instruments'
import { mountInstruments } from '../instruments'
import { beam, box, cabinLight, matte, metal, shipGroup } from '../parts'
import { bulkhead, frameLoop, inside, panelInstruments, polygon, switchRow, tube } from './cabin'
import type { NasaShip } from './types'

const WEBB_PALETTE: DisplayPalette = {
  background: '#0a0805', grid: '#2e2410', frame: '#5a4518', title: '#ffe08a', primary: '#ffd36e', secondary: '#d9a842',
  footer: '#ff7a6b', housing: 0x1d1a16, screw: 0xa89060, gaugeFace: 0x0b0906, gaugeRing: 0xd4ac50, tick: 0xfff0c0,
  needle: 0xffffff, compass: 0xd8b870, chevron: 0xff7a6b, lampOff: 0x33100c, lampOn: 0xff6a50, barOff: 0x2a2414, barOn: 0xffd36e,
}

/** Flat-topped hexagon for one mirror segment, 0.62 m across the flats. */
const SEGMENT = polygon(6, 0.358, 0)

/**
 * An imagined pilot pod at the center of Webb's primary mirror. Webb flies without crew; this cabin is fiction for the
 * app. Through the hexagonal port the pilot sees the outer ring of gold mirror segments, with the inner ring left out
 * to keep the view clear. Built from primitives.
 */
function buildCockpit(): THREE.Group {
  const group = shipGroup('Webb imagined cockpit')
  const wall = inside(matte(0x16161a, 0.9))
  // Without an environment map a fully metallic gold reads black, so the segments keep some diffuse color.
  const gold = metal(0xd9a83e, 0.32, 0.55)
  const backplane = metal(0x101012, 0.8, 0.3)
  const panel = metal(0x221e19, 0.7, 0.35)
  const frame = metal(0x8f8a80, 0.45, 0.7)

  const window = polygon(6, 0.78, 0)
  tube(group, 'pod-wall', 1.05, 1.12, -1.34, 0.8, wall, 6, 0)
  bulkhead(group, 'forward-pod-wall', polygon(6, 1.12, 0), [window], -1.32, 0.05, wall)
  frameLoop(group, 'hexagonal-port-frame', window, -1.3, 0.03, gold)

  // The outer ring of twelve segments on a hexagonal grid, 0.62 m apart, with the six inner segments omitted.
  const pitch = 0.62
  const mirrorZ = -2.8
  const directions = [0, 1, 2, 3, 4, 5].map(i => [Math.cos(i * Math.PI / 3 + Math.PI / 6), Math.sin(i * Math.PI / 3 + Math.PI / 6)] as const)
  directions.forEach(([dx, dy], i) => {
    const [nx, ny] = directions[(i + 2) % 6]!
    for (const [cx, cy] of [[2 * dx, 2 * dy], [2 * dx + nx, 2 * dy + ny]]) {
      const segment = bulkhead(group, 'gold-mirror-segment', SEGMENT, [], mirrorZ, 0.05, gold)
      segment.position.x = cx! * pitch
      segment.position.y = cy! * pitch
    }
  })
  bulkhead(group, 'mirror-backplane', polygon(6, 2.3, 0), [polygon(6, 0.78, 0)], mirrorZ - 0.06, 0.1, backplane)
  for (const angle of [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]) {
    beam(group, 'secondary-mirror-strut', [Math.cos(angle) * 2.1, Math.sin(angle) * 2.1, mirrorZ], [Math.cos(angle) * 1.0, Math.sin(angle) * 1.0, -6.5], 0.03, frame)
  }

  const console = box(group, 'flight-console', [1.6, 0.5, 0.07], [0, -0.58, -1.18], panel)
  console.rotation.x = -0.08
  box(group, 'console-gold-trim', [1.64, 0.025, 0.09], [0, -0.32, -1.16], gold)
  switchRow(group, 'console-switch-row', 8, [-0.42, -0.74, -1.13], [0.12, 0, 0], frame)

  mountInstruments(group, panelInstruments({
    displayY: -0.45, displayZ: -1.12, spread: 0.47, width: 0.38, rowY: -0.63, rowZ: -1.13, scale: 0.9,
  }), WEBB_PALETTE)
  cabinLight(group, 0xffe9c4, 1.6, 4)
  return group
}

export const jwst: NasaShip = {
  id: 'jwst',
  name: 'Webb',
  kind: 'nasa',
  launchYear: 2021,
  model: 'assets/ships/jwst.glb',
  source: 'James Webb Space Telescope (B)',
  blurb: 'The James Webb Space Telescope. Its gold 6.5 m mirror rides above a sunshield the size of a tennis court.',
  sizeM: 21.19,
  eyeHeightM: 7.23,
  chaseM: [0, 5.5, 33.5],
  buildCockpit,
}
