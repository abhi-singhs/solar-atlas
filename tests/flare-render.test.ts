import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { existsSync } from 'node:fs'
import { FLARE_ANGLE, GHOSTS, flareLayout, ghostCenters } from '../src/render/flare'
import type { FlareFrame } from '../src/render/flare'

type Layer = 'starburst' | 'ghosts'
interface Point { x: number; y: number }
interface Sample { rgb: [number, number, number]; value: number }
declare global {
  interface Window {
    flareFixture: {
      render(frame: FlareFrame, layers?: Layer[]): { drawn: boolean; total: number; peak: Point }
      sample(points: Point[]): Sample[]
      lit(threshold?: number): Point[]
    }
  }
}

let browser: Browser
let server: ViteDevServer
let page: Page

beforeAll(async () => {
  server = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing flare fixture server port.')
  browser = await chromium.launch({
    channel: existsSync(chromium.executablePath()) ? 'chromium' : 'chrome',
    args: ['--use-angle=metal'],
  })
  page = await browser.newPage({ viewport: { width: 400, height: 300 } })
  await page.goto(`http://127.0.0.1:${address.port}/tests/flare-fixture.html`)
  await page.waitForFunction(() => Boolean(window.flareFixture), null, { timeout: 90000 })
}, 120000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

const frame = (patch: Partial<FlareFrame> = {}): FlareFrame =>
  ({ x: 120, y: 100, width: 400, height: 300, sunPixels: 5, strength: 1, ...patch })
const render = (value: FlareFrame, layers?: Layer[]) =>
  page.evaluate(([f, l]) => window.flareFixture.render(f!, l), [value, layers] as const)
const sample = (points: Point[]) => page.evaluate(p => window.flareFixture.sample(p), points)
/** Screen points along a ray from the Sun. Angles count counterclockwise on screen, as in the shader. */
const ray = (f: FlareFrame, angle: number, radii: number[]) =>
  radii.map(r => ({ x: f.x + r * Math.cos(angle), y: f.y - r * Math.sin(angle) }))
const mean = (samples: Sample[]) => samples.reduce((sum, s) => sum + s.value, 0) / samples.length
const radii = Array.from({ length: 41 }, (_, i) => 20 + i * 2)
const spikeAngles = Array.from({ length: 6 }, (_, k) => FLARE_ANGLE + k * Math.PI / 3)
const gapAngles = spikeAngles.flatMap(a => [20, 30, 40].map(d => a + d * Math.PI / 180))
const along = (f: FlareFrame, angles: number[]) => sample(angles.flatMap(a => ray(f, a, radii))).then(mean)

describe('sun flare shader', () => {
  it('centers a saturated core on the Sun in top-left CSS coordinates', async () => {
    const result = await render(frame())
    expect(result.drawn).toBe(true)
    expect(Math.hypot(result.peak.x - 120, result.peak.y - 100)).toBeLessThan(1.5)
    const [core] = await sample([{ x: 120, y: 100 }])
    expect(core!.value).toBeGreaterThan(1)
  })

  it('draws six diffraction spikes at the aperture angles', async () => {
    await render(frame(), ['starburst'])
    const spikes = await along(frame(), spikeAngles)
    const gaps = await along(frame(), gapAngles)
    expect(spikes).toBeGreaterThan(.1)
    expect(spikes).toBeGreaterThan(5 * gaps)
  })

  it('keeps a warm glow between the spikes', async () => {
    await render(frame(), ['starburst'])
    const glow = await sample(gapAngles.map(a => ray(frame(), a, [25])[0]!))
    const rgb = glow.reduce((sum, s) => sum.map((c, i) => c + s.rgb[i]!), [0, 0, 0])
    expect(rgb[0]).toBeGreaterThan(rgb[2]! * 1.2)
  })

  it('places every ghost on the line from the Sun through the screen center', async () => {
    const f = frame()
    await render(f, ['ghosts'])
    const centers = await sample(ghostCenters(f))
    for (const center of centers) expect(center.value).toBeGreaterThan(0)
    const points = await page.evaluate(() => window.flareFixture.lit())
    expect(points.length).toBeGreaterThan(100)
    const dx = f.width / 2 - f.x, dy = f.height / 2 - f.y, length = Math.hypot(dx, dy)
    const largest = Math.max(...GHOSTS.map(ghost => ghost.size)) * Math.min(f.width, f.height)
    for (const p of points) expect(Math.abs((p.x - f.x) * dy - (p.y - f.y) * dx) / length).toBeLessThan(largest + 1)
    const beyond = points.filter(p => (p.x - f.x) * dx + (p.y - f.y) * dy > length * length)
    expect(beyond.length).toBeGreaterThan(points.length / 2)
  })

  it('scales with strength and draws nothing at zero', async () => {
    const full = await render(frame())
    const half = await render(frame({ strength: .5 }))
    expect(half.total).toBeLessThan(full.total / 2)
    expect(half.total).toBeGreaterThan(0)
    const none = await render(frame({ strength: 0 }))
    expect(none.drawn).toBe(false)
    expect(none.total).toBe(0)
  })

  it('leaves only the glow when the solar disc fills the view', async () => {
    const f = frame({ x: 200, y: 150, sunPixels: 200 })
    expect(flareLayout(f).rays).toBe(0)
    await render(f)
    const spikes = await along(f, spikeAngles)
    expect(spikes).toBeGreaterThan(1)
    expect(spikes / await along(f, gapAngles)).toBeCloseTo(1, 1)
    const ghosts = await render(f, ['ghosts'])
    expect(ghosts.total).toBe(0)
  })
})
