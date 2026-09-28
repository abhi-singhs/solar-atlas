import { CHIME_NOTES, CHORDS, DRONE_NOTES, SHIMMER_NOTES, SILENT, chimeGap, createRng, midiHz, nextChime, nextChord } from './score'
import type { Mood, Rng } from './score'

type Layer = 'drone' | 'pads' | 'chimes' | 'shimmer'
const LAYERS: readonly Layer[] = ['drone', 'pads', 'chimes', 'shimmer']
/** Bus gain at mood 1, and how much of each layer goes straight out and into the reverb. */
const MIX: Record<Layer, { level: number; dry: number; wet: number }> = {
  drone: { level: 0.25, dry: 0.75, wet: 0.35 },
  pads: { level: 0.8, dry: 0.5, wet: 0.8 },
  chimes: { level: 0.5, dry: 0.3, wet: 1 },
  shimmer: { level: 0.3, dry: 0.2, wet: 1 },
}
const OUTPUT_CEILING = 1.25
const REVERB_WET = 0.6
const REVERB_SECONDS = 5.5
const CHORD_SECONDS = 16
const PAD_ATTACK = 6
const PAD_RELEASE = 9
const PAD_VOICE = 0.06
const CHIME_VOICE = 0.3
const CHIME_ATTACK = 0.012
/** Frequency ratio, share of the chime level, and decay time constant in seconds. The ratios are those of a struck bell. */
const CHIME_PARTIALS: readonly [number, number, number][] = [[1, 1, 1.4], [2.76, 0.16, 0.45], [5.4, 0.05, 0.2]]
const LOOKAHEAD_SECONDS = 4
const TICK_MS = 1000
const SUSPEND_AFTER_MS = 4000

const audible = (mood: Mood, layer: Layer) => mood.master > 0 && mood[layer] > 0

/** Glides a parameter toward a value from time t. Earlier ramps keep running until t, so changes never click. */
function approach(param: AudioParam, value: number, t: number, timeConstant: number): void {
  param.cancelScheduledValues(t)
  param.setTargetAtTime(value, t, timeConstant)
}

export interface SpaceMusicOptions {
  /** Seeds the note choices and generated noise. Defaults to the clock. */
  seed?: number
  onStateChange?: (state: AudioContextState) => void
}

/**
 * Ambient score for Spaceship mode, synthesized with Web Audio: a low drone, slow pad chords,
 * sparse bell chimes, and a high shimmer for warp, all through a generated reverb.
 * A live AudioContext schedules notes a few seconds ahead and suspends while silent.
 * An OfflineAudioContext renders whatever schedule() queued.
 */
export class SpaceMusic {
  readonly context: BaseAudioContext
  /** Becomes true once the live context has run. Browsers allow that only after a user gesture. */
  unlocked = false
  private readonly realtime?: AudioContext
  private readonly onStateChange?: (state: AudioContextState) => void
  private readonly rng: Rng
  private readonly master: GainNode
  private readonly buses = {} as Record<Layer, GainNode>
  private readonly padFilter: BiquadFilterNode
  private readonly padWave: PeriodicWave
  private readonly sustained: AudioScheduledSourceNode[] = []
  private mood: Mood = SILENT
  private chord = 0
  private chordAt: number
  /** When the last chord that actually played stops holding. */
  private chordEnd = -Infinity
  private chime = 4
  private chimeAt: number
  private timer = 0
  private suspendTimer = 0
  private disposed = false

  constructor(context: BaseAudioContext, options: SpaceMusicOptions = {}) {
    this.context = context
    this.rng = createRng(options.seed ?? Date.now())
    this.onStateChange = options.onStateChange
    if (typeof AudioContext !== 'undefined' && context instanceof AudioContext) this.realtime = context

    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -20
    compressor.knee.value = 12
    compressor.ratio.value = 3
    compressor.attack.value = 0.05
    compressor.release.value = 0.6
    this.master = this.gain(0)
    compressor.connect(this.master).connect(context.destination)
    const dry = this.gain(1)
    dry.connect(compressor)
    const reverb = context.createConvolver()
    reverb.buffer = this.impulse()
    reverb.connect(this.gain(REVERB_WET)).connect(compressor)
    for (const layer of LAYERS) {
      const bus = this.gain(0)
      bus.connect(this.gain(MIX[layer].dry)).connect(dry)
      bus.connect(this.gain(MIX[layer].wet)).connect(reverb)
      this.buses[layer] = bus
    }

    this.padFilter = context.createBiquadFilter()
    this.padFilter.type = 'lowpass'
    this.padFilter.frequency.value = SILENT.cutoffHz
    this.padFilter.Q.value = 0.5
    this.padFilter.connect(this.buses.pads)
    this.lfo(0.037, 350, this.padFilter.detune)
    const harmonics = 12
    const real = new Float32Array(harmonics + 1), imag = new Float32Array(harmonics + 1)
    for (let n = 1; n <= harmonics; n++) imag[n] = 1 / n ** 1.5
    this.padWave = context.createPeriodicWave(real, imag)
    this.startDrone()
    this.startShimmer()

    this.chordAt = context.currentTime + 0.05
    this.chimeAt = context.currentTime + 2
    if (this.realtime) {
      this.unlocked = this.realtime.state === 'running'
      this.realtime.addEventListener('statechange', this.stateChange)
      this.timer = window.setInterval(this.tick, TICK_MS)
    }
  }

  /** Ramps every layer toward a new mood from time `at`, which defaults to now. */
  setMood(mood: Mood, at = this.context.currentTime): void {
    if (this.disposed) return
    const t = Math.max(at, this.context.currentTime)
    const was = this.mood
    this.mood = mood
    approach(this.master.gain, mood.master * OUTPUT_CEILING, t, mood.master > was.master ? 1.2 : 0.45)
    for (const layer of LAYERS) approach(this.buses[layer].gain, mood[layer] * MIX[layer].level, t, 1.5)
    approach(this.padFilter.frequency, mood.cutoffHz, t, 1.2)
    // Skipped chords and chimes leave a gap, so a layer that becomes audible again starts fresh instead of waiting for the next slot.
    if (audible(mood, 'pads') && !audible(was, 'pads') && this.chordEnd < t) this.chordAt = Math.min(this.chordAt, t + 0.05)
    if (audible(mood, 'chimes') && !audible(was, 'chimes')) this.chimeAt = Math.min(this.chimeAt, t + 1 + this.rng() * 2)
    if (!this.realtime) return
    if (mood.master > 0) {
      window.clearTimeout(this.suspendTimer)
      this.resume()
      this.schedule(this.context.currentTime + LOOKAHEAD_SECONDS)
    } else this.suspendSoon()
  }

  /** Queues chords and chimes that start before `until`. Silent layers advance without playing. */
  schedule(until: number): void {
    if (this.disposed) return
    const now = this.context.currentTime
    if (this.chordAt < now) this.chordAt = now + 0.05
    while (this.chordAt < until) {
      if (audible(this.mood, 'pads')) this.playChord(this.chordAt)
      this.chord = nextChord(this.rng, this.chord)
      this.chordAt += CHORD_SECONDS
    }
    if (this.chimeAt < now) this.chimeAt = now + 0.05
    while (this.chimeAt < until) {
      if (audible(this.mood, 'chimes')) this.playChime(this.chimeAt)
      this.chimeAt += chimeGap(this.rng)
    }
  }

  /** Resumes a live context. Inside a user gesture this also unlocks audio for the page. */
  resume(): void {
    const context = this.realtime
    if (!context || this.disposed || context.state === 'running' || context.state === 'closed') return
    context.resume().catch(() => {})
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    window.clearInterval(this.timer)
    window.clearTimeout(this.suspendTimer)
    for (const source of this.sustained) {
      try { source.stop() } catch { /* Already stopped. */ }
    }
    if (this.realtime) {
      this.realtime.removeEventListener('statechange', this.stateChange)
      this.realtime.close().catch(() => {})
    }
  }

  private tick = (): void => {
    if (this.mood.master > 0 && this.realtime?.state === 'running') this.schedule(this.context.currentTime + LOOKAHEAD_SECONDS)
  }

  private stateChange = (): void => {
    if (!this.realtime) return
    if (this.realtime.state === 'running') {
      this.unlocked = true
      // A gesture can resume the context while the mix is silent, so every start re-arms the suspend.
      if (this.mood.master === 0) this.suspendSoon()
    }
    this.onStateChange?.(this.realtime.state)
  }

  /** Suspends the live context once the fade-out has finished, unless the music comes back first. */
  private suspendSoon(): void {
    window.clearTimeout(this.suspendTimer)
    this.suspendTimer = window.setTimeout(() => {
      if (!this.disposed && this.mood.master === 0 && this.realtime?.state === 'running') this.realtime.suspend().catch(() => {})
    }, SUSPEND_AFTER_MS)
  }

  private gain(value: number): GainNode {
    const node = this.context.createGain()
    node.gain.value = value
    return node
  }

  private panner(pan: number): StereoPannerNode {
    const node = this.context.createStereoPanner()
    node.pan.value = pan
    return node
  }

  /** Adds a sine of `depth` at `rate` hertz to a parameter for the life of the engine. */
  private lfo(rate: number, depth: number, param: AudioParam): void {
    const osc = this.context.createOscillator()
    osc.frequency.value = rate
    osc.connect(this.gain(depth)).connect(param)
    osc.start()
    this.sustained.push(osc)
  }

  private noise(seconds: number): AudioBuffer {
    const buffer = this.context.createBuffer(1, Math.round(seconds * this.context.sampleRate), this.context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = this.rng() * 2 - 1
    return buffer
  }

  /** Stereo noise that decays by 60 dB over REVERB_SECONDS and darkens as it fades, after a 30 ms predelay. */
  private impulse(): AudioBuffer {
    const rate = this.context.sampleRate
    const length = Math.round(REVERB_SECONDS * rate)
    const predelay = Math.round(0.03 * rate)
    const tau = REVERB_SECONDS / Math.log(1000)
    const buffer = this.context.createBuffer(2, length, rate)
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel)
      let smoothed = 0
      for (let i = predelay; i < length; i++) {
        const t = (i - predelay) / rate
        const k = 0.15 + 0.75 * t / REVERB_SECONDS
        smoothed = smoothed * k + (this.rng() * 2 - 1) * (1 - k)
        data[i] = smoothed * Math.exp(-t / tau)
      }
    }
    return buffer
  }

  private startDrone(): void {
    const mix = this.gain(0.8)
    mix.connect(this.buses.drone)
    this.lfo(0.061, 0.2, mix.gain)
    const voices: [OscillatorType, number, number][] = [['triangle', 0.45, 0], ['sine', 0.16, -3], ['sine', 0.22, 4]]
    voices.forEach(([type, level, detune], i) => {
      const osc = this.context.createOscillator()
      osc.type = type
      osc.frequency.value = midiHz(DRONE_NOTES[i])
      osc.detune.value = detune
      osc.connect(this.gain(level)).connect(mix)
      osc.start()
      this.sustained.push(osc)
    })
  }

  private startShimmer(): void {
    const mix = this.gain(1)
    mix.connect(this.buses.shimmer)
    SHIMMER_NOTES.forEach((note, i) => {
      const osc = this.context.createOscillator()
      osc.frequency.value = midiHz(note)
      osc.detune.value = (this.rng() - 0.5) * 10
      const tremolo = this.gain(0.12)
      this.lfo(0.11 + i * 0.06, 0.12, tremolo.gain)
      osc.connect(tremolo).connect(this.panner(i % 2 ? 0.5 : -0.5)).connect(mix)
      osc.start()
      this.sustained.push(osc)
    })
    const source = this.context.createBufferSource()
    source.buffer = this.noise(2)
    source.loop = true
    const band = this.context.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 2600
    band.Q.value = 1.2
    this.lfo(0.07, 900, band.frequency)
    source.connect(band).connect(this.gain(0.2)).connect(mix)
    source.start()
    this.sustained.push(source)
  }

  private playChord(at: number): void {
    const notes = CHORDS[this.chord]
    const hold = at + CHORD_SECONDS
    const end = hold + PAD_RELEASE
    notes.forEach((note, i) => {
      const voice = this.gain(0)
      voice.gain.setValueAtTime(0, at)
      voice.gain.linearRampToValueAtTime(PAD_VOICE, at + PAD_ATTACK)
      voice.gain.setValueAtTime(PAD_VOICE, hold)
      voice.gain.linearRampToValueAtTime(0, end)
      const pan = this.panner((i % 2 ? 1 : -1) * (0.15 + 0.5 * i / notes.length))
      voice.connect(pan).connect(this.padFilter)
      const oscs = [-7, 7].map(cents => {
        const osc = this.context.createOscillator()
        osc.setPeriodicWave(this.padWave)
        osc.frequency.value = midiHz(note)
        osc.detune.value = cents + (this.rng() - 0.5) * 4
        osc.connect(voice)
        osc.start(at)
        osc.stop(end + 0.05)
        return osc
      })
      oscs[0].onended = () => pan.disconnect()
    })
    this.chordEnd = hold
  }

  private playChime(at: number): void {
    this.chime = nextChime(this.rng, this.chime)
    const frequency = midiHz(CHIME_NOTES[this.chime])
    const level = CHIME_VOICE * (0.55 + 0.45 * this.rng())
    const pan = this.panner((this.rng() * 2 - 1) * 0.7)
    pan.connect(this.buses.chimes)
    CHIME_PARTIALS.forEach(([ratio, share, decay], i) => {
      const osc = this.context.createOscillator()
      osc.frequency.value = frequency * ratio
      const envelope = this.gain(0)
      envelope.gain.setValueAtTime(0, at)
      envelope.gain.linearRampToValueAtTime(level * share, at + CHIME_ATTACK)
      envelope.gain.setTargetAtTime(0, at + CHIME_ATTACK, decay)
      osc.connect(envelope).connect(pan)
      osc.start(at)
      osc.stop(at + CHIME_ATTACK + decay * 7)
      // The fundamental rings longest, so its end frees the whole chime.
      if (i === 0) osc.onended = () => pan.disconnect()
    })
  }
}
