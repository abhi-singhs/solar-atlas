"""Render selected saved scientific views without changing the blend file."""

import argparse
import json
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--targets", nargs="+", default=["earth", "saturn", "sedna", "overview"])
    parser.add_argument("--width", type=int, default=1600)
    parser.add_argument("--samples", type=int, default=96)
    parser.add_argument("--frame", type=int)
    parser.add_argument("--device", choices=["METAL", "CPU"], default="METAL")
    parser.add_argument("--catalog", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    if args.device == "METAL":
        preferences = bpy.context.preferences.addons["cycles"].preferences
        preferences.compute_device_type = "METAL"
        preferences.get_devices()
        devices = [device for device in preferences.devices if device.type == "METAL"]
        if not devices:
            raise RuntimeError("No Metal device available. Use --device CPU explicitly.")
        for device in preferences.devices:
            device.use = device.type == "METAL"
    output = ROOT / "renders" / "catalog" if args.catalog else ROOT / "renders"
    output.mkdir(parents=True, exist_ok=True)
    if args.catalog and "--targets" not in sys.argv:
        args.targets = [scene["origin_id"] for scene in sorted(bpy.data.scenes, key=lambda s: s.name)
                        if scene.get("origin_id") not in {None, "solar-system-barycenter"}]
    manifest_path = output / "render_manifest.json"
    existing = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
    records = {record["target"]: record for record in existing}
    for target in args.targets:
        if target == "overview":
            scene = bpy.data.scenes["00 | Solar System"]
        elif target == "inner":
            scene = bpy.data.scenes["00 | Inner Solar System"]
        else:
            matches = [scene for scene in bpy.data.scenes if scene.get("origin_id") == target]
            if len(matches) != 1:
                raise ValueError(f"Expected one scene for {target}, found {len(matches)}")
            scene = matches[0]
        bpy.context.window.scene = scene
        frame = args.frame if args.frame is not None else int(scene.get("opening_frame", 1))
        scene.frame_set(frame)
        scene.render.resolution_x = args.width
        scene.render.resolution_y = round(args.width * 0.625)
        scene.render.resolution_percentage = 100
        scene.cycles.samples = args.samples
        scene.cycles.device = "GPU" if args.device == "METAL" else "CPU"
        path = output / f"{target}.png"
        scene.render.filepath = str(path)
        print("RENDER_START", target, scene.name, flush=True)
        bpy.ops.render.render(write_still=True, scene=scene.name)
        if not path.is_file() or path.stat().st_size < 1024:
            raise RuntimeError(f"Render output missing or too small: {path}")
        records[target] = {"target": target, "scene": scene.name, "path": str(path.relative_to(ROOT)),
                        "frame": frame, "width": args.width, "samples": args.samples,
                        "exposure": scene.view_settings.exposure}
        print("RENDER_COMPLETE", target, path.stat().st_size, flush=True)
    manifest_path.write_text(json.dumps(list(records.values()), indent=2))


if __name__ == "__main__":
    main()
