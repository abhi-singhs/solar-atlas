import { C_KM_S } from '../contracts'
import type { Body } from '../contracts'
import { NORMAL_LIMIT_C, WARP_LIMIT_C } from './FlightController'

export type StopAction = 'arrive' | 'land'
export type StopStatus = 'pending' | 'visited' | 'skipped'
export type RoutePhase = 'idle' | 'departing' | 'enroute' | 'dwell' | 'complete'

export interface RouteStop {
  key: number
  bodyId: string
  action: StopAction
  status: StopStatus
}

export const MAX_STOPS = 12
/** Auto speed aims for a cruise of about this many seconds per leg. */
export const LEG_SECONDS = 30
/** Seconds the ship waits at a stop before auto-continuing. */
export const DWELL_SECONDS = 5
/** Legs slower than this below c prompt the pilot to arm warp. */
export const SLOW_LEG_SECONDS = 180

const GAS_IDS = new Set(['jupiter', 'saturn', 'uranus', 'neptune'])
export const isStar = (body: Body): boolean => body.id === 'sun' || body.category === 'star'
export const canLandOn = (body: Body): boolean => !isStar(body)
export const landLabel = (body: Body): string => GAS_IDS.has(body.id) ? 'Hover' : 'Land'

export const currentStop = (route: RouteStop[]): RouteStop | undefined => route.find(stop => stop.status === 'pending')
export const pendingCount = (route: RouteStop[]): number => route.filter(stop => stop.status === 'pending').length
export const isPending = (route: RouteStop[], bodyId: string): boolean =>
  route.some(stop => stop.bodyId === bodyId && stop.status === 'pending')

export function addStop(route: RouteStop[], body: Body, key: number, action: StopAction = 'arrive'): RouteStop[] | string {
  if (isPending(route, body.id)) return `${body.name} is already in the route.`
  const kept = route.length >= MAX_STOPS ? route.filter(stop => stop.status === 'pending') : route
  if (kept.length >= MAX_STOPS) return `A route holds up to ${MAX_STOPS} destinations.`
  return [...kept, { key, bodyId: body.id, action: action === 'land' && canLandOn(body) ? 'land' : 'arrive', status: 'pending' }]
}

export const removeStop = (route: RouteStop[], key: number): RouteStop[] => route.filter(stop => stop.key !== key)

export function moveStop(route: RouteStop[], key: number, delta: -1 | 1): RouteStop[] {
  const index = route.findIndex(stop => stop.key === key)
  const target = index + delta
  if (index < 0 || target < 0 || target >= route.length) return route
  const next = [...route]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export const setAction = (route: RouteStop[], key: number, action: StopAction): RouteStop[] =>
  route.map(stop => stop.key === key ? { ...stop, action } : stop)

export const markStop = (route: RouteStop[], key: number, status: StopStatus): RouteStop[] =>
  route.map(stop => stop.key === key ? { ...stop, status } : stop)

export const resetRoute = (route: RouteStop[]): RouteStop[] => route.map(stop => ({ ...stop, status: 'pending' }))

/** Speed in c that covers the leg in about LEG_SECONDS, within the warp or conventional limit. */
export function legSpeedC(distanceKm: number, warpAllowed: boolean): number {
  const wanted = Math.max(0, distanceKm) / (LEG_SECONDS * C_KM_S)
  return Math.min(warpAllowed ? WARP_LIMIT_C : NORMAL_LIMIT_C, Math.max(0.001, Number.isFinite(wanted) ? wanted : 0.001))
}

export const cruiseSeconds = (distanceKm: number, speedC: number): number =>
  speedC > 0 ? Math.max(0, distanceKm) / (speedC * C_KM_S) : Infinity
