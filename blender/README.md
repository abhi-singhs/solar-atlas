# Solar System

An animated, true-scale Blender model of 71 named bodies. The timeline covers September 5, 2026 through September 5, 2027.

Open `solar_system.blend` in Blender 5.2 or later. The file opens on Earth. Use Blender's scene selector to choose another body or a Solar System survey.

## Scale and navigation

One Blender unit represents 1 km. Geometry and positions use the same conversion. Earth is not enlarged relative to the Sun, and moon distances are not compressed. This unit choice keeps sub-kilometer bodies above the renderer's small-geometry thresholds; target-centered coordinates handle distant objects.

The two survey scenes contain the complete catalog. Their dots, labels, and path widths are annotations, not the physical sizes of the bodies. Hide the annotation collection to see the physical model alone. At this scale, many bodies disappear below a pixel.

Each named close-up uses a target-centered coordinate system. It subtracts the target's double-precision position before assigning Blender transforms. This keeps small bodies close to the origin without changing their sizes or separations. Close-ups include the target, Sun, relevant parent, and cataloged moons of that system. Remote unrelated systems are omitted from those local views.

Each close-up camera maintains a fixed inertial offset from its target. Its opening pose favors the illuminated hemisphere. The phase changes as the animation runs. Exposure differs between scenes because outer bodies receive less sunlight.

If a moon begins the interval in eclipse, its saved opening frame advances to the first sampled uneclipsed pose. The animation still starts at frame 1. Phobos is eclipsed by Mars at the interval's first frame; this is modeled darkness, not a missing material.

## Animation

Frame 1 starts at September 5, 2026, 00:00 UTC, converted to TDB. Each subsequent frame advances one simulation hour. The timeline has 8,761 frames and monthly date markers.

Positions come from cached NASA/JPL Horizons geometric state vectors in ICRF. These are simultaneous physical positions, not sky positions corrected for light-travel time. The Sun moves about the Solar System barycenter.

The `.blend` contains native animation curves. Playback needs neither network access nor Python auto-run. Velocity-based cubic interpolation fits the cached samples. Phobos uses an additional 15-minute source grid, including in views centered on Phobos. Other context bodies are interpolated to that grid. The finer data reduced tested Phobos interpolation errors from about 12.3 km to 49 m before Blender storage. Between-sample motion remains an approximation. `data/ephemeris_validation.json` and `validation.json` report numerical limits.

The internal clock uses continuous TDB. Future UTC labels assume the cached leap-second table, so an unannounced future leap second would require a data refresh.

Where available, secular IAU/NAIF pole and prime-meridian polynomials control orientation. Periodic corrections, detailed Earth orientation parameters, and some librations are omitted. These rotations are not navigation-grade. Unknown orientations remain fixed and are labeled `UNCONSTRAINED`; orbital animation still works.

Fast playback can alias short-period rotation and moon orbits. Motion blur is off. For inspecting a brief event, generate a shorter interval with finer samples rather than interpreting a fast year-long playback as a resolved movie.

## Bodies

| Group | Included |
| --- | --- |
| Star | Sun |
| Planets | Mercury, Venus, Earth, Mars, Jupiter, Saturn, Uranus, Neptune |
| Dwarf planets | Ceres, Pluto, Haumea, Makemake, Eris |
| Dwarf-planet candidates | Orcus, Quaoar, Gonggong, Sedna, Salacia, Varda, Varuna, Ixion |
| Earth and Mars moons | Moon, Phobos, Deimos |
| Jupiter moons | Io, Europa, Ganymede, Callisto, Amalthea, Thebe, Himalia, Elara |
| Saturn moons | Mimas, Enceladus, Tethys, Dione, Rhea, Titan, Hyperion, Iapetus, Phoebe, Janus, Epimetheus |
| Uranus moons | Miranda, Ariel, Umbriel, Titania, Oberon, Puck |
| Neptune moons | Triton, Nereid, Proteus |
| Pluto moons | Charon, Styx, Nix, Kerberos, Hydra |
| Other small bodies | Vesta, Pallas, Hygiea, Eros, Itokawa, Bennu, Ryugu, Arrokoth, Chariklo, Chiron |
| Comets | 1P/Halley, 2P/Encke, 67P/Churyumov-Gerasimenko |

The catalog is an expanded selection, not a census of the Solar System. No random asteroid population or invented Oort cloud is presented as measured data. Dwarf-planet candidates are not labeled as formally recognized dwarf planets.

## Materials and physical limits

Inspect a surface material's custom properties for its source status and source URLs:

- `OBSERVED` uses a published image product.
- `MIXED` combines observations with reconstructed detail or coverage.
- `RECONSTRUCTION` uses procedural appearance where resolved maps are unavailable.

Observed mosaics can combine images from different dates, resolutions, and viewing conditions. Clouds and gas-planet weather are not predictions for the animation dates. Albedo, roughness, and atmosphere shading are visual approximations, not a calibrated spectral reflectance model.

Irregular meshes without an imported mission shape use catalog-fitted ellipsoids or labeled procedural geometry. The contact-binary shapes of Arrokoth and 67P are reconstructions. Small-body dimensions and unknown poles can be uncertain.

Earth has separate surface, cloud, and atmosphere geometry where assets support them. Venus depicts its visible cloud envelope, not a radar surface exposed through transparent clouds. Atmosphere shell heights use the same length conversion as the bodies.

Solar illumination uses inverse-square falloff and a finite source radius. The light's scaled power corresponds to a solar luminosity of 3.828e26 W. The Sun mesh does not block its own source. Space has no ambient fill light.

The Sun's visible photosphere uses a 5772 K blackbody color, procedural granulation, and an approximate optical limb-darkening law. Its display emission is normalized separately from the physical light source. It does not depict dated solar activity.

The four giant planets, Chariklo, Haumea, and Quaoar have ring geometry. Ring radii, poles, and representative optical depths come from NASA PDS tables and published occultation studies. Ring meshes are circular, zero-thickness optical sheets. They do not reproduce particle dynamics, eccentric ring edges, vertical dust structure, or evolving Neptune arcs. Quaoar's variable Q1R uses a narrow-component approximation, not an observed uniform profile. Fine shader structure is reconstructed. Jupiter's rings remain extremely faint rather than receiving artificial brightness.

Additional dwarf-planet satellites are not part of the core build. Their omission does not imply that those systems have no satellites. Comet nuclei have orbital motion; speculative tails and activity are omitted.

## Files

| Path | Purpose |
| --- | --- |
| `solar_system.blend` | Editable model, packed textures, native animation, named cameras |
| `data/catalog.json` | Body identities, dimensions, physical notes, and sources |
| `data/ephemerides.json.gz` | Cached double-precision positions and velocities |
| `data/horizons/` | Original ephemeris responses and provenance |
| `data/orientations.json` | Supported pole and prime-meridian models |
| `data/kernels/` | Source constants and time-conversion data |
| `data/asset_manifest.json` | Individual image sources, rights, and usage notes |
| `textures/` | Source and prepared texture files |
| `renders/` | Representative preview images |
| `renders/body-catalog.png` | Contact sheet of all 71 individually framed bodies |
| `renders/catalog/` | Per-body visual inspection thumbnails |
| `scripts/` | Data retrieval, material construction, scene building, and checks |
| `sources.json`, `CREDITS.md` | Combined source records and credits |
| `validation.json` | Saved-file structural and numerical checks |

## Rebuild and render

Run from this project folder. The scripts derive all paths from their own location.

```sh
python3 scripts/fetch_ephemerides.py
python3 scripts/prepare_assets.py
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup --python scripts/build_scene.py
/Applications/Blender.app/Contents/MacOS/Blender \
  --background solar_system.blend --python scripts/validate_scene.py
/Applications/Blender.app/Contents/MacOS/Blender \
  --background solar_system.blend --python scripts/render_previews.py \
  -- --targets earth saturn sedna overview --samples 96
python3 scripts/package_sources.py
```

Retrieval scripts cache source responses. Inspect their command-line help before changing dates or forcing a refresh. Horizons calls must remain serial. A refresh can change the source solution and should produce new validation results.

The scene builder overwrites this project's `solar_system.blend`. It does not open or modify the earlier portrait project. No rendered movie is included.
