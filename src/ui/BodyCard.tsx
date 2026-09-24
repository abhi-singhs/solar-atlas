import { ArrowDownToLine, BookmarkPlus, Check, ChevronDown, Crosshair, ExternalLink, Plus } from 'lucide-react'
import type { Body } from '../contracts'
import { categories, distance, formatNumber } from './format'

export type Appearance = { source_status?: string; description?: string; maps?: Record<string, MapRecord> }
export type MapRecord = { credit?: string; usage?: string; source_url?: string; notes?: string }

interface BodyCardProps {
  body: Body
  bodies: Body[]
  source?: Appearance
  distanceKm: number
  inShip: boolean
  expanded: boolean
  pickingSite: boolean
  canPickSite: boolean
  inRoute: boolean
  onToggle: () => void
  onRoute: () => void
  onGo: () => void
  onPickSite: () => void
  onBookmark: () => void
  onSources: () => void
}

const sourceLabel = (status?: string) =>
  status === 'MIXED' ? 'Observed + reconstructed' : status === 'OBSERVED' ? 'Observed imagery' : 'Reconstructed appearance'

export function BodyCard(props: BodyCardProps) {
  const { body, bodies, source, distanceKm, inShip, expanded, pickingSite, canPickSite } = props
  const name = (id: string) => bodies.find(item => item.id === id)?.name ?? id
  const kind = body.category === 'moon' && body.parent_id ? `Moon of ${name(body.parent_id)}` : categories[body.category]
  const rotation = body.rotation_period_hours
  return <aside className={`body-card panel ${expanded ? 'expanded' : ''}`} aria-label={inShip ? 'Flight target' : 'Selected body'}>
    <div className="body-card-header world-heading">
      <h1>{body.name}</h1>
      <p className="world-subtitle"><span>{kind}</span><span>{distance(distanceKm)} to center</span></p>
      <button className="body-card-toggle icon-button ghost" aria-expanded={expanded} aria-controls="body-details"
        aria-label={expanded ? 'Hide body details' : 'Show body details'} title={expanded ? 'Hide details' : 'Show details'} onClick={props.onToggle}>
        <ChevronDown size={18} />
      </button>
    </div>
    <div className="body-card-body">
      {inShip && <div className="body-actions">
        <button className={props.inRoute ? 'active' : ''} aria-pressed={props.inRoute} onClick={props.onRoute} aria-keyshortcuts="+"
          title={props.inRoute ? 'Remove this body from your route' : 'Add this body to your route (+)'}>
          {props.inRoute ? <Check size={16} /> : <Plus size={16} />}{props.inRoute ? 'In route' : 'Add destination'}
        </button>
      </div>}
      {!inShip && <div className="body-actions">
        <button className="primary" onClick={props.onGo} title="Move the camera to this body"><Crosshair size={16} />Go to body</button>
        {canPickSite && <button className={pickingSite ? 'active' : ''} aria-pressed={pickingSite} onClick={props.onPickSite}>
          <ArrowDownToLine size={16} />{pickingSite ? 'Cancel site selection' : 'Pick site and land'}
        </button>}
      </div>}
      {expanded && <div id="body-details" className="body-details">
        <span className="source-chip">{sourceLabel(source?.source_status)}</span>
        <p className="description">{source?.description ?? body.physical_notes}</p>
        <dl className="facts">
          <div><dt>Mean radius</dt><dd>{distance(body.radius_km)}</dd></div>
          <div><dt>Mean diameter</dt><dd>{distance(body.radius_km * 2)}</dd></div>
          <div><dt>Rotation period</dt><dd>{rotation == null ? 'Unconstrained' : `${formatNumber(Math.abs(rotation))} h`}</dd></div>
          {rotation != null && rotation < 0 && <div><dt>Spin direction</dt><dd>Retrograde</dd></div>}
          <div><dt>Parent body</dt><dd>{body.parent_id ? name(body.parent_id) : 'Solar system barycenter'}</dd></div>
        </dl>
      </div>}
      <div className="body-card-footer">
        <button className="link-button" onClick={props.onSources}>Data & credits <ExternalLink size={13} /></button>
        <button className="icon-button ghost" title="Save this body and date" aria-label="Bookmark this body" onClick={props.onBookmark}><BookmarkPlus size={17} /></button>
      </div>
    </div>
  </aside>
}
