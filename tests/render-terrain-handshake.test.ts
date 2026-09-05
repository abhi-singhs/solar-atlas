import { describe, expect, it, vi } from 'vitest'
import { SolarRenderer } from '../src/render/SolarRenderer'
import type { Vec3 } from '../src/contracts'

interface Harness {
  assets: { get: ReturnType<typeof vi.fn> }
  terrain: {
    prepareLanding: ReturnType<typeof vi.fn>
    getActivePatch: ReturnType<typeof vi.fn>
    activate: ReturnType<typeof vi.fn>
  }
  terrainErrors: Set<string>
  terrainPatches: Map<string, { state: { revision: number } }>
  getVisual: ReturnType<typeof vi.fn>
  syncTerrain: ReturnType<typeof vi.fn>
  prepareLanding(id: string, direction: Vec3): void
}

function harness(): Harness {
  const host: Harness = Object.assign(Object.create(SolarRenderer.prototype), {
    assets: { get: vi.fn(() => ({ id: 'bennu' })) },
    terrain: { prepareLanding: vi.fn(), getActivePatch: vi.fn(() => ({ bodyId: 'bennu', revision: 7 })),
      activate: vi.fn() },
    terrainErrors: new Set<string>(), terrainPatches: new Map(),
    getVisual: vi.fn(() => ({ id: 'visual' })), syncTerrain: vi.fn(),
  })
  return host
}

describe('renderer frozen terrain handshake', () => {
  it('uses intrinsic terrain preparation before rendering and never substitutes activate', () => {
    const host = harness()
    host.syncTerrain.mockImplementation(() => {
      expect(host.terrain.prepareLanding).toHaveBeenCalledWith('bennu', [1, 0, 0])
      host.terrainPatches.set('bennu', { state: { revision: 7 } })
    })
    host.prepareLanding('bennu', [1, 0, 0])
    expect(host.terrain.activate).not.toHaveBeenCalled()
    expect(host.getVisual).toHaveBeenCalledWith({ id: 'bennu' }, true)
    expect(host.terrainPatches.get('bennu')?.state.revision).toBe(7)
  })

  it('rejects missing source meshes before activating a reconstructed patch', () => {
    const host = harness()
    host.assets.get.mockReturnValue(undefined)
    expect(() => host.prepareLanding('bennu', [1, 0, 0])).toThrow('ensureBody')
    expect(host.terrain.prepareLanding).not.toHaveBeenCalled()
  })

  it('does not return a ready landing site if rendering failed to register the prepared revision', () => {
    const host = harness()
    expect(() => host.prepareLanding('bennu', [1, 0, 0])).toThrow('could not be prepared')
  })
})
