"""Fetch permitted maps and build a self-contained, auditable material manifest.

Run with system Python, Pillow, and NumPy. Downloads and derivatives stay in the
project. Original bytes are retained. No source map is treated as a height map.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import re
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = 500_000_000
ROOT = Path(__file__).resolve().parents[1]
NASA_USE = "https://www.nasa.gov/nasa-brand-center/images-and-media/"
JPL_USE = "https://www.jpl.nasa.gov/jpl-image-use-policy/"
SSS = "https://www.solarsystemscope.com/textures/"
OPAL = "https://archive.stsci.edu/hlsps/opal/cycle30/"
OPAL_ACK = (
    "This work used data acquired from the NASA/ESA HST Space Telescope, "
    "associated with OPAL program (PI: Simon, GO13937), and archived by the "
    "Space Telescope Science Institute, which is operated by the Association "
    "of Universities for Research in Astronomy, Inc., under NASA contract "
    "NAS 5-26555. All maps are available at http://dx.doi.org/10.17909/T9G593."
)
NAMES = (
    "Sun Mercury Venus Earth Mars Jupiter Saturn Uranus Neptune Ceres Pluto "
    "Haumea Makemake Eris Orcus Quaoar Gonggong Sedna Salacia Varda Varuna Ixion "
    "Moon Phobos Deimos Io Europa Ganymede Callisto Amalthea Thebe Himalia Elara "
    "Mimas Enceladus Tethys Dione Rhea Titan Hyperion Iapetus Phoebe Janus "
    "Epimetheus Miranda Ariel Umbriel Titania Oberon Puck Triton Nereid Proteus "
    "Charon Styx Nix Kerberos Hydra Vesta Pallas Hygiea Eros Itokawa Bennu Ryugu "
    "Arrokoth Chariklo Chiron"
).split() + ["1P/Halley", "2P/Encke", "67P/Churyumov-Gerasimenko"]
ALIASES = {"1p-halley": "halley", "2p-encke": "encke",
           "67p-churyumov-gerasimenko": "churyumov-gerasimenko"}

# Values are approximate linear reflectance ranges, not measured texture pixels.
# Each unresolved body has its own seed, contrast, and composition constraint.
PROFILES = {
    "sun": ("photosphere", [1, .91, .76], .03, "5772 K photosphere; granulation is a reconstruction, not dated activity."),
    "mercury": ("regolith", [.11, .10, .09], .16, "Dark silicate regolith; monochrome MDIS morphology, not false-color mineral classes."),
    "venus": ("cloud", [.76, .73, .62], .025, "Opaque sulfuric-acid cloud deck; visible contrast much lower than ultraviolet contrast."),
    "earth": ("earth", [.15, .19, .24], .05, "Blue Marble surface, separate water clouds, ocean Fresnel response."),
    "mars": ("regolith", [.24, .11, .055], .18, "Iron-oxide dust over darker basaltic terrain."),
    "jupiter": ("gas", [.52, .43, .32], .02, "Observed Hubble cloud bands; no solid rock surface."),
    "saturn": ("gas", [.58, .49, .34], .015, "Observed Hubble ammonia-cloud envelope beneath hydrocarbon haze."),
    "uranus": ("gas", [.39, .60, .62], .008, "Methane absorption, pale cyan visible envelope; observed polar haze."),
    "neptune": ("gas", [.31, .48, .60], .012, "Methane absorption; observed Hubble color, not Voyager's exaggerated deep blue."),
    "ceres": ("carbonaceous", [.085, .080, .074], .14, "Dark hydrated minerals and carbonates; bright salts occur locally."),
    "pluto": ("volatile", [.55, .40, .29], .08, "Nitrogen and methane frost with reddish organic material; New Horizons partial coverage."),
    "haumea": ("ice", [.65, .67, .69], .05, "Crystalline water ice; unlocated modest reddish patch is not fabricated."),
    "makemake": ("volatile", [.55, .33, .21], .08, "Methane-rich frost and red irradiation products; unresolved geography."),
    "eris": ("volatile", [.84, .85, .86], .018, "Bright methane frost; little observed rotational contrast."),
    "orcus": ("ice", [.22, .23, .24], .055, "Neutral-colored water ice and darker material."),
    "quaoar": ("volatile", [.20, .13, .095], .08, "Reddish surface with water ice and methane signatures."),
    "gonggong": ("volatile", [.16, .075, .045], .10, "Very red volatile-rich body; broad color constraints only."),
    "sedna": ("organic", [.27, .12, .065], .09, "Strong red spectral slope and probable volatile ices."),
    "salacia": ("ice", [.043, .046, .048], .055, "Dark neutral trans-Neptunian surface."),
    "varda": ("ice", [.095, .079, .067], .065, "Moderately red unresolved trans-Neptunian surface."),
    "varuna": ("ice", [.13, .092, .067], .09, "Red water-ice-bearing surface."),
    "ixion": ("organic", [.15, .085, .060], .075, "Red trans-Neptunian irradiation products; no resolved terrain."),
    "moon": ("regolith", [.13, .12, .11], .10, "LROC photometric color composite and LOLA measured elevation."),
    "phobos": ("carbonaceous", [.071, .059, .050], .11, "Very dark reddish dusty regolith."),
    "deimos": ("carbonaceous", [.070, .059, .050], .06, "Dark smooth dust-covered surface."),
    "io": ("sulfur", [.62, .48, .20], .09, "Sulfur and sulfur-dioxide deposits with volcanic dark terrain."),
    "europa": ("ice", [.65, .61, .51], .06, "Water-ice crust and darker irradiated non-ice material."),
    "ganymede": ("ice", [.34, .30, .24], .07, "Mixed ice and dark ancient terrain."),
    "callisto": ("ice", [.16, .14, .12], .08, "Dark ancient cratered ice-rock crust."),
    "amalthea": ("organic", [.095, .037, .020], .14, "Very red porous surface irradiated in Jupiter's environment."),
    "thebe": ("organic", [.063, .039, .028], .14, "Dark reddish inner Jovian moon."),
    "himalia": ("carbonaceous", [.052, .048, .042], .075, "Dark C-type irregular satellite."),
    "elara": ("carbonaceous", [.043, .040, .036], .065, "Dark neutral-to-red irregular satellite."),
    "mimas": ("ice", [.63, .61, .57], .05, "Water ice with dark contaminants; Voyager mosaic."),
    "enceladus": ("ice", [.88, .90, .91], .025, "Fresh reflective water ice; rough diffuse ice, not polished glass."),
    "tethys": ("ice", [.75, .74, .70], .04, "Bright water ice with weak color variation."),
    "dione": ("ice", [.58, .56, .52], .06, "Icy terrain and darker trailing-hemisphere deposits."),
    "rhea": ("ice", [.62, .60, .56], .055, "Cratered water ice with darker contaminants."),
    "titan": ("haze", [.38, .23, .095], .015, "Opaque nitrogen-methane atmosphere with orange photochemical haze; surface hidden."),
    "hyperion": ("ice", [.22, .17, .12], .12, "Porous dirty water ice; no invented measured crater layout."),
    "iapetus": ("ice", [.23, .21, .18], .12, "Observed dark leading hemisphere and brighter icy terrain."),
    "phoebe": ("carbonaceous", [.07, .065, .060], .13, "Dark carbon-rich irregular satellite."),
    "janus": ("ice", [.46, .43, .38], .065, "Dusty water ice on an irregular inner satellite."),
    "epimetheus": ("ice", [.54, .51, .46], .055, "Pale dusty water ice."),
    "miranda": ("ice", [.29, .29, .28], .07, "Voyager-observed southern hemisphere; northern terrain unresolved."),
    "ariel": ("ice", [.39, .38, .36], .06, "Bright icy crust, Voyager partial coverage."),
    "umbriel": ("ice", [.18, .18, .18], .045, "Dark neutral icy crust, Voyager partial coverage."),
    "titania": ("ice", [.28, .26, .24], .065, "Slightly red icy crust, Voyager partial coverage."),
    "oberon": ("ice", [.24, .21, .19], .07, "Redder icy crust, Voyager partial coverage."),
    "puck": ("carbonaceous", [.105, .102, .10], .10, "Dark neutral inner Uranian satellite."),
    "triton": ("volatile", [.70, .65, .61], .04, "Nitrogen frost, water ice and reddish photolysis products."),
    "nereid": ("ice", [.16, .15, .14], .055, "Water-ice-bearing irregular satellite; unresolved geology."),
    "proteus": ("carbonaceous", [.085, .082, .079], .085, "Dark neutral irregular icy satellite."),
    "charon": ("ice", [.35, .34, .33], .055, "Water ice and ammonia-bearing compounds; observed New Horizons morphology."),
    "styx": ("ice", [.49, .50, .51], .04, "Bright neutral Pluto-system water ice; unresolved texture."),
    "nix": ("ice", [.54, .55, .56], .055, "Bright icy Pluto satellite; local red patch location not reconstructed."),
    "kerberos": ("ice", [.55, .56, .57], .04, "Reflective water-ice surface; no resolved global map."),
    "hydra": ("ice", [.70, .71, .73], .035, "Reflective crystalline water ice."),
    "vesta": ("regolith", [.33, .28, .23], .11, "Differentiated basaltic crust; Dawn clear-filter observations."),
    "pallas": ("carbonaceous", [.14, .15, .16], .075, "B-type hydrated dark material with bluish spectral slope."),
    "hygiea": ("carbonaceous", [.070, .066, .061], .065, "Dark C-type carbonaceous surface."),
    "eros": ("silicate", [.24, .17, .11], .11, "Weathered S-type silicate regolith."),
    "itokawa": ("silicate", [.25, .20, .15], .10, "Ordinary-chondrite-like silicates; gravel and boulder texture is statistical."),
    "bennu": ("carbonaceous", [.043, .045, .047], .10, "B-type carbonaceous rubble with weak blue slope."),
    "ryugu": ("carbonaceous", [.043, .041, .039], .095, "Very dark hydrated carbonaceous rubble."),
    "arrokoth": ("organic", [.13, .064, .037], .06, "Uniform red cold-classical surface; no fake global map."),
    "chariklo": ("organic", [.052, .039, .030], .075, "Dark reddish centaur with water-ice signatures."),
    "chiron": ("carbonaceous", [.075, .071, .067], .055, "Neutral dark centaur; uncertain activity left off."),
    "halley": ("comet", [.036, .029, .025], .085, "Very dark refractory comet crust; no speculative coma."),
    "encke": ("comet", [.047, .037, .029], .08, "Dark reddish comet nucleus; unresolved global texture."),
    "churyumov-gerasimenko": ("comet", [.060, .047, .039], .105, "Dark organic-rich dusty nucleus; no speculative activity."),
}


def slug(name):
    key = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return ALIASES.get(key, key)


def source(body, role, url, page, credit, **kwargs):
    result = dict(body=body, role=role, source_url=url, source_page=page,
                  credit=credit, usage="NASA educational/informational reuse with source credit; no endorsement.",
                  rights_url=NASA_USE, max_width=4096, color_space="sRGB",
                  projection="equirectangular", north_up=True,
                  longitude="east increasing; center longitude 0 degrees",
                  transform="copy", source_status="MIXED")
    result.update(kwargs)
    return result


def specifications():
    records = []
    moon = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/"
    records += [
        source("earth", "color", "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_8192.png",
               "https://svs.gsfc.nasa.gov/2915/", "NASA/GSFC, Reto Stockli, Blue Marble",
               max_width=8192, notes="Cloud-free multi-date composite; sea ice is static, not a forecast."),
        source("earth", "clouds", "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57747/cloud_combined_2048.jpg",
               "https://earthobservatory.nasa.gov/features/BlueMarble/", "NASA/GSFC Blue Marble",
               color_space="Non-Color", notes="Observed cloud composite interpreted as approximate opacity. Not cloud optical-depth retrieval or 2026 weather."),
        source("moon", "color", moon + "lroc_color_16bit_srgb_4k.tif", "https://svs.gsfc.nasa.gov/4720/",
               "NASA/GSFC/Arizona State University, LROC, Ernie Wright",
               notes="2025 color processing, polar LOLA albedo fill and small inpainted dropouts. Optimized for visualization."),
        source("moon", "height", moon + "ldem_16.tif", "https://svs.gsfc.nasa.gov/4720/",
               "NASA/GSFC/MIT, LOLA science team, Ernie Wright",
               color_space="Non-Color", transform="height", source_status="OBSERVED",
               units="km relative to radius 1737.4 km", notes="Measured LOLA elevation. No artistic height amplification."),
        source("mercury", "color", SSS+"download/8k_mercury.jpg", SSS,
               "Solar System Scope / INOVE, NASA MESSENGER-derived imagery",
               usage="CC BY 4.0. Attribution required; adapted with resizing and reflectance normalization.",
               rights_url="https://creativecommons.org/licenses/by/4.0/", transform="gray",
               notes="NASA-derived edited Mercury mosaic. Publisher discloses cosmetic gap fill. Original JHUAPL low-incidence source timed out; not an unmodified MDIS scientific product."),
        source("ceres", "color", "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif",
               "https://sbn.psi.edu/pds/resource/dawn/dwncfcmosaics.html",
               "NASA/JPL-Caltech/UCLA/MPS/DLR/IDA/USGS, Thomas Roatsch and Dawn FC team",
               transform="gray", fill_dark=True, roll_half=True,
               readme_url="https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Ceres_Dawn_FC_DLR_global_20ppd_Oct2015_pds3.lbl",
               notes="Dawn FC clear-filter 2015 global mosaic, 400 m/pixel. Measured morphology with approximate neutral reflectance."),
        source("pluto", "color", "https://assets.science.nasa.gov/content/dam/science/psd/solar/2023/09/p/l/pluto_color_mapmosaic.jpg",
               "https://science.nasa.gov/resource/pluto-global-color-map/",
               "NASA/Johns Hopkins University Applied Physics Laboratory/Southwest Research Institute",
               transform="pluto", roll_half=True,
               longitude="east increasing; center longitude 180 degrees, Sputnik Planitia near center",
               notes="2015 MVIC color mosaic. Northern/equatorial coverage only; unknown southern latitudes reconstructed."),
        source("charon", "color", "https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia/pia19/pia19866/PIA19866.jpg",
               "https://science.nasa.gov/photojournal/global-map-of-plutos-moon-charon/",
               "NASA/Johns Hopkins University Applied Physics Laboratory/Southwest Research Institute",
               transform="gray", fill_dark=True, notes="2015 LORRI grayscale mosaic. Black no-data areas replaced with neutral ice reconstruction; no invented polar color."),
        source("vesta", "color", "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Vesta_Dawn_FC_HAMO_Mosaic_Global_74ppd.tif",
               "https://astrogeology.usgs.gov/search/map/vesta_dawn_fc_hamo_global_mosaic_74ppd",
               "NASA/JPL-Caltech/UCLA/MPS/DLR/IDA/USGS", transform="gray", fill_dark=True,
               original_name="vesta_hamo_color.tif",
               notes="Dawn HAMO clear-filter global mosaic. Source lighting and photometric processing remain; neutral basaltic reflectance approximation."),
    ]
    for body, year, rot, filters, flatten in [
        ("saturn", 2023, "b", "f395n-f502n-f631n", 60268/54364),
        ("uranus", 2022, "a", "f467m-f547m-f657n", 25559/24973),
        ("neptune", 2023, "b", "f467m-f547m-f657n", 24764/24341),
    ]:
        records.append(source(
            body, "color", f"{OPAL}{body}/hlsp_opal_hst_wfc3-uvis_{body}-{year}{rot}_{filters}_v1_globalmap.tif",
            "https://archive.stsci.edu/hlsp/opal", "NASA/ESA HST, Amy Simon and OPAL team; STScI/AURA",
            transform="opal", flattening_ratio=flatten, flip_x=(body == "uranus"), roll_half=True,
            observation_year=year, fill_dark=True, acknowledgement=OPAL_ACK,
            readme_url=f"{OPAL}{body}/hlsp_opal_hst_wfc3-uvis_{body}-{year}_all_v1_readme.txt",
            notes="Observed RGB filter composite, arbitrary display stretch and Minnaert correction. Missing poles/coverage reconstructed. Static weather, not a forecast.",
        ))
    records.append(source(
        "jupiter", "color",
        "https://svs.gsfc.nasa.gov/vis/a010000/a012000/a012021/Hubble_Jupiter_color_global_map_2015a.tif",
        "https://svs.gsfc.nasa.gov/12021/", "NASA/GSFC, NASA/ESA HST, Amy Simon, Michael Wong, Glenn Orton",
        transform="opal", flattening_ratio=71492/66854, roll_half=True, fill_dark=True,
        original_name="jupiter_2015_color.tif", observation_year=2015, acknowledgement=OPAL_ACK,
        notes="2015 Hubble OPAL RGB map. Polar gaps reconstructed. Historical Great Red Spot, not its 2026 position or shape.",
    ))
    sss_credit = "Solar System Scope / INOVE, based on NASA imagery"
    for body, role, filename, space in [
        ("venus", "color", "4k_venus_atmosphere.jpg", "sRGB"),
        ("earth", "ocean_mask", "8k_earth_specular_map.tif", "Non-Color"),
        ("earth", "night", "8k_earth_nightmap.jpg", "sRGB"),
    ]:
        records.append(source(
            body, role, SSS+"download/"+filename, SSS, sss_credit,
            usage="CC BY 4.0. Attribution required; adapted with resizing and Venus desaturation.",
            rights_url="https://creativecommons.org/licenses/by/4.0/",
            color_space=space, transform="venus" if body == "venus" else "copy",
            notes="NASA-derived edited composite. Publisher discloses saturated colors and fictional gap fill; not an unmodified scientific product.",
        ))
    for body, system, filename in [
        ("phobos", "mars", "mar1kuu2"),
        ("deimos", "mars", "mar2kuu2"), ("io", "jupiter", "jup1vss2"),
        ("europa", "jupiter", "jup2vuu2"), ("ganymede", "jupiter", "jup3vuu2"),
        ("callisto", "jupiter", "jup4vuu2"), ("mimas", "saturn", "sat1vuu2"),
        ("enceladus", "saturn", "sat2vuu2"), ("tethys", "saturn", "sat3vuu2"),
        ("dione", "saturn", "sat4vuu2"), ("rhea", "saturn", "sat5vuu2"),
        ("iapetus", "saturn", "sat8vuu2"), ("ariel", "uranus", "ura1vuu2"),
        ("umbriel", "uranus", "ura2vuu2"), ("titania", "uranus", "ura3vuu2"),
        ("oberon", "uranus", "ura4vuu2"), ("miranda", "uranus", "ura5vuu2"),
        ("triton", "neptune", "nep1vuu2"),
    ]:
        records.append(source(
            body, "color", f"https://space.jpl.nasa.gov/tmaps/pix/{filename}.jpg",
            f"https://space.jpl.nasa.gov/tmaps/{system}.html",
            "NASA/JPL/Caltech/USGS; Io color processing by David Seal",
            rights_url=JPL_USE, fill_dark=True,
            transform="copy" if body in {"mars", "io", "triton"} else "gray",
            longitude="Legacy JPL/USGS map convention retained. Absolute prime-meridian registration not verified.",
            notes="Viking/Voyager-era observed mosaic. Uneven resolution, illumination residuals and gaps. Neutral regolith/ice fills in no-data areas; no upscaling or invented measured topography.",
        ))
    records.append(source(
        "mars", "color", SSS+"download/8k_mars.jpg", SSS,
        "Solar System Scope / INOVE, NASA Viking and Mars imagery",
        original_name="mars_scope_color.jpg",
        usage="CC BY 4.0. Attribution required; adapted by resizing and approximate reflectance normalization.",
        rights_url="https://creativecommons.org/licenses/by/4.0/",
        notes="NASA-derived edited mosaic. Publisher discloses color tuning and fictional gap fill. Not an unmodified photometric map.",
    ))
    upgraded = {
        "io": ("Io_GalileoSSI-Voyager_Global_Mosaic_ClrMerge_1km.tif", "copy"),
        "europa": ("Europa_Voyager_GalileoSSI_global_mosaic_500m.tif", "gray"),
        "ganymede": ("Ganymede_Voyager_GalileoSSI_Global_ClrMosaic_1435m.tif", "copy"),
        "callisto": ("Callisto_Voyager_GalileoSSI_global_mosaic_1km.tif", "gray"),
        "enceladus": ("Enceladus_Cassini_ISS_Global_Mosaic_100m_HPF.tif", "gray"),
        "tethys": ("Tethys_Cassini_mosaic_global_293m.tif", "gray"),
        "rhea": ("Rhea_Cassini_Voyager_mosaic_global_417m.tif", "gray"),
        "iapetus": ("Iapetus_Cassini_Voyager_mosaic_global_783m.tif", "gray"),
    }
    for record in records:
        if record["body"] in upgraded and record["role"] == "color":
            filename, transform = upgraded[record["body"]]
            record.update(
                source_url="https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/"+filename,
                source_page="https://astrogeology.usgs.gov/search",
                credit="NASA/JPL/Caltech/USGS; Galileo, Voyager and Cassini imaging teams",
                original_name=record["body"]+"_usgs_color.tif", transform=transform,
                usage="USGS/PDS public-use scientific mosaic; retain mission and processing-team attribution.",
                rights_url="https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
                notes="USGS mission-image global mosaic with heterogeneous source resolution and illumination. RGB merge products use processed color. Approximate reflectance, not measured BRDF.",
            )
            record["roll_half"] = record["body"] in {"europa", "ganymede", "callisto", "enceladus"}
            record["longitude"] = (
                "East increases to raster right. West-positive source coordinate labels decrease to right. "
                + ("Raster spans 0 to 360 east; shifted 180 degrees."
                   if record["roll_half"] else "Raster spans -180 to 180 east; no shift.")
            )
            record["readme_url"] = record["source_url"].replace(
                ".tif", ".lbl" if record["body"] == "enceladus" else "_pds3.lbl")
    return records


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b""):
            h.update(chunk)
    return h.hexdigest()


def retrieve(url, path):
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".part")
    for attempt in range(3):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "SolarSystemEducationalAssets/1.0"})
            with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as output:
                if "text/html" in response.headers.get("Content-Type", ""):
                    raise ValueError(f"HTML returned for image: {url}")
                while chunk := response.read(1024*1024):
                    output.write(chunk)
            with Image.open(partial) as image:
                image.verify()
            partial.replace(path)
            return
        except Exception:
            partial.unlink(missing_ok=True)
            if attempt == 2:
                subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error",
                                "--max-time", "300", url, "--output", str(partial)], check=True)
                with Image.open(partial) as image:
                    image.verify()
                partial.replace(path)
                return
            time.sleep(2 ** attempt)


def prepare(spec):
    raw = ROOT/"textures"/"originals"/spec.get(
        "original_name", spec["body"]+"_"+spec["role"]+Path(spec["source_url"]).suffix)
    retrieve(spec["source_url"], raw)
    Image.MAX_IMAGE_PIXELS = 500_000_000
    image = Image.open(raw)
    original_size = list(image.size)
    width = min(spec["max_width"], image.width)
    height = round(image.height * width/image.width)
    mode = spec["transform"]
    if mode == "height":
        image = image.resize((width, height), Image.Resampling.BILINEAR)
        out = ROOT/"textures"/(spec["body"]+"_height_km.tif")
        image.save(out)
        coverage = 1.
    else:
        image.thumbnail((width, height), Image.Resampling.LANCZOS)
        image = image.convert("RGB")
        if mode == "pluto":
            # The published color raster already includes a black southern cap.
            spec["fill_dark"] = True
        if spec.get("flip_x"):
            image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        a = np.asarray(image).astype(np.float32)/255.
        if mode == "opal" and a.shape[:2] == (361, 721):
            a = (a[:-1, :-1] + a[1:, :-1] + a[:-1, 1:] + a[1:, 1:])*.25
            spec["inclusive_grid_conversion"] = "721x361 endpoint grid averaged to 720x360 cell centers before longitude shift."
        if spec.get("roll_half"):
            a = np.roll(a, a.shape[1]//2, axis=1)
        if mode == "opal":
            # Convert planetographic map latitude to scaled-UV-sphere latitude.
            t = np.pi/2 - (np.arange(a.shape[0])+.5)/a.shape[0]*np.pi
            lat = np.arctan(spec["flattening_ratio"] * np.tan(t))
            sy = np.clip((np.pi/2-lat)/np.pi*a.shape[0]-.5, 0, a.shape[0]-1)
            y0 = sy.astype(int)
            y1 = np.minimum(y0+1, a.shape[0]-1)
            w = (sy-y0)[:, None, None]
            a = a[y0]*(1-w)+a[y1]*w
        valid = (a.max(axis=2) > .018).astype(np.float32)
        if mode == "opal":
            latitude = 90 - (np.arange(a.shape[0])+.5)/a.shape[0]*180
            good_latitude = {
                "jupiter": (latitude > -74) & (latitude < 76),
                "saturn": (latitude > -52) & (latitude < 76) & ~((latitude > -21) & (latitude < 5)),
                "uranus": latitude > -12,
                "neptune": (latitude < 30) & (latitude > -72),
            }[spec["body"]]
            valid *= good_latitude[:, None] * (a.min(axis=2) > .035)
        coverage = float(valid.mean())
        if mode == "gray":
            a = np.repeat(a.mean(axis=2, keepdims=True), 3, axis=2)
        if mode == "venus":
            lum = a.mean(axis=2, keepdims=True)
            a = .87 + .055 * (lum-lum.mean())
            a = np.repeat(a, 3, axis=2)*np.array([1., .982, .925])
        if spec["role"] == "color" and spec["body"] not in {"earth", "moon", "venus"}:
            linear = np.where(a <= .04045, a/12.92, ((a+.055)/1.055)**2.4)
            median = np.median(linear[valid > .5], axis=0) if valid.any() else np.ones(3)
            target = np.array(PROFILES[spec["body"]][1])
            if mode == "gray" or spec["body"] in {"saturn", "uranus", "neptune"}:
                gain = target/np.maximum(median, .001)
            else:
                gain = target.mean()/max(median.mean(), .001)
            linear = np.clip(linear*gain, 0, .97)
            if spec["body"] == "saturn":
                neutral = linear.mean(axis=2, keepdims=True)*(target/target.mean())
                linear = .22*linear + .78*neutral
                spec["visible_color_note"] = "Suppressed narrow-band preview chroma to approximate pale visible Saturn colors. Band brightness remains observation-derived; color is reconstructed."
            a = np.where(linear <= .0031308, 12.92*linear, 1.055*linear**(1/2.4)-.055)
            spec["radiometric_treatment"] = "Display RGB normalized to approximate reflectance palette. Gray maps tinted by composition; OPAL ice-giant preview channels chromatically normalized. Not measured spectral reflectance or BRDF."
        if spec.get("fill_dark"):
            # A low-contrast neutral fill cannot be mistaken for observed geology.
            color = np.array(PROFILES[spec["body"]][1])
            srgb = np.where(color <= .0031308, 12.92*color, 1.055*color**(1/2.4)-.055)
            if mode == "opal":
                usable_rows = np.flatnonzero(valid.mean(axis=1) > .5)
                medians = {row: np.median(a[row, valid[row] > .5], axis=0) for row in usable_rows}
                for row in range(a.shape[0]):
                    good = valid[row] > .5
                    if usable_rows.size:
                        # Interpolate only latitude means where observations are missing.
                        fill = np.array([np.interp(row, usable_rows, [medians[r][c] for r in usable_rows]) for c in range(3)])
                    else:
                        fill = srgb
                    a[row, ~good] = fill
                spec["coverage_mask_note"] = "Conservative latitude masks exclude unobserved limbs, unstable color at coverage edges, and Saturn ring contamination. Missing rows contain interpolated latitude means, not invented storms."
            else:
                a[valid < .5] = srgb
            coverage_path = ROOT/"textures"/(spec["body"]+"_coverage.png")
            Image.fromarray((valid*255).astype(np.uint8)).save(coverage_path)
            spec["coverage_path"] = str(coverage_path.relative_to(ROOT))
            spec["coverage_sha256"] = digest(coverage_path)
        out = ROOT/"textures"/(spec["body"]+"_"+spec["role"]+".png")
        Image.fromarray((np.clip(a, 0, 1)*255+.5).astype(np.uint8)).save(out, optimize=True)
    result = dict(spec)
    result.update(path=str(out.relative_to(ROOT)), sha256=digest(out),
                  original_path=str(raw.relative_to(ROOT)), original_sha256=digest(raw),
                  original_dimensions=original_size, dimensions=list(Image.open(out).size),
                  valid_pixel_fraction_before_fill=coverage,
                  retrieved_utc=datetime.now(timezone.utc).isoformat(),
                  output_longitude="center 0 degrees" if spec.get("roll_half") else spec["longitude"])
    print(f"{spec['body']}/{spec['role']}: {result['dimensions']}", flush=True)
    return result


def verify_asset_files(root=ROOT):
    root = Path(root)
    manifest = json.loads((root/"data"/"asset_manifest.json").read_text())
    checked = []
    errors = []
    Image.MAX_IMAGE_PIXELS = 500_000_000
    for key, body in manifest["bodies"].items():
        for role, record in body["maps"].items():
            for path_field, hash_field in (("path", "sha256"), ("original_path", "original_sha256"),
                                          ("coverage_path", "coverage_sha256")):
                if path_field not in record:
                    continue
                path = root/record[path_field]
                try:
                    if digest(path) != record[hash_field]:
                        raise ValueError("SHA-256 mismatch")
                    with Image.open(path) as image:
                        dimensions = list(image.size)
                        image_format = image.format
                        image.verify()
                    checked.append(dict(path=record[path_field], format=image_format, dimensions=dimensions))
                except Exception as error:
                    errors.append(dict(body=key, role=role, path=str(path), error=str(error)))
    validation_path = root/"data"/"material_validation.json"
    validation = json.loads(validation_path.read_text()) if validation_path.exists() else {}
    validation["asset_integrity"] = dict(checked_utc=datetime.now(timezone.utc).isoformat(),
                                        checked_file_count=len(checked), files=checked, errors=errors)
    validation_path.write_text(json.dumps(validation, indent=2)+"\n")
    print(f"Verified {len(checked)} image files and SHA-256 hashes; {len(errors)} errors")
    if errors:
        raise SystemExit(1)


def annotate_uv_registration(record):
    body = record["body"]
    shifted = {"ceres", "pluto", "europa", "ganymede", "callisto", "enceladus",
               "jupiter", "saturn", "uranus", "neptune"}
    native_zero = {"earth", "moon", "io", "tethys", "rhea", "iapetus", "vesta", "charon"}
    references = [record.get("readme_url", record["source_page"])]
    status = "SOURCE_DOCUMENTED"
    center = 0.
    note = "Prepared raster center is longitude 0. Source transforms are already baked into the image."
    if body in shifted:
        note += " The source spanned 0 to 360 degrees and was shifted by half a width."
    elif body not in native_zero:
        if body in {"mercury", "mars"}:
            status = "LANDMARK_CHECKED"
            references = ["https://planetarynames.wr.usgs.gov/Feature/"+("14644" if body == "mercury" else "4453")]
            note = ("Central-zero orientation checked against Hokusai's northern position just east of the prime meridian."
                    if body == "mercury" else
                    "Central-zero orientation checked against Olympus Mons at about 226 degrees east and U=0.128.")
            note += " This is a convention check, not a pixel-accurate cartographic registration."
        elif body == "venus":
            status = "UNCONSTRAINED_WEATHER"
            center = None
            note = "No dated meridian phase is available for the edited cloud pattern. Nominal U=.5 is a visualization reference, not measured surface registration."
        else:
            status = "UNVERIFIED_LEGACY_MERIDIAN"
            center = None
            note = "JPL's legacy mosaic page does not establish this raster's prime-meridian phase. Native orientation is retained with nominal zero offset. Do not claim registration to the IAU meridian."
    if body == "jupiter":
        record["readme_url"] = "https://archive.stsci.edu/hlsps/opal/cycle22/jupiter/hlsp_opal_hst_wfc3-uvis_jupiter-2015_all_v2_readme.txt"
        references = [record["readme_url"]]
    if body == "uranus":
        note += " East-increasing-left source columns were flipped before the half-width shift."
    if body == "rhea":
        note += " The ISIS source has center-longitude parameter 180 but upper-left X=0; the actual raster center is longitude 0."
    if body == "pluto":
        status = "LANDMARK_CHECKED"
        note += " Convention checked from Sputnik Planitia near the source map center. This is not a pixel-accurate frame fit."
    if body == "vesta":
        status = "UNVERIFIED_FRAME_ALIGNMENT"
        note = "Raster center is source longitude 0, but the 2013 DLR product label does not identify which Vesta prime-meridian frame it uses. Do not assume its zero equals the caller's IAU frame. No unverified frame correction was invented."
        label = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Vesta_Dawn_FC_HAMO_Mosaic_Global_74ppd_pds3.lbl"
        record["readme_url"] = label
        record["source_page"] = label
        references = [label]
    if body == "earth" and record["role"] in {"ocean_mask", "night"}:
        status = "GEOGRAPHIC_ALIGNMENT_CHECKED"
        note = "Aligned with the central-zero NASA surface map. Denver and Tokyo city-light positions, Pacific ocean pixels and Sahara land pixels were checked."
    record["uv_registration"] = dict(
        status=status, raster_center_east_deg=center,
        u_scale=1., v_scale=1., u_offset_cycles=0., v_offset_cycles=0.,
        source_transforms_already_baked=True, reference_urls=references, note=note)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", nargs="*", help="Prepare selected body slugs and preserve other manifest entries.")
    parser.add_argument("--verify-only", action="store_true", help="Check exact cached bytes and image formats without networking.")
    args = parser.parse_args()
    if args.verify_only:
        verify_asset_files()
        return
    (ROOT/"textures"/"originals").mkdir(parents=True, exist_ok=True)
    (ROOT/"data").mkdir(exist_ok=True)
    manifest_path = ROOT/"data"/"asset_manifest.json"
    previous = json.loads(manifest_path.read_text()) if args.only and manifest_path.exists() else {}
    bodies = previous.get("bodies", {})
    for alias, canonical in ALIASES.items():
        if alias in bodies:
            bodies[canonical] = bodies.pop(alias)
    for name in NAMES:
        key = slug(name)
        kind, color, contrast, description = PROFILES[key]
        bodies.setdefault(key, dict(name=name, source_status="RECONSTRUCTION", maps={},
            profile=dict(kind=kind, linear_reflectance=color, contrast=contrast,
                         seed=int(hashlib.sha256(key.encode()).hexdigest()[:8], 16)),
            description=description,
            references=["https://science.nasa.gov/solar-system/",
                        "https://ssd.jpl.nasa.gov/planets/phys_par.html"]))
    specs = [s for s in specifications() if not args.only or s["body"] in args.only]
    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        jobs = {executor.submit(prepare, s): s for s in specs}
        for job in concurrent.futures.as_completed(jobs):
            s = jobs[job]
            try:
                record = job.result()
                bodies[s["body"]]["maps"][s["role"]] = record
                bodies[s["body"]]["source_status"] = "MIXED"
            except Exception as error:
                failures.append(dict(body=s["body"], role=s["role"], source_url=s["source_url"], error=str(error)))
                print("FAILED", s["body"], s["role"], error, flush=True)
    all_maps = [record for body in bodies.values() for record in body["maps"].values()]
    for record in all_maps:
        annotate_uv_registration(record)
        if "coverage_path" in record:
            record["coverage_interpretation"] = (
                "Conservative visualization mask based on near-black pixels and, for OPAL, latitude limits. "
                "Not a mission-supplied validity product. Some dark or shadowed pixels may be reconstructed."
            )
    texture_pixels = sum(record["dimensions"][0]*record["dimensions"][1] for record in all_maps)
    manifest = dict(schema_version=1, bodies=bodies, body_id_aliases=ALIASES, failures=failures,
        schema="bodies[slug].maps[role] -> map record; roles color/clouds/ocean_mask/night/height. Paths relative to project root.",
        uv_contract=dict(
            surface="Blender uv_sphere UVMap. North +Z and V=1. Do not flip V; Blender image loader handles top-down raster storage.",
            longitude="Geometry +X must be the IAU prime meridian at UV (.5,.5). Documented prepared maps have longitude 0 at U=.5, east increasing right. Never reapply baked roll_half/flip_x transforms. Per-map uv_registration records shader offsets and explicit legacy registration uncertainty.",
            gas_latitude="OPAL planetographic rows resampled to scaled-sphere parametric latitude using source equatorial/polar radii.",
            rings="U=angular fraction, V=normalized radius independently within each band. Ring material reads UVMap Y. Caller meshes define edges and gaps.",
            cloud_orientation="Earth cloud map matches Earth surface UV and pole orientation. It is a static historical composite."),
        material_api=dict(
            surface="make_surface_material(body, asset_manifest, asset_root)",
            clouds="make_cloud_material(body, manifest, root). Earth shell +8 km; Venus opaque cloud shell +65 km.",
            atmosphere="make_atmosphere_material(body). Center object origin on body center. Radius input is in km.",
            rings="make_ring_material(body). Accepts ring_name, ring_optical_depth, ring_inner_km, ring_outer_km. Caller optical depth overrides fallback profiles. Alpha follows 1-exp(-tau/abs(dot(N,Incoming))) with a 1e-6 denominator epsilon and a stable thin-ring series. Fine patterns affect color only. Legacy ring_profile remains supported.",
            earth_night="Off until body.sun_direction_world is supplied or Solar direction world XYZ node inputs are animated. World vector points body-to-Sun.",
            scale="All materials default to 1000 km per Blender unit; body.km_per_unit can override.",
            image_uv="maps[role].uv_registration supplies u_scale, v_scale, u_offset_cycles and v_offset_cycles. Shader applies U'=fract(u_scale*U+u_offset_cycles), V'=v_scale*V+v_offset_cycles and clamps latitude sampling. Default north is +Z/V=1.",
            caching="Surfaces cached by body.id and role. Rings additionally use ring_name and a parameter fingerprint, so changing a band's optical depth or radii never reuses stale shader data."),
        inventory=dict(
            body_count=len(bodies), mapped_body_count=sum(bool(b["maps"]) for b in bodies.values()),
            map_count=len(all_maps), active_image_pixels=texture_pixels,
            rgba8_texture_budget_bytes=texture_pixels*4,
            original_file_bytes=sum((ROOT/r["original_path"]).stat().st_size for r in all_maps),
            derivative_file_bytes=sum((ROOT/r["path"]).stat().st_size for r in all_maps),
            unverified_meridian_bodies=[key for key, body in bodies.items()
                if body["maps"].get("color", {}).get("uv_registration", {}).get("status", "").startswith("UNVERIFIED")]),
        cautions=[
            "OBSERVED describes map provenance, not a calibrated bidirectional reflectance model.",
            "All current surfaces are conservatively MIXED when maps have fill, grayscale tint, color processing or empirical weather composites.",
            "No albedo map feeds bump or displacement. Only Moon LOLA height does.",
            "No map predicts the weather or surface activity during 2026-2027.",
            "Reconstructed material patterns are statistical reflectance variation, not claimed observed craters.",
            "Mosaic source lighting can remain. Low-resolution observed products are not upscaled.",
            "Coverage masks are conservative visualization estimates, not authoritative mission coverage products.",
            "IAU body spin does not establish the phase of legacy images with unverified meridian registration. Those surfaces retain a nominal orientation and must be labeled.",
        ],
        acknowledgements=[OPAL_ACK],
        excluded_sources=[
            {"url": "https://science.nasa.gov/3d-resources/neptune/", "reason": "Don Davis fictional map, not an observation."},
            {"url": "https://space.jpl.nasa.gov/tmaps/saturn.html", "reason": "Fictional Saturn map excluded; moon mosaics on same page are observed."},
            {"url": "https://planetarymaps.usgs.gov/mosaic/", "reason": "Initial Python requests returned 403. Official redirect discovered with curl; public USGS S3 host used for newer mosaics."},
        ])
    manifest_path.write_text(json.dumps(manifest, indent=2)+"\n")
    print(f"Manifest: {len(bodies)} bodies, {sum(len(b['maps']) for b in bodies.values())} maps, {len(failures)} download failures")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
