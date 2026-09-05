"""Source-to-package checks. Run with Python's standard-library unittest runner."""

import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "blender"
spec = importlib.util.spec_from_file_location("prepare_data", ROOT / "scripts/prepare_data.py")
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class ScientificDataParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.output = ROOT / "public/data"
        cls.manifest = json.loads((cls.output / "dataset.json").read_bytes())
        cls.catalog = json.loads((SOURCE / "data/catalog.json").read_bytes())
        cls.ids = [body["id"] for body in cls.catalog["bodies"]]
        cls.main = json.loads(gzip.decompress((SOURCE / "data/ephemerides.json.gz").read_bytes()))
        cls.refined = json.loads(gzip.decompress((SOURCE / "data/horizons/phobos-refined.json.gz").read_bytes()))
        cls.raw = (cls.output / "states.bin").read_bytes()
        cls.first, cls.last, cls.records = prepare.read_binary(cls.raw, cls.ids)

    def test_every_binary64_sample_in_all_72_records(self):
        total = 0
        for name, (offset, count) in self.records.items():
            data = self.refined if name == "phobos@refined" else self.main
            body = data["bodies"]["phobos" if name == "phobos@refined" else name]
            self.assertEqual(count, 35041 if name == "phobos@refined" else 8761)
            self.assertEqual(count, len(data["times_jd_tdb"]))
            for index, (epoch, position, velocity) in enumerate(zip(
                    data["times_jd_tdb"], body["positions_km"], body["velocities_km_s"])):
                expected = prepare.SAMPLE.pack(epoch, *position, *velocity)
                actual = self.raw[offset + index * 56:offset + (index + 1) * 56]
                if actual != expected:
                    self.fail(f"Changed binary64 sample {name} at index {index}")
                total += 1
        self.assertEqual(total, 657072)
        self.assertEqual(set(self.records), set(self.ids) | {"phobos@refined"})

    def test_binary_matches_prior_validated_conversion_except_declared_bounds(self):
        prior = ROOT.parent / "solar-system-explorer-de9006d2/Content/SolarSystem/Data/states.bin"
        if not prior.exists():
            self.skipTest(f"prior validated conversion not present at {prior}")
        self.assertEqual(self.raw[:16], prior.read_bytes()[:16])
        self.assertEqual(self.raw[32:], prior.read_bytes()[32:])
        self.assertEqual(self.first, self.main["metadata"]["utc_boundary_conversion"][0]["jd_tdb"])
        self.assertEqual(self.last, self.main["metadata"]["utc_boundary_conversion"][1]["jd_tdb"])
        self.assertLessEqual(abs(self.main["times_jd_tdb"][0] - self.first), 2e-9)

    def test_deterministic_binary_from_original_input(self):
        tracks = [(name, self.main["times_jd_tdb"], self.main["bodies"][name]) for name in self.ids]
        tracks.append(("phobos@refined", self.refined["times_jd_tdb"], self.refined["bodies"]["phobos"]))
        self.assertEqual(prepare.write_binary(tracks, self.first, self.last), self.raw)

    def test_catalog_orientations_rights_and_metadata_byte_parity(self):
        for name, original in prepare.COPIES.items():
            with self.subTest(name=name):
                self.assertEqual((self.output / name).read_bytes(), (SOURCE / original).read_bytes())
        self.assertEqual(len(json.loads((self.output / "orientations.json").read_bytes())["bodies"]), 43)

    def test_every_packaged_file_checksum(self):
        for name, expected in self.manifest["files"].items():
            raw = (self.output / name).read_bytes()
            self.assertEqual(len(raw), expected["bytes"], name)
            self.assertEqual(hashlib.sha256(raw).hexdigest(), expected["sha256"], name)
        for name, expected in self.manifest["source_sha256"].items():
            self.assertEqual(hashlib.sha256((SOURCE / name).read_bytes()).hexdigest(), expected, name)

    def test_full_track_provenance_and_pinned_time(self):
        provenance = json.loads((self.output / "provenance.json").read_bytes())
        self.assertEqual(provenance["main_metadata"], self.main["metadata"])
        self.assertEqual(provenance["refined_metadata"], self.refined["metadata"])
        for name, source in provenance["track_sources"].items():
            expected = (self.refined["bodies"]["phobos"] if name == "phobos@refined"
                        else self.main["bodies"][name])["source"]
            self.assertEqual(source, expected)
        expected = prepare.time_coefficients((SOURCE / "data/kernels/naif0012.tls").read_text())
        self.assertEqual((self.output / "time.json").read_bytes(), prepare.json_bytes(expected))
        self.assertEqual(self.manifest["frame"], "ICRF")
        self.assertEqual(self.manifest["units"], "KM-S")

    def test_ring_only_poles(self):
        poles = json.loads((self.output / "ring-poles.json").read_bytes())
        self.assertEqual(poles["poles"], {
            "haumea": [285.1, -10.6], "quaoar": [259.82, 53.45], "chariklo": [151.30, 41.48],
        })
        self.assertIn("not a spin model", poles["warning"])

    def test_malformed_header_bounds_names_counts_and_trailing_bytes(self):
        first_offset, _ = self.records[self.ids[0]]
        changes = [
            (0, b"INVALID!"), (8, struct.pack("<I", 2)), (12, struct.pack("<I", 71)),
            (16, struct.pack("<d", float("nan"))), (24, struct.pack("<d", self.first)),
            (32, struct.pack("<H", 0)), (34, b"\xff"), (34, b"/"),
            (first_offset - 4, struct.pack("<I", 40001)),
            (first_offset, struct.pack("<d", self.first + 1e-7)),
            (first_offset + 8, struct.pack("<d", float("inf"))),
            (first_offset + 56, self.raw[first_offset:first_offset + 8]),
        ]
        for offset, replacement in changes:
            with self.subTest(offset=offset, replacement=replacement):
                raw = bytearray(self.raw)
                raw[offset:offset + len(replacement)] = replacement
                with self.assertRaises(ValueError):
                    prepare.read_binary(raw, self.ids)
        for raw in (b"", self.raw[:31], self.raw[:35], self.raw[:-1], self.raw + b"x"):
            with self.assertRaises(ValueError):
                prepare.read_binary(raw, self.ids)


if __name__ == "__main__":
    unittest.main()
