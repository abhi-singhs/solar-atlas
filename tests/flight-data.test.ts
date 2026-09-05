import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Mesh, Quaternion, Vector3 } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { parseStates } from '../src/data/binary'
import { validateCatalog, validateManifest, validateOrientations, validateRingPoles, validateTime } from '../src/data/validate'
import { createDataset } from '../src/simulation/dataset'
import { FlightController } from '../src/flight/FlightController'
import { createFlightInput } from '../src/input/controls'
import { Observer } from '../src/navigation/observer'
import { restoreSourceGeometry, SourceSurface } from '../src/render/assets'
import type { AssetManifest } from '../src/render/assets'
import type { Dataset, SurfaceProvider } from '../src/contracts'

const root = new URL('../public/', import.meta.url)
const read = (name: string) => readFileSync(new URL(name, root))
const json = (name: string) => JSON.parse(read(name).toString())
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
let dataset: Dataset
const sourceMeshes = new Map<string, SourceSurface>()
const surface: SurfaceProvider = { sample: (id, direction) => sourceMeshes.get(id)?.sample(direction) ?? null }

beforeAll(async () => {
  const bodies = validateCatalog(json('data/catalog.json'))
  dataset = createDataset({
    bodies,
    manifest: validateManifest(json('data/dataset.json')),
    ephemeris: parseStates(toArrayBuffer(read('data/states.bin')), bodies.map(body => body.id)),
    orientations: validateOrientations(json('data/orientations.json'), bodies),
    ringPoles: validateRingPoles(json('data/ring-poles.json')),
    time: validateTime(json('data/time.json')),
  })
  const manifest = json('assets/manifest.json') as AssetManifest
  for (const id of ['earth', 'moon']) {
    const record = manifest.bodies[id]!
    const gltf = await new GLTFLoader().parseAsync(toArrayBuffer(read(record.mesh)), '')
    const meshes: Mesh[] = []
    gltf.scene.traverse(object => { if (object instanceof Mesh) meshes.push(object) })
    expect(meshes).toHaveLength(1)
    const source = restoreSourceGeometry(meshes[0]!.geometry)
    sourceMeshes.set(id, new SourceSurface(source, record.normalization_radius_km))
    meshes[0]!.geometry.dispose()
  }
}, 30000)

afterAll(() => {
  for (const mesh of sourceMeshes.values()) {
    mesh.dispose()
    mesh.geometry.dispose()
  }
  sourceMeshes.clear()
})

describe('assisted flight with retained scientific states and source meshes', () => {
  it('uses full source mesh collision radii in physical kilometers', () => {
    expect(Math.hypot(...surface.sample('earth', [1, 0, 0])!.point)).toBeGreaterThan(6300)
    expect(Math.hypot(...surface.sample('earth', [1, 0, 0])!.point)).toBeLessThan(6400)
    expect(Math.hypot(...surface.sample('moon', [1, 0, 0])!.point)).toBeGreaterThan(1700)
  })

  it('completes a 1000c Earth-to-Moon transfer from the initial Sun-facing observer instead of stopping at departure', () => {
    const start = dataset.firstJd
    let snapshot = dataset.evaluate(start)
    const observer = new Observer(dataset.bodies)
    observer.focus('earth', snapshot)
    const flight = new FlightController(dataset.bodies, surface)
    flight.enter(snapshot, 'earth', observer.pose(snapshot))
    flight.setWarp(true)
    flight.setThrottle(1000)
    flight.transfer('moon', snapshot)
    const input = createFlightInput()
    let elapsed = 0
    let stops = 0
    for (; elapsed < 90 && flight.telemetry(snapshot).mode !== 'free'; elapsed += 1 / 60) {
      const previousJd = snapshot.jdTdb
      snapshot = dataset.evaluate(start + (elapsed + 1 / 60) / 86400)
      flight.update((snapshot.jdTdb - previousJd) * 86400, snapshot, input, 1 / 60)
      if (flight.telemetry(snapshot).message.includes('safety stop')) stops++
      const earthDistance = new Vector3(...flight.pose().position).distanceTo(new Vector3(...snapshot.states.earth!.position))
      expect(earthDistance).toBeGreaterThan(6370)
    }
    const telemetry = flight.telemetry(snapshot)
    expect(telemetry.mode, JSON.stringify({ elapsed, stops, ...telemetry })).toBe('free')
    expect(telemetry.referenceId).toBe('moon')
    expect(telemetry.message).toContain('Arrived')
    expect(telemetry.separationKm).toBeGreaterThan(1737)
    expect(telemetry.separationKm).toBeLessThan(1900)
    expect(stops).toBe(0)
  }, 30000)

  it('completes transfer without crossing Earth when a retained Moon phase obstructs the direct departure line', () => {
    const observer = new Observer(dataset.bodies)
    let start: number | undefined
    let closest = Number.POSITIVE_INFINITY
    for (let day = 0; day < 35; day += 0.25) {
      const snapshot = dataset.evaluate(dataset.firstJd + day)
      observer.focus('earth', snapshot)
      const position = new Vector3(...observer.pose(snapshot).position)
      const delta = new Vector3(...snapshot.states.moon!.position).sub(position)
      const relative = position.clone().sub(new Vector3(...snapshot.states.earth!.position))
      const fraction = Math.max(0, Math.min(1, -relative.dot(delta) / delta.lengthSq()))
      const missDistance = relative.addScaledVector(delta, fraction).length()
      if (missDistance < Math.min(6300, closest)) {
        start = snapshot.jdTdb
        closest = missDistance
      }
    }
    expect(start).toBeDefined()
    expect(closest).toBeLessThan(6300)
    let snapshot = dataset.evaluate(start!)
    observer.focus('earth', snapshot)
    const flight = new FlightController(dataset.bodies, surface)
    flight.enter(snapshot, 'earth', observer.pose(snapshot))
    flight.setWarp(true)
    flight.setThrottle(1000)
    flight.transfer('moon', snapshot)
    let elapsed = 0
    let stopped = false
    let minimumClearance = Number.POSITIVE_INFINITY
    for (; elapsed < 90 && flight.telemetry(snapshot).mode !== 'free'; elapsed += 1 / 60) {
      const previousJd = snapshot.jdTdb
      snapshot = dataset.evaluate(start! + (elapsed + 1 / 60) / 86400)
      flight.update((snapshot.jdTdb - previousJd) * 86400, snapshot, createFlightInput(), 1 / 60)
      stopped ||= flight.telemetry(snapshot).message.includes('safety stop')
      const local = new Vector3(...flight.pose().position).sub(new Vector3(...snapshot.states.earth!.position))
        .applyQuaternion(new Quaternion(...snapshot.states.earth!.rotation).invert())
      const ground = surface.sample('earth', local.clone().normalize().toArray())!
      minimumClearance = Math.min(minimumClearance, local.length() - Math.hypot(...ground.point))
    }
    const telemetry = flight.telemetry(snapshot)
    expect(telemetry.mode, JSON.stringify({ start, elapsed, stopped, minimumClearance, ...telemetry })).toBe('free')
    expect(telemetry.referenceId).toBe('moon')
    expect(telemetry.separationKm).toBeLessThan(1900)
    expect(stopped).toBe(false)
    expect(minimumClearance).toBeGreaterThan(0)
  }, 30000)
})
