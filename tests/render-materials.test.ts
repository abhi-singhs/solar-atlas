import { expect, it } from 'vitest'
import { Texture } from 'three'
import { shellMaterial, surfaceMaterial, terrainMaterial } from '../src/render/materials'
import type { LoadedBody } from '../src/render/assets'

function asset(id: string, color: Texture): LoadedBody {
  return {
    id, record: { normalization_radius_km: 6051.8, radii_km: [6051.8, 6051.8, 6051.8], roughness: .8 },
    textures: { color },
  } as unknown as LoadedBody
}

it('keeps the observed Venus cloud map off reconstructed ground and local terrain', () => {
  const observedCloud = new Texture()
  const venus = asset('venus', observedCloud)
  const ground = surfaceMaterial(venus)
  const clouds = shellMaterial(venus, true)
  expect(ground.uniforms.uColor!.value).not.toBe(observedCloud)
  expect(ground.uniforms.uAlbedoTint!.value.toArray()).toEqual([.18, .18, .18])
  expect(ground.userData.appearance).toContain('Reconstructed neutral ground')
  expect(clouds.uniforms.uColor!.value).toBe(observedCloud)
  expect(clouds.uniforms.uVenus!.value).toBe(true)
  expect(clouds.transparent).toBe(false)
  ground.dispose()
  clouds.dispose()
  observedCloud.dispose()
})

it('retains source surface textures and reconstructed bakes for other bodies', () => {
  const map = new Texture()
  for (const id of ['earth', 'moon', 'bennu', 'phobos']) {
    const material = surfaceMaterial(asset(id, map))
    expect(material.uniforms.uColor!.value).toBe(map)
    expect(material.uniforms.uAlbedoTint!.value.toArray()).toEqual([1, 1, 1])
    material.dispose()
  }
  map.dispose()
})

it('preserves terrain edge depth bias and uses the shared geometry normals', () => {
  const map = new Texture()
  const body = asset('moon', map)
  body.textures.height = new Texture()
  const ground = surfaceMaterial(body)
  const terrain = terrainMaterial(body)
  expect(terrain.uniforms.uColor!.value).toBe(map)
  expect(terrain.uniforms.uHasHeight!.value).toBe(false)
  expect(terrain.polygonOffset).toBe(true)
  expect(terrain.polygonOffsetFactor).toBe(-1)
  expect(terrain.polygonOffsetUnits).toBe(-1)
  expect(ground.polygonOffset).toBe(false)
  expect(ground.uniforms.uHasHeight!.value).toBe(true)
  ground.dispose()
  terrain.dispose()
  map.dispose()
  body.textures.height.dispose()
})
