// Saves exterior, chase, and cockpit screenshots of ships for visual review.
// Usage: node tests/ship-shots.mjs [ship-id ...]   Writes artifacts/ships/<id>-<view>.png.
import { chromium } from '@playwright/test'
import { createServer } from 'vite'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'

const server = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
await server.listen()
const { port } = server.httpServer.address()
const browser = await chromium.launch({ channel: existsSync(chromium.executablePath()) ? 'chromium' : 'chrome', args: ['--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 960, height: 600 } })
const pageErrors = []
page.on('pageerror', error => pageErrors.push(error.message))
page.on('console', message => { if (message.type() === 'error') pageErrors.push(message.text()) })
await page.goto(`http://127.0.0.1:${port}/tests/ship-fixture.html`)
await page.waitForFunction(() => Boolean(window.shipFixture), null, { timeout: 90000 })
const all = await page.evaluate(() => window.shipFixture.ids)
const ids = process.argv.slice(2).length ? process.argv.slice(2) : all
await mkdir('artifacts/ships', { recursive: true })
let failed = false
for (const id of ids) {
  if (!all.includes(id)) { console.error(`Unknown ship ${id}. Known: ${all.join(', ')}`); failed = true; continue }
  for (const view of ['hangar', 'chase', 'cockpit']) {
    const result = await page.evaluate(([ship, v]) => window.shipFixture.render(ship, v), [id, view])
    const path = `artifacts/ships/${id}-${view}.png`
    await page.screenshot({ path })
    console.log(`${path}  coverage ${(result.coverage * 100).toFixed(1)}%${result.errors.length ? `  errors: ${result.errors.join(' | ')}` : ''}`)
    if (result.errors.length) failed = true
  }
}
if (pageErrors.length) { console.error(pageErrors.join('\n')); failed = true }
await browser.close()
await server.close()
process.exit(failed ? 1 : 0)
