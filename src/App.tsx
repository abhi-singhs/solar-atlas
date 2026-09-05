import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowDownToLine, ArrowUpFromLine, BookmarkPlus, Check, ChevronDown, Compass, Crosshair,
  ExternalLink, Eye, Globe2, Info, Layers3, Maximize, Orbit, Pause, Play, Rocket,
  Search, Settings2, Shield, SlidersHorizontal, Square, Telescope, X,
} from 'lucide-react'
import { Explorer } from './navigation/Explorer'
import { initialState } from './navigation/state'
import type { ViewState } from './navigation/state'
import { TouchControls } from './input/TouchControls'
import { categories, distance, duration, formatNumber, speed } from './ui/format'
import { C_KM_S } from './contracts'
import type { Body } from './contracts'
import { TERRAIN_LABEL } from './terrain'

type MapRecord = { credit?: string; usage?: string; source_url?: string; notes?: string }
type Appearance = { source_status?: string; description?: string; maps?: Record<string, MapRecord> }
const base = import.meta.env.BASE_URL
const bodyName = (id: string, bodies: Body[]) => bodies.find(b => b.id === id)?.name ?? id

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
    return () => dialog.current?.close()
  }, [])
  return <dialog ref={dialog} onCancel={onClose} className="modal">
    <header><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></header>
    <div className="modal-content">{children}</div>
  </dialog>
}

function App() {
  const viewport = useRef<HTMLDivElement>(null)
  const engine = useRef<Explorer | null>(null)
  const [view, setView] = useState<ViewState>(initialState)
  const [catalog, setCatalog] = useState(false)
  const [inspector, setInspector] = useState(!matchMedia('(max-width: 760px)').matches)
  const [modal, setModal] = useState<'settings' | 'help' | 'sources' | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [appearance, setAppearance] = useState<Record<string, Appearance>>({})
  const [error, setError] = useState('')
  const [throttle, setThrottle] = useState('0.01')
  const [dateInput, setDateInput] = useState('')
  const [flightPanel, setFlightPanel] = useState(true)

  useEffect(() => {
    if (!view.message) return
    const timer = window.setTimeout(() => engine.current?.clearMessage(), 8000)
    return () => window.clearTimeout(timer)
  }, [view.message])

  useEffect(() => {
    if (document.activeElement?.id !== 'throttle') setThrottle(String(view.throttleC))
  }, [view.throttleC])

  useEffect(() => {
    const openCatalog = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      setCatalog(true)
    }
    window.addEventListener('keydown', openCatalog)
    return () => window.removeEventListener('keydown', openCatalog)
  }, [])

  useEffect(() => {
    if (!viewport.current) return
    const controller = new Explorer(viewport.current, setView)
    engine.current = controller
    controller.start().catch(e => setError(e instanceof Error ? e.message : String(e)))
    return () => { controller.dispose(); engine.current = null }
  }, [])

  useEffect(() => {
    const abort = new AbortController()
    fetch(`${base}data/asset_manifest.json`, { signal: abort.signal })
      .then(response => {
        if (!response.ok) throw new Error(`Source information failed to load (${response.status}).`)
        return response.json() as Promise<{ bodies: Record<string, Appearance> }>
      })
      .then(manifest => {
        if (!manifest.bodies || typeof manifest.bodies !== 'object') throw new Error('Invalid source information manifest.')
        setAppearance(manifest.bodies)
      }).catch(e => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setError(e instanceof Error ? e.message : String(e))
      })
    return () => abort.abort()
  }, [])

  const perform = (action: (controller: Explorer) => void | Promise<void>) => {
    if (!engine.current) return
    try {
      const result = action(engine.current)
      if (result instanceof Promise) result.catch(e => setError(e instanceof Error ? e.message : String(e)))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const selected = view.bodies.find(body => body.id === view.selectedId)
  const source = appearance[view.selectedId]
  const filtered = view.bodies.filter(body => {
    const matchesCategory = filter === 'all' || body.category === filter ||
      (filter === 'small' && ['asteroid', 'tno', 'centaur', 'comet', 'dwarf_candidate'].includes(body.category))
    return matchesCategory && `${body.name} ${body.id}`.toLowerCase().includes(query.toLowerCase())
  })
  const setSpeed = (c: number) => { setThrottle(String(c)); perform(e => e.setThrottle(c)) }
  const applySpeed = () => {
    if (!throttle.trim()) { setError('Enter a speed in c before applying the throttle.'); return }
    setSpeed(Number(throttle))
  }
  const currentDate = view.date ? view.date.slice(0, 19).replace('T', ' ') : '2026-09-05 00:00:00'
  const canLand = selected && selected.id !== 'sun'
  const hoverTarget = ['jupiter', 'saturn', 'uranus', 'neptune'].includes(view.selectedId)

  return <main className={`atlas ${view.inShip ? 'is-flying' : ''} ${flightPanel ? '' : 'controls-hidden'}`}>
    <div ref={viewport} className="universe" aria-label="Interactive solar system viewport" tabIndex={0} />

    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Orbit size={25} strokeWidth={1.25} /></span><span>Solar atlas<small>A system to explore</small></span></div>
      <nav className="mode-switch" aria-label="Experience">
        <button className={!view.inShip ? 'active' : ''} onClick={() => perform(e => e.exitShip())} disabled={!view.ready}><Telescope size={16} /><span>Explore</span></button>
        <button className={view.inShip ? 'active' : ''} onClick={() => {
          if (matchMedia('(max-width: 760px)').matches) setInspector(false)
          perform(e => e.enterShip())
        }} disabled={!view.ready}><Rocket size={16} /><span>Spaceship</span></button>
      </nav>
      <div className="top-actions">
        <span className="live-badge"><span />True scale</span>
        {view.inShip && <button className={`icon-button ${flightPanel ? 'active' : ''}`} aria-label="Toggle flight panel" aria-expanded={flightPanel} title={flightPanel ? 'Hide flight panel' : 'Show flight panel'} onClick={() => setFlightPanel(!flightPanel)}><SlidersHorizontal size={18} /></button>}
        <button className="icon-button" title="Controls and scientific limits" aria-label="Help" onClick={() => setModal('help')}><Info size={19} /></button>
        <button className="icon-button" title="Display settings" aria-label="Settings" onClick={() => setModal('settings')}><Settings2 size={19} /></button>
      </div>
    </header>

    {view.ready && <>
      <aside className="left-rail">
        <button className={`catalog-toggle ${catalog ? 'active' : ''}`} onClick={() => setCatalog(!catalog)} aria-expanded={catalog}><Search size={17} /><span>Find a world</span><kbd>/</kbd></button>
        <div className="map-tools">
          <button onClick={() => perform(e => e.system('inner'))}><Compass size={16} />Inner system</button>
          <button onClick={() => perform(e => e.system('all'))}><Maximize size={16} />Solar system</button>
          <button onClick={() => perform(e => e.system('local'))}><Orbit size={16} />Local system</button>
        </div>
        {catalog && <section className="panel catalog-panel" aria-label="Body catalog">
          <div className="panel-heading"><span>Destination catalog</span><span className="muted">{view.bodies.length} bodies</span></div>
          <label className="search-field"><Search size={16} /><input autoFocus placeholder="Earth, Europa, Sedna..." aria-label="Search bodies" value={query} onChange={e => setQuery(e.target.value)} /><button aria-label="Close catalog" className="icon-button" onClick={() => setCatalog(false)}><X size={16} /></button></label>
          <div className="filters" aria-label="Catalog filters">
            {[['all', 'All'], ['planet', 'Planets'], ['moon', 'Moons'], ['dwarf_planet', 'Dwarfs'], ['small', 'Small bodies']].map(([value, label]) =>
              <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
          </div>
          <div className="body-list">
            {filtered.map(body => <button key={body.id} aria-label={`Select ${body.name}`} className={`body-row ${body.id === view.selectedId ? 'selected' : ''}`} onClick={() => {
              perform(e => e.select(body.id))
              setInspector(!(view.inShip && matchMedia('(max-width: 760px)').matches))
              if (matchMedia('(max-width: 760px)').matches) setCatalog(false)
            }}>
              <span className={`body-glyph ${body.category === 'star' ? 'sun-glyph' : ''}`}><Globe2 size={17} /></span>
              <span><strong>{body.name}</strong><small>{categories[body.category]}{body.parent_id && body.parent_id !== 'sun' ? ` / ${bodyName(body.parent_id, view.bodies)}` : ''}</small></span>
              {body.id === view.selectedId && <Check size={15} />}
            </button>)}
            {!filtered.length && <p className="empty">No bodies match this search.</p>}
          </div>
          <div className="catalog-footer">The complete source catalog. No invented bodies.</div>
        </section>}
      </aside>

      <div className="world-heading">
        <span className="eyebrow">{view.inShip ? `${view.shipMode} / ${view.camera} view` : 'Now observing'}</span>
        <h1>{selected?.name}</h1>
        <div className="world-subtitle"><span>{categories[selected?.category ?? 'planet']}</span><span className="separator">/</span><span>{distance(view.observerDistanceKm)} to center</span></div>
        {view.inShip && ['landing', 'landed', 'takeoff'].includes(view.shipMode) && <small className="terrain-note">{TERRAIN_LABEL}</small>}
      </div>

      <aside className={`inspector panel ${inspector ? '' : 'collapsed'}`}>
        <button className="inspector-heading" aria-expanded={inspector} onClick={() => setInspector(!inspector)}>
          <span><Info size={15} />World details</span><ChevronDown size={17} />
        </button>
        {inspector && selected && <div className="inspector-content">
          <div className="source-chip">{source?.source_status === 'MIXED' ? 'Observed + reconstructed' : source?.source_status === 'OBSERVED' ? 'Observed imagery' : 'Reconstructed appearance'}</div>
          <p className="description">{source?.description ?? selected.physical_notes}</p>
          <dl className="facts">
            <div><dt>Mean radius</dt><dd>{distance(selected.radius_km)}</dd></div>
            <div><dt>Mean diameter</dt><dd>{distance(selected.radius_km * 2)}</dd></div>
            <div><dt>Rotation period</dt><dd>{selected.rotation_period_hours == null ? 'Unconstrained' : `${formatNumber(Math.abs(selected.rotation_period_hours))} h`}</dd></div>
            {selected.rotation_period_hours != null && selected.rotation_period_hours < 0 && <div><dt>Spin direction</dt><dd>Retrograde</dd></div>}
            <div><dt>Parent body</dt><dd>{selected.parent_id ? bodyName(selected.parent_id, view.bodies) : 'Solar system barycenter'}</dd></div>
          </dl>
          <div className="inspector-actions">
            <button className="primary" onClick={() => perform(e => view.inShip ? e.transfer(selected.id) : e.focus(selected.id))}><Crosshair size={16} />{view.inShip ? 'Travel here' : 'Go to body'}</button>
            {!view.inShip && <button onClick={() => perform(e => e.observerMode('follow'))}><Eye size={16} />Follow</button>}
          </div>
          {view.inShip && canLand && <button className="wide" onClick={() => perform(e => e.land(selected.id))}><ArrowDownToLine size={16} />{hoverTarget ? 'Approach and hover' : 'Approach and land'}</button>}
          {!view.inShip && canLand && !hoverTarget && <button className={`wide ${view.pickingSite ? 'active' : ''}`} onClick={() => perform(e => e.pickSite())}><ArrowDownToLine size={16} />{view.pickingSite ? 'Cancel site selection' : 'Pick site and land'}</button>}
          <div className="detail-links"><button onClick={() => setModal('sources')}>Data & credits <ExternalLink size={12} /></button><button title="Bookmark this body and date" aria-label="Bookmark this body" onClick={() => perform(e => e.bookmark())}><BookmarkPlus size={17} /></button></div>
        </div>}
      </aside>

      {!view.inShip && <div className="view-controls panel">
        <span className="eyebrow">Camera</span>
        {(['orbit', 'follow', 'free'] as const).map(mode => <button className={view.observerMode === mode ? 'active' : ''} key={mode} onClick={() => perform(e => e.observerMode(mode))}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}
        <span className="tool-divider" />
        <button className={view.labels ? 'active' : ''} title="Toggle body labels" aria-label="Body labels" onClick={() => perform(e => e.option('labels', !view.labels))}><Layers3 size={16} /></button>
        <button className={view.paths ? 'active' : ''} title="Toggle cached paths" aria-label="Cached paths" onClick={() => perform(e => e.option('paths', !view.paths))}><Orbit size={16} /></button>
      </div>}

      {!view.inShip && <section className="timeline panel" aria-label="Simulation timeline">
        <div className="clock-block"><span className="eyebrow">Simulation time / UTC</span><button className="date-button" title="Choose a date" onClick={() => { setDateInput(view.date.slice(0, 16)); setModal('settings') }}>{currentDate}</button></div>
        <button className="play-button" aria-label={view.playing ? 'Pause simulation' : 'Play simulation'} onClick={() => perform(e => e.togglePlay())}>{view.playing ? <Pause size={19} /> : <Play size={19} />}</button>
        <div className="timeline-track"><input type="range" aria-label="Simulation date" min={view.firstJd} max={view.lastJd} step={1 / 86400} value={view.jd} onChange={e => perform(controller => controller.setTime(Number(e.target.value)))} /><div><span>05 Sep 2026</span><span>05 Sep 2027</span></div></div>
        <label className="rate-select"><span className="eyebrow">Time rate</span><select aria-label="Time acceleration" value={view.timeScale} onChange={e => perform(controller => controller.setTimeScale(Number(e.target.value)))}>{[-86400, -3600, 1, 60, 3600, 86400, 604800].map(value => <option value={value} key={value}>{value.toLocaleString()}x</option>)}</select></label>
      </section>}

      {view.inShip && flightPanel && <section className="flight-deck panel" aria-label="Spacecraft controls">
        <div className="flight-readout"><span className="eyebrow">Speed / {bodyName(view.referenceId, view.bodies)} center</span><strong data-testid="actual-speed">{speed(view.speedC)}</strong><small>{distance(view.speedC * C_KM_S)}/s</small></div>
        <div className="throttle-controls">
          <div className="throttle-title"><label htmlFor="throttle">Commanded speed</label><button className={`warp-toggle ${view.warp ? 'active' : ''}`} aria-pressed={view.warp} onClick={() => perform(e => e.setWarp(!view.warp))}><Shield size={13} />Warp {view.warp ? 'on' : 'off'}</button></div>
          <div className="numeric-throttle"><input id="throttle" aria-label="Commanded speed in c" type="number" min="0" max={view.warp ? 1000 : 0.999999} step="any" value={throttle} onChange={e => setThrottle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') applySpeed() }} /><span>c</span><button onClick={applySpeed}>Set</button></div>
          <input type="range" aria-label="Logarithmic speed" min="-12" max={view.warp ? 3 : -0.000001} step=".01" value={Math.log10(Math.max(1e-12, view.throttleC))} onChange={e => setSpeed(10 ** Number(e.target.value))} />
          <div className="speed-presets">{[['Dock', 0.00000001], ['Cruise', 0.01], ['0.5c', 0.5], ['100c', 100], ['1,000c', 1000]].map(([label, value]) => <button key={label} disabled={Number(value) >= 1 && !view.warp} onClick={() => setSpeed(Number(value))}>{label}</button>)}</div>
        </div>
        <div className="flight-metrics"><div><span>Altitude</span><strong data-testid="altitude">{distance(view.altitudeKm)}</strong></div><div><span>Selected range</span><strong>{distance(view.separationKm)}</strong></div><div><span>Arrival estimate</span><strong>{view.shipMode === 'landed' || view.shipMode === 'hover' ? 'Arrived' : duration(view.etaSeconds)}</strong></div></div>
        <div className="ship-buttons">
          <button className="primary" onClick={() => perform(e => e.transfer(view.selectedId))}><Rocket size={15} />Travel</button>
          <button onClick={() => perform(e => e.setCamera(view.camera === 'cockpit' ? 'chase' : 'cockpit'))}><Eye size={15} />{view.camera === 'cockpit' ? 'Chase view' : 'Cockpit'}</button>
          <button disabled={!canLand} onClick={() => perform(e => view.shipMode === 'landed' || view.shipMode === 'hover' ? e.takeoff() : e.land(view.selectedId))}>{view.shipMode === 'landed' || view.shipMode === 'hover' ? <ArrowUpFromLine size={15} /> : <ArrowDownToLine size={15} />}{view.shipMode === 'landed' || view.shipMode === 'hover' ? 'Take off' : hoverTarget ? 'Hover' : 'Land'}</button>
          <button className="brake-button" onClick={() => { setThrottle('0'); perform(e => e.brake()) }}><Square size={14} />Brake</button>
          <button className="quiet" onClick={() => perform(e => e.cancel())}>Cancel autopilot</button>
          <button className="quiet" onClick={() => perform(e => e.togglePlay())}>{view.playing ? 'Pause flight' : 'Resume flight'}</button>
          <button className="quiet" onClick={() => perform(e => e.resetLook())}>Look forward</button>
        </div>
      </section>}
      {view.inShip && engine.current && <TouchControls input={engine.current.input.state} enabled={!modal && !catalog && !(inspector && matchMedia('(max-width: 760px)').matches)} onBrake={() => perform(e => e.brake())} />}

      <footer className="statusbar"><span><span className="status-dot" />{view.inShip ? 'Exploration flight / simulated controls' : 'ICRF / geometric states / 1 km = 1 km'}</span><span>{view.inShip ? `Clock ${view.playing ? '1x' : 'paused'} / ${currentDate}` : 'JPL Horizons / cached 2026-2027'}<span className="desktop-only"> / {Math.round(view.fps)} fps</span></span></footer>
      <div className="gesture-hint">{view.inShip ? 'W/S thrust / arrows steer / Q/E roll / Space brake' : 'Drag to orbit / scroll or pinch to zoom / tap a label to select'}</div>
    </>}

    {!view.ready && <div className="loading-screen"><div className="loading-orbit"><Orbit size={54} strokeWidth={.8} /></div><span className="eyebrow">Solar atlas</span><h1>Every world.<br />One physical scale.</h1><p>71 bodies. Seven ring systems.<br />A year of source-backed motion.</p><div className="loading-line" /><span className="loading-detail">{view.loading}</span>{error && <button onClick={() => window.location.reload()}>Retry loading</button>}</div>}
    {(error || view.message) && <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><Info size={17} /><span>{error || view.message}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => { setError(''); perform(e => e.clearMessage()) }}><X size={17} /></button></div>}

    {modal === 'settings' && <Modal title="Display and simulation" onClose={() => setModal(null)}>
      <div className="settings-grid">
        <label>Render quality<select value={view.quality} onChange={e => perform(controller => controller.option('quality', e.target.value === 'high' ? 'high' : 'low'))}><option value="high">Full detail</option><option value="low">Mobile / lower memory</option></select><small>Physical dimensions stay identical. Lower quality uses smaller textures.</small></label>
        <label>Exposure compensation <span>{view.exposure} EV</span><input type="range" min="-4" max="6" step=".25" value={view.exposure} onChange={e => perform(controller => controller.option('exposure', Number(e.target.value)))} /></label>
        <label>Field of view <span>{view.fov} degrees</span><input type="range" aria-label="Field of view" min="25" max="100" step="1" value={view.fov} onChange={e => perform(controller => controller.option('fov', Number(e.target.value)))} /></label>
        <label>Interface theme<select defaultValue={document.documentElement.dataset.theme ?? 'dark'} onChange={e => document.documentElement.setAttribute('data-theme', e.target.value)}><option value="dark">Dark</option><option value="light">Light</option></select></label>
        <label className="check-label"><input type="checkbox" checked={view.labels} onChange={e => perform(controller => controller.option('labels', e.target.checked))} />Body labels</label>
        <label className="check-label"><input type="checkbox" checked={view.paths} onChange={e => perform(controller => controller.option('paths', e.target.checked))} />Cached trajectory annotations</label>
      </div>
      <h3>Choose a date</h3><p>Cached coverage is September 5, 2026 through September 5, 2027. Date changes are available in Explore mode.</p>
      <div className="date-entry"><input type="datetime-local" aria-label="UTC date" value={dateInput || view.date.slice(0, 16)} onChange={e => setDateInput(e.target.value)} disabled={view.inShip} /><button disabled={view.inShip} onClick={() => perform(e => e.setUtc(`${dateInput || view.date.slice(0, 16)}:00Z`))}>Set UTC date</button></div>
      <h3>Saved viewpoints</h3>
      {view.bookmarks.length ? view.bookmarks.map((bookmark, i) => <div className="bookmark-row" key={`${bookmark.bodyId}-${bookmark.jd}`}><button onClick={() => { perform(e => e.openBookmark(i)); setModal(null) }}><BookmarkPlus size={16} />{bookmark.name}</button><button className="icon-button" aria-label={`Remove ${bookmark.name}`} onClick={() => perform(e => e.removeBookmark(i))}><X size={16} /></button></div>) : <p>No saved viewpoints. Use the bookmark button in World details.</p>}
    </Modal>}
    {modal === 'help' && <Modal title="Make yourself at home in space" onClose={() => setModal(null)}>
      <h3>Explore</h3><p>Drag to orbit a body. Scroll or pinch to zoom. Search the catalog to find all 71 bodies, including those too small to see at their real size. Go to body is an instant camera move, not a simulated journey.</p>
      <h3>Fly</h3><p>Enter Spaceship for cockpit or chase view. Set a speed in c and choose Travel for an assisted transfer. Warp must be enabled before speeds reach or exceed light speed. Brake stops relative motion; Cancel autopilot returns steering to you.</p>
      <div className="key-grid"><span><kbd>W</kbd><kbd>S</kbd>Thrust</span><span><kbd>Arrows</kbd>Steer</span><span><kbd>Q</kbd><kbd>E</kbd>Roll</span><span><kbd>R</kbd><kbd>F</kbd>Vertical thrust</span><span><kbd>Space</kbd>Brake</span><span><kbd>A</kbd><kbd>D</kbd>Yaw</span></div>
      <p>On touch screens, use the steering and look pads, the vertical/roll buttons, and the speed controls. Menus do not pass input through to the ship.</p>
      <h3>Land and take off</h3><p>Select a solid body and choose Land for an assisted approach. In Explore mode, Pick site and land lets you tap a visible part of the source mesh and launch an assisted descent there. Close to a body, the safety controller limits speed. Gas and ice giants allow simulated hovering, not surface landing. The Sun cannot be landed on.</p><p>Ground detail is reconstructed. Original planet dimensions, source meshes, and data remain separate. No terrain here is suitable for real navigation.</p>
      <h3>What the clock means</h3><p>c means 299,792.458 km/s per simulated second. Flight defaults to 1x time. Pausing stops the ship and bodies but leaves free-look available. Leave flight before scrubbing time or reversing playback.</p><p>Speed is relative to the reference body's center, not its rotating ground. A landed ship can show nonzero speed because the planet carries it through its rotation.</p>
      <h3>What the images mean</h3><p>Some maps combine observations with reconstructed coverage. Weather maps are static composites, not forecasts. Unknown poles and phases remain unconstrained. Trajectory lines show the cached year, not invented complete orbits.</p><button className="wide" onClick={() => setModal('sources')}>Read source information <ExternalLink size={15} /></button>
    </Modal>}
    {modal === 'sources' && <Modal title="Scientific data and credits" onClose={() => setModal(null)}>
      <div className="source-summary"><Globe2 size={28} /><div><strong>71 bodies. Original physical dimensions.</strong><p>NASA/JPL Horizons geometric ICRF vectors, source orientations, image records, and ring measurements travel with this app.</p></div></div>
      <h3>{selected?.name}</h3><p>{selected?.physical_notes}</p>
      {selected?.radii_km && <p>Adopted semiaxes in kilometers: {selected.radii_km.map(formatNumber).join(', ')}.</p>}
      <p>{source?.description}</p>
      {Object.entries(source?.maps ?? {}).map(([role, map]) => <article className="credit" key={role}><h4>{role}</h4><p>{map.credit}</p><p>{map.usage}</p><p className="muted">{map.notes}</p>{map.source_url?.startsWith('https://') && <a href={map.source_url} target="_blank" rel="noreferrer">Image source <ExternalLink size={13} /></a>}</article>)}
      <h3>Preserved records</h3><div className="download-links"><a href={`${base}data/catalog.json`} target="_blank" rel="noreferrer">Complete body catalog <ExternalLink size={14} /></a><a href={`${base}data/asset_manifest.json`} target="_blank" rel="noreferrer">All image credits and usage terms <ExternalLink size={14} /></a><a href={`${base}data/orientations.json`} target="_blank" rel="noreferrer">Orientation models and limits <ExternalLink size={14} /></a><a href={`${base}assets/manifest.json`} target="_blank" rel="noreferrer">Ring dimensions and render metadata <ExternalLink size={14} /></a></div>
      <h3>Limits that matter</h3><p>States cover one cached year. Phobos uses a finer 15-minute track; most other bodies use hourly samples. Interpolation, approximate orientations, and renderer precision introduce error. UTC labels assume the pinned leap-second table. Neither the original Blender scene nor this app is navigation-grade.</p><p>Spacecraft behavior, the cockpit, and added ground detail are original exploration features. Faster-than-light travel is fictional. The application makes no live ephemeris requests.</p>
    </Modal>}
  </main>
}

export default App
