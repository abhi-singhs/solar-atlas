import { useState } from 'react'
import { ChevronUp, Compass, EyeOff, Layers3, Maximize, Orbit, Pause, Play } from 'lucide-react'
import type { ViewState } from '../navigation/state'
import { Popover } from './Popover'

export type DockMenu = 'date' | 'view' | null
type Frame = 'local' | 'inner' | 'all'

const rates: [number, string][] = [
  [-86400, 'Reverse 1 day/s'], [-3600, 'Reverse 1 hour/s'], [1, 'Real time'], [60, '1 min/s'],
  [3600, '1 hour/s'], [86400, '1 day/s'], [604800, '1 week/s'],
]
const cameraModes = [['orbit', 'Orbit', '1'], ['follow', 'Follow', '2'], ['free', 'Free', '3']] as const
const frames: [Frame, string, typeof Orbit][] = [['local', 'Local system', Orbit], ['inner', 'Inner system', Compass], ['all', 'Solar system', Maximize]]

interface DockProps {
  view: ViewState
  date: string
  menu: DockMenu
  onMenu: (menu: DockMenu) => void
  onTogglePlay: () => void
  onScrub: (jd: number) => void
  onSetUtc: (iso: string) => void
  onRate: (value: number) => void
  onCamera: (mode: ViewState['observerMode']) => void
  onFrame: (frame: Frame) => void
  onOption: (key: 'labels' | 'paths', value: boolean) => void
  onHide: () => void
}

export function Dock({ view, date, menu, onMenu, ...actions }: DockProps) {
  const [dateInput, setDateInput] = useState('')
  const toggle = (next: Exclude<DockMenu, null>) => {
    if (next === 'date' && menu !== 'date') setDateInput(view.date.slice(0, 16))
    onMenu(menu === next ? null : next)
  }
  const applyDate = () => {
    actions.onSetUtc(`${dateInput || view.date.slice(0, 16)}:00Z`)
    onMenu(null)
  }
  const rateLabel = rates.find(([value]) => value === view.timeScale)?.[1] ?? `${view.timeScale.toLocaleString()}x`

  return <section className="dock panel" aria-label="Simulation timeline">
    <button className="play-button" aria-label={view.playing ? 'Pause simulation' : 'Play simulation'} aria-keyshortcuts="Space P"
      title={view.playing ? 'Pause (Space)' : 'Play (Space)'} onClick={actions.onTogglePlay}>
      {view.playing ? <Pause size={18} /> : <Play size={18} />}
    </button>
    <div className="dock-date">
      <Popover open={menu === 'date'} onClose={() => onMenu(null)} label="Choose a date" className="date-popover"
        trigger={<button className="date-button" aria-expanded={menu === 'date'} title="Choose a date" onClick={() => toggle('date')}>
          {date}<small>UTC</small>
        </button>}>
        <label className="field">UTC date and time
          <input type="datetime-local" aria-label="UTC date" value={dateInput} onChange={event => setDateInput(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') applyDate() }} />
        </label>
        <button className="primary" onClick={applyDate}>Set UTC date</button>
        <p className="popover-note">Cached coverage runs from 5 September 2026 to 5 September 2027.</p>
      </Popover>
    </div>
    <div className="timeline-track">
      <span>5 Sep 2026</span>
      <input type="range" aria-label="Simulation date" aria-valuetext={`${date} UTC`} min={view.firstJd} max={view.lastJd} step={1 / 86400}
        value={view.jd} onChange={event => actions.onScrub(Number(event.target.value))} />
      <span>5 Sep 2027</span>
    </div>
    <label className="rate-select" title={`Time rate: ${view.timeScale.toLocaleString()}x`}>
      <span className="sr-only">Time rate</span>
      <select aria-label="Time acceleration" value={view.timeScale} onChange={event => actions.onRate(Number(event.target.value))}>
        {rates.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        {!rates.some(([value]) => value === view.timeScale) && <option value={view.timeScale}>{rateLabel}</option>}
      </select>
    </label>
    <div className="dock-view">
      <div className="segmented" role="group" aria-label="Camera">
        {cameraModes.map(([mode, label, key]) => <button key={mode} aria-pressed={view.observerMode === mode}
          className={view.observerMode === mode ? 'active' : ''} title={`${label} camera (${key})`} aria-keyshortcuts={key}
          onClick={() => actions.onCamera(mode)}>{label}</button>)}
      </div>
      <Popover open={menu === 'view'} onClose={() => onMenu(null)} label="View options" className="view-popover"
        trigger={<button className={`view-button ${menu === 'view' ? 'active' : ''}`} aria-expanded={menu === 'view'} onClick={() => toggle('view')}>
          <Layers3 size={16} />View<ChevronUp size={14} className="chevron" />
        </button>}>
        <span className="menu-label">Frame</span>
        <div className="frame-buttons">
          {frames.map(([frame, label, Icon]) => <button key={frame} onClick={() => { actions.onFrame(frame); onMenu(null) }}>
            <Icon size={16} />{label}
          </button>)}
        </div>
        <span className="menu-label">Show</span>
        <button role="switch" aria-checked={view.labels} className="switch-row" aria-keyshortcuts="L" onClick={() => actions.onOption('labels', !view.labels)}>
          <span>Body labels</span><kbd>L</kbd><span className="switch" aria-hidden="true" />
        </button>
        <button role="switch" aria-checked={view.paths} className="switch-row" aria-keyshortcuts="T" onClick={() => actions.onOption('paths', !view.paths)}>
          <span>Trajectories</span><kbd>T</kbd><span className="switch" aria-hidden="true" />
        </button>
        <button className="switch-row" aria-keyshortcuts="H" onClick={() => { onMenu(null); actions.onHide() }}>
          <span><EyeOff size={15} />Hide interface</span><kbd>H</kbd>
        </button>
      </Popover>
    </div>
  </section>
}
