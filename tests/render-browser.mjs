import { chromium } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
await page.goto('http://127.0.0.1:5173/tests/render-fixture.html?scoutTheme=dark')
await page.waitForFunction(() => !!window.renderTest, null, { timeout: 180000 })
if (process.argv.includes('--handshake')) {
  const landing = await page.evaluate(() => window.renderTest.flightLandingProbe())
  const provider = await page.evaluate(() => {
    const app = window.renderTest
    const terrain = app.renderer.terrain
    const original = terrain.sample
    let nullPreserved
    try {
      terrain.sample = () => null
      nullPreserved = app.renderer.surface.sample('bennu', [1, 0, 0]) === null
    } finally {
      terrain.sample = original
    }
    const patch = terrain.getPreparedPatch('bennu')
    return {
      nullPreserved,
      sourceAvailable: app.renderer.sourceSurface.sample('bennu', [1, 0, 0]) !== null,
      centerLocked: !terrain.needsRecenter('bennu', [0, 0, 1]),
      vertices: patch?.group.children[0]?.geometry.getAttribute('position').count,
      errors: [...app.errors],
    }
  })
  await writeFile('tests/render-handshake-evidence.json', JSON.stringify({ landing, provider, errors }, null, 2) + '\n')
  await browser.close()
  if (landing.telemetry.mode !== 'landed' || !provider.nullPreserved || !provider.sourceAvailable
    || !provider.centerLocked || provider.vertices !== 2401 || errors.length || provider.errors.length)
    throw new Error(`Shared terrain handshake failed: ${JSON.stringify({ landing, provider, errors })}`)
  console.log('Frozen 48-segment Bennu landing and explicit unavailable-surface propagation passed.')
  process.exit(0)
}
const evidence = {}
for (const id of ['earth', 'venus', 'saturn', 'jupiter', 'bennu', 'phobos', 'sedna']) {
  await page.evaluate(id => window.renderTest.focus(id), id)
  await page.waitForTimeout(350)
  await page.screenshot({ path: `tests/render-${id}.png` })
  evidence[id] = await page.evaluate(id => {
    const app = window.renderTest
    return { ...app.renderer.stats, status: app.renderer.getBodyAssetStatus(id).state,
      centerHit: app.renderer.pickSurface(innerWidth / 2, innerHeight / 2, id),
      sourceSample: app.renderer.surface.sample(id, [1, 0, 0]), errors: [...app.errors] }
  }, id)
  if (!evidence[id].centerHit || evidence[id].status !== 'ready') throw new Error(`${id} source mesh was not pickable`)
  if (evidence[id].errors.length) throw new Error(evidence[id].errors.join('\n'))
}
await page.evaluate(() => window.renderTest.focus('earth', 'high'))
await page.waitForTimeout(600)
await page.screenshot({ path: 'tests/render-earth-high.png' })
evidence.highQuality = await page.evaluate(() => window.renderTest.renderer.stats)
evidence.desktopFrameIntervals = await page.evaluate(async () => {
  const samples = []
  let previous
  for (let i = 0; i < 100; i++) {
    const now = await new Promise(resolve => requestAnimationFrame(resolve))
    if (previous !== undefined) samples.push(now - previous)
    previous = now
  }
  samples.sort((a, b) => a - b)
  return { medianMs: samples[49], p95Ms: samples[94], frames: samples.length }
})
evidence.lighting = await page.evaluate(() => window.renderTest.lightingProbe())
if (Math.abs(evidence.lighting.ratio - .25) > 1e-5 || evidence.lighting.eclipseRadiance !== 0)
  throw new Error(`Physical radiance probe failed: ${JSON.stringify(evidence.lighting)}`)
evidence.terrain = await page.evaluate(() => window.renderTest.terrainView('earth'))
if (!evidence.terrain.patch) throw new Error('Terrain activation was lost during a render-geometry transition')
await page.waitForTimeout(300)
await page.screenshot({ path: 'tests/render-terrain.png' })
evidence.millimeterTerrain = await page.evaluate(() => window.renderTest.terrainView('earth', .000001))
await page.waitForTimeout(150)
evidence.bennuLanding = await page.evaluate(() => window.renderTest.flightLandingProbe())
if (evidence.bennuLanding.telemetry.mode !== 'landed'
  || evidence.bennuLanding.patch?.revision !== evidence.bennuLanding.renderedPatch?.revision)
  throw new Error(`Shared Bennu landing failed: ${JSON.stringify(evidence.bennuLanding)}`)
evidence.finalErrors = await page.evaluate(() => [...window.renderTest.errors])
await page.setViewportSize({ width: 390, height: 844 })
await page.evaluate(() => window.renderTest.focus('earth', 'low'))
await page.waitForTimeout(300)
await page.screenshot({ path: 'tests/render-mobile.png' })
evidence.errors = errors
await writeFile('tests/render-browser-evidence.json', JSON.stringify(evidence, null, 2) + '\n')
await browser.close()
if (errors.length || evidence.finalErrors.length) throw new Error([...errors, ...evidence.finalErrors].join('\n'))
console.log('Seven source body captures, mesh picking, and high-quality Earth passed without browser errors.')
