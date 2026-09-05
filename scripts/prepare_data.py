#!/usr/bin/env python3
"""Convert the read-only source cache to deterministic, lossless browser data."""

import argparse
import ast
import datetime as dt
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct

MAGIC = b"SOLARD01"
HEADER = struct.Struct("<8sIIdd")
SAMPLE = struct.Struct("<7d")
EPOCH_TOLERANCE_DAYS = 2e-9
MAX_BYTES = 64 * 1024 * 1024
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "blender"
COPIES = {
    "catalog.json": "data/catalog.json",
    "orientations.json": "data/orientations.json",
    "asset_manifest.json": "data/asset_manifest.json",
    "naif0012.tls": "data/kernels/naif0012.tls",
    "pck00011.tpc": "data/kernels/pck00011.tpc",
    "ephemeris_validation.json": "data/ephemeris_validation.json",
    "validation.json": "validation.json",
    "sources.json": "sources.json",
    "CREDITS.md": "CREDITS.md",
    "rings.py.txt": "scripts/rings.py",
}
SCIENTIFIC_METADATA = {
    "frame": "ICRF", "reference_plane": "FRAME", "center_id": 0,
    "positions_units": "km", "velocities_units": "km/s",
    "time_scale": "TDB", "corrections": "NONE", "geometric": True,
}


def json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n").encode()


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def time_coefficients(kernel):
    number = r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[EeDd][-+]?\d+)?"
    result = {}
    for key in ("DELTA_T_A", "K", "EB", "M"):
        match = re.search(r"DELTET/" + key + r"\s*=\s*(\([^)]*\)|" + number + ")", kernel)
        if match is None:
            raise ValueError(f"Missing pinned time coefficient {key}")
        result[key] = [float(x.replace("D", "E")) for x in re.findall(number, match.group(1))]
    result["leaps"] = [
        {"utc": dt.datetime.strptime(date, "%Y-%b-%d").replace(tzinfo=dt.timezone.utc).isoformat(),
         "tai_minus_utc": int(offset)}
        for offset, date in re.findall(r"(\d+),\s*@(\d{4}-[A-Z]{3}-\d+)", kernel)
    ]
    if len(result["leaps"]) != 28 or result["leaps"][-1]["tai_minus_utc"] != 37:
        raise ValueError("Unexpected pinned leap-second table")
    result["source"] = "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/lsk/naif0012.tls"
    result["warning"] = (
        "Pinned naif0012.tls assumes TAI-UTC=37 seconds after 2017-01-01. "
        "Unknown future leap seconds change UTC labels, not stored TDB states. "
        "The DELTET TDB-TT approximation is accurate to about 30 microseconds before "
        "floating-point Julian-date rounding. UTC input requires Z or +00:00, years "
        "1972 onward, and seconds below 60. Known leap seconds can be displayed."
    )
    return result


def validate_track(times, body, first, last, refined=False):
    positions, velocities = body["positions_km"], body["velocities_km_s"]
    step = 900 if refined else 3600
    expected_count = round((last - first) * 86400 / step) + 1
    if not 2 <= len(times) <= 40000 or len(times) != expected_count:
        raise ValueError("Invalid sample count")
    if len(positions) != len(times) or len(velocities) != len(times):
        raise ValueError("Position or velocity count does not match epochs")
    if abs(times[0] - first) > EPOCH_TOLERANCE_DAYS or abs(times[-1] - last) > EPOCH_TOLERANCE_DAYS:
        raise ValueError("Track does not cover declared boundaries")
    for i, (epoch, position, velocity) in enumerate(zip(times, positions, velocities)):
        if len(position) != 3 or len(velocity) != 3 or not all(
                math.isfinite(x) for x in (epoch, *position, *velocity)):
            raise ValueError("Nonfinite or malformed state")
        if i and not 0 < (epoch - times[i - 1]) * 86400 <= step + 1.01:
            raise ValueError("Duplicate, reversed, or missing epoch")


def write_binary(tracks, first, last):
    result = bytearray(HEADER.pack(MAGIC, 1, len(tracks), first, last))
    for name, times, body in tracks:
        validate_track(times, body, first, last, name == "phobos@refined")
        name_bytes = name.encode("ascii")
        result += struct.pack("<H", len(name_bytes)) + name_bytes + struct.pack("<I", len(times))
        for epoch, position, velocity in zip(times, body["positions_km"], body["velocities_km_s"]):
            result += SAMPLE.pack(epoch, *position, *velocity)
    return bytes(result)


def read_binary(raw, catalog_ids):
    """Validate without materializing a second object tree. Return record byte ranges."""
    if not HEADER.size <= len(raw) <= MAX_BYTES:
        raise ValueError("Invalid binary size")
    magic, version, count, first, last = HEADER.unpack_from(raw)
    ids = set(catalog_ids)
    if (magic != MAGIC or version != 1 or count != 72 or len(ids) != 71
            or not all(math.isfinite(x) for x in (first, last)) or not 364 < last - first < 367):
        raise ValueError("Invalid dataset header or catalog")
    offset, records = HEADER.size, {}
    for _ in range(count):
        if offset + 2 > len(raw):
            raise ValueError("Truncated record")
        size, = struct.unpack_from("<H", raw, offset)
        offset += 2
        if not 1 <= size <= 64 or offset + size + 4 > len(raw):
            raise ValueError("Invalid identifier length")
        try:
            name = raw[offset:offset + size].decode("ascii")
        except UnicodeDecodeError as exc:
            raise ValueError("Non-ASCII identifier") from exc
        offset += size
        n, = struct.unpack_from("<I", raw, offset)
        offset += 4
        step = 900 if name == "phobos@refined" else 3600
        if (not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*(?:@refined)?", name)
                or name not in ids | {"phobos@refined"} or name in records
                or not 2 <= n <= 40000 or n != round((last - first) * 86400 / step) + 1
                or offset + n * SAMPLE.size > len(raw)):
            raise ValueError("Invalid record identifier, count, or bounds")
        records[name] = (offset, n)
        previous = None
        for i in range(n):
            row = SAMPLE.unpack_from(raw, offset + i * SAMPLE.size)
            if not all(math.isfinite(x) for x in row):
                raise ValueError("Nonfinite sample")
            if previous is not None and not 0 < (row[0] - previous) * 86400 <= step + 1.01:
                raise ValueError("Duplicate, reversed, or missing epoch")
            if ((i == 0 and abs(row[0] - first) > EPOCH_TOLERANCE_DAYS)
                    or (i == n - 1 and abs(row[0] - last) > EPOCH_TOLERANCE_DAYS)):
                raise ValueError("Incomplete endpoint coverage")
            previous = row[0]
        offset += n * SAMPLE.size
    if offset != len(raw) or set(records) != ids | {"phobos@refined"}:
        raise ValueError("Trailing bytes or missing track")
    return first, last, records


def prepare(source=DEFAULT_SOURCE, output=ROOT / "public/data"):
    source, output = Path(source).resolve(), Path(output).resolve()
    if output == source or source in output.parents:
        raise ValueError("Output must not modify the authoritative source")
    catalog = json.loads((source / "data/catalog.json").read_bytes())
    main = json.loads(gzip.decompress((source / "data/ephemerides.json.gz").read_bytes()))
    refined = json.loads(gzip.decompress((source / "data/horizons/phobos-refined.json.gz").read_bytes()))
    ids = [body["id"] for body in catalog["bodies"]]
    if len(ids) != 71 or len(set(ids)) != 71 or set(ids) != set(main["bodies"]):
        raise ValueError("Expected all 71 catalog bodies")
    if set(refined["bodies"]) != {"phobos"}:
        raise ValueError("Mandatory Phobos refinement is missing")
    metadata = main["metadata"]
    for key, value in SCIENTIFIC_METADATA.items():
        if metadata.get(key) != value:
            raise ValueError(f"Invalid scientific metadata {key}")
    for key in ("frame", "time_scale", "center"):
        if refined["metadata"].get(key) != metadata[key]:
            raise ValueError(f"Refined scientific metadata mismatch {key}")
    if refined["metadata"]["nominal_step_seconds"] != 900:
        raise ValueError("Expected quarter-hour Phobos refinement")
    first, last = [entry["jd_tdb"] for entry in metadata["utc_boundary_conversion"]]
    times = main["times_jd_tdb"]
    tracks = [(name, times, main["bodies"][name]) for name in ids]
    tracks.append(("phobos@refined", refined["times_jd_tdb"], refined["bodies"]["phobos"]))
    binary = write_binary(tracks, first, last)
    read_binary(binary, ids)
    files = {name: (source / original).read_bytes() for name, original in COPIES.items()}
    files["states.bin"] = binary
    files["time.json"] = json_bytes(time_coefficients(files["naif0012.tls"].decode()))
    tree = ast.parse(files["rings.py.txt"].decode())
    poles = next(ast.literal_eval(node.value) for node in tree.body
                 if isinstance(node, ast.Assign) and any(
                     isinstance(target, ast.Name) and target.id == "RING_POLES" for target in node.targets))
    if set(poles) != {"haumea", "quaoar", "chariklo"}:
        raise ValueError("Unexpected ring-only pole inventory")
    files["ring-poles.json"] = json_bytes({
        "poles": poles, "source": "scripts/rings.py",
        "warning": "Ring poles constrain orientation only. Absolute phase is unknown. "
                   "A fixed zero meridian is a display-coordinate convention, not a spin model.",
    })
    files["provenance.json"] = json_bytes({
        "main_metadata": metadata, "refined_metadata": refined["metadata"],
        "track_sources": {name: body["source"] for name, _, body in tracks},
        "binary_conversion": "Every source sample is unchanged IEEE-754 binary64. "
                             "Header bounds use the declared UTC-to-TDB conversions, not the "
                             "rounded Horizons printed endpoints. Endpoint tolerance is 2e-9 days.",
        "scientific_limits": [
            "Geometric ICRF positions relative to Solar System Barycenter 0, in km and km/s.",
            "Cubic Hermite interpolation uses actual sample epochs and its analytic velocity derivative.",
            "Phobos always uses the retained 35,041 quarter-hour samples. The source's roughly "
            "49 m refinement error is a measured comparison, not a universal error guarantee.",
            "All other tracks retain 8,761 hourly samples and their original interpolation limitations.",
            "Trajectories cover the cached year only. They are not invented complete orbits.",
            "43 secular IAU models omit periodic nutation, precession, libration, and Earth orientation parameters.",
            "A rotation period alone does not supply an unknown pole or absolute phase.",
        ],
    })
    original_names = set(COPIES.values()) | {
        "data/ephemerides.json.gz", "data/horizons/phobos-refined.json.gz",
    }
    source_hashes = {name: digest((source / name).read_bytes()) for name in sorted(original_names)}
    manifest = {
        "schema_version": 1, "id": "bundled", "label": "Bundled 2026-09-05 to 2027-09-05",
        "body_count": 71, "record_count": 72,
        "start_utc": metadata["start_utc"], "end_utc": metadata["stop_utc"],
        "start_jd_tdb": first, "end_jd_tdb": last,
        "frame": "ICRF", "reference_plane": "FRAME", "center_id": 0, "units": "KM-S",
        "time_scale": "TDB", "corrections": "NONE", "geometric": True,
        "phobos_refinement_required": True, "epoch_rounding_tolerance_days": EPOCH_TOLERANCE_DAYS,
        "files": {name: {"bytes": len(raw), "sha256": digest(raw)} for name, raw in sorted(files.items())},
        "source_sha256": source_hashes, "source_copies": COPIES,
    }
    output.mkdir(parents=True, exist_ok=True)
    for name, raw in files.items():
        (output / name).write_bytes(raw)
    (output / "dataset.json").write_bytes(json_bytes(manifest))
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE, help="Read-only original project root")
    parser.add_argument("--output", type=Path, default=ROOT / "public/data")
    args = parser.parse_args()
    result = prepare(args.source, args.output)
    print(f"Prepared {result['record_count']} tracks, {result['files']['states.bin']['bytes']:,} state bytes.")
