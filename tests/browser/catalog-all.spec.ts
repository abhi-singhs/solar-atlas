import { test, expect } from '@playwright/test'
import { AU_KM, bodyRadius } from '../../src/contracts'
import type { Body } from '../../src/contracts'

test('visits every source body without missing assets', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Full catalog asset coverage is shared across responsive layouts.')
  test.setTimeout(180000)
  const failures: string[] = []
  page.on('pageerror', error => failures.push(error.message))
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()) })
  page.on('response', response => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`)
  })
  await page.goto('/?scoutTheme=dark')
  await expect(page.locator('.catalog-toggle')).toBeVisible({ timeout: 90000 })
  const response = await page.request.get('/data/catalog.json')
  const catalog = await response.json() as { bodies: Body[] }
  expect(catalog.bodies).toHaveLength(71)
  await page.locator('.catalog-toggle').click()
  const search = page.getByRole('textbox', { name: 'Search bodies' })
  for (const body of catalog.bodies) {
    await search.fill(body.name)
    await page.getByRole('region', { name: 'Body catalog' }).getByRole('button', { name: `Select ${body.name}`, exact: true }).click()
    const framing = body.id === 'quaoar' ? 25 : body.id === 'saturn' ? 7 :
      ['uranus', 'neptune', 'chariklo', 'haumea'].includes(body.id) ? 10 : 3.5
    await expect.poll(async () => {
      const text = await page.locator('.world-subtitle').innerText()
      const match = text.match(/([\d,.]+)\s+(km|m|AU) to center/)
      if (!match) return Infinity
      const shown = Number(match[1].replaceAll(',', '')) * (match[2] === 'AU' ? AU_KM : match[2] === 'm' ? 0.001 : 1)
      return Math.abs(shown - bodyRadius(body) * framing)
    }).toBeLessThan(0.011)
    await page.waitForTimeout(80)
  }
  expect(failures).toEqual([])
})
