import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useLatest } from './hooks'

interface PopoverProps {
  open: boolean
  onClose: () => void
  label: string
  trigger: ReactNode
  className?: string
  children: ReactNode
}

export function Popover({ open, onClose, label, trigger, className = '', children }: PopoverProps) {
  const root = useRef<HTMLDivElement>(null)
  const close = useLatest(onClose)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close.current()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open, close])
  return <div className="popover-anchor" ref={root}>
    {trigger}
    {open && <div className={`popover panel ${className}`} role="group" aria-label={label}>{children}</div>}
  </div>
}
