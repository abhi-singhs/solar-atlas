import {
  ArrowDownToLine, ArrowUpFromLine, ChevronDown, ChevronUp, Eye, EyeOff, LocateFixed, Pause, Play, Rocket, Shield, Square, Volume2, VolumeX, X,
} from 'lucide-react'
import { currentStop, pendingCount } from '../flight/route'
import type { Body, ShipMode } from '../contracts'
import { C_KM_S } from '../contracts'
import type { ViewState } from '../navigation/state'
import { TERRAIN_LABEL } from '../terrain'
import { distance, duration, speed } from './format'
import { RoutePanel } from './RoutePanel'
import { routePrimary } from './routeText'
import type { RouteActions } from './RoutePanel'

const modeLabel: Record<ShipMode, string> = {
  free: 'Free flight', transfer: 'Transfer', approach: 'Approach', landing: 'Landing', landed: 'Landed', hover: 'Hover', takeoff: 'Takeoff',
}
const presets: [string, number][] = [['Dock', 0.00000001], ['Cruise', 0.01], ['0.5c', 0.5], ['100c', 100], ['1,000c', 1000]]

interface FlightPanelProps {
  view: ViewState
  bodies: Body[]
  expanded: boolean
  throttle: string
  canLand: boolean
  hoverTarget: boolean
  onToggle: () => void
  onThrottleInput: (value: string) => void
  onApplySpeed: () => void
  onSpeed: (c: number) => void
  onWarp: () => void
  onTravel: () => void
  onLandOrTakeoff: () => void
  onBrake: () => void
  onCamera: () => void
  onLookForward: () => void
  onTogglePlay: () => void
  onCancel: () => void
  onHide: () => void
  onMusic: () => void
  route: RouteActions
}

export function FlightPanel(props: FlightPanelProps) {
  const { view, bodies, expanded, canLand, hoverTarget } = props
  const name = (id: string) => bodies.find(body => body.id === id)?.name ?? id
  const grounded = view.shipMode === 'landed' || view.shipMode === 'hover'
  const assisted = ['transfer', 'approach', 'landing', 'takeoff'].includes(view.shipMode)
  const landLabel = grounded ? 'Take off' : hoverTarget ? 'Hover' : 'Land'
  const warpAllowed = view.warp || view.warpArmed
  const primary = routePrimary(view)
  const stop = currentStop(view.route)
  const legInfo = stop && view.routePhase !== 'idle' && view.routePhase !== 'complete'
    ? `${view.route.length - pendingCount(view.route) + 1}/${view.route.length} ${name(stop.bodyId)}`
    : ''

  const summary = <div className="flight-summary">
    <span className="ship-status" data-testid="ship-status">
      <span className={`status-dot ${assisted ? 'busy' : ''}`} />{modeLabel[view.shipMode]}
      <span className="muted">{view.camera === 'cockpit' ? 'Cockpit' : 'Chase'} · {view.playing ? '1x' : 'Paused'}</span>
    </span>
    {!expanded && <span className="flight-mini">{speed(view.speedC)} · {legInfo || name(view.selectedId)}</span>}
  </div>

  const toggle = <button className="flight-toggle icon-button ghost" aria-label="Toggle flight panel" aria-expanded={expanded}
    title={expanded ? 'Collapse flight controls' : 'Expand flight controls'} onClick={props.onToggle}>
    {expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
  </button>

  const travel = <button className="primary" onClick={props.onTravel} title={`Assisted transfer to ${name(view.selectedId)}`}><Rocket size={15} />Travel</button>
  const routeButton = primary && <button className={primary.kind === 'go' ? 'primary' : ''} aria-keyshortcuts="G" title={`${primary.label} (G)`}
    onClick={primary.kind === 'go' ? props.route.onGo : props.route.onPause}>{primary.kind === 'go' ? <Play size={15} /> : <Pause size={15} />}{primary.label}</button>
  const routeBusy = Boolean(legInfo)
  const actions = <div className="ship-actions">
    {!expanded && routeButton ? routeButton : travel}
    {!(routeBusy && !expanded) && <button disabled={!canLand} onClick={props.onLandOrTakeoff}>
      {grounded ? <ArrowUpFromLine size={15} /> : <ArrowDownToLine size={15} />}{landLabel}
    </button>}
    <button className="brake-button" onClick={props.onBrake} title="Brake (Space)"><Square size={13} />Brake</button>
  </div>

  if (!expanded) return <section className="flight-panel panel collapsed" aria-label="Spacecraft controls">{summary}{toggle}{actions}</section>

  return <section className="flight-panel panel expanded" aria-label="Spacecraft controls">
    <header className="flight-header">{summary}
      <button className="icon-button ghost" aria-label="Music" aria-pressed={view.music} aria-keyshortcuts="M"
        title={view.music ? 'Turn music off (M)' : 'Turn music on (M)'} onClick={props.onMusic}>
        {view.music ? <Volume2 size={18} /> : <VolumeX size={18} />}
      </button>
      {toggle}
    </header>
    <div className="flight-readout">
      <strong data-testid="actual-speed">{speed(view.speedC)}</strong>
      <small>{distance(view.speedC * C_KM_S)}/s relative to {name(view.referenceId)} center</small>
    </div>
    <dl className="flight-metrics">
      <div><dt>Target</dt><dd>{name(view.selectedId)}</dd></div>
      <div><dt>Range</dt><dd>{distance(view.separationKm)}</dd></div>
      <div><dt>Arrival</dt><dd>{grounded ? 'Arrived' : view.etaSeconds > 0 && Number.isFinite(view.etaSeconds) ? duration(view.etaSeconds)
        : assisted ? 'Calculating' : 'No transfer'}</dd></div>
      <div><dt>Altitude</dt><dd data-testid="altitude">{distance(view.altitudeKm)}</dd></div>
    </dl>
    {['landing', 'landed', 'takeoff'].includes(view.shipMode) && <p className="terrain-note">{TERRAIN_LABEL}</p>}
    <RoutePanel view={view} bodies={bodies} {...props.route} />
    <div className="throttle-controls">
      <div className="throttle-title">
        <label htmlFor="throttle">Commanded speed</label>
        <button className={`warp-toggle ${warpAllowed ? 'active' : ''}`} aria-pressed={warpAllowed} onClick={props.onWarp}
          title={view.warpArmed ? 'Warp engages once the ship clears the nearby exclusion zone' : 'Warp allows fictional speeds at or above c'}>
          <Shield size={13} />Warp {view.warp ? 'on' : view.warpArmed ? 'armed' : 'off'}</button>
      </div>
      <div className="speed-presets">{presets.map(([label, value]) => <button key={label} disabled={value >= 1 && !warpAllowed}
        title={value >= 1 && !warpAllowed ? 'Turn on Warp for speeds at or above c' : `Set ${label}`} onClick={() => props.onSpeed(value)}>{label}</button>)}</div>
      <input type="range" aria-label="Logarithmic speed" min="-12" max={warpAllowed ? 3 : -0.000001} step=".01"
        value={Math.log10(Math.max(1e-12, view.throttleC))} onChange={event => props.onSpeed(10 ** Number(event.target.value))} />
      <div className="numeric-throttle">
        <input id="throttle" aria-label="Commanded speed in c" type="number" min="0" max={warpAllowed ? 1000 : 0.999999} step="any"
          value={props.throttle} onChange={event => props.onThrottleInput(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') props.onApplySpeed() }} />
        <span>c</span>
        <button onClick={props.onApplySpeed}>Set</button>
      </div>
    </div>
    {actions}
    <div className="ship-secondary">
      <button onClick={props.onCamera} title="Switch camera (C)" aria-keyshortcuts="C"><Eye size={15} />{view.camera === 'cockpit' ? 'Chase view' : 'Cockpit'}</button>
      <button onClick={props.onLookForward}><LocateFixed size={15} />Look forward</button>
      <button onClick={props.onTogglePlay} title="Pause or resume (P)" aria-keyshortcuts="P">
        {view.playing ? <Pause size={15} /> : <Play size={15} />}{view.playing ? 'Pause flight' : 'Resume flight'}
      </button>
      <button onClick={props.onHide} title="Hide interface (H)" aria-keyshortcuts="H"><EyeOff size={15} />Hide interface</button>
      {assisted && <button className="wide-row" onClick={props.onCancel}><X size={15} />Cancel autopilot</button>}
    </div>
  </section>
}
