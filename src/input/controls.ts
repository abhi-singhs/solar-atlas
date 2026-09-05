export interface FlightInput {
  pitch: number
  yaw: number
  roll: number
  forward: number
  vertical: number
  lateral: number
  brake: boolean
  lookX: number
  lookY: number
}

type Axis = Exclude<keyof FlightInput, 'brake'>
type InputPatch = Partial<FlightInput>
const axes: Axis[] = ['pitch', 'yaw', 'roll', 'forward', 'vertical', 'lateral', 'lookX', 'lookY']
const sources = new WeakMap<FlightInput, Map<symbol, InputPatch>>()

export function createFlightInput(): FlightInput {
  return { pitch: 0, yaw: 0, roll: 0, forward: 0, vertical: 0, lateral: 0, brake: false, lookX: 0, lookY: 0 }
}

// Separate sources keep one released finger from cancelling another finger or a held key.
export function setInputSource(input: FlightInput, source: symbol, patch: InputPatch | null): void {
  let entries = sources.get(input)
  if (!entries) {
    entries = new Map()
    sources.set(input, entries)
  }
  const affected = new Set([...Object.keys(entries.get(source) ?? {}), ...Object.keys(patch ?? {})])
  if (patch) entries.set(source, patch)
  else entries.delete(source)
  for (const axis of axes) {
    if (!affected.has(axis)) continue
    let value = 0
    for (const entry of entries.values()) value += entry[axis] ?? 0
    input[axis] = Math.max(-1, Math.min(1, value))
  }
  if (affected.has('brake')) input.brake = [...entries.values()].some((entry) => entry.brake)
}

const bindings: Record<string, InputPatch> = {
  KeyW: { forward: 1 },
  KeyS: { forward: -1 },
  KeyA: { yaw: 1 },
  KeyD: { yaw: -1 },
  KeyQ: { roll: 1 },
  KeyE: { roll: -1 },
  KeyR: { vertical: 1 },
  KeyF: { vertical: -1 },
  ArrowUp: { pitch: 1 },
  ArrowDown: { pitch: -1 },
  ArrowLeft: { yaw: 1 },
  ArrowRight: { yaw: -1 },
  ShiftLeft: { brake: true },
  ShiftRight: { brake: true },
  Space: { brake: true },
}

export function isFlightUI(target: EventTarget | null): boolean {
  if (!target || !('nodeType' in target)) return false
  const node = target as Node
  const element = node.nodeType === 1 ? node as Element : node.parentElement
  return Boolean(element?.closest(
    'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="textbox"], [role="combobox"], [role="menu"], [role="dialog"]',
  ))
}

/** Right-handed ship axes. Positive pitch raises the nose; positive yaw and roll turn left. */
export class InputController {
  readonly state = createFlightInput()
  private readonly document: Document
  private readonly window: Window
  private readonly held = new Map<string, symbol>()
  private enabled = false
  private disposed = false
  private hadPointerLock = false

  constructor(element: HTMLElement) {
    this.document = element.ownerDocument
    const window = this.document.defaultView
    if (!window) throw new Error('Flight input needs an attached browser document.')
    this.window = window
    window.addEventListener('keydown', this.keyDown)
    window.addEventListener('keyup', this.keyUp)
    window.addEventListener('blur', this.reset)
    window.addEventListener('pagehide', this.reset)
    this.document.addEventListener('focusin', this.focusIn)
    this.document.addEventListener('visibilitychange', this.visibilityChange)
    this.document.addEventListener('pointerlockchange', this.pointerLockChange)
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed) return
    this.enabled = enabled
    if (!enabled) this.reset()
  }

  dispose(): void {
    if (this.disposed) return
    this.reset()
    this.enabled = false
    this.disposed = true
    this.window.removeEventListener('keydown', this.keyDown)
    this.window.removeEventListener('keyup', this.keyUp)
    this.window.removeEventListener('blur', this.reset)
    this.window.removeEventListener('pagehide', this.reset)
    this.document.removeEventListener('focusin', this.focusIn)
    this.document.removeEventListener('visibilitychange', this.visibilityChange)
    this.document.removeEventListener('pointerlockchange', this.pointerLockChange)
  }

  private reset = (): void => {
    for (const source of this.held.values()) setInputSource(this.state, source, null)
    this.held.clear()
  }

  private keyDown = (event: KeyboardEvent): void => {
    if (!this.enabled) return
    if (event.code === 'Escape' || event.ctrlKey || event.metaKey || event.altKey) {
      this.reset()
      return
    }
    if (event.isComposing || event.composedPath().some(isFlightUI) || isFlightUI(this.document.activeElement)) {
      this.reset()
      return
    }
    const binding = bindings[event.code]
    if (!binding) return
    event.preventDefault()
    if (this.held.has(event.code)) return
    const source = Symbol(event.code)
    this.held.set(event.code, source)
    setInputSource(this.state, source, binding)
  }

  private keyUp = (event: KeyboardEvent): void => {
    const source = this.held.get(event.code)
    if (!source) return
    setInputSource(this.state, source, null)
    this.held.delete(event.code)
    if (this.enabled && !isFlightUI(event.target)) event.preventDefault()
  }

  private focusIn = (event: FocusEvent): void => {
    if (isFlightUI(event.target)) this.reset()
  }

  private visibilityChange = (): void => {
    if (this.document.hidden) this.reset()
  }

  private pointerLockChange = (): void => {
    const locked = Boolean(this.document.pointerLockElement)
    if (this.hadPointerLock && !locked) this.reset()
    this.hadPointerLock = locked
  }
}
