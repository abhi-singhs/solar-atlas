import type { Dataset, Snapshot, Vec3 } from '../contracts'
import { dataBaseUrl, loadDatasetPayload } from '../data/load'
import type { DatasetPayload, WorkerReply } from '../data/types'
import { assertCoverage, evaluateTrack } from './hermite'
import { bodyRotation } from './orientation'
import { createTimeConverter } from './time'

export function createDataset(payload: DatasetPayload): Dataset {
  const { bodies, ephemeris, orientations, ringPoles, time } = payload
  const { firstJd, lastJd, tracks } = ephemeris
  const converter = createTimeConverter(time)
  const bodyIds = new Set(bodies.map(body => body.id))
  const selected = (id: string) => {
    if (!bodyIds.has(id)) throw new RangeError(`Unknown body ${id}`)
    const track = tracks[id === 'phobos' ? 'phobos@refined' : id]
    if (!track) throw new Error(`Required state track is unavailable for ${id}`)
    return track
  }
  return {
    bodies,
    firstJd,
    lastJd,
    evaluate(jdTdb: number): Snapshot {
      assertCoverage(jdTdb, firstJd, lastJd)
      const states: Snapshot['states'] = Object.create(null)
      for (const body of bodies) {
        states[body.id] = {
          ...evaluateTrack(selected(body.id), jdTdb),
          rotation: bodyRotation(body.id, jdTdb, orientations, ringPoles),
        }
      }
      return { jdTdb, states }
    },
    utcToJd(iso: string): number {
      const jd = converter.utcToJd(iso)
      assertCoverage(jd, firstJd, lastJd)
      return jd
    },
    jdToUtc(jd: number): string {
      assertCoverage(jd, firstJd, lastJd)
      return converter.jdToUtc(jd)
    },
    trajectory(id: string, count = 512): Vec3[] {
      const track = selected(id)
      if (!Number.isInteger(count) || count < 2 || count > 40000) {
        throw new RangeError('Trajectory count must be an integer between 2 and 40000 to include both endpoints')
      }
      const length = Math.min(count, track.count)
      return Array.from({ length }, (_, i) => {
        const jd = i === length - 1 ? lastJd : firstJd + (lastJd - firstJd) * i / (length - 1)
        return evaluateTrack(track, jd).position
      })
    },
  }
}

export async function loadDataset(onProgress: (message: string) => void = () => {}): Promise<Dataset> {
  const baseUrl = dataBaseUrl(import.meta.env.BASE_URL, document.baseURI)
  if (typeof Worker === 'undefined') {
    onProgress('Web Workers unavailable; validating scientific data on the main thread')
    return createDataset(await loadDatasetPayload(baseUrl, onProgress))
  }
  return new Promise<Dataset>((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('./dataset.worker.ts', import.meta.url), { type: 'module' })
    } catch (error) {
      reject(new Error('Could not start the scientific data worker. No fallback dataset was used.', { cause: error }))
      return
    }
    const finish = (error?: Error, payload?: DatasetPayload) => {
      clearTimeout(timer)
      worker.terminate()
      if (error) reject(error)
      else if (payload) {
        try {
          resolve(createDataset(payload))
        } catch (cause) {
          reject(cause)
        }
      }
    }
    const timer = setTimeout(() => finish(new Error('Scientific data worker timed out')), 180000)
    worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data
      if (reply?.type === 'progress') {
        try {
          onProgress(reply.message)
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)))
        }
      } else if (reply?.type === 'ready') finish(undefined, reply.payload)
      else if (reply?.type === 'error') finish(new Error(`Scientific data worker failed: ${reply.message}`))
      else finish(new Error('Scientific data worker returned an invalid response'))
    }
    worker.onerror = event => {
      event.preventDefault()
      finish(new Error(`Scientific data worker failed: ${event.message || 'module or network error'}`))
    }
    worker.onmessageerror = () => finish(new Error('Could not receive the scientific Float64 data'))
    try {
      worker.postMessage({ baseUrl })
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
