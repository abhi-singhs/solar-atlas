# Sources and credits

The source records below distinguish measured data from visual reconstruction.

## Orbital and physical data

NASA/JPL Horizons supplies all trajectories. The exact requests, solution IDs, physical references, and checksums are preserved in `data/catalog.json`, `data/horizons/`, and `sources.json`.

Pole and prime-meridian polynomials come from [NAIF pck00011](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc). The model omits periodic attitude corrections.

| Body | Horizons target |
| --- | --- |
| Sun | `10` |
| Mercury | `199` |
| Venus | `299` |
| Earth | `399` |
| Mars | `499` |
| Jupiter | `599` |
| Saturn | `699` |
| Uranus | `799` |
| Neptune | `899` |
| Ceres | `1;` |
| Pluto | `999` |
| Haumea | `136108;` |
| Makemake | `136472;` |
| Eris | `136199;` |
| Orcus | `90482;` |
| Quaoar | `50000;` |
| Gonggong | `225088;` |
| Sedna | `90377;` |
| Salacia | `120347;` |
| Varda | `174567;` |
| Varuna | `20000;` |
| Ixion | `28978;` |
| Moon | `301` |
| Phobos | `401` |
| Deimos | `402` |
| Io | `501` |
| Europa | `502` |
| Ganymede | `503` |
| Callisto | `504` |
| Amalthea | `505` |
| Thebe | `514` |
| Himalia | `506` |
| Elara | `507` |
| Mimas | `601` |
| Enceladus | `602` |
| Tethys | `603` |
| Dione | `604` |
| Rhea | `605` |
| Titan | `606` |
| Hyperion | `607` |
| Iapetus | `608` |
| Phoebe | `609` |
| Janus | `610` |
| Epimetheus | `611` |
| Miranda | `705` |
| Ariel | `701` |
| Umbriel | `702` |
| Titania | `703` |
| Oberon | `704` |
| Puck | `715` |
| Triton | `801` |
| Nereid | `802` |
| Proteus | `808` |
| Charon | `901` |
| Styx | `905` |
| Nix | `902` |
| Kerberos | `904` |
| Hydra | `903` |
| Vesta | `4;` |
| Pallas | `2;` |
| Hygiea | `10;` |
| Eros | `433;` |
| Itokawa | `25143;` |
| Bennu | `101955;` |
| Ryugu | `162173;` |
| Arrokoth | `486958;` |
| Chariklo | `10199;` |
| Chiron | `2060;` |
| 1P/Halley | `DES=1P; CAP;` |
| 2P/Encke | `DES=2P; CAP;` |
| 67P/Churyumov-Gerasimenko | `DES=67P; CAP;` |

## Rings

- Jupiter. https://pds-rings.seti.org/jupiter/jupiter_rings_table.html . Mean radii and representative optical depths, not a complete particle model. Circular, zero-thickness optical sheets omit eccentricity, vertical structure, dust phase functions, and time-dependent arcs.
- Saturn. https://pds-rings.seti.org/saturn/saturn_rings_table.html . Mean radii and representative optical depths, not a complete particle model. Circular, zero-thickness optical sheets omit eccentricity, vertical structure, dust phase functions, and time-dependent arcs.
- Uranus. https://pds-rings.seti.org/uranus/uranus_rings_table.html . Mean radii and representative optical depths, not a complete particle model. Circular, zero-thickness optical sheets omit eccentricity, vertical structure, dust phase functions, and time-dependent arcs.
- Neptune. https://pds-rings.seti.org/neptune/neptune_rings_table.html . Mean radii and representative optical depths, not a complete particle model. Circular, zero-thickness optical sheets omit eccentricity, vertical structure, dust phase functions, and time-dependent arcs.
- Chariklo. Braga-Ribas et al. 2014, https://arxiv.org/abs/1409.7259 . Preferred equatorial J2000 pole RA 151.30 deg, DEC 41.48 deg. Mean circular sheets; representative widths and optical depths.
- Haumea. Ortiz et al. 2017 parameters, reproduced by Mueller et al. 2018, https://arxiv.org/abs/1811.09476 . Equatorial pole RA 285.1 deg, DEC -10.6 deg; radius 2287 km, width 70 km, normal optical depth 0.5.
- Quaoar. Pereira et al. 2023, https://arxiv.org/abs/2304.09237 , Table 2. Preferred ICRS pole RA 259.82 deg, DEC 53.45 deg. Q1R varies azimuthally; this sheet uses its narrow component's representative 5 km width and 0.4 peak depth, not an observed uniform global profile. Q2R is assumed coplanar; radius uncertainty 20 km.

## Image assets

Original and processed image checksums, transformations, coverage masks, and registration limits are in `data/asset_manifest.json`.

### Mercury

- color. Solar System Scope / INOVE, NASA MESSENGER-derived imagery.
  Source: https://www.solarsystemscope.com/textures/download/8k_mercury.jpg
  Usage: CC BY 4.0. Attribution required; adapted with resizing and reflectance normalization.
  Changes: gray.

### Venus

- color. Solar System Scope / INOVE, based on NASA imagery.
  Source: https://www.solarsystemscope.com/textures/download/4k_venus_atmosphere.jpg
  Usage: CC BY 4.0. Attribution required; adapted with resizing and Venus desaturation.
  Changes: venus.

### Earth

- clouds. NASA/GSFC Blue Marble.
  Source: https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: copy.
- ocean mask. Solar System Scope / INOVE, based on NASA imagery.
  Source: https://www.solarsystemscope.com/textures/download/8k_earth_specular_map.tif
  Usage: CC BY 4.0. Attribution required; adapted with resizing and Venus desaturation.
  Changes: copy.
- color. NASA/GSFC, Reto Stockli, Blue Marble.
  Source: https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_8192.png
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: copy.
- night. Solar System Scope / INOVE, based on NASA imagery.
  Source: https://www.solarsystemscope.com/textures/download/8k_earth_nightmap.jpg
  Usage: CC BY 4.0. Attribution required; adapted with resizing and Venus desaturation.
  Changes: copy.

### Mars

- color. Solar System Scope / INOVE, NASA Viking and Mars imagery.
  Source: https://www.solarsystemscope.com/textures/download/8k_mars.jpg
  Usage: CC BY 4.0. Attribution required; adapted by resizing and approximate reflectance normalization.
  Changes: copy.

### Jupiter

- color. NASA/GSFC, NASA/ESA HST, Amy Simon, Michael Wong, Glenn Orton.
  Source: https://svs.gsfc.nasa.gov/vis/a010000/a012000/a012021/Hubble_Jupiter_color_global_map_2015a.tif
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: opal.

### Saturn

- color. NASA/ESA HST, Amy Simon and OPAL team; STScI/AURA.
  Source: https://archive.stsci.edu/hlsps/opal/cycle30/saturn/hlsp_opal_hst_wfc3-uvis_saturn-2023b_f395n-f502n-f631n_v1_globalmap.tif
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: opal.

### Uranus

- color. NASA/ESA HST, Amy Simon and OPAL team; STScI/AURA.
  Source: https://archive.stsci.edu/hlsps/opal/cycle30/uranus/hlsp_opal_hst_wfc3-uvis_uranus-2022a_f467m-f547m-f657n_v1_globalmap.tif
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: opal.

### Neptune

- color. NASA/ESA HST, Amy Simon and OPAL team; STScI/AURA.
  Source: https://archive.stsci.edu/hlsps/opal/cycle30/neptune/hlsp_opal_hst_wfc3-uvis_neptune-2023b_f467m-f547m-f657n_v1_globalmap.tif
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: opal.

### Ceres

- color. NASA/JPL-Caltech/UCLA/MPS/DLR/IDA/USGS, Thomas Roatsch and Dawn FC team.
  Source: https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: gray.

### Pluto

- color. NASA/Johns Hopkins University Applied Physics Laboratory/Southwest Research Institute.
  Source: https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/p/l/pluto_color_mapmosaic.jpg
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: pluto.

### Moon

- height. NASA/GSFC/MIT, LOLA science team, Ernie Wright.
  Source: https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16.tif
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: height.
- color. NASA/GSFC/Arizona State University, LROC, Ernie Wright.
  Source: https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_16bit_srgb_4k.tif
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: copy.

### Phobos

- color. NASA/JPL/Caltech/USGS; Io color processing by David Seal.
  Source: https://space.jpl.nasa.gov/tmaps/pix/mar1kuu2.jpg
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: gray.

### Deimos

- color. NASA/JPL/Caltech/USGS; Io color processing by David Seal.
  Source: https://space.jpl.nasa.gov/tmaps/pix/mar2kuu2.jpg
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: gray.

### Io

- color. NASA/JPL/Caltech/USGS; Galileo, Voyager and Cassini imaging teams.
  Source: https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif
  Usage: USGS/PDS public-use scientific mosaic; retain mission and processing-team attribution.
  Changes: copy.

### Europa

- color. NASA/JPL/Caltech/USGS; Galileo, Voyager and Cassini imaging teams.
  Source: https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Europa_Voyager_GalileoSSI_global_mosaic_500m.tif
  Usage: USGS/PDS public-use scientific mosaic; retain mission and processing-team attribution.
  Changes: gray.

### Ganymede

- color. NASA/JPL/Caltech/USGS; Galileo, Voyager and Cassini imaging teams.
  Source: https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m.tif
  Usage: USGS/PDS public-use scientific mosaic; retain mission and processing-team attribution.
  Changes: copy.

### Callisto

- color. NASA/JPL/Caltech/USGS; Galileo, Voyager and Cassini imaging teams.
  Source: https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif
  Usage: USGS/PDS public-use scientific mosaic; retain mission and processing-team attribution.
  Changes: gray.

### Mimas

- color. NASA/JPL/Caltech/USGS; Io color processing by David Seal.
  Source: https://space.jpl.nasa.gov/tmaps/pix/sat1vuu2.jpg
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: gray.

### Enceladus

- color. NASA/JPL/Caltech/USGS; Galileo, Voyager and Cassini imaging teams.
  Source: https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Enceladus_Cassini_ISS_Global_Mosaic_100m_HPF.tif
  Usage: USGS/PDS public-use scientific mosaic; retain mission and processing-team attribution.
  Changes: gray.

### Tethys

- color. NASA/JPL/Caltech/USGS; Galileo, Voyager and Cassini imaging teams.
  Source: https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Tethys_Cassini_mosaic_global_293m.tif
  Usage: USGS/PDS public-use scientific mosaic; retain mission and processing-team attribution.
  Changes: gray.

### Dione

- color. NASA/JPL/Caltech/USGS; Io color processing by David Seal.
  Source: https://space.jpl.nasa.gov/tmaps/pix/sat4vuu2.jpg
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: gray.

### Rhea

- color. NASA/JPL/Caltech/USGS; Galileo, Voyager and Cassini imaging teams.
  Source: https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Rhea_Cassini_Voyager_mosaic_global_417m.tif
  Usage: USGS/PDS public-use scientific mosaic; retain mission and processing-team attribution.
  Changes: gray.

### Iapetus

- color. NASA/JPL/Caltech/USGS; Galileo, Voyager and Cassini imaging teams.
  Source: https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Iapetus_Cassini_Voyager_mosaic_global_783m.tif
  Usage: USGS/PDS public-use scientific mosaic; retain mission and processing-team attribution.
  Changes: gray.

### Miranda

- color. NASA/JPL/Caltech/USGS; Io color processing by David Seal.
  Source: https://space.jpl.nasa.gov/tmaps/pix/ura5vuu2.jpg
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: gray.

### Ariel

- color. NASA/JPL/Caltech/USGS; Io color processing by David Seal.
  Source: https://space.jpl.nasa.gov/tmaps/pix/ura1vuu2.jpg
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: gray.

### Umbriel

- color. NASA/JPL/Caltech/USGS; Io color processing by David Seal.
  Source: https://space.jpl.nasa.gov/tmaps/pix/ura2vuu2.jpg
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: gray.

### Titania

- color. NASA/JPL/Caltech/USGS; Io color processing by David Seal.
  Source: https://space.jpl.nasa.gov/tmaps/pix/ura3vuu2.jpg
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: gray.

### Oberon

- color. NASA/JPL/Caltech/USGS; Io color processing by David Seal.
  Source: https://space.jpl.nasa.gov/tmaps/pix/ura4vuu2.jpg
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: gray.

### Triton

- color. NASA/JPL/Caltech/USGS; Io color processing by David Seal.
  Source: https://space.jpl.nasa.gov/tmaps/pix/nep1vuu2.jpg
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: copy.

### Charon

- color. NASA/Johns Hopkins University Applied Physics Laboratory/Southwest Research Institute.
  Source: https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia19/pia19866/PIA19866.jpg
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: gray.

### Vesta

- color. NASA/JPL-Caltech/UCLA/MPS/DLR/IDA/USGS.
  Source: https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Vesta_Dawn_FC_HAMO_Mosaic_Global_74ppd.tif
  Usage: NASA educational/informational reuse with source credit; no endorsement.
  Changes: gray.

## Reconstructed content

Procedural terrain, unresolved surface detail, contact-binary geometry, cloud evolution, and ring fine structure are visual reconstructions. They are not claimed as new observations.
