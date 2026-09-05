"""Standard-library tests for cached scientific ephemeris data and parsing."""

import gzip
import json
import math
from pathlib import Path
import unittest

import fetch_ephemerides as ep


class PipelineTests(unittest.TestCase):
    def test_core_catalog_identifiers(self):
        bodies = ep.definitions()
        self.assertEqual(len(bodies), 71)
        self.assertEqual(sum(b["category"] == "moon" for b in bodies), 36)
        by_id = {b["id"]: b for b in bodies}
        self.assertEqual(by_id["pluto"]["horizons_id"], "999")
        self.assertEqual(by_id["hygiea"]["horizons_id"], "10;")
        self.assertEqual(by_id["sun"]["horizons_id"], "10")
        self.assertEqual(by_id["moon"]["parent_id"], "earth")
        self.assertEqual(by_id["arrokoth"]["category"], "tno")
        self.assertEqual(by_id["churyumov-gerasimenko"]["name"],
                         "67P/Churyumov-Gerasimenko")

    def test_pck_ignores_obsolete_text_values(self):
        text = r"""
\begintext
BODY399_RADII = ( 1 1 1 )
\begindata
BODY399_RADII = ( 6.378D3 6378 6356 )
BODY399_POLE_RA = ( 0 -0.641 0 )
\begintext
BODY399_RADII = ( 2 2 2 )
"""
        parsed = ep.pck_values(text)
        self.assertEqual(parsed["BODY399_RADII"], [6378, 6378, 6356])
        self.assertEqual(parsed["BODY399_POLE_RA"], [0, -0.641, 0])

    def test_utc_boundaries(self):
        lsk = (ep.DATA / "kernels/naif0012.tls").read_text()
        start, detail = ep.utc_to_tdb(ep.START_UTC, lsk)
        stop, _ = ep.utc_to_tdb(ep.STOP_UTC, lsk)
        self.assertEqual(detail["tai_minus_utc_seconds"], 37)
        self.assertAlmostEqual((start - 2461288.5) * 86400, 69.1826, delta=0.002)
        self.assertAlmostEqual(stop - start, 365, places=7)

    def test_hermite_exact_cubic(self):
        # p(t)=t^3, v(t)=3t^2, sampled over two seconds.
        value = ep.hermite([0, 0, 0], [0, 0, 0], [8, 8, 8], [12, 12, 12],
                           0.5, 2)
        self.assertEqual(value, [1, 1, 1])

    def test_pck_aliases_preserve_small_body_orientation(self):
        pck = ep.pck_values((ep.DATA / "kernels/pck00011.tpc").read_text())
        target = ep.body("ceres", "Ceres", "1;", "dwarf_planet", spice_id=20000001)
        target["pck_id"] = 2000001
        orientations = ep.orientation_models([target], pck)
        self.assertIn("ceres", orientations["bodies"])
        self.assertEqual(orientations["bodies"]["ceres"]["prime_meridian_deg"],
                         pck["BODY2000001_PM"])

    def test_reject_wrong_target_and_units(self):
        source = ep.DATA / "horizons/earth.response.json"
        if not source.exists():
            self.skipTest("Earth source not downloaded")
        raw = source.read_bytes()
        earth = next(b for b in ep.definitions() if b["id"] == "earth")
        parsed = ep.parse_vectors(raw, earth, count=8761)
        self.assertEqual(len(parsed["times"]), 8761)
        wrapper = json.loads(raw)
        wrapper["result"] = wrapper["result"].replace("Output units    : KM-S",
                                                      "Output units    : AU-D")
        with self.assertRaisesRegex(ValueError, "invalid header"):
            ep.parse_vectors(json.dumps(wrapper).encode(), earth)
        mars = next(b for b in ep.definitions() if b["id"] == "mars")
        with self.assertRaisesRegex(ValueError, "Target mismatch"):
            ep.parse_vectors(raw, mars)


class CompletedDatasetTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = ep.DATA / "ephemerides.json.gz"
        if not path.exists():
            raise unittest.SkipTest("Completed dataset not yet available")
        with gzip.open(path, "rt") as stream:
            cls.ephemerides = json.load(stream)
        cls.catalog = json.loads((ep.DATA / "catalog.json").read_text())

    def test_all_core_targets_and_exact_grid(self):
        actual = self.ephemerides
        expected = {body["id"] for body in ep.definitions()}
        self.assertEqual(set(actual["bodies"]), expected)
        self.assertEqual({b["id"] for b in self.catalog["bodies"]}, expected)
        times = actual["times_jd_tdb"]
        self.assertEqual(len(times), 8761)
        self.assertTrue(all(a < b for a, b in zip(times, times[1:])))
        for slug, state in actual["bodies"].items():
            self.assertEqual(len(state["positions_km"]), len(times), slug)
            self.assertEqual(len(state["velocities_km_s"]), len(times), slug)
            self.assertTrue(all(
                len(row) == 3 and all(math.isfinite(v) for v in row)
                for row in state["positions_km"] + state["velocities_km_s"]), slug)
        self.assertEqual(actual["metadata"]["frame"], "ICRF")
        self.assertEqual(actual["metadata"]["center_id"], 0)
        self.assertEqual(actual["metadata"]["time_scale"], "TDB")

    def test_shapes_and_unconstrained_orientations(self):
        orientations = json.loads((ep.DATA / "orientations.json").read_text())["bodies"]
        irregular = 0
        for body in self.catalog["bodies"]:
            self.assertGreater(body["radius_km"], 0, body["id"])
            self.assertTrue(body["source_urls"], body["id"])
            self.assertTrue(body["physical_notes"], body["id"])
            axes = body.get("radii_km")
            if axes:
                self.assertEqual(len(axes), 3)
                self.assertTrue(all(x > 0 for x in axes))
                irregular += max(axes) / min(axes) > 1.02
            if body["id"] not in orientations:
                self.assertIn("unconstrained", body["physical_notes"])
        self.assertGreater(irregular, 15)
        for slug in ["hyperion", "styx", "nix", "kerberos", "hydra",
                     "halley", "churyumov-gerasimenko"]:
            self.assertNotIn(slug, orientations)
        for slug in ["haumea", "quaoar", "chariklo"]:
            body = next(b for b in self.catalog["bodies"] if b["id"] == slug)
            self.assertIn("rotational phase remains unconstrained", body["physical_notes"])
            self.assertNotIn(slug, orientations)

    def test_physical_separations(self):
        states = self.ephemerides["bodies"]
        for index in [0, 4380, 8760]:
            earth = states["earth"]["positions_km"][index]
            sun = states["sun"]["positions_km"][index]
            moon = states["moon"]["positions_km"][index]
            mars = states["mars"]["positions_km"][index]
            phobos = states["phobos"]["positions_km"][index]
            self.assertGreater(math.dist(earth, sun), 140_000_000)
            self.assertLess(math.dist(earth, sun), 155_000_000)
            self.assertGreater(math.dist(earth, moon), 350_000)
            self.assertLess(math.dist(earth, moon), 410_000)
            self.assertGreater(math.dist(mars, phobos), 9_000)
            self.assertLess(math.dist(mars, phobos), 9_700)

    def test_provenance_checksums(self):
        for body in self.catalog["bodies"]:
            stem = ep.DATA / "horizons" / body["id"]
            raw = Path(str(stem) + ".response.json").read_bytes()
            request = json.loads(Path(str(stem) + ".request.json").read_text())
            self.assertEqual(ep.sha256(raw), request["response_sha256"])
            self.assertEqual(request["parameters"]["CENTER"], "'500@0'")
            self.assertEqual(request["parameters"]["VEC_CORR"], "'NONE'")

    def test_independent_samples_completed(self):
        report = json.loads((ep.DATA / "ephemeris_validation.json").read_text())
        self.assertEqual(report["body_count"], 71)
        self.assertEqual(report["epoch_count"], 8761)
        self.assertEqual(report["independent_sample_count"], 28)
        self.assertEqual({x["id"] for x in report["checks"]},
                         {"earth", "moon", "phobos", "sedna"})
        self.assertTrue(all(math.isfinite(x["max_hermite_position_error_km"])
                            for x in report["checks"]))
        phobos = next(x for x in report["checks"] if x["id"] == "phobos")
        self.assertFalse(phobos["tested_midpoints_within_source_knot_tolerance"])
        self.assertGreater(phobos["max_midpoint_error_over_source_knot_tolerance"], 2000)
        refinement = report["fast_satellite_refinement"]
        self.assertEqual(refinement["epoch_count"], 35041)
        self.assertEqual(refinement["independent_sample_count"], 7)
        self.assertLess(refinement["max_hermite_position_error_km"], 0.1)
        self.assertFalse(refinement["tested_midpoints_within_source_knot_tolerance"])
        raw = (ep.ROOT / refinement["artifact"]).read_bytes()
        self.assertEqual(ep.sha256(raw), refinement["artifact_sha256"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
