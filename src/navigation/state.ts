import type { Body, CameraPose, Quality, ShipMode } from '../contracts'
import type { RoutePhase, RouteStop } from '../flight/route'

export interface ViewState {
  ready: boolean
  loading: string
  selectedId: string
  bodies: Body[]
  date: string
  jd: number
  firstJd: number
  lastJd: number
  playing: boolean
  timeScale: number
  observerMode: 'orbit' | 'follow' | 'free'
  inShip: boolean
  camera: 'cockpit' | 'chase'
  shipMode: ShipMode
  speedC: number
  throttleC: number
  warp: boolean
  warpArmed: boolean
  referenceId: string
  altitudeKm: number
  altitudeEstimated: boolean
  verticalKmS: number
  separationKm: number
  observerDistanceKm: number
  etaSeconds: number
  labels: boolean
  paths: boolean
  quality: Quality
  exposure: number
  fov: number
  lensFlare: boolean
  glareHidesStars: boolean
  pickingSite: boolean
  notice: Notice | null
  fps: number
  bookmarks: Bookmark[]
  route: RouteStop[]
  routePhase: RoutePhase
  routeAutoContinue: boolean
  routeAutoSpeed: boolean
  /** Seconds left before auto-continuing, or Infinity while waiting for the pilot. */
  routeDwell: number
}

export type NoticeTone = 'info' | 'warning' | 'error'

/** A short popup. Routine status belongs in the panels instead; `id` changes on every publish so repeats restart the timer. */
export interface Notice {
  text: string
  tone: NoticeTone
  id: number
}

export interface Bookmark {
  bodyId: string
  name: string
  jd: number
}

export interface SavedSettings {
  version: 1
  labels: boolean
  paths: boolean
  quality: Quality
  exposure: number
  fov?: number
  lensFlare?: boolean
  glareHidesStars?: boolean
  bookmarks: Bookmark[]
}

export const initialState: ViewState = {
  ready: false, loading: 'Opening the source-backed atlas', selectedId: 'earth', bodies: [],
  date: '', jd: 0, firstJd: 0, lastJd: 1, playing: false, timeScale: 3600,
  observerMode: 'orbit', inShip: false, camera: 'cockpit', shipMode: 'free',
  speedC: 0, throttleC: 0, warp: false, warpArmed: false, referenceId: 'earth',
  altitudeKm: 0, altitudeEstimated: false, verticalKmS: 0, separationKm: 0, observerDistanceKm: 0, etaSeconds: Infinity,
  labels: true, paths: false, quality: matchMedia('(pointer: coarse)').matches ? 'low' : 'high',
  exposure: 0, fov: 50, lensFlare: true, glareHidesStars: true, pickingSite: false, notice: null, fps: 0, bookmarks: [],
  route: [], routePhase: 'idle', routeAutoContinue: true, routeAutoSpeed: true, routeDwell: 0,
}

export type PoseRecord = CameraPose
