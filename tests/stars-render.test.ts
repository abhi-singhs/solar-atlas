import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { existsSync } from 'node:fs'
import { AU_KM } from '../src/contracts'
import type { Quality, Vec3 } from '../src/contracts'
import { J2000_JD, JULIAN_YEAR_DAYS, PARSEC_KM, STAR_GAMMA, starDirection } from '../src/render/stars'

interface Aim {
  ra: number; dec: number; fov: number; jd?: number; observerKm?: Vec3; fluxScale?: number; size?: number
  quality?: Quality; layers?: ('sky' | 'bright' | 'faint')[]
}
interface Probe { size: number; centroid: { x: number; y: number }; energy: number; rgb: Vec3; peakRgb: Vec3; mean: number }
declare global {
  interface Window {
    starFixture: {
      bright: number
      faint: number
      epochJd: number
      probe(settings: Aim): Probe
      apparent(id: number, observerKm?: Vec3, jd?: number): { ra: number; dec: number; magnitude: number; catalog: { ra: number; dec: number } }
    }
  }
}

let browser: Browser
let server: ViteDevServer
let page: Page
const SIRIUS = 32349, BETELGEUSE = 27989, ARCTURUS = 69673, ALPHA_CEN_A = 71683
/** Exposure that keeps first-magnitude stars below display white, so centroids see the whole profile. */
const DIM = .001

beforeAll(async () => {
  server = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing star fixture server port.')
  browser = await chromium.launch({
    channel: existsSync(chromium.executablePath()) ? 'chromium' : 'chrome',
    args: ['--use-angle=metal'],
  })
  page = await browser.newPage({ viewport: { width: 320, height: 240 } })
  await page.goto(`http://127.0.0.1:${address.port}/tests/stars-fixture.html`)
  await page.waitForFunction(() => Boolean(window.starFixture), null, { timeout: 90000 })
}, 120000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

const probe = (settings: Aim) => page.evaluate(value => window.starFixture.probe(value), settings)
const apparent = (id: number, observerKm?: Vec3, jd?: number) =>
  page.evaluate(([star, observer, date]) => window.starFixture.apparent(star!, observer, date), [id, observerKm, jd] as const)
const offset = (result: Probe) => Math.hypot(result.centroid.x - result.size / 2, result.centroid.y - result.size / 2)
/** Pixels from the center of a square target for an angle off the view axis. */
const pixels = (angleRad: number, fov: number, size: number) => size / 2 * Math.tan(angleRad) / Math.tan(fov * Math.PI / 360)
const between = (a: { ra: number; dec: number }, b: { ra: number; dec: number }) => {
  const u = starDirection(a.ra, a.dec), v = starDirection(b.ra, b.dec)
  return Math.acos(Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))
}

describe('star field shader', () => {
  it('loads both tiers and centers Sirius on its catalog direction', async () => {
    expect(await page.evaluate(() => [window.starFixture.bright, window.starFixture.faint])).toEqual([41075, 1444743])
    const sirius = await apparent(SIRIUS)
    const result = await probe({ ra: sirius.ra, dec: sirius.dec, fov: 2, fluxScale: DIM })
    expect(offset(result)).toBeLessThan(.2)
    expect(result.rgb[2]).toBeGreaterThan(result.rgb[0])
  })

  it('colors a cool supergiant red-orange', async () => {
    const betelgeuse = await apparent(BETELGEUSE)
    const { rgb } = await probe({ ra: betelgeuse.ra, dec: betelgeuse.dec, fov: 2, fluxScale: DIM })
    expect(rgb[0]).toBeGreaterThan(rgb[1])
    expect(rgb[1]).toBeGreaterThan(rgb[2])
  })

  it('applies Hipparcos proper motion at the simulation date', async () => {
    const jd = J2000_JD + 100 * JULIAN_YEAR_DAYS
    const moved = await apparent(ARCTURUS, [0, 0, 0], jd)
    expect(offset(await probe({ ra: moved.ra, dec: moved.dec, fov: .5, jd, fluxScale: DIM }))).toBeLessThan(.2)
    const stale = await probe({ ra: moved.catalog.ra, dec: moved.catalog.dec, fov: .5, jd, fluxScale: DIM })
    expect(offset(stale)).toBeCloseTo(pixels(between(moved, moved.catalog), .5, stale.size), 0)
    expect(offset(stale)).toBeGreaterThan(10)
  })

  it('moves a nearby star with observer parallax', async () => {
    const observer: Vec3 = [0, 0, 1000 * AU_KM]
    const seen = await apparent(ALPHA_CEN_A, observer)
    expect(offset(await probe({ ra: seen.ra, dec: seen.dec, fov: 2, observerKm: observer, fluxScale: DIM }))).toBeLessThan(.2)
    const stale = await probe({ ra: seen.catalog.ra, dec: seen.catalog.dec, fov: 1, observerKm: observer, fluxScale: DIM })
    expect(offset(stale)).toBeCloseTo(pixels(between(seen, seen.catalog), 1, stale.size), 0)
    expect(offset(stale)).toBeGreaterThan(8)
  })

  it('brightens a star by the inverse square of the observer distance before the tone curve', async () => {
    const sirius = await apparent(SIRIUS)
    const halfway = starDirection(sirius.ra, sirius.dec).map(x => x * PARSEC_KM / .3792 / 2) as Vec3
    const aim = { ra: sirius.ra, dec: sirius.dec, fov: 2, fluxScale: .0002 }
    const near = await probe({ ...aim, observerKm: halfway })
    const far = await probe(aim)
    const peak = ({ peakRgb: [r, g, b] }: Probe) => .2126 * r + .7152 * g + .0722 * b
    expect(peak(near) / peak(far)).toBeCloseTo(4 ** STAR_GAMMA, 2)
    expect(Math.max(...near.peakRgb)).toBeLessThan(1)
  })
})

describe('Milky Way map', () => {
  const sky = (ra: number, dec: number, fov = 2, quality: Quality = 'high') =>
    probe({ ra, dec, fov, size: 32, quality, layers: ['sky'] }).then(result => result.mean)

  it('registers the NASA map with right ascension increasing eastward', async () => {
    for (const quality of ['low', 'high'] as const) {
      const lmc = await sky(80.9, -69.76, 4, quality)
      expect(lmc, quality).toBeGreaterThan(3 * await sky(360 - 80.9, -69.76, 4, quality))
    }
  })

  it('keeps the galactic pole dark, the Scutum cloud bright, and the Coalsack dark against Crux', async () => {
    const scutum = await sky(280.6, -8)
    expect(scutum).toBeGreaterThan(50 * await sky(192.86, 27.13))
    expect(scutum).toBeLessThan(1)
    expect(await sky(176, -61)).toBeGreaterThan(2 * await sky(192.5, -62.5))
  })
})
