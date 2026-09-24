import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, devices } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync } from 'node:fs'
import * as THREE from 'three'
import { createFlightInput, setInputSource } from '../src/input/controls'
import type { FlightInput, InputController } from '../src/input/controls'
import { createCockpit, createShip, updateCockpit } from '../src/cockpit/models'

declare global {
  interface Window {
    inputFixture: {
      input: FlightInput
      controller: InputController
      render: (enabled: boolean) => void
      brakeCount: () => number
      unmount: () => void
    }
    inputModelReady: boolean
  }
}

let browser: Browser
let server: ViteDevServer
let url: string
const state = (page: Page) => page.evaluate(() => ({ ...window.inputFixture.input }))

beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    plugins: [react()],
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'error',
  })
  await server.listen()
  const address = server.httpServer!.address()
  if (!address || typeof address === 'string') throw new Error('Missing input fixture server port.')
  url = `http://127.0.0.1:${address.port}/tests/input-fixture.html`
  browser = await chromium.launch({
    channel: existsSync(chromium.executablePath()) ? 'chromium' : 'chrome',
    args: ['--use-angle=metal'],
  })
}, 60000)

afterAll(async () => {
  await browser?.close()
  await server?.close()
})

async function fixture(mobile = false, query = '') {
  const page = await browser.newPage(mobile ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 1000 } })
  await page.goto(url + query)
  await page.waitForFunction(() => Boolean(window.inputFixture))
  return page
}

async function pointer(page: Page, control: string, type: string, id: number, x = 0, y = 0) {
  const target = page.locator(`[data-control="${control}"]`)
  const box = await target.boundingBox()
  if (!box) throw new Error(`Missing ${control} control.`)
  await target.dispatchEvent(type, {
    pointerId: id, pointerType: 'touch', isPrimary: id === 1,
    button: 0, buttons: type === 'pointerup' ? 0 : 1,
    clientX: box.x + box.width * (0.5 + x * 0.34),
    clientY: box.y + box.height * (0.5 + y * 0.34),
    bubbles: true,
  })
}

describe('input state aggregation', () => {
  it('preserves viewport-drag look values when unrelated keys change', () => {
    const input = createFlightInput()
    input.lookX = 0.7
    input.lookY = -0.3
    const keys = Symbol('keyboard')
    setInputSource(input, keys, { forward: 1 })
    expect(input).toMatchObject({ forward: 1, lookX: 0.7, lookY: -0.3 })
    setInputSource(input, keys, null)
    expect(input).toMatchObject({ forward: 0, lookX: 0.7, lookY: -0.3 })
  })

  it('keeps independent sources and bounds the combined axes', () => {
    const input = createFlightInput()
    const keys = Symbol('keys')
    const finger = Symbol('finger')
    setInputSource(input, keys, { yaw: 1, brake: true })
    setInputSource(input, finger, { yaw: 0.5, lookX: -1 })
    expect(input.yaw).toBe(1)
    setInputSource(input, finger, null)
    expect(input.yaw).toBe(1)
    expect(input.lookX).toBe(0)
    expect(input.brake).toBe(true)
    setInputSource(input, keys, null)
    expect(input).toEqual(createFlightInput())
  })
})

describe('keyboard flight input', () => {
  it('maps all flight keys, opposing keys and brake without capturing disabled flight', async () => {
    const page = await fixture()
    await page.locator('#flight-canvas').focus()
    for (const [key, axis, value] of [
      ['w', 'forward', 1], ['s', 'forward', -1], ['a', 'yaw', 1], ['d', 'yaw', -1],
      ['q', 'roll', 1], ['e', 'roll', -1], ['r', 'vertical', 1], ['f', 'vertical', -1],
      ['ArrowUp', 'pitch', 1], ['ArrowDown', 'pitch', -1], ['ArrowLeft', 'yaw', 1], ['ArrowRight', 'yaw', -1],
    ] as const) {
      await page.keyboard.down(key)
      expect((await state(page))[axis]).toBe(value)
      await page.keyboard.up(key)
      expect((await state(page))[axis]).toBe(0)
    }
    await page.keyboard.down('w')
    await page.keyboard.down('s')
    expect((await state(page)).forward).toBe(0)
    await page.keyboard.up('s')
    expect((await state(page)).forward).toBe(1)
    for (const key of ['Shift', 'Space']) {
      await page.keyboard.down(key)
      expect((await state(page)).brake).toBe(true)
      await page.keyboard.up(key)
      expect((await state(page)).brake).toBe(false)
    }
    await page.evaluate(() => window.inputFixture.render(false))
    expect(await state(page)).toEqual(createFlightInput())
    expect(await page.evaluate(() => {
      const event = new KeyboardEvent('keydown', { code: 'ArrowDown', cancelable: true, bubbles: true })
      document.body.dispatchEvent(event)
      return event.defaultPrevented
    })).toBe(false)
    await page.close()
  })

  it('releases held keys on form focus and never captures text, select, slider, button or editable typing', async () => {
    const page = await fixture()
    for (const name of ['Flight text field', 'Flight select', 'Flight throttle', 'Flight editable', 'Disable flight']) {
      await page.locator('#flight-canvas').focus()
      await page.keyboard.down('w')
      expect((await state(page)).forward).toBe(1)
      const target = name === 'Disable flight' ? page.getByRole('button', { name }) : page.getByLabel(name)
      await target.focus()
      expect(await state(page)).toEqual(createFlightInput())
      const consumed = await target.evaluate((element) => {
        const event = new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true, cancelable: true })
        element.dispatchEvent(event)
        return event.defaultPrevented
      })
      expect(consumed).toBe(false)
      expect(await state(page)).toEqual(createFlightInput())
      await page.keyboard.up('w')
    }
    await page.close()
  })

  it('releases on blur, tab hiding, Escape, pointer lock exit and dispose', async () => {
    const page = await fixture()
    await page.locator('#flight-canvas').focus()
    const interruptions = [
      () => window.dispatchEvent(new Event('blur')),
      () => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) },
      () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })),
      () => {
        Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: document.body })
        document.dispatchEvent(new Event('pointerlockchange'))
        Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null })
        document.dispatchEvent(new Event('pointerlockchange'))
      },
      () => window.inputFixture.controller.dispose(),
    ]
    for (const interrupt of interruptions) {
      await page.keyboard.down('q')
      expect((await state(page)).roll).toBe(1)
      await page.evaluate(interrupt)
      expect(await state(page)).toEqual(createFlightInput())
      await page.keyboard.up('q')
    }
    await page.keyboard.press('w')
    expect(await state(page)).toEqual(createFlightInput())
    await page.close()
  })
})

describe('touch flight controls', () => {
  it('shows controls on hybrid touchscreens even when the primary pointer is a mouse', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    await page.addInitScript(() => Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 }))
    await page.goto(url)
    await page.getByRole('group', { name: 'Touch flight controls' }).waitFor({ state: 'visible' })
    expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true)
    await page.close()
  })

  it('renders only enabled flight and is visible on phone and tablet with reachable targets', async () => {
    const page = await fixture(true)
    for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1024, height: 768 }]) {
      await page.setViewportSize(viewport)
      await page.getByRole('group', { name: 'Touch flight controls' }).waitFor({ state: 'visible' })
      const boxes = await page.locator('.flight-touch button').evaluateAll((buttons) =>
        buttons.map((button) => { const b = button.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom } }))
      for (const box of boxes) {
        expect(box.width).toBeGreaterThanOrEqual(44)
        expect(box.height).toBeGreaterThanOrEqual(44)
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.y).toBeGreaterThanOrEqual(0)
        expect(box.right).toBeLessThanOrEqual(viewport.width)
        expect(box.bottom).toBeLessThanOrEqual(viewport.height)
        const portrait = viewport.height > viewport.width
        // The compact flight strip spans the bottom in portrait and sits between the stick banks in landscape.
        const deck = portrait
          ? { left: 0, right: viewport.width, top: viewport.height - 72, bottom: viewport.height - 12 }
          : { left: 180, right: viewport.width - 180, top: viewport.height - 72, bottom: viewport.height - 8 }
        expect(box.right <= deck.left || box.x >= deck.right || box.bottom <= deck.top || box.y >= deck.bottom).toBe(true)
      }
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: 'tests/input-mobile.png' })
    await page.setViewportSize({ width: 844, height: 390 })
    await page.screenshot({ path: 'tests/input-landscape.png' })
    await page.evaluate(() => window.inputFixture.render(false))
    await page.getByRole('group', { name: 'Touch flight controls' }).waitFor({ state: 'detached' })
    await page.close()
  })

  it('supports native two-finger steering and look without pointer lock', async () => {
    const page = await fixture(true)
    const steer = await page.locator('[data-control="steer"]').boundingBox()
    const look = await page.locator('[data-control="look"]').boundingBox()
    if (!steer || !look) throw new Error('Missing sticks.')
    const cdp = await page.context().newCDPSession(page)
    const points = [
      { id: 1, x: steer.x + steer.width / 2, y: steer.y + steer.height / 2 },
      { id: 2, x: look.x + look.width / 2, y: look.y + look.height / 2 },
    ]
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points })
    points[0].x += steer.width * 0.28
    points[0].y -= steer.height * 0.14
    points[1].x -= look.width * 0.28
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points })
    let input = await state(page)
    expect(input.pitch).toBeGreaterThan(0.1)
    expect(input.yaw).toBeLessThan(-0.5)
    expect(input.lookX).toBeLessThan(-0.5)
    expect(await page.evaluate(() => document.pointerLockElement)).toBeNull()
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [points[0]] })
    input = await state(page)
    expect(input.pitch).toBe(0)
    expect(input.yaw).toBe(0)
    expect(input.lookX).toBeLessThan(-0.5)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    expect(await state(page)).toEqual(createFlightInput())
    await page.close()
  })

  it('keeps independent buttons, handles cancel and lost capture, and preserves held keyboard input', async () => {
    const page = await fixture(true)
    await page.locator('#flight-canvas').focus()
    await page.keyboard.down('w')
    await pointer(page, 'ascend', 'pointerdown', 1)
    await pointer(page, 'rollLeft', 'pointerdown', 2)
    await pointer(page, 'brake', 'pointerdown', 3)
    expect(await state(page)).toMatchObject({ forward: 1, vertical: 1, roll: 1, brake: true })
    expect(await page.evaluate(() => window.inputFixture.brakeCount())).toBe(1)
    await pointer(page, 'ascend', 'pointercancel', 1)
    expect(await state(page)).toMatchObject({ forward: 1, vertical: 0, roll: 1, brake: true })
    await pointer(page, 'rollLeft', 'lostpointercapture', 2)
    await pointer(page, 'brake', 'pointerup', 3)
    expect(await state(page)).toMatchObject({ forward: 1, roll: 0, brake: false })
    await page.keyboard.up('w')
    for (const [control, axis, value] of [
      ['descend', 'vertical', -1], ['rollRight', 'roll', -1], ['forward', 'forward', 1], ['reverse', 'forward', -1],
    ] as const) {
      await pointer(page, control, 'pointerdown', 7)
      expect((await state(page))[axis]).toBe(value)
      await pointer(page, control, 'pointerup', 7)
    }
    expect(await state(page)).toEqual(createFlightInput())
    await page.close()
  })

  it('releases gestures when a menu receives focus, flight disables, the window blurs or controls unmount', async () => {
    const page = await fixture(true)
    const interruptions = [
      () => (document.querySelector('input') as HTMLInputElement).focus(),
      () => window.dispatchEvent(new Event('blur')),
      () => window.inputFixture.render(false),
      () => window.inputFixture.unmount(),
    ]
    for (const interrupt of interruptions) {
      await pointer(page, 'steer', 'pointerdown', 1, 1, -1)
      await pointer(page, 'ascend', 'pointerdown', 2)
      expect((await state(page)).vertical).toBe(1)
      await page.evaluate(interrupt)
      await expect.poll(() => state(page)).toEqual(createFlightInput())
      if (interrupt !== interruptions.at(-1)) {
        await page.evaluate(() => window.inputFixture.render(true))
        await page.locator('[data-control="steer"]').waitFor({ state: 'visible' })
      }
    }
    await page.close()
  })

  it('offers keyboard-accessible sticks and hold buttons with focus-release behavior', async () => {
    const page = await fixture(true)
    await page.locator('[data-control="steer"]').focus()
    await page.keyboard.down('ArrowUp')
    expect((await state(page)).pitch).toBe(1)
    await page.keyboard.up('ArrowUp')
    expect((await state(page)).pitch).toBe(0)
    await page.locator('[data-control="ascend"]').focus()
    await page.keyboard.down('Space')
    expect((await state(page)).vertical).toBe(1)
    await page.locator('[data-control="descend"]').focus()
    expect((await state(page)).vertical).toBe(0)
    await page.keyboard.up('Space')
    await page.close()
  })
})

describe('original cockpit and ship', () => {
  it('uses meter-scale original geometry with a clear forward sightline and live gauges', () => {
    const cockpit = createCockpit()
    const ship = createShip()
    cockpit.updateMatrixWorld(true)
    ship.updateMatrixWorld(true)
    expect(cockpit.userData).toMatchObject({ units: 'meters', forward: '-Z', reconstructed: true })
    const size = new THREE.Box3().setFromObject(cockpit).getSize(new THREE.Vector3())
    expect(size.x).toBeGreaterThan(2)
    expect(size.x).toBeLessThan(3)
    expect(size.z).toBeLessThan(3)
    const shipSize = new THREE.Box3().setFromObject(ship).getSize(new THREE.Vector3())
    expect(shipSize.z).toBeGreaterThan(8)
    expect(shipSize.z).toBeLessThan(9)
    for (const x of [-0.2, 0, 0.2]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(x, 0, -1).normalize(), 0.01, 10)
      expect(ray.intersectObject(cockpit, true)).toHaveLength(0)
    }
    for (const kind of ['flight', 'navigation', 'altitude']) {
      const screen = cockpit.getObjectByName(`${kind}-display`)!
      const point = screen.getWorldPosition(new THREE.Vector3())
      const ray = new THREE.Raycaster(new THREE.Vector3(), point.normalize(), 0.01, 10)
      expect(ray.intersectObject(cockpit, true)[0]?.object.name).toBe(`${kind}-display`)
    }
    const needle = cockpit.getObjectByName('speed-gauge-needle')!
    const before = needle.rotation.z
    updateCockpit(cockpit, { speedC: 0.1, throttleC: 0.2, altitudeKm: 500, verticalKmS: 0.001, mode: 'free', warp: true, targetId: 'moon', referenceId: 'earth', headingDeg: 90 })
    expect(needle.rotation.z).not.toBe(before)
    expect(cockpit.getObjectByName('heading-indicator')!.rotation.z).toBeCloseTo(-Math.PI / 2)
    updateCockpit(cockpit, { speedC: NaN, throttleC: Infinity, altitudeKm: NaN, verticalKmS: NaN, mode: 'free', warp: false, targetId: '', referenceId: '' })
    expect(Number.isFinite(needle.rotation.z)).toBe(true)
  })

  it('renders instrument textures and the original cockpit and ship in WebGL', async () => {
    for (const model of ['cockpit', 'ship']) {
      const page = await fixture(false, `?model=${model}&scoutTheme=dark`)
      await page.waitForFunction(() => window.inputModelReady)
      await page.locator('#flight-canvas canvas').waitFor()
      await page.screenshot({ path: `tests/input-${model}.png` })
      await page.close()
    }
  })
})
