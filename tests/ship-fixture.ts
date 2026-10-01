import * as THREE from 'three'
import { SHIPS, shipDesign } from '../src/cockpit/ships'
import { stageShip } from '../src/cockpit/preview'
import type { PreviewView } from '../src/cockpit/preview'
import { updateCockpit } from '../src/cockpit/models'

interface Result { coverage: number; errors: string[] }
declare global {
  interface Window {
    shipFixture: { ids: string[]; render(id: string, view: PreviewView, width?: number, height?: number): Promise<Result> }
  }
}

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(1)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
document.body.append(renderer.domElement)
const errors: string[] = []
renderer.debug.onShaderError = (gl, program) => { errors.push(gl.getProgramInfoLog(program) ?? 'shader error') }

/** Share of pixels the model covers, measured on a transparent clear before the backdrop goes in. */
function coverage(width: number, height: number): number {
  const gl = renderer.getContext()
  const pixels = new Uint8Array(width * height * 4)
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  let lit = 0
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i]! > 0) lit++
  return lit / (width * height)
}

window.shipFixture = {
  ids: SHIPS.map(ship => ship.id),
  async render(id, view, width = 960, height = 600) {
    renderer.setSize(width, height)
    const design = shipDesign(id)
    const stage = await stageShip(design, view, width / height)
    if (view === 'cockpit') {
      updateCockpit(stage.model, { speedC: 0.0012, throttleC: 0.01, altitudeKm: 0.42, verticalKmS: -0.001, warp: false,
        mode: 'approach', targetId: 'moon', referenceId: 'earth', targetName: 'Moon', referenceName: 'Earth', headingDeg: 72 })
    }
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.render(stage.scene, stage.camera)
    const covered = coverage(width, height)
    // A blue backdrop shows window openings, and a grid marks the touchdown plane.
    stage.scene.background = new THREE.Color(view === 'cockpit' ? 0x16324f : 0x0b1622)
    const grid = new THREE.GridHelper(120, 60, 0x44607a, 0x22384c)
    grid.position.y = -design.eyeHeightM
    if (view !== 'cockpit') stage.scene.add(grid)
    renderer.render(stage.scene, stage.camera)
    grid.geometry.dispose()
    ;(grid.material as THREE.Material).dispose()
    stage.dispose()
    return { coverage: covered, errors: [...errors] }
  },
}
