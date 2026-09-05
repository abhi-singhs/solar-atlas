#!/usr/bin/env python3
"""Retrieve the 71-body scientific catalog and serial Horizons state vectors."""

import argparse
import bisect
import csv
import datetime as dt
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api"
PCK_URL = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc"
LSK_URL = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls"
START_UTC = "2026-09-05T00:00:00+00:00"
STOP_UTC = "2027-09-05T00:00:00+00:00"
INTERVALS = 8760
NUMBER = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][-+]?\d+)?"


def body(slug, name, target, category, parent="sun", spice_id=None):
    if spice_id is None and target.isdigit():
        spice_id = int(target)
    return dict(id=slug, name=name, horizons_id=target, category=category,
                parent_id=parent, spice_id=spice_id, source_urls=[],
                physical_notes="")


def definitions():
    bodies = [body("sun", "Sun", "10", "star", None)]
    for name, number in [
        ("Mercury", 199), ("Venus", 299), ("Earth", 399), ("Mars", 499),
        ("Jupiter", 599), ("Saturn", 699), ("Uranus", 799), ("Neptune", 899),
    ]:
        bodies.append(body(name.lower(), name, str(number), "planet"))
    for name, number in [
        ("Ceres", 1), ("Pluto", 999), ("Haumea", 136108),
        ("Makemake", 136472), ("Eris", 136199),
        ("Orcus", 90482), ("Quaoar", 50000), ("Gonggong", 225088),
        ("Sedna", 90377), ("Salacia", 120347), ("Varda", 174567),
        ("Varuna", 20000), ("Ixion", 28978),
    ]:
        dwarf = name in {"Ceres", "Pluto", "Haumea", "Makemake", "Eris"}
        target = str(number) if name == "Pluto" else f"{number};"
        spice = number if name == "Pluto" else number + 2000000
        bodies.append(body(name.lower(), name, target,
                           "dwarf_planet" if dwarf else "dwarf_candidate",
                           spice_id=spice))
    systems = {
        "earth": [("Moon", 301)],
        "mars": [("Phobos", 401), ("Deimos", 402)],
        "jupiter": [("Io", 501), ("Europa", 502), ("Ganymede", 503),
                    ("Callisto", 504), ("Amalthea", 505), ("Thebe", 514),
                    ("Himalia", 506), ("Elara", 507)],
        "saturn": [("Mimas", 601), ("Enceladus", 602), ("Tethys", 603),
                   ("Dione", 604), ("Rhea", 605), ("Titan", 606),
                   ("Hyperion", 607), ("Iapetus", 608), ("Phoebe", 609),
                   ("Janus", 610), ("Epimetheus", 611)],
        "uranus": [("Miranda", 705), ("Ariel", 701), ("Umbriel", 702),
                   ("Titania", 703), ("Oberon", 704), ("Puck", 715)],
        "neptune": [("Triton", 801), ("Nereid", 802), ("Proteus", 808)],
        "pluto": [("Charon", 901), ("Styx", 905), ("Nix", 902),
                  ("Kerberos", 904), ("Hydra", 903)],
    }
    for parent, satellites in systems.items():
        bodies += [body(name.lower(), name, str(number), "moon", parent)
                   for name, number in satellites]
    for name, number, category in [
        ("Vesta", 4, "asteroid"), ("Pallas", 2, "asteroid"),
        ("Hygiea", 10, "asteroid"), ("Eros", 433, "asteroid"),
        ("Itokawa", 25143, "asteroid"), ("Bennu", 101955, "asteroid"),
        ("Ryugu", 162173, "asteroid"), ("Arrokoth", 486958, "tno"),
        ("Chariklo", 10199, "centaur"), ("Chiron", 2060, "centaur"),
    ]:
        bodies.append(body(name.lower(), name, f"{number};", category,
                           spice_id=2000000 + number))
    for slug, name, designation, spice in [
        ("halley", "1P/Halley", "1P", 1000036),
        ("encke", "2P/Encke", "2P", 1000025),
        ("churyumov-gerasimenko", "67P/Churyumov-Gerasimenko", "67P", 1000012),
    ]:
        bodies.append(body(slug, name, f"DES={designation}; CAP;", "comet",
                           spice_id=spice))
    assert len(bodies) == 71
    assert len({b["id"] for b in bodies}) == 71
    return bodies


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def fetch(url, stem, parameters=None):
    """Make one request at a time, preserving failures and successful bytes."""
    folder = DATA / ("horizons" if parameters is not None else "kernels")
    folder.mkdir(parents=True, exist_ok=True)
    raw_path = folder / (stem + (".response.json" if parameters is not None else ""))
    manifest_path = folder / (stem + ".request.json")
    if parameters is not None:
        url += "?" + urllib.parse.urlencode(parameters)
    if raw_path.exists() and manifest_path.exists():
        old = json.loads(manifest_path.read_text())
        raw = raw_path.read_bytes()
        if old["url"] == url and old["response_sha256"] == sha256(raw):
            if "request_sha256" not in old:
                old["request_sha256"] = sha256(url.encode())
                write_json(manifest_path, old)
            return raw
    request = {"url": url, "parameters": parameters, "method": "GET",
               "request_sha256": sha256(url.encode())}
    write_json(folder / (stem + ".pending-request.json"), request)
    for attempt in range(1, 5):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "scientific-solar-system/1.0"})
            with urllib.request.urlopen(req, timeout=180) as response:
                raw = response.read()
                headers = dict(response.headers.items())
            if not raw:
                raise OSError("Empty response")
            raw_path.write_bytes(raw)
            request.update(retrieved_utc=dt.datetime.now(dt.timezone.utc).isoformat(),
                           response_sha256=sha256(raw), response_bytes=len(raw),
                           response_headers=headers)
            write_json(manifest_path, request)
            (folder / (stem + ".pending-request.json")).unlink()
            return raw
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            error = {"attempt": attempt, "error": str(exc), "url": url}
            if isinstance(exc, urllib.error.HTTPError):
                error["response"] = exc.read().decode("utf-8", errors="replace")
                retry = exc.code in {408, 429, 500, 502, 503, 504}
            else:
                retry = True
            write_json(folder / f"{stem}.error-{attempt}.json", error)
            print(f"Request failed {stem}, attempt {attempt}: {exc}", flush=True)
            if not retry or attempt == 4:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("Retry limit reached")


def pck_values(text):
    sections = re.findall(r"\\begindata(.*?)(?=\\begintext|\Z)", text, re.S)
    values = {}
    for section in sections:
        for name, text_values in re.findall(
                r"(BODY\d+_[A-Z_]+)\s*=\s*\((.*?)\)", section, re.S):
            values[name] = [float(x.replace("D", "E").replace("d", "e"))
                            for x in re.findall(NUMBER, text_values)]
    return values


def utc_to_tdb(utc, lsk):
    instant = dt.datetime.fromisoformat(utc)
    if instant.tzinfo is None:
        raise ValueError("UTC boundary must include Z or an explicit UTC offset")
    entries = re.findall(r"(\d+),\s*@(\d{4}-[A-Z]{3}-\d+)", lsk)
    leaps = [(dt.datetime.strptime(date, "%Y-%b-%d").replace(tzinfo=dt.timezone.utc),
              int(offset)) for offset, date in entries]
    tai_utc = max(offset for date, offset in leaps if date <= instant)
    constants = {}
    for key in ("DELTA_T_A", "K", "EB", "M"):
        match = re.search(r"DELTET/" + key + r"\s*=\s*(\([^)]*\)|" + NUMBER + ")", lsk)
        constants[key] = [float(x.replace("D", "E")) for x in
                          re.findall(NUMBER, match.group(1))]
    utc_jd = instant.timestamp() / 86400.0 + 2440587.5
    tt_jd = utc_jd + (tai_utc + constants["DELTA_T_A"][0]) / 86400.0
    tdb_tt = 0.0
    for _ in range(4):
        seconds = (tt_jd - 2451545.0) * 86400.0 + tdb_tt
        mean = constants["M"][0] + constants["M"][1] * seconds
        eccentric = mean + constants["EB"][0] * math.sin(mean)
        tdb_tt = constants["K"][0] * math.sin(eccentric)
    jd = tt_jd + tdb_tt / 86400.0
    return jd, {"utc": utc, "jd_tdb": jd, "tai_minus_utc_seconds": tai_utc,
                "tt_minus_tai_seconds": constants["DELTA_T_A"][0],
                "tdb_minus_tt_seconds": tdb_tt}


def params(target, first=None, last=None, intervals=INTERVALS, epochs=None):
    result = {
        "format": "json", "COMMAND": f"'{target}'", "EPHEM_TYPE": "'VECTORS'",
        "CENTER": "'500@0'", "REF_SYSTEM": "'ICRF'", "REF_PLANE": "'FRAME'",
        "VEC_CORR": "'NONE'", "OUT_UNITS": "'KM-S'", "VEC_TABLE": "'2'",
        "CSV_FORMAT": "'YES'", "TIME_TYPE": "'TDB'", "OBJ_DATA": "'YES'",
    }
    if epochs is None:
        result.update(START_TIME=f"'JD{first:.12f}'", STOP_TIME=f"'JD{last:.12f}'",
                      STEP_SIZE=f"'{intervals}'")
    else:
        result["TLIST"] = "\n".join(f"{x:.12f}" for x in epochs)
    return result


def parse_vectors(raw, target, expected_epochs=None, count=None):
    wrapper = json.loads(raw)
    if wrapper.get("error"):
        raise ValueError(f"{target['name']}: {wrapper['error']}")
    text = wrapper.get("result", "")
    if "$$SOE" not in text or "$$EOE" not in text:
        raise ValueError(f"{target['name']}: missing vectors; {text[:3000]}")
    required = [
        r"Center body name:\s*Solar System Barycenter \(0\)",
        r"Center-site name:\s*BODY CENTER", r"Output units\s*:\s*KM-S",
        r"Output type\s*:\s*GEOMETRIC cartesian states",
        r"Reference frame\s*:\s*ICRF", r"\bJDTDB\b",
    ]
    for pattern in required:
        if not re.search(pattern, text):
            raise ValueError(f"{target['name']}: invalid header {pattern}")
    identity = re.search(r"Target body name:\s*(.*?)\s+\{source:\s*([^}]+)\}", text)
    if not identity:
        raise ValueError(f"{target['name']}: no target identity")
    target_line, source = identity.groups()
    name_match = target["name"].casefold() in target_line.casefold()
    if not name_match:
        raise ValueError(f"Target mismatch: {target['name']} vs {target_line}")
    if target["horizons_id"].isdigit():
        if f"({target['horizons_id']})" not in target_line:
            raise ValueError(f"Body-center ID mismatch: {target_line}")
    elif target["category"] != "comet":
        number = target["horizons_id"].rstrip(";")
        if not re.search(r"\b" + number + r"\b", target_line):
            raise ValueError(f"Small-body number mismatch: {target_line}")
    rows = []
    for row in csv.reader(io.StringIO(text.split("$$SOE")[1].split("$$EOE")[0])):
        if not row:
            continue
        if len(row) < 8:
            raise ValueError(f"Malformed vector row: {row}")
        values = [float(row[0])] + [float(x) for x in row[2:8]]
        if not all(math.isfinite(x) for x in values):
            raise ValueError(f"Nonfinite vector: {row}")
        rows.append(values)
    if count is not None and len(rows) != count:
        raise ValueError(f"{target['name']}: {len(rows)} rows, expected {count}")
    times = [row[0] for row in rows]
    if any(b <= a for a, b in zip(times, times[1:])):
        raise ValueError("Non-monotonic or duplicate epochs")
    if expected_epochs is not None:
        if len(times) != len(expected_epochs):
            raise ValueError("Epoch count mismatch")
        if max(abs(a - b) for a, b in zip(times, expected_epochs)) > 2e-9:
            raise ValueError(f"{target['name']}: epoch grid mismatch")
    return {
        "times": times, "positions_km": [r[1:4] for r in rows],
        "velocities_km_s": [r[4:7] for r in rows],
        "identity": target_line, "source": source, "header": text.split("$$SOE")[0],
        "signature": wrapper.get("signature", {}),
    }


def small_body_physical(target):
    if target["horizons_id"].isdigit():
        return {}
    command = target["horizons_id"].rstrip(";")
    if target["category"] == "comet":
        command = target["name"].split("/")[0]
    query = {"sstr": command, "phys-par": "true", "full-prec": "true"}
    raw = fetch("https://ssd-api.jpl.nasa.gov/sbdb.api", target["id"] + "-sbdb", query)
    result = json.loads(raw)
    if "object" not in result:
        raise ValueError(f"SBDB did not resolve {target['name']}: {result}")
    fullname = result["object"]["fullname"]
    if target["name"].lower() not in fullname.lower():
        raise ValueError(f"SBDB identity mismatch: {target['name']} vs {fullname}")
    target["physical_parameter_source_identity"] = fullname
    target["pck_id"] = target["spice_id"]
    target["spice_id"] = int(result["object"]["spkid"])
    orbit = result.get("orbit", {})
    target["orbit_solution_context"] = {
        key: orbit.get(key) for key in
        ["orbit_id", "soln_date", "first_obs", "last_obs", "n_obs_used",
         "condition_code", "rms", "source", "pe_used", "sb_used"]
    }
    target["orbit_solution_context"]["note"] = (
        "SBDB context was retrieved separately from the Horizons vectors. "
        "Its latest solution may differ from the cached Horizons solution. "
        "The Horizons header is authoritative for these trajectories. "
        "Fit RMS and orbit condition code are not Cartesian position uncertainties."
    )
    target["source_urls"].append(
        "https://ssd-api.jpl.nasa.gov/sbdb.api?" + urllib.parse.urlencode(query))
    return {p["name"]: p for p in result.get("phys_par", [])}


SHAPES = {
    "haumea": ([1161, 852, 513], "https://doi.org/10.1038/nature24051",
               "Occultation-derived triaxial semiaxes. Shape solution is model-dependent."),
    "styx": ([8, 4.5, 5], "https://doi.org/10.1038/nature15797",
             "Approximate New Horizons semiaxes, with large image-resolution uncertainty."),
    "nix": ([24.9, 16.6, 15.55], "https://doi.org/10.1038/nature15797",
            "Approximate New Horizons triaxial semiaxes."),
    "kerberos": ([9.5, 5, 4.5], "https://doi.org/10.1038/nature15797",
                 "Approximate New Horizons semiaxes. Ellipsoid does not represent the bilobed shape."),
    "hydra": ([25.45, 18.05, 15.45], "https://doi.org/10.1038/nature15797",
              "Approximate New Horizons triaxial semiaxes."),
    "arrokoth": ([18, 10, 5], "https://doi.org/10.1126/science.aay3999",
                 "Approximate 36 by 20 by 10 km envelope of a contact binary. "
                 "Ellipsoid is an envelope, not the measured two-lobe surface."),
}

RADII = {
    "makemake": (715, "https://doi.org/10.1038/nature11597",
                 "Adopted radius is half the 1430 +/- 9 km occultation diameter "
                 "reported by Ortiz et al. 2012. A spherical approximation is used; "
                 "the projected-ellipse fit also permits a longer axis."),
    "eris": (1163, "https://doi.org/10.1038/nature10550",
             "Radius 1163 +/- 6 km from the Sicardy et al. 2011 occultation."),
    "orcus": (458.5, "https://arxiv.org/abs/1305.0449",
              "Half the 917 +/- 25 km primary-body diameter from Fornasier et al. "
              "2013. Thermal binary decomposition assumes equal component albedos; "
              "this is not the unresolved Orcus-Vanth system diameter."),
    "quaoar": (555, "https://doi.org/10.1088/0004-637X/773/1/26",
               "Half the 1110 +/- 5 km area-equivalent occultation diameter from "
               "Braga-Ribas et al. 2013. Spherical approximation; published "
               "occultation shape solutions differ."),
    "gonggong": (615, "https://arxiv.org/abs/1903.05439",
                 "Half the 1230 +/- 50 km thermophysical-model diameter from "
                 "Kiss et al. 2019. Model-dependent effective size, not resolved terrain."),
    "sedna": (497.5, "https://arxiv.org/abs/1204.0899",
              "Half the 995 +/- 80 km Herschel thermal-model diameter from Pal et al. "
              "2012. Model-dependent spherical effective size."),
    "salacia": (427, "https://arxiv.org/abs/1305.0449",
                "Half the 854 +/- 45 km primary-body diameter from Fornasier et al. "
                "2013. Binary decomposition assumes equal component albedos; "
                "not the 901 km unresolved Salacia-Actaea system diameter."),
    "varda": (370, "https://arxiv.org/abs/2008.04818",
              "Area-equivalent occultation radius 370 +/- 7 km from Souami et al. "
              "2020. The projected ellipse does not fix all three-dimensional axes."),
    "ixion": (348.39, "https://arxiv.org/abs/2601.09639",
              "Area-equivalent occultation radius 348.39 +5.37/-4.43 km, published "
              "in 2026. Spherical approximation to the projected ellipse."),
}

RING_POLE_CONSTRAINTS = {
    "haumea": {
        "source": "https://arxiv.org/abs/1811.09476",
        "rotation_period_hours": 3.915341,
        "note": "Published preferred equatorial pole RA 285.1 deg, DEC -10.6 deg, "
                "and rotation period 3.915341 h. Absolute rotational phase remains "
                "unconstrained; this is not a complete prime-meridian attitude model.",
    },
    "quaoar": {
        "source": "https://arxiv.org/abs/2304.09237",
        "note": "Published preferred ICRS ring pole RA 259.82 deg, DEC +53.45 deg. "
                "Using that ring pole for the body assumes an equatorial ring. "
                "The ring fit does not measure the body's prime meridian; "
                "absolute rotational phase remains unconstrained.",
    },
    "chariklo": {
        "source": "https://arxiv.org/abs/1409.7259",
        "note": "Published ring pole RA 151.30 deg, DEC +41.48 deg. "
                "Using that ring pole for the body assumes an equatorial ring. "
                "Absolute rotational phase remains unconstrained.",
    },
}


def apply_ring_pole_constraints(target):
    constraint = RING_POLE_CONSTRAINTS.get(target["id"])
    if constraint is None:
        return
    obsolete = (" No supported published pole and phase for this interval. "
                "Static orientation is unconstrained.")
    target["physical_notes"] = target["physical_notes"].replace(obsolete, "")
    if constraint["note"] not in target["physical_notes"]:
        target["physical_notes"] += " " + constraint["note"]
    if constraint["source"] not in target["source_urls"]:
        target["source_urls"].append(constraint["source"])
    if "rotation_period_hours" in constraint:
        target["rotation_period_hours"] = constraint["rotation_period_hours"]


def physical(target, pck, header):
    key = f"BODY{target['spice_id']}"
    source = []
    notes = []
    values = small_body_physical(target)
    if key + "_RADII" in pck:
        target["radii_km"] = pck[key + "_RADII"]
        source.append(PCK_URL)
        notes.append("Triaxial semiaxes from NAIF pck00011.tpc, including its cited "
                     "IAU reports and measurement limitations.")
    if "extent" in values:
        item = values["extent"]
        dimensions = re.fullmatch(
            r"\s*(" + NUMBER + r")\s*[xX]\s*(" + NUMBER +
            r")\s*[xX]\s*(" + NUMBER + r")\s*", item["value"])
        if dimensions and item.get("units") == "km":
            target["radii_km"] = [float(v) / 2 for v in dimensions.groups()]
            notes.append("Adopted semiaxes use half the three SBDB full extents, "
                         f"reference {item.get('ref', 'unspecified')}. "
                         "These supersede older PCK size values where present.")
            if item.get("notes"):
                notes.append(item["notes"])
    if target["id"] in SHAPES:
        axes, url, note = SHAPES[target["id"]]
        target["radii_km"] = axes
        source.append(url)
        notes.append(note)
    if "radii_km" in target:
        target["radius_km"] = math.prod(target["radii_km"]) ** (1 / 3)
        notes.append("radius_km is the equal-volume radius of the adopted semiaxes.")
    elif target["id"] in RADII:
        radius, url, note = RADII[target["id"]]
        target["radius_km"] = radius
        source.append(url)
        notes.append(note)
    elif "diameter" in values:
        item = values["diameter"]
        if item["units"] != "km":
            raise ValueError(f"Unexpected diameter units: {item}")
        target["radius_km"] = float(item["value"]) / 2
        notes.append(f"Radius is half the SBDB effective diameter, reference "
                     f"{item.get('ref', 'unspecified')}, diameter uncertainty "
                     f"{item.get('sigma', 'not supplied')} km. Spherical size estimate, "
                     "not a resolved shape measurement.")
        if item.get("notes"):
            notes.append(item["notes"])
    else:
        match = re.search(
            r"(?:Mean radius\s*\(km\)|Radius\s*\(km\)|Vol\.\s*mean radius,\s*km)"
            r"\s*=\s*(" + NUMBER + ")", header, re.I)
        if not match:
            raise ValueError(f"No sourced radius for {target['name']}; no default permitted")
        target["radius_km"] = float(match.group(1))
        notes.append("Mean radius from the preserved Horizons physical-data header.")
    for field, output in [("albedo", "albedo"), ("rot_per", "rotation_period_hours")]:
        if field in values:
            try:
                target[output] = float(values[field]["value"])
                if field == "rot_per":
                    notes.append("Rotation period from SBDB/LCDB, often synodic. "
                                 + (values[field].get("notes") or
                                    "No uncertainty supplied by the source."))
            except (TypeError, ValueError):
                notes.append(f"SBDB {field} is not a single numeric measurement.")
    obliquity = re.search(r"Obliquity to orbit, deg\s*=\s*(" + NUMBER + ")", header)
    if obliquity:
        target["obliquity_deg"] = float(obliquity.group(1))
    if (key + "_PM" in pck and len(pck[key + "_PM"]) > 1
            and target["id"] != "churyumov-gerasimenko"):
        rate = pck[key + "_PM"][1]
        if rate:
            target["rotation_period_hours"] = 8640.0 / rate
            notes.append("Signed rotation period is derived from the PCK linear "
                         "prime-meridian coefficient; a negative value denotes retrograde rotation.")
    if target["id"] in {"hyperion", "styx", "nix", "kerberos", "hydra", "halley"}:
        notes.append("Rotation is chaotic, complex, or not constrained here. "
                     "No tidy synchronous orientation is assigned.")
    target["source_urls"] = list(dict.fromkeys(target["source_urls"] + source))
    target["physical_notes"] = " ".join(notes)
    apply_ring_pole_constraints(target)
    if not (math.isfinite(target["radius_km"]) and target["radius_km"] > 0):
        raise ValueError(f"Invalid radius: {target['id']}")


def orientation_models(bodies, pck):
    models = {}
    for target in bodies:
        key = f"BODY{target.get('pck_id', target['spice_id'])}"
        fields = [key + suffix for suffix in ("_POLE_RA", "_POLE_DEC", "_PM")]
        excluded = target["id"] in {
            "hyperion", "styx", "nix", "kerberos", "hydra", "halley",
            "churyumov-gerasimenko",
        }
        if not all(field in pck for field in fields) or excluded:
            if target["id"] in RING_POLE_CONSTRAINTS:
                continue
            reason = "No supported published pole and phase for this interval. "
            if target["id"] == "churyumov-gerasimenko":
                reason = "PCK rotation fit is valid only 2014-03-03 to 2014-09-03. "
            target["physical_notes"] += " " + reason + "Static orientation is unconstrained."
            continue
        periodic = {name: value for name, value in pck.items()
                    if name.startswith(key + "_NUT_PREC")}
        notes = (
            "Simplified IAU polynomial orientation, approximate. "
            "Reference epoch J2000 JD2451545.0 TDB. Pole RA and DEC use Julian "
            "centuries of 36525 days; prime meridian uses days. Coefficients "
            "are ascending powers. ICRF/J2000 pole and IAU east-positive prime "
            "meridian. Periodic nutation, precession and libration terms are "
            "not evaluated. Not a high-precision Earth or lunar attitude."
        )
        if periodic:
            notes += " Nonzero or published periodic terms exist in the source kernel."
        models[target["id"]] = {
            "pole_ra_deg": pck[fields[0]], "pole_dec_deg": pck[fields[1]],
            "prime_meridian_deg": pck[fields[2]], "source": PCK_URL,
            "notes": notes, "omitted_periodic_coefficients": periodic,
            "epoch_jd_tdb": 2451545.0,
        }
    return {"bodies": models, "metadata": {
        "kernel": "data/kernels/pck00011.tpc", "periodic_terms_evaluated": False,
        "validity": "Published polynomial extrapolation, not navigation-grade attitude.",
    }}


def hermite(p0, v0, p1, v1, fraction, seconds):
    u = fraction
    return [
        (2*u**3 - 3*u**2 + 1)*a + (u**3 - 2*u**2 + u)*seconds*b
        + (-2*u**3 + 3*u**2)*c + (u**3 - u**2)*seconds*d
        for a, b, c, d in zip(p0, v0, p1, v1)
    ]


def annotate_scene_tolerance(report, bodies):
    by_id = {body["id"]: body for body in bodies}
    for check in report.get("checks", []):
        tolerance = min(0.25, 0.0005 * by_id[check["id"]]["radius_km"])
        check["scene_source_knot_fit_tolerance_km"] = tolerance
        check["tested_midpoints_within_source_knot_tolerance"] = (
            check["max_hermite_position_error_km"] <= tolerance)
        check["max_midpoint_error_over_source_knot_tolerance"] = (
            check["max_hermite_position_error_km"] / tolerance)
    refined = report.get("fast_satellite_refinement")
    if refined:
        tolerance = min(0.25, 0.0005 * by_id[refined["id"]]["radius_km"])
        refined["scene_source_knot_fit_tolerance_km"] = tolerance
        refined["tested_midpoints_within_source_knot_tolerance"] = (
            refined["max_hermite_position_error_km"] <= tolerance)
    report["source_knot_fit_is_not_continuous_accuracy"] = (
        "The scene builder fits stored source samples to min(0.25 km, "
        "0.0005 times body radius). That tolerance does not bound errors "
        "between samples. Hourly Phobos midpoint errors exceed this tolerance. "
        "The separate 15-minute Phobos series improves those errors but also "
        "exceeds this tolerance at independently tested midpoints. "
        "Neither sample set establishes a continuous error bound or "
        "navigation-grade accuracy."
    )
    return report


def validate_independent(bodies, times, states):
    checks = []
    selected = ["earth", "moon", "phobos", "sedna"]
    last_interval = len(times) - 2
    indices = sorted({min(last_interval, round(x * last_interval / 8759))
                      for x in [0, 1, 120, 1000, 4000, 7000, 8759]})
    by_id = {b["id"]: b for b in bodies}
    for slug in selected:
        target = by_id[slug]
        epochs = [(times[i] + times[i+1]) / 2 for i in indices]
        raw = fetch(HORIZONS, slug + "-independent", params(target["horizons_id"], epochs=epochs))
        parsed = parse_vectors(raw, target, epochs, len(epochs))
        if parsed["source"] != target["ephemeris_source"]:
            raise ValueError(f"{slug}: independent request used a different source solution")
        state = states[slug]
        errors, linear_errors = [], []
        for index, epoch, truth in zip(indices, parsed["times"], parsed["positions_km"]):
            seconds = (times[index+1] - times[index]) * 86400
            fraction = (epoch - times[index]) / (times[index+1] - times[index])
            estimate = hermite(
                state["positions_km"][index], state["velocities_km_s"][index],
                state["positions_km"][index+1], state["velocities_km_s"][index+1],
                fraction, seconds)
            linear = [(1-fraction)*a + fraction*b for a, b in zip(
                state["positions_km"][index], state["positions_km"][index+1])]
            errors.append(math.dist(estimate, truth))
            linear_errors.append(math.dist(linear, truth))
        checks.append({
            "id": slug, "independent_epochs_jd_tdb": parsed["times"],
            "hermite_position_errors_km": errors,
            "max_hermite_position_error_km": max(errors),
            "max_linear_position_error_km": max(linear_errors),
            "source": f"data/horizons/{slug}-independent.response.json",
        })
    target = by_id["phobos"]
    duration_seconds = (times[-1] - times[0]) * 86400
    refined_intervals = max(len(times) - 1, math.ceil(duration_seconds / 900))
    raw = fetch(HORIZONS, "phobos-refined", params(
        target["horizons_id"], times[0], times[-1], intervals=refined_intervals))
    refined = parse_vectors(raw, target, count=refined_intervals + 1)
    if refined["source"] != target["ephemeris_source"]:
        raise ValueError("Phobos refinement used a different source solution")
    refined_epochs = [(times[i] * 5 + times[i+1] * 3) / 8 for i in indices]
    raw = fetch(HORIZONS, "phobos-refined-independent", params(
        target["horizons_id"], epochs=refined_epochs))
    truth = parse_vectors(raw, target, refined_epochs, len(refined_epochs))
    if truth["source"] != refined["source"]:
        raise ValueError("Phobos refinement validation used a different source solution")
    refined_errors = []
    for i, epoch, position in zip(indices, truth["times"], truth["positions_km"]):
        j = bisect.bisect_right(refined["times"], epoch) - 1
        span = refined["times"][j+1] - refined["times"][j]
        estimate = hermite(
            refined["positions_km"][j], refined["velocities_km_s"][j],
            refined["positions_km"][j+1], refined["velocities_km_s"][j+1],
            (epoch - refined["times"][j]) / span, span * 86400)
        refined_errors.append(math.dist(estimate, position))
    refined_path = DATA / "horizons" / "phobos-refined.json.gz"
    with gzip.GzipFile(refined_path, "wb", mtime=0) as output:
        output.write(json.dumps({
            "metadata": {"center": "Solar System Barycenter", "frame": "ICRF",
                         "time_scale": "TDB",
                         "nominal_step_seconds": duration_seconds / refined_intervals,
                         "purpose": "Optional finer Phobos curve. Main shared grid remains hourly."},
            "times_jd_tdb": refined["times"],
            "bodies": {"phobos": {
                "positions_km": refined["positions_km"],
                "velocities_km_s": refined["velocities_km_s"],
                "source": "data/horizons/phobos-refined.response.json; " + refined["source"],
            }},
        }, separators=(",", ":"), allow_nan=False).encode())
    return {
        "status": "passed_source_and_coverage_checks",
        "body_count": len(bodies), "epoch_count": len(times),
        "independent_sample_count": sum(len(x["independent_epochs_jd_tdb"]) for x in checks),
        "checks": checks,
        "fast_satellite_refinement": {
            "id": "phobos", "epoch_count": len(refined["times"]),
            "nominal_step_seconds": duration_seconds / refined_intervals,
            "independent_sample_count": len(refined_errors),
            "independent_epochs_jd_tdb": truth["times"],
            "hermite_position_errors_km": refined_errors,
            "max_hermite_position_error_km": max(refined_errors),
            "artifact": "data/horizons/phobos-refined.json.gz",
            "artifact_bytes": refined_path.stat().st_size,
            "artifact_sha256": sha256(refined_path.read_bytes()),
            "usage": "Optional separate time grid. Not merged into the shared hourly core data.",
        },
        "time_quantization_note": (
            "Horizons prints JD to 1e-9 day, about 86 microseconds. "
            "These error measurements include printed-epoch rounding. "
            "Meter-scale errors for Earth and Moon need not be physical "
            "interpolation errors. No navigation-grade accuracy is claimed."
        ),
        "interpretation": (
            "Independent API requests at unsampled epochs validate interpolation "
            "against the same Horizons solutions. They do not independently measure "
            "the accuracy of those source solutions. Position errors are Euclidean "
            "barycentric ICRF differences. Source uncertainty is not quantified by "
            "VECTORS output and is not zero. Blender float32 representation error "
            "must be validated separately by the scene builder."
        ),
        "sampling_caveat": (
            "Hourly cubic Hermite interpolation has a measured Phobos error comparable "
            "to its radius. Use the separately validated 15-minute Phobos data for "
            "closer inspection. Other fast moons also need subhour sampling for "
            "close inspection. Use --intervals for finer full-grid sampling."
        ),
    }


def run(intervals=INTERVALS, skip_independent=False,
        start_utc=START_UTC, stop_utc=STOP_UTC):
    for folder in [DATA, DATA / "horizons", DATA / "kernels"]:
        folder.mkdir(parents=True, exist_ok=True)
    pck_raw = fetch(PCK_URL, "pck00011.tpc")
    lsk_raw = fetch(LSK_URL, "naif0012.tls")
    pck = pck_values(pck_raw.decode())
    first, start = utc_to_tdb(start_utc, lsk_raw.decode())
    last, stop = utc_to_tdb(stop_utc, lsk_raw.decode())
    if last <= first:
        raise ValueError("Stop boundary must be later than start boundary")
    metadata = {
        "frame": "ICRF", "reference_plane": "FRAME",
        "center": "Solar System Barycenter", "center_id": 0,
        "positions_units": "km", "velocities_units": "km/s",
        "time_scale": "TDB", "corrections": "NONE", "geometric": True,
        "start_utc": start_utc, "stop_utc": stop_utc,
        "utc_boundary_conversion": [start, stop],
        "utc_conversion_source": LSK_URL,
        "utc_conversion_method": (
            "NAIF LSK DELTET periodic model, solved by fixed-point iteration. "
            "TDB-TT accuracy is about 30 microseconds, excluding floating-point "
            "Julian-date rounding. Horizons printed epochs have 1e-9 day precision."
        ),
        "leap_second_warning": (
            "Pinned naif0012.tls has TAI-UTC=37 s from 2017-01-01. "
            "UTC dates beyond its last entry assume no unannounced leap seconds. "
            "Future leap seconds would change the UTC interpretation, not stored TDB states."
        ),
        "intervals": intervals, "epoch_count": intervals + 1,
        "nominal_step_seconds": (last - first) * 86400 / intervals,
        "sampling": "Equal TDB intervals between the two converted UTC boundaries.",
        "api_url": HORIZONS, "raw_source_directory": "data/horizons",
        "kernel_sha256": {"pck00011.tpc": sha256(pck_raw), "naif0012.tls": sha256(lsk_raw)},
        "retrieval_is_serial": True, "no_fabricated_fallbacks": True,
        "optional_phobos_refinement": (
            None if skip_independent else "data/horizons/phobos-refined.json.gz"),
    }
    bodies = definitions()
    states, times = {}, None
    for number, target in enumerate(bodies, 1):
        print(f"[{number}/71] {target['name']} ({target['horizons_id']})", flush=True)
        raw = fetch(HORIZONS, target["id"], params(
            target["horizons_id"], first, last, intervals=intervals))
        parsed = parse_vectors(raw, target, times, intervals + 1)
        if times is not None and parsed["times"] != times:
            raise ValueError(f"{target['name']}: printed epochs differ from the master grid")
        if times is None:
            times = parsed["times"]
            if abs(times[0] - first) > 2e-9 or abs(times[-1] - last) > 2e-9:
                raise ValueError("Horizons does not cover the exact converted boundaries")
        target["resolved_horizons_identity"] = parsed["identity"]
        target["ephemeris_source"] = parsed["source"]
        target["source_urls"].append(
            HORIZONS + "?" + urllib.parse.urlencode(params(
                target["horizons_id"], first, last, intervals=intervals)))
        physical(target, pck, parsed["header"])
        states[target["id"]] = {
            "positions_km": parsed["positions_km"],
            "velocities_km_s": parsed["velocities_km_s"],
            "source": f"data/horizons/{target['id']}.response.json; {parsed['source']}",
        }
        metadata["api_signature"] = parsed["signature"]
    orientations = orientation_models(bodies, pck)
    write_json(DATA / "orientations.json", orientations)
    write_json(DATA / "catalog.json", {"bodies": bodies, "metadata": dict(metadata, complete=True)})
    payload = {"metadata": metadata, "times_jd_tdb": times, "bodies": states}
    with gzip.GzipFile(DATA / "ephemerides.json.gz", "wb", mtime=0) as output:
        output.write(json.dumps(payload, separators=(",", ":"), allow_nan=False).encode())
    validation = (validate_independent(bodies, times, states) if not skip_independent
                  else {"status": "independent_validation_skipped"})
    annotate_scene_tolerance(validation, bodies)
    validation["first_jd_tdb"] = times[0]
    validation["last_jd_tdb"] = times[-1]
    validation["orientation_count"] = len(orientations["bodies"])
    validation["artifacts"] = {
        name: {"bytes": (DATA / name).stat().st_size,
               "sha256": sha256((DATA / name).read_bytes())}
        for name in ["catalog.json", "ephemerides.json.gz", "orientations.json"]
    }
    write_json(DATA / "ephemeris_validation.json", validation)
    print(json.dumps({"bodies": len(bodies), "epochs": len(times),
                      "orientations": len(orientations["bodies"]),
                      "artifacts": validation["artifacts"]}, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--intervals", type=int, default=INTERVALS)
    parser.add_argument("--skip-independent", action="store_true")
    parser.add_argument("--start-utc", default=START_UTC)
    parser.add_argument("--stop-utc", default=STOP_UTC)
    args = parser.parse_args()
    if args.intervals < 1:
        parser.error("--intervals must be positive")
    try:
        run(args.intervals, args.skip_independent, args.start_utc, args.stop_utc)
    except Exception as exc:
        write_json(DATA / "horizons" / "pipeline-error.json", {
            "type": type(exc).__name__, "error": str(exc),
            "utc": dt.datetime.now(dt.timezone.utc).isoformat()})
        raise
