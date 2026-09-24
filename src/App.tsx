import { useEffect, useRef, useState } from 'react'
import { CircleHelp, Eye, Info, Orbit, Rocket, Settings, Telescope, X } from 'lucide-react'
import { Explorer } from './navigation/Explorer'
import { initialState } from './navigation/state'
import type { ViewState } from './navigation/state'
import { TouchControls } from './input/TouchControls'
import { BodyCard } from './ui/BodyCard'
import type { Appearance } from './ui/BodyCard'
import { Catalog } from './ui/Catalog'
import { Dock } from './ui/Dock'
import type { DockMenu } from './ui/Dock'
import { FlightPanel } from './ui/FlightPanel'
import { HelpDialog, SettingsDialog, SourcesDialog } from './ui/Dialogs'
import { useLatest, useMediaQuery, useShortcuts, useStoredFlag } from './ui/hooks'

type OptionKey = 'labels' | 'paths' | 'quality' | 'exposure' | 'fov'
const base = import.meta.env.BASE_URL
const COMPACT = '(max-width: 760px), (max-height: 540px) and (orientation: landscape)'
const detectTouch = () => navigator.maxTouchPoints > 0 || matchMedia('(any-pointer: coarse), (hover: none)').matches
const flightKeys = new Set(['KeyW', 'KeyS', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'])
const gasGiants = ['jupiter', 'saturn', 'uranus', 'neptune']

function App() {
  const viewport = useRef<HTMLDivElement>(null)
  const engine = useRef<Explorer | null>(null)
  const phone = useMediaQuery(COMPACT)
  const [hasTouch] = useState(detectTouch)
  const [view, setView] = useState<ViewState>(initialState)
  const [catalog, setCatalog] = useState(false)
  const [details, setDetails] = useState(() => !matchMedia(COMPACT).matches)
  const [flightExpanded, setFlightExpanded] = useState(() => !matchMedia(COMPACT).matches)
  const [modal, setModal] = useState<'settings' | 'help' | 'sources' | null>(null)
  const [menu, setMenu] = useState<DockMenu>(null)
  const [hidden, setHidden] = useState(false)
  const [appearance, setAppearance] = useState<Record<string, Appearance>>({})
  const [error, setError] = useState('')
  const [throttle, setThrottle] = useState('0.01')
  const [exploreHintSeen, dismissExploreHint] = useStoredFlag('solar-atlas-explore-hint')
  const [flightHintSeen, dismissFlightHint] = useStoredFlag('solar-atlas-flight-hint')
  const inShip = useLatest(view.inShip)

  useEffect(() => {
    if (!view.message) return
    const timer = window.setTimeout(() => engine.current?.clearMessage(), 8000)
    return () => window.clearTimeout(timer)
  }, [view.message])

  useEffect(() => {
    if (document.activeElement?.id !== 'throttle') setThrottle(String(view.throttleC))
  }, [view.throttleC])

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

  // Capture phase, because the touch pad stops propagation of its own pointer events.
  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.universe, .flight-touch')) return
      if (inShip.current) dismissFlightHint()
      else dismissExploreHint()
    }
    const wheel = (event: WheelEvent) => {
      if (!inShip.current && event.target instanceof Element && event.target.closest('.universe')) dismissExploreHint()
    }
    const key = (event: KeyboardEvent) => { if (inShip.current && flightKeys.has(event.code)) dismissFlightHint() }
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('wheel', wheel, { capture: true, passive: true })
    window.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', pointer, true)
      document.removeEventListener('wheel', wheel, true)
      window.removeEventListener('keydown', key)
    }
  }, [inShip, dismissExploreHint, dismissFlightHint])

  const perform = (action: (controller: Explorer) => void | Promise<void>) => {
    if (!engine.current) return
    try {
      const result = action(engine.current)
      if (result instanceof Promise) result.catch(e => setError(e instanceof Error ? e.message : String(e)))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const option = <K extends OptionKey>(key: K, value: ViewState[K]) => perform(controller => controller.option(key, value))
  const selected = view.bodies.find(body => body.id === view.selectedId)
  const source = appearance[view.selectedId]
  const currentDate = view.date ? view.date.slice(0, 19).replace('T', ' ') : '2026-09-05 00:00:00'
  const canLand = Boolean(selected && selected.id !== 'sun')
  const hoverTarget = gasGiants.includes(view.selectedId)
  const grounded = view.shipMode === 'landed' || view.shipMode === 'hover'

  const setSpeed = (c: number) => { setThrottle(String(c)); perform(e => e.setThrottle(c)) }
  const applySpeed = () => {
    if (!throttle.trim()) { setError('Enter a speed in c before applying the throttle.'); return }
    setSpeed(Number(throttle))
  }
  const togglePlay = () => perform(e => e.togglePlay())
  const toggleCamera = () => perform(e => e.setCamera(view.camera === 'cockpit' ? 'chase' : 'cockpit'))
  const enterShip = () => {
    if (phone) setDetails(false)
    setFlightExpanded(!phone)
    setMenu(null)
    perform(e => e.enterShip())
  }
  const selectBody = (id: string) => {
    perform(e => e.select(id))
    if (phone) { setCatalog(false); setDetails(false) }
  }
  const openCatalog = () => { setHidden(false); setMenu(null); setCatalog(true) }

  useShortcuts(view.ready ? {
    '/': openCatalog,
    '?': () => setModal('help'),
    h: () => setHidden(value => !value),
    l: () => option('labels', !view.labels),
    t: () => option('paths', !view.paths),
    p: togglePlay,
    ' ': view.inShip ? undefined : togglePlay,
    '1': view.inShip ? undefined : () => perform(e => e.observerMode('orbit')),
    '2': view.inShip ? undefined : () => perform(e => e.observerMode('follow')),
    '3': view.inShip ? undefined : () => perform(e => e.observerMode('free')),
    c: view.inShip ? toggleCamera : undefined,
    Escape: () => {
      if (menu) setMenu(null)
      else if (catalog) setCatalog(false)
      else if (hidden) setHidden(false)
      else if (phone && details) setDetails(false)
    },
  } : {})

  const hint = view.inShip
    ? flightHintSeen ? '' : hasTouch ? 'Hold the Steer and Look pads to fly. Expand the panel for speed.' : 'W/S thrust · arrows steer · Q/E roll · Space brake · C camera'
    : view.observerMode === 'free' && !hasTouch ? 'W/S forward and back · A/D sideways · R/F up and down'
      : exploreHintSeen ? '' : hasTouch ? 'Drag to orbit · pinch to zoom · tap a label to select' : 'Drag to orbit · scroll to zoom · click a label to select'
  const touchEnabled = !modal && !catalog && !hidden && !(phone && (details || flightExpanded))

  return <main className={`atlas ${view.inShip ? 'is-flying' : ''} ${hidden ? 'ui-hidden' : ''} ${hasTouch ? 'has-touch' : ''}`}>
    <div ref={viewport} className="universe" aria-label="Interactive solar system viewport" tabIndex={0} />

    <header className="topbar">
      <div className="topbar-start">
        <div className="brand"><Orbit size={22} strokeWidth={1.4} aria-hidden="true" /><span className="brand-name">Solar atlas</span></div>
        {view.ready && <Catalog open={catalog} bodies={view.bodies} selectedId={view.selectedId} bookmarks={view.bookmarks}
          onOpen={openCatalog} onClose={() => setCatalog(false)} onSelect={selectBody}
          onOpenBookmark={index => { perform(e => e.openBookmark(index)); setCatalog(false) }}
          onRemoveBookmark={index => perform(e => e.removeBookmark(index))} />}
      </div>
      <nav className="mode-switch" aria-label="Experience">
        <button className={!view.inShip ? 'active' : ''} aria-pressed={!view.inShip} onClick={() => perform(e => e.exitShip())} disabled={!view.ready}><Telescope size={16} /><span>Explore</span></button>
        <button className={view.inShip ? 'active' : ''} aria-pressed={view.inShip} onClick={enterShip} disabled={!view.ready}><Rocket size={16} /><span>Spaceship</span></button>
      </nav>
      <div className="top-actions">
        <button className="icon-button" title="Controls and help (?)" aria-label="Help" aria-keyshortcuts="?" onClick={() => setModal('help')}><CircleHelp size={19} /></button>
        <button className="icon-button" title="Settings" aria-label="Settings" onClick={() => setModal('settings')}><Settings size={19} /></button>
      </div>
    </header>

    {view.ready && <>
      {selected && <BodyCard body={selected} bodies={view.bodies} source={source} distanceKm={view.observerDistanceKm} inShip={view.inShip}
        expanded={details} pickingSite={view.pickingSite} canPickSite={canLand && !hoverTarget}
        onToggle={() => setDetails(value => !value)}
        onGo={() => { perform(e => e.focus(selected.id)); if (phone) setDetails(false) }}
        onPickSite={() => { perform(e => e.pickSite()); if (phone) setDetails(false) }}
        onBookmark={() => perform(e => e.bookmark())} onSources={() => setModal('sources')} />}

      {!view.inShip && <Dock view={view} date={currentDate} menu={menu} onMenu={setMenu} onTogglePlay={togglePlay}
        onScrub={jd => perform(e => e.setTime(jd))} onSetUtc={iso => perform(e => e.setUtc(iso))}
        onRate={value => perform(e => e.setTimeScale(value))} onCamera={mode => perform(e => e.observerMode(mode))}
        onFrame={frame => perform(e => e.system(frame))} onOption={option} onHide={() => setHidden(true)} />}

      {view.inShip && <FlightPanel view={view} bodies={view.bodies} expanded={flightExpanded} throttle={throttle} canLand={canLand} hoverTarget={hoverTarget}
        onToggle={() => setFlightExpanded(value => !value)} onThrottleInput={setThrottle} onApplySpeed={applySpeed} onSpeed={setSpeed}
        onWarp={() => perform(e => e.setWarp(!view.warp))} onTravel={() => perform(e => e.transfer(view.selectedId))}
        onLandOrTakeoff={() => perform(e => grounded ? e.takeoff() : e.land(view.selectedId))}
        onBrake={() => { setThrottle('0'); perform(e => e.brake()) }} onCamera={toggleCamera}
        onLookForward={() => perform(e => e.resetLook())} onTogglePlay={togglePlay} onCancel={() => perform(e => e.cancel())}
        onHide={() => setHidden(true)} />}
      {view.inShip && engine.current && <TouchControls input={engine.current.input.state} enabled={touchEnabled} onBrake={() => perform(e => e.brake())} />}

      {hint && !catalog && !menu && !(phone && (details || (view.inShip && flightExpanded))) && <div className="hint" role="note">{hint}</div>}
      {hidden && <button className="show-ui" onClick={() => setHidden(false)} aria-keyshortcuts="H"><Eye size={16} />Show interface<kbd>H</kbd></button>}
    </>}

    {!view.ready && <div className="loading-screen"><div className="loading-orbit"><Orbit size={54} strokeWidth={.8} /></div><span className="eyebrow">Solar atlas</span><h1>Every world.<br />One physical scale.</h1><p>71 bodies. Seven ring systems.<br />A year of source-backed motion.</p><div className="loading-line" /><span className="loading-detail">{view.loading}</span>{error && <button onClick={() => window.location.reload()}>Retry loading</button>}</div>}
    {(error || view.message) && <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}><Info size={17} /><span>{error || view.message}</span><button className="icon-button ghost" aria-label="Dismiss message" onClick={() => { setError(''); perform(e => e.clearMessage()) }}><X size={17} /></button></div>}

    {modal === 'settings' && <SettingsDialog view={view} onClose={() => setModal(null)} onOption={option} />}
    {modal === 'help' && <HelpDialog onClose={() => setModal(null)} onSources={() => setModal('sources')} />}
    {modal === 'sources' && <SourcesDialog body={selected} source={source} onClose={() => setModal(null)} />}
  </main>
}

export default App
