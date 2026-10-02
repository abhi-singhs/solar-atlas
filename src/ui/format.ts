import { AU_KM } from '../contracts'

const number = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
export const formatNumber = (value: number): string => number.format(value)
export function distance(km: number): string {
  if (!Number.isFinite(km)) return 'Unavailable'
  if (Math.abs(km) >= AU_KM / 10) return `${(km / AU_KM).toFixed(3)} AU`
  if (Math.abs(km) < 1) return `${number.format(km * 1000)} m`
  return `${number.format(km)} km`
}
export function speed(c: number): string {
  if (c === 0) return '0 c'
  if (Math.abs(c) < 0.0001) return `${c.toExponential(3)} c`
  if (Math.abs(c) < 0.01) return `${c.toPrecision(4)} c`
  return `${number.format(c)} c`
}
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'Set a speed'
  const rounded = Math.round(seconds)
  if (rounded >= 3600) {
    const totalMinutes = Math.round(seconds / 60)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return `${number.format(hours)} h ${minutes} min`
  }
  if (rounded >= 60) {
    const minutes = Math.floor(rounded / 60)
    return `${minutes} min ${rounded % 60} s`
  }
  return `${rounded} s`
}
export const categories: Record<string, string> = {
  star: 'Star', planet: 'Planet', dwarf_planet: 'Dwarf planet',
  dwarf_candidate: 'Dwarf-planet candidate', moon: 'Moon', asteroid: 'Asteroid',
  tno: 'Trans-Neptunian object', centaur: 'Centaur', comet: 'Comet',
}
/** Time rates offered in the dock, in simulated seconds per second. */
export const TIME_RATES: [number, string][] = [
  [-86400, 'Reverse 1 day/s'], [-3600, 'Reverse 1 hour/s'], [1, 'Real time'], [60, '1 min/s'],
  [3600, '1 hour/s'], [86400, '1 day/s'], [604800, '1 week/s'],
]
export const rateLabel = (value: number): string => TIME_RATES.find(([rate]) => rate === value)?.[1] ?? `${value.toLocaleString()}x`
