import { fileURLToPath } from 'node:url'
import { mkdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { expect, it } from 'vitest'
import type { Dataset } from '../src/contracts'

it('loads and transfers the complete scientific dataset in a real browser worker under a nested base', async () => {
  const runtime = fileURLToPath(new URL(`./science-runtime-${process.pid}/`, import.meta.url))
  await mkdir(runtime, { recursive: true })
  const previousTmp = process.env.TMPDIR
  process.env.TMPDIR = runtime
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../', import.meta.url)),
    base: '/science-nested/',
    cacheDir: `${runtime}/vite-cache`,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'science-worker-probe',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.split('?')[0] !== '/science-nested/worker-probe') return next()
          response.setHeader('Content-Type', 'text/html')
          response.end('<!doctype html><html><head><title>Scientific worker test</title></head>'
            + '<body><script type="module">import {loadDataset} from "/science-nested/src/simulation/dataset.ts";'
            + 'window.scienceLoadDataset = loadDataset;</script></body></html>')
        })
      },
    }],
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Expected TCP server address')
    const origin = `http://127.0.0.1:${address.port}`
    const channel = existsSync(chromium.executablePath()) ? undefined : 'chrome'
    browser = await chromium.launch({ headless: true, channel })
    const page = await browser.newPage()
    const requests: string[] = []
    page.on('request', request => requests.push(request.url()))
    await page.goto(`${origin}/science-nested/worker-probe`)
    await page.waitForFunction('typeof window.scienceLoadDataset === "function"')
    const result = await page.evaluate(async () => {
      const NativeWorker = window.Worker
      const evidence = { workers: 0, arrays: 0, bytes: 0, float64: false, refinement: 0 }
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options)
          evidence.workers++
          this.addEventListener('message', event => {
            if (event.data.type !== 'ready') return
            const tracks = Object.values(event.data.payload.ephemeris.tracks) as {
              id: string; samples: Float64Array; count: number
            }[]
            evidence.arrays = tracks.length
            evidence.bytes = tracks.reduce((sum, track) => sum + track.samples.byteLength, 0)
            evidence.float64 = tracks.every(track => track.samples instanceof Float64Array)
            evidence.refinement = tracks.find(track => track.id === 'phobos@refined')!.count
          })
        }
      }
      const loadDataset = (window as unknown as { scienceLoadDataset: () => Promise<Dataset> }).scienceLoadDataset
      const data = await loadDataset()
      const first = data.evaluate(data.firstJd)
      const last = data.evaluate(data.lastJd)
      return {
        ...evidence, bodyCount: data.bodies.length, stateCount: Object.keys(first.states).length,
        firstUtc: data.jdToUtc(data.firstJd), lastUtc: data.jdToUtc(data.lastJd),
        earthFirst: first.states.earth.position, earthLast: last.states.earth.position,
        trajectoryCount: data.trajectory('sedna').length,
      }
    })
    expect(result).toMatchObject({
      workers: 1, arrays: 72, bytes: 657072 * 56, float64: true, refinement: 35041,
      bodyCount: 71, stateCount: 71, trajectoryCount: 512,
      firstUtc: '2026-09-05T00:00:00.000Z', lastUtc: '2027-09-05T00:00:00.000Z',
    })
    expect(result.earthFirst).not.toEqual(result.earthLast)
    expect(requests.every(url => url.startsWith(`${origin}/`))).toBe(true)
    expect(requests.some(url => url.includes('/science-nested/data/states.bin'))).toBe(true)
    expect(requests.some(url => url.includes('dataset.worker'))).toBe(true)
  } finally {
    await browser?.close()
    await server.close()
    if (previousTmp === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = previousTmp
    await rm(runtime, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}, 30000)
