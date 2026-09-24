#!/usr/bin/env python3
"""Build the browser sky from Hipparcos, Tycho-2, the Bright Star Catalogue, and the NASA SVS Milky Way map.

Every download must match its pinned SHA-256 before any record is read. Downloads are cached
outside the repository. The script writes only public/assets/stars/.

Requires numpy and Pillow.
"""

import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import struct
import urllib.request
import zlib

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/assets/stars"
CACHE = Path.home() / ".cache/solar-atlas-stars"
CDS = "https://cdsarc.cds.unistra.fr/ftp"
SVS = "https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851"
TYCHO_SHA256 = [
    "1b224570fc6eb151984ce106fdf797728649d1ea77aaf3effd2d3444cfac6df6",
    "36221f4a5cdd9c5009d64299d2e6409f8d4cdf924321768780165bd3e2a2a99a",
    "e2ea4eeb7d204dde70ac54d172b1c429540c0d23d62ec0d7500561adc44cc57b",
    "29e0cb57cba7e1651455efcb528276b0c28e1fe83f47f8ebe963e48d8b180afb",
    "d04868329b470aa320f0fe5e9c525be619a7a228b364433e5f114f2178946d9b",
    "51f08772197dcf0cd26ff098c866036340b797f71ee04be22712517c10c73c4e",
    "f55503a66abce0e11d1a4ccbcde1f4c97a6e3e769de85e005f57ba963086ab03",
    "bc15b5b1f6308477360fbb93f6a98d9029601cab68973202be0f8764c127f524",
    "315ac34c678bc2e0f568b43b6b2d7c3d7c9cf9c089b51115d18b872864e50426",
    "d66c671fa29aad10bc5fd697f68c918bb774c1ffc3c7db9c20234895268390d5",
    "d86529df819ebdf3f4b8892510973ee10e1db06930814e014dd467193e740d52",
    "fc0c3203b3d2787da54c43d9963e363c8a3926576c383b101a15350a7ca23e9c",
    "68fd9d7e7353d52dea0de043cc62b45c04d234104eb05c063dc23ea7b6759576",
    "a08ecc092e6d134742c0f594c56c5c2e02b8fd5e76cffb1779877f2fcefac3fc",
    "2846e8cc489795a4d8160d2d5b64ff0e9a00598adba35a52a4f8ccf4c5e38b3e",
    "74784a3656382090a70d778820335f4a781509dbe3fcb9e92d18cf96b2c46c72",
    "320560e3d551cc40fa1f54ef7133709bf4bd45efa6688f808be7c09be5544a4d",
    "a8154e940aa0a0e8f31d91b4bd9fd56e6849da42cddb13c7dda772439b06991a",
    "5e951a1a51df7956f205b83cbfa5501d357c843640a253c1e6d3917bebe7d928",
    "f59605a38116f517a31a7dbdee3469c077658f2f40b8afe5da2aeb832eaee3dd",
]
SOURCES = {
    "hip2.dat.gz": (f"{CDS}/I/311/hip2.dat.gz", "8e624f843d4254a9b7c2e8dda8e3158dbe825bf98f6bf3dbbae7f0d0b73d6858"),
    "hip_main.dat": (f"{CDS}/I/239/hip_main.dat", "58ceabb104d647160d9437ce6e513a02a036bb4ad9f8879a5a22fd52943616e0"),
    "bsc5_catalog.gz": (f"{CDS}/V/50/catalog.gz", "3dc44b1e90be8fbe5bcc7656032560f51275f985c7e3f783c9028e1838ec7bed"),
    "milkyway_2020_4k.exr": (f"{SVS}/milkyway_2020_4k.exr", "2eb802d6e68d170b410f766c7fec07f7518619f6b6708fdc81e9302d93e74fdb"),
    **{f"tyc2.dat.{i:02d}.gz": (f"{CDS}/I/259/tyc2.dat.{i:02d}.gz", sha) for i, sha in enumerate(TYCHO_SHA256)},
}

J1991_25_JD = 2448349.0625
J2000_JD = 2451545.0
DISPLAY_EPOCH_JD = 2461406.75  # J2027.0, inside the cached ephemeris year
BRIGHT_LIMIT = 8.0
FAINT_SPLIT = 10.0
FAINT_LIMIT = 11.5
MAG_OFFSET, MAG_STEP = 6.0, 0.025
BV_OFFSET, BV_STEP, BV_MISSING = -0.5, 0.01, 255
MAS_RAD = math.pi / 648_000_000
BSC_FLAG = 0x80000000
# Bright Star Catalogue entries that NASA SVS Deep Star Maps 2020 found missing from Hipparcos-2.
BSC_ADDITIONS = [4210, 4375, 4374, 5978, 5977, 4729, 2322, 5343, 2950, 1982, 5034, 2366, 4619, 1704,
                 6660, 6263, 2341, 6848]
ETA_CARINAE_HR, ETA_CARINAE_V = 4210, 4.30  # NASA SVS 4851 estimate from the AAVSO light curve, July 2020


def field(line, first, last):
    """Return bytes first..last, using the 1-based inclusive positions from each CDS ReadMe."""
    return line[first - 1:last].strip()


def number(line, first, last):
    text = field(line, first, last)
    return float(text) if text else None


def fetch(name, cache, offline):
    url, expected = SOURCES[name]
    path = cache / name
    if not path.exists():
        if offline:
            raise FileNotFoundError(f"{path} is not cached")
        cache.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=600) as response:
            path.write_bytes(response.read())
    raw = path.read_bytes()
    actual = hashlib.sha256(raw).hexdigest()
    if actual != expected:
        raise ValueError(f"{name} does not match its pinned SHA-256")
    return raw, actual


def direction(ra, dec):
    return np.stack([np.cos(dec) * np.cos(ra), np.cos(dec) * np.sin(ra), np.sin(dec)], -1)


def motion(ra, dec, pm_ra_mas, pm_dec_mas):
    """Tangential proper-motion vector in radians per Julian year."""
    east, north = pm_ra_mas * MAS_RAD, pm_dec_mas * MAS_RAD
    return np.stack([-np.sin(ra) * east - np.sin(dec) * np.cos(ra) * north,
                     np.cos(ra) * east - np.sin(dec) * np.sin(ra) * north, np.cos(dec) * north], -1)


def octahedral(vectors):
    v = vectors / np.abs(vectors).sum(-1, keepdims=True)
    x, y, z = v[:, 0].copy(), v[:, 1].copy(), v[:, 2]
    south = z < 0
    sx, sy = np.where(x >= 0, 1.0, -1.0), np.where(y >= 0, 1.0, -1.0)
    x[south], y[south] = ((1 - np.abs(v[:, 1])) * sx)[south], ((1 - np.abs(v[:, 0])) * sy)[south]
    return np.round((np.stack([x, y], -1) * 0.5 + 0.5) * 65535).astype(np.uint16)


def read_hipparcos(hip2_raw, main_raw):
    vmag, main_bv = {}, {}
    for line in main_raw.decode("ascii").splitlines():
        hip = int(field(line, 9, 14))
        vmag[hip], main_bv[hip] = number(line, 42, 46), number(line, 246, 251)
    stars = []
    for line in gzip.decompress(hip2_raw).decode("ascii").splitlines():
        hip = int(field(line, 1, 6))
        v = vmag.get(hip)
        if v is None:
            v = number(line, 130, 136)
        bv = number(line, 153, 158)
        stars.append((hip, number(line, 16, 28), number(line, 30, 42), number(line, 44, 50),
                      number(line, 52, 59), number(line, 61, 68), v, main_bv.get(hip) if bv is None else bv))
    return stars


def read_bsc(raw):
    rows = {}
    for line in gzip.decompress(raw).decode("ascii").splitlines():
        line = line.ljust(197)
        hr = int(field(line, 1, 4))
        if hr not in BSC_ADDITIONS:
            continue
        ra = 15 * (int(field(line, 76, 77)) + int(field(line, 78, 79)) / 60 + float(field(line, 80, 83)) / 3600)
        dec = int(field(line, 85, 86)) + int(field(line, 87, 88)) / 60 + int(field(line, 89, 90)) / 3600
        dec = -dec if field(line, 84, 84) == "-" else dec
        parallax = number(line, 162, 166)
        v = ETA_CARINAE_V if hr == ETA_CARINAE_HR else number(line, 103, 107)
        rows[hr] = (BSC_FLAG | hr, math.radians(ra), math.radians(dec), parallax * 1000 if parallax else 0.0,
                    number(line, 149, 154) * 1000, number(line, 155, 160) * 1000, v, number(line, 110, 114))
    if sorted(rows) != sorted(BSC_ADDITIONS):
        raise ValueError("Bright Star Catalogue additions are incomplete")
    return [rows[hr] for hr in BSC_ADDITIONS]


def bright_tier(hipparcos, additions):
    rows = [star for star in hipparcos if star[6] is not None and star[6] < BRIGHT_LIMIT]
    # Additions carry J2000 positions. Move them back to the Hipparcos epoch so one epoch serves the file.
    years = (J1991_25_JD - J2000_JD) / 365.25
    for star in additions:
        ra, dec = np.array([star[1]]), np.array([star[2]])
        p = direction(ra, dec) + motion(ra, dec, np.array([star[4]]), np.array([star[5]])) * years
        p /= np.linalg.norm(p)
        rows.append((star[0], math.atan2(p[0, 1], p[0, 0]) % (2 * math.pi), math.asin(p[0, 2])) + star[3:])
    rows.sort(key=lambda star: star[6])
    record = struct.Struct("<I9f")
    out = bytearray(b"SASTARB1" + struct.pack("<II", len(rows), record.size))
    for hip, ra, dec, plx, pm_ra, pm_dec, v, bv in rows:
        a, d = np.array([ra]), np.array([dec])
        p, m = direction(a, d)[0], motion(a, d, np.array([pm_ra or 0.0]), np.array([pm_dec or 0.0]))[0]
        parallax = plx / 1000 if plx and plx > 0 else 0.0
        out += record.pack(hip, *p, *m, parallax, v, -99.0 if bv is None else bv)
    return bytes(out), rows


def read_tycho(raws):
    ra, dec, pm_ra, pm_dec, v, bv, hip, mean = [], [], [], [], [], [], [], []
    skipped = 0
    for raw in raws:
        for line in gzip.decompress(raw).decode("ascii").splitlines():
            vt, bt = number(line, 124, 129), number(line, 111, 116)
            if vt is None:
                skipped += 1
                continue
            mean_ra = number(line, 16, 27)
            if mean_ra is None:
                a, d, pa, pd = number(line, 153, 164), number(line, 166, 177), 0.0, 0.0
            else:
                a, d = mean_ra, number(line, 29, 40)
                pa, pd = number(line, 42, 48) or 0.0, number(line, 50, 56) or 0.0
            # ESA (1997), The Hipparcos and Tycho Catalogues, Vol. 1, Section 1.3, Appendix 4.
            v.append(vt - 0.090 * (bt - vt) if bt is not None else vt)
            bv.append(0.850 * (bt - vt) if bt is not None else math.nan)
            ra.append(a)
            dec.append(d)
            pm_ra.append(pa)
            pm_dec.append(pd)
            hip.append(int(field(line, 143, 148) or 0))
            mean.append(mean_ra is not None)
    return (np.radians(ra), np.radians(dec), np.array(pm_ra), np.array(pm_dec), np.array(v), np.array(bv),
            np.array(hip), np.array(mean)), skipped


def hipparcos_at(stars, epoch_jd):
    """Hipparcos-2 directions moved from J1991.25 to another epoch."""
    a, d = np.array([s[1] for s in stars]), np.array([s[2] for s in stars])
    return direction(a, d) + motion(a, d, np.array([s[4] or 0.0 for s in stars]),
                                    np.array([s[5] or 0.0 for s in stars])) * ((epoch_jd - J1991_25_JD) / 365.25)


def faint_tier(tycho, hipparcos, bright_ids):
    ra, dec, pm_ra, pm_dec, v, bv, hip, mean = tycho
    keep = ~np.isin(hip, list(bright_ids)) & (v < FAINT_LIMIT)
    years = (DISPLAY_EPOCH_JD - J2000_JD) / 365.25
    p = direction(ra, dec) + motion(ra, dec, pm_ra, pm_dec) * years
    # Tycho-2 has no proper motion for entries without a mean position, such as Proxima Centauri.
    # Hipparcos-2 supplies it when the entry names a HIP star.
    by_hip = {s[0]: s for s in hipparcos}
    moved = np.flatnonzero(keep & ~mean & np.isin(hip, list(by_hip)))
    if moved.size:
        p[moved] = hipparcos_at([by_hip[h] for h in hip[moved]], DISPLAY_EPOCH_JD)
    p, v, bv = p[keep], v[keep], bv[keep]
    # Hipparcos stars fainter than the bright tier with no Tycho-2 main-catalog entry.
    tycho_hips = set(hip[hip > 0].tolist())
    extra = [s for s in hipparcos if s[0] not in bright_ids and s[0] not in tycho_hips
             and s[6] is not None and s[6] < FAINT_LIMIT]
    if extra:
        p = np.concatenate([p, hipparcos_at(extra, DISPLAY_EPOCH_JD)])
        v = np.concatenate([v, [s[6] for s in extra]])
        bv = np.concatenate([bv, [math.nan if s[7] is None else s[7] for s in extra]])
    p /= np.linalg.norm(p, axis=-1, keepdims=True)
    order = np.argsort(v, kind="stable")
    p, v, bv = p[order], v[order], bv[order]
    mag = np.clip(np.round((v - MAG_OFFSET) / MAG_STEP), 0, 254).astype(np.uint8)
    color = np.where(np.isnan(bv), BV_MISSING, np.clip(np.round((np.nan_to_num(bv) - BV_OFFSET) / BV_STEP), 0, 254)).astype(np.uint8)
    split = int(np.searchsorted(v, FAINT_SPLIT))
    files = []
    for lo, hi in ((0, split), (split, len(v))):
        count = hi - lo
        body = octahedral(p[lo:hi]).tobytes() + np.stack([mag[lo:hi], color[lo:hi]], -1).tobytes()
        files.append((b"SASTARF1" + struct.pack("<II", count, 6) + body, count, float(v[lo]), float(v[hi - 1])))
    return files, len(extra), int(moved.size)


def read_exr(raw):
    """Decode a scanline, ZIP-compressed, half-float OpenEXR file into a float32 RGB array."""
    if raw[:4] != b"\x76\x2f\x31\x01":
        raise ValueError("Not an OpenEXR file")
    i, attrs = 8, {}
    while True:
        j = raw.index(b"\0", i)
        name = raw[i:j].decode()
        if not name:
            i = j + 1
            break
        k = raw.index(b"\0", j + 1)
        size = struct.unpack_from("<i", raw, k + 1)[0]
        attrs[name] = raw[k + 5:k + 5 + size]
        i = k + 5 + size
    channels, p = [], 0
    listing = attrs["channels"]
    while listing[p] != 0:
        e = listing.index(b"\0", p)
        channels.append((listing[p:e].decode(), struct.unpack_from("<i", listing, e + 1)[0]))
        p = e + 17
    if attrs["compression"][0] != 3 or any(kind != 1 for _, kind in channels):
        raise ValueError("Expected ZIP-compressed half-float channels")
    x0, y0, x1, y1 = struct.unpack("<4i", attrs["dataWindow"])
    width, height = x1 - x0 + 1, y1 - y0 + 1
    offsets = struct.unpack_from(f"<{(height + 15) // 16}Q", raw, i)
    pixels = np.zeros((height, len(channels), width), np.float16)
    for offset in offsets:
        y, size = struct.unpack_from("<ii", raw, offset)
        t = np.frombuffer(zlib.decompress(raw[offset + 8:offset + 8 + size]), np.uint8)
        t = ((np.cumsum(t.astype(np.int64) - 128) + 128) % 256).astype(np.uint8)
        half = (t.size + 1) // 2
        data = np.empty(t.size, np.uint8)
        data[0::2], data[1::2] = t[:half], t[half:]
        lines = min(16, height - (y - y0))
        pixels[y - y0:y - y0 + lines] = np.frombuffer(data.tobytes(), np.float16).reshape(lines, len(channels), width)
    names = [name for name, _ in channels]
    return np.stack([pixels[:, names.index(c), :] for c in "RGB"], -1).astype(np.float32)


def jpeg(linear, path):
    x = np.clip(linear, 0, 1)
    encoded = np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    Image.fromarray(np.round(encoded * 255).astype(np.uint8)).save(path, quality=92, subsampling=0, optimize=True)
    raw = path.read_bytes()
    return {"file": path.name, "width": linear.shape[1], "height": linear.shape[0], "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest()}


def describe(raw, name):
    return {"file": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def prepare(cache=CACHE, output=OUTPUT, offline=False):
    fetched = {name: fetch(name, cache, offline) for name in SOURCES}
    hipparcos = read_hipparcos(fetched["hip2.dat.gz"][0], fetched["hip_main.dat"][0])
    additions = read_bsc(fetched["bsc5_catalog.gz"][0])
    bright_raw, bright_rows = bright_tier(hipparcos, additions)
    bright_ids = {row[0] for row in bright_rows}
    tycho, no_vt = read_tycho([fetched[f"tyc2.dat.{i:02d}.gz"][0] for i in range(20)])
    faint, hip_only, hip_moved = faint_tier(tycho, hipparcos, bright_ids)
    output.mkdir(parents=True, exist_ok=True)
    for stale in output.glob("*"):
        stale.unlink()
    (output / "hipparcos.bin").write_bytes(bright_raw)
    faint_records = []
    for name, (raw, count, v0, v1) in zip(("faint-a.bin", "faint-b.bin"), faint):
        (output / name).write_bytes(raw)
        faint_records.append({**describe(raw, name), "count": count, "v_range": [round(v0, 3), round(v1, 3)]})
    sky = read_exr(fetched["milkyway_2020_4k.exr"][0])
    low = sky.reshape(sky.shape[0] // 2, 2, sky.shape[1] // 2, 2, 3).mean(axis=(1, 3))
    manifest = {
        "schema_version": 2,
        "sources": {name: {"url": SOURCES[name][0], "sha256": digest, "bytes": len(raw)}
                    for name, (raw, digest) in fetched.items()},
        "bright": {**describe(bright_raw, "hipparcos.bin"), "count": len(bright_rows), "epoch_jd": J1991_25_JD,
                   "v_limit": BRIGHT_LIMIT, "record": "uint32 id, float32 direction[3], motion_rad_per_yr[3], "
                   "parallax_arcsec, v_mag, b_v (-99 when missing)",
                   "id": "HIP number, or 2^31 + HR for Bright Star Catalogue additions"},
        "faint": faint_records,
        "faint_epoch_jd": DISPLAY_EPOCH_JD,
        "faint_encoding": {"direction": "uint16 octahedral pairs", "v_mag": {"offset": MAG_OFFSET, "step": MAG_STEP},
                           "b_v": {"offset": BV_OFFSET, "step": BV_STEP, "missing": BV_MISSING}},
        "milky_way": {"low": jpeg(low, output / "milky-way-2k.jpg"), "high": jpeg(sky, output / "milky-way-4k.jpg"),
                      "projection": "Plate carree in ICRS. Column u = 0.5 - RA/360 (mod 1). Row 0 is Dec +90.",
                      "encoding": "sRGB transfer of the NASA SVS milkyway_2020 linear radiance, clipped to 0..1"},
        "notes": [
            "Bright tier: Hipparcos-2 (van Leeuwen 2007) astrometry with Hipparcos (ESA 1997) Johnson V, V < 8.",
            "Bright tier adds 18 Bright Star Catalogue stars that NASA SVS 4851 lists as missing from Hipparcos-2.",
            "Eta Carinae uses V = 4.30, the NASA SVS 4851 estimate from the AAVSO light curve.",
            "Faint tier: Tycho-2 (Hog et al. 2000) with V = VT - 0.090 (BT - VT) and B-V = 0.850 (BT - VT).",
            f"Faint tier covers V < {FAINT_LIMIT} not in the bright tier, positions moved to J2027.0.",
            f"Faint tier includes {hip_only} Hipparcos-2 stars that have no Tycho-2 main-catalog entry.",
            f"{hip_moved} Tycho-2 entries without a mean position take Hipparcos-2 astrometry.",
            f"{no_vt} Tycho-2 entries without VT are omitted.",
            "The NASA SVS milkyway_2020 map holds Gaia DR2 starlight fainter than Hipparcos and Tycho-2.",
        ],
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True, allow_nan=False) + "\n")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--cache", type=Path, default=CACHE, help="Download cache outside the repository.")
    parser.add_argument("--offline", action="store_true", help="Use only cached downloads.")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    manifest = prepare(args.cache, args.output, args.offline)
    faint = sum(record["count"] for record in manifest["faint"])
    print(f"Prepared {manifest['bright']['count']} bright and {faint} faint stars.")


if __name__ == "__main__":
    main()
