import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { existsSync } from 'node:fs'
import { SHIPS } from '../src/cockpit/ships'

type View = 'hangar' | 'chase' | 'cockpit'
declare global {
  interface Window {
    shipFixture: { ids: string[]; render(id: string, view: View, width?: number, height?: number): Promise<{ coverage: number; errors: string[] }> }
  }
}

let browser: Browser
let server: ViteDevServer
let page: Page
const pageErrors: string[] = []

beforeAll(async () => {
  server = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing ship fixture server port.')
  browser = await chromium.launch({
    channel: existsSync(chromium.executablePath()) ? 'chromium' : 'chrome',
    args: ['--use-angle=metal'],
  })
  page = await browser.newPage({ viewport: { width: 480, height: 300 } })
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()) })
  await page.goto(`http://127.0.0.1:${address.port}/tests/ship-fixture.html`)
  await page.waitForFunction(() => Boolean(window.shipFixture), null, { timeout: 90000 })
}, 120000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

/** Smallest share of the frame each view must cover. The cockpit frames the view, so it covers more. */
const MIN_COVERAGE: Record<View, number> = { hangar: 0.02, chase: 0.01, cockpit: 0.08 }

describe('ship models in WebGL', () => {
  it('lists the same ships as the registry', async () => {
    expect(await page.evaluate(() => window.shipFixture.ids)).toEqual(SHIPS.map(ship => ship.id))
  })

  it.each(SHIPS.flatMap(ship => (['hangar', 'chase', 'cockpit'] as const).map(view => [ship.id, view] as const)))(
    '%s draws a visible %s view without shader errors', async (id, view) => {
      const result = await page.evaluate(([ship, v]) => window.shipFixture.render(ship!, v as View, 480, 300), [id, view])
      expect(result.errors).toEqual([])
      expect(result.coverage).toBeGreaterThan(MIN_COVERAGE[view])
      expect(result.coverage).toBeLessThan(view === 'cockpit' ? 0.9 : 0.8)
      expect(pageErrors).toEqual([])
    })
})
