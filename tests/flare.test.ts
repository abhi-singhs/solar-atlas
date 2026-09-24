import { describe, expect, it } from 'vitest'
import { AdditiveBlending, BoxGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Raycaster, Vector3 } from 'three'
import { createCockpit } from '../src/cockpit/models'
import { AU_KM } from '../src/contracts'
import type { Body, Quat, RenderOptions, Vec3 } from '../src/contracts'
import { SolarRenderer } from '../src/render/SolarRenderer'
import { GHOSTS, MAX_FLARE_STRENGTH, SunFlare, flareLayout, flareStrength, ghostCenters } from '../src/render/flare'
import type { FlareFrame } from '../src/render/flare'
import { sunGlareFactor } from '../src/render/stars'

const frame = (patch: Partial<FlareFrame> = {}): FlareFrame =>
  ({ x: 300, y: 200, width: 1200, height: 800, sunPixels: 5, strength: 1, ...patch })

describe('sun flare strength', () => {
  it('is 1 for an unobstructed Sun at 1 AU and 0 EV', () => {
    expect(flareStrength(1, 1, 0)).toBeCloseTo(1, 12)
  })

  it('falls with distance and fades out where star glare ends', () => {
    let previous = Infinity
    for (const au of [.3, .7, 1, 1.5, 5.2, 9.5, 19, 30, 60, 120]) {
      const strength = flareStrength(au, 1)
      expect(strength).toBeLessThan(previous)
      previous = strength
    }
    expect(flareStrength(.1, 1, 6)).toBe(MAX_FLARE_STRENGTH)
    expect(flareStrength(1000, 1)).toBeLessThan(.001)
    expect(sunGlareFactor(1000, 1)).toBeGreaterThan(.99)
  })

  it('scales with the visible share of the disc and with exposure compensation', () => {
    expect(flareStrength(1, 0)).toBe(0)
    expect(flareStrength(1, .5)).toBeLessThan(flareStrength(1, 1))
    expect(flareStrength(1, .5)).toBeGreaterThan(0)
    expect(flareStrength(5, 1, 2)).toBeGreaterThan(flareStrength(5, 1, 0))
    expect(flareStrength(5, 1, -2)).toBeLessThan(flareStrength(5, 1, 0))
  })
})

describe('sun flare layout', () => {
  it('lengthens the spikes with strength and keeps the quad around them', () => {
    const weak = flareLayout(frame({ strength: .3 })), strong = flareLayout(frame())
    expect(strong.reach).toBeGreaterThan(weak.reach)
    expect(strong.intensity).toBeGreaterThan(weak.intensity)
    expect(strong.extent).toBeGreaterThanOrEqual(strong.reach)
    expect(flareLayout(frame({ strength: 0 })).intensity).toBe(0)
  })

  it('drops spikes and ghosts when the solar disc fills the view but keeps the glow', () => {
    const small = flareLayout(frame()), large = flareLayout(frame({ sunPixels: 500 }))
    expect(small.rays).toBe(1)
    expect(large.rays).toBe(0)
    expect(large.ghosts).toBe(0)
    expect(large.glow).toBeGreaterThan(500)
  })

  it('places ghosts on the line from the Sun through the screen center', () => {
    const f = frame()
    const centers = ghostCenters(f)
    expect(centers).toHaveLength(GHOSTS.length)
    for (const c of centers) expect((c.x - f.x) * (f.height / 2 - f.y) - (c.y - f.y) * (f.width / 2 - f.x)).toBeCloseTo(0, 6)
    expect(centers.some(c => c.x > f.width / 2 && c.y > f.height / 2)).toBe(true)
  })

  it('fades ghosts out as the Sun reaches the screen center', () => {
    expect(flareLayout(frame({ x: 600, y: 400 })).ghosts).toBe(0)
    expect(flareLayout(frame()).ghosts).toBe(1)
  })
})

describe('sun flare scene', () => {
  it('draws additively on top of the frame and hides with nothing to draw', () => {
    const flare = new SunFlare()
    for (const mesh of [flare.starburst, flare.ghosts]) {
      expect(mesh.material.blending).toBe(AdditiveBlending)
      expect(mesh.material.depthTest).toBe(false)
      expect(mesh.material.depthWrite).toBe(false)
      expect(mesh.material.toneMapped).toBe(false)
      expect(mesh.frustumCulled).toBe(false)
    }
    expect(flare.update(frame())).toBe(true)
    expect(flare.scene.visible).toBe(true)
    const u = flare.starburst.material.uniforms
    expect(u.uSun!.value.toArray()).toEqual([300, 600])
    expect(u.uResolution!.value.toArray()).toEqual([1200, 800])
    expect(u.uIntensity!.value).toBeCloseTo(1, 12)
    expect(u.uReach!.value).toBeCloseTo(flareLayout(frame()).reach, 12)
    expect(flare.ghosts.visible).toBe(true)
    expect(flare.update(frame({ strength: 0 }))).toBe(false)
    expect(flare.scene.visible).toBe(false)
    expect(flare.update(frame({ x: Number.NaN }))).toBe(false)
    expect(flare.update(frame({ x: 600, y: 400 }))).toBe(true)
    expect(flare.ghosts.visible).toBe(false)
    flare.dispose()
  })
})

describe('renderer sun view', () => {
  const sunBody: Body = { id: 'sun', name: 'Sun', category: 'star', parent_id: null, radius_km: 695700 }
  const camera: Vec3 = [AU_KM, 0, 0]
  const alpha = Math.asin(sunBody.radius_km / AU_KM)
  interface View { visibility: number; distanceAu: number; inside: boolean }
  interface Host {
    sunView(options: Partial<RenderOptions>): View | undefined
    starSunGlare(view: View | undefined, options: Partial<RenderOptions>): number
  }
  /** A body 1e6 km from the camera whose edge passes just above the Sun's center, so it covers the upper half. */
  function blocker(offset = .01 * alpha) {
    const theta = .06, length = 1e6 / Math.cos(theta)
    return { body: { id: 'moon', name: 'Moon', category: 'moon', parent_id: 'earth', radius_km: length * Math.sin(theta - offset) },
      position: [AU_KM - 1e6, 0, 1e6 * Math.tan(theta)] as Vec3, distance: length }
  }
  function host(bodies: ReturnType<typeof blocker>[] = [], extra: Record<string, unknown> = {}): Host {
    return Object.assign(Object.create(SolarRenderer.prototype), {
      width: 1200, height: 800, raycaster: new Raycaster(), assets: { bodies: new Map() },
      pose: { position: camera, quaternion: [0, 0, 0, 1] },
      snapshot: { jdTdb: 0, states: Object.fromEntries([['sun', [0, 0, 0] as Vec3], ...bodies.map(b => [b.body.id, b.position])]
        .map(([id, position]) => [id, { position, velocity: [0, 0, 0], rotation: [0, 0, 0, 1] }])) },
      screens: [{ body: sunBody, distance: AU_KM, pixels: 5, x: 600, y: 400, inView: true },
        ...bodies.map(b => ({ body: b.body, distance: b.distance, pixels: 400, x: 600, y: 0, inView: true }))],
      ...extra,
    })
  }
  const on: Partial<RenderOptions> = { lensFlare: true, glareHidesStars: true, cockpit: false, chase: false }

  it('sees the whole disc of an unobstructed Sun and dims the stars by its glare', () => {
    const view = host().sunView(on)!
    expect(view.visibility).toBe(1)
    expect(view.distanceAu).toBeCloseTo(1, 12)
    expect(view.inside).toBe(false)
    expect(host().starSunGlare(view, on)).toBeCloseTo(sunGlareFactor(1, 1), 12)
  })

  it('keeps the stars when the viewer turns glare dimming off', () => {
    const view = host().sunView(on)!
    expect(host().starSunGlare(view, { ...on, glareHidesStars: false })).toBe(1)
    expect(host().starSunGlare(undefined, on)).toBe(1)
  })

  it('counts the share of the disc a body covers', () => {
    // Samples above the center line (2 of 6 inner, 6 of 12 outer) are covered.
    const view = host([blocker()]).sunView(on)!
    expect(view.visibility).toBe(1 - (2 * 96 + 6 * 77) / 1600)
    expect(host([blocker(-2 * alpha)]).sunView(on)).toBeUndefined()
    expect(host([blocker(2 * alpha)]).sunView(on)!.visibility).toBe(1)
  })

  it('lets the cockpit frame block the Sun', () => {
    const cockpit = new Group()
    const strut = new Mesh(new BoxGeometry(.2, 1, 1), new MeshBasicMaterial())
    strut.position.set(-2, 0, 0)
    cockpit.add(strut)
    cockpit.updateMatrixWorld(true)
    const shipPose = { position: camera, quaternion: [0, 0, 0, 1] as [number, number, number, number] }
    const inCockpit = { ...on, cockpit: true, shipPose }
    expect(host([], { cockpit, ship: new Group() }).sunView(inCockpit)).toBeUndefined()
    strut.visible = false
    expect(host([], { cockpit, ship: new Group() }).sunView(inCockpit)!.visibility).toBe(1)
    strut.geometry.dispose()
    strut.material.dispose()
  })

  it('lets the real canopy pillar block the Sun but keeps the forward view open', () => {
    const cockpit = createCockpit()
    const aim = (local: Vec3) => {
      const quaternion = new Quaternion().setFromUnitVectors(new Vector3(...local).normalize(), new Vector3(-1, 0, 0)).toArray() as Quat
      const options = { ...on, cockpit: true, shipPose: { position: camera, quaternion } }
      const h = host([], { cockpit, ship: new Group() }) as Host & { poseShip(pose: unknown, options: unknown): void }
      h.poseShip({ position: camera, quaternion }, options)
      return h.sunView(options)
    }
    expect(aim([0, 0, -1])!.visibility).toBe(1)
    expect(aim([.985, .105, -1.405])).toBeUndefined()
    cockpit.traverse(object => {
      if (!(object instanceof Mesh)) return
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
    })
  })

  it('fades the Sun out past the edge of the view and ignores it behind the camera', () => {
    const edge = host()
    ;(edge as unknown as { screens: { x: number }[] }).screens[0]!.x = 1200 * 1.03
    expect(edge.sunView(on)!.visibility).toBeGreaterThan(0)
    expect(edge.sunView(on)!.visibility).toBeLessThan(1)
    const behind = host()
    ;(behind as unknown as { screens: { inView: boolean }[] }).screens[0]!.inView = false
    expect(behind.sunView(on)).toBeUndefined()
  })
})
