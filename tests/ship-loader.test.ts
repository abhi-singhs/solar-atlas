import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { disposeTree } from '../src/cockpit/parts'
import { clearShipCache, loadShip } from '../src/cockpit/shipLoader'
import { shipDesign } from '../src/cockpit/ships'

const built: THREE.Object3D[] = []
afterEach(() => {
  for (const object of built.splice(0)) disposeTree(object)
  clearShipCache()
})

async function bytes(path: string) {
  const data = await readFile(`public/${path}`)
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}
const meshes = (root: THREE.Object3D) => {
  const found: THREE.Mesh[] = []
  root.traverse(object => { if (object instanceof THREE.Mesh) found.push(object) })
  return found
}

describe('ship loader', () => {
  it('fetches a NASA model once per session and parses an independent copy for every call', async () => {
    const fetchModel = vi.fn(bytes)
    const design = shipDesign('voyager')
    const first = await loadShip(design, { fetchModel, skipTextures: true })
    const second = await loadShip(design, { fetchModel, skipTextures: true })
    built.push(first, second)
    expect(fetchModel).toHaveBeenCalledTimes(1)
    expect(fetchModel).toHaveBeenCalledWith('assets/ships/voyager.glb')
    expect(first.userData).toMatchObject({ units: 'meters', forward: '-Z', origin: 'pilot eye', reconstructed: false, source: 'Voyager Probe (B)' })
    const a = meshes(first), b = meshes(second)
    expect(a.length).toBeGreaterThan(0)
    expect(a.length).toBe(b.length)
    a.forEach((mesh, i) => {
      expect(mesh.geometry).not.toBe(b[i]!.geometry)
      expect(mesh.material).not.toBe(b[i]!.material)
    })
  })

  it('names the ship in load errors and retries a failed fetch on the next call', async () => {
    const design = shipDesign('hubble')
    const failing = vi.fn(() => Promise.reject(new Error('HTTP 404 for assets/ships/hubble.glb')))
    await expect(loadShip(design, { fetchModel: failing })).rejects.toThrow('Could not load the Hubble model: HTTP 404 for assets/ships/hubble.glb')
    const working = vi.fn(bytes)
    built.push(await loadShip(design, { fetchModel: working, skipTextures: true }))
    expect(working).toHaveBeenCalledTimes(1)
  })

  it('rejects bytes that are not a GLB', async () => {
    const design = shipDesign('juno')
    const junk = vi.fn(() => Promise.resolve(new TextEncoder().encode('not a model').buffer as ArrayBuffer))
    await expect(loadShip(design, { fetchModel: junk })).rejects.toThrow(/^Could not load the Juno model: /)
  })

  it('builds original ships in code without fetching', async () => {
    const fetchModel = vi.fn(bytes)
    const ship = await loadShip(shipDesign('kestrel'), { fetchModel })
    built.push(ship)
    expect(fetchModel).not.toHaveBeenCalled()
    expect(meshes(ship).length).toBeGreaterThan(0)
  })
})
