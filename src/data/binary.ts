import type { PackedEphemeris, PackedTrack } from './types'

export const EPOCH_ROUNDING_DAYS = 2e-9
export const MAX_DATA_BYTES = 64 * 1024 * 1024
const SAMPLE_BYTES = 56
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:@refined)?$/

export function parseStates(buffer: ArrayBuffer, bodyIds: readonly string[]): PackedEphemeris {
  if (buffer.byteLength < 32 || buffer.byteLength > MAX_DATA_BYTES) {
    throw new Error('Invalid states.bin size')
  }
  const view = new DataView(buffer)
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 8))
  const firstJd = view.getFloat64(16, true)
  const lastJd = view.getFloat64(24, true)
  const ids = new Set(bodyIds)
  if (magic !== 'SOLARD01' || view.getUint32(8, true) !== 1 || view.getUint32(12, true) !== 72
    || !Number.isFinite(firstJd) || !Number.isFinite(lastJd)
    || lastJd - firstJd <= 364 || lastJd - firstJd >= 367 || ids.size !== 71 || bodyIds.length !== 71) {
    throw new Error('Invalid states.bin header or catalog')
  }
  ids.add('phobos@refined')
  const tracks: Record<string, PackedTrack> = Object.create(null)
  let offset = 32
  for (let record = 0; record < 72; record++) {
    if (offset + 2 > buffer.byteLength) throw new Error('Truncated state record')
    const idLength = view.getUint16(offset, true)
    offset += 2
    if (idLength < 1 || idLength > 64 || offset + idLength + 4 > buffer.byteLength) {
      throw new Error('Invalid state identifier length')
    }
    let id = ''
    for (let i = 0; i < idLength; i++) id += String.fromCharCode(view.getUint8(offset + i))
    offset += idLength
    const count = view.getUint32(offset, true)
    offset += 4
    const stepSeconds = id === 'phobos@refined' ? 900 : 3600
    const expectedCount = Math.round((lastJd - firstJd) * 86400 / stepSeconds) + 1
    if (!IDENTIFIER.test(id) || !ids.has(id) || tracks[id] || count < 2 || count > 40000
      || count !== expectedCount || offset + count * SAMPLE_BYTES > buffer.byteLength) {
      throw new Error(`Invalid state record identifier, count, or bounds for ${id}`)
    }
    // Records are unaligned in the source format. DataView preserves every binary64 value.
    const samples = new Float64Array(count * 7)
    let previous = -Infinity
    for (let row = 0; row < count; row++) {
      for (let column = 0; column < 7; column++) {
        const value = view.getFloat64(offset, true)
        offset += 8
        if (!Number.isFinite(value)) throw new Error(`Nonfinite state in ${id}`)
        samples[row * 7 + column] = value
      }
      const epoch = samples[row * 7]
      if (row > 0 && (!(epoch > previous) || (epoch - previous) * 86400 > stepSeconds + 1.01)) {
        throw new Error(`Duplicate, reversed, or missing epoch in ${id}`)
      }
      previous = epoch
    }
    if (Math.abs(samples[0] - firstJd) > EPOCH_ROUNDING_DAYS
      || Math.abs(samples[(count - 1) * 7] - lastJd) > EPOCH_ROUNDING_DAYS) {
      throw new Error(`Incomplete endpoint coverage in ${id}`)
    }
    tracks[id] = { id, samples, count, firstJd, lastJd }
  }
  if (offset !== buffer.byteLength || !tracks['phobos@refined'] || Object.keys(tracks).length !== ids.size) {
    throw new Error('Trailing binary data or missing Phobos refinement')
  }
  return { firstJd, lastJd, tracks }
}
