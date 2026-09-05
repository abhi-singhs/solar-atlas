import { MAX_DATA_BYTES, parseStates } from './binary'
import { sha256 } from './sha256'
import type { DatasetPayload } from './types'
import {
  validateCatalog, validateManifest, validateOrientations, validateRingPoles, validateTime,
} from './validate'
import { createTimeConverter } from '../simulation/time'

const decoder = new TextDecoder('utf-8', { fatal: true })

export function dataBaseUrl(base: string, documentUrl: string): string {
  const document = new URL(documentUrl)
  const root = new URL(base, document)
  if (root.origin !== document.origin || !['http:', 'https:'].includes(root.protocol)
    || root.username || root.password || root.search || root.hash) {
    throw new Error('Dataset base must be a local static HTTP directory')
  }
  if (!root.pathname.endsWith('/')) root.pathname += '/'
  return new URL('data/', root).href
}

async function fetchBounded(url: URL, maximumBytes: number): Promise<ArrayBuffer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120000)
  try {
    const response = await fetch(url, {
      redirect: 'error', credentials: 'same-origin', signal: controller.signal,
    })
    if (!response.ok) throw new Error(`${url.pathname} returned HTTP ${response.status}`)
    if (Number(response.headers.get('content-length')) > maximumBytes) {
      throw new Error(`Oversized dataset response ${url.pathname}`)
    }
    if (!response.body) throw new Error(`Empty dataset response ${url.pathname}`)
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > maximumBytes) {
          await reader.cancel()
          throw new Error(`Oversized dataset response ${url.pathname}`)
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes.buffer
  } finally {
    controller.abort()
    clearTimeout(timer)
  }
}

function json(buffer: ArrayBuffer, name: string): unknown {
  try {
    return JSON.parse(decoder.decode(buffer))
  } catch (error) {
    throw new Error(`Invalid UTF-8 JSON in ${name}`, { cause: error })
  }
}

export async function loadDatasetPayload(
  baseUrl: string, onProgress: (message: string) => void = () => {},
): Promise<DatasetPayload> {
  const base = new URL(baseUrl)
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password
    || base.search || base.hash || !base.pathname.endsWith('/')
    || (typeof location !== 'undefined' && base.origin !== location.origin)) {
    throw new Error('Dataset files must resolve to the same-origin static directory')
  }
  onProgress('Loading local scientific manifest')
  const manifest = validateManifest(json(await fetchBounded(new URL('dataset.json', base), 1024 * 1024), 'dataset.json'))
  if (!globalThis.crypto?.subtle) onProgress('Web Crypto unavailable; using built-in SHA-256 verification')
  const metadata: Record<string, unknown> = Object.create(null)
  const needed = new Set(['catalog.json', 'orientations.json', 'time.json', 'ring-poles.json'])
  const entries = Object.entries(manifest.files)
    .sort(([a], [b]) => Number(a === 'states.bin') - Number(b === 'states.bin') || a.localeCompare(b))
  let stateBytes: ArrayBuffer | undefined
  for (const [name, file] of entries) {
    onProgress(`Loading and verifying ${name}`)
    const raw = await fetchBounded(new URL(name, base), name === 'states.bin' ? MAX_DATA_BYTES : 2 * 1024 * 1024)
    if (raw.byteLength !== file.bytes) throw new Error(`Dataset byte count mismatch for ${name}`)
    if (await sha256(raw) !== file.sha256) throw new Error(`Dataset SHA-256 mismatch for ${name}`)
    if (needed.has(name)) metadata[name] = json(raw, name)
    if (name === 'states.bin') stateBytes = raw
  }
  if (!stateBytes) throw new Error('Missing required states.bin')
  const bodies = validateCatalog(metadata['catalog.json'])
  const orientations = validateOrientations(metadata['orientations.json'], bodies)
  const time = validateTime(metadata['time.json'])
  const ringPoles = validateRingPoles(metadata['ring-poles.json'])
  const converter = createTimeConverter(time)
  if (converter.utcToJd(manifest.start_utc) !== manifest.start_jd_tdb
    || converter.utcToJd(manifest.end_utc) !== manifest.end_jd_tdb) {
    throw new Error('Manifest UTC bounds do not match the pinned TDB conversion')
  }
  onProgress('Validating all 72 Float64 tracks, including refined Phobos')
  const ephemeris = parseStates(stateBytes, bodies.map(body => body.id))
  if (ephemeris.firstJd !== manifest.start_jd_tdb || ephemeris.lastJd !== manifest.end_jd_tdb) {
    throw new Error('Binary coverage differs from the manifest')
  }
  onProgress(time.warning)
  onProgress('All 71 bodies ready. Unknown rotation phases remain unconstrained.')
  return { manifest, bodies, ephemeris, orientations, time, ringPoles }
}
