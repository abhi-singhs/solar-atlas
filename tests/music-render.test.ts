import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { existsSync } from 'node:fs'
import { musicMood, SILENT } from '../src/audio/score'
import type { Mood, MoodInput } from '../src/audio/score'

interface Segment { at: number; mood: Mood }
interface RenderRequest { seconds: number; segments: Segment[]; windows: [number, number][]; seed?: number }
interface WindowStats { finite: boolean; peak: number; rms: number; brightness: number }
declare global {
  interface Window { musicFixture: { render(request: RenderRequest): Promise<WindowStats[]> } }
}

let browser: Browser
let server: ViteDevServer
let page: Page

beforeAll(async () => {
  server = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing music fixture server port.')
  browser = await chromium.launch({ channel: existsSync(chromium.executablePath()) ? 'chromium' : 'chrome' })
  page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${address.port}/tests/music-fixture.html`)
  await page.waitForFunction(() => Boolean(window.musicFixture), null, { timeout: 60000 })
}, 90000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

const render = (request: RenderRequest) => page.evaluate(value => window.musicFixture.render(value), request)
const flight: MoodInput = { music: true, musicVolume: 1, inShip: true, playing: true, shipMode: 'free', warp: false, speedC: 0.01 }
const cruise = musicMood(flight)
/** Pads take six seconds to swell, so steady-state windows start after that. */
const steady = (mood: Mood, seed?: number) => render({ seconds: 26, segments: [{ at: 0, mood }], windows: [[8, 26]], seed }).then(([stats]) => stats)

describe('space music synthesis', () => {
  it('plays a finite, audible mix that stays below full scale', async () => {
    const stats = await steady(cruise)
    expect(stats.finite).toBe(true)
    expect(stats.rms).toBeGreaterThan(0.03)
    expect(stats.peak).toBeLessThan(0.9)
  })

  it('is silent until the mood asks for sound', async () => {
    const [stats] = await render({ seconds: 6, segments: [{ at: 0, mood: SILENT }], windows: [[0, 6]] })
    expect(stats.peak).toBe(0)
  })

  it('fades out after flight pauses', async () => {
    const paused = musicMood({ ...flight, playing: false })
    const [before, after] = await render({ seconds: 20, segments: [{ at: 0, mood: cruise }, { at: 12, mood: paused }], windows: [[8, 12], [16, 20]] })
    expect(before.rms).toBeGreaterThan(0.03)
    expect(after.peak).toBeLessThan(before.peak * 0.01)
  })

  it('brightens at warp', async () => {
    const warp = await steady(musicMood({ ...flight, warp: true, speedC: 100 }))
    const base = await steady(cruise)
    expect(warp.peak).toBeLessThan(0.9)
    expect(warp.brightness).toBeGreaterThan(base.brightness * 1.5)
  })

  it('thins to a quieter drone after landing', async () => {
    const landed = await steady(musicMood({ ...flight, shipMode: 'landed' }))
    const base = await steady(cruise)
    expect(landed.rms).toBeGreaterThan(0.005)
    expect(landed.rms).toBeLessThan(base.rms * 0.6)
    expect(landed.brightness).toBeLessThan(base.brightness)
  })

  it('follows the volume setting', async () => {
    const half = await steady(musicMood({ ...flight, musicVolume: 0.5 }))
    const full = await steady(cruise)
    expect(half.rms / full.rms).toBeGreaterThan(0.2)
    expect(half.rms / full.rms).toBeLessThan(0.35)
  })

  // Chrome's offline renderer differs in the last float bits between runs, so "the same" means within a millionth.
  it('repeats for the same seed and changes with another', async () => {
    const [first, second, other] = await Promise.all([steady(cruise, 11), steady(cruise, 11), steady(cruise, 12)])
    const change = (a: WindowStats, b: WindowStats) => Math.abs(a.rms - b.rms) / a.rms
    expect(change(first, second)).toBeLessThan(1e-6)
    expect(change(first, other)).toBeGreaterThan(1e-3)
  })
})
