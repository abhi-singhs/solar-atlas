/** Ranges shared by Settings, saved preferences, and shared links. */
export const EXPOSURE_EV = { min: -4, max: 6 } as const
export const FOV_DEGREES = { min: 25, max: 100 } as const
export const MUSIC_VOLUME = { min: 0, max: 1 } as const
/** Largest time acceleration in either direction, one week per second. */
export const MAX_TIME_SCALE = 604800

export const inRange = (value: number, range: { readonly min: number; readonly max: number }): boolean =>
  Number.isFinite(value) && value >= range.min && value <= range.max
