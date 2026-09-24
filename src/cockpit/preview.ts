import * as THREE from 'three'
import { disposeTree } from './parts'
import { CHASE_PITCH } from './ships'
import type { ShipDesign } from './ships'

export type PreviewView = 'hangar' | 'chase' | 'cockpit'

export interface ShipStage {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  model: THREE.Group
  dispose(): void
}

/**
 * Lights one ship the way the flight renderer does, with a white key light and a cool sky fill, and places a camera.
 * `hangar` frames the exterior from the front left, `chase` uses the design's chase offset, and `cockpit` sits at the
 * pilot's eye.
 */
export function stageShip(design: ShipDesign, view: PreviewView, aspect: number, fov = 50): ShipStage {
  const scene = new THREE.Scene()
  const model = view === 'cockpit' ? design.buildCockpit() : design.buildShip()
  scene.add(model)
  const sun = new THREE.DirectionalLight(0xffffff, 2)
  sun.position.set(-0.55, 0.65, -0.5)
  scene.add(sun, new THREE.HemisphereLight(0xd0ddff, 0x252224, 0.7))
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.01, 2000)
  model.updateMatrixWorld(true)
  if (view === 'cockpit') {
    camera.position.set(0, 0, 0)
  } else if (view === 'chase') {
    camera.position.set(design.chaseM[0], design.chaseM[1], design.chaseM[2])
    camera.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), CHASE_PITCH)
  } else {
    const bounds = new THREE.Box3().setFromObject(model, true)
    const sphere = bounds.getBoundingSphere(new THREE.Sphere())
    const direction = new THREE.Vector3(-0.78, 0.42, -0.95).normalize()
    const vertical = THREE.MathUtils.degToRad(fov) / 2
    const horizontal = Math.atan(Math.tan(vertical) * aspect)
    const distance = sphere.radius / Math.sin(Math.min(vertical, horizontal)) * 0.92
    camera.position.copy(sphere.center).addScaledVector(direction, distance)
    camera.lookAt(sphere.center)
  }
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return { scene, camera, model, dispose: () => disposeTree(model) }
}

type Listener = (id: string, url: string) => void
const done = new Map<string, string>()
const listeners = new Set<Listener>()
let pending: Promise<Map<string, string>> | undefined

/**
 * Renders a hangar thumbnail for each design with a short-lived WebGL context, then frees it. The results are cached
 * for the session. `onImage` fires once per thumbnail, including ones finished before the call. Rejects if WebGL is
 * unavailable, and a later call tries again.
 */
export function shipPreviews(designs: readonly ShipDesign[], onImage?: Listener, width = 320, height = 200): Promise<Map<string, string>> {
  if (onImage) {
    for (const [id, url] of done) onImage(id, url)
    listeners.add(onImage)
  }
  pending ??= render(designs, width, height).catch(error => {
    pending = undefined
    throw error
  })
  return pending.finally(() => { if (onImage) listeners.delete(onImage) })
}

async function render(designs: readonly ShipDesign[], width: number, height: number): Promise<Map<string, string>> {
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  try {
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setSize(width, height, false)
    renderer.setClearColor(0x000000, 0)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    for (const design of designs) {
      if (done.has(design.id)) continue
      const stage = stageShip(design, 'hangar', width / height, 32)
      renderer.clear()
      renderer.render(stage.scene, stage.camera)
      stage.dispose()
      const url = canvas.toDataURL('image/png')
      done.set(design.id, url)
      for (const listener of listeners) listener(design.id, url)
      // Yield between ships so a slow device keeps painting the popover.
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  } finally {
    renderer.dispose()
    renderer.forceContextLoss()
  }
  return new Map(done)
}
