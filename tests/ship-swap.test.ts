import { describe, expect, it, vi } from 'vitest'
import { ShipSwap } from '../src/cockpit/swap'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup() {
  const loads = new Map<string, ReturnType<typeof deferred<string>>>()
  const load = vi.fn((id: string) => {
    const pending = deferred<string>()
    loads.set(id, pending)
    return pending.promise
  })
  const apply = vi.fn()
  const discard = vi.fn()
  const fail = vi.fn()
  const swap = new ShipSwap<string>('kestrel', load, apply, discard, fail)
  return { swap, loads, load, apply, discard, fail }
}
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('ShipSwap', () => {
  it('loads a new ship once, however often the frame loop asks, and applies it', async () => {
    const { swap, loads, load, apply } = setup()
    swap.request('voyager')
    swap.request('voyager')
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    expect(swap.loading).toBe('voyager')
    expect(swap.current).toBe('kestrel')
    loads.get('voyager')!.resolve('voyager-model')
    await settle()
    expect(apply).toHaveBeenCalledWith('voyager', 'voyager-model')
    expect(swap.current).toBe('voyager')
    expect(swap.loading).toBeUndefined()
  })

  it('discards a result that a newer request overtook', async () => {
    const { swap, loads, apply, discard } = setup()
    swap.request('voyager')
    await settle()
    swap.request('hubble')
    await settle()
    loads.get('hubble')!.resolve('hubble-model')
    loads.get('voyager')!.resolve('voyager-model')
    await settle()
    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('hubble', 'hubble-model')
    expect(discard).toHaveBeenCalledWith('voyager-model')
    expect(swap.current).toBe('hubble')
  })

  it('cancels the pending load when the shown ship is requested again', async () => {
    const { swap, loads, apply, discard } = setup()
    swap.request('voyager')
    await settle()
    swap.request('kestrel')
    expect(swap.loading).toBeUndefined()
    loads.get('voyager')!.resolve('voyager-model')
    await settle()
    expect(apply).not.toHaveBeenCalled()
    expect(discard).toHaveBeenCalledWith('voyager-model')
    expect(swap.current).toBe('kestrel')
  })

  it('reports a failure once and retries only after another ship is requested', async () => {
    const { swap, loads, load, fail } = setup()
    swap.request('voyager')
    await settle()
    const error = new Error('HTTP 404')
    loads.get('voyager')!.reject(error)
    await settle()
    expect(fail).toHaveBeenCalledWith('voyager', error)
    swap.request('voyager')
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    swap.request('kestrel')
    swap.request('voyager')
    await settle()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('treats a loader that throws synchronously as a failed load', async () => {
    const fail = vi.fn()
    const swap = new ShipSwap<string>('kestrel', () => { throw new Error('boom') }, vi.fn(), vi.fn(), fail)
    swap.request('voyager')
    await settle()
    expect(fail).toHaveBeenCalledWith('voyager', expect.objectContaining({ message: 'boom' }))
    expect(swap.current).toBe('kestrel')
  })

  it('drops late results after cancel', async () => {
    const { swap, loads, apply, discard, fail } = setup()
    swap.request('voyager')
    await settle()
    swap.cancel()
    loads.get('voyager')!.resolve('voyager-model')
    await settle()
    expect(apply).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
    expect(discard).toHaveBeenCalledWith('voyager-model')
  })
})
