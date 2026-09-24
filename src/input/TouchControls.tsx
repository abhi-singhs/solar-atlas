import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, RotateCcw, RotateCw, Square } from 'lucide-react'
import { isFlightUI, setInputSource } from './controls'
import type { FlightInput } from './controls'
import './touch-controls.css'

export interface TouchControlsProps {
  input: FlightInput
  enabled: boolean
  onBrake: () => void
}

type Control = 'steer' | 'look' | 'ascend' | 'descend' | 'rollLeft' | 'rollRight' | 'forward' | 'reverse' | 'brake'
interface Contact {
  control: Control
  source: symbol
  element: HTMLElement
}

const buttonInput: Partial<Record<Control, Partial<FlightInput>>> = {
  ascend: { vertical: 1 },
  descend: { vertical: -1 },
  rollLeft: { roll: 1 },
  rollRight: { roll: -1 },
  forward: { forward: 1 },
  reverse: { forward: -1 },
  brake: { brake: true },
}
const zeroSticks = { steer: [0, 0], look: [0, 0] } as const

export function TouchControls({ input, enabled, onBrake }: TouchControlsProps) {
  const contacts = useRef(new Map<number, Contact>())
  const keyboard = useRef(new Map<string, Contact>())
  const root = useRef<HTMLDivElement>(null)
  const [sticks, setSticks] = useState<{ steer: readonly number[]; look: readonly number[] }>(zeroSticks)
  const [pressed, setPressed] = useState<Set<Control>>(new Set())

  const refreshPressed = useCallback(() => {
    setPressed(new Set([...contacts.current.values(), ...keyboard.current.values()].map((contact) => contact.control)))
  }, [])

  const release = useCallback((id: number) => {
    const contact = contacts.current.get(id)
    if (!contact) return
    contacts.current.delete(id)
    setInputSource(input, contact.source, null)
    if (contact.element.hasPointerCapture?.(id)) contact.element.releasePointerCapture(id)
    if (contact.control === 'steer' || contact.control === 'look') {
      setSticks((previous) => ({ ...previous, [contact.control]: [0, 0] }))
    }
    refreshPressed()
  }, [input, refreshPressed])

  const reset = useCallback(() => {
    for (const id of [...contacts.current.keys()]) release(id)
    for (const contact of keyboard.current.values()) setInputSource(input, contact.source, null)
    keyboard.current.clear()
    setSticks(zeroSticks)
    setPressed(new Set())
  }, [input, release])

  useEffect(() => {
    if (!enabled) return
    const onHidden = () => { if (document.hidden) reset() }
    const onFocus = (event: FocusEvent) => {
      if (!root.current?.contains(event.target as Node) && isFlightUI(event.target)) reset()
    }
    const onEscape = (event: globalThis.KeyboardEvent) => { if (event.code === 'Escape') reset() }
    window.addEventListener('blur', reset)
    window.addEventListener('pagehide', reset)
    window.addEventListener('keydown', onEscape)
    document.addEventListener('visibilitychange', onHidden)
    document.addEventListener('focusin', onFocus)
    return () => {
      window.removeEventListener('blur', reset)
      window.removeEventListener('pagehide', reset)
      window.removeEventListener('keydown', onEscape)
      document.removeEventListener('visibilitychange', onHidden)
      document.removeEventListener('focusin', onFocus)
      reset()
    }
  }, [enabled, reset])

  const moveStick = (contact: Contact, clientX: number, clientY: number) => {
    const rect = contact.element.getBoundingClientRect()
    const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.34)
    let x = (clientX - rect.left - rect.width / 2) / radius
    let y = (clientY - rect.top - rect.height / 2) / radius
    const length = Math.hypot(x, y)
    if (length > 1) { x /= length; y /= length }
    const deadzone = 0.08
    const magnitude = Math.hypot(x, y)
    const gain = magnitude <= deadzone ? 0 : (magnitude - deadzone) / ((1 - deadzone) * magnitude)
    const outputX = x * gain
    const outputY = y * gain
    setInputSource(input, contact.source, contact.control === 'steer'
      ? { yaw: -outputX, pitch: -outputY }
      : { lookX: outputX, lookY: -outputY })
    setSticks((previous) => ({ ...previous, [contact.control]: [x, y] }))
  }

  const down = (control: Control, event: PointerEvent<HTMLElement>) => {
    if (!enabled || (event.pointerType === 'mouse' && event.button !== 0)) return
    if ([...contacts.current.values()].some((contact) => contact.control === control)) return
    event.preventDefault()
    event.stopPropagation()
    const contact = { control, source: Symbol(control), element: event.currentTarget }
    contacts.current.set(event.pointerId, contact)
    // Synthetic accessibility events have no active native pointer to capture.
    if (event.nativeEvent.isTrusted) event.currentTarget.setPointerCapture(event.pointerId)
    if (control === 'steer' || control === 'look') moveStick(contact, event.clientX, event.clientY)
    else {
      setInputSource(input, contact.source, buttonInput[control] ?? null)
      if (control === 'brake') onBrake()
    }
    refreshPressed()
  }

  const move = (event: PointerEvent<HTMLElement>) => {
    const contact = contacts.current.get(event.pointerId)
    if (!contact) return
    event.preventDefault()
    event.stopPropagation()
    if (contact.control === 'steer' || contact.control === 'look') moveStick(contact, event.clientX, event.clientY)
  }

  useEffect(() => {
    const end = (event: globalThis.PointerEvent) => release(event.pointerId)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [release])

  const keyDown = (control: Control, event: KeyboardEvent<HTMLElement>) => {
    if (!enabled || event.repeat) return
    const key = `${control}:${event.code}`
    if (keyboard.current.has(key)) return
    let patch = buttonInput[control]
    if (control === 'steer' || control === 'look') {
      const x = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0
      const y = event.code === 'ArrowUp' ? 1 : event.code === 'ArrowDown' ? -1 : 0
      if (!x && !y) return
      patch = control === 'steer' ? { yaw: -x, pitch: y } : { lookX: x, lookY: y }
    } else if (event.code !== 'Space' && event.code !== 'Enter') return
    event.preventDefault()
    event.stopPropagation()
    const contact = { control, source: Symbol(key), element: event.currentTarget }
    keyboard.current.set(key, contact)
    setInputSource(input, contact.source, patch ?? null)
    if (control === 'brake') onBrake()
    refreshPressed()
  }

  const keyUp = (control: Control, event: KeyboardEvent<HTMLElement>) => {
    const key = `${control}:${event.code}`
    const contact = keyboard.current.get(key)
    if (!contact) return
    event.preventDefault()
    event.stopPropagation()
    setInputSource(input, contact.source, null)
    keyboard.current.delete(key)
    refreshPressed()
  }

  const releaseKeyboard = (control: Control) => {
    for (const [key, contact] of keyboard.current) {
      if (contact.control !== control) continue
      setInputSource(input, contact.source, null)
      keyboard.current.delete(key)
    }
    refreshPressed()
  }

  const handlers = (control: Control) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => down(control, event),
    onPointerMove: move,
    onPointerUp: (event: PointerEvent<HTMLElement>) => { event.stopPropagation(); release(event.pointerId) },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => release(event.pointerId),
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => release(event.pointerId),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => keyDown(control, event),
    onKeyUp: (event: KeyboardEvent<HTMLElement>) => keyUp(control, event),
    onBlur: () => releaseKeyboard(control),
    onContextMenu: (event: React.MouseEvent) => event.preventDefault(),
  })

  if (!enabled) return null

  const stick = (control: 'steer' | 'look', label: string) => (
    <button
      type="button"
      className="flight-touch-stick"
      data-control={control}
      data-active={pressed.has(control)}
      aria-label={`${label} stick. Drag in any direction or use arrow keys when focused.`}
      {...handlers(control)}
    >
      <span className="flight-touch-stick-cross" aria-hidden="true" />
      <span className="flight-touch-stick-thumb" aria-hidden="true" style={{
        '--stick-x': sticks[control][0],
        '--stick-y': sticks[control][1],
      } as CSSProperties} />
      <span className="flight-touch-stick-label">{label}</span>
    </button>
  )

  const button = (control: Control, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      className={`flight-touch-button${control === 'brake' ? ' flight-touch-brake' : ''}`}
      data-control={control}
      data-active={pressed.has(control)}
      aria-label={label}
      {...handlers(control)}
      onClick={(event) => { if (control === 'brake' && event.detail === 0) onBrake() }}
    >
      {icon}<span>{label}</span>
    </button>
  )

  return (
    <div
      ref={root}
      className="flight-touch"
      role="group"
      aria-label="Touch flight controls"
      data-touch-device={typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0}
    >
      <div className="flight-touch-bank">
        {stick('steer', 'Steer')}
        <div className="flight-touch-button-row">
          {button('rollLeft', 'Roll left', <RotateCcw aria-hidden="true" />)}
          {button('rollRight', 'Roll right', <RotateCw aria-hidden="true" />)}
        </div>
      </div>
      <div className="flight-touch-center">
        <div className="flight-touch-button-row">
          {button('forward', 'Ahead', <ChevronUp aria-hidden="true" />)}
          {button('reverse', 'Reverse', <ChevronDown aria-hidden="true" />)}
        </div>
        {button('brake', 'Brake', <Square aria-hidden="true" />)}
      </div>
      <div className="flight-touch-bank flight-touch-look">
        {stick('look', 'Look')}
        <div className="flight-touch-button-row">
          {button('ascend', 'Ascend', <ArrowUp aria-hidden="true" />)}
          {button('descend', 'Descend', <ArrowDown aria-hidden="true" />)}
        </div>
      </div>
    </div>
  )
}

export default TouchControls
