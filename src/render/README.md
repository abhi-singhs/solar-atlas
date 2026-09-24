# Source renderer

## Integration

```ts
const renderer = new SolarRenderer(container, dataset, {
  onSelect(id) {},
  onError(message) {},
  onProgress(message) {},
  onSurfacePick(id, hit) {},
})
const flight = new FlightController(dataset.bodies, renderer.surface)
await renderer.ensureBody(targetId)
// FlightController calls surface.prepareLanding before selecting a solid-body site.
```

`SolarRenderer` imports `Dataset`, `Snapshot`, `CameraPose`, `RenderOptions`, `SurfaceHit`, and `SurfaceProvider` from `src/contracts.ts`.

| Member | Contract |
| --- | --- |
| `update(snapshot, camera, options): void` | Updates and renders one frame. The caller owns `requestAnimationFrame`. |
| `resize(): void` | Uses the container's current dimensions. A `ResizeObserver` also calls it. |
| `dispose(): void` | Removes listeners, canvas, labels, GPU objects, and shared patch registrations. |
| `sourceSurface: SurfaceProvider` | Queries only the full source mesh through a local triangle BVH. Returns body-local kilometers and an outward triangle normal, or `null` until that body loads. |
| `surface: SurfaceProvider & {prepareLanding(bodyId, directionLocal): void}` | The shared flight collision provider. Returns source geometry outside an active patch and the visible source/terrain union inside it. `prepareLanding` synchronously builds and registers the drawn patch before flight selects its landed point. It throws if the full source mesh or patch is unavailable. |
| `ensureBody(id): Promise<void>` | Loads the full collision mesh and current-quality render maps. Rejects on failure and calls `onError`. Calling again retries a failed body. |
| `pickSurface(clientX, clientY, bodyId): SurfaceHit \| null` | Casts from browser viewport coordinates into the actual source mesh. Results remain body-local, independent of world rotation. |
| `attachTerrain(terrain: TerrainSystem): void` | Optional replacement for the renderer's default shared terrain system. Requires `terrain.base === renderer.sourceSurface`. The already-created `renderer.surface` object forwards to this replacement. |
| `getActiveTerrainPatch(bodyId)` | Returns the shared body-local patch center, direction, radius, relief bound, and revision, or `null`. |
| `setFieldOfView(degrees): void` | Clamps vertical FOV to 25 through 100 degrees. |
| `getBodyAssetStatus(id)` | Returns `{state: 'ready' \| 'loading' \| 'error' \| 'unloaded', error?, record?}`. |
| `stats` | Returns `{frameMs, drawCalls, triangles, textureBytes, loadedBodies}`. `frameMs` measures CPU submission, not GPU completion. The memory estimate includes source geometry. |
| `domElement` | The renderer canvas. |

The camera quaternion uses Three.js's negative-Z forward convention in right-handed ICRF. Do not rotate the scene to Y-up. The renderer restores the glTF axis conversion once when loading a mesh. glTF `(x,y,z)` becomes source `(x,-z,y)`.

Mesh UVs keep glTF `(U,1-V)`. All imported map textures use `flipY=false`. Do not apply another latitude flip, longitude roll, or image registration transform.

Click or tap selects a body. Movement above five CSS pixels does not select. Right-click invokes `onSurfacePick`. Call `pickSurface` directly for an explicit touch landing-site tool.

The renderer imports `createCockpit`, `createShip`, and `updateCockpit` from `src/cockpit/models.ts`. Their coordinates are meters. `options.shipPose` supplies their physical ICRF pose. Cockpit free-look changes the camera without moving the ship.

Each cockpit or chase frame forwards `options.flightTelemetry` to `updateCockpit` without replacing actual speed with commanded throttle. The renderer adds the ship's ICRF heading and catalog target/reference names. The speed needle, vertical-speed needle, throttle bars, warp lamp, and canvas instruments use the same live values as the parent HUD. `tests/render-cockpit.test.ts` verifies successive updates against the actual cockpit geometry.

The default terrain system uses `renderer.sourceSurface` as its base. Do not wrap `renderer.surface` in another terrain system, which would create conflicting patches. The wrapper calls `TerrainSystem.prepareLanding` with the flight-selected body-local direction. This intrinsically locks the 48-segment physical patch, and both flight and rendering use that same revision. The original patch vertices stay in kilometers relative to `centerLocalKm`. Rendering rotates a separate copy with the body's ICRF quaternion, then rebases it against the camera in binary64. Approach, landing, landed, and takeoff keep the patch center fixed. Resuming nearby free flight releases preparation and restores recentering from `shipPose` when the ship leaves the central 35% of its radius. An explicit unavailable result from terrain stays `null`; the wrapper never silently substitutes a raw source-only hit.

## Asset manifest

Fetch `assets/manifest.json` relative to the application's base URL. All runtime paths begin with `assets/`. No runtime resource points into either source project.

```ts
interface AssetManifest {
  schema_version: 1
  bodies: Record<string, {
    mesh: string
    mesh_low: string
    normalization_radius_km: number
    radii_km: [number, number, number]
    source_status: string
    source_description: string
    geometry_note: string
    kind: string
    roughness: number
    textures: Record<string, string> // role to T_* texture key
    cloud_height_km?: number
    atmosphere_height_km?: number
    atmosphere_scale_height_km?: number
    atmosphere_reference_altitude_km?: number
    atmosphere_optical_depth_rgb?: [number, number, number]
    source_metadata: object // complete source per-body asset record
    source_uv_registration: object
  }>
  textures: Record<string, {
    file: string
    srgb: boolean
    role: string
    variants: Record<'low' | 'high', {
      url: string
      width: number
      height: number
      bytes: number
      sha256: string
    }>
    source?: object
    source_graph?: string
    derived_sha256: string
  }>
  ring_systems: Record<string, {
    name: string
    inner_km: number
    outer_km: number
    optical_depth: number
    pole_ra_deg?: number
    pole_dec_deg?: number
    material: string // unchanged source-port provenance, not a runtime URL
    source_note: string
  }[]>
  prepared_source_maps: Record<string, {url: string; sha256: string; bytes: number}>
  source_metadata: Record<string, string>
  source_file_sha256: Record<string, string>
  limitations: string[]
}
```

The manifest retains all 71 bodies, seven ring systems, 37 bands, 114 textures, and 35 full-size prepared maps. Original source records and prepared maps live under `public/assets/source/`. The prepared files retain their source hashes. High render variants keep the compatible existing bakes at up to 4096 pixels wide. Low variants cap width at 1024. Full GLBs preserve all source triangles. Low GLBs use a 25% triangle derivative.

## Precision and lighting

CPU positions and observer subtraction use JavaScript binary64 numbers in kilometers. Each non-intersecting body renders in its own normalized depth range, farthest first. Each pass preserves its physical angular radius. Logarithmic depth resolves the shell and ring geometry within a pass. Close views rebase every vertex on the CPU before the GPU receives a float32 position. Source mesh collision never uses the reduced LOD.

The body meshes retain source dimensions. Small unloaded bodies can use physical-size angular proxies with Lambert phase, while annotation buttons remain separate DOM elements. No proxy has a minimum visible radius. Large bodies remain blank during loading rather than displaying an unrelated replacement texture.

Every body receives inverse-square solar flux. The common exposure is the selected body's squared solar distance in AU, multiplied by `2 ** options.exposure`. This does not change any body's flux relative to another. Earth night emission does not scale with solar flux. Surface shaders include source roughness, Earth ocean Fresnel glint, source cloud maps, and source shell heights. The Moon's retained height map perturbs shading normals without changing the source collision mesh.

Venus's observed visible-color map belongs only to its 65 km cloud shell. The underlying body and local terrain use neutral reconstructed ground with linear albedo 0.18 and roughness 0.95. These are render choices, not measurements of Venus's surface. The renderer never treats that cloud map as ground imagery. The parent UI must retain `TERRAIN_LABEL`, "Reconstructed local terrain. Not measured topography."

Ring sheets use each source band's optical depth. Opacity is `1-exp(-tau/abs(N dot V))`, with a stable small-tau branch and no brightness floor. Independent ring poles stay in ICRF. Surface ring shadows include the actual band gaps. Up to four spherical foreground bodies cast eclipse shadows.

Texture and geometry estimates use LRU budgets of 96 MiB for low quality and 512 MiB for high quality. Active, visibly resolved bodies and the selected or landing body remain pinned. A pinned working set can exceed the target budget. Low quality caps device pixel ratio at 1. High quality caps it at 1.75. Body assets load lazily, and visible background loading has a three-body concurrency limit.

## Stars

The constructor calls `loadStars`, which fetches `assets/stars/manifest.json` and then `hipparcos.bin`. Every star file must match the byte count and SHA-256 in the manifest before it is parsed. On each frame, `ensureStarQuality` starts any missing load for the current quality: `faint-a.bin` (Tycho-2 to V 10) and the 2K Milky Way JPEG on low, plus `faint-b.bin` (V 10 to 11.5) and the 4K map on high. A failed load calls `onError`, and the frame renders without that part. `src/render/stars.ts` holds the math, the parsers, and the `StarField` scene.

The star scene draws right after the clear, before trajectory lines and bodies. The Milky Way is a back-facing unit sphere drawn first, and the Tycho-2 and Hipparcos point passes add on top of it. All three have depth test and depth writes off, so every opaque body drawn later covers them. Rings and atmosphere shells keep their optical-depth transparency, which lets stars show through thin rings.

The Hipparcos vertex shader runs `apparentStar` in float32. It adds proper motion in radians per Julian year since J1991.25, then subtracts the camera position in parsecs times the parallax. Stars without a positive parallax stay at infinite distance. The Tycho-2 shader decodes an octahedral uint16 direction and uint8 V and B-V codes, with no motion or parallax.

Exposure is `2 ** options.exposure * sqrt(REFERENCE_PIXEL_SOLID_ANGLE / pixelSolidAngle)`, where the reference is 4 arcminutes per CSS pixel. A star's linear flux is exposure times `10^(-0.4 (V - 4))`, divided by the squared change in distance, and its peak is that flux to the power 0.9. The profile is a Gaussian core with a sigma of 0.75 CSS pixels holding 70% of the energy, plus a halo four times wider holding 30%. Each pixel clips at 1, so bright stars grow a saturated core and a glow. Color is the blackbody chromaticity for the star's B-V temperature, divided by the 4800 K white point, normalized to unit luminance, and mixed 65% with white. Stars without B-V render white.

The Milky Way shader samples the plate carree NASA map with `textureGrad` and a wrap-corrected derivative, so the RA seam doesn't drop to the smallest mip level. It subtracts a 0.004 black point and keeps 60% of the map's color. `milkyWayScale` turns texels into V = 0 stars per steradian with the matching NASA `hiptyc_2020` map, in which a V 5.5 star sums to about 0.5 texel units, and applies a 0.4 display gain. Neither pass uses tone mapping.

Two scene checks scale the stars and the Milky Way together. An unoccluded Sun in or near the viewport divides the flux by `1 + 4000 / d_AU^2`. Inside a body's atmosphere shell, `daylightExtinction` removes 0 to 12 magnitudes as the Sun rises from 18 degrees below the local horizon to 10 degrees above it. Below the Venus cloud deck the scene is skipped.

`tests/stars.test.ts` checks file checksums, tier counts, and the 18 Bright Star Catalogue additions. It compares Hipparcos stars with SIMBAD J2000 positions within 0.1 arcsecond, and finds Barnard's star, Proxima Centauri, Kapteyn's star, and Ross 128 in the Tycho-2 tier within 8 arcseconds of their 2027 positions. It also covers proper motion, parallax, color, exposure, glare, and the renderer's daylight rules. `tests/stars-render.test.ts` runs the real shaders in Chrome. Sirius, Arcturus after a century of proper motion, and Alpha Centauri seen from 1000 AU land within 0.2 pixel of the CPU prediction, and halving the distance to Sirius raises its peak by 4^0.9. It also checks that the Large Magellanic Cloud sits at its own RA rather than the mirrored one, and that the Coalsack is dark against the Crux star cloud.

## Verification

```sh
npm test -- tests/render-precision.test.ts tests/assets-parity.test.ts tests/terrain.test.ts
npm test -- tests/stars.test.ts tests/stars-render.test.ts
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
node tests/render-browser.mjs
node tests/render-browser.mjs --handshake
```

The browser script uses installed Chrome through Playwright. It captures Earth, Venus, Saturn, Jupiter, Bennu, Phobos, and Sedna, checks actual mesh picking, changes Earth to high quality, exercises shared terrain across the near-geometry transition, checks a 1 mm body-local clearance, and captures a phone-sized viewport. `tests/render-browser-evidence.json` records measurements and errors.

The same browser test constructs `FlightController(dataset.bodies, renderer.surface)` without another terrain wrapper. A real source-mesh Bennu landing reached `landed` after 409 steps of 0.1 simulated seconds. The pilot origin retained about 2.998 m clearance. The patch's source-local center and revision stayed unchanged when the renderer switched to the landed view.

The linear floating-point framebuffer probe measured exactly `0.25` radiance after reducing incident flux from 1 to 0.25. The synthetic full eclipse measured zero radiance. The 1100 by 850 desktop capture measured a 16.7 ms median and 16.8 ms p95 frame interval across 99 intervals. These measurements describe this Mac and headless Chrome, not physical-phone performance.

`public/assets/geometry-validation.json` records all source bounds, cardinal UV probes, triangle counts, mesh hashes, and unchanged before/after source hashes. Tests inspect actual GLB geometry, normals, winding, UV registration, and every packaged texture checksum.

## Limits

- The source Blender vertices and glTF attributes already use finite precision. Camera-relative rebasing prevents additional large-coordinate cancellation. It does not turn source geometry into measured millimeter terrain. Binary64 ICRF coordinates also lose sub-millimeter increments at sufficiently large heliocentric distances.
- The near/far composition sorts non-intersecting celestial bodies by center distance. It does not solve arbitrary intersecting geometry between distinct bodies.
- Atmospheres use thin optical shells. They do not reproduce Cycles volume transport, multiple scattering, refraction, or a calibrated sky viewed from within an atmosphere.
- Eclipse shadows use spherical occultors and hard edges. They omit solar-disc penumbrae. Ring sheets omit dust phase functions, vertical structure, and multiple scattering. Tenuous rings can disappear below display precision.
- Local terrain is reconstructed and bounded. It shares the flight collision geometry, but it does not add measured geography or resolve source maps beyond their prepared resolution.
- The spacecraft and cabin lighting are reconstructed exploration visuals, not radiometrically calibrated instruments.
- Stars omit aberration, radial velocity, binary orbits, variability, and resolved stars fainter than V 11.5. The Milky Way map holds only starlight fainter than Tycho-2, has no parallax, and shows no nebular gas. The tone curve, zoom rule, glare, and twilight scales are display choices tuned against a photograph, not a calibrated camera. Daylight hides the stars, but the sky itself still has no calibrated brightness.
- Browser screenshots and touch-sized viewports do not prove physical-device performance.

## Rebuilding assets

From the application folder, run the exporter with the source Blender file loaded in background mode. The exporter creates a separate scene and never saves the source.

```sh
PYTHONDONTWRITEBYTECODE=1 /Applications/Blender.app/Contents/MacOS/Blender \
  -b blender/solar_system.blend \
  --python-exit-code 1 --python scripts/export_blender.py
PYTHONDONTWRITEBYTECODE=1 python3 scripts/prepare_assets.py
```

The preparation script checks the compatible bake manifest against current source hashes. It refuses mismatched inputs. Both scripts write only this application's asset directory. Both disable Python bytecode writes before other imports, and the preparation script passes `PYTHONDONTWRITEBYTECODE=1` to its Blender child process. Neither script imports the source material or ring module. They only hash and copy those files.

The star files don't need Blender. `python3 scripts/prepare_stars.py` downloads Hipparcos, Hipparcos-2, Tycho-2, and Bright Star Catalogue files from CDS and the Milky Way EXR from NASA SVS. It checks every pinned SHA-256 and writes only `public/assets/stars/`. Add `--offline` to use the download cache alone.
