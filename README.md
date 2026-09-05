# Solar atlas

A browser solar-system explorer covering 71 bodies, seven ring systems, physical dimensions, source records, and a cached year of JPL motion data.

Meshes and maps are converted ahead of time, so no modeling tool is a runtime dependency. `npm run build` writes the release to `dist/` with its data and assets included.

![Earth in the Solar atlas explorer](docs/screenshots/desktop-earth.png)

## Screenshots

<table>
	<tr>
		<td><img src="docs/screenshots/desktop-saturn.png" alt="Saturn and its rings in Explore mode"></td>
		<td><img src="docs/screenshots/desktop-ship-chase.png" alt="Spaceship chase view above the Moon"></td>
	</tr>
	<tr>
		<td align="center"><sub>Explore Saturn and its ring system</sub></td>
		<td align="center"><sub>Fly in cockpit or chase view</sub></td>
	</tr>
	<tr>
		<td colspan="2" align="center">
			<img src="docs/screenshots/phone-earth.png" alt="Earth explorer interface on a phone" width="360"><br>
			<sub>Responsive phone layout with touch controls</sub>
		</td>
	</tr>
</table>

## Run the release

```sh
npm ci
npm run build
npm run preview
```

Open the address the preview server prints and append `?scoutTheme=dark` for the dark theme. Stop the server with Ctrl+C. On macOS, `launch.command` serves an already built `dist/` the same way.

Serve the release over HTTP. Opening the page straight from disk fails, because browsers restrict local-file fetches, workers, and model loading. No account, external API, or CDN is needed at runtime.

To host the app, upload the entire `dist/` directory to a static HTTPS host. Keep the directory layout intact. Assets load on demand, so visiting every body transfers more data than opening the initial Earth view.

## Explore

Search the catalog or select a body label. Drag to orbit and scroll or pinch to zoom. The local, inner, and solar-system views frame physical positions without compressing distances. Body labels and trajectory lines are annotations; they can be hidden.

Use Go to body for instant camera navigation. Follow keeps the selected body centered. Free camera retains an inertial reference and supports W/S forward movement, A/D lateral movement, and R/F vertical movement.

The timeline starts paused. Play, reverse, scrub, and choose a time multiplier in Explore mode. The source interval spans September 5, 2026 through September 5, 2027. Playback stops at either boundary. Saved viewpoints retain a body and simulation date.

## Fly

Enter Spaceship to use an original three-dimensional cockpit or the external chase camera. Flight starts at 1x simulation time.

| Control | Action |
| --- | --- |
| W / S | Forward / reverse thrust |
| Arrow keys | Pitch and yaw |
| A / D | Yaw |
| Q / E | Roll |
| R / F | Vertical thrust |
| Space | Brake |
| Drag the viewport | Cockpit free-look |
| Touch pads and buttons | Steering, look, roll, vertical thrust, and braking on phone/tablet |

Use the numeric speed field, logarithmic slider, or presets to set commanded speed. Actual speed reports motion relative to the displayed reference body's center. A landed ship can have nonzero speed because the planet rotates beneath that reference frame. A reference change does not teleport the ship.

`c = 299,792.458 km/s`. Conventional mode remains below c. Enable Warp explicitly to allow speeds through 1,000c. Warp is fictional and is limited near hazards. The displayed c value is per simulated second, not a hidden time-acceleration multiplier.

Select a destination and choose Travel for assisted transfer. The controller steers toward the moving target and brakes for approach. Arrival time is an estimate. Cancel autopilot returns control without teleporting. Brake stops motion relative to the reference body.

Pausing freezes translation while leaving the interface and free-look usable. A hidden tab pauses the simulation instead of applying a large elapsed-time jump. Leave flight before scrubbing or reversing time.

## Land

Select a solid body and choose Land. The ship approaches, aligns, and descends with assistance. Once landed, it retains a body-local pose as the world rotates and travels through its orbit. Take off clears the local surface before normal flight resumes.

In Explore mode, Pick site and land lets you select a visible part of the source mesh and launch a descent there. Use the flight-panel toggle to expose the cockpit instruments, and adjust field of view in Settings.

Jupiter, Saturn, Uranus, and Neptune offer simulated atmospheric hovering. They do not have solid landing sites in this app. The Sun cannot be landed on.

Surface detail beyond the source mesh and maps is reconstructed. Bounded local terrain does not replace catalog radii or alter the authoritative scientific records. The same local geometry drives collision, surface altitude, and landing visuals. This is an exploration aid, not a terrain-navigation product.

## What is retained

- All body IDs, names, categories, parent relationships, adopted radii, semiaxes, physical notes, and citations.
- All cached double-precision position and velocity samples, including the quarter-hour Phobos refinement.
- Supported secular orientation models, retrograde rotations, ring poles, and unconstrained-phase caveats.
- All seven ring systems and their 37 bands, radii, representative optical depths, and references.
- Source-derived geometry, UV registration, prepared observed maps, compatible procedural bakes, cloud/atmosphere dimensions, and image credits.

CPU calculations use double-precision ICRF kilometers. The renderer subtracts the observer position before GPU transforms. Distant render proxies preserve angular size and direction rather than enlarging planets. Smaller textures and geometry detail levels reduce device load without changing stored physical dimensions.

## Scientific limits

Horizons states are simultaneous geometric positions relative to the Solar System barycenter. They are not apparent positions corrected for light travel. Interpolation uses source velocities and actual sample epochs. It never extrapolates beyond the cached interval.

Most bodies use hourly samples. Phobos uses 15-minute samples. The source measured about 49 m maximum error at selected independent Phobos test epochs. That result is not a universal accuracy guarantee. Source ephemeris uncertainty remains separate from interpolation and renderer error.

Orientations are approximate secular IAU models. The source omits periodic terms and detailed Earth orientation. Unknown rotations and texture phases remain unconstrained. UTC labels use a pinned leap-second table.

Observed imagery can combine multiple dates and reconstructed coverage. Clouds and weather maps are not forecasts for the selected date. Shaders approximate illumination, atmospheres, and eclipses rather than reproducing Blender Cycles ray tracing.

One-year trajectory lines are cached tracks. They are not fabricated complete orbits for bodies with longer orbital periods. This expanded catalog is not a complete Solar System census.

No n-body spacecraft dynamics, fuel accounting, relativistic optics, live ephemeris refresh, multiplayer, VR, or surface walking is included. The ship, cockpit, flight controls, and added terrain are exploration features, not measured scientific data.

## Develop

```sh
npm ci
npm run dev
npm run typecheck
npm test
npm run build
npm run test:browser
```

Source and rendering contracts live in `src/contracts.ts`. Conversion and export scripts live in `scripts/`. Scientific inputs come from the upstream records listed in `CREDITS.md`; generated output belongs to this app.

The browser suite uses installed Google Chrome through Playwright. It exercises desktop and emulated phone viewports. Emulated touch tests do not establish performance on a physical phone. Runs write screenshots and a JSON report to `artifacts/`, which is not tracked.

## Credits

The in-app Data & credits panel exposes the original catalog, orientation records, and per-image asset manifest. Read `CREDITS.md` for acknowledgments. Bundled manifests retain exact source URLs, usage terms, processing notes, and registration qualifications.

## License

The application code is MIT licensed. Read `LICENSE`.

The MIT grant does not extend to the bundled scientific data and imagery under `public/data/` and `public/assets/`. Those files keep the terms recorded in `CREDITS.md` and in the per-asset manifest, which include NASA source terms and CC BY 4.0 attribution requirements. Check the manifest before redistributing any map.

## Repository size

`public/` holds about 535 MB of committed meshes, textures, and cached ephemeris, so a full clone is large. Use `git clone --depth 1` if you only need the working tree.
