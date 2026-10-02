import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { localAssetUrl } from '../render/assets'
import { buildOccluder } from './occluder'
import type { Occluder } from './occluder'
import { shipGroup } from './parts'
import type { NasaShip, ShipDesign } from './ships/types'

export interface LoadShipOptions {
  /** Returns the bytes of a model path such as `assets/ships/voyager.glb`. Defaults to a same-origin fetch. */
  fetchModel?: (path: string) => Promise<ArrayBuffer>
  /** Replaces every texture with an empty one. Node has no image decoder, so tests parse geometry only. */
  skipTextures?: boolean
}

const models = new Map<string, Promise<ArrayBuffer>>()
/** NASA exteriors, mapped to their occluder once something asks for it. */
const occluders = new WeakMap<THREE.Object3D, Occluder | undefined>()

async function fetchModel(path: string): Promise<ArrayBuffer> {
  const response = await fetch(localAssetUrl(path))
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`)
  return response.arrayBuffer()
}

/** Keeps each model's bytes for the session. A failed request is forgotten so a later pick can retry it. */
function modelBytes(path: string, fetcher: (path: string) => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
  let bytes = models.get(path)
  if (!bytes) {
    bytes = fetcher(path)
    models.set(path, bytes)
    bytes.catch(() => { if (models.get(path) === bytes) models.delete(path) })
  }
  return bytes
}

/** Parses a processed NASA exterior. The GLB is already in the cockpit frame, so it needs no transform. */
export async function parseNasaShip(design: NasaShip, bytes: ArrayBuffer, skipTextures = false): Promise<THREE.Group> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  // Plugins run in registration order and the built-in WebP plugin comes first. Taking its name replaces it in that
  // slot, so this stub answers for every texture before any image decode starts.
  if (skipTextures) loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new THREE.Texture()) }))
  const gltf = await loader.parseAsync(bytes.slice(0), '')
  const group = shipGroup(`${design.name} NASA model`, { reconstructed: false, source: design.source })
  group.add(gltf.scene)
  gltf.scene.traverse(object => {
    if (object instanceof THREE.Mesh && !object.name) object.name = object.parent?.name || `${design.id}-part`
  })
  group.updateMatrixWorld(true)
  occluders.set(group, undefined)
  return group
}

/**
 * The hit-test index for a loaded NASA exterior, in the group's own frame. It's built on first use and kept with the
 * group. Other objects get undefined, and callers should raycast them directly.
 */
export function shipOccluder(group: THREE.Object3D): Occluder | undefined {
  if (!occluders.has(group)) return undefined
  let occluder = occluders.get(group)
  if (!occluder) {
    occluder = buildOccluder(group)
    occluders.set(group, occluder)
  }
  return occluder
}

/**
 * Builds a ship exterior in meters, +Y up, nose toward -Z, origin at the pilot eye. Original ships build in code, and
 * the None choice builds an empty group. NASA ships fetch their GLB once per session and parse a fresh copy on every
 * call, so disposing one copy never frees geometry or textures that another copy still uses.
 */
export async function loadShip(design: ShipDesign, options: LoadShipOptions = {}): Promise<THREE.Group> {
  if (design.kind !== 'nasa') return design.buildShip()
  try {
    const bytes = await modelBytes(design.model, options.fetchModel ?? fetchModel)
    return await parseNasaShip(design, bytes, options.skipTextures)
  } catch (error) {
    throw new Error(`Could not load the ${design.name} model: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Drops cached model bytes. Tests use it to start from a clean cache. */
export function clearShipCache(): void {
  models.clear()
}
