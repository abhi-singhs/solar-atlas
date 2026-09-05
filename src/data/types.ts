import type { Body } from '../contracts'

export interface FileDescriptor {
  bytes: number
  sha256: string
}

export interface DatasetManifest {
  schema_version: 1
  body_count: 71
  record_count: 72
  start_utc: string
  end_utc: string
  start_jd_tdb: number
  end_jd_tdb: number
  frame: 'ICRF'
  reference_plane: 'FRAME'
  center_id: 0
  units: 'KM-S'
  time_scale: 'TDB'
  corrections: 'NONE'
  geometric: true
  phobos_refinement_required: true
  epoch_rounding_tolerance_days: number
  files: Record<string, FileDescriptor>
}

export interface OrientationModel {
  pole_ra_deg: number[]
  pole_dec_deg: number[]
  prime_meridian_deg: number[]
  epoch_jd_tdb: number
  source: string
  notes: string
  [key: string]: unknown
}

export interface OrientationCatalog {
  bodies: Record<string, OrientationModel>
  metadata: Record<string, unknown>
}

export interface TimeCoefficients {
  DELTA_T_A: [number]
  K: [number]
  EB: [number]
  M: [number, number]
  leaps: { utc: string; tai_minus_utc: number }[]
  source: string
  warning: string
}

export interface RingPoles {
  poles: Record<string, [number, number]>
  warning: string
  source: string
}

export interface PackedTrack {
  id: string
  samples: Float64Array
  count: number
  firstJd: number
  lastJd: number
}

export interface PackedEphemeris {
  firstJd: number
  lastJd: number
  tracks: Record<string, PackedTrack>
}

export interface DatasetPayload {
  manifest: DatasetManifest
  bodies: Body[]
  ephemeris: PackedEphemeris
  orientations: OrientationCatalog
  time: TimeCoefficients
  ringPoles: RingPoles
}

export type WorkerReply =
  | { type: 'progress'; message: string }
  | { type: 'ready'; payload: DatasetPayload }
  | { type: 'error'; message: string }
