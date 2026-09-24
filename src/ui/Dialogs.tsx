import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { ExternalLink, Globe2, X } from 'lucide-react'
import type { Body } from '../contracts'
import type { ViewState } from '../navigation/state'
import type { Appearance } from './BodyCard'
import { formatNumber } from './format'

const base = import.meta.env.BASE_URL

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return <dialog ref={dialog} onCancel={onClose} className="modal" aria-label={title}>
    <header><h2>{title}</h2><button className="icon-button ghost" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></header>
    <div className="modal-content">{children}</div>
  </dialog>
}

interface SettingsProps {
  view: ViewState
  onClose: () => void
  onOption: <K extends 'quality' | 'exposure' | 'fov' | 'labels' | 'paths'>(key: K, value: ViewState[K]) => void
}

export function SettingsDialog({ view, onClose, onOption }: SettingsProps) {
  return <Modal title="Settings" onClose={onClose}>
    <div className="settings-grid">
      <label>Render quality
        <select value={view.quality} onChange={event => onOption('quality', event.target.value === 'high' ? 'high' : 'low')}>
          <option value="high">Full detail</option><option value="low">Mobile / lower memory</option>
        </select>
        <small>Running at {Math.round(view.fps)} fps. Physical dimensions stay identical. Lower quality uses smaller textures.</small>
      </label>
      <label>Exposure compensation <span className="setting-value">{view.exposure} EV</span>
        <input type="range" min="-4" max="6" step=".25" value={view.exposure} onChange={event => onOption('exposure', Number(event.target.value))} />
      </label>
      <label>Field of view <span className="setting-value">{view.fov} degrees</span>
        <input type="range" aria-label="Field of view" min="25" max="100" step="1" value={view.fov} onChange={event => onOption('fov', Number(event.target.value))} />
      </label>
      <label>Interface theme
        <select defaultValue={document.documentElement.dataset.theme ?? 'dark'} onChange={event => document.documentElement.setAttribute('data-theme', event.target.value)}>
          <option value="dark">Dark</option><option value="light">Light</option>
        </select>
      </label>
      <label className="check-label"><input type="checkbox" checked={view.labels} onChange={event => onOption('labels', event.target.checked)} />Body labels <kbd>L</kbd></label>
      <label className="check-label"><input type="checkbox" checked={view.paths} onChange={event => onOption('paths', event.target.checked)} />Cached trajectory annotations <kbd>T</kbd></label>
    </div>
  </Modal>
}

const shortcutGroups: [string, [string[], string][]][] = [
  ['Anywhere', [[['/'], 'Search worlds'], [['?'], 'Open this help'], [['H'], 'Hide or show interface'], [['L'], 'Body labels'], [['T'], 'Trajectories'], [['Esc'], 'Close menus and panels']]],
  ['Explore', [[['Drag'], 'Orbit the body'], [['Scroll'], 'Zoom, or pinch on touch'], [['Space', 'P'], 'Play or pause time'], [['1', '2', '3'], 'Orbit, Follow, Free camera'], [['W', 'S'], 'Free camera forward and back'], [['A', 'D'], 'Free camera sideways'], [['R', 'F'], 'Free camera up and down']]],
  ['Spaceship', [[['W', 'S'], 'Forward and reverse thrust'], [['Arrows'], 'Pitch and yaw'], [['A', 'D'], 'Yaw'], [['Q', 'E'], 'Roll'], [['R', 'F'], 'Vertical thrust'], [['Space'], 'Brake'], [['P'], 'Pause or resume flight'], [['C'], 'Cockpit or chase view'], [['Drag'], 'Look around from the cockpit']]],
]

export function HelpDialog({ onClose, onSources }: { onClose: () => void; onSources: () => void }) {
  return <Modal title="Controls and help" onClose={onClose}>
    <h3>Controls</h3>
    <div className="shortcut-groups">
      {shortcutGroups.map(([group, rows]) => <section key={group}>
        <h4>{group}</h4>
        <dl className="shortcut-list">{rows.map(([keys, action]) => <div key={action}>
          <dt>{keys.map(key => <kbd key={key}>{key}</kbd>)}</dt><dd>{action}</dd>
        </div>)}</dl>
      </section>)}
    </div>
    <p>On touch screens, hold the Steer or Look pad and drag. Release to center it. The roll, thrust, and vertical buttons act while held. Expand the flight panel for speed and camera controls. Menus do not pass input through to the ship.</p>
    <h3>Explore</h3><p>Drag to orbit a body. Scroll or pinch to zoom. Search the catalog to find all 71 bodies, including those too small to see at their real size. Go to body is an instant camera move, not a simulated journey. The View menu frames the local, inner, or whole solar system and shows or hides labels and trajectories.</p>
    <h3>Fly</h3><p>Enter Spaceship for cockpit or chase view. Set a speed in c and choose Travel for an assisted transfer. Warp must be enabled before speeds reach or exceed light speed. Brake stops relative motion; Cancel autopilot returns steering to you.</p>
    <h3>Land and take off</h3><p>Select a solid body and choose Land for an assisted approach. In Explore mode, Pick site and land lets you tap a visible part of the source mesh and launch an assisted descent there. Close to a body, the safety controller limits speed. Gas and ice giants allow simulated hovering, not surface landing. The Sun cannot be landed on.</p><p>Ground detail is reconstructed. Original planet dimensions, source meshes, and data remain separate. No terrain here is suitable for real navigation.</p>
    <h3>What the clock means</h3><p>c means 299,792.458 km/s per simulated second. Flight defaults to 1x time. Pausing stops the ship and bodies but leaves free-look available. Leave flight before scrubbing time or reversing playback.</p><p>Speed is relative to the reference body's center, not its rotating ground. A landed ship can show nonzero speed because the planet carries it through its rotation.</p>
    <h3>What the images mean</h3><p>Some maps combine observations with reconstructed coverage. Weather maps are static composites, not forecasts. Unknown poles and phases remain unconstrained. Trajectory lines show the cached year, not invented complete orbits.</p>
    <h3>About the data</h3><p>Every body sits at true scale: 1 km in the scene is 1 km in the source records. Positions are ICRF geometric states from JPL Horizons, cached from 5 September 2026 to 5 September 2027. The catalog lists every source body and adds no invented ones.</p>
    <button className="wide" onClick={onSources}>Read source information <ExternalLink size={15} /></button>
  </Modal>
}

export function SourcesDialog({ body, source, onClose }: { body?: Body; source?: Appearance; onClose: () => void }) {
  return <Modal title="Scientific data and credits" onClose={onClose}>
    <div className="source-summary"><Globe2 size={28} /><div><strong>71 bodies. Original physical dimensions.</strong>
      <p>NASA/JPL Horizons geometric ICRF vectors, source orientations, image records, and ring measurements travel with this app. States are cached from 5 September 2026 to 5 September 2027, and 1 km in the scene is 1 km in the source.</p></div></div>
    <h3>{body?.name}</h3><p>{body?.physical_notes}</p>
    {body?.radii_km && <p>Adopted semiaxes in kilometers: {body.radii_km.map(formatNumber).join(', ')}.</p>}
    <p>{source?.description}</p>
    {Object.entries(source?.maps ?? {}).map(([role, map]) => <article className="credit" key={role}><h4>{role}</h4><p>{map.credit}</p><p>{map.usage}</p><p className="muted">{map.notes}</p>
      {map.source_url?.startsWith('https://') && <a href={map.source_url} target="_blank" rel="noreferrer">Image source <ExternalLink size={13} /></a>}</article>)}
    <h3>Preserved records</h3><div className="download-links">
      <a href={`${base}data/catalog.json`} target="_blank" rel="noreferrer">Complete body catalog <ExternalLink size={14} /></a>
      <a href={`${base}data/asset_manifest.json`} target="_blank" rel="noreferrer">All image credits and usage terms <ExternalLink size={14} /></a>
      <a href={`${base}data/orientations.json`} target="_blank" rel="noreferrer">Orientation models and limits <ExternalLink size={14} /></a>
      <a href={`${base}assets/manifest.json`} target="_blank" rel="noreferrer">Ring dimensions and render metadata <ExternalLink size={14} /></a>
    </div>
    <h3>Limits that matter</h3><p>States cover one cached year. Phobos uses a finer 15-minute track; most other bodies use hourly samples. Interpolation, approximate orientations, and renderer precision introduce error. UTC labels assume the pinned leap-second table. Neither the original Blender scene nor this app is navigation-grade.</p><p>Spacecraft behavior, the cockpit, and added ground detail are original exploration features. Faster-than-light travel is fictional. The application makes no live ephemeris requests.</p>
  </Modal>
}
