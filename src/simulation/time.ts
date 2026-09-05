import type { TimeCoefficients } from '../data/types'

const DAY = 86400
const UNIX_JD = 2440587.5
const J2000 = 2451545

export function parseUtcMilliseconds(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(iso)
  if (!match) throw new RangeError('UTC requires YYYY-MM-DDTHH:mm:ss with Z or +00:00')
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  if (year < 1972 || month < 1 || month > 12 || day < 1 || day > 31
    || hour > 23 || minute > 59 || second > 59) {
    throw new RangeError('Invalid UTC date, pre-1972 date, or unsupported leap-second input')
  }
  const whole = Date.UTC(year, month - 1, day, hour, minute, second)
  const date = new Date(whole)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError('Invalid UTC calendar date')
  }
  return whole + Number(`0.${match[7] ?? '0'}`) * 1000
}

export function createTimeConverter(coefficients: TimeCoefficients): {
  utcToJd: (iso: string) => number
  jdToUtc: (jd: number) => string
  warning: string
} {
  const leaps = coefficients.leaps.map(entry => ({
    milliseconds: parseUtcMilliseconds(entry.utc), offset: entry.tai_minus_utc,
  }))
  function periodic(tdbSeconds: number): number {
    const mean = coefficients.M[0] + coefficients.M[1] * tdbSeconds
    return coefficients.K[0] * Math.sin(mean + coefficients.EB[0] * Math.sin(mean))
  }
  function toJd(milliseconds: number, offset: number): number {
    const tt = milliseconds / 86400000 + UNIX_JD + (offset + coefficients.DELTA_T_A[0]) / DAY
    let correction = 0
    for (let i = 0; i < 4; i++) correction = periodic((tt - J2000) * DAY + correction)
    return tt + correction / DAY
  }
  const boundaries = leaps.map(entry => toJd(entry.milliseconds, entry.offset))

  return {
    warning: coefficients.warning,
    utcToJd(iso: string): number {
      const milliseconds = parseUtcMilliseconds(iso)
      let index = leaps.length - 1
      while (index >= 0 && milliseconds < leaps[index].milliseconds) index--
      if (index < 0) throw new RangeError('UTC precedes the pinned leap-second table')
      return toJd(milliseconds, leaps[index].offset)
    },
    jdToUtc(jd: number): string {
      if (!Number.isFinite(jd) || jd < boundaries[0]) {
        throw new RangeError('TDB epoch precedes the pinned leap-second table or is not finite')
      }
      for (let i = 1; i < leaps.length; i++) {
        const delta = leaps[i].offset - leaps[i - 1].offset
        const start = boundaries[i] - delta / DAY
        if (delta > 0 && jd >= start && jd < boundaries[i]) {
          const elapsed = (jd - start) * DAY
          const second = 60 + Math.floor(elapsed)
          const millis = Math.min(999, Math.round((elapsed % 1) * 1000))
          const previous = new Date(leaps[i].milliseconds - 1000).toISOString()
          return `${previous.slice(0, 17)}${second}.${String(millis).padStart(3, '0')}Z`
        }
      }
      let index = boundaries.length - 1
      while (index > 0 && jd < boundaries[index]) index--
      const tt = jd - periodic((jd - J2000) * DAY) / DAY
      const utc = tt - (leaps[index].offset + coefficients.DELTA_T_A[0]) / DAY
      const milliseconds = Math.round((utc - UNIX_JD) * 86400000)
      const date = new Date(milliseconds)
      if (!Number.isFinite(milliseconds) || !Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) {
        throw new RangeError('TDB epoch is outside the supported UTC calendar')
      }
      return date.toISOString()
    },
  }
}
