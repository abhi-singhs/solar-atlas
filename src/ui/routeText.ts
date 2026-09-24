import { currentStop, pendingCount } from '../flight/route'
import type { ViewState } from '../navigation/state'
import { duration } from './format'

const eta = (view: ViewState): string => view.etaSeconds > 0 && Number.isFinite(view.etaSeconds) ? duration(view.etaSeconds) : ''

/** Short state for the active stop's own row, so it does not repeat the route header. */
export function stopStatus(view: ViewState): string {
  if (view.routePhase === 'departing') return view.shipMode === 'takeoff' ? 'Taking off' : 'Departing'
  if (view.routePhase === 'enroute') return view.shipMode === 'landing' ? 'Descending' : eta(view) ? `Arriving in ${eta(view)}` : 'En route'
  if (view.routePhase === 'dwell') return Number.isFinite(view.routeDwell) ? `Next, leaving in ${Math.ceil(view.routeDwell)} s` : 'Next, waiting for you'
  return ''
}

export const routeRunning = (view: ViewState): boolean => ['departing', 'enroute', 'dwell'].includes(view.routePhase)

/** The single next step for the route, shared by the full panel and the collapsed strip. */
export function routePrimary(view: ViewState): { label: string; kind: 'go' | 'pause' } | null {
  if (!view.route.length) return null
  if (view.routePhase === 'dwell') return { label: 'Depart now', kind: 'go' }
  if (routeRunning(view)) return { label: 'Pause route', kind: 'pause' }
  if (!pendingCount(view.route)) return { label: 'Fly again', kind: 'go' }
  return { label: view.route.some(stop => stop.status !== 'pending') ? 'Resume route' : 'Start route', kind: 'go' }
}

export function routeStatus(view: ViewState, name: (id: string) => string): string {
  const stop = currentStop(view.route)
  const done = view.route.length - pendingCount(view.route)
  switch (view.routePhase) {
    case 'departing': return stop ? `Departing for ${name(stop.bodyId)}` : 'Departing'
    case 'enroute': return stop ? `To ${name(stop.bodyId)}${eta(view) ? ` · ${eta(view)}` : ''}` : 'En route'
    case 'dwell': return Number.isFinite(view.routeDwell) ? `Next stop in ${Math.ceil(view.routeDwell)} s` : 'Waiting for you'
    case 'complete': return `Complete · ${view.route.filter(item => item.status === 'visited').length} visited`
    default: return view.route.length ? `${done} of ${view.route.length} done` : 'No destinations'
  }
}
