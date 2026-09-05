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
  if (seconds > 86400) return `${number.format(seconds / 86400)} days`
  if (seconds > 3600) return `${number.format(seconds / 3600)} hours`
  if (seconds > 60) return `${number.format(seconds / 60)} min`
  return `${number.format(seconds)} s`
}
export const categories: Record<string, string> = {
  star: 'Star', planet: 'Planet', dwarf_planet: 'Dwarf planet',
  dwarf_candidate: 'Dwarf-planet candidate', moon: 'Moon', asteroid: 'Asteroid',
  tno: 'Trans-Neptunian object', centaur: 'Centaur', comet: 'Comet',
}
