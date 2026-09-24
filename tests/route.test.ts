import { describe, expect, it } from 'vitest'
import type { Body } from '../src/contracts'
import { C_KM_S } from '../src/contracts'
import { NORMAL_LIMIT_C, WARP_LIMIT_C } from '../src/flight/FlightController'
import {
  addStop, currentStop, landLabel, LEG_SECONDS, legSpeedC, markStop, MAX_STOPS, moveStop, pendingCount, removeStop, resetRoute, setAction,
} from '../src/flight/route'
import type { RouteStop } from '../src/flight/route'

const body = (id: string, category = 'planet'): Body => ({ id, name: id[0].toUpperCase() + id.slice(1), category, radius_km: 1000, parent_id: 'sun' })
const route = (...ids: string[]): RouteStop[] => ids.reduce<RouteStop[]>((stops, id, key) => addStop(stops, body(id), key) as RouteStop[], [])

describe('route planning', () => {
  it('adds destinations in order and refuses a body that is already pending', () => {
    const stops = route('moon', 'mars')
    expect(stops.map(stop => stop.bodyId)).toEqual(['moon', 'mars'])
    expect(stops.every(stop => stop.status === 'pending' && stop.action === 'arrive')).toBe(true)
    expect(addStop(stops, body('mars'), 9)).toBe('Mars is already in the route.')
    const revisit = addStop(markStop(stops, 0, 'visited'), body('moon'), 9)
    expect(Array.isArray(revisit) && revisit.map(stop => stop.bodyId)).toEqual(['moon', 'mars', 'moon'])
  })

  it('caps pending stops and makes room by dropping finished ones', () => {
    const ids = Array.from({ length: MAX_STOPS }, (_, i) => `body${i}`)
    const full = route(...ids)
    expect(addStop(full, body('extra'), 99)).toContain(`${MAX_STOPS}`)
    const withDone = markStop(full, 0, 'visited')
    const next = addStop(withDone, body('extra'), 99)
    expect(Array.isArray(next) && next.length).toBe(MAX_STOPS)
    expect(Array.isArray(next) && next.at(-1)!.bodyId).toBe('extra')
  })

  it('never plans a landing on the Sun and labels giant planets as hover', () => {
    const sun = body('sun', 'star')
    const [stop] = addStop([], sun, 1, 'land') as RouteStop[]
    expect(stop.action).toBe('arrive')
    expect(landLabel(body('jupiter'))).toBe('Hover')
    expect(landLabel(body('mars'))).toBe('Land')
    expect(setAction(route('mars'), 0, 'land')[0].action).toBe('land')
  })

  it('reorders, removes, skips, and restarts without losing stops', () => {
    let stops = route('moon', 'mars', 'ceres')
    stops = moveStop(stops, 2, -1)
    expect(stops.map(stop => stop.bodyId)).toEqual(['moon', 'ceres', 'mars'])
    expect(moveStop(stops, 0, -1)).toBe(stops)
    stops = markStop(markStop(stops, 0, 'visited'), 2, 'skipped')
    expect(currentStop(stops)?.bodyId).toBe('mars')
    expect(pendingCount(stops)).toBe(1)
    stops = removeStop(stops, 1)
    expect(currentStop(stops)).toBeUndefined()
    expect(resetRoute(stops).every(stop => stop.status === 'pending')).toBe(true)
  })

  it('picks a leg speed that cruises in about thirty seconds within the warp setting', () => {
    const moon = 384400
    expect(legSpeedC(moon, false) * C_KM_S * LEG_SECONDS).toBeCloseTo(moon, 3)
    expect(legSpeedC(2.25e8, false)).toBe(NORMAL_LIMIT_C)
    expect(legSpeedC(2.25e8, true)).toBeCloseTo(2.25e8 / (LEG_SECONDS * C_KM_S), 9)
    expect(legSpeedC(1e12, true)).toBe(WARP_LIMIT_C)
    expect(legSpeedC(0, true)).toBe(0.001)
    expect(legSpeedC(Number.NaN, true)).toBe(0.001)
  })
})
