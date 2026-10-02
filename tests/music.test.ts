import { describe, expect, it } from 'vitest'
import {
  CHIME_CLASSES, CHIME_NOTES, CHORDS, GROUNDED_LEVEL, PAD_CEILING, SCALE, SECTIONS, SHIMMER_NOTES, SILENT,
  arpeggio, chimeGap, createRng, firstBar, midiHz, musicMood, nextBar, nextChime, nextChord, pitchClass, sameMood, voiceChord,
} from '../src/audio/score'
import type { Bar, MoodInput } from '../src/audio/score'

const flight: MoodInput = { music: true, musicVolume: 1, inShip: true, playing: true, shipMode: 'free', warp: false, speedC: 0.01 }

describe('space music score', () => {
  it('draws the same sequence from the same seed', () => {
    const a = createRng(42), b = createRng(42), c = createRng(43)
    const first = Array.from({ length: 50 }, a)
    expect(Array.from({ length: 50 }, b)).toEqual(first)
    expect(Array.from({ length: 50 }, c)).not.toEqual(first)
    expect(first.every(value => value >= 0 && value < 1)).toBe(true)
  })

  it('tunes A4 to 440 Hz', () => {
    expect(midiHz(69)).toBe(440)
    expect(midiHz(50)).toBeCloseTo(146.832, 3)
  })

  it('keeps every note inside D Lydian and the chimes inside its pentatonic subset', () => {
    const scale = new Set<number>(SCALE)
    for (const note of [...CHORDS.flat(), ...SECTIONS.flatMap(section => section.drone), ...SHIMMER_NOTES]) expect(scale.has(pitchClass(note))).toBe(true)
    for (const note of CHIME_NOTES) expect((CHIME_CLASSES as readonly number[]).includes(pitchClass(note))).toBe(true)
    expect(CHIME_CLASSES.every(value => scale.has(value))).toBe(true)
  })

  it('moves to a different chord every time and reaches all of them', () => {
    const rng = createRng(1)
    const seen = new Set<number>()
    let chord = 0
    for (let i = 0; i < 500; i++) {
      const next = nextChord(rng, chord)
      expect(next).not.toBe(chord)
      expect(next).toBeGreaterThanOrEqual(0)
      expect(next).toBeLessThan(CHORDS.length)
      seen.add(next)
      chord = next
    }
    expect(seen.size).toBe(CHORDS.length)
  })

  it('walks the chimes in steps of one to three notes', () => {
    const rng = createRng(2)
    let chime = 0
    for (let i = 0; i < 500; i++) {
      const next = nextChime(rng, chime)
      expect(next).toBeGreaterThanOrEqual(0)
      expect(next).toBeLessThan(CHIME_NOTES.length)
      expect(Math.abs(next - chime)).toBeGreaterThanOrEqual(1)
      expect(Math.abs(next - chime)).toBeLessThanOrEqual(3)
      chime = next
    }
  })

  it('spaces chimes between 0.3 and 8.5 seconds, stretched by the section', () => {
    const rng = createRng(3)
    const gaps = Array.from({ length: 1000 }, () => chimeGap(rng))
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0.3)
    expect(Math.max(...gaps)).toBeLessThanOrEqual(8.5)
    expect(gaps.filter(gap => gap < 1).length).toBeGreaterThan(100)
    const sparse = Array.from({ length: 1000 }, () => chimeGap(rng, 2))
    expect(Math.min(...sparse)).toBeGreaterThanOrEqual(0.3)
    expect(Math.max(...sparse)).toBeLessThanOrEqual(17)
    expect(Math.max(...sparse)).toBeGreaterThan(8.5)
  })

  it('varies chord voicings without leaving the chord', () => {
    const rng = createRng(8)
    const kinds = new Set<string>()
    for (let i = 0; i < 600; i++) {
      const chord = CHORDS[i % CHORDS.length]
      const notes = voiceChord(rng, chord)
      expect(notes.length).toBeGreaterThanOrEqual(chord.length - 1)
      expect(Math.max(...notes)).toBeLessThanOrEqual(PAD_CEILING)
      for (const note of notes) expect(chord.map(pitchClass)).toContain(pitchClass(note))
      kinds.add(notes.length < chord.length ? 'thin' : notes.join() === chord.join() ? 'written' : 'lifted')
    }
    expect(kinds).toEqual(new Set(['written', 'lifted', 'thin']))
  })

  it('runs arpeggios of three to five chimes through the current chord', () => {
    const rng = createRng(9)
    const lengths = new Set<number>()
    for (let i = 0; i < 600; i++) {
      const chord = CHORDS[i % CHORDS.length]
      const run = arpeggio(rng, chord, i % CHIME_NOTES.length)
      expect(run.length).toBeGreaterThanOrEqual(3)
      expect(run.length).toBeLessThanOrEqual(5)
      lengths.add(run.length)
      for (const index of run) expect(chord.map(pitchClass)).toContain(pitchClass(CHIME_NOTES[index]))
      const direction = Math.sign(run[1] - run[0])
      expect(direction).not.toBe(0)
      for (let j = 1; j < run.length; j++) expect(Math.sign(run[j] - run[j - 1])).toBe(direction)
    }
    expect(lengths).toEqual(new Set([3, 4, 5]))
    expect(arpeggio(rng, [56, 68], 0)).toEqual([])
  })

  it('builds each section on a different drone root with its home chord on that root', () => {
    for (const section of SECTIONS) {
      const [root, fifth, octave] = section.drone
      expect(fifth - root).toBe(7)
      expect(octave - root).toBe(12)
      expect(pitchClass(CHORDS[section.home][0])).toBe(pitchClass(root))
      expect(section.chordSeconds.every(seconds => seconds >= 12 && seconds <= 24)).toBe(true)
    }
    expect(new Set(SECTIONS.map(section => pitchClass(section.drone[0]))).size).toBe(SECTIONS.length)
  })

  it('moves through sections of three to five chords and keeps returning home', () => {
    const rng = createRng(10)
    const bars: Bar[] = [firstBar(rng)]
    expect(bars[0]).toMatchObject({ section: 0, chord: SECTIONS[0].home })
    for (let i = 0; i < 3000; i++) bars.push(nextBar(rng, bars[bars.length - 1]))
    const runs: Bar[][] = []
    for (const bar of bars) {
      if (runs.length > 0 && runs[runs.length - 1][0].section === bar.section) runs[runs.length - 1].push(bar)
      else runs.push([bar])
    }
    for (const run of runs.slice(0, -1)) {
      expect(run.length).toBeGreaterThanOrEqual(3)
      expect(run.length).toBeLessThanOrEqual(5)
      run.forEach((bar, i) => expect(bar.left).toBe(run.length - 1 - i))
    }
    for (let i = 1; i < runs.length; i++) {
      const previous = runs[i - 1][runs[i - 1].length - 1].chord
      const { home } = SECTIONS[runs[i][0].section]
      if (previous !== home) expect(runs[i][0].chord).toBe(home)
    }
    for (let i = 1; i < bars.length; i++) expect(bars[i].chord).not.toBe(bars[i - 1].chord)
    for (const bar of bars) expect(SECTIONS[bar.section].chordSeconds).toContain(bar.seconds)
    expect(new Set(runs.map(run => run[0].section)).size).toBe(SECTIONS.length)
    // Other sections return home 65% of the time, so home opens 0.65 / 1.65 of all sections.
    const home = runs.filter(run => run[0].section === 0).length
    expect(home / runs.length).toBeGreaterThan(0.35)
    expect(new Set(bars.map(bar => bar.seconds)).size).toBeGreaterThan(4)
  })
})

describe('space music mood', () => {
  it('stays silent when music is off, in Explore, or while flight is paused', () => {
    expect(musicMood({ ...flight, music: false }).master).toBe(0)
    expect(musicMood({ ...flight, inShip: false }).master).toBe(0)
    expect(musicMood({ ...flight, playing: false }).master).toBe(0)
    expect(musicMood({ ...flight, musicVolume: 0 }).master).toBe(0)
  })

  it('plays every layer but the shimmer while cruising', () => {
    const mood = musicMood(flight)
    expect(mood).toMatchObject({ master: 1, pads: 1, chimes: 1, shimmer: 0 })
    expect(mood.drone).toBeGreaterThan(0)
  })

  it('thins to a quieter drone when landed or hovering', () => {
    for (const shipMode of ['landed', 'hover'] as const) {
      const mood = musicMood({ ...flight, shipMode })
      expect(mood).toMatchObject({ master: GROUNDED_LEVEL, drone: 1, pads: 0, chimes: 0, shimmer: 0 })
      expect(mood.cutoffHz).toBeLessThan(musicMood(flight).cutoffHz)
    }
    expect(musicMood({ ...flight, shipMode: 'landing' }).pads).toBe(1)
  })

  it('adds the shimmer and opens the filter at warp', () => {
    const warp = musicMood({ ...flight, warp: true, speedC: 100 })
    expect(warp.shimmer).toBe(1)
    expect(warp.cutoffHz).toBeGreaterThan(musicMood({ ...flight, speedC: 0.9 }).cutoffHz)
  })

  it('brightens steadily with speed and rounds the cutoff to 50 Hz', () => {
    const speeds = [0, 1e-8, 1e-6, 1e-4, 0.01, 0.5, 0.999]
    const cutoffs = speeds.map(speedC => musicMood({ ...flight, speedC }).cutoffHz)
    for (let i = 1; i < cutoffs.length; i++) expect(cutoffs[i]).toBeGreaterThanOrEqual(cutoffs[i - 1])
    expect(cutoffs[0]).toBe(900)
    expect(cutoffs.at(-1)).toBe(2400)
    const warp = [1, 10, 100, 1000].map(speedC => musicMood({ ...flight, warp: true, speedC }).cutoffHz)
    expect(warp).toEqual([3200, 4000, 4800, 5600])
    for (const cutoff of [...cutoffs, ...warp]) expect(cutoff % 50).toBe(0)
  })

  it('squares the volume and clamps bad input', () => {
    expect(musicMood({ ...flight, musicVolume: 0.5 }).master).toBe(0.25)
    expect(musicMood({ ...flight, musicVolume: 1.5 }).master).toBe(1)
    expect(musicMood({ ...flight, musicVolume: -1 }).master).toBe(0)
    expect(musicMood({ ...flight, musicVolume: Number.NaN }).master).toBe(0)
    expect(musicMood({ ...flight, speedC: Number.NaN }).cutoffHz).toBe(900)
  })

  it('compares moods by value', () => {
    expect(sameMood(musicMood(flight), musicMood({ ...flight }))).toBe(true)
    expect(sameMood(musicMood(flight), SILENT)).toBe(false)
    expect(sameMood(musicMood(flight), musicMood({ ...flight, speedC: 0.011 }))).toBe(true)
  })
})
