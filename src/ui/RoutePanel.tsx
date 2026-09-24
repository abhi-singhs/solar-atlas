import { ArrowUp, Check, Pause, Play, Plus, Route as RouteIcon, SkipForward, X } from 'lucide-react'
import type { Body } from '../contracts'
import { canLandOn, currentStop, landLabel } from '../flight/route'
import type { RouteStop, StopAction } from '../flight/route'
import type { ViewState } from '../navigation/state'
import { routePrimary, routeRunning, routeStatus, stopStatus } from './routeText'

export interface RouteActions {
  onGo: () => void
  onPause: () => void
  onSkip: () => void
  onAddDestination: () => void
  onRemove: (key: number) => void
  onMove: (key: number, delta: -1 | 1) => void
  onAction: (key: number, action: StopAction) => void
  onClear: () => void
  onOption: (key: 'routeAutoContinue' | 'routeAutoSpeed', value: boolean) => void
}

interface RoutePanelProps extends RouteActions {
  view: ViewState
  bodies: Body[]
}

export function RoutePanel({ view, bodies, ...actions }: RoutePanelProps) {
  const find = (id: string) => bodies.find(body => body.id === id)
  const name = (id: string) => find(id)?.name ?? id
  const active = currentStop(view.route)
  const primary = routePrimary(view)
  const isRunning = routeRunning(view)

  const stopRow = (stop: RouteStop, index: number) => {
    const body = find(stop.bodyId)
    const pending = stop.status === 'pending'
    const current = stop.key === active?.key
    const landable = body ? canLandOn(body) : false
    const label = body ? landLabel(body) : 'Land'
    return <li key={stop.key} className={`route-stop ${stop.status} ${current ? 'current' : ''}`} aria-current={current ? 'step' : undefined}>
      <span className="stop-marker" aria-hidden="true">
        {stop.status === 'visited' ? <Check size={13} /> : stop.status === 'skipped' ? <SkipForward size={12} /> : index + 1}
      </span>
      <span className="stop-name">
        <strong>{name(stop.bodyId)}</strong>
        <small>{stop.status === 'visited' ? 'Visited' : stop.status === 'skipped' ? 'Skipped'
          : current && isRunning ? stopStatus(view) : stop.action === 'land' ? `${label} on arrival` : 'Park nearby'}</small>
      </span>
      {pending && landable && <button className={`stop-action ${stop.action === 'land' ? 'active' : ''}`} aria-pressed={stop.action === 'land'}
        title={`${label} at ${name(stop.bodyId)} instead of parking nearby`}
        onClick={() => actions.onAction(stop.key, stop.action === 'land' ? 'arrive' : 'land')}>{label}</button>}
      {pending && <button className="icon-button ghost" aria-label={`Move ${name(stop.bodyId)} earlier`} title="Move earlier"
        disabled={index === 0} onClick={() => actions.onMove(stop.key, -1)}><ArrowUp size={15} /></button>}
      <button className="icon-button ghost" aria-label={`Remove ${name(stop.bodyId)} from route`} title="Remove"
        onClick={() => actions.onRemove(stop.key)}><X size={15} /></button>
    </li>
  }

  return <section className="route" aria-label="Route">
    <header className="route-header">
      <h2><RouteIcon size={15} aria-hidden="true" />Route</h2>
      <span className="route-status" aria-live="polite">{routeStatus(view, name)}</span>
    </header>
    {view.route.length
      ? <ol className="route-list">{view.route.map(stopRow)}</ol>
      : <p className="route-empty">Add destinations and the ship flies to each one in order, parking or landing as you choose.</p>}
    <div className="route-buttons">
      {primary && <button className={primary.kind === 'go' ? 'primary' : ''} aria-keyshortcuts="G"
        title={`${primary.label} (G)`} onClick={primary.kind === 'go' ? actions.onGo : actions.onPause}>
        {primary.kind === 'go' ? <Play size={15} /> : <Pause size={15} />}{primary.label}
      </button>}
      {view.routePhase === 'dwell' && <button onClick={actions.onPause}><Pause size={15} />Pause route</button>}
      {(view.routePhase === 'enroute' || view.routePhase === 'departing') && <button onClick={actions.onSkip}><SkipForward size={15} />Skip stop</button>}
      <button className={primary ? '' : 'primary'} onClick={actions.onAddDestination} aria-keyshortcuts="+"
        title="Add a destination (+ adds the selected body)"><Plus size={15} />Add destination</button>
    </div>
    {view.route.length > 0 && <div className="route-options">
      <button role="switch" aria-checked={view.routeAutoContinue} className="switch-row"
        title={`Leave each stop after a short pause instead of waiting for you`}
        onClick={() => actions.onOption('routeAutoContinue', !view.routeAutoContinue)}>
        <span>Auto-continue</span><span className="switch" aria-hidden="true" />
      </button>
      <button role="switch" aria-checked={view.routeAutoSpeed} className="switch-row"
        title="Set the commanded speed for each leg so it takes about 30 seconds, within the Warp setting"
        onClick={() => actions.onOption('routeAutoSpeed', !view.routeAutoSpeed)}>
        <span>Auto speed</span><span className="switch" aria-hidden="true" />
      </button>
      {!isRunning && <button className="link-button route-clear" onClick={actions.onClear}>Clear route</button>}
    </div>}
  </section>
}
