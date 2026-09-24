import { useCallback, useEffect, useRef, useState } from 'react'
import type { ViewState } from '../navigation/state'
import { useLatest } from '../ui/hooks'
import { musicMood, sameMood, SILENT } from './score'
import type { Mood } from './score'
import { SpaceMusic } from './SpaceMusic'

/** Activation events. Touch counts only on release, so pointerup and touchend are both needed. */
const GESTURES = ['pointerdown', 'pointerup', 'keydown', 'touchend'] as const
const supported = typeof AudioContext !== 'undefined'

export interface SpaceMusicControls {
  supported: boolean
  /** True while the audio context runs. It suspends a few seconds after the music fades out. */
  running: boolean
  /** Creates or resumes the audio context. Call it from the user gesture that turns music on. */
  prime: () => void
}

/** Drives the generated soundtrack from the published view state. */
export function useSpaceMusic(view: ViewState, onError: (message: string) => void): SpaceMusicControls {
  const engine = useRef<SpaceMusic | null>(null)
  const applied = useRef<Mood>(SILENT)
  const [running, setRunning] = useState(false)
  const mood = musicMood(view)
  const latestMood = useLatest(mood)
  const report = useLatest(onError)

  const prime = useCallback(() => {
    if (!supported) return
    if (!engine.current) {
      try {
        const context = new AudioContext({ latencyHint: 'playback' })
        engine.current = new SpaceMusic(context, { onStateChange: state => setRunning(state === 'running') })
        setRunning(context.state === 'running')
        applied.current = latestMood.current
        engine.current.setMood(latestMood.current)
      } catch (e) {
        report.current(`Music could not start in this browser: ${e instanceof Error ? e.message : String(e)}`)
        return
      }
    }
    engine.current.resume()
  }, [latestMood, report])

  // The view publishes every 100 ms. The rounded mood changes far less often, and only a change starts new ramps.
  useEffect(() => {
    if (!engine.current || sameMood(applied.current, mood)) return
    applied.current = mood
    engine.current.setMood(mood)
  })

  // Browsers start audio only inside a user gesture, and Safari also wants the first resume there.
  // This covers music restored as on from a previous visit, and a context the browser suspended.
  useEffect(() => {
    if (!view.music || !supported) return
    const unlock = () => {
      const current = engine.current
      if (!current) prime()
      else if (!current.unlocked || (latestMood.current.master > 0 && current.context.state !== 'running')) current.resume()
    }
    for (const type of GESTURES) window.addEventListener(type, unlock, { capture: true, passive: true })
    return () => { for (const type of GESTURES) window.removeEventListener(type, unlock, { capture: true }) }
  }, [view.music, prime, latestMood])

  useEffect(() => () => {
    engine.current?.dispose()
    engine.current = null
  }, [])

  return { supported, running, prime }
}
