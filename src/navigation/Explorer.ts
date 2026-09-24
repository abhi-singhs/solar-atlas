import { Quaternion, Vector3 } from 'three'
import { DAY_SECONDS } from '../contracts'
import type { Dataset, Snapshot, SurfaceHit } from '../contracts'
import { loadDataset } from '../simulation/dataset'
import { SolarRenderer } from '../render/SolarRenderer'
import { FlightController } from '../flight/FlightController'
import type { FlightTelemetry } from '../flight/FlightController'
import {
  addStop, canLandOn, cruiseSeconds, currentStop, DWELL_SECONDS, legSpeedC, markStop, moveStop, removeStop,
  resetRoute, setAction, SLOW_LEG_SECONDS,
} from '../flight/route'
import type { RouteStop, StopAction } from '../flight/route'
import { duration } from '../ui/format'
import { InputController, setInputSource } from '../input/controls'
import { Observer } from './observer'
import { initialState } from './state'
import type { Notice, NoticeTone, SavedSettings, ViewState } from './state'

const SETTINGS_KEY = 'solar-atlas-settings-v1'
type OptionKey = 'labels' | 'paths' | 'quality' | 'exposure' | 'fov' | 'lensFlare' | 'glareHidesStars'
type RouteOption = 'routeAutoContinue' | 'routeAutoSpeed'
const RUNNING = new Set(['departing', 'enroute', 'dwell'])

export class Explorer {
  readonly input: InputController
  private readonly container: HTMLElement
  private readonly notify: (state: ViewState) => void
  private state: ViewState = { ...initialState, bookmarks: [] }
  private dataset?: Dataset
  private renderer?: SolarRenderer
  private observer?: Observer
  private flight?: FlightController
  private snapshot?: Snapshot
  private frame = 0
  private disposed = false
  private previousTime = 0
  private previousUi = 0
  private fps = 60
  private pointers = new Map<number, { x: number; y: number; downX: number; downY: number }>()
  private keys = new Set<string>()
  private navigationToken = 0
  private lastFlightMessage = ''
  private noticeId = 0
  private readonly pointerLook = Symbol('viewport-look')
  private lastSitePick = -Infinity
  private routeKey = 0
  private routeLeg = { key: -1, arrivals: 0 }
  private routeToken = 0
  private launching = false

  constructor(container: HTMLElement, notify: (state: ViewState) => void) {
    this.container = container
    this.notify = notify
    this.input = new InputController(container)
    this.input.setEnabled(false)
    this.restore()
    container.addEventListener('pointerdown', this.pointerDown)
    container.addEventListener('pointermove', this.pointerMove)
    container.addEventListener('pointerup', this.pointerUp)
    container.addEventListener('pointercancel', this.pointerUp)
    container.addEventListener('wheel', this.wheel, { passive: false })
    window.addEventListener('keydown', this.keyDown)
    window.addEventListener('keyup', this.keyUp)
    window.addEventListener('blur', this.blur)
    window.addEventListener('resize', this.resize)
    document.addEventListener('visibilitychange', this.visibility)
  }

  async start(): Promise<void> {
    const dataset = await loadDataset(message => this.publish({ loading: message }))
    if (this.disposed) return
    this.dataset = dataset
    this.observer = new Observer(dataset.bodies)
    this.observer.aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight)
    this.snapshot = dataset.evaluate(dataset.firstJd)
    this.observer.focus('earth', this.snapshot)
    this.renderer = new SolarRenderer(this.container, dataset, {
      onSelect: id => {
        if (this.state.pickingSite || performance.now() - this.lastSitePick < 250) return
        void this.select(id).catch(e => this.report(e))
      },
      onError: message => this.publish({ notice: this.note(message, 'error') }),
      onProgress: loading => this.publish({ loading }),
      onSurfacePick: (id, hit) => this.positionOverSite(id, hit),
    })
    this.renderer.setFieldOfView(this.state.fov)
    this.flight = new FlightController(dataset.bodies, this.renderer.surface)
    this.publish({ loading: 'Preparing Earth at its physical scale', bodies: dataset.bodies,
      jd: dataset.firstJd, firstJd: dataset.firstJd, lastJd: dataset.lastJd, date: dataset.jdToUtc(dataset.firstJd) })
    await this.renderer.ensureBody('earth')
    if (this.disposed) return
    const validBookmarks = this.state.bookmarks.filter(b => dataset.bodies.some(body => body.id === b.bodyId) &&
      b.jd >= dataset.firstJd && b.jd <= dataset.lastJd)
    if (validBookmarks.length !== this.state.bookmarks.length) this.publish({ notice: this.note('Some saved viewpoints no longer match this dataset and were removed.', 'warning') })
    this.publish({ ready: true, bookmarks: validBookmarks })
    this.frame = requestAnimationFrame(this.tick)
  }

  private publish(patch: Partial<ViewState>): void {
    this.state = { ...this.state, ...patch }
    if (!this.disposed) this.notify(this.state)
  }

  private note(text: string, tone: NoticeTone = 'info'): Notice {
    return { text, tone, id: ++this.noticeId }
  }

  private report(error: unknown): void {
    this.publish({ playing: false, notice: this.note(error instanceof Error ? error.message : String(error), 'error') })
  }

  private tick = (now: number): void => {
    if (this.disposed || !this.dataset || !this.renderer || !this.observer || !this.snapshot || !this.flight) return
    const elapsed = this.previousTime ? (now - this.previousTime) / 1000 : 0
    this.previousTime = now
    const dt = Math.max(0, Math.min(elapsed, 0.05))
    let simulationDt = 0
    if (elapsed > 0) this.fps += (1 / elapsed - this.fps) * 0.04
    try {
      if (this.state.playing) {
        const previousJd = this.state.jd
        const next = previousJd + dt * this.state.timeScale / DAY_SECONDS
        const jd = Math.max(this.dataset.firstJd, Math.min(this.dataset.lastJd, next))
        simulationDt = (jd - previousJd) * DAY_SECONDS
        this.state.jd = jd
        if (next <= this.dataset.firstJd || next >= this.dataset.lastJd) {
          this.state.playing = false
          this.state.notice = this.note('Reached the cached dataset boundary. Playback is paused.')
        }
      }
      this.snapshot = this.dataset.evaluate(this.state.jd)
      if (this.state.inShip) {
        this.flight.update(simulationDt, this.snapshot, this.input.state, dt)
        setInputSource(this.input.state, this.pointerLook, null)
      } else {
        this.observer.move(Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')),
          Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')),
          Number(this.keys.has('KeyR')) - Number(this.keys.has('KeyF')), dt, this.snapshot)
      }
      const camera = this.state.inShip ? this.flight.camera(this.state.camera) : this.observer.pose(this.snapshot)
      if (this.state.inShip && this.state.camera === 'chase') {
        const rotation = new Quaternion(...camera.quaternion)
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.17))
        camera.quaternion = [rotation.x, rotation.y, rotation.z, rotation.w]
      }
      const telemetry = this.state.inShip ? this.flight.telemetry(this.snapshot) : undefined
      if (telemetry) this.advanceRoute(telemetry, simulationDt)
      this.renderer.update(this.snapshot, camera, {
        selectedId: this.state.selectedId, labels: this.state.labels, paths: this.state.paths,
        quality: this.state.quality, exposure: this.state.exposure, cockpit: this.state.inShip && this.state.camera === 'cockpit',
        chase: this.state.inShip && this.state.camera === 'chase',
        lensFlare: this.state.lensFlare, glareHidesStars: this.state.glareHidesStars,
        shipPose: this.state.inShip ? this.flight.pose() : undefined,
        landingBodyId: telemetry?.landingBodyId,
        flightTelemetry: telemetry,
      })
      if (now - this.previousUi >= 100) {
        this.previousUi = now
        const statePosition = this.snapshot.states[this.state.selectedId].position
        const observerDistanceKm = new Vector3(...camera.position).distanceTo(new Vector3(...statePosition))
        const patch: Partial<ViewState> = { date: this.dataset.jdToUtc(this.state.jd), jd: this.state.jd, fps: this.fps,
          playing: this.state.playing, observerDistanceKm }
        if (telemetry) {
          Object.assign(patch, { shipMode: telemetry.mode, speedC: telemetry.speedC, throttleC: telemetry.throttleC,
            warp: telemetry.warp, warpArmed: telemetry.warpArmed, referenceId: telemetry.referenceId, altitudeKm: telemetry.altitudeKm,
            altitudeEstimated: telemetry.altitudeEstimated, verticalKmS: telemetry.verticalKmS,
            separationKm: new Vector3(...this.flight.pose().position).distanceTo(new Vector3(...statePosition)),
            etaSeconds: telemetry.targetId === this.state.selectedId ? telemetry.etaSeconds : Infinity })
          // Routine flight status already shows in the flight panel, so only warnings become popups.
          if (telemetry.message !== this.lastFlightMessage) {
            this.lastFlightMessage = telemetry.message
            if (telemetry.warning) patch.notice = this.note(telemetry.message, 'warning')
          }
        }
        this.publish(patch)
      }
    } catch (e) {
      this.report(e)
      return
    }
    this.frame = requestAnimationFrame(this.tick)
  }

  async select(id: string): Promise<void> {
    if (!this.dataset?.bodies.some(body => body.id === id)) throw new Error(`Unknown body ${id}.`)
    this.publish({ selectedId: id })
    if (!this.state.inShip) await this.focus(id)
  }

  async focus(id: string): Promise<void> {
    if (!this.renderer || !this.snapshot || !this.observer) return
    const token = ++this.navigationToken
    await this.renderer.ensureBody(id)
    if (this.disposed || token !== this.navigationToken) return
    if (this.state.inShip) this.exitShip()
    this.observer.focus(id, this.snapshot)
    this.publish({ selectedId: id, observerMode: 'orbit' })
  }

  system(kind: 'inner' | 'all' | 'local'): void {
    if (!this.observer || !this.snapshot) return
    if (this.state.inShip) this.exitShip()
    this.observer.system(this.snapshot, kind)
    this.publish({ observerMode: 'orbit', paths: true })
  }

  observerMode(mode: ViewState['observerMode']): void {
    if (!this.observer) return
    this.observer.mode = mode
    this.publish({ observerMode: mode })
  }

  setTime(jd: number): void {
    if (this.state.inShip) throw new Error('Leave spaceship mode before changing the simulation date.')
    if (!this.dataset || !Number.isFinite(jd) || jd < this.dataset.firstJd || jd > this.dataset.lastJd) {
      throw new Error('Choose a date inside the cached 2026-2027 interval.')
    }
    this.publish({ jd, playing: false, date: this.dataset.jdToUtc(jd) })
  }

  setUtc(iso: string): void {
    if (this.dataset) this.setTime(this.dataset.utcToJd(iso))
  }

  setTimeScale(value: number): void {
    if (!Number.isFinite(value) || value === 0 || Math.abs(value) > 604800) throw new Error('Invalid time acceleration.')
    if (this.state.inShip && value !== 1) throw new Error('Spaceship flight uses 1x time. Leave flight to accelerate the timeline.')
    this.publish({ timeScale: value })
  }

  togglePlay(): void {
    if (!this.state.ready) return
    if (!this.state.playing && ((this.state.jd >= this.state.lastJd && this.state.timeScale > 0) ||
      (this.state.jd <= this.state.firstJd && this.state.timeScale < 0))) {
      throw new Error('At the dataset boundary. Choose a time rate pointing into the cached interval.')
    }
    this.publish({ playing: !this.state.playing })
  }

  async enterShip(): Promise<void> {
    if (this.state.inShip || !this.observer || !this.snapshot || !this.renderer || !this.flight) return
    await this.renderer.ensureBody(this.state.selectedId)
    if (this.observer.targetId !== this.state.selectedId) this.observer.focus(this.state.selectedId, this.snapshot)
    this.flight.enter(this.snapshot, this.state.selectedId, this.observer.pose(this.snapshot))
    this.input.setEnabled(true)
    this.publish({ inShip: true, pickingSite: false, timeScale: 1, playing: this.state.jd < this.state.lastJd, camera: 'cockpit' })
    this.container.focus()
  }

  exitShip(): void {
    if (!this.state.inShip) return
    if (RUNNING.has(this.state.routePhase)) {
      this.routeToken++
      this.publish({ routePhase: 'idle', routeDwell: 0 })
    }
    this.input.setEnabled(false)
    this.flight?.brake()
    if (this.observer && this.snapshot) this.observer.focus(this.state.selectedId, this.snapshot)
    this.publish({ inShip: false, playing: false, observerMode: 'orbit' })
  }

  setCamera(camera: ViewState['camera']): void { this.publish({ camera }) }
  resetLook(): void { this.flight?.resetLook() }
  setThrottle(c: number): void {
    this.flight?.setThrottle(c)
    this.publish({ throttleC: c })
  }
  setWarp(enabled: boolean): void {
    if (!this.flight) return
    this.flight.setWarp(enabled)
    const telemetry = this.snapshot ? this.flight.telemetry(this.snapshot) : undefined
    this.publish({ warp: telemetry?.warp ?? enabled, warpArmed: telemetry?.warpArmed ?? false })
    if (enabled && this.state.routePhase === 'enroute' && this.state.routeAutoSpeed && this.snapshot) {
      const target = this.snapshot.states[this.state.selectedId]
      const distance = new Vector3(...this.flight.pose().position).distanceTo(new Vector3(...target.position))
      this.setThrottle(legSpeedC(distance, true))
    }
  }

  async transfer(id: string): Promise<void> {
    this.interruptRoute()
    if (!this.state.inShip) await this.enterShip()
    if (!this.snapshot || !this.flight || !this.renderer) return
    await this.renderer.ensureBody(id)
    this.flight.transfer(id, this.snapshot)
    this.publish({ selectedId: id, playing: this.state.jd < this.state.lastJd })
  }

  async land(id: string): Promise<void> {
    this.interruptRoute()
    if (!this.state.inShip) await this.enterShip()
    if (!this.snapshot || !this.flight || !this.renderer) return
    await this.renderer.ensureBody(id)
    this.flight.land(id, this.snapshot)
    this.publish({ selectedId: id, playing: this.state.jd < this.state.lastJd })
  }

  async pickSite(): Promise<void> {
    if (this.state.inShip) throw new Error('Select a landing site in Explore mode before starting the ship.')
    if (['sun', 'jupiter', 'saturn', 'uranus', 'neptune'].includes(this.state.selectedId)) {
      throw new Error('Choose a solid body for a surface landing site.')
    }
    await this.renderer?.ensureBody(this.state.selectedId)
    this.publish({ pickingSite: !this.state.pickingSite })
  }

  private positionOverSite(id: string, hit: SurfaceHit): void {
    if (!this.observer || !this.snapshot || this.state.inShip) return
    const direction = new Vector3(...hit.point).applyQuaternion(new Quaternion(...this.snapshot.states[id].rotation)).normalize()
    this.observer.focus(id, this.snapshot)
    this.observer.theta = Math.atan2(direction.y, direction.x)
    this.observer.phi = Math.asin(Math.max(-1, Math.min(1, direction.z)))
    this.lastSitePick = performance.now()
    this.publish({ selectedId: id, observerMode: 'orbit' })
  }
  takeoff(): void {
    this.interruptRoute()
    if (this.flight && this.snapshot) this.flight.takeoff(this.snapshot)
    this.publish({ playing: this.state.jd < this.state.lastJd })
  }
  brake(): void { this.flight?.brake(); this.publish({ throttleC: 0 }) }
  cancel(): void { this.flight?.cancel() }
  clearMessage(): void { this.publish({ notice: null }) }

  addStop(id: string, action: StopAction = 'arrive', announce = true): void {
    const body = this.body(id)
    const route = addStop(this.state.route, body, ++this.routeKey, action)
    if (typeof route === 'string') throw new Error(route)
    const position = route.filter(stop => stop.status === 'pending').length
    this.publish({ route, routePhase: this.state.routePhase === 'complete' ? 'idle' : this.state.routePhase,
      ...(announce ? { notice: this.note(`Added ${body.name} as destination ${position}.`) } : {}) })
  }

  toggleStop(id: string): void {
    const stop = this.state.route.find(item => item.bodyId === id && item.status === 'pending')
    if (stop) this.removeStop(stop.key)
    else this.addStop(id, 'arrive', false)
  }

  removeStop(key: number): void {
    const active = key === this.routeLeg.key && RUNNING.has(this.state.routePhase)
    this.publish({ route: removeStop(this.state.route, key) })
    if (active) this.continueAfterChange()
  }

  moveStop(key: number, delta: -1 | 1): void {
    this.publish({ route: moveStop(this.state.route, key, delta) })
  }

  setStopAction(key: number, action: StopAction): void {
    const stop = this.state.route.find(item => item.key === key)
    if (!stop) return
    if (action === 'land' && !canLandOn(this.body(stop.bodyId))) throw new Error('The Sun has no landing or hover endpoint.')
    this.publish({ route: setAction(this.state.route, key, action) })
  }

  clearRoute(): void {
    if (RUNNING.has(this.state.routePhase)) this.pauseRoute()
    this.publish({ route: [], routePhase: 'idle', routeDwell: 0 })
  }

  setRouteOption(key: RouteOption, value: boolean): void {
    const patch: Partial<ViewState> = { [key]: value }
    if (key === 'routeAutoContinue' && this.state.routePhase === 'dwell') patch.routeDwell = value ? DWELL_SECONDS : Infinity
    this.publish(patch)
  }

  async startRoute(): Promise<void> {
    if (!this.state.route.length) throw new Error('Add a destination before starting a route.')
    if (!currentStop(this.state.route)) this.publish({ route: resetRoute(this.state.route) })
    if (!this.state.inShip) await this.enterShip()
    await this.launchLeg()
  }

  pauseRoute(): void {
    if (!RUNNING.has(this.state.routePhase)) return
    this.routeToken++
    this.launching = false
    if (this.state.routePhase === 'enroute') this.flight?.brake()
    this.syncFlightMessage()
    this.publish({ routePhase: 'idle', routeDwell: 0, throttleC: 0 })
  }

  departNow(): void {
    if (this.state.routePhase === 'dwell') void this.launchLeg().catch(e => this.report(e))
  }

  skipStop(): void {
    const stop = currentStop(this.state.route)
    if (!stop) return
    this.publish({ route: markStop(this.state.route, stop.key, 'skipped') })
    if (RUNNING.has(this.state.routePhase)) this.continueAfterChange()
  }

  /** One control for Start, Resume, and Depart now, so a single key or button drives the loop. */
  async routeGo(): Promise<void> {
    if (this.state.routePhase === 'dwell') return this.departNow()
    if (RUNNING.has(this.state.routePhase)) return
    await this.startRoute()
  }

  private continueAfterChange(): void {
    if (this.state.routePhase === 'enroute') this.flight?.cancel()
    this.syncFlightMessage()
    void this.launchLeg().catch(e => this.report(e))
  }

  private interruptRoute(): void {
    if (!RUNNING.has(this.state.routePhase)) return
    this.routeToken++
    this.launching = false
    this.publish({ routePhase: 'idle', routeDwell: 0, notice: this.note('Route paused for manual flight. Resume route to continue.') })
  }

  private syncFlightMessage(): void {
    if (this.flight && this.snapshot) this.lastFlightMessage = this.flight.telemetry(this.snapshot).message
  }

  private body(id: string) {
    const body = this.dataset?.bodies.find(item => item.id === id)
    if (!body) throw new Error(`Unknown body ${id}.`)
    return body
  }

  private async launchLeg(): Promise<void> {
    const flight = this.flight
    if (!flight || !this.snapshot || !this.renderer) return
    const stop = currentStop(this.state.route)
    if (!stop) {
      this.finishRoute()
      return
    }
    const token = ++this.routeToken
    const mode = flight.telemetry(this.snapshot).mode
    const playing = this.state.jd < this.state.lastJd
    if (mode === 'landed' || mode === 'hover') {
      flight.takeoff(this.snapshot)
      this.syncFlightMessage()
      this.publish({ routePhase: 'departing', routeDwell: 0, playing })
      return
    }
    this.publish({ routePhase: 'departing', routeDwell: 0, selectedId: stop.bodyId, playing })
    if (mode === 'takeoff') return
    this.launching = true
    try {
      await this.renderer.ensureBody(stop.bodyId)
    } finally {
      if (token === this.routeToken) this.launching = false
    }
    if (this.disposed || token !== this.routeToken || !this.state.inShip || !this.snapshot) return
    if (currentStop(this.state.route)?.key !== stop.key) {
      void this.launchLeg().catch(e => this.report(e))
      return
    }
    const snapshot = this.snapshot
    const body = this.body(stop.bodyId)
    const notes: string[] = []
    if (this.state.routeAutoSpeed) {
      const before = flight.telemetry(snapshot)
      const distance = new Vector3(...flight.pose().position).distanceTo(new Vector3(...snapshot.states[stop.bodyId].position))
      const warpAllowed = before.warp || before.warpArmed
      const speed = legSpeedC(distance, warpAllowed)
      flight.setThrottle(speed)
      const cruise = cruiseSeconds(distance, speed)
      if (!warpAllowed && cruise > SLOW_LEG_SECONDS) notes.push(`This leg takes about ${duration(cruise)} below c. Turn on Warp to get there sooner.`)
    }
    if (stop.action === 'land' && canLandOn(body)) flight.land(stop.bodyId, snapshot)
    else flight.transfer(stop.bodyId, snapshot)
    let telemetry = flight.telemetry(snapshot)
    if (stop.action === 'land' && telemetry.mode === 'free') {
      flight.transfer(stop.bodyId, snapshot)
      telemetry = flight.telemetry(snapshot)
      notes.unshift('Landing is unavailable there, so the ship will park nearby.')
    }
    this.lastFlightMessage = telemetry.message
    if (telemetry.mode === 'free') {
      this.publish({ routePhase: 'idle', notice: this.note(`Route paused. ${telemetry.message}`, 'warning') })
      return
    }
    this.routeLeg = { key: stop.key, arrivals: telemetry.arrivals }
    // The route status shows each leg, so only a leg with a caveat gets a popup.
    this.publish({ routePhase: 'enroute', selectedId: stop.bodyId, throttleC: telemetry.throttleC, playing,
      ...(notes.length ? { notice: this.note(`Heading to ${body.name}. ${notes.join(' ')}`, 'warning') } : {}) })
  }

  private advanceRoute(telemetry: FlightTelemetry, simulationDt: number): void {
    const phase = this.state.routePhase
    if (phase === 'departing') {
      if (!this.launching && telemetry.mode === 'free') void this.launchLeg().catch(e => this.report(e))
      return
    }
    if (phase === 'dwell') {
      if (!Number.isFinite(this.state.routeDwell) || simulationDt <= 0) return
      this.state.routeDwell = Math.max(0, this.state.routeDwell - simulationDt)
      if (this.state.routeDwell === 0) void this.launchLeg().catch(e => this.report(e))
      return
    }
    if (phase !== 'enroute') return
    const stop = this.state.route.find(item => item.key === this.routeLeg.key)
    if (!stop) return
    if (telemetry.arrivals > this.routeLeg.arrivals && telemetry.arrivedId === stop.bodyId) {
      this.arrive(stop, telemetry)
      return
    }
    if (telemetry.mode === 'free' && telemetry.targetId !== stop.bodyId) {
      this.publish({ routePhase: 'idle', notice: this.note(`Route paused before ${this.body(stop.bodyId).name}. Resume route to continue.`, 'warning') })
    }
  }

  /** The route status and stop list already show arrivals, so these transitions stay silent. */
  private arrive(stop: RouteStop, telemetry: FlightTelemetry): void {
    const route = markStop(this.state.route, stop.key, 'visited')
    this.lastFlightMessage = telemetry.message
    if (!currentStop(route)) {
      this.publish({ route, routePhase: 'complete', routeDwell: 0 })
      return
    }
    this.publish({ route, routePhase: 'dwell', routeDwell: this.state.routeAutoContinue ? DWELL_SECONDS : Infinity })
  }

  private finishRoute(): void {
    this.publish({ routePhase: this.state.route.length ? 'complete' : 'idle', routeDwell: 0 })
  }

  option<K extends OptionKey>(key: K, value: ViewState[K]): void {
    if (key === 'fov' && typeof value === 'number') this.renderer?.setFieldOfView(value)
    this.publish({ [key]: value })
    this.save()
  }

  bookmark(): void {
    const body = this.dataset?.bodies.find(body => body.id === this.state.selectedId)
    if (!body) return
    const bookmark = { bodyId: body.id, name: `${body.name} / ${this.state.date.slice(0, 10)}`, jd: this.state.jd }
    const bookmarks = this.state.bookmarks.filter(item => item.bodyId !== body.id || item.jd !== this.state.jd)
    this.publish({ bookmarks: [...bookmarks, bookmark], notice: this.note(`Saved ${body.name}. Find it under Saved in the catalog.`) })
    this.save()
  }

  async openBookmark(index: number): Promise<void> {
    const bookmark = this.state.bookmarks[index]
    if (!bookmark) throw new Error('This saved viewpoint no longer exists.')
    this.exitShip()
    this.setTime(bookmark.jd)
    await this.focus(bookmark.bodyId)
  }
  removeBookmark(index: number): void {
    this.publish({ bookmarks: this.state.bookmarks.filter((_, i) => i !== index) })
    this.save()
  }

  private save(): void {
    const settings: SavedSettings = { version: 1, labels: this.state.labels, paths: this.state.paths,
      quality: this.state.quality, exposure: this.state.exposure, fov: this.state.fov, lensFlare: this.state.lensFlare,
      glareHidesStars: this.state.glareHidesStars, bookmarks: this.state.bookmarks }
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) }
    catch (e) { this.publish({ notice: this.note(`Settings could not be saved in this browser: ${e instanceof Error ? e.message : String(e)}`, 'error') }) }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY)
      if (raw === null) return
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || !('version' in parsed) || parsed.version !== 1 ||
        !('labels' in parsed) || typeof parsed.labels !== 'boolean' ||
        !('paths' in parsed) || typeof parsed.paths !== 'boolean' ||
        !('quality' in parsed) || (parsed.quality !== 'low' && parsed.quality !== 'high') ||
        !('exposure' in parsed) || typeof parsed.exposure !== 'number' || !Number.isFinite(parsed.exposure) ||
        parsed.exposure < -4 || parsed.exposure > 6 || !('bookmarks' in parsed) || !Array.isArray(parsed.bookmarks)) {
        throw new Error('Saved settings have an unsupported format.')
      }
      const bookmarks = parsed.bookmarks.map((item: unknown) => {
        if (typeof item !== 'object' || item === null || !('bodyId' in item) || typeof item.bodyId !== 'string' ||
          !('name' in item) || typeof item.name !== 'string' || !('jd' in item) || typeof item.jd !== 'number' ||
          !Number.isFinite(item.jd)) throw new Error('A saved viewpoint is invalid.')
        return { bodyId: item.bodyId, name: item.name, jd: item.jd }
      })
      let fov = this.state.fov
      if ('fov' in parsed) {
        if (typeof parsed.fov !== 'number' || !Number.isFinite(parsed.fov) || parsed.fov < 25 || parsed.fov > 100) throw new Error('Saved field of view is invalid.')
        fov = parsed.fov
      }
      const flag = (key: 'lensFlare' | 'glareHidesStars'): boolean => {
        if (!(key in parsed)) return this.state[key]
        const value = (parsed as Record<string, unknown>)[key]
        if (typeof value !== 'boolean') throw new Error(`Saved ${key === 'lensFlare' ? 'lens flare' : 'star glare'} setting is invalid.`)
        return value
      }
      this.state = { ...this.state, labels: parsed.labels, paths: parsed.paths, quality: parsed.quality, exposure: parsed.exposure, fov,
        lensFlare: flag('lensFlare'), glareHidesStars: flag('glareHidesStars'), bookmarks }
    } catch (e) {
      this.state.notice = this.note(`Using default settings because saved preferences could not be restored: ${e instanceof Error ? e.message : String(e)}`, 'warning')
    }
  }

  private pointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Element && event.target.closest('button, input, select, a')) return
    this.container.focus()
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, downX: event.clientX, downY: event.clientY })
    this.container.setPointerCapture(event.pointerId)
  }
  private pointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId)
    if (!previous) return
    if (this.state.pickingSite) return
    if (this.state.inShip) {
      setInputSource(this.input.state, this.pointerLook, {
        lookX: Math.max(-1, Math.min(1, (event.clientX - previous.x) / 20)),
        lookY: Math.max(-1, Math.min(1, (previous.y - event.clientY) / 20)),
      })
    } else if (this.pointers.size === 2) {
      const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)![1]
      const before = Math.hypot(previous.x - other.x, previous.y - other.y)
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y)
      if (before > 1 && after > 1) this.observer?.zoom(Math.log(before / after) / 0.0015)
    } else {
      this.observer?.drag(event.clientX - previous.x, event.clientY - previous.y)
    }
    this.pointers.set(event.pointerId, { ...previous, x: event.clientX, y: event.clientY })
  }
  private pointerUp = (event: PointerEvent): void => {
    const pointer = this.pointers.get(event.pointerId)
    if (event.type === 'pointerup' && this.state.pickingSite && pointer &&
      Math.hypot(event.clientX - pointer.downX, event.clientY - pointer.downY) < 8) {
      const id = this.state.selectedId
      const hit = this.renderer?.pickSurface(event.clientX, event.clientY, id)
      if (hit) {
        this.positionOverSite(id, hit)
        this.publish({ pickingSite: false })
        void this.land(id).catch(e => this.report(e))
      } else this.publish({ notice: this.note('No source surface at that point. Tap the body itself, or press Escape to cancel.', 'warning') })
    }
    this.pointers.delete(event.pointerId)
    if (this.container.hasPointerCapture(event.pointerId)) this.container.releasePointerCapture(event.pointerId)
    setInputSource(this.input.state, this.pointerLook, null)
  }
  private wheel = (event: WheelEvent): void => {
    if (event.target instanceof Element && event.target.closest('button, input, select')) return
    event.preventDefault()
    if (!this.state.inShip) this.observer?.zoom(event.deltaY)
  }
  private keyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' && this.state.pickingSite) this.publish({ pickingSite: false })
    if (event.target instanceof Element && event.target.closest('input, select, textarea, button, [contenteditable="true"], dialog')) return
    this.keys.add(event.code)
  }
  private keyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code) }
  private blur = (): void => {
    this.keys.clear()
    this.pointers.clear()
    setInputSource(this.input.state, this.pointerLook, null)
    if (this.state.inShip) this.publish({ playing: false, notice: this.note('Flight paused when the window lost focus.') })
  }
  private visibility = (): void => {
    this.previousTime = 0
    if (document.hidden) {
      this.keys.clear()
      this.pointers.clear()
      setInputSource(this.input.state, this.pointerLook, null)
      this.publish({ playing: false, notice: this.note('Simulation paused while this tab was hidden.') })
    }
  }
  private resize = (): void => {
    if (this.observer) {
      const old = Math.max(1, 0.8 / this.observer.aspect)
      this.observer.aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight)
      this.observer.distance *= Math.max(1, 0.8 / this.observer.aspect) / old
    }
    this.renderer?.resize()
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.frame)
    this.input.dispose()
    this.renderer?.dispose()
    this.container.removeEventListener('pointerdown', this.pointerDown)
    this.container.removeEventListener('pointermove', this.pointerMove)
    this.container.removeEventListener('pointerup', this.pointerUp)
    this.container.removeEventListener('pointercancel', this.pointerUp)
    this.container.removeEventListener('wheel', this.wheel)
    window.removeEventListener('keydown', this.keyDown)
    window.removeEventListener('keyup', this.keyUp)
    window.removeEventListener('blur', this.blur)
    window.removeEventListener('resize', this.resize)
    document.removeEventListener('visibilitychange', this.visibility)
  }
}
