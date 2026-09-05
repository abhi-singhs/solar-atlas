# Sources and attribution

This application adapts the Blender model vendored under `blender/`. Its source records remain authoritative. The scientific catalog and per-image rights manifest are bundled under `public/data/` and copied into the static release under `data/`.

## Scientific data

NASA/JPL Horizons supplies the cached geometric ICRF position and velocity vectors. NAIF planetary constants and the pinned leap-second kernel supply supported dimensions, secular orientation models, and time conversion.

Ring measurements retain NASA PDS Ring-Moon Systems Node tables and the original occultation-study citations. Chariklo, Haumea, and Quaoar retain their source pole and phase qualifications.

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
