import { useEffect, useRef, useState } from 'react'
import { Rocket, X } from 'lucide-react'
import { SHIPS, shipDesign } from '../cockpit/ships'
import { shipPreviews } from '../cockpit/preview'
import { useOutsidePress } from './hooks'
import { SHIP_GROUPS, meters, shipOrigin, shipSize } from './shipText'

interface HangarProps {
  selectedId: string
  onSelect: (id: string) => void
  onClose: () => void
}

/** Ship picker that opens beside the flight panel. Picking a ship applies it at once and leaves the hangar open. */
export function Hangar({ selectedId, onSelect, onClose }: HangarProps) {
  const root = useRef<HTMLElement>(null)
  const [images, setImages] = useState<Record<string, string>>({})
  const [previewsDone, setPreviewsDone] = useState(false)
  const selected = shipDesign(selectedId)

  useEffect(() => {
    let live = true
    shipPreviews(SHIPS, (id, url) => { if (live) setImages(current => current[id] ? current : { ...current, [id]: url }) })
      .catch(() => undefined)
      .finally(() => { if (live) setPreviewsDone(true) })
    return () => { live = false }
  }, [])

  useOutsidePress(root, true, onClose, '[data-hangar-trigger]')

  useEffect(() => {
    const element = root.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    element?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus({ preventScroll: true })
    element?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' })
    return () => {
      const focus = document.activeElement
      if (opener?.isConnected && (!focus || focus === document.body || element?.contains(focus))) opener.focus({ preventScroll: true })
    }
  }, [])

  return <section ref={root} className="hangar panel" role="group" aria-label="Choose a ship">
    <header className="hangar-header">
      <div><h2>Hangar</h2><p>Flying the {selected.name}</p></div>
      <button className="icon-button ghost" aria-label="Close hangar" title="Close (Esc)" onClick={onClose}><X size={18} /></button>
    </header>
    <div className="hangar-body">
      {SHIP_GROUPS.map(([title, ships]) => <section key={title} className="hangar-group" aria-label={title}>
        <h3 className="menu-label">{title}</h3>
        <div className="hangar-grid">
          {ships.map(ship => <button key={ship.id} className={`ship-card ${ship.id === selectedId ? 'active' : ''}`}
            aria-pressed={ship.id === selectedId} data-ship-id={ship.id} title={ship.blurb} onClick={() => onSelect(ship.id)}>
            <span className="ship-thumb" aria-hidden="true">
              {images[ship.id] ? <img src={images[ship.id]} alt="" draggable={false} />
                : previewsDone ? <Rocket size={28} strokeWidth={1.2} /> : <span className="thumb-loading" />}
            </span>
            <span className="ship-card-name">{ship.name}</span>
            <span className="ship-card-meta">{shipOrigin(ship)}</span>
          </button>)}
        </div>
      </section>)}
    </div>
    <footer className="hangar-detail" aria-live="polite">
      <div className="hangar-detail-title"><strong>{selected.name}</strong>
        {selected.kind === 'nasa' && <span className="ship-tag">{shipOrigin(selected)}</span>}</div>
      <p>{selected.blurb}</p>
      <p className="hangar-facts">Size {shipSize(selected)}. Landed, the pilot's eye sits {meters(selected.eyeHeightM)} above the ground.</p>
      {selected.kind === 'nasa' && <p className="hangar-note">
        Exterior from the NASA 3D Resources model "{selected.source}". The cockpit is built for this app. NASA does not endorse this app.
      </p>}
    </footer>
  </section>
}
