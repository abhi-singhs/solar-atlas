/**
 * Tracks which ship is shown while another one loads. The renderer asks for the selected ship every frame, so a
 * request for the ship that is already loading, or that just failed, does nothing. Only the newest request may apply
 * its result; older results are discarded when they arrive. A failed ship is retried once another ship has been
 * requested in between.
 */
export class ShipSwap<T> {
  /** The id whose models are on screen. */
  current: string
  private pending?: string
  private failed?: string
  private token = 0
  private readonly load: (id: string) => Promise<T>
  private readonly apply: (id: string, value: T) => void
  private readonly discard: (value: T) => void
  private readonly fail: (id: string, error: unknown) => void

  constructor(current: string, load: (id: string) => Promise<T>, apply: (id: string, value: T) => void,
    discard: (value: T) => void, fail: (id: string, error: unknown) => void) {
    this.current = current
    this.load = load
    this.apply = apply
    this.discard = discard
    this.fail = fail
  }

  /** The id that is loading, if any. */
  get loading(): string | undefined {
    return this.pending
  }

  request(id: string): void {
    if (id !== this.failed) this.failed = undefined
    if (id === this.current) {
      // Returning to the shown ship cancels any load still in flight.
      if (this.pending !== undefined) this.cancel()
      return
    }
    if (id === this.pending || id === this.failed) return
    const token = ++this.token
    this.pending = id
    Promise.resolve().then(() => this.load(id)).then(value => {
      if (token !== this.token) {
        this.discard(value)
        return
      }
      this.pending = undefined
      this.current = id
      this.apply(id, value)
    }, (error: unknown) => {
      if (token !== this.token) return
      this.pending = undefined
      this.failed = id
      this.fail(id, error)
    })
  }

  /** Ignores any load in flight. Its result is discarded when it arrives. */
  cancel(): void {
    this.token++
    this.pending = undefined
  }
}
