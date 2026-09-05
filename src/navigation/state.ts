import type { Body, CameraPose, Quality, ShipMode } from '../contracts'

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
  referenceId: string
  altitudeKm: number
  verticalKmS: number
  separationKm: number
  observerDistanceKm: number
  etaSeconds: number
  labels: boolean
  paths: boolean
  quality: Quality
  exposure: number
  fov: number
  pickingSite: boolean
  message: string
  fps: number
  bookmarks: Bookmark[]
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
  bookmarks: Bookmark[]
}

export const initialState: ViewState = {
  ready: false, loading: 'Opening the source-backed atlas', selectedId: 'earth', bodies: [],
  date: '', jd: 0, firstJd: 0, lastJd: 1, playing: false, timeScale: 3600,
  observerMode: 'orbit', inShip: false, camera: 'cockpit', shipMode: 'free',
  speedC: 0, throttleC: 0, warp: false, referenceId: 'earth',
  altitudeKm: 0, verticalKmS: 0, separationKm: 0, observerDistanceKm: 0, etaSeconds: Infinity,
  labels: true, paths: false, quality: matchMedia('(pointer: coarse)').matches ? 'low' : 'high',
  exposure: 0, fov: 50, pickingSite: false, message: '', fps: 0, bookmarks: [],
}

export type PoseRecord = CameraPose
