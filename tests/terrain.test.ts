import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { Body, SurfaceHit, SurfaceProvider, Vec3 } from '../src/contracts'
import { SourceSurface } from '../src/render/meshSurface'
import {
  createTerrainPatch, createTerrainSurface, SurfaceUnavailableError, supportsTerrain,
  TERRAIN_LABEL, TERRAIN_MAX_SEGMENTS, TerrainSystem,
} from '../src/terrain'

const moon: Body = { id: 'moon', name: 'Moon', category: 'moon', parent_id: 'earth', radius_km: 1737.4 }

function sphere(radius: number): SurfaceProvider {
  return {
    sample: (_id, direction) => {
      const d = new THREE.Vector3(...direction).normalize()
      return { point: d.clone().multiplyScalar(radius).toArray(), normal: d.toArray() }
    },
  }
}

function directionAt(center: Vec3, distance: number, radius: number): Vec3 {
  const axis = Math.abs(center[2]) < 0.8 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
  const direction = new THREE.Vector3(...center).normalize()
  const tangent = axis.cross(direction).normalize()
  const chord = distance / radius
  return direction.multiplyScalar(1 - chord * chord / 2)
    .addScaledVector(tangent, Math.sqrt(chord * chord - chord ** 4 / 4)).normalize().toArray()
}

function meshProvider(geometry: THREE.BufferGeometry): SurfaceProvider {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
  const ray = new THREE.Raycaster()
  geometry.computeBoundingSphere()
  const bound = geometry.boundingSphere!.radius * 4
  return {
    sample: (_id, direction) => {
      const d = new THREE.Vector3(...direction).normalize()
      ray.set(d.clone().multiplyScalar(bound), d.clone().negate())
      const hit = ray.intersectObject(mesh, false)[0]
      if (!hit?.face) return null
      return { point: hit.point.toArray(), normal: hit.face.normal.toArray() }
    },
  }
}

function altitude(point: Vec3, hit: SurfaceHit): number {
  return new THREE.Vector3(...point).sub(new THREE.Vector3(...hit.point))
    .dot(new THREE.Vector3(...hit.normal))
}

describe('source-aware terrain queries', () => {
  it('does not change the source or global dimensions before or outside activation', () => {
    const body = Object.freeze({ ...moon, radii_km: Object.freeze([1737.4, 1737.4, 1737.4]) as unknown as Vec3 })
    const sourceHit = { point: [1737.4, 0, 0] as Vec3, normal: [1, 0, 0] as Vec3 }
    const base: SurfaceProvider = { sample: () => sourceHit }
    const saved = JSON.stringify(body)
    const terrain = createTerrainSurface(base, [body])
    expect(terrain.base).toBe(base)
    expect(terrain.sample(body.id, [1, 0, 0])).toEqual(sourceHit)
    const patch = terrain.activate(body.id, [1, 0, 0])!
    expect(patch.radiusKm).toBeLessThanOrEqual(Math.min(5, body.radius_km * 0.03))
    expect(patch.maxReliefKm).toBeLessThanOrEqual(Math.min(0.005, body.radius_km * 0.0002))
    expect(terrain.sample(body.id, [0, 1, 0])).toEqual(sourceHit)
    const raised = terrain.sample(body.id, [1, 0, 0])!
    expect(raised.point[0]).toBeGreaterThan(sourceHit.point[0])
    expect(raised.point[0] - sourceHit.point[0]).toBeLessThan(patch.maxReliefKm)
    expect(sourceHit.point).toEqual([1737.4, 0, 0])
    expect(sourceHit.normal).toEqual([1, 0, 0])
    expect(JSON.stringify(body)).toBe(saved)
    terrain.deactivate(body.id)
    expect(terrain.sample(body.id, [1, 0, 0])).toEqual(sourceHit)
  })

  it('uses stable body IDs and local directions rather than random or world coordinates', () => {
    const base = sphere(moon.radius_km)
    const a = new TerrainSystem(base, [moon])
    const b = new TerrainSystem(base, [{ ...moon, name: 'Same source body' }])
    a.activate(moon.id, [1, 0, 0])
    b.activate(moon.id, [1, 0, 0])
    const d: Vec3 = [1, 0.00001, 0.00002]
    expect(a.sample(moon.id, d)).toEqual(b.sample(moon.id, d))
    const alternate = { ...moon, id: 'another-body' }
    const c = new TerrainSystem(base, [alternate])
    c.activate(alternate.id, [1, 0, 0])
    expect(c.sample(alternate.id, d)).not.toEqual(a.sample(moon.id, d))
    a.deactivate()
    a.activate(moon.id, [1, 0, 0])
    expect(a.sample(moon.id, d)).toEqual(b.sample(moon.id, d))
  })

  it('keeps source-unavailable results explicit without an ellipsoid substitute', () => {
    const unavailable: SurfaceProvider = { sample: () => null }
    const terrain = new TerrainSystem(unavailable, [moon])
    expect(terrain.sample(moon.id, [1, 0, 0])).toBeNull()
    expect(terrain.activate(moon.id, [1, 0, 0])).toBeNull()
    expect(() => createTerrainPatch(moon, [1, 0, 0], terrain)).toThrow(SurfaceUnavailableError)
    for (const invalid of [[0, 0, 0], [NaN, 0, 0], [Infinity, 1, 0]] as Vec3[]) {
      expect(terrain.sample(moon.id, invalid)).toBeNull()
      expect(terrain.activate(moon.id, invalid)).toBeNull()
    }
  })

  it('does not invent land on stars or gas and ice giants', () => {
    for (const id of ['sun', 'jupiter', 'saturn', 'uranus', 'neptune']) {
      const body = { ...moon, id }
      const terrain = new TerrainSystem(sphere(body.radius_km), [body])
      expect(supportsTerrain(body)).toBe(false)
      expect(terrain.activate(id, [1, 0, 0])).toBeNull()
      expect(() => createTerrainPatch(body, [1, 0, 0], terrain)).toThrow(/no supported solid/)
      expect(terrain.sample(id, [1, 0, 0])!.point).toEqual([body.radius_km, 0, 0])
    }
    for (const category of ['planet', 'moon', 'dwarf planet', 'asteroid', 'centaur', 'comet']) {
      expect(supportsTerrain({ ...moon, category })).toBe(true)
    }
  })

  it('blends height and slope to the untouched source at the edge', () => {
    const terrain = new TerrainSystem(sphere(moon.radius_km), [moon])
    const state = terrain.activate(moon.id, [1, 0, 0])!
    for (const fraction of [0.999, 1, 1.001, 2]) {
      const d = directionAt([1, 0, 0], state.radiusKm * fraction, moon.radius_km)
      const hit = terrain.sample(moon.id, d)!
      expect(Math.abs(Math.hypot(...hit.point) - moon.radius_km)).toBeLessThan(1e-9)
      expect(new THREE.Vector3(...hit.normal).distanceTo(new THREE.Vector3(...d))).toBeLessThan(1e-5)
    }
  })

  it('retains source facets on a rotating irregular body and bounds positive altitude', () => {
    const body: Body = { ...moon, id: 'irregular', radius_km: 1, radii_km: [2, 1.4, 0.7] }
    const geometry = new THREE.OctahedronGeometry(1, 0).scale(2, 1.4, 0.7)
    const base = meshProvider(geometry)
    const terrain = new TerrainSystem(base, [body])
    const direction: Vec3 = [0.7, 0.5, 0.3]
    const before = base.sample(body.id, direction)!
    terrain.activate(body.id, direction)
    const hit = terrain.sample(body.id, direction)!
    const delta = new THREE.Vector3(...hit.point).sub(new THREE.Vector3(...before.point))
    expect(delta.length()).toBeLessThanOrEqual(0.7 * 0.0002)
    expect(delta.clone().normalize().dot(new THREE.Vector3(...direction).normalize())).toBeCloseTo(1, 10)
    expect(Math.hypot(...hit.normal)).toBeCloseTo(1, 12)
    expect(new THREE.Vector3(...hit.normal).dot(new THREE.Vector3(...before.normal))).toBeGreaterThan(0.98)
    expect(Math.abs(new THREE.Vector3(...before.point).length() - body.radius_km)).toBeGreaterThan(0.02)
    const shipLocal = new THREE.Vector3(...hit.point).addScaledVector(new THREE.Vector3(...hit.normal), 0.003)
    expect(altitude(shipLocal.toArray(), hit)).toBeCloseTo(0.003, 12)
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 2, 3).normalize(), 1.6)
    const bodyPosition = new THREE.Vector3(6e9, -1e9, 3e9)
    const shipWorld = shipLocal.clone().applyQuaternion(rotation).add(bodyPosition)
    const restored = shipWorld.sub(bodyPosition).applyQuaternion(rotation.clone().invert())
    expect(altitude(restored.toArray(), hit)).toBeCloseTo(0.003, 5)
    geometry.dispose()
  })

  it('corrects oblate source normals using the same displaced height', () => {
    const body = { ...moon, radius_km: 1.5, radii_km: [2, 2, 1] as Vec3 }
    const base: SurfaceProvider = {
      sample: (_id, direction) => {
        const d = new THREE.Vector3(...direction).normalize()
        const p = d.multiplyScalar(1 / Math.sqrt(d.x ** 2 / 4 + d.y ** 2 / 4 + d.z ** 2))
        return { point: p.toArray(), normal: new THREE.Vector3(p.x / 4, p.y / 4, p.z).normalize().toArray() }
      },
    }
    const terrain = new TerrainSystem(base, [body])
    const d = new THREE.Vector3(1, 0.4, 0.7).normalize()
    terrain.activate(body.id, d.toArray())
    const east = new THREE.Vector3(0, 0, 1).cross(d).normalize()
    const north = d.clone().cross(east)
    const difference = (tangent: THREE.Vector3) => {
      const p = terrain.sample(body.id, d.clone().addScaledVector(tangent, 1e-6).toArray())!
      const m = terrain.sample(body.id, d.clone().addScaledVector(tangent, -1e-6).toArray())!
      return new THREE.Vector3(...p.point).sub(new THREE.Vector3(...m.point))
    }
    const numericalNormal = difference(east).cross(difference(north)).normalize()
    const hit = terrain.sample(body.id, d.toArray())!
    expect(numericalNormal.dot(new THREE.Vector3(...hit.normal))).toBeGreaterThan(0.999999)
  })

  it('avoids a rebuild while the ship stays in the central landing area', () => {
    const terrain = new TerrainSystem(sphere(moon.radius_km), [moon])
    const state = terrain.activate(moon.id, [1, 0, 0])!
    const nearby = directionAt([1, 0, 0], state.radiusKm * 0.3, moon.radius_km)
    expect(terrain.needsRecenter(moon.id, nearby)).toBe(false)
    expect(terrain.activate(moon.id, nearby)!.revision).toBe(state.revision)
    const outside = directionAt([1, 0, 0], state.radiusKm * 0.4, moon.radius_km)
    expect(terrain.needsRecenter(moon.id, outside)).toBe(true)
    expect(terrain.activate(moon.id, outside)!.revision).toBeGreaterThan(state.revision)
    state.directionLocal[0] = 0
    expect(terrain.getActivePatch(moon.id)!.directionLocal[0]).not.toBe(0)
  })
})

describe('local patch rendering', () => {
  it('prepares exact frozen touchdown geometry before flight caches its first surface hit', () => {
    const terrain = new TerrainSystem(sphere(moon.radius_km), [moon])
    const provider: SurfaceProvider & { prepareLanding?: (bodyId: string, direction: Vec3) => void } = terrain
    provider.prepareLanding!(moon.id, [1, 0, 0])
    const state = terrain.getActivePatch(moon.id)!
    const cached = provider.sample(moon.id, [1, 0, 0])!
    const ship = new THREE.Vector3(...cached.point).addScaledVector(new THREE.Vector3(...cached.normal), 0.003)
    const prepared = terrain.getPreparedPatch(moon.id)!
    const original = prepared.group.children[0] as THREE.Mesh
    const originalPositions = Array.from(original.geometry.getAttribute('position').array)
    const rendered = createTerrainPatch(moon, [1, 0, 0], terrain, {
      segments: 16, uvAt: () => [0.25, 0.75],
    })
    expect(rendered).toBe(prepared)
    expect(rendered.group.userData.landingPrepared).toBe(true)
    expect(rendered.state.revision).toBe(state.revision)
    expect(Array.from(original.geometry.getAttribute('position').array)).toEqual(originalPositions)
    expect(original.geometry.getAttribute('uv').getX(0)).toBe(0.25)
    expect(provider.sample(moon.id, [1, 0, 0])).toEqual(cached)
    expect(altitude(ship.toArray(), provider.sample(moon.id, [1, 0, 0])!)).toBeCloseTo(0.003, 10)
    expect(terrain.needsRecenter(moon.id, [0, 1, 0])).toBe(false)
    expect(terrain.activate(moon.id, [0, 1, 0])!.revision).toBe(state.revision)
    terrain.prepareLanding(moon.id, [0, 0, 1])
    expect(terrain.getActivePatch(moon.id)).toEqual(state)
    expect(provider.sample(moon.id, [1, 0, 0])).toEqual(cached)
    rendered.dispose()
    expect(terrain.getPreparedPatch(moon.id)).toBeNull()
    expect(terrain.needsRecenter(moon.id, [0, 1, 0])).toBe(true)
  })

  it('preparation replaces an earlier visual revision without letting old disposal erase touchdown', () => {
    const terrain = new TerrainSystem(sphere(moon.radius_km), [moon])
    const earlier = createTerrainPatch(moon, [1, 0, 0], terrain, { segments: 16 })
    terrain.prepareLanding(moon.id, [1, 0, 0])
    const prepared = terrain.getPreparedPatch(moon.id)!
    const cached = terrain.sample(moon.id, [1, 0, 0])
    expect(prepared.state.revision).toBeGreaterThan(earlier.state.revision)
    earlier.dispose()
    expect(terrain.getPreparedPatch(moon.id)).toBe(prepared)
    expect(terrain.sample(moon.id, [1, 0, 0])).toEqual(cached)
    const mesh = prepared.group.children[0] as THREE.Mesh
    const disposed = vi.spyOn(mesh.geometry, 'dispose')
    terrain.deactivate(moon.id)
    expect(disposed).toHaveBeenCalledOnce()
    expect(terrain.getPreparedPatch(moon.id)).toBeNull()
    expect(terrain.getActivePatch(moon.id)).toBeNull()
    expect(terrain.sample(moon.id, [1, 0, 0])!.point).toEqual([moon.radius_km, 0, 0])
    prepared.dispose()
    expect(disposed).toHaveBeenCalledOnce()
  })

  it('fails preparation explicitly when source geometry is unavailable or the body is not solid', () => {
    const terrain = new TerrainSystem({ sample: () => null }, [moon])
    expect(() => terrain.prepareLanding(moon.id, [1, 0, 0])).toThrow(SurfaceUnavailableError)
    expect(terrain.getPreparedPatch(moon.id)).toBeNull()
    expect(terrain.getActivePatch(moon.id)).toBeNull()
    const giant = { ...moon, id: 'jupiter' }
    const gas = new TerrainSystem(sphere(giant.radius_km), [giant])
    expect(() => gas.prepareLanding(giant.id, [1, 0, 0])).toThrow(/No supported solid landing site/)
  })

  it('releases every prepared collision mesh on deactivation without retaining a landing lock', () => {
    const other = { ...moon, id: 'another-moon' }
    const terrain = new TerrainSystem(sphere(moon.radius_km), [moon, other])
    terrain.prepareLanding(moon.id, [1, 0, 0])
    terrain.prepareLanding(other.id, [0, 1, 0])
    const first = terrain.getPreparedPatch(moon.id)!
    const second = terrain.getPreparedPatch(other.id)!
    const firstDispose = vi.spyOn((first.group.children[0] as THREE.Mesh).geometry, 'dispose')
    const secondDispose = vi.spyOn((second.group.children[0] as THREE.Mesh).geometry, 'dispose')
    terrain.deactivate()
    expect(firstDispose).toHaveBeenCalledOnce()
    expect(secondDispose).toHaveBeenCalledOnce()
    expect(terrain.getPreparedPatch(moon.id)).toBeNull()
    expect(terrain.getPreparedPatch(other.id)).toBeNull()
    expect(terrain.needsRecenter(moon.id, [1, 0, 0])).toBe(true)
  })

  it('keeps the renderer provider shared with flight across source readiness and body-local patch activation', () => {
    const body: Body = {
      ...moon, id: 'bennu-fixture', radius_km: 0.245, radii_km: [0.28, 0.24, 0.2],
    }
    const geometry = new THREE.OctahedronGeometry(1, 0).scale(1, 0.24 / 0.28, 0.2 / 0.28)
    geometry.computeBoundingSphere()
    const originalSource = Array.from(geometry.getAttribute('position').array)
    const source = new SourceSurface(geometry, 0.28)
    let ready = false
    const raw: SurfaceProvider = { sample: (_id, direction) => ready ? source.sample(direction) : null }
    const rendererSurface = createTerrainSurface(raw, [body])
    const flightSurface: SurfaceProvider = rendererSurface
    const direction: Vec3 = [0.8, 0.3, 0.2]
    expect(flightSurface.sample(body.id, direction)).toBeNull()
    expect(rendererSurface.activate(body.id, direction)).toBeNull()
    ready = true
    const originalHit = flightSurface.sample(body.id, direction)!
    expect(new THREE.Vector3(...originalHit.point)
      .distanceTo(new THREE.Vector3(...source.sample(direction)!.point))).toBeLessThan(1e-12)
    expect(Math.abs(Math.hypot(...originalHit.point) - body.radius_km)).toBeGreaterThan(0.01)
    rendererSurface.prepareLanding(body.id, direction)
    const state = rendererSurface.getActivePatch(body.id)!
    const patch = createTerrainPatch(body, state.directionLocal, rendererSurface, {
      segments: 16,
      uvAt: (_id, d) => source.uv(d)!,
    })
    expect(patch.surface).toBe(flightSurface)
    expect(patch.state.revision).toBe(state.revision)
    expect(new THREE.Vector3(...patch.centerLocalKm).distanceTo(new THREE.Vector3(...originalHit.point))).toBeLessThan(1e-12)
    const sharedHit = flightSurface.sample(body.id, direction)!
    expect(Math.hypot(...sharedHit.point)).toBeGreaterThan(Math.hypot(...originalHit.point))
    const original = patch.group.children[0] as THREE.Mesh
    const rendererClone = original.geometry.clone()
    rendererClone.translate(-1e9, 2e9, -3e9).scale(1e-6, 1e-6, 1e-6)
    expect(flightSurface.sample(body.id, direction)).toEqual(sharedHit)
    expect(Array.from(geometry.getAttribute('position').array)).toEqual(originalSource)
    rendererClone.dispose()
    patch.dispose()
    expect(flightSurface.sample(body.id, direction)).toEqual(originalHit)
    source.dispose()
    geometry.dispose()
  })

  it.each([[0, 0, 1], [0, 0, -1], [-1, 1e-12, 0], [-1, -1e-12, 0]] as Vec3[])(
    'has finite source-aligned geometry at direction %j', (...center) => {
      const base = sphere(moon.radius_km)
      const terrain = new TerrainSystem(base, [moon])
      const patch = createTerrainPatch(moon, center as Vec3, terrain)
      const mesh = patch.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
      const position = mesh.geometry.getAttribute('position')
      const normal = mesh.geometry.getAttribute('normal')
      expect(position.count).toBeLessThanOrEqual((TERRAIN_MAX_SEGMENTS + 1) ** 2)
      expect(patch.group.userData.label).toBe(TERRAIN_LABEL)
      expect(patch.group.position.toArray()).toEqual([0, 0, 0])
      expect(mesh.material.polygonOffset).toBe(true)
      for (let i = 0; i < position.count; i += 17) {
        const point = new THREE.Vector3().fromBufferAttribute(position, i).add(new THREE.Vector3(...patch.centerLocalKm))
        const hit = terrain.sample(moon.id, point.toArray())!
        expect(point.distanceTo(new THREE.Vector3(...hit.point)), `vertex ${i} at ${center}`).toBeLessThan(1e-7)
        expect(new THREE.Vector3().fromBufferAttribute(normal, i).length()).toBeCloseTo(1, 6)
      }
      for (const name of ['position', 'normal', 'uv', 'uv1', 'color']) {
        expect(Array.from(mesh.geometry.getAttribute(name).array).every(Number.isFinite)).toBe(true)
      }
      const index = mesh.geometry.getIndex()!
      for (let i = 0; i < index.count; i += 153) {
        const a = new THREE.Vector3().fromBufferAttribute(position, index.getX(i))
        const b = new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 1))
        const c = new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 2))
        expect(b.sub(a).cross(c.sub(a)).dot(new THREE.Vector3(...patch.state.directionLocal))).toBeGreaterThan(0)
      }
      patch.dispose()
    },
  )

  it.each([
    { ...moon },
    { ...moon, id: 'bennu', radius_km: 0.245 },
  ])('bounds triangle-interior height error for $id instead of only testing vertices', (body) => {
    const terrain = new TerrainSystem(sphere(body.radius_km), [body])
    const patch = createTerrainPatch(body, [1, 0, 0], terrain)
    const mesh = patch.group.children[0] as THREE.Mesh
    const position = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()!
    const center = new THREE.Vector3(...patch.centerLocalKm)
    let error = 0
    for (let i = 0; i < index.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(position, index.getX(i))
      const b = new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 1))
      const c = new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 2))
      const point = a.add(b).add(c).multiplyScalar(1 / 3).add(center)
      const evaluated = terrain.sampleReconstruction(body.id, point.toArray())!
      error = Math.max(error, point.distanceTo(new THREE.Vector3(...evaluated.point)))
    }
    expect(error).toBeLessThan(patch.state.maxReliefKm * 0.04)
    patch.dispose()
  })

  it('uses the visible source and patch union across a sharp irregular mesh crease', () => {
    const body: Body = { ...moon, id: 'faceted', radius_km: 1, radii_km: [2, 1.4, 0.7] }
    const geometry = new THREE.OctahedronGeometry(1, 0).scale(2, 1.4, 0.7)
    const base = meshProvider(geometry)
    const terrain = new TerrainSystem(base, [body])
    const patch = createTerrainPatch(body, [1, 0.002, 0.1], terrain)
    const mesh = patch.group.children[0] as THREE.Mesh
    const renderMesh = new THREE.Mesh(mesh.geometry, mesh.material)
    const rays = new THREE.Raycaster()
    const center = new THREE.Vector3(...patch.centerLocalKm)
    const index = mesh.geometry.getIndex()!
    const position = mesh.geometry.getAttribute('position')
    let sourceWins = 0
    for (let i = 0; i < index.count; i += 21) {
      const point = new THREE.Vector3().fromBufferAttribute(position, index.getX(i))
        .add(new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 1)))
        .add(new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 2)))
        .multiplyScalar(1 / 3).add(center)
      const direction = point.clone().normalize()
      rays.set(direction.clone().multiplyScalar(10).sub(center), direction.clone().negate())
      const rendered = rays.intersectObject(renderMesh, false)[0]
      const source = base.sample(body.id, direction.toArray())!
      const visibleRadius = Math.max(Math.hypot(...source.point), rendered?.point.add(center).length() ?? 0)
      const sampled = terrain.sample(body.id, direction.toArray())!
      expect(Math.hypot(...sampled.point)).toBeCloseTo(visibleRadius, 10)
      expect(Math.hypot(...sampled.point) - Math.hypot(...source.point)).toBeLessThanOrEqual(patch.state.maxReliefKm)
      if (visibleRadius === Math.hypot(...source.point)) sourceWins += 1
    }
    expect(sourceWins).toBeGreaterThan(0)
    patch.group.position.set(5e8, -1e8, 2e8)
    patch.group.rotation.set(0.8, 1, 1.4)
    patch.group.scale.setScalar(0.001)
    patch.group.updateMatrixWorld(true)
    const local = terrain.sample(body.id, patch.state.directionLocal)!
    expect(local.point.every(Number.isFinite)).toBe(true)
    expect(Math.hypot(...local.point)).toBeLessThan(3)
    patch.dispose()
    geometry.dispose()
  })

  it('does not bridge an irregular source hollow above the relief budget', () => {
    const body: Body = { ...moon, id: 'concave-source', radius_km: 1 }
    const geometry = new THREE.OctahedronGeometry(1, 1)
    const points = geometry.getAttribute('position')
    for (let i = 0; i < points.count; i += 1) {
      if (points.getX(i) > 0.9) points.setXYZ(i, points.getX(i) * 0.45, points.getY(i), points.getZ(i))
    }
    geometry.computeVertexNormals()
    const base = meshProvider(geometry)
    const terrain = new TerrainSystem(base, [body])
    const patch = createTerrainPatch(body, [1, 0.002, 0.004], terrain)
    const mesh = patch.group.children[0] as THREE.Mesh
    const position = mesh.geometry.getAttribute('position')
    const index = mesh.geometry.getIndex()!
    const center = new THREE.Vector3(...patch.centerLocalKm)
    for (let i = 0; i < index.count; i += 9) {
      const a = new THREE.Vector3().fromBufferAttribute(position, index.getX(i))
      const b = new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 1))
      const c = new THREE.Vector3().fromBufferAttribute(position, index.getX(i + 2))
      for (const weights of [[0.1, 0.2, 0.7], [0.2, 0.7, 0.1], [0.7, 0.1, 0.2], [1 / 3, 1 / 3, 1 / 3]]) {
        const point = a.clone().multiplyScalar(weights[0]).addScaledVector(b, weights[1])
          .addScaledVector(c, weights[2]).add(center)
        const source = base.sample(body.id, point.toArray())!
        expect(point.length() - Math.hypot(...source.point)).toBeLessThanOrEqual(patch.state.maxReliefKm)
      }
    }
    patch.dispose()
    geometry.dispose()
  })

  it('keeps replacement geometry active when an old patch is disposed', () => {
    const terrain = new TerrainSystem(sphere(moon.radius_km), [moon])
    const old = createTerrainPatch(moon, [1, 0, 0], terrain)
    const replacement = createTerrainPatch(moon, [1, 0, 0], terrain)
    const before = terrain.sample(moon.id, [1, 0.0001, 0.0001])
    old.dispose()
    expect(terrain.sample(moon.id, [1, 0.0001, 0.0001])).toEqual(before)
    replacement.dispose()
    expect(terrain.getActivePatch(moon.id)).toBeNull()
    expect(terrain.sample(moon.id, [1, 0, 0])!.point).toEqual([moon.radius_km, 0, 0])
    terrain.deactivate()
    expect(terrain.sample(moon.id, [1, 0, 0])!.point).toEqual([moon.radius_km, 0, 0])
  })

  it('retains map ownership and releases geometry and material exactly once', () => {
    const map = new THREE.Texture()
    const mapDispose = vi.spyOn(map, 'dispose')
    const patch = createTerrainPatch(moon, [1, 0, 0], sphere(moon.radius_km), {
      map, uvAt: () => [0.25, 0.75], segments: 10000,
    })
    const mesh = patch.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    expect(patch.surface).toBeInstanceOf(TerrainSystem)
    expect(mesh.geometry.getAttribute('position').count).toBe((TERRAIN_MAX_SEGMENTS + 1) ** 2)
    expect(mesh.geometry.getAttribute('uv').getX(0)).toBe(0.25)
    expect(mesh.material.map).toBe(map)
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
    const materialDispose = vi.spyOn(mesh.material, 'dispose')
    const parent = new THREE.Group().add(patch.group)
    patch.dispose()
    patch.dispose()
    expect(parent.children).toHaveLength(0)
    expect(patch.group.children).toHaveLength(0)
    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
    expect(mapDispose).not.toHaveBeenCalled()
    map.dispose()
  })

  it('rejects a missing hit anywhere inside the patch and clears failed activation', () => {
    const base = sphere(moon.radius_km)
    const partial: SurfaceProvider = {
      sample: (id, direction) => direction[1] < -0.00001 ? null : base.sample(id, direction),
    }
    const terrain = new TerrainSystem(partial, [moon])
    expect(() => createTerrainPatch(moon, [1, 0, 0], terrain)).toThrow(/no hit in the local patch/)
    expect(terrain.getActivePatch(moon.id)).toBeNull()
  })
})
