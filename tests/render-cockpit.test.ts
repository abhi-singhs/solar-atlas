import { afterEach, describe, expect, it, vi } from 'vitest'
import { DirectionalLight, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three'
import { createCockpit, updateCockpit } from '../src/cockpit/models'
import { SolarRenderer } from '../src/render/SolarRenderer'
import type { CameraPose, Dataset, RenderOptions, Snapshot } from '../src/contracts'

vi.mock('../src/cockpit/models', async importOriginal => {
  const original = await importOriginal<typeof import('../src/cockpit/models')>()
  return { ...original, updateCockpit: vi.fn(original.updateCockpit) }
})

interface Harness {
  cockpit: Group
  ship: Group
  shipSun: DirectionalLight
  camera: PerspectiveCamera
  cockpitScene: Scene
  renderer: { clearDepth: ReturnType<typeof vi.fn>; render: ReturnType<typeof vi.fn> }
  dataset: Pick<Dataset, 'bodies'>
  drawShip(snapshot: Snapshot, camera: CameraPose, options: RenderOptions): void
}

const groups: Group[] = []
function harness(): Harness {
  const cockpit = createCockpit()
  groups.push(cockpit)
  return Object.assign(Object.create(SolarRenderer.prototype), {
    cockpit, ship: new Group(), shipSun: new DirectionalLight(), camera: new PerspectiveCamera(),
    cockpitScene: new Scene(), renderer: { clearDepth: vi.fn(), render: vi.fn() },
    dataset: { bodies: [
      { id: 'earth', name: 'Earth', category: 'planet', parent_id: 'sun', radius_km: 6371 },
      { id: 'moon', name: 'Moon', category: 'moon', parent_id: 'earth', radius_km: 1737.4 },
    ] },
  })
}
const pose: CameraPose = { position: [1e8, 2e8, 3e8], quaternion: [0, 0, 0, 1] }
const snapshot: Snapshot = { jdTdb: 2461288.5, states: {
  sun: { position: [0, 0, 0], velocity: [0, 0, 0], rotation: [0, 0, 0, 1] },
} }
function options(): RenderOptions {
  return {
    selectedId: 'moon', labels: true, paths: false, quality: 'low', exposure: 0,
    cockpit: true, chase: false, lensFlare: false, glareHidesStars: true, shipPose: pose,
    flightTelemetry: { speedC: 2e-9, throttleC: .02, altitudeKm: .0042, verticalKmS: -.0003,
      warp: false, mode: 'landing', targetId: 'moon', referenceId: 'earth' },
  }
}
const needle = (cockpit: Group, name: string) => cockpit.getObjectByName(name)!.rotation.z
const lamp = (cockpit: Group) =>
  (cockpit.getObjectByName('warp-indicator') as Mesh<never, MeshBasicMaterial>).material.color.getHex()
const bars = (cockpit: Group) => cockpit.children.filter(object => object.name === 'commanded-speed-segment')
  .map(object => (object as Mesh<never, MeshBasicMaterial>).material.color.getHex())

afterEach(() => {
  vi.clearAllMocks()
  for (const group of groups.splice(0)) group.traverse(object => {
    if (!(object instanceof Mesh)) return
    object.geometry.dispose()
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
  })
})

describe('renderer live cockpit telemetry', () => {
  it('forwards every real telemetry field unchanged and resolves source body names', () => {
    const host = harness()
    const settings = options()
    host.drawShip(snapshot, pose, settings)
    expect(updateCockpit).toHaveBeenLastCalledWith(host.cockpit, {
      ...settings.flightTelemetry, headingDeg: 0, targetName: 'Moon', referenceName: 'Earth',
    })
    expect(host.renderer.render).toHaveBeenCalledWith(host.cockpitScene, host.camera)
  })

  it('drives the actual-speed needle independently of the commanded throttle bars', () => {
    const host = harness(), settings = options()
    host.drawShip(snapshot, pose, settings)
    const startSpeed = needle(host.cockpit, 'speed-gauge-needle')
    const startBars = bars(host.cockpit)
    settings.flightTelemetry!.speedC = .004
    host.drawShip(snapshot, pose, settings)
    expect(needle(host.cockpit, 'speed-gauge-needle')).not.toBe(startSpeed)
    expect(bars(host.cockpit)).toEqual(startBars)
    const actualSpeed = needle(host.cockpit, 'speed-gauge-needle')
    settings.flightTelemetry!.throttleC = 0
    host.drawShip(snapshot, pose, settings)
    expect(needle(host.cockpit, 'speed-gauge-needle')).toBe(actualSpeed)
    expect(bars(host.cockpit)).not.toEqual(startBars)
  })

  it('updates physical vertical-speed geometry and the warp lamp on successive frames', () => {
    const host = harness(), settings = options()
    host.drawShip(snapshot, pose, settings)
    const descent = needle(host.cockpit, 'vertical-speed-gauge-needle')
    const conventional = lamp(host.cockpit)
    settings.flightTelemetry!.verticalKmS = .0003
    settings.flightTelemetry!.warp = true
    settings.flightTelemetry!.mode = 'transfer'
    host.drawShip(snapshot, pose, settings)
    expect(needle(host.cockpit, 'vertical-speed-gauge-needle')).toBeCloseTo(-descent, 12)
    expect(lamp(host.cockpit)).not.toBe(conventional)
    expect(updateCockpit).toHaveBeenLastCalledWith(host.cockpit, expect.objectContaining({
      altitudeKm: .0042, verticalKmS: .0003, warp: true, mode: 'transfer',
    }))
  })

  it('does not invent zero-speed telemetry when the caller supplies none', () => {
    const host = harness(), settings = options()
    settings.flightTelemetry = undefined
    host.drawShip(snapshot, pose, settings)
    expect(updateCockpit).not.toHaveBeenCalled()
  })
})
