import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const list = matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return matches
}

// The explorer publishes state every frame, so listeners read callbacks through a ref instead of re-subscribing.
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => { ref.current = value })
  return ref
}

export function useStoredFlag(key: string): [boolean, () => void] {
  const [value, setValue] = useState(() => {
    try { return localStorage.getItem(key) === '1' } catch { return false }
  })
  const set = useCallback(() => {
    setValue(true)
    try { localStorage.setItem(key, '1') } catch { /* Private browsing can block storage; the flag still holds for this visit. */ }
  }, [key])
  return [value, set]
}

export type ShortcutMap = Partial<Record<string, () => void>>

export function useShortcuts(map: ShortcutMap): void {
  const latest = useLatest(map)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
      const target = event.target instanceof Element ? event.target : null
      if (document.querySelector('dialog[open]')) return
      if (key !== 'Escape' && target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if ((key === ' ' || key === 'Enter') && target?.closest('button, a[href], [role="switch"]')) return
      const action = latest.current[key]
      if (!action) return
      event.preventDefault()
      action()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [latest])
}
