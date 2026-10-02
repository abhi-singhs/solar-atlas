import { useRef, useState } from 'react'
import { Check, Copy, Play, Share2 } from 'lucide-react'
import { shipDesign } from '../cockpit/ships'
import type { Body } from '../contracts'
import { landLabel } from '../flight/route'
import { buildShareLink } from '../navigation/share'
import type { SharedJourney } from '../navigation/share'
import { Modal } from './Dialogs'
import { rateLabel } from './format'

const cameraLabel = { orbit: 'orbit camera', follow: 'follow camera', free: 'free camera' } as const

/** What a journey shows when it opens. The share dialog and the Begin journey screen both use it. */
function JourneySummary({ journey, bodies }: { journey: SharedJourney; bodies: Body[] }) {
  const find = (id: string | undefined) => bodies.find(body => body.id === id)
  const name = (id: string | undefined) => find(id)?.name ?? id ?? 'Earth'
  const when = journey.utc ? `${journey.utc.slice(0, 16).replace('T', ' ')} UTC` : ''
  const { settings } = journey
  const music = <div><dt>Music</dt><dd>{settings.music ? `On, ${Math.round((settings.musicVolume ?? 0.7) * 100)}% volume` : 'Off'}</dd></div>
  if (journey.mode === 'explore') {
    const rate = rateLabel(journey.timeScale ?? 1)
    return <dl className="journey-summary">
      <div><dt>View</dt><dd>{name(journey.bodyId)}, {cameraLabel[journey.observerMode ?? 'orbit']}</dd></div>
      <div><dt>Date</dt><dd>{when}, {journey.playing ? `playing at ${rate.toLowerCase()}` : 'paused'}</dd></div>
      {music}
    </dl>
  }
  return <dl className="journey-summary">
    <div><dt>Start</dt><dd>{name(journey.bodyId)}, {when}</dd></div>
    {journey.route?.length ? <div><dt>Route</dt><dd><ol>{journey.route.map(stop => {
      const body = find(stop.bodyId)
      return <li key={stop.bodyId}>{name(stop.bodyId)}<small>{stop.action === 'land' && body ? landLabel(body) : 'Park nearby'}</small></li>
    })}</ol></dd></div> : null}
    <div><dt>Ship</dt><dd>{shipDesign(settings.shipModel).name}, {journey.camera === 'chase' ? 'chase view' : 'cockpit'}{journey.warp ? ', Warp on' : ''}</dd></div>
    {music}
  </dl>
}

interface ShareDialogProps {
  journey: SharedJourney
  bodies: Body[]
  onClose: () => void
}

export function ShareDialog({ journey, bodies, onClose }: ShareDialogProps) {
  const [hideUi, setHideUi] = useState(false)
  const [music, setMusic] = useState(journey.settings.music ?? false)
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle')
  const field = useRef<HTMLInputElement>(null)
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  const shared: SharedJourney = { ...journey, settings: { ...journey.settings, music }, theme, uiHidden: hideUi }
  const link = buildShareLink(window.location.href, shared)
  const canShare = typeof navigator.share === 'function'
  const route = journey.mode === 'ship' && journey.route?.length

  const manual = () => {
    field.current?.focus()
    field.current?.select()
    setStatus('manual')
  }
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(link)
      setStatus('copied')
    } catch {
      manual()
    }
  }
  const share = async () => {
    try {
      await navigator.share({ title: 'Solar atlas journey', url: link })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) manual()
    }
  }

  return <Modal title="Share this journey" onClose={onClose}>
    <p className="share-lead">{route
      ? 'The link opens on a Begin journey screen, and one click starts the route.'
      : journey.mode === 'ship' ? 'The link opens in Spaceship mode at the start body.' : 'The link opens this view at the same date.'}</p>
    <JourneySummary journey={shared} bodies={bodies} />
    <div className="settings-grid share-options">
      <label className="check-label"><input type="checkbox" checked={hideUi}
        onChange={event => { setHideUi(event.target.checked); setStatus('idle') }} />Open with the interface hidden</label>
      <div className="check-setting">
        <label className="check-label"><input type="checkbox" checked={music} aria-describedby="share-music-note"
          onChange={event => { setMusic(event.target.checked); setStatus('idle') }} />Space music</label>
        <small id="share-music-note">Browsers start sound only after a click, so music begins with Begin journey or the first click.</small>
      </div>
    </div>
    <label className="share-link">Link
      <input ref={field} readOnly value={link} aria-label="Share link" onFocus={event => event.currentTarget.select()} />
    </label>
    <div className="share-actions">
      <button className="primary" data-autofocus onClick={copy}>{status === 'copied' ? <Check size={15} /> : <Copy size={15} />}
        {status === 'copied' ? 'Copied' : 'Copy link'}</button>
      {canShare && <button onClick={share}><Share2 size={15} />Share</button>}
    </div>
    <p className="share-status" role="status">{status === 'copied' ? 'Link copied.'
      : status === 'manual' ? 'This browser blocked copying. The link is selected, so press Ctrl+C or Cmd+C.' : ''}</p>
    <p className="share-note">The link also carries the ship, labels, trajectories, exposure, field of view, lens flare, star glare, and theme. It leaves out render quality, background pause, and saved viewpoints, which belong to each device. Settings from a link last for that visit and never replace the recipient's own.</p>
  </Modal>
}

interface BeginJourneyProps {
  journey: SharedJourney
  bodies: Body[]
  onBegin: () => void
  onClose: () => void
}

/** Shown when a shared route opens. The Begin click also counts as the gesture browsers need before they play sound. */
export function BeginJourneyDialog({ journey, bodies, onBegin, onClose }: BeginJourneyProps) {
  return <Modal title="Shared journey" onClose={onClose}>
    <p className="share-lead">Someone shared a route with you. Begin journey starts it{journey.settings.music ? ' with music on' : ''}.</p>
    <JourneySummary journey={journey} bodies={bodies} />
    <div className="share-actions">
      <button className="primary" data-autofocus onClick={onBegin}><Play size={15} />Begin journey</button>
      <button onClick={onClose}>Look around first</button>
    </div>
  </Modal>
}
