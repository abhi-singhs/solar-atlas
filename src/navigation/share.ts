import { isShipId } from '../cockpit/ships'
import { NORMAL_LIMIT_C, WARP_LIMIT_C } from '../flight/FlightController'
import { MAX_STOPS } from '../flight/route'
import type { StopAction } from '../flight/route'
import { parseUtcMilliseconds } from '../simulation/time'
import { EXPOSURE_EV, FOV_DEGREES, inRange, MAX_TIME_SCALE, MUSIC_VOLUME } from './limits'
import type { ViewState } from './state'

export const SHARE_VERSION = 1

export type SharedSettings = Partial<Pick<ViewState,
  'labels' | 'paths' | 'exposure' | 'fov' | 'lensFlare' | 'glareHidesStars' | 'music' | 'musicVolume' | 'shipModel'>>

/** Orbit camera framing. `targetId` is the body the camera circles when it differs from the selected body, as in a system view. */
export interface SharedFraming {
  theta: number
  phi: number
  distanceKm: number
  targetId?: string
}

export interface SharedStop {
  bodyId: string
  action: StopAction
}

/** Everything a share link can carry. Missing fields keep the recipient's own state. */
export interface SharedJourney {
  mode: 'explore' | 'ship'
  /** Selected body in Explore, or where the ship starts. */
  bodyId?: string
  /** UTC as YYYY-MM-DDTHH:mm:ssZ. */
  utc?: string
  timeScale?: number
  playing?: boolean
  observerMode?: ViewState['observerMode']
  framing?: SharedFraming
  camera?: ViewState['camera']
  warp?: boolean
  throttleC?: number
  route?: SharedStop[]
  routeAutoContinue?: boolean
  routeAutoSpeed?: boolean
  settings: SharedSettings
  theme?: 'dark' | 'light'
  uiHidden?: boolean
}

export interface ParsedShareLink {
  journey: SharedJourney | null
  /** Short phrases naming each param that was ignored and why. */
  problems: string[]
}

const BODY_ID = /^[a-z0-9-]+$/
const SHIP_ONLY = ['route', 'continue', 'autospeed', 'look', 'warp', 'throttle'] as const
const EXPLORE_ONLY = ['rate', 'play', 'cam', 'view'] as const
const BOOLEANS = new Map([['1', true], ['0', false], ['true', true], ['false', false], ['on', true], ['off', false]])

// URLSearchParams would escape these, and every value here is already restricted to safe characters.
const encode = (value: string): string => encodeURIComponent(value).replace(/%2C/gi, ',').replace(/%3A/gi, ':')
const flag = (value: boolean): string => value ? '1' : '0'
const fixed = (value: number, digits: number): string => String(Number(value.toFixed(digits)))
const precise = (value: number): string => String(Number(value.toPrecision(6)))

/** The query string for a journey, without the leading `?`. */
export function shareQuery(journey: SharedJourney): string {
  const parts: string[] = []
  const add = (key: string, value: string | undefined) => { if (value !== undefined) parts.push(`${key}=${encode(value)}`) }
  const bool = (key: string, value: boolean | undefined) => add(key, value === undefined ? undefined : flag(value))
  const { settings } = journey
  add('v', String(SHARE_VERSION))
  add('mode', journey.mode)
  add('body', journey.bodyId)
  add('t', journey.utc)
  if (journey.mode === 'explore') {
    add('cam', journey.observerMode)
    if (journey.framing) {
      const { theta, phi, distanceKm, targetId } = journey.framing
      const view = [fixed(Math.atan2(Math.sin(theta), Math.cos(theta)), 4), fixed(phi, 4), precise(distanceKm)]
      if (targetId && targetId !== journey.bodyId) view.push(targetId)
      add('view', view.join(','))
    }
    add('rate', journey.timeScale === undefined ? undefined : String(journey.timeScale))
    bool('play', journey.playing)
  } else {
    if (journey.route?.length) add('route', journey.route.map(stop => stop.action === 'land' ? `${stop.bodyId}~land` : stop.bodyId).join(','))
    bool('continue', journey.routeAutoContinue)
    bool('autospeed', journey.routeAutoSpeed)
    add('look', journey.camera)
    bool('warp', journey.warp)
    add('throttle', journey.throttleC === undefined ? undefined : precise(journey.throttleC))
  }
  add('ship', settings.shipModel)
  bool('labels', settings.labels)
  bool('paths', settings.paths)
  add('ev', settings.exposure === undefined ? undefined : fixed(settings.exposure, 2))
  add('fov', settings.fov === undefined ? undefined : fixed(settings.fov, 1))
  bool('flare', settings.lensFlare)
  bool('glare', settings.glareHidesStars)
  bool('music', settings.music)
  add('vol', settings.musicVolume === undefined ? undefined : fixed(settings.musicVolume, 2))
  add('theme', journey.theme)
  if (journey.uiHidden) add('ui', 'hidden')
  return parts.join('&')
}

/** A link to `pageUrl` without its own query or hash, carrying the journey. */
export function buildShareLink(pageUrl: string, journey: SharedJourney): string {
  const url = new URL(pageUrl)
  return `${url.origin}${url.pathname}?${shareQuery(journey)}`
}

/** Accepts a date, a date and minutes, or a full UTC time, and returns YYYY-MM-DDTHH:mm:ss[.ffffff]Z. */
function normalizeUtc(raw: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::(\d{2}(?:\.\d{1,6})?))?)?Z?$/.exec(raw)
  if (!match) return undefined
  const iso = `${match[1]}T${match[2] ?? '00:00'}:${match[3] ?? '00'}Z`
  try {
    parseUtcMilliseconds(iso)
    return iso
  } catch {
    return undefined
  }
}

const number = (range: { min: number; max: number }) => (raw: string): number | undefined => {
  if (!raw) return undefined
  const value = Number(raw)
  return inRange(value, range) ? value : undefined
}
const oneOf = <T extends string>(...values: T[]) => (raw: string): T | undefined => values.find(value => value === raw)

/**
 * Reads a share link's query string. A link without `v` is not a share link and returns no journey. Each bad param is dropped
 * on its own with a problem, so the rest of the link still applies. Body ids and the date range depend on the dataset, so the
 * Explorer checks those once it has loaded.
 */
export function parseShareLink(search: string): ParsedShareLink {
  const params = new URLSearchParams(search)
  const version = params.get('v')
  if (version === null) return { journey: null, problems: [] }
  if (version.trim() !== String(SHARE_VERSION)) {
    return { journey: null, problems: [`v=${version.slice(0, 12)}, a share format this version of Solar Atlas cannot read`] }
  }
  const problems: string[] = []
  const read = <T>(key: string, parse: (raw: string) => T | undefined, expected: string): T | undefined => {
    const raw = params.get(key)
    if (raw === null) return undefined
    const value = parse(raw.trim())
    if (value === undefined) problems.push(`${key}=${raw.slice(0, 40)}, expected ${expected}`)
    return value
  }
  const bool = (key: string) => read(key, raw => BOOLEANS.get(raw.toLowerCase()), '1 or 0')

  const rawRoute = params.get('route')?.trim()
  const mode = read('mode', oneOf('explore', 'ship'), 'explore or ship') ?? (rawRoute ? 'ship' : 'explore')
  const misplaced = (mode === 'explore' ? SHIP_ONLY : EXPLORE_ONLY).filter(key => params.has(key))
  if (misplaced.length) problems.push(`${misplaced.join(', ')}, which only apply in ${mode === 'explore' ? 'Spaceship' : 'Explore'} mode`)

  const journey: SharedJourney = {
    mode,
    bodyId: read('body', raw => BODY_ID.test(raw) ? raw : undefined, 'a body id'),
    utc: read('t', normalizeUtc, 'a UTC date like 2026-12-25T18:00:00Z'),
    settings: {
      shipModel: read('ship', raw => isShipId(raw) ? raw : undefined, 'a ship from the hangar'),
      labels: bool('labels'),
      paths: bool('paths'),
      exposure: read('ev', number(EXPOSURE_EV), `exposure from ${EXPOSURE_EV.min} to ${EXPOSURE_EV.max} EV`),
      fov: read('fov', number(FOV_DEGREES), `a field of view from ${FOV_DEGREES.min} to ${FOV_DEGREES.max} degrees`),
      lensFlare: bool('flare'),
      glareHidesStars: bool('glare'),
      music: bool('music'),
      musicVolume: read('vol', number(MUSIC_VOLUME), `a volume from ${MUSIC_VOLUME.min} to ${MUSIC_VOLUME.max}`),
    },
    theme: read('theme', oneOf('dark', 'light'), 'dark or light'),
    uiHidden: read('ui', raw => raw === 'hidden' ? true : raw === 'shown' ? false : undefined, 'hidden or shown'),
  }

  if (mode === 'explore') {
    journey.observerMode = read('cam', oneOf('orbit', 'follow', 'free'), 'orbit, follow, or free')
    journey.framing = read('view', parseFraming, 'theta,phi,distance in radians and km, with an optional body id')
    journey.timeScale = read('rate', raw => {
      const value = raw ? Number(raw) : NaN
      return Number.isFinite(value) && value !== 0 && Math.abs(value) <= MAX_TIME_SCALE ? value : undefined
    }, `a nonzero time rate up to ${MAX_TIME_SCALE.toLocaleString('en-US')} in either direction`)
    journey.playing = bool('play')
    return { journey: compact(journey), problems }
  }

  journey.route = rawRoute ? parseRoute(rawRoute, problems) : undefined
  journey.routeAutoContinue = bool('continue')
  journey.routeAutoSpeed = bool('autospeed')
  journey.camera = read('look', oneOf('cockpit', 'chase'), 'cockpit or chase')
  journey.warp = bool('warp')
  const limit = journey.warp ? WARP_LIMIT_C : NORMAL_LIMIT_C
  journey.throttleC = read('throttle', number({ min: 0, max: limit }),
    journey.warp ? `a speed from 0 to ${WARP_LIMIT_C}c` : 'a speed below 1c, or warp=1 for faster')
  return { journey: compact(journey), problems }
}

function parseFraming(raw: string): SharedFraming | undefined {
  const [theta, phi, distanceKm, targetId, ...rest] = raw.split(',')
  if (rest.length || distanceKm === undefined || (targetId !== undefined && !BODY_ID.test(targetId))) return undefined
  const values = [theta, phi, distanceKm].map(value => value.trim() ? Number(value) : NaN)
  if (!values.every(Number.isFinite) || Math.abs(values[1]) > Math.PI / 2 || values[2] <= 0) return undefined
  return { theta: values[0], phi: values[1], distanceKm: values[2], ...(targetId ? { targetId } : {}) }
}

function parseRoute(raw: string, problems: string[]): SharedStop[] {
  const stops: SharedStop[] = []
  for (const item of raw.split(',').map(part => part.trim()).filter(Boolean)) {
    const [bodyId, action, ...rest] = item.split('~')
    if (!BODY_ID.test(bodyId) || rest.length) {
      problems.push(`route stop ${item.slice(0, 40)}, expected a body id`)
      continue
    }
    if (stops.some(stop => stop.bodyId === bodyId)) {
      problems.push(`route stop ${bodyId}, which appears twice`)
      continue
    }
    if (stops.length >= MAX_STOPS) {
      problems.push(`route stops after the first ${MAX_STOPS}, the most a route holds`)
      break
    }
    if (action !== undefined && action !== 'land' && action !== 'arrive') {
      problems.push(`route action ${item.slice(0, 40)}, expected land or arrive, so the ship parks nearby`)
    }
    stops.push({ bodyId, action: action === 'land' ? 'land' : 'arrive' })
  }
  return stops
}

/** Drops undefined fields so a parsed journey compares equal to the one it was built from. */
function compact(journey: SharedJourney): SharedJourney {
  const settings = Object.fromEntries(Object.entries(journey.settings).filter(([, value]) => value !== undefined)) as SharedSettings
  const rest = Object.fromEntries(Object.entries(journey).filter(([, value]) => value !== undefined)) as SharedJourney
  return { ...rest, settings }
}
