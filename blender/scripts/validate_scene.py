"""Check the reopened file against its catalog and double-precision source data."""

import gzip
import json
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[1]


def main():
    catalog = json.loads((ROOT / "data/catalog.json").read_text())
    bodies = {body["id"]: body for body in catalog["bodies"]}
    with gzip.open(ROOT / "data/ephemerides.json.gz", "rt") as stream:
        ephemeris = json.load(stream)
    jd = np.asarray(ephemeris["times_jd_tdb"])
    source_frames = (jd - jd[0]) * 24 + 1
    failures = []
    position_checks = []
    geometry_checks = []
    blend = Path(bpy.data.filepath).resolve()
    report = {"body_count": len(bodies), "scene_count": len(bpy.data.scenes),
              "blend_path": str(blend.relative_to(ROOT.parent) if blend.is_relative_to(ROOT.parent) else blend),
              "failures": failures}
    if len(bodies) != 71:
        failures.append("Core body count is not 71")
    overview = bpy.data.scenes.get("00 | Solar System")
    if overview is None:
        failures.append("Missing complete survey scene")
    scenes = list(bpy.data.scenes)
    indices = [0, len(jd) // 4, len(jd) // 2, len(jd) - 1]
    for scene in scenes:
        unit = scene.get("km_per_blender_unit")
        if unit != 1:
            failures.append(f"Incorrect length conversion: {scene.name}")
        if scene.camera is None:
            failures.append(f"Missing camera: {scene.name}")
        if scene.frame_end != round(float(source_frames[-1])):
            failures.append(f"Incomplete animation range: {scene.name}")
        origin = scene.get("origin_id")
        if origin in bodies:
            surfaces = [obj for obj in scene.objects
                        if obj.type == "MESH" and obj.get("body_id") == origin]
            if len(surfaces) != 1:
                failures.append(f"Target surface missing or duplicated: {scene.name}")
            else:
                obj = surfaces[0]
                measured = np.max(np.abs([vertex.co[:] for vertex in obj.data.vertices]), axis=0) * unit
                expected = np.asarray(bodies[origin].get("radii_km") or [bodies[origin]["radius_km"]] * 3)
                error = float(np.max(np.abs(measured - expected)))
                geometry_checks.append({"body": origin, "axis_error_km": error})
                if error > max(1e-5, float(np.max(expected)) * 2e-7):
                    failures.append(f"Wrong physical mesh dimensions: {origin}")
                if not obj.data.materials or obj.data.materials[0] is None:
                    failures.append(f"Missing surface material: {origin}")
                elif obj.data.materials[0].get("source_status") not in {"OBSERVED", "MIXED", "RECONSTRUCTION"}:
                    failures.append(f"Missing material provenance status: {origin}")
        bpy.context.window.scene = scene
        for index in indices:
            f = float(source_frames[index])
            scene.frame_set(int(f), subframe=f - int(f))
            bpy.context.view_layer.update()
            reference = np.asarray(ephemeris["bodies"][origin]["positions_km"][index]) if origin in bodies else np.zeros(3)
            worst, offender = 0.0, None
            for obj in scene.objects:
                key = obj.get("body_id")
                if obj.type != "EMPTY" or key not in bodies:
                    continue
                expected = np.asarray(ephemeris["bodies"][key]["positions_km"][index]) - reference
                measured = np.asarray(obj.location[:]) * unit
                error = float(np.linalg.norm(measured - expected))
                # Float32 world transforms are separate from source uncertainty.
                allowed = max(0.6, float(np.linalg.norm(expected)) * 5e-7)
                if key == origin:
                    allowed = 1e-8
                if error > allowed:
                    failures.append(f"Position error {error:g} km > {allowed:g} km: {scene.name}, {key}, frame {f:g}")
                if error > worst:
                    worst, offender = error, key
            position_checks.append({"scene": scene.name, "frame": f, "worst_position_error_km": worst,
                                    "body": offender, "note": "Absolute rendered-transform error, not source uncertainty."})
        scene.frame_set(1)
    for key, body in bodies.items():
        local = [scene for scene in scenes if scene.get("origin_id") == key]
        if len(local) != 1:
            failures.append(f"Missing or duplicated target-centered scene for {key}")
    missing_images = []
    for image in bpy.data.images:
        if image.source != "FILE":
            continue
        if not image.packed_file and not Path(bpy.path.abspath(image.filepath)).is_file():
            missing_images.append(image.name)
    if missing_images:
        failures.append("Missing image data: " + ", ".join(missing_images))
    drivers = sum(len(obj.animation_data.drivers) for obj in bpy.data.objects if obj.animation_data)
    if drivers:
        failures.append("Unexpected runtime drivers")
    if overview:
        source_ids = {obj.get("body_id") for obj in overview.objects
                      if obj.type == "MESH" and obj.get("body_id")}
        if source_ids != set(bodies):
            failures.append("Overview does not contain the complete catalog")
    report.update({
        "position_checks": position_checks, "geometry_checks": geometry_checks,
        "missing_images": missing_images, "packed_image_count": sum(bool(image.packed_file) for image in bpy.data.images),
        "driver_count": drivers, "action_count": len(bpy.data.actions),
        "solar_flux_at_1au_W_m2": 3.828e26 / (4 * np.pi * (149597870.7 * 1000) ** 2),
        "status": "PASS" if not failures else "FAIL",
        "limitations": [
            "Recorded position errors include Blender float32 transforms.",
            "Cached-state interpolation and secular spin are not navigation-grade.",
            "The target sits exactly at its local origin; distant context can have larger absolute error.",
        ],
    })
    (ROOT / "validation.json").write_text(json.dumps(report, indent=2))
    print("VALIDATION", report["status"], len(bodies), len(scenes), len(failures), flush=True)
    for failure in failures[:20]:
        print("FAIL", failure)
    if failures:
        raise RuntimeError(f"{len(failures)} validation failures")


if __name__ == "__main__":
    main()
