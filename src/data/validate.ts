import type { Body } from '../contracts'
import { EPOCH_ROUNDING_DAYS, MAX_DATA_BYTES } from './binary'
import type { DatasetManifest, OrientationCatalog, RingPoles, TimeCoefficients } from './types'
import { parseUtcMilliseconds } from '../simulation/time'

export function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`)
  return value as Record<string, unknown>
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function numbers(value: unknown, length: number): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(finite)
}

export function validateManifest(value: unknown): DatasetManifest {
  const data = object(value, 'dataset manifest')
  const required: Record<string, unknown> = {
    schema_version: 1, body_count: 71, record_count: 72, frame: 'ICRF', reference_plane: 'FRAME',
    center_id: 0, units: 'KM-S', time_scale: 'TDB', corrections: 'NONE', geometric: true,
    phobos_refinement_required: true, epoch_rounding_tolerance_days: EPOCH_ROUNDING_DAYS,
  }
  for (const [key, expected] of Object.entries(required)) {
    if (data[key] !== expected) throw new Error(`Invalid dataset metadata ${key}`)
  }
  if (!finite(data.start_jd_tdb) || !finite(data.end_jd_tdb)
    || data.end_jd_tdb - data.start_jd_tdb <= 364 || data.end_jd_tdb - data.start_jd_tdb >= 367
    || typeof data.start_utc !== 'string' || typeof data.end_utc !== 'string') {
    throw new Error('Invalid dataset coverage')
  }
  const first = new Date(parseUtcMilliseconds(data.start_utc))
  const last = parseUtcMilliseconds(data.end_utc)
  const year = first.getUTCFullYear() + 1
  const day = first.getUTCMonth() === 1 && first.getUTCDate() === 29 ? 28 : first.getUTCDate()
  const anniversary = Date.UTC(year, first.getUTCMonth(), day, first.getUTCHours(),
    first.getUTCMinutes(), first.getUTCSeconds(), first.getUTCMilliseconds())
  if (last !== anniversary) throw new Error('Dataset must describe one calendar year')
  const files = object(data.files, 'manifest files')
  for (const name of ['states.bin', 'catalog.json', 'orientations.json', 'time.json', 'ring-poles.json',
    'asset_manifest.json', 'naif0012.tls', 'pck00011.tpc', 'sources.json', 'CREDITS.md', 'provenance.json',
    'ephemeris_validation.json', 'validation.json', 'rings.py.txt']) {
    if (!Object.hasOwn(files, name)) throw new Error(`Missing manifest file ${name}`)
  }
  if (Object.keys(files).length > 32) throw new Error('Too many dataset files')
  for (const [name, entry] of Object.entries(files)) {
    const file = object(entry, `file ${name}`)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name.includes('..')
      || !finite(file.bytes) || !Number.isInteger(file.bytes) || file.bytes <= 0
      || file.bytes > (name === 'states.bin' ? MAX_DATA_BYTES : 2 * 1024 * 1024)
      || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`Invalid file descriptor ${name}`)
    }
  }
  return data as unknown as DatasetManifest
}

export function validateCatalog(value: unknown): Body[] {
  const data = object(value, 'catalog')
  if (!Array.isArray(data.bodies) || data.bodies.length !== 71) throw new Error('Expected 71 catalog bodies')
  const ids = new Set<string>()
  for (const item of data.bodies) {
    const body = object(item, 'body')
    if (typeof body.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.id) || ids.has(body.id)
      || typeof body.name !== 'string' || !body.name || typeof body.category !== 'string' || !body.category
      || !(body.parent_id === null || typeof body.parent_id === 'string')
      || !finite(body.radius_km) || body.radius_km <= 0
      || (body.radii_km !== undefined && (!numbers(body.radii_km, 3) || body.radii_km.some(x => x <= 0)))
      || (body.rotation_period_hours !== undefined
        && (!finite(body.rotation_period_hours) || body.rotation_period_hours === 0))
      || (body.horizons_id !== undefined && typeof body.horizons_id !== 'string')
      || (body.physical_notes !== undefined && typeof body.physical_notes !== 'string')
      || !Array.isArray(body.source_urls) || !body.source_urls.every(url => typeof url === 'string')) {
      throw new Error(`Invalid catalog body ${String(body.id)}`)
    }
    ids.add(body.id)
  }
  for (const body of data.bodies) {
    if (body.parent_id !== null && (!ids.has(body.parent_id) || body.parent_id === body.id)) {
      throw new Error(`Invalid catalog parent for ${body.id}`)
    }
    const visited = new Set<string>([body.id])
    let ancestor = body.parent_id
    while (ancestor !== null) {
      if (visited.has(ancestor)) throw new Error('Cyclic catalog parents')
      visited.add(ancestor)
      ancestor = data.bodies.find(candidate => candidate.id === ancestor).parent_id
    }
  }
  // Preserve every source field, including explicit unknowns, instead of projecting a reduced catalog.
  return data.bodies as Body[]
}

export function validateOrientations(value: unknown, bodies: Body[]): OrientationCatalog {
  const data = object(value, 'orientations')
  const models = object(data.bodies, 'orientation models')
  const metadata = object(data.metadata, 'orientation metadata')
  const ids = new Set(bodies.map(body => body.id))
  if (Object.keys(models).length !== 43 || metadata.periodic_terms_evaluated !== false) {
    throw new Error('Expected 43 supported secular orientation models')
  }
  for (const [id, item] of Object.entries(models)) {
    const model = object(item, `orientation ${id}`)
    if (!ids.has(id) || !numbers(model.pole_ra_deg, 3) || !numbers(model.pole_dec_deg, 3)
      || !numbers(model.prime_meridian_deg, 3) || !finite(model.epoch_jd_tdb)
      || typeof model.notes !== 'string' || typeof model.source !== 'string') {
      throw new Error(`Invalid orientation model ${id}`)
    }
  }
  return data as unknown as OrientationCatalog
}

export function validateTime(value: unknown): TimeCoefficients {
  const data = object(value, 'time coefficients')
  if (!numbers(data.DELTA_T_A, 1) || data.DELTA_T_A[0] !== 32.184
    || !numbers(data.K, 1) || data.K[0] !== 0.001657
    || !numbers(data.EB, 1) || data.EB[0] !== 0.01671
    || !numbers(data.M, 2) || data.M[0] !== 6.239996 || data.M[1] !== 1.99096871e-7
    || !Array.isArray(data.leaps) || data.leaps.length !== 28
    || typeof data.warning !== 'string' || typeof data.source !== 'string') {
    throw new Error('Invalid pinned DELTET constants')
  }
  let previous = -Infinity
  for (const [index, entry] of data.leaps.entries()) {
    const leap = object(entry, 'leap-second entry')
    if (typeof leap.utc !== 'string' || leap.tai_minus_utc !== index + 10) {
      throw new Error('Invalid leap-second offset')
    }
    const time = parseUtcMilliseconds(leap.utc)
    if (time <= previous || (index === 0 && time !== Date.UTC(1972, 0, 1))
      || (index === 27 && time !== Date.UTC(2017, 0, 1))) throw new Error('Invalid leap-second epoch')
    previous = time
  }
  return data as unknown as TimeCoefficients
}

export function validateRingPoles(value: unknown): RingPoles {
  const data = object(value, 'ring poles')
  const poles = object(data.poles, 'ring pole map')
  const expected = { haumea: [285.1, -10.6], quaoar: [259.82, 53.45], chariklo: [151.30, 41.48] }
  if (Object.keys(poles).length !== 3 || typeof data.warning !== 'string' || typeof data.source !== 'string') {
    throw new Error('Invalid ring pole inventory')
  }
  for (const [id, pole] of Object.entries(expected)) {
    const value = poles[id]
    if (!numbers(value, 2) || value[0] !== pole[0] || value[1] !== pole[1]) {
      throw new Error(`Invalid ring pole for ${id}`)
    }
  }
  return data as unknown as RingPoles
}
