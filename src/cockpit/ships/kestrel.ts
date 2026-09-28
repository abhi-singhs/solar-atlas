import * as THREE from 'three'
import { KESTREL_PALETTE, mountInstruments } from '../instruments'
import { beam, box, cabinLight, glass, light, metal, plate, shipGroup } from '../parts'
import type { ShipDesign } from './types'

/**
 * Original "Kestrel" exploration cockpit, not source scientific geometry.
 * Render in a separate camera scene with near 0.01, far 10 and a 60 degree vertical FOV.
 * No center canopy strut or windshield plane blocks the forward sightline.
 */
function buildCockpit(): THREE.Group {
  const group = shipGroup('Kestrel original cockpit')
  const graphite = metal(0x27292b, 0.78, 0.35)
  const dark = metal(0x171a1d, 0.75, 0.25)
  const alloy = metal(0x878077, 0.35, 0.78)
  const trim = metal(0x9b6569, 0.44, 0.6)
  const stitching = light(0xbe8b87)

  const dash = plate(group, 'faceted-dashboard', [
    [-1.08, -0.78], [-1.08, -0.51], [-0.88, -0.37],
    [-0.36, -0.37], [-0.27, -0.41], [0.27, -0.41],
    [0.36, -0.37], [0.88, -0.37], [1.08, -0.51], [1.08, -0.78],
  ], 0.23, graphite)
  dash.position.z = -1.67
  box(group, 'dashboard-lower-edge', [1.91, 0.05, 0.06], [0, -0.79, -1.42], alloy)
  box(group, 'dashboard-crown', [0.52, 0.035, 0.28], [0, -0.395, -1.48], dark)

  for (const side of [-1, 1]) {
    const s = side
    beam(group, 'canopy-lower-side', [s * 0.98, -0.49, -1.32], [s * 1.19, -0.41, 0.18], 0.052, graphite)
    beam(group, 'canopy-pillar', [s * 1.05, -0.48, -1.38], [s * 0.92, 0.69, -1.43], 0.039, alloy)
    beam(group, 'canopy-pillar-inner-trim', [s * 1.00, -0.38, -1.365], [s * 0.885, 0.68, -1.415], 0.009, trim)
    beam(group, 'canopy-roof-side', [s * 0.92, 0.70, -1.43], [s * 1.05, 0.88, 0.12], 0.045, graphite)
    beam(group, 'canopy-sill-light', [s * 0.94, -0.41, -1.30], [s * 1.10, -0.36, -0.36], 0.006, stitching)
    const console = box(group, 'side-console', [0.33, 0.23, 1.18], [s * 0.80, -0.84, -0.40], graphite)
    console.rotation.z = s * 0.14
    box(console, 'console-inset', [0.25, 0.012, 0.95], [0, 0.12, -0.04], dark)
    for (let i = 0; i < 5; i++) {
      box(console, 'console-switch', [0.036, 0.016, 0.049], [s * 0.065, 0.137, -0.40 + i * 0.11], alloy)
      box(console, 'console-switch-light', [0.007, 0.008, 0.025], [-s * 0.07, 0.133, -0.40 + i * 0.11], stitching)
    }
    beam(console, 'hand-controller', [0, 0.12, 0.23], [0, 0.29, 0.15], 0.028, dark)
    box(console, 'hand-controller-cap', [0.070, 0.040, 0.054], [0, 0.29, 0.15], trim)
    for (let i = 0; i < 3; i++) {
      box(group, 'dashboard-vent', [0.074, 0.011, 0.012], [s * 0.91, -0.62 + i * 0.033, -1.40], dark)
    }
  }
  beam(group, 'canopy-roof-brow', [-0.93, 0.70, -1.44], [0.93, 0.70, -1.44], 0.040, graphite)
  beam(group, 'canopy-roof-brow-trim', [-0.86, 0.67, -1.42], [0.86, 0.67, -1.42], 0.005, alloy)
  box(group, 'footwell', [1.25, 0.06, 1.25], [0, -1.10, -0.49], dark)

  mountInstruments(group, {
    displays: [
      { kind: 'flight', position: [-0.58, -0.56, -1.43], width: 0.45 },
      { kind: 'navigation', position: [0, -0.56, -1.43], width: 0.55 },
      { kind: 'altitude', position: [0.58, -0.56, -1.43], width: 0.45 },
    ],
    speedGauge: { position: [-0.32, -0.71, -1.39] },
    verticalGauge: { position: [0.32, -0.71, -1.39] },
    heading: { position: [0, -0.729, -1.39] },
    warpLamp: { position: [0.19, -0.73, -1.39] },
    throttle: { position: [-0.72, -0.738, -1.39] },
  }, KESTREL_PALETTE)
  cabinLight(group, 0xc2d5e2)
  return group
}

/** Hull envelope is about 7.6 m wide by 8.5 m long. */
function buildShip(): THREE.Group {
  const group = shipGroup('Kestrel original exploration craft')
  const hull = metal(0xb3afa5, 0.54, 0.65)
  const dark = metal(0x303539, 0.65, 0.45)
  const seam = metal(0x5b5d5a, 0.65, 0.5)
  const accent = metal(0x9a515d, 0.45, 0.6)
  const body = plate(group, 'lifting-body-hull', [
    [0, 4.8], [-0.65, 3.5], [-1.22, 1.6], [-1.25, -2.4],
    [-0.78, -3.5], [0.78, -3.5], [1.25, -2.4], [1.22, 1.6], [0.65, 3.5],
  ], 0.74, hull)
  body.rotation.x = -Math.PI / 2
  body.position.y = -0.92
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), glass(0x25393e))
  canopy.name = 'segmented-pilot-canopy'
  canopy.scale.set(0.92, 0.70, 1.50)
  canopy.position.set(0, -0.18, -1.00)
  group.add(canopy)
  for (const side of [-1, 1]) {
    const wing = plate(group, 'swept-outrigger', [[0.96, 0.8], [1.56, 1.2], [3.72, -2.35], [3.60, -3.25], [1.02, -2.15]], 0.20, hull)
    wing.rotation.x = -Math.PI / 2
    wing.scale.x = side
    wing.position.y = -0.77
    const stripe = plate(group, 'outrigger-identification-stripe', [[1.6, 0.55], [1.73, 0.4], [3.35, -2.44], [3.2, -2.4]], 0.014, accent)
    stripe.rotation.x = -Math.PI / 2
    stripe.scale.x = side
    stripe.position.y = -0.55
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.44, 1.75, 12), dark)
    engine.name = 'outrigger-engine'
    engine.rotation.x = Math.PI / 2
    engine.position.set(side * 2.74, -0.50, 2.10)
    group.add(engine)
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.075, 8, 24), seam)
    rim.name = 'engine-nozzle-rim'
    rim.position.set(side * 2.74, -0.5, 3.01)
    group.add(rim)
    const nozzle = new THREE.Mesh(new THREE.CircleGeometry(0.29, 24), light(0xbf8489))
    nozzle.name = 'engine-core'
    nozzle.position.set(side * 2.74, -0.5, 3.025)
    group.add(nozzle)
    const fin = plate(group, 'canted-tail-fin', [[0, 0], [0, 0.9], [-0.72, 1.24], [-0.95, 0]], 0.065, accent)
    fin.rotation.y = Math.PI / 2
    fin.rotation.z = side * -0.19
    fin.position.set(side * 0.97, -0.1, 2.58)
    beam(group, 'canopy-longitudinal-frame', [side * 0.82, -0.08, -1.8], [side * 0.78, 0.04, 0.01], 0.035, seam)
    box(group, 'forward-running-light', [0.055, 0.035, 0.20], [side * 1.17, -0.12, -1.05], light(0xf6d6c7))
    beam(group, 'landing-strut', [side * 0.85, -0.88, 1.6], [side * 1.17, -2.92, 1.75], 0.055, seam)
    box(group, 'landing-pad', [0.36, 0.08, 0.65], [side * 1.17, -2.96, 1.75], dark)
  }
  // The pad bottoms meet the controller's ground datum, three meters below the pilot.
  beam(group, 'forward-landing-strut', [0, -0.92, -2.8], [0, -2.92, -2.85], 0.055, seam)
  box(group, 'forward-landing-pad', [0.30, 0.08, 0.50], [0, -2.96, -2.85], dark)
  for (let i = 0; i < 6; i++) {
    box(group, 'dorsal-radiator', [0.70, 0.022, 0.045], [0, -0.14, 0.95 + i * 0.20], dark)
  }
  return group
}

export const kestrel: ShipDesign = {
  id: 'kestrel',
  name: 'Kestrel',
  kind: 'original',
  blurb: 'The atlas survey craft. Swept outriggers, twin engines, and a clear forward canopy.',
  sizeM: 8.5,
  eyeHeightM: 3,
  chaseM: [0, 7, 20],
  buildShip,
  buildCockpit,
}
