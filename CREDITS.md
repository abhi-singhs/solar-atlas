# Sources and attribution

This application adapts the Blender model vendored under `blender/`. Its source records remain authoritative. The scientific catalog and per-image rights manifest are bundled under `public/data/` and copied into the static release under `data/`.

## Scientific data

NASA/JPL Horizons supplies the cached geometric ICRF position and velocity vectors. NAIF planetary constants and the pinned leap-second kernel supply supported dimensions, secular orientation models, and time conversion.

Ring measurements retain NASA PDS Ring-Moon Systems Node tables and the original occultation-study citations. Chariklo, Haumea, and Quaoar retain their source pole and phase qualifications.

Background stars and the Milky Way combine five sources. `scripts/prepare_stars.py` downloads each file, checks it against a pinned SHA-256, and records its URL and checksum in `public/assets/stars/manifest.json`.

- ESA, The Hipparcos and Tycho Catalogues, ESA SP-1200 (1997), CDS catalog I/239. The app takes its Johnson V magnitudes and B-V colors.
- F. van Leeuwen, "Validation of the new Hipparcos reduction", A&A 474, 653 (2007), CDS catalog I/311. The app takes its positions, proper motions, and parallaxes.
- E. Høg et al., "The Tycho-2 Catalogue of the 2.5 Million Brightest Stars", A&A 355, L27 (2000), CDS catalog I/259.
- Dorrit Hoffleit and Wayne H. Warren Jr., The Bright Star Catalogue, 5th Revised Ed. (Preliminary Version), NSSDC/ADC (1991), CDS catalog V/50. The app takes the 18 stars that Hipparcos-2 lacks.
- NASA/Goddard Space Flight Center Scientific Visualization Studio. Gaia DR2: ESA/Gaia/DPAC. Deep Star Maps 2020, <https://svs.gsfc.nasa.gov/4851>. The app uses the `milkyway_2020_4k.exr` map. The list of stars missing from Hipparcos-2 and the Eta Carinae magnitude of 4.30 also come from this page.

CDS distributes Hipparcos, Hipparcos-2, and Tycho-2 under CC BY-NC 3.0 IGO. This project is noncommercial, so it bundles them under those terms, and any commercial use has to drop those files. The Bright Star Catalogue ReadMe states no usage license. NASA SVS asks for the credit line given above.

The build changes catalog values in a few places. It converts Tycho-2 VT and BT to Johnson V = VT - 0.090 (BT - VT) and B-V = 0.850 (BT - VT), following ESA SP-1200 Vol. 1, Section 1.3, Appendix 4. It moves faint-star positions to epoch 2027.0 with their proper motions. The 500 Tycho-2 entries that have no mean position, Proxima Centauri among them, take Hipparcos-2 astrometry instead. It moves the 18 Bright Star Catalogue additions from J2000 back to the Hipparcos epoch and gives Eta Carinae V = 4.30. It converts the NASA half-float EXR map to 4K and 2K sRGB JPEG files.

Star colors use the B-V temperature relation from Ballesteros, "New insights into black bodies", EPL 97, 34008 (2012), and the Planckian locus fit from Kim et al., US Patent 7,024,034.

## Images and maps

The per-asset manifest records the exact credit, source URL, usage terms, processing notes, and image-registration limits for every map. These credits include:

- Solar System Scope / INOVE and NASA-derived imagery. Applicable maps use CC BY 4.0 and require attribution.
- NASA/GSFC Blue Marble, Reto Stockli, and the Blue Marble processing team.
- NASA/GSFC, NASA/ESA HST, Amy Simon, Michael Wong, Glenn Orton, and the OPAL team.
- NASA/ESA HST and STScI/AURA.
- NASA/JPL-Caltech/UCLA/MPS/DLR/IDA/USGS, Thomas Roatsch, and the Dawn FC team.
- NASA/Johns Hopkins University Applied Physics Laboratory/Southwest Research Institute.
- NASA/GSFC/MIT, the LOLA science team, and Ernie Wright.
- NASA/GSFC/Arizona State University, LROC, and Ernie Wright.
- NASA/JPL/Caltech/USGS and the Galileo, Voyager, and Cassini imaging and processing teams.

NASA and mission-team references do not imply endorsement. Keep the asset manifest with redistributed builds. Source-specific rights and qualifications take precedence over this summary.

Solar System Scope publishes textures at <https://www.solarsystemscope.com/textures/>. Its attribution license is <https://creativecommons.org/licenses/by/4.0/>.

## Adaptations

The application exports source geometry into browser-readable assets and adapts the materials to real-time rendering. Compatible procedural bakes from the local Unreal port are reused with matching source provenance.

Reduced-resolution texture variants and mesh detail levels support smaller devices. Full prepared source maps and geometry remain available. Display adaptations do not change authoritative body dimensions or cached state values.

The Kestrel, Atomic, Needle, Mule, and Manta spacecraft, every cockpit, the flight controls, and the added local terrain are original reconstructed content for this application. They are not mission hardware models, surveyed landscapes, or physical flight predictions.

## NASA spacecraft models

The ten NASA ship exteriors come from NASA 3D Resources, <https://github.com/nasa/NASA-3D-Resources>, at commit `11ebb4ee043715aefbba6aeec8a61746fad67fa7`. That repository describes its assets as "free and without copyright." NASA's media usage guidelines, <https://www.nasa.gov/nasa-brand-center/images-and-media/>, allow factual use that does not imply endorsement and ask that NASA be acknowledged as the source. NASA has not endorsed this app. None of the source textures carry the NASA insignia, logotype, or seal. Some carry markings painted on the real hardware, such as U.S. and Soviet flags.

| Ship | NASA 3D Resources model | Real dimension the model is scaled to |
| --- | --- | --- |
| Gemini | [Gemini](https://github.com/nasa/NASA-3D-Resources/blob/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/Gemini/Gemini.glb) | adapter base diameter, 3.048 m ([source](https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1965-024A)) |
| Apollo Lunar Module | [Apollo Lunar Module](https://github.com/nasa/NASA-3D-Resources/blob/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/Apollo%20Lunar%20Module/Apollo%20Lunar%20Module.glb) | height with landing gear deployed, 6.99 m ([source](https://www.nasa.gov/wp-content/uploads/static/history/alsj/08_LM_&_SLA_Overview_pp61-68.pdf)) |
| Apollo-Soyuz | [Apollo Soyuz](https://github.com/nasa/NASA-3D-Resources/blob/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/Apollo%20Soyuz/Apollo%20Soyuz.glb) | Apollo command and service module length, 11 m ([source](https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1975-066A)) |
| Voyager | [Voyager Probe (B)](https://github.com/nasa/NASA-3D-Resources/blob/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/Voyager%20Probe%20(B)/Voyager%20Probe%20(B).glb) | high-gain antenna diameter, 3.7 m ([source](https://voyager.jpl.nasa.gov/mission/spacecraft/)) |
| Hubble | [Hubble Space Telescope (A)](https://github.com/nasa/NASA-3D-Resources/blob/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/Hubble%20Space%20Telescope%20(A)/Hubble%20Space%20Telescope%20(A).glb) | length, 13.1 m ([source](https://science.nasa.gov/mission/hubble/overview/hubble-by-the-numbers/)) |
| Cassini-Huygens | [Cassini-Huygens (A)](https://github.com/nasa/NASA-3D-Resources/blob/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/Cassini-Huygens%20(A)/Cassini-Huygens%20(A).glb) | high-gain antenna diameter, 4 m ([source](https://solarsystem.nasa.gov/system/downloadable_items/1943_spacecraft.pdf)) |
| ISS | [International Space Station (ISS) (B)](https://github.com/nasa/NASA-3D-Resources/blob/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/International%20Space%20Station%20(ISS)%20(B)/International%20Space%20Station%20(ISS)%20(B).glb) | solar array wingspan, 109 m ([source](https://www.nasa.gov/international-space-station/space-station-facts-and-figures/)) |
| Juno | [Juno (A)](https://github.com/nasa/NASA-3D-Resources/blob/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/Juno%20(A)/Juno%20(A).glb) | high-gain antenna diameter, 2.5 m ([source](https://www.missionjuno.swri.edu/spacecraft/juno-spacecraft)) |
| Parker Solar Probe | [Parker Solar Probe](https://github.com/nasa/NASA-3D-Resources/blob/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/Parker%20Solar%20Probe/Parker%20Solar%20Probe.glb) | thermal protection system diameter, 2.3 m ([source](https://parkersolarprobe.jhuapl.edu/Spacecraft/index.php)) |
| Webb | [James Webb Space Telescope (B)](https://github.com/nasa/NASA-3D-Resources/blob/11ebb4ee043715aefbba6aeec8a61746fad67fa7/3D%20Models/James%20Webb%20Space%20Telescope%20(B)/James%20Webb%20Space%20Telescope%20(B).glb) | sunshield length, 21.197 m ([source](https://science.nasa.gov/mission/webb/webbs-sunshield/)) |

`scripts/prepare_ships.mjs` changes every model. It removes animations, cameras, lights, and empty placeholder geometry, plus seven stray meshes floating above the ISS. It rotates each model so the nose points forward, scales it to the dimension above, and caps the ISS at 40 m. It simplifies the Apollo Lunar Module, ISS, and Webb to at most 60,000 triangles, merges draw calls, converts textures to WebP no larger than 1,024 px, and compresses geometry with meshopt. `public/assets/ships/manifest.json` records each source URL and SHA-256, the output SHA-256, and the final size.

The cockpits of these ships are original to this app, not NASA models. Voyager, Hubble, Cassini-Huygens, Juno, Parker Solar Probe, and Webb never carried crew, so their cockpits are invented.

The Space music soundtrack is original. The browser synthesizes it at runtime from Web Audio oscillators and generated noise, so the app bundles no audio recordings or samples.

React, Three.js, Vite, Lucide, and supporting packages retain their respective open-source licenses in the dependency installation.
