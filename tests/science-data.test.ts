import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { parseStates } from '../src/data/binary'
import { dataBaseUrl, loadDatasetPayload } from '../src/data/load'
import { sha256, sha256Portable } from '../src/data/sha256'
import type { DatasetPayload, PackedTrack } from '../src/data/types'
import { validateCatalog, validateManifest, validateOrientations, validateRingPoles, validateTime } from '../src/data/validate'
import { createDataset, loadDataset } from '../src/simulation/dataset'
import { evaluateTrack } from '../src/simulation/hermite'

const root = new URL('../public/data/', import.meta.url)
const read = (name: string) => readFileSync(new URL(name, root))
const json = (name: string) => JSON.parse(read(name).toString())
const arrayBuffer = (value: Uint8Array): ArrayBuffer => value.buffer.slice(
  value.byteOffset, value.byteOffset + value.byteLength,
) as ArrayBuffer
const binary = arrayBuffer(read('states.bin'))
const bodies = validateCatalog(json('catalog.json'))
const bodyIds = bodies.map(body => body.id)
let payload: DatasetPayload

beforeAll(() => {
  payload = {
    bodies,
    manifest: validateManifest(json('dataset.json')),
    ephemeris: parseStates(binary, bodyIds),
    orientations: validateOrientations(json('orientations.json'), bodies),
    ringPoles: validateRingPoles(json('ring-poles.json')),
    time: validateTime(json('time.json')),
  }
})

afterEach(() => vi.unstubAllGlobals())

function nextFloat(value: number, direction: 1 | -1): number {
  const data = new DataView(new ArrayBuffer(8))
  data.setFloat64(0, value)
  data.setBigUint64(0, data.getBigUint64(0) + BigInt(direction))
  return data.getFloat64(0)
}

describe('strict packed scientific data', () => {
  it('retains every binary64 component in every one of the 72 records', () => {
    const view = new DataView(binary)
    let offset = 32
    let total = 0
    for (let r = 0; r < 72; r++) {
      const length = view.getUint16(offset, true)
      offset += 2
      const id = new TextDecoder().decode(new Uint8Array(binary, offset, length))
      offset += length
      const count = view.getUint32(offset, true)
      offset += 4
      const track = payload.ephemeris.tracks[id]
      expect(track.count).toBe(count)
      expect(track.samples).toBeInstanceOf(Float64Array)
      for (let i = 0; i < count * 7; i++) {
        if (!Object.is(view.getFloat64(offset, true), track.samples[i])) {
          throw new Error(`Binary64 parity mismatch ${id} component ${i}`)
        }
        offset += 8
      }
      total += count
    }
    expect(offset).toBe(binary.byteLength)
    expect(total).toBe(657072)
    expect(payload.ephemeris.tracks['phobos@refined'].count).toBe(35041)
    expect(payload.ephemeris.tracks.phobos.count).toBe(8761)
  })

  it.each([
    ['bad magic', 0, 8, 0],
    ['bad version', 8, 4, 2],
    ['bad record count', 12, 4, 71],
    ['nonfinite boundary', 16, 8, NaN],
    ['missing year', 24, 8, 2461288.5],
    ['empty identifier', 32, 2, 0],
    ['oversized identifier', 32, 2, 65],
    ['invalid identifier', 34, 1, 255],
    ['unknown identifier', 34, 1, 120],
    ['too many samples', 37, 4, 40001],
    ['wrong sample count', 37, 4, 8760],
    ['rounding gap too large', 41, 8, 2461288.500801],
    ['nonfinite position', 49, 8, Infinity],
    ['nonfinite velocity', 73, 8, NaN],
    ['repeated epoch', 97, 8, 2461288.500800725],
    ['reversed epoch', 97, 8, 2461288.4],
    ['missing hourly sample', 97, 8, 2461288.7],
  ])('rejects %s', (_label, offset, bytes, value) => {
    const copy = binary.slice(0)
    const view = new DataView(copy)
    if (bytes === 8) view.setFloat64(offset as number, value as number, true)
    else if (bytes === 4) view.setUint32(offset as number, value as number, true)
    else if (bytes === 2) view.setUint16(offset as number, value as number, true)
    else view.setUint8(offset as number, value as number)
    expect(() => parseStates(copy, bodyIds)).toThrow()
  })

  it('rejects truncated data, trailing bytes, duplicate IDs, and absent refinement', () => {
    for (const length of [0, 31, 33, 35, binary.byteLength - 1]) {
      expect(() => parseStates(binary.slice(0, length), bodyIds)).toThrow()
    }
    const trailing = new Uint8Array(binary.byteLength + 1)
    trailing.set(new Uint8Array(binary))
    expect(() => parseStates(trailing.buffer, bodyIds)).toThrow()
    const copy = binary.slice(0)
    const bytes = new Uint8Array(copy)
    const refinedHeader = copy.byteLength - 35041 * 56 - 4 - 'phobos@refined'.length
    bytes[refinedHeader] = 120
    expect(() => parseStates(copy, bodyIds)).toThrow()
    expect(() => parseStates(binary, bodyIds.map(() => 'sun'))).toThrow()
    const duplicate = binary.slice(0)
    let offset = 32
    const view = new DataView(duplicate)
    const headers: { id: string; at: number }[] = []
    for (let i = 0; i < 72; i++) {
      const n = view.getUint16(offset, true)
      offset += 2
      headers.push({ id: new TextDecoder().decode(new Uint8Array(duplicate, offset, n)), at: offset })
      offset += n
      const count = view.getUint32(offset, true)
      offset += 4 + count * 56
    }
    const mars = headers.find(entry => entry.id === 'mars')!
    new Uint8Array(duplicate, mars.at, 4).set(new TextEncoder().encode('moon'))
    expect(() => parseStates(duplicate, bodyIds)).toThrow()
  })

  it('rejects a missing final endpoint and oversized or nonlocal manifest entries', () => {
    const copy = binary.slice(0)
    new DataView(copy).setFloat64(41 + 8760 * 56, payload.ephemeris.lastJd - 0.001, true)
    expect(() => parseStates(copy, bodyIds)).toThrow(/endpoint/)
    for (const key of ['frame', 'units', 'time_scale', 'corrections', 'reference_plane']) {
      expect(() => validateManifest({ ...payload.manifest, [key]: 'wrong' })).toThrow()
    }
    expect(() => validateManifest({ ...payload.manifest, end_utc: '2027-09-04T00:00:00Z' })).toThrow()
    const files = { ...payload.manifest.files, '../bad.json': payload.manifest.files['catalog.json'] }
    expect(() => validateManifest({ ...payload.manifest, files })).toThrow()
    expect(() => validateManifest({ ...payload.manifest, files: {
      ...payload.manifest.files, 'states.bin': { bytes: 70_000_000, sha256: '0'.repeat(64) },
    } })).toThrow()
  })
})

describe('actual-epoch Hermite evaluation', () => {
  it('uses exact source samples and actual-epoch interpolation at declared endpoints', () => {
    const data = createDataset(payload)
    for (const jd of [data.firstJd, data.lastJd]) {
      const snapshot = data.evaluate(jd)
      expect(Object.keys(snapshot.states)).toHaveLength(71)
      for (const body of bodies) {
        const track = payload.ephemeris.tracks[body.id === 'phobos' ? 'phobos@refined' : body.id]
        const offset = jd === data.firstJd ? 0 : (track.count - 1) * 7
        const state = snapshot.states[body.id]
        const position = Array.from(track.samples.slice(offset + 1, offset + 4))
        const velocity = Array.from(track.samples.slice(offset + 4, offset + 7))
        if (jd <= track.samples[0] || jd >= track.samples[(track.count - 1) * 7]) {
          expect(state.position).toEqual(position)
          expect(state.velocity).toEqual(velocity)
        } else {
          // The declared last epoch is 80 microseconds before its printed sample, inside the curve.
          const seconds = (jd - track.samples[offset]) * 86400
          position.forEach((value, axis) => {
            expect(state.position[axis] - value).toBeCloseTo(velocity[axis] * seconds, 5)
            expect(state.velocity[axis]).toBeCloseTo(velocity[axis], 6)
          })
        }
      }
    }
    const track = payload.ephemeris.tracks.earth
    const index = 125 * 7
    expect(evaluateTrack(track, track.samples[index]).position).toEqual(Array.from(track.samples.slice(index + 1, index + 4)))
    for (const jd of [NaN, Infinity, nextFloat(data.firstJd, -1), nextFloat(data.lastJd, 1)]) {
      expect(() => data.evaluate(jd)).toThrow(RangeError)
    }
  })

  it('keeps an unbound track strict and binds rounding gaps only through validated declared coverage', () => {
    const original = payload.ephemeris.tracks.earth
    const first = original.samples[0]
    const last = original.samples[(original.count - 1) * 7]
    const unbound = { ...original, firstJd: first, lastJd: last }
    expect(() => evaluateTrack(unbound, nextFloat(first, -1))).toThrow()
    const rounded = binary.slice(0)
    const view = new DataView(rounded)
    view.setFloat64(16, nextFloat(first, -1), true)
    view.setFloat64(24, nextFloat(last, 1), true)
    const bound = parseStates(rounded, bodyIds)
    expect(evaluateTrack(bound.tracks.earth, bound.firstJd)).toEqual(evaluateTrack(unbound, first))
    expect(evaluateTrack(bound.tracks.earth, bound.lastJd)).toEqual(evaluateTrack(unbound, last))
    expect(() => evaluateTrack(bound.tracks.earth, nextFloat(bound.firstJd, -1))).toThrow()
  })

  it('reproduces a cubic and its derivative on an irregular grid', () => {
    const epochs = [2451545, 2451545 + 2 / 86400, 2451545 + 7 / 86400, 2451545 + 18 / 86400]
    const p = (s: number) => 7 + 2 * s - 0.05 * s * s + 0.003 * s ** 3
    const v = (s: number) => 2 - 0.1 * s + 0.009 * s * s
    const samples = new Float64Array(epochs.flatMap(jd => {
      const s = (jd - epochs[0]) * 86400
      return [jd, p(s), -p(s), p(s) * 2, v(s), -v(s), v(s) * 2]
    }))
    const track: PackedTrack = {
      id: 'cubic', samples, count: epochs.length, firstJd: epochs[0], lastJd: epochs.at(-1)!,
    }
    for (const seconds of [0, 1, 3, 6, 9, 15]) {
      const jd = epochs[0] + seconds / 86400
      const t = (jd - epochs[0]) * 86400
      const state = evaluateTrack(track, jd)
      expect(state.position[0]).toBeCloseTo(p(t), 10)
      expect(state.velocity[0]).toBeCloseTo(v(t), 10)
      expect(state.position[1]).toBeCloseTo(-p(t), 10)
      expect(state.velocity[2]).toBeCloseTo(2 * v(t), 10)
    }
  })

  it('always selects refined Phobos and returns physical cache-limited trajectories', () => {
    const data = createDataset(payload)
    const refined = payload.ephemeris.tracks['phobos@refined']
    const jd = refined.samples[7]
    expect(data.evaluate(jd).states.phobos.position).toEqual(Array.from(refined.samples.slice(8, 11)))
    const hourly = evaluateTrack(payload.ephemeris.tracks.phobos, jd).position
    expect(Math.hypot(...hourly.map((value, i) => value - refined.samples[8 + i]))).toBeGreaterThan(0.001)
    for (const id of ['earth', 'phobos', 'sedna']) {
      const points = data.trajectory(id)
      expect(points).toHaveLength(512)
      expect(points[0]).toEqual(data.evaluate(data.firstJd).states[id].position)
      expect(points.at(-1)).toEqual(data.evaluate(data.lastJd).states[id].position)
      expect(points[0]).not.toEqual(points.at(-1))
      expect(data.trajectory(id, 2)).toHaveLength(2)
    }
    expect(data.trajectory('earth', 10000)).toHaveLength(8761)
    for (const count of [0, 1, -1, 2.5, NaN, Infinity, 40001]) {
      expect(() => data.trajectory('earth', count)).toThrow()
    }
    expect(() => data.trajectory('missing')).toThrow()
    expect(data.utcToJd('2026-09-05T00:00:00Z')).toBe(data.firstJd)
    expect(data.jdToUtc(data.lastJd)).toBe('2027-09-05T00:00:00.000Z')
    expect(() => data.utcToJd('2026-09-04T23:59:59.999Z')).toThrow()
  })
})

describe('local loading and corruption failures', () => {
  function localFetch(mutate?: (name: string, bytes: Buffer) => Buffer): ReturnType<typeof vi.fn> {
    return vi.fn(async (url: URL, options?: RequestInit) => {
      expect(url.origin).toBe('http://localhost:4173')
      expect(url.pathname.startsWith('/nested/app/data/')).toBe(true)
      expect(options?.redirect).toBe('error')
      const name = url.pathname.split('/').at(-1)!
      const bytes = read(name)
      return new Response(arrayBuffer(mutate ? mutate(name, bytes) : bytes))
    })
  }

  it('uses nested BASE_URL paths and verifies all static files without remote requests', async () => {
    expect(dataBaseUrl('/nested/app/', 'http://localhost:4173/page')).toBe('http://localhost:4173/nested/app/data/')
    expect(dataBaseUrl('./', 'http://localhost:4173/nested/app/')).toBe('http://localhost:4173/nested/app/data/')
    expect(() => dataBaseUrl('https://example.com/', 'http://localhost/')).toThrow()
    const fetcher = localFetch()
    vi.stubGlobal('fetch', fetcher)
    const progress: string[] = []
    const loaded = await loadDatasetPayload('http://localhost:4173/nested/app/data/', message => progress.push(message))
    expect(loaded.bodies).toEqual(json('catalog.json').bodies)
    expect(loaded.orientations).toEqual(json('orientations.json'))
    expect(fetcher).toHaveBeenCalledTimes(Object.keys(payload.manifest.files).length + 1)
    expect(progress.some(message => message.includes('37 seconds'))).toBe(true)
  })

  it('rejects changed bytes and HTTP failures instead of returning a partial dataset', async () => {
    vi.stubGlobal('fetch', localFetch((name, bytes) => {
      if (name === 'catalog.json') bytes[10] ^= 1
      return bytes
    }))
    await expect(loadDatasetPayload('http://localhost:4173/nested/app/data/')).rejects.toThrow(/SHA-256/)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    await expect(loadDatasetPayload('http://localhost:4173/nested/app/data/')).rejects.toThrow(/HTTP 404/)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { headers: { 'Content-Length': '90000000' } })))
    await expect(loadDatasetPayload('http://localhost:4173/nested/app/data/')).rejects.toThrow(/Oversized/)
  })

  it('reports worker unavailability and rejects worker launch or parse failures without silent fallback', async () => {
    vi.stubGlobal('document', { baseURI: 'http://localhost:4173/nested/app/' })
    vi.stubGlobal('Worker', undefined)
    const progress: string[] = []
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })))
    await expect(loadDataset(message => progress.push(message))).rejects.toThrow(/503/)
    expect(progress[0]).toContain('Web Workers unavailable')
    class FailedWorker {
      constructor() { throw new Error('CSP blocked worker') }
    }
    vi.stubGlobal('Worker', FailedWorker)
    await expect(loadDataset()).rejects.toThrow(/No fallback dataset/)
    const fetcher = vi.fn()
    const terminate = vi.fn()
    class ParseFailureWorker {
      onmessage?: (event: { data: { type: string; message: string } }) => void
      terminate = terminate
      postMessage() {
        queueMicrotask(() => this.onmessage?.({ data: { type: 'error', message: 'bad header' } }))
      }
    }
    vi.stubGlobal('fetch', fetcher)
    vi.stubGlobal('Worker', ParseFailureWorker)
    await expect(loadDataset()).rejects.toThrow(/bad header/)
    expect(terminate).toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses verified worker results and terminates the worker after transferred data arrives', async () => {
    vi.stubGlobal('document', { baseURI: 'http://localhost:4173/' })
    const terminate = vi.fn()
    class ReadyWorker {
      onmessage?: (event: { data: unknown }) => void
      terminate = terminate
      postMessage(value: { baseUrl: string }) {
        expect(value.baseUrl).toBe('http://localhost:4173/data/')
        queueMicrotask(() => this.onmessage?.({ data: { type: 'ready', payload } }))
      }
    }
    vi.stubGlobal('Worker', ReadyWorker)
    const result = await loadDataset()
    expect(result.evaluate(result.firstJd).states.earth.position).toEqual(createDataset(payload).evaluate(result.firstJd).states.earth.position)
    expect(terminate).toHaveBeenCalledOnce()
    const original = payload.ephemeris.tracks.earth.samples.slice()
    const cloned = structuredClone(original, { transfer: [original.buffer] })
    expect(original.byteLength).toBe(0)
    expect(cloned).toEqual(payload.ephemeris.tracks.earth.samples)
  })

  it('checks portable SHA-256 against native digests including padding boundaries and full data', async () => {
    for (const length of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1024]) {
      const bytes = Uint8Array.from({ length }, (_, i) => i % 251)
      const expected = createHash('sha256').update(bytes).digest('hex')
      expect(sha256Portable(bytes.buffer)).toBe(expected)
      expect(await sha256(bytes.buffer)).toBe(expected)
    }
    expect(sha256Portable(binary)).toBe(payload.manifest.files['states.bin'].sha256)
  })
})
