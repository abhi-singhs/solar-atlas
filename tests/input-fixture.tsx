import { createRoot } from 'react-dom/client'
import * as THREE from 'three'
import { InputController } from '../src/input/controls'
import { TouchControls } from '../src/input/TouchControls'
import { createCockpit, createShip, updateCockpit } from '../src/cockpit/models'
import '../src/index.css'

const host = document.getElementById('fixture')!
host.style.cssText = 'position:relative;width:100%;height:100dvh;overflow:hidden'
const canvasHost = document.createElement('div')
canvasHost.id = 'flight-canvas'
canvasHost.tabIndex = 0
canvasHost.style.cssText = 'position:absolute;inset:0;outline:none'
host.append(canvasHost)
const controller = new InputController(canvasHost)
controller.setEnabled(true)
let brakes = 0
const controlHost = document.createElement('div')
host.append(controlHost)
const root = createRoot(controlHost)

function render(enabled = true) {
  controller.setEnabled(enabled)
  root.render(<>
    <div style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 2, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      <input aria-label="Flight text field" style={{ width: 100 }} />
      <select aria-label="Flight select"><option>Earth</option><option>Moon</option></select>
      <input aria-label="Flight throttle" type="range" min="0" max="100" style={{ width: 100 }} />
      <div role="textbox" contentEditable suppressContentEditableWarning aria-label="Flight editable" style={{ background: 'var(--cp-surface)', minWidth: 44, minHeight: 32 }}>Text</div>
      <button type="button" onClick={() => render(false)}>Disable flight</button>
    </div>
    <TouchControls input={controller.state} enabled={enabled} onBrake={() => brakes++} />
  </>)
}
render()
Object.assign(window, {
  inputFixture: { controller, input: controller.state, render, brakeCount: () => brakes, unmount: () => root.unmount() },
})

if (new URLSearchParams(location.search).has('model')) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(1)
  renderer.setSize(innerWidth, innerHeight)
  renderer.setClearColor(0x101415)
  canvasHost.append(renderer.domElement)
  const scene = new THREE.Scene()
  const shipView = new URLSearchParams(location.search).get('model') === 'ship'
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, shipView ? 100 : 10)
  scene.add(new THREE.AmbientLight(0xe3dfdb, 2))
  const key = new THREE.DirectionalLight(0xffede1, 3)
  key.position.set(-2, 4, 1)
  scene.add(key)
  const group = shipView ? createShip() : createCockpit()
  scene.add(group)
  if (shipView) {
    camera.position.set(9, 7, -11)
    camera.lookAt(0, -0.3, 0)
  } else {
    updateCockpit(group, {
      speedC: 0.00000128, throttleC: 0.0000013, altitudeKm: 23.85,
      verticalKmS: -0.0025, warp: false, mode: 'approach',
      targetId: 'moon', targetName: 'Moon', referenceId: 'earth', referenceName: 'Earth', headingDeg: 82.7,
    })
  }
  renderer.render(scene, camera)
  Object.assign(window, { inputModelReady: true })
}
