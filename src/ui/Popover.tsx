import { useRef } from 'react'
import type { ReactNode } from 'react'
import { useOutsidePress } from './hooks'

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
  useOutsidePress(root, open, onClose)
  return <div className="popover-anchor" ref={root}>
    {trigger}
    {open && <div className={`popover panel ${className}`} role="group" aria-label={label}>{children}</div>}
  </div>
}
