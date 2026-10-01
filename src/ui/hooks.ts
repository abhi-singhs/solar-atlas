import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

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

/**
 * Closes an open menu when a pointer goes down outside `root`. Elements matching `ignore` count as inside, so a trigger
 * that lives elsewhere can toggle the menu itself. Capture phase, so a control that stops propagation still closes it.
 */
export function useOutsidePress(root: RefObject<HTMLElement | null>, open: boolean, onClose: () => void, ignore?: string): void {
  const close = useLatest(onClose)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target || root.current?.contains(target)) return
      if (ignore && target instanceof Element && target.closest(ignore)) return
      close.current()
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [root, open, close, ignore])
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
