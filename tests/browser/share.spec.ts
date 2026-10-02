import { test, expect } from '@playwright/test'
import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test'

const SETTINGS_KEY = 'solar-atlas-settings-v1'
// What the recipient already has saved. A shared link must leave all of it alone.
const recipientSettings = { version: 1, labels: true, paths: false, quality: 'low', exposure: 0, fov: 50, lensFlare: true,
  glareHidesStars: true, music: false, musicVolume: 0.7, pauseInBackground: true, shipModel: 'kestrel', bookmarks: [] }

async function ready(page: Page) {
  // A link can hide the interface, so this waits for the catalog button to exist rather than to show.
  await expect(page.getByRole('button', { name: 'Find a world', includeHidden: true })).toBeAttached({ timeout: 90000 })
  await expect(page.locator('.loading-screen')).toBeHidden()
}

async function setFlightPanel(page: Page, open: boolean) {
  const toggle = page.getByRole('button', { name: 'Toggle flight panel' })
  if (await toggle.getAttribute('aria-expanded') !== String(open)) await toggle.click()
}

const saved = async (page: Page) => JSON.parse(await page.evaluate(key => localStorage.getItem(key) ?? '{}', SETTINGS_KEY))

/** A second browser profile with its own saved settings, standing in for the person who receives the link. */
async function recipient(browser: Browser, testInfo: TestInfo): Promise<BrowserContext> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL } = testInfo.project.use
  const context = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL })
  await context.addInitScript(([key, value]) => { if (!localStorage.getItem(key)) localStorage.setItem(key, value) },
    [SETTINGS_KEY, JSON.stringify(recipientSettings)] as const)
  return context
}

test('shares a route that opens on a Begin journey screen with the interface hidden', async ({ page, browser }, testInfo) => {
  test.setTimeout(240000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/?scoutTheme=dark')
  await ready(page)

  const settings = page.getByRole('dialog', { name: 'Settings' })
  await page.getByRole('button', { name: 'Settings' }).click()
  await settings.getByRole('combobox', { name: 'Spaceship' }).selectOption('voyager')
  await settings.getByRole('checkbox', { name: /^Body labels/ }).uncheck()
  await settings.getByRole('button', { name: 'Close dialog' }).click()

  await page.getByRole('button', { name: 'Spaceship', exact: true }).click()
  await setFlightPanel(page, true)
  const route = page.getByRole('region', { name: 'Route' })
  await route.getByRole('button', { name: 'Add destination' }).click()
  const search = page.getByRole('textbox', { name: 'Search bodies' })
  const catalog = page.getByRole('region', { name: 'Body catalog' })
  for (const name of ['Moon', 'Mars']) {
    await search.fill(name)
    await catalog.getByRole('button', { name: `Add ${name} to route` }).click()
  }
  await page.getByRole('button', { name: 'Close catalog' }).click()
  await setFlightPanel(page, true)
  await route.getByRole('listitem').first().getByRole('button', { name: 'Land', exact: true }).click()

  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const share = page.getByRole('dialog', { name: 'Share this journey' })
  await expect(share).toContainText('Begin journey screen')
  await expect(share.locator('.journey-summary')).toContainText('Moon')
  await expect(share.locator('.journey-summary')).toContainText('Mars')
  await expect(share.locator('.journey-summary')).toContainText('Voyager, cockpit')
  await share.getByRole('checkbox', { name: 'Open with the interface hidden' }).check()
  await share.getByRole('checkbox', { name: 'Space music' }).check()
  await expect(share.locator('.journey-summary')).toContainText('On, 70% volume')
  const link = await share.getByRole('textbox', { name: 'Share link' }).inputValue()
  expect(link).toMatch(/^http:\/\/127\.0\.0\.1:4173\/\?v=1&mode=ship&body=earth&t=2026-09-0\dT\d\d:\d\d:\d\dZ&route=moon~land,mars&/)
  for (const part of ['continue=1', 'autospeed=1', 'look=cockpit', 'warp=0', 'ship=voyager', 'labels=0', 'music=1', 'vol=0.7', 'theme=dark', 'ui=hidden']) {
    expect(link).toContain(part)
  }
  await share.getByRole('button', { name: 'Copy link' }).click()
  await expect(share.getByRole('button', { name: 'Copied' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link)
  if (testInfo.project.name === 'desktop') await page.screenshot({ path: 'artifacts/desktop-share-dialog.png' })
  await share.getByRole('button', { name: 'Close dialog' }).click()

  const other = await recipient(browser, testInfo)
  const guest = await other.newPage()
  guest.on('pageerror', error => errors.push(error.message))
  await guest.goto(link)
  await ready(guest)
  const begin = guest.getByRole('dialog', { name: 'Shared journey' })
  await expect(begin).toBeVisible()
  await expect(begin.locator('.journey-summary')).toContainText('Earth')
  await expect(begin.locator('.journey-summary li').first()).toContainText('MoonLand')
  await expect(begin.locator('.journey-summary li').last()).toContainText('MarsPark nearby')
  await expect(begin.locator('.journey-summary')).toContainText('Voyager')
  await expect(begin).toContainText('with music on')
  await expect(begin.getByRole('button', { name: 'Begin journey' })).toBeFocused()
  await expect(guest.locator('main.atlas')).toHaveClass(/ui-hidden/)
  await expect(guest.locator('.notice.warning')).toHaveCount(0)
  if (testInfo.project.name === 'desktop') await guest.screenshot({ path: 'artifacts/desktop-begin-journey.png' })
  expect(await saved(guest)).toEqual(recipientSettings)

  await begin.getByRole('button', { name: 'Begin journey' }).click()
  await expect(begin).toBeHidden()
  // The phone starts with the flight panel collapsed, which shows only the route button, so check the button both layouts share.
  await expect(guest.locator('.flight-panel')).toContainText('Pause route')
  await expect(guest.locator('main.atlas')).toHaveAttribute('data-music', 'running')
  await guest.getByRole('button', { name: 'Show interface' }).click()
  await expect(guest.getByRole('region', { name: 'Spacecraft controls' })).toBeVisible()

  await guest.getByRole('button', { name: 'Settings' }).click()
  const guestSettings = guest.getByRole('dialog', { name: 'Settings' })
  await expect(guestSettings.getByRole('combobox', { name: 'Spaceship' })).toHaveValue('voyager')
  await expect(guestSettings.getByRole('checkbox', { name: /^Body labels/ })).not.toBeChecked()
  // Changing one setting saves only that one, so the shared ship and labels still stay out of storage.
  await guestSettings.getByRole('slider', { name: 'Field of view' }).fill('70')
  expect(await saved(guest)).toEqual({ ...recipientSettings, fov: 70 })
  await other.close()
  expect(errors).toEqual([])
})

test('opens an Explore link on the shared body, date, camera, and settings', async ({ browser }, testInfo) => {
  const context = await recipient(browser, testInfo)
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?v=1&mode=explore&body=mars&t=2027-01-15T06:00:00Z&cam=follow&labels=0&ev=1.5&theme=light')
  await ready(page)
  await expect(page.locator('.world-heading h1')).toHaveText('Mars')
  await expect(page.locator('.date-button')).toContainText('2027-01-15 06:00:00')
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('dialog', { name: 'Shared journey' })).toHaveCount(0)
  await expect(page.locator('.notice')).toHaveCount(0)
  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('checkbox', { name: /^Body labels/ })).not.toBeChecked()
  await expect(settings.getByText('1.5 EV')).toBeVisible()
  await settings.getByRole('button', { name: 'Close dialog' }).click()
  expect(await saved(page)).toEqual(recipientSettings)

  // Sharing again from here carries the same view forward.
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const link = await page.getByRole('dialog', { name: 'Share this journey' }).getByRole('textbox', { name: 'Share link' }).inputValue()
  expect(link).toContain('?v=1&mode=explore&body=mars&t=2027-01-15T06:00:00Z&cam=follow&view=')
  expect(link).toContain('labels=0')
  expect(link).toContain('ev=1.5')
  expect(link).toContain('theme=light')
  await context.close()
  expect(errors).toEqual([])
})

test('drops the bad parts of a link, applies the rest, and says what it ignored', async ({ browser }, testInfo) => {
  const context = await recipient(browser, testInfo)
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/?v=1&body=vulcan&fov=200&labels=0&t=2030-01-01&route=moon,atlantis')
  await ready(page)
  const begin = page.getByRole('dialog', { name: 'Shared journey' })
  await expect(begin).toBeVisible()
  await expect(begin.locator('.journey-summary li')).toHaveCount(1)
  await expect(begin.locator('.journey-summary li')).toContainText('Moon')
  const notice = page.locator('.notice.warning')
  await expect(notice).toContainText('Parts of this shared link were ignored')
  for (const part of ['fov=200', 'body=vulcan', 't=2030-01-01T00:00:00Z', 'route stop atlantis']) await expect(notice).toContainText(part)
  await begin.getByRole('button', { name: 'Look around first' }).click()
  await expect(begin).toBeHidden()
  await expect(page.locator('.world-heading h1')).toHaveText('Earth')
  await setFlightPanel(page, true)
  const route = page.getByRole('region', { name: 'Route' })
  await expect(route.getByRole('listitem')).toHaveCount(1)
  await expect(route.getByRole('button', { name: 'Start route' })).toBeVisible()
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' }).getByRole('checkbox', { name: /^Body labels/ })).not.toBeChecked()
  expect(await saved(page)).toEqual(recipientSettings)
  await context.close()
  expect(errors).toEqual([])
})

test('a shared route with no known stops never shows the Begin journey screen', async ({ browser }, testInfo) => {
  const context = await recipient(browser, testInfo)
  const page = await context.newPage()
  await page.goto('/?v=1&route=atlantis')
  await ready(page)
  await expect(page.locator('.notice.warning')).toContainText('route stop atlantis')
  await setFlightPanel(page, true)
  await page.locator('.universe').focus()
  await page.keyboard.press('+')
  await expect(page.getByRole('region', { name: 'Route' }).getByRole('listitem')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'Shared journey' })).toHaveCount(0)
  await context.close()
})
