import { afterEach, describe, expect, it, vi } from 'vitest'
import { BoxGeometry, DirectionalLight, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three'
import { createCockpit, createShip, loadShipModel, updateCockpit } from '../src/cockpit/models'
import { shipOccluder } from '../src/cockpit/shipLoader'
import type { ShipSwap } from '../src/cockpit/swap'
import { SolarRenderer } from '../src/render/SolarRenderer'
import type { CameraPose, Dataset, RenderOptions, Snapshot } from '../src/contracts'

vi.mock('../src/cockpit/models', async importOriginal => {
  const original = await importOriginal<typeof import('../src/cockpit/models')>()
  return { ...original, updateCockpit: vi.fn(original.updateCockpit), loadShipModel: vi.fn(original.loadShipModel) }
})
vi.mock('../src/cockpit/shipLoader', async importOriginal => {
  const original = await importOriginal<typeof import('../src/cockpit/shipLoader')>()
  return { ...original, shipOccluder: vi.fn(original.shipOccluder) }
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

describe('renderer ship model swap', () => {
  interface SwapHost extends Harness {
    shipSwap: ShipSwap<unknown>
    callbacks: { onShipFailed: ReturnType<typeof vi.fn>; onShipShown: ReturnType<typeof vi.fn> }
    setShipModel(id: string | undefined): void
  }
  function swapHost(): SwapHost {
    const host = harness() as SwapHost
    host.ship = createShip()
    groups.push(host.ship)
    host.callbacks = { onShipFailed: vi.fn(), onShipShown: vi.fn() }
    const factory = (SolarRenderer.prototype as unknown as { createShipSwap(this: SwapHost, id: string): ShipSwap<unknown> }).createShipSwap
    host.shipSwap = factory.call(host, 'kestrel')
    host.cockpitScene.add(host.cockpit, host.ship)
    return host
  }
  const disposals = (root: Group) => {
    const spies: ReturnType<typeof vi.fn>[] = []
    root.traverse(object => {
      if (!(object instanceof Mesh)) return
      spies.push(vi.spyOn(object.geometry, 'dispose') as never)
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        spies.push(vi.spyOn(material, 'dispose') as never)
    })
    return spies
  }
  const shown = async (host: SwapHost, id: string) => {
    await vi.waitFor(() => expect(host.shipSwap.current).toBe(id))
    groups.push(host.cockpit, host.ship)
  }

  it('keeps the current ship until the new one loads, then replaces both groups and frees the old ones', async () => {
    const host = swapHost()
    const oldCockpit = host.cockpit, oldShip = host.ship
    const spies = [...disposals(oldCockpit), ...disposals(oldShip)]
    host.setShipModel('atomic')
    expect(host.cockpit).toBe(oldCockpit)
    expect(host.callbacks.onShipShown).not.toHaveBeenCalled()
    await shown(host, 'atomic')
    expect(host.callbacks.onShipShown).toHaveBeenCalledExactlyOnceWith('atomic')
    expect(host.cockpit).not.toBe(oldCockpit)
    expect(host.cockpitScene.children).toContain(host.cockpit)
    expect(host.cockpitScene.children).toContain(host.ship)
    expect(host.cockpitScene.children).not.toContain(oldCockpit)
    expect(host.cockpitScene.children).not.toContain(oldShip)
    expect(spies.length).toBeGreaterThan(0)
    for (const spy of spies) expect(spy).toHaveBeenCalled()
  })

  it('keeps the current models for the same id and falls back to the Kestrel for unknown ids', async () => {
    const host = swapHost()
    const cockpit = host.cockpit
    host.setShipModel(undefined)
    host.setShipModel('kestrel')
    await Promise.resolve()
    expect(host.cockpit).toBe(cockpit)
    host.setShipModel('atomic')
    await shown(host, 'atomic')
    host.setShipModel('retired-ship')
    await shown(host, 'kestrel')
    expect(loadShipModel).toHaveBeenCalledTimes(2)
  })

  it('discards a load that a newer pick overtook', async () => {
    const host = swapHost()
    let finish: (group: Group) => void = () => {}
    vi.mocked(loadShipModel).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    host.setShipModel('voyager')
    host.setShipModel('needle')
    await shown(host, 'needle')
    const late = new Group()
    late.add(new Mesh(undefined, new MeshBasicMaterial()))
    const [spy] = disposals(late)
    finish(late)
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())
    expect(host.shipSwap.current).toBe('needle')
    expect(host.cockpitScene.children).not.toContain(late)
    expect(host.callbacks.onShipShown.mock.calls).toEqual([['needle']])
  })

  it('reports a failed load once and keeps flying the current ship', async () => {
    const host = swapHost()
    const ship = host.ship
    vi.mocked(loadShipModel).mockRejectedValueOnce(new Error('Could not load the Voyager model: HTTP 404'))
    host.setShipModel('voyager')
    await vi.waitFor(() => expect(host.callbacks.onShipFailed).toHaveBeenCalledWith('voyager', 'kestrel', 'Could not load the Voyager model: HTTP 404'))
    host.setShipModel('voyager')
    await Promise.resolve()
    expect(loadShipModel).toHaveBeenCalledTimes(1)
    expect(host.ship).toBe(ship)
    expect(host.shipSwap.current).toBe('kestrel')
    expect(host.callbacks.onShipShown).not.toHaveBeenCalled()
  })

  it('builds a NASA exterior\'s sun occluder before it goes on screen', async () => {
    const host = swapHost()
    const group = new Group()
    group.add(new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial()))
    vi.mocked(loadShipModel).mockResolvedValueOnce(group)
    const occluder = vi.mocked(shipOccluder)
    host.setShipModel('voyager')
    await shown(host, 'voyager')
    expect(occluder).toHaveBeenCalledWith(group)
    expect(occluder.mock.invocationCallOrder[0]).toBeLessThan(host.callbacks.onShipShown.mock.invocationCallOrder[0]!)
  })

  it('drives the instruments of the newly selected cockpit', async () => {
    const host = swapHost()
    host.setShipModel('atomic')
    await shown(host, 'atomic')
    host.drawShip(snapshot, pose, options())
    expect(updateCockpit).toHaveBeenLastCalledWith(host.cockpit, expect.objectContaining({ targetName: 'Moon' }))
  })
})
