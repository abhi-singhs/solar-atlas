import type { ViewState } from '../navigation/state'

export type Rng = () => number

/** Mulberry32. A seed always yields the same notes, so offline renders are repeatable. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const midiHz = (note: number): number => 440 * 2 ** ((note - 69) / 12)

/** D Lydian pitch classes: D E F# G# A B C#. */
export const SCALE = [2, 4, 6, 8, 9, 11, 1] as const
/** D major pentatonic, the chime subset of the scale. */
export const CHIME_CLASSES = [2, 4, 6, 9, 11] as const

/** D2, A2, and D3. */
export const DRONE_NOTES = [38, 45, 50] as const
/** A5, D6, E6, and A6 sit above the pads while the ship is at warp. */
export const SHIMMER_NOTES = [81, 86, 88, 93] as const
/** D5 up to A6 in the pentatonic subset. */
export const CHIME_NOTES = [74, 76, 78, 81, 83, 86, 88, 90, 93] as const

/** Wide voicings in D Lydian. Each entry is a MIDI chord. */
export const CHORDS: readonly (readonly number[])[] = [
  [50, 57, 64, 66, 73], // Dmaj9
  [50, 59, 64, 68, 71], // E/D, the chord that gives Lydian its lift
  [47, 54, 62, 64, 69], // Bm7(11)
  [54, 61, 64, 69, 73], // F#m7
  [45, 52, 59, 61, 64], // A(add9)
  [49, 56, 59, 64, 68], // C#m7
]
/** Allowed moves between chords. Every chord can reach Dmaj9 within two steps. */
const PROGRESSIONS: readonly (readonly number[])[] = [
  [1, 2, 3, 4],
  [0, 3, 5],
  [0, 1, 4],
  [0, 1, 2],
  [0, 1, 2],
  [0, 2, 3],
]

export function nextChord(rng: Rng, previous: number): number {
  const options = PROGRESSIONS[previous] ?? PROGRESSIONS[0]
  return options[Math.min(options.length - 1, Math.floor(rng() * options.length))]
}

/** A random walk of one to three steps through CHIME_NOTES that turns back at either end. */
export function nextChime(rng: Rng, previous: number): number {
  const last = CHIME_NOTES.length - 1
  const from = Math.max(0, Math.min(last, previous))
  const step = (1 + Math.min(2, Math.floor(rng() * 3))) * (rng() < 0.5 ? -1 : 1)
  return from + step < 0 || from + step > last ? from - step : from + step
}

/** Seconds until the next chime. About one in six arrives as a quick pair. */
export function chimeGap(rng: Rng): number {
  return rng() < 0.18 ? 0.3 + rng() * 0.3 : 2.5 + rng() * 6
}

export interface Mood {
  /** Output gain from 0 to 1 before the engine's fixed ceiling. */
  master: number
  drone: number
  pads: number
  chimes: number
  shimmer: number
  /** Low-pass cutoff on the pads, in hertz. */
  cutoffHz: number
}

export type MoodInput = Pick<ViewState, 'music' | 'musicVolume' | 'inShip' | 'playing' | 'shipMode' | 'warp' | 'speedC'>

export const SILENT: Mood = { master: 0, drone: 0, pads: 0, chimes: 0, shimmer: 0, cutoffHz: 900 }
/** Landed or hovering, only the drone remains, at this share of the flight level. */
export const GROUNDED_LEVEL = 0.55

const clamp01 = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

/**
 * Maps flight state to mix targets. Music plays only in Spaceship mode while the flight clock runs.
 * Master and cutoff are rounded, so telemetry that changes every frame doesn't restart the ramps.
 */
export function musicMood(input: MoodInput): Mood {
  const volume = clamp01(input.musicVolume)
  const grounded = input.shipMode === 'landed' || input.shipMode === 'hover'
  const active = input.music && input.inShip && input.playing && volume > 0
  const master = active ? Math.round(volume * volume * (grounded ? GROUNDED_LEVEL : 1) * 1000) / 1000 : 0
  if (grounded) return { master, drone: 1, pads: 0, chimes: 0, shimmer: 0, cutoffHz: 700 }
  const speedC = Number.isFinite(input.speedC) ? Math.max(0, input.speedC) : 0
  // From dock speed (1e-8 c) to c the filter opens from 900 to 2,400 Hz. Warp runs from 3,200 Hz at c to 5,600 Hz at 1,000c.
  const cutoffHz = input.warp
    ? 3200 + 2400 * clamp01(Math.log10(Math.max(1, speedC)) / 3)
    : 900 + 1500 * clamp01((Math.log10(Math.max(1e-8, speedC)) + 8) / 8)
  return { master, drone: 0.7, pads: 1, chimes: 1, shimmer: input.warp ? 1 : 0, cutoffHz: Math.round(cutoffHz / 50) * 50 }
}

export const sameMood = (a: Mood, b: Mood): boolean =>
  a.master === b.master && a.drone === b.drone && a.pads === b.pads && a.chimes === b.chimes &&
  a.shimmer === b.shimmer && a.cutoffHz === b.cutoffHz
