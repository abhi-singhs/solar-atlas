import { loadDatasetPayload } from '../data/load'
import type { WorkerReply } from '../data/types'

const context = self as unknown as {
  onmessage: ((event: MessageEvent<{ baseUrl: string }>) => void) | null
  postMessage: (message: WorkerReply, transfer?: Transferable[]) => void
}

context.onmessage = async (event: MessageEvent<{ baseUrl: string }>) => {
  try {
    const payload = await loadDatasetPayload(event.data.baseUrl, message => {
      context.postMessage({ type: 'progress', message })
    })
    const transfer = Object.values(payload.ephemeris.tracks)
      .map(track => track.samples.buffer as ArrayBuffer)
    context.postMessage({ type: 'ready', payload }, transfer)
  } catch (error) {
    context.postMessage({
      type: 'error', message: error instanceof Error ? error.message : String(error),
    })
  }
}
