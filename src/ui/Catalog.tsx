import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { BookmarkCheck, Check, Globe2, Search, X } from 'lucide-react'
import type { Body } from '../contracts'
import type { Bookmark } from '../navigation/state'
import { categories } from './format'

type Filter = 'all' | 'saved' | 'planet' | 'moon' | 'dwarf_planet' | 'small'
const smallBodies = ['asteroid', 'tno', 'centaur', 'comet', 'dwarf_candidate']

interface CatalogProps {
  open: boolean
  bodies: Body[]
  selectedId: string
  bookmarks: Bookmark[]
  onOpen: () => void
  onClose: () => void
  onSelect: (id: string) => void
  onOpenBookmark: (index: number) => void
  onRemoveBookmark: (index: number) => void
}

export function Catalog({ open, bodies, selectedId, bookmarks, onOpen, onClose, onSelect, onOpenBookmark, onRemoveBookmark }: CatalogProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const needle = query.trim().toLowerCase()
  const parentName = (id: string) => bodies.find(body => body.id === id)?.name ?? id
  const shownBodies = filter === 'saved' ? [] : bodies.filter(body => {
    const inFilter = filter === 'all' || body.category === filter || (filter === 'small' && smallBodies.includes(body.category))
    return inFilter && `${body.name} ${body.id}`.toLowerCase().includes(needle)
  })
  const shownSaved = filter === 'saved'
    ? bookmarks.map((bookmark, index) => ({ bookmark, index })).filter(({ bookmark }) => bookmark.name.toLowerCase().includes(needle))
    : []
  const filters: [Filter, string][] = [
    ['all', 'All'], ['saved', bookmarks.length ? `Saved ${bookmarks.length}` : 'Saved'], ['planet', 'Planets'],
    ['moon', 'Moons'], ['dwarf_planet', 'Dwarfs'], ['small', 'Small bodies'],
  ]

  const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const rows = [...(list.current?.querySelectorAll<HTMLButtonElement>('.catalog-row') ?? [])]
    if (!rows.length) return
    event.preventDefault()
    const index = rows.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1) : index - 1
    if (next < 0) input.current?.focus()
    else rows[next].focus()
  }

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (shownBodies[0]) onSelect(shownBodies[0].id)
      else if (shownSaved[0]) onOpenBookmark(shownSaved[0].index)
      return
    }
    moveFocus(event)
  }

  if (!open) {
    return <div className="catalog">
      <button className="catalog-toggle" onClick={onOpen} aria-expanded={false} aria-keyshortcuts="/" title="Find a world (/)">
        <Search size={17} /><span>Find a world</span><kbd>/</kbd>
      </button>
    </div>
  }

  return <div className="catalog open">
    <section className="catalog-panel panel" aria-label="Body catalog">
      <label className="search-field">
        <Search size={17} />
        <input ref={input} autoFocus placeholder={`Search ${bodies.length} bodies`} aria-label="Search bodies" value={query}
          onChange={event => setQuery(event.target.value)} onKeyDown={onInputKey} />
        <button aria-label="Close catalog" title="Close (Esc)" className="icon-button ghost" onClick={onClose}><X size={17} /></button>
      </label>
      <div className="filters" role="group" aria-label="Catalog filters">
        {filters.map(([value, label]) => <button key={value} aria-pressed={filter === value}
          className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      <div className="catalog-list" ref={list} onKeyDown={moveFocus}>
        {shownBodies.map(body => <button key={body.id} aria-label={`Select ${body.name}`}
          className={`catalog-row body-row ${body.id === selectedId ? 'selected' : ''}`} onClick={() => onSelect(body.id)}>
          <span className={`body-glyph ${body.category === 'star' ? 'sun-glyph' : ''}`}><Globe2 size={16} /></span>
          <span className="row-text"><strong>{body.name}</strong>
            <small>{categories[body.category]}{body.parent_id && body.parent_id !== 'sun' ? ` of ${parentName(body.parent_id)}` : ''}</small></span>
          {body.id === selectedId && <Check size={15} aria-hidden="true" />}
        </button>)}
        {shownSaved.map(({ bookmark, index }) => <div className="bookmark-row" key={`${bookmark.bodyId}-${bookmark.jd}`}>
          <button className="catalog-row" onClick={() => onOpenBookmark(index)}>
            <span className="body-glyph"><BookmarkCheck size={16} /></span>
            <span className="row-text"><strong>{bookmark.name.split(' / ')[0]}</strong><small>{bookmark.name.split(' / ')[1] ?? ''}</small></span>
          </button>
          <button className="icon-button ghost" aria-label={`Remove ${bookmark.name}`} title="Remove saved viewpoint" onClick={() => onRemoveBookmark(index)}><X size={16} /></button>
        </div>)}
        {filter !== 'saved' && !shownBodies.length && <p className="empty">No bodies match "{query}".</p>}
        {filter === 'saved' && !shownSaved.length && <p className="empty">
          {bookmarks.length ? `No saved viewpoints match "${query}".` : 'No saved viewpoints yet. Use the bookmark button on a body card to save that body and the current date.'}
        </p>}
      </div>
    </section>
  </div>
}
