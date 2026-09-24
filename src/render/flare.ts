import {
  AdditiveBlending, BufferAttribute, BufferGeometry, MathUtils, Mesh, OrthographicCamera, Scene, ShaderMaterial, Vector2,
} from 'three'
import { SUN_GLARE_AT_1_AU } from './stars'

/**
 * Camera lens flare for the Sun. A six-blade aperture gives six diffraction spikes and hexagonal ghosts, both fixed
 * to the screen. Everything is in CSS pixels, drawn additively after the rest of the frame, with no tone mapping.
 */
export const FLARE_ANGLE = 15 * Math.PI / 180
export const MAX_FLARE_STRENGTH = 2
/** CSS pixel width of each diffraction spike at the Sun. */
export const SPIKE_WIDTH = 1.1
export const STREAKS = 97
/** Ghosts are internal lens reflections, far fainter than the Sun's own spikes. */
export const GHOST_GAIN = .1

export interface Ghost {
  /** Position along the line from the Sun (0) through the screen center (1). */
  t: number
  /** Radius as a share of the viewport's short side. */
  size: number
  gain: number
  tint: [number, number, number]
}

export const GHOSTS: readonly Ghost[] = [
  { t: .42, size: .018, gain: .5, tint: [.45, .9, .8] },
  { t: .68, size: .045, gain: .2, tint: [1, .72, .38] },
  { t: 1.22, size: .03, gain: .32, tint: [.62, .52, 1] },
  { t: 1.45, size: .075, gain: .1, tint: [.5, 1, .6] },
  { t: 1.78, size: .04, gain: .22, tint: [1, .55, .35] },
  { t: 2.2, size: .12, gain: .06, tint: [.45, .65, 1] },
]

/**
 * Flare strength from the glare term that dims the stars, times exposure compensation and the visible share of the
 * Sun. It is 1 for an unobstructed Sun at 1 AU and 0 EV and follows the logarithm of that term, so it fades out
 * about where star dimming ends.
 */
export function flareStrength(sunDistanceAu: number, visibility: number, exposureEv = 0): number {
  const glare = MathUtils.clamp(visibility, 0, 1) * SUN_GLARE_AT_1_AU / Math.max(sunDistanceAu, 1e-3) ** 2
    * 2 ** MathUtils.clamp(exposureEv, -20, 20)
  return Math.min(MAX_FLARE_STRENGTH, Math.log10(1 + glare) / Math.log10(1 + SUN_GLARE_AT_1_AU))
}

export interface FlareFrame {
  /** Sun center in CSS pixels from the viewport's top left corner. */
  x: number
  y: number
  width: number
  height: number
  /** Radius of the solar disc in CSS pixels. */
  sunPixels: number
  strength: number
}

export interface FlareLayout {
  intensity: number
  /** Spike length in CSS pixels. */
  reach: number
  /** Scale of the veiling glow around the disc in CSS pixels. */
  glow: number
  /** Half width of the starburst quad in CSS pixels. */
  extent: number
  /** Spikes, streaks, and ghosts fade out as the solar disc fills the view, leaving the glow. */
  rays: number
  /** Ghost gain. Ghosts fade out as the Sun nears the screen center, where they would pile up on the disc. */
  ghosts: number
}

export function flareLayout(frame: FlareFrame): FlareLayout {
  const short = Math.max(1, Math.min(frame.width, frame.height))
  const strength = MathUtils.clamp(frame.strength, 0, MAX_FLARE_STRENGTH)
  const disc = Math.min(Math.max(frame.sunPixels, 0), short * 4)
  const reach = short * .5 * strength ** .8
  const glow = disc + short * .03 * strength ** .8
  const rays = 1 - MathUtils.smoothstep(disc / short, .12, .4)
  const offCenter = Math.hypot(frame.x - frame.width / 2, frame.y - frame.height / 2) / short
  return { intensity: Math.min(2, strength ** 2), reach, glow, extent: Math.max(reach, glow * 8, 1), rays,
    ghosts: rays * MathUtils.smoothstep(offCenter, .04, .3) }
}

/** Ghost centers in CSS pixels from the top left corner. */
export function ghostCenters(frame: FlareFrame): { x: number; y: number }[] {
  const cx = frame.width / 2, cy = frame.height / 2
  return GHOSTS.map(ghost => ({ x: frame.x + (cx - frame.x) * ghost.t, y: frame.y + (cy - frame.y) * ghost.t }))
}

const f = (value: number) => value.toFixed(6)
const normals = [0, 1, 2].map(k => [Math.cos(FLARE_ANGLE + k * Math.PI / 3), Math.sin(FLARE_ANGLE + k * Math.PI / 3)])
const GLSL = `
const vec2 N0 = vec2(${f(normals[0]![0]!)}, ${f(normals[0]![1]!)});
const vec2 N1 = vec2(${f(normals[1]![0]!)}, ${f(normals[1]![1]!)});
const vec2 N2 = vec2(${f(normals[2]![0]!)}, ${f(normals[2]![1]!)});
uniform vec2 uSun;
uniform vec2 uResolution;
vec4 screen(vec2 px) { return vec4(px / uResolution * 2.0 - 1.0, 0.0, 1.0); }`

const starburstVertex = `${GLSL}
uniform float uExtent;
varying vec2 vOffset;
void main() {
  vOffset = position.xy * uExtent;
  gl_Position = screen(uSun + vOffset);
}`

const starburstFragment = `${GLSL}
const float PI = 3.14159265359;
const float STREAKS = ${f(STREAKS)};
uniform float uReach;
uniform float uGlow;
uniform float uCore;
uniform float uExtent;
uniform float uIntensity;
uniform float uRays;
varying vec2 vOffset;
float hash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
float spike(vec2 normal, float r) {
  float across = dot(vOffset, vec2(-normal.y, normal.x));
  float width = ${f(SPIKE_WIDTH)} * (1.0 + 1.5 * r / uReach);
  return exp(-0.5 * across * across / (width * width));
}
void main() {
  float r = length(vOffset);
  float window = 1.0 - smoothstep(0.75, 1.0, r / uExtent);
  float core = exp(-0.5 * pow(r / max(uCore * 1.4, 1.5), 2.0));
  float q = r / uGlow;
  float glow = 1.0 / pow(1.0 + q * q, 1.5);
  float haze = exp(-r / (uGlow * 6.0));
  float fade = max(0.0, 1.0 - r / uReach);
  float spikes = (spike(N0, r) + spike(N1, r) + spike(N2, r)) * fade * fade;
  float x = (atan(vOffset.y, vOffset.x) / (2.0 * PI) + 0.5) * STREAKS;
  float i = floor(x), s = smoothstep(0.0, 1.0, fract(x));
  float i0 = mod(i, STREAKS), i1 = mod(i + 1.0, STREAKS);
  float streak = pow(mix(hash(i0), hash(i1), s), 10.0);
  float reach = uReach * mix(mix(0.2, 0.75, hash(i0 + 101.0)), mix(0.2, 0.75, hash(i1 + 101.0)), s);
  float streakFade = max(0.0, 1.0 - r / reach);
  float streaks = streak * streakFade * streakFade * smoothstep(0.0, uCore * 2.0 + 2.0, r);
  vec3 color = vec3(1.0, 0.97, 0.92) * core * 2.0 + vec3(1.0, 0.86, 0.68) * (0.3 * glow + 0.012 * haze)
    + (vec3(0.86, 0.93, 1.0) * 0.8 * spikes + vec3(1.0, 0.92, 0.8) * 0.35 * streaks) * uRays;
  gl_FragColor = vec4(color * uIntensity * window, 1.0);
  #include <colorspace_fragment>
}`

const ghostVertex = `${GLSL}
attribute vec4 aGhost;
attribute vec3 aTint;
uniform float uShort;
varying vec2 vLocal;
varying vec3 vTint;
void main() {
  vLocal = position.xy;
  vTint = aTint * aGhost.z;
  vec2 center = uSun + (uResolution * 0.5 - uSun) * aGhost.x;
  gl_Position = screen(center + position.xy * aGhost.y * uShort);
}`

const ghostFragment = `${GLSL}
const float GHOST_GAIN = ${f(GHOST_GAIN)};
uniform float uIntensity;
varying vec2 vLocal;
varying vec3 vTint;
void main() {
  float h = max(max(abs(dot(vLocal, N0)), abs(dot(vLocal, N1))), abs(dot(vLocal, N2))) / 0.86;
  float fill = 1.0 - smoothstep(0.7, 1.0, h);
  float rim = smoothstep(0.4, 0.9, h) * fill;
  gl_FragColor = vec4(vTint * (0.3 * fill + 0.7 * rim) * GHOST_GAIN * uIntensity, 1.0);
  #include <colorspace_fragment>
}`

function quads(count: number): BufferGeometry {
  const positions = new Float32Array(count * 12), indices: number[] = []
  for (let i = 0; i < count; i++) {
    positions.set([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], i * 12)
    indices.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  return geometry
}

function material(vertexShader: string, fragmentShader: string, uniforms: ShaderMaterial['uniforms']): ShaderMaterial {
  return new ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthTest: false,
    depthWrite: false, blending: AdditiveBlending, toneMapped: false })
}

export class SunFlare {
  readonly scene = new Scene()
  /** The shaders write clip coordinates directly, so the camera only satisfies `WebGLRenderer.render`. */
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  readonly starburst: Mesh<BufferGeometry, ShaderMaterial>
  readonly ghosts: Mesh<BufferGeometry, ShaderMaterial>
  private sun = { value: new Vector2() }
  private resolution = { value: new Vector2(1, 1) }

  constructor() {
    this.starburst = new Mesh(quads(1), material(starburstVertex, starburstFragment, {
      uSun: this.sun, uResolution: this.resolution, uExtent: { value: 1 }, uReach: { value: 1 }, uGlow: { value: 1 },
      uCore: { value: 1 }, uIntensity: { value: 0 }, uRays: { value: 1 },
    }))
    this.starburst.name = 'Sun flare starburst'
    const geometry = quads(GHOSTS.length)
    const ghost = new Float32Array(GHOSTS.length * 16), tint = new Float32Array(GHOSTS.length * 12)
    GHOSTS.forEach((item, i) => {
      for (let corner = 0; corner < 4; corner++) {
        ghost.set([item.t, item.size, item.gain, 0], (i * 4 + corner) * 4)
        tint.set(item.tint, (i * 4 + corner) * 3)
      }
    })
    geometry.setAttribute('aGhost', new BufferAttribute(ghost, 4))
    geometry.setAttribute('aTint', new BufferAttribute(tint, 3))
    this.ghosts = new Mesh(geometry, material(ghostVertex, ghostFragment, {
      uSun: this.sun, uResolution: this.resolution, uShort: { value: 1 }, uIntensity: { value: 0 },
    }))
    this.ghosts.name = 'Sun flare ghosts'
    for (const mesh of [this.ghosts, this.starburst]) {
      mesh.frustumCulled = false
      this.scene.add(mesh)
    }
  }

  /** Returns false, and hides the flare, when there is nothing to draw. */
  update(frame: FlareFrame): boolean {
    const layout = flareLayout(frame)
    const visible = layout.intensity > 1e-4 && Number.isFinite(frame.x) && Number.isFinite(frame.y)
    this.scene.visible = visible
    if (!visible) return false
    this.sun.value.set(frame.x, frame.height - frame.y)
    this.resolution.value.set(Math.max(1, frame.width), Math.max(1, frame.height))
    const burst = this.starburst.material.uniforms
    burst.uExtent!.value = layout.extent
    burst.uReach!.value = Math.max(layout.reach, 1)
    burst.uGlow!.value = Math.max(layout.glow, 1)
    burst.uCore!.value = Math.max(0, Math.min(frame.sunPixels, layout.extent))
    burst.uIntensity!.value = layout.intensity
    burst.uRays!.value = layout.rays
    const ghosts = this.ghosts.material.uniforms
    ghosts.uShort!.value = Math.max(1, Math.min(frame.width, frame.height))
    ghosts.uIntensity!.value = layout.intensity * layout.ghosts
    this.ghosts.visible = layout.ghosts > 1e-3
    return true
  }

  dispose(): void {
    for (const mesh of [this.starburst, this.ghosts]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
  }
}
