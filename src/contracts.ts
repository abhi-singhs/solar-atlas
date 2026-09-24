export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]

export interface Body {
  id: string
  name: string
  category: string
  parent_id: string | null
  radius_km: number
  radii_km?: Vec3
  rotation_period_hours?: number
  physical_notes?: string
  source_urls?: string[]
  horizons_id?: string
}

export interface BodyState {
  position: Vec3
  velocity: Vec3
  rotation: Quat
}

export interface Snapshot {
  jdTdb: number
  states: Record<string, BodyState>
}

export interface Dataset {
  bodies: Body[]
  firstJd: number
  lastJd: number
  evaluate(jdTdb: number): Snapshot
  utcToJd(iso: string): number
  jdToUtc(jd: number): string
  trajectory(id: string, count?: number): Vec3[]
}

export interface CameraPose {
  position: Vec3
  quaternion: Quat
}

export type Quality = 'low' | 'high'
export type ShipMode = 'free' | 'transfer' | 'approach' | 'landing' | 'landed' | 'hover' | 'takeoff'

export interface SurfaceHit {
  point: Vec3
  normal: Vec3
}

export interface SurfaceProvider {
  sample(bodyId: string, directionLocal: Vec3): SurfaceHit | null
}

export interface RenderOptions {
  selectedId: string
  labels: boolean
  paths: boolean
  quality: Quality
  exposure: number
  cockpit: boolean
  chase: boolean
  /** Draw a camera lens flare around the Sun. */
  lensFlare: boolean
  /** Dim the stars and Milky Way while the Sun is in view. Daylight inside an atmosphere hides them regardless. */
  glareHidesStars: boolean
  shipPose?: CameraPose
  landingBodyId?: string
  flightTelemetry?: {
    speedC: number
    throttleC: number
    altitudeKm: number
    verticalKmS: number
    warp: boolean
    mode: ShipMode
    targetId: string
    referenceId: string
  }
}

export const C_KM_S = 299792.458
export const AU_KM = 149597870.7
export const DAY_SECONDS = 86400

export function bodyRadius(body: Body): number {
  return body.radii_km ? Math.max(...body.radii_km) : body.radius_km
}
