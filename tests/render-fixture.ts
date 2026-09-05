import { FloatType, LinearSRGBColorSpace, Matrix4, NoToneMapping, Quaternion, Vector3, WebGLRenderTarget } from 'three'
import { SolarRenderer } from '../src/render/SolarRenderer'
import { loadDataset } from '../src/simulation/dataset'
import { bodyRadius } from '../src/contracts'
import type { CameraPose, Quality, RenderOptions, Vec3 } from '../src/contracts'
import { FlightController } from '../src/flight/FlightController'

const errors: string[] = []
const status = document.getElementById('status')!
const dataset = await loadDataset(message => { status.textContent = message })
const snapshot = dataset.evaluate(dataset.firstJd)
const renderer = new SolarRenderer(document.getElementById('view')!, dataset, {
  onError: message => { errors.push(message); status.textContent = message },
  onSelect: id => { status.textContent = `Selected ${id}` },
  onProgress: message => { status.textContent = message },
})
let pose: CameraPose = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] }
const options: RenderOptions = { selectedId: 'earth', labels: true, paths: false,
  quality: 'low', exposure: 0, cockpit: false, chase: false }
let active = true
const frame = () => {
  if (active) { renderer.update(snapshot, pose, options); requestAnimationFrame(frame) }
}
async function focus(id: string, quality: Quality = 'low') {
  const body = dataset.bodies.find(body => body.id === id)!
  const state = snapshot.states[id]!
  const target = new Vector3(...state.position)
  const sun = new Vector3(...snapshot.states.sun!.position).sub(target).normalize()
  const tangent = new Vector3(0, 0, 1).cross(sun).normalize()
  const radius = bodyRadius(body)
  const north = new Vector3(0, 0, 1).applyQuaternion(new Quaternion(...state.rotation))
  const offset = sun.multiplyScalar(.82).addScaledVector(tangent, .38).addScaledVector(north, .48)
    .normalize().multiplyScalar(radius * (id === 'saturn' ? 8 : id === 'jupiter' ? 7 : 3.6))
  const eye = target.clone().add(offset)
  pose = { position: eye.toArray() as Vec3,
    quaternion: new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(eye, target, north)).toArray() }
  options.selectedId = id
  options.quality = quality
  renderer.update(snapshot, pose, options)
  await renderer.ensureBody(id)
  renderer.update(snapshot, pose, options)
  status.textContent = `${body.name} | source geometry and maps | ${quality} quality`
}
async function terrainView(id: string, altitudeKm = .006) {
  await focus(id)
  const state = snapshot.states[id]!
  const rotation = new Quaternion(...state.rotation)
  const center = new Vector3(...state.position)
  const direction = new Vector3(...pose.position).sub(center).applyQuaternion(rotation.clone().invert()).normalize()
  renderer.surface.prepareLanding(id, direction.toArray() as Vec3)
  renderer.update(snapshot, pose, options)
  const hit = renderer.surface.sample(id, direction.toArray() as Vec3)!
  const ground = new Vector3(...hit.point)
  const normal = new Vector3(...hit.normal)
  const east = new Vector3(0, 0, 1).cross(normal).normalize()
  const eye = ground.clone().addScaledVector(normal, altitudeKm).applyQuaternion(rotation).add(center)
  const ahead = ground.clone().addScaledVector(east, .08).applyQuaternion(rotation).add(center)
  pose = { position: eye.toArray() as Vec3, quaternion: new Quaternion().setFromRotationMatrix(
    new Matrix4().lookAt(eye, ahead, normal.clone().applyQuaternion(rotation))).toArray() }
  options.landingBodyId = id
  renderer.update(snapshot, pose, options)
  status.textContent = `${id} | source mesh and reconstructed local terrain | altitude ${altitudeKm * 1000} m`
  return { patch: renderer.getActiveTerrainPatch(id), source: renderer.sourceSurface.sample(id, direction.toArray() as Vec3),
    reconstructed: renderer.surface.sample(id, direction.toArray() as Vec3) }
}
async function lightingProbe() {
  await focus('earth', 'low')
  const internal = renderer as unknown as {
    renderer: import('three').WebGLRenderer
    camera: import('three').Camera
    visuals: Map<string, { scene: import('three').Scene; parts: { mesh: import('three').Mesh<import('three').BufferGeometry, import('three').ShaderMaterial> }[] }>
  }
  const visual = internal.visuals.get('earth')!
  const gl = internal.renderer
  const surface = visual.parts[0]!.mesh
  const material = surface.material
  const u = material.uniforms
  const target = new WebGLRenderTarget(96, 96, { type: FloatType })
  const buffer = new Float32Array(96 * 96 * 4)
  const tone = gl.toneMapping
  const color = gl.outputColorSpace
  gl.toneMapping = NoToneMapping
  gl.outputColorSpace = LinearSRGBColorSpace
  for (const part of visual.parts) part.mesh.visible = part.mesh === surface
  u.uSun!.value.copy(u.uEye!.value).normalize()
  u.uExposure!.value = 1
  u.uBandCount!.value = 0
  u.uEarth!.value = false
  for (const occluder of u.uOccluders!.value) occluder.set(0, 0, 0, 0)
  const capture = (flux: number): number => {
    u.uFlux!.value = flux
    gl.setRenderTarget(target)
    gl.clear()
    gl.render(visual.scene, internal.camera)
    gl.readRenderTargetPixels(target, 0, 0, 96, 96, buffer)
    let sum = 0
    for (let y = 32; y < 64; y++) for (let x = 32; x < 64; x++) {
      const i = (y * 96 + x) * 4
      sum += buffer[i]! + buffer[i + 1]! + buffer[i + 2]!
    }
    return sum
  }
  const full = capture(1), quarter = capture(.25)
  const center = u.uSun!.value.clone().multiplyScalar(3)
  u.uOccluders!.value[0].set(center.x, center.y, center.z, 1.5)
  const eclipse = capture(1)
  gl.setRenderTarget(null)
  gl.toneMapping = tone
  gl.outputColorSpace = color
  target.dispose()
  for (const part of visual.parts) part.mesh.visible = true
  u.uEarth!.value = true
  renderer.update(snapshot, pose, options)
  return { fullRadiance: full, quarterRadiance: quarter, ratio: quarter / full, eclipseRadiance: eclipse }
}
async function flightLandingProbe() {
  await focus('bennu')
  const flight = new FlightController(dataset.bodies, renderer.surface)
  flight.enter(snapshot, 'bennu', pose)
  flight.land('bennu', snapshot)
  const input = { pitch: 0, yaw: 0, roll: 0, forward: 0, vertical: 0, lateral: 0,
    brake: false, lookX: 0, lookY: 0 }
  let current = snapshot
  let steps = 0
  for (; steps < 1800; steps++) {
    current = dataset.evaluate(snapshot.jdTdb + (steps + 1) * .1 / 86400)
    flight.update(.1, current, input)
    if (flight.telemetry(current).mode === 'landed') break
  }
  const patch = renderer.getActiveTerrainPatch('bennu')
  const telemetry = flight.telemetry(current)
  const landedPose = flight.pose()
  options.landingBodyId = 'bennu'
  options.shipPose = landedPose
  options.flightTelemetry = telemetry
  renderer.update(current, landedPose, options)
  const preserved = renderer.getActiveTerrainPatch('bennu')
  options.shipPose = undefined
  options.flightTelemetry = undefined
  return { steps, telemetry, patch, renderedPatch: preserved, shipPose: landedPose }
}
await focus('earth')
requestAnimationFrame(frame)
Object.assign(window, { renderTest: { renderer, errors, focus, terrainView, lightingProbe, flightLandingProbe, snapshot, options,
  get pose() { return pose }, stop: () => { active = false; renderer.dispose() } } })
