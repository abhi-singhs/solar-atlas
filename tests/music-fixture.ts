import { SpaceMusic } from '../src/audio/SpaceMusic'
import type { Mood } from '../src/audio/score'

interface Segment { at: number; mood: Mood }
interface RenderRequest { seconds: number; segments: Segment[]; windows: [number, number][]; seed?: number; sampleRate?: number }
interface WindowStats { finite: boolean; peak: number; rms: number; brightness: number }

/** Peak, RMS, and the energy share of the first difference, which rises with high-frequency content. */
function measure(channels: Float32Array[], from: number, to: number): WindowStats {
  let finite = true, peak = 0, energy = 0, difference = 0, count = 0
  for (const data of channels) {
    for (let i = Math.max(1, from); i < Math.min(data.length, to); i++) {
      const value = data[i]
      if (!Number.isFinite(value)) finite = false
      peak = Math.max(peak, Math.abs(value))
      energy += value * value
      difference += (value - data[i - 1]) ** 2
      count++
    }
  }
  return { finite, peak, rms: Math.sqrt(energy / Math.max(1, count)), brightness: energy > 0 ? difference / energy : 0 }
}

async function render({ seconds, segments, windows, seed = 7, sampleRate = 44100 }: RenderRequest): Promise<WindowStats[]> {
  const context = new OfflineAudioContext(2, Math.round(seconds * sampleRate), sampleRate)
  const music = new SpaceMusic(context, { seed })
  segments.forEach((segment, i) => {
    music.setMood(segment.mood, segment.at)
    music.schedule(segments[i + 1]?.at ?? seconds)
  })
  const buffer = await context.startRendering()
  music.dispose()
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)]
  return windows.map(([from, to]) => measure(channels, Math.round(from * sampleRate), Math.round(to * sampleRate)))
}

Object.assign(window, { musicFixture: { render } })
