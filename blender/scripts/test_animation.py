"""Focused tests, run with Blender's bundled Python and unittest."""

import sys
import unittest
from pathlib import Path

import bpy
import numpy as np
from mathutils import Euler, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from animation import add_curve, assign_action, hermite_indices, new_action


class AnimationTests(unittest.TestCase):
    def test_cubic_reduction(self):
        t = np.linspace(0, 10, 101)
        position = np.column_stack((t**3, t**2, t))
        velocity = np.column_stack((3 * t**2, 2 * t, np.ones(len(t))))
        keep, error = hermite_indices(t, position, velocity, 1e-8)
        self.assertEqual(list(keep), [0, 100])
        self.assertLess(error, 1e-8)

    def test_periodic_motion_retains_knots(self):
        t = np.linspace(0, 50, 1001)
        position = np.column_stack((np.sin(t), np.cos(t), np.zeros(len(t))))
        velocity = np.column_stack((np.cos(t), -np.sin(t), np.zeros(len(t))))
        keep, error = hermite_indices(t, position, velocity, 1e-4)
        self.assertGreater(len(keep), 10)
        self.assertLess(len(keep), len(t))
        self.assertLessEqual(error, 1e-4)

    def test_native_handles_reproduce_cubic(self):
        action, bag = new_action("Unit cubic")
        f = np.array([1.0, 11.0])
        curve = add_curve(bag, "location", 0, f, np.array([0.0, 1000.0]),
                          np.array([0.0, 300.0]))
        for frame in np.linspace(1, 11, 51):
            self.assertAlmostEqual(curve.evaluate(float(frame)), (frame - 1)**3, delta=0.001)
        obj = bpy.data.objects.new("Unit test body", None)
        bpy.context.scene.collection.objects.link(obj)
        assign_action(obj, action)
        bpy.context.scene.frame_set(6)
        self.assertAlmostEqual(obj.location.x, 125, delta=0.001)
        bpy.data.objects.remove(obj, do_unlink=True)

    def test_rebase_before_float32(self):
        parent = np.array([1.123456789e10, -4.4e9, 8.3e8], dtype=np.float64)
        offset = np.array([0.75, 0.35, 0.12])
        child = parent + offset
        good = np.asarray((child - parent) / 1000, dtype=np.float32) * 1000
        bad = (np.asarray(child / 1000, dtype=np.float32)
               - np.asarray(parent / 1000, dtype=np.float32)) * 1000
        self.assertLess(np.linalg.norm(good - offset), 0.00001)
        self.assertGreater(np.linalg.norm(bad - offset), 0.1)

    def test_iau_pole_axis(self):
        ra, dec = np.deg2rad([42.0, 57.0])
        transform = Euler((np.pi / 2 - dec, 0, ra + np.pi / 2), "XYZ").to_matrix()
        actual = transform @ Vector((0, 0, 1))
        expected = np.array([np.cos(ra) * np.cos(dec), np.sin(ra) * np.cos(dec), np.sin(dec)])
        np.testing.assert_allclose(actual[:], expected, atol=1e-7)

    def test_inverse_square_scale(self):
        luminosity = 3.828e26
        au_m = 149597870700
        scale = 1e6
        original = luminosity / (4 * np.pi * au_m**2)
        scaled = (luminosity / scale**2) / (4 * np.pi * (au_m / scale)**2)
        self.assertAlmostEqual(original, scaled, places=9)
        self.assertGreater(original, 1360)
        self.assertLess(original, 1362)


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(
        unittest.defaultTestLoader.loadTestsFromTestCase(AnimationTests)
    )
    if not result.wasSuccessful():
        raise RuntimeError("Scientific animation tests failed")
