#!/usr/bin/env python3
"""Convert the Yale Bright Star Catalogue into the browser star field.

The source is the fixed-width CDS copy of catalog V/50. The download must match
the pinned SHA-256 before any record is read. Output keeps the catalog's own
J2000 positions, V magnitudes, B-V colors, proper motions, and parallaxes.
"""

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/assets/stars/bright-star-catalogue.json"
SOURCE_URL = "https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz"
README_URL = "https://cdsarc.cds.unistra.fr/ftp/V/50/ReadMe"
SOURCE_SHA256 = "3dc44b1e90be8fbe5bcc7656032560f51275f985c7e3f783c9028e1838ec7bed"
RECORD_COUNT = 9110
RECORD_WIDTH = 197
COLUMNS = ["hr", "ra_deg", "dec_deg", "vmag", "b_v", "pmra_arcsec_yr", "pmdec_arcsec_yr",
           "parallax_arcsec", "parallax_dynamical"]


def field(line, first, last):
    """Return bytes first..last, using the 1-based inclusive positions from the ReadMe."""
    return line[first - 1:last].strip()


def number(line, first, last):
    text = field(line, first, last)
    return float(text) if text else None


def parse_record(line):
    line = line.ljust(RECORD_WIDTH)
    hr = int(field(line, 1, 4))
    ra_h, dec_d, vmag = field(line, 76, 77), field(line, 85, 86), number(line, 103, 107)
    if not ra_h or not dec_d or vmag is None:
        return hr, None
    ra = 15 * (int(ra_h) + int(field(line, 78, 79)) / 60 + float(field(line, 80, 83)) / 3600)
    sign = field(line, 84, 84)
    if sign not in ("+", "-"):
        raise ValueError(f"HR {hr} has no declination sign")
    dec = int(dec_d) + int(field(line, 87, 88)) / 60 + int(field(line, 89, 90)) / 3600
    dec = -dec if sign == "-" else dec
    pm_ra, pm_dec = number(line, 149, 154), number(line, 155, 160)
    if pm_ra is None or pm_dec is None:
        raise ValueError(f"HR {hr} has a position without a proper motion")
    if not (0 <= ra < 360 and -90 <= dec <= 90 and -2 <= vmag <= 8):
        raise ValueError(f"HR {hr} is outside the catalog's documented ranges")
    parallax = number(line, 162, 166)
    dynamical = 1 if field(line, 161, 161) == "D" else 0
    return hr, [hr, round(ra, 7), round(dec, 7), vmag, number(line, 110, 114), pm_ra, pm_dec,
                parallax, dynamical if parallax is not None else 0]


def load_source(path):
    if path is None:
        with urllib.request.urlopen(SOURCE_URL, timeout=120) as response:
            raw = response.read()
    else:
        raw = Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError("Bright Star Catalogue download does not match the pinned SHA-256")
    return raw


def prepare(source=None, output=OUTPUT):
    raw = load_source(source)
    lines = gzip.decompress(raw).decode("ascii").splitlines()
    if len(lines) != RECORD_COUNT:
        raise ValueError(f"Expected {RECORD_COUNT} records, found {len(lines)}")
    stars, removed = [], []
    for expected, line in enumerate(lines, start=1):
        hr, row = parse_record(line)
        if hr != expected:
            raise ValueError(f"Record {expected} is HR {hr}")
        if row is None:
            removed.append(hr)
        else:
            stars.append(row)
    header = {
        "schema_version": 1,
        "catalog": "The Bright Star Catalogue, 5th Revised Ed. (Preliminary Version)",
        "citation": "Hoffleit D., Warren Jr W.H. 1991, Astronomical Data Center, NSSDC/ADC",
        "source": {"url": SOURCE_URL, "readme": README_URL, "sha256": SOURCE_SHA256,
                   "bytes": len(raw), "records": RECORD_COUNT, "distributor": "CDS VizieR catalog V/50"},
        "reference_frame": "FK5, equinox J2000.0, epoch J2000.0",
        "epoch_jd": 2451545.0,
        "columns": COLUMNS,
        "units": {"ra_deg": "deg", "dec_deg": "deg", "vmag": "mag", "b_v": "mag",
                  "pmra_arcsec_yr": "arcsec/yr, mu_alpha cos(delta)", "pmdec_arcsec_yr": "arcsec/yr",
                  "parallax_arcsec": "arcsec"},
        "removed_hr": removed,
        "notes": [
            "Positions are the catalog's J2000 sexagesimal values converted to degrees.",
            "V magnitudes, B-V colors, proper motions, and parallaxes are unchanged catalog values.",
            "Missing B-V and parallax values are null. parallax_dynamical is 1 for dynamical parallaxes.",
            "Removed HR entries are novae or extragalactic objects without catalog positions.",
            "FK5 J2000 and ICRS axes agree within about 0.1 arcsec, far below one display pixel.",
        ],
    }
    text = json.dumps(header, indent=2, sort_keys=True, allow_nan=False)
    rows = ",\n".join("    " + json.dumps(row, separators=(",", ":"), allow_nan=False) for row in stars)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(text[:-2] + ',\n  "stars": [\n' + rows + "\n  ]\n}\n")
    return len(stars), removed


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", help="Local copy of catalog.gz. Downloads from CDS when omitted.")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    count, removed = prepare(args.source, args.output)
    print(f"Prepared {count} stars. Removed HR entries without positions: {len(removed)}.")


if __name__ == "__main__":
    main()
