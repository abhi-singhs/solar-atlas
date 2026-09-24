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

The spacecraft, cockpit geometry, flight controls, and added local terrain are original reconstructed content for this application. They are not mission hardware models, surveyed landscapes, or physical flight predictions.

React, Three.js, Vite, Lucide, and supporting packages retain their respective open-source licenses in the dependency installation.
