import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

async function openApp(page: Page) {
  await page.goto('/?scoutTheme=dark')
  await expect(page.getByRole('button', { name: 'Find a world' })).toBeVisible({ timeout: 90000 })
}

async function chooseBody(page: Page, name: string) {
  if (!await page.getByRole('textbox', { name: 'Search bodies' }).isVisible()) await page.getByRole('button', { name: 'Find a world' }).click()
  await page.getByRole('textbox', { name: 'Search bodies' }).fill(name)
  await page.getByRole('region', { name: 'Body catalog' }).getByRole('button', { name: `Select ${name}`, exact: true }).click()
  await expect(page.locator('.world-heading h1')).toHaveText(name)
  if (await page.getByRole('button', { name: 'Close catalog' }).isVisible()) await page.getByRole('button', { name: 'Close catalog' }).click()
}

async function setDetails(page: Page, open: boolean) {
  const toggle = page.locator('.body-card-toggle')
  if (await toggle.getAttribute('aria-expanded') !== String(open)) await toggle.click()
}

async function setFlightPanel(page: Page, open: boolean) {
  const toggle = page.getByRole('button', { name: 'Toggle flight panel' })
  if (await toggle.getAttribute('aria-expanded') !== String(open)) await toggle.click()
}

test('catalog, scale, rings, cached data, and rendering', async ({ page }, testInfo) => {
  const errors: string[] = []
  const external: string[] = []
  const origin = new URL(testInfo.project.use.baseURL ?? 'http://127.0.0.1:4173').origin
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) external.push(request.url()) })
  await openApp(page)
  const catalog = await page.request.get('/data/catalog.json')
  expect((await catalog.json()).bodies).toHaveLength(71)
  await expect(page.locator('.world-heading h1')).toHaveText('Earth')
  await setDetails(page, true)
  await expect(page.getByText('6,371 km', { exact: true })).toBeVisible()
  if (testInfo.project.name === 'phone') await setDetails(page, false)
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-earth.png` })
  await chooseBody(page, 'Saturn')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-saturn.png` })
  await chooseBody(page, 'Bennu')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-bennu.png` })
  await chooseBody(page, 'Sedna')
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-sedna.png` })
  await page.getByRole('button', { name: 'View', exact: true }).click()
  await page.getByRole('group', { name: 'View options' }).getByRole('button', { name: 'Solar system', exact: true }).click()
  await expect(page.getByRole('group', { name: 'View options' })).toBeHidden()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-system.png` })
  expect(errors).toEqual([])
  expect(external).toEqual([])
})

test('cockpit, c controls, travel, braking, and mobile controls', async ({ page }, testInfo) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Spaceship', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Spacecraft controls' })).toBeVisible()
  await setFlightPanel(page, true)
  await page.getByRole('spinbutton', { name: 'Commanded speed in c' }).fill('')
  await page.locator('.numeric-throttle').getByRole('button', { name: 'Set', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Enter a speed in c')
  await page.getByRole('button', { name: 'Dismiss message' }).click()
  await expect(page.getByRole('button', { name: 'Warp off' })).toBeVisible()
  await page.getByRole('button', { name: 'Warp off' }).click()
  await page.getByRole('spinbutton', { name: 'Commanded speed in c' }).fill('1000')
  await page.locator('.numeric-throttle').getByRole('button', { name: 'Set', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Warp on' })).toBeVisible()
  await chooseBody(page, 'Moon')
  await page.getByRole('button', { name: 'Travel', exact: true }).click()
  await expect(page.getByTestId('ship-status')).toContainText(/transfer|approach|hover|free/i)
  await page.waitForTimeout(1000)
  await page.getByRole('button', { name: 'Brake', exact: true }).first().click()
  await page.getByRole('button', { name: 'Chase view', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-ship-chase.png` })
  await page.getByRole('button', { name: 'Cockpit', exact: true }).click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `artifacts/${testInfo.project.name}-cockpit.png` })
  if (testInfo.project.name === 'phone') {
    await setFlightPanel(page, false)
    await expect(page.getByRole('group', { name: 'Touch flight controls' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Travel', exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'Explore', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Simulation timeline' })).toBeVisible()
})

test('timeline boundaries, bookmarks, shortcuts, and local source links', async ({ page }, testInfo) => {
  await openApp(page)
  await page.getByRole('button', { name: 'Play simulation' }).click()
  await expect(page.getByRole('button', { name: 'Pause simulation' })).toBeVisible()
  await page.getByRole('button', { name: 'Pause simulation' }).click()
  await setDetails(page, true)
  await page.getByRole('button', { name: 'Bookmark this body' }).click()
  await expect(page.getByRole('status')).toContainText('Saved')
  await page.getByRole('button', { name: 'Dismiss message' }).click()
  if (testInfo.project.name === 'phone') await setDetails(page, false)
  await page.getByRole('button', { name: 'Find a world' }).click()
  await page.getByRole('group', { name: 'Catalog filters' }).getByRole('button', { name: /^Saved/ }).click()
  await expect(page.locator('.bookmark-row')).toHaveCount(1)
  await page.getByRole('button', { name: 'Close catalog' }).click()
  await page.locator('.date-button').click()
  await page.getByLabel('UTC date', { exact: true }).fill('2027-09-05T00:00')
  await page.getByRole('button', { name: 'Set UTC date' }).click()
  await expect(page.getByRole('group', { name: 'Choose a date' })).toBeHidden()
  await expect(page.locator('.date-button')).toContainText('2027-09-05')
  if (testInfo.project.name === 'desktop') {
    await page.locator('.universe').focus()
    await page.keyboard.press('h')
    await expect(page.getByRole('button', { name: 'Show interface' })).toBeVisible()
    await expect(page.locator('.topbar')).toBeHidden()
    await page.keyboard.press('h')
    await expect(page.locator('.topbar')).toBeVisible()
    await page.keyboard.press('3')
    await expect(page.getByRole('group', { name: 'Camera' }).getByRole('button', { name: 'Free', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('1')
    await page.keyboard.press('?')
    await expect(page.getByRole('dialog', { name: 'Controls and help' })).toBeVisible()
    await page.getByRole('button', { name: 'Close dialog' }).click()
  }
  await setDetails(page, true)
  await page.getByRole('button', { name: 'Data & credits' }).click()
  const link = page.getByRole('link', { name: 'Complete body catalog' })
  await expect(link).toHaveAttribute('href', /(?:^|\/)data\/catalog\.json$/)
  expect(new URL(await link.getAttribute('href') ?? '', page.url()).origin).toBe(new URL(page.url()).origin)
})

test('lands on source Earth geometry and takes off at 1x time', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Real-time landing is covered on desktop; touch events have their own native-input checks.')
  test.setTimeout(180000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openApp(page)
  await page.getByRole('button', { name: 'Pick site and land', exact: true }).click()
  await page.locator('.universe').click({ position: { x: 840, y: 270 } })
  await expect(page.getByTestId('ship-status')).toContainText(/landed/i, { timeout: 140000 })
  await expect(page.getByText('Reconstructed local terrain. Not measured topography.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Toggle flight panel' }).click()
  await page.screenshot({ path: 'artifacts/desktop-landed.png' })
  await page.getByRole('button', { name: 'Toggle flight panel' }).click()
  await expect(page.getByTestId('altitude')).toContainText(/\d/)
  await page.getByRole('button', { name: 'Take off', exact: true }).click()
  await expect(page.getByTestId('ship-status')).toContainText(/takeoff|free/i)
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'artifacts/desktop-takeoff.png' })
  expect(errors).toEqual([])
})

test('completes an assisted Earth-to-Moon transfer using the source states', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Transfer physics uses the same controller on touch devices.')
  test.setTimeout(140000)
  await openApp(page)
  await page.getByRole('button', { name: 'Spaceship', exact: true }).click()
  await page.getByRole('button', { name: 'Pause flight', exact: true }).click()
  await chooseBody(page, 'Moon')
  await page.getByRole('button', { name: 'Warp off' }).click()
  await page.getByRole('spinbutton', { name: 'Commanded speed in c' }).fill('1000')
  await page.locator('.numeric-throttle').getByRole('button', { name: 'Set', exact: true }).click()
  await page.getByRole('button', { name: 'Travel', exact: true }).click()
  await expect.poll(async () => {
    const text = await page.locator('.world-subtitle').innerText()
    const match = text.match(/([\d,.]+)\s+km to center/)
    return match ? Number(match[1].replaceAll(',', '')) : Infinity
  }, { timeout: 110000 }).toBeLessThan(10000)
  await expect(page.getByTestId('ship-status')).toContainText(/hover|free/i, { timeout: 60000 })
  await page.getByRole('button', { name: 'Toggle flight panel' }).click()
  await page.screenshot({ path: 'artifacts/desktop-moon-arrival.png' })
})
