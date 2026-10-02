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
export const pitchClass = (note: number): number => ((note % 12) + 12) % 12
const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(rng() * items.length))]

/** D Lydian pitch classes: D E F# G# A B C#. */
export const SCALE = [2, 4, 6, 8, 9, 11, 1] as const
/** D major pentatonic, the chime subset of the scale. */
export const CHIME_CLASSES = [2, 4, 6, 9, 11] as const

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

/** Seconds until the next chime. About one in six arrives as a quick pair. `spacing` stretches the other gaps. */
export function chimeGap(rng: Rng, spacing = 1): number {
  return rng() < 0.18 ? 0.3 + rng() * 0.3 : (2.5 + rng() * 6) * spacing
}

/** C#6, the highest note a pad voicing may reach. */
export const PAD_CEILING = 85

/**
 * Voices a chord as written about half the time. Otherwise it lifts the top note an octave,
 * which opens the chord, or leaves out the bass, which thins it over the drone.
 */
export function voiceChord(rng: Rng, chord: readonly number[]): number[] {
  const notes = [...chord].sort((a, b) => a - b)
  const roll = rng()
  if (roll < 0.25 && notes[notes.length - 1] + 12 <= PAD_CEILING) notes[notes.length - 1] += 12
  else if (roll < 0.45 && notes.length > 3) notes.shift()
  return notes
}

/**
 * Three to five chimes that climb or fall through the chime notes belonging to a chord, starting near
 * the chime at index `from`. Returns indexes into CHIME_NOTES, or an empty run if the chord shares none.
 */
export function arpeggio(rng: Rng, chord: readonly number[], from: number): number[] {
  const classes = new Set(chord.map(pitchClass))
  const tones = CHIME_NOTES.flatMap((note, i) => classes.has(pitchClass(note)) ? [i] : [])
  if (tones.length === 0) return []
  const length = Math.min(tones.length, 3 + Math.min(2, Math.floor(rng() * 3)))
  let nearest = 0
  tones.forEach((tone, i) => { if (Math.abs(tone - from) < Math.abs(tones[nearest] - from)) nearest = i })
  if (rng() < 0.5) {
    const start = Math.min(nearest, tones.length - length)
    return tones.slice(start, start + length)
  }
  const end = Math.max(nearest, length - 1)
  return tones.slice(end - length + 1, end + 1).reverse()
}

/**
 * A stretch of the score built over one drone root. Every root comes from the same seven notes,
 * so moving the drone changes the mode while the chords and chimes stay in key.
 */
export interface Section {
  name: string
  /** Root, fifth, and octave. */
  drone: readonly [number, number, number]
  /** Index into CHORDS of the chord built on the drone root, which opens the section. */
  home: number
  /** How long each chord may hold, in seconds. */
  chordSeconds: readonly number[]
  /** Stretches the long gaps between chimes. Above 1 is sparser. */
  chimeSpacing: number
  /** Chance that a chime becomes an arpeggio of the current chord. */
  arpeggio: number
}

/** The first section is home. The others are darker (Dorian, Aeolian) or warmer (Ionian). */
export const SECTIONS: readonly Section[] = [
  { name: 'D Lydian', drone: [38, 45, 50], home: 0, chordSeconds: [14, 16, 18], chimeSpacing: 1, arpeggio: 0.15 },
  { name: 'B Dorian', drone: [35, 42, 47], home: 2, chordSeconds: [18, 20, 24], chimeSpacing: 1.5, arpeggio: 0.1 },
  { name: 'A Ionian', drone: [33, 40, 45], home: 4, chordSeconds: [12, 14, 16], chimeSpacing: 0.7, arpeggio: 0.3 },
  { name: 'F# Aeolian', drone: [42, 49, 54], home: 3, chordSeconds: [20, 24], chimeSpacing: 2, arpeggio: 0.05 },
]

/** Chords per section. */
export const sectionBars = (rng: Rng): number => 3 + Math.min(2, Math.floor(rng() * 3))

/** Always a different section. Home leads to any other, and other sections usually return home. */
export function nextSection(rng: Rng, previous: number): number {
  if (previous !== 0 && rng() < 0.65) return 0
  return pick(rng, SECTIONS.map((_, i) => i).filter(i => i !== 0 && i !== previous))
}

/** One chord of the score. */
export interface Bar {
  /** Index into SECTIONS. */
  section: number
  /** Bars left in the section after this one. */
  left: number
  /** Index into CHORDS. */
  chord: number
  /** The chord as voiced for this bar. */
  notes: readonly number[]
  seconds: number
}

const makeBar = (rng: Rng, section: number, chord: number, left: number): Bar =>
  ({ section, left, chord, notes: voiceChord(rng, CHORDS[chord]), seconds: pick(rng, SECTIONS[section].chordSeconds) })

/** The score opens at home on Dmaj9. */
export const firstBar = (rng: Rng): Bar => makeBar(rng, 0, SECTIONS[0].home, sectionBars(rng) - 1)

/** A new section opens on its home chord, unless that chord is already playing. */
export function nextBar(rng: Rng, previous: Bar): Bar {
  if (previous.left > 0) return makeBar(rng, previous.section, nextChord(rng, previous.chord), previous.left - 1)
  const section = nextSection(rng, previous.section)
  const { home } = SECTIONS[section]
  return makeBar(rng, section, home === previous.chord ? nextChord(rng, home) : home, sectionBars(rng) - 1)
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
