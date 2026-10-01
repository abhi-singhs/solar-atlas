#!/usr/bin/env node
/**
 * Builds the NASA hangar ships from NASA 3D Resources models.
 *
 * Each source model is downloaded at the commit pinned in scripts/nasa_ships.json and must match its pinned SHA-256
 * before it is read. Downloads are cached outside the repository. The script writes only public/assets/ships/.
 *
 * For every ship the script removes animations, cameras, lights, and placeholder geometry, rotates the model into the
 * app frame (meters, +Y up, nose toward -Z, pilot eye at the origin), scales it from one cited real dimension, caps it
 * at the hangar size limit, merges draw calls, simplifies to the triangle budget, converts textures to WebP, and
 * compresses the result with meshopt.
 *
 * Usage: npm run prepare:ships [-- <ship id> ...]
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Logger, Node, NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import {
  clearNodeTransform, dedup, flatten, getBounds, join as joinPrimitives, meshopt, prune, simplify, textureCompress, weld,
} from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CONFIG = JSON.parse(await readFile(join(ROOT, 'scripts/nasa_ships.json'), 'utf8'))
const OUTPUT = join(ROOT, 'public/assets/ships')
const MANIFEST = join(OUTPUT, 'manifest.json')
const CACHE = join(homedir(), '.cache/solar-atlas-ships', CONFIG.commit)
const AXES = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0], '+y': [0, 1, 0], '-y': [0, -1, 0], '+z': [0, 0, 1], '-z': [0, 0, -1],
}
const STRIPPED_EXTENSIONS = new Set(['KHR_draco_mesh_compression', 'KHR_lights_punctual'])

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
})

const sha256 = data => createHash('sha256').update(data).digest('hex')
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const round = (value, digits = 3) => Number(value.toFixed(digits))
const extent = bounds => bounds.max.map((max, i) => max - bounds.min[i])
const encodePath = path => path.split('/').map(encodeURIComponent).join('/')

function triangles(document) {
  let count = 0
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== 4) throw new Error(`Primitive mode ${prim.getMode()} is not triangles`)
      count += (prim.getIndices()?.getCount() ?? prim.getAttribute('POSITION').getCount()) / 3
    }
  }
  return count
}

const drawCalls = document => document.getRoot().listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().length, 0)

async function fetchSource(ship) {
  const file = join(CACHE, ship.source.split('/').pop())
  let data = existsSync(file) ? await readFile(file) : undefined
  if (!data) {
    const url = `https://raw.githubusercontent.com/nasa/NASA-3D-Resources/${CONFIG.commit}/${encodePath(ship.source)}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${ship.id}: download failed with HTTP ${response.status} from ${url}`)
    data = Buffer.from(await response.arrayBuffer())
    await mkdir(CACHE, { recursive: true })
    await writeFile(file, data)
  }
  const digest = sha256(data)
  if (digest !== ship.sha256) throw new Error(`${ship.id}: SHA-256 ${digest} does not match the pinned ${ship.sha256}`)
  return data
}

/**
 * Column-major matrix that moves the source eye point to the origin, turns the source `forward` axis into -Z and the
 * source `up` axis into +Y, and scales source units to meters.
 */
function shipMatrix(ship, scale) {
  const forward = AXES[ship.forward]
  const up = AXES[ship.up]
  if (!forward || !up || dot(forward, up) !== 0) throw new Error(`${ship.id}: forward and up must be different axes`)
  const rows = [cross(forward, up), up, forward.map(v => -v)]
  const t = rows.map(row => -dot(row, ship.eye) * scale)
  return [
    rows[0][0] * scale, rows[1][0] * scale, rows[2][0] * scale, 0,
    rows[0][1] * scale, rows[1][1] * scale, rows[2][1] * scale, 0,
    rows[0][2] * scale, rows[1][2] * scale, rows[2][2] * scale, 0,
    t[0], t[1], t[2], 1,
  ]
}

function strip(document, ship) {
  const root = document.getRoot()
  const removed = []
  // Disposing an Animation leaves its channels attached to nodes, and join() skips nodes that channels target.
  for (const animation of root.listAnimations()) {
    for (const channel of animation.listChannels()) channel.dispose()
    for (const sampler of animation.listSamplers()) sampler.dispose()
    animation.dispose()
  }
  for (const node of root.listNodes()) {
    node.setCamera(null)
    node.setExtension('KHR_lights_punctual', null)
    if (ship.dropNodes?.includes(node.getName())) {
      removed.push(node.getName())
      node.dispose()
    }
  }
  const missing = (ship.dropNodes ?? []).filter(name => !removed.includes(name))
  if (missing.length) throw new Error(`${ship.id}: dropNodes not found: ${missing.join(', ')}`)
  // Several NASA exports carry a material-less 1-unit placeholder cube on the root node.
  let placeholders = 0
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMaterial()) continue
      prim.dispose()
      placeholders++
    }
  }
  for (const extension of root.listExtensionsUsed()) if (STRIPPED_EXTENSIONS.has(extension.extensionName)) extension.dispose()
  for (const scene of root.listScenes()) if (scene !== (root.getDefaultScene() ?? root.listScenes()[0])) scene.dispose()
  return { dropped: removed.length, placeholders }
}

async function build(ship) {
  const document = await io.readBinary(new Uint8Array(await fetchSource(ship)))
  document.setLogger(new Logger(Logger.Verbosity.WARN))
  const root = document.getRoot()
  const sourceTriangles = triangles(document)
  const removed = strip(document, ship)
  const scene = root.getDefaultScene() ?? root.listScenes()[0]
  root.setDefaultScene(scene)

  const pivot = document.createNode('ship')
  for (const child of scene.listChildren()) {
    scene.removeChild(child)
    pivot.addChild(child)
  }
  scene.addChild(pivot)
  const referenceScale = ship.reference.meters / ship.reference.sourceUnits
  pivot.setMatrix(shipMatrix(ship, referenceScale))
  const canonSizeM = Math.max(...extent(getBounds(scene)))
  const capped = canonSizeM > CONFIG.maxSizeM
  const scale = capped ? referenceScale * CONFIG.maxSizeM / canonSizeM : referenceScale
  pivot.setMatrix(shipMatrix(ship, scale))

  await document.transform(flatten())
  for (const node of scene.listChildren()) {
    const mesh = node.getMesh()
    if (mesh && mesh.listParents().filter(parent => parent instanceof Node).length > 1) node.setMesh(mesh.clone())
  }
  for (const node of scene.listChildren()) clearNodeTransform(node)
  await document.transform(prune(), dedup(), weld(), joinPrimitives(), prune())

  // Prune lets the simplifier drop tiny disconnected pieces, which edge collapses alone can't remove.
  const simplifier = { ...MeshoptSimplifier, simplify: (indices, positions, stride, target, error, flags) =>
    MeshoptSimplifier.simplify(indices, positions, stride, target, error, [...flags, 'Prune']) }
  for (const error of [0.0005, 0.001, 0.002, 0.004, 0.008, 0.016, 0.032]) {
    const count = triangles(document)
    if (count <= CONFIG.maxTriangles) break
    await document.transform(simplify({ simplifier, ratio: CONFIG.maxTriangles / count * 0.97, error }), prune())
  }
  const finalTriangles = triangles(document)
  const meshes = drawCalls(document)
  if (finalTriangles > CONFIG.maxTriangles) throw new Error(`${ship.id}: ${finalTriangles} triangles exceed ${CONFIG.maxTriangles}`)
  if (meshes > CONFIG.maxMeshes) throw new Error(`${ship.id}: ${meshes} draw calls exceed ${CONFIG.maxMeshes}`)

  scene.listChildren().forEach((node, i) => {
    const material = node.getMesh()?.listPrimitives()[0]?.getMaterial()?.getName() ?? ''
    const name = `${ship.id}-${material.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part'}-${i + 1}`
    node.setName(name)
    node.getMesh()?.setName(name)
  })

  const size = CONFIG.textureSize
  await document.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [size, size], quality: 82 }), dedup(), prune())
  const bounds = getBounds(scene)
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
  const glb = await io.writeBinary(document)

  // Read the output back so the manifest reports what the browser will load.
  const check = await io.readBinary(glb)
  const checkBounds = getBounds(check.getRoot().getDefaultScene())
  const drift = Math.max(...checkBounds.min.map((v, i) => Math.abs(v - bounds.min[i])), ...checkBounds.max.map((v, i) => Math.abs(v - bounds.max[i])))
  if (drift > 0.02) throw new Error(`${ship.id}: compressed bounds moved ${drift.toFixed(3)} m`)

  await writeFile(join(OUTPUT, `${ship.id}.glb`), glb)
  const sizes = extent(checkBounds)
  const record = {
    file: `assets/ships/${ship.id}.glb`,
    source: {
      path: ship.source,
      url: `${CONFIG.repository}/blob/${CONFIG.commit}/${encodePath(ship.source)}`,
      sha256: ship.sha256,
      triangles: sourceTriangles,
    },
    reference: ship.reference,
    scale: round(scale, 6),
    sizeM: round(Math.max(...sizes), 2),
    ...(capped ? { canonSizeM: round(canonSizeM, 1) } : {}),
    eyeHeightM: round(-checkBounds.min[1], 2),
    boundsM: { min: checkBounds.min.map(v => round(v)), max: checkBounds.max.map(v => round(v)) },
    triangles: finalTriangles,
    meshes,
    textures: check.getRoot().listTextures().length,
    bytes: glb.byteLength,
    sha256: sha256(glb),
  }
  console.log(`${ship.id}: ${record.sizeM} m${capped ? ` (from ${record.canonSizeM} m)` : ''}, eye ${record.eyeHeightM} m, `
    + `${sourceTriangles} -> ${finalTriangles} triangles, ${meshes} meshes, ${record.textures} textures, `
    + `${(glb.byteLength / 1048576).toFixed(2)} MB, dropped ${removed.dropped} nodes and ${removed.placeholders} placeholders`)
  return record
}

const wanted = process.argv.slice(2)
const unknown = wanted.filter(id => !CONFIG.ships.some(ship => ship.id === id))
if (unknown.length) throw new Error(`Unknown ship ids: ${unknown.join(', ')}`)
await mkdir(OUTPUT, { recursive: true })
const previous = existsSync(MANIFEST) ? JSON.parse(await readFile(MANIFEST, 'utf8')).ships : {}
const ships = {}
for (const ship of CONFIG.ships) {
  ships[ship.id] = !wanted.length || wanted.includes(ship.id) ? await build(ship) : previous[ship.id]
  if (!ships[ship.id]) throw new Error(`${ship.id}: no previous build to keep; run without ids first`)
}
const manifest = {
  generator: 'scripts/prepare_ships.mjs',
  repository: CONFIG.repository,
  commit: CONFIG.commit,
  credit: CONFIG.credit,
  frame: 'meters, +Y up, nose toward -Z, pilot eye at the origin',
  ships,
}
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
