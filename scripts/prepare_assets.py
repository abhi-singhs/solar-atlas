"""Build portable texture variants and preserve authoritative source records."""
import sys

sys.dont_write_bytecode = True

import argparse
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets"


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT / "blender")
    parser.add_argument("--derived", type=Path, default=ROOT.parent / "solar-system-explorer-de9006d2")
    parser.add_argument("--inside-blender", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    if not args.inside_blender:
        subprocess.run(["/Applications/Blender.app/Contents/MacOS/Blender", "--background",
                        "--factory-startup", "--python-exit-code", "1", "--python", str(Path(__file__)),
                        "--", "--inside-blender", "--source", str(args.source), "--derived", str(args.derived)],
                       check=True, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        return
    import bpy
    source, derived = args.source.resolve(), args.derived.resolve()
    exported = json.loads((derived / "Exports/export_manifest.json").read_text())
    geometry = json.loads((OUT / "geometry-validation.json").read_text())
    before = {name: digest(source / name) for name in exported["source_file_sha256"]}
    assert before == exported["source_file_sha256"] == geometry["source_file_sha256"]
    source_manifest = json.loads((source / "data/asset_manifest.json").read_text())
    retained = OUT / "source"
    retained.mkdir(parents=True, exist_ok=True)
    for name in ["data/asset_manifest.json", "data/catalog.json", "data/orientations.json",
                 "sources.json", "CREDITS.md", "scripts/rings.py", "scripts/materials.py"]:
        target = retained / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / name, target)
    prepared = {}
    for body in source_manifest["bodies"].values():
        for record in body["maps"].values():
            original = source / record["path"]
            assert digest(original) == record["sha256"]
            target = retained / record["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target)
            prepared[record["path"]] = dict(url=str(target.relative_to(ROOT / "public")),
                                            sha256=record["sha256"], bytes=target.stat().st_size)
    textures = {}
    for index, (key, record) in enumerate(exported["textures"].items()):
        print(f"TEXTURE {index + 1}/{len(exported['textures'])} {key}", flush=True)
        origin = derived / record["file"]
        assert origin.is_file()
        image = bpy.data.images.load(str(origin), check_existing=False)
        image.colorspace_settings.name = "sRGB" if record["srgb"] else "Non-Color"
        width, height = list(image.size)
        variants = {}
        for quality, limit in [("high", 4096), ("low", 1024)]:
            suffix = ".exr" if record["role"] == "height" else ".png"
            target = OUT / "textures" / quality / (key + suffix)
            target.parent.mkdir(parents=True, exist_ok=True)
            if width <= limit:
                shutil.copyfile(origin, target)
                dimensions = [width, height]
            else:
                image.scale(limit, round(height * limit / width))
                image.filepath_raw = str(target)
                image.file_format = "OPEN_EXR" if suffix == ".exr" else "PNG"
                image.save()
                dimensions = list(image.size)
            variants[quality] = dict(url=str(target.relative_to(ROOT / "public")),
                                     width=dimensions[0], height=dimensions[1],
                                     bytes=target.stat().st_size, sha256=digest(target))
        textures[key] = {**record, "file": variants["high"]["url"], "variants": variants,
                         "derived_sha256": digest(origin)}
        bpy.data.images.remove(image)
    bodies = {}
    for key, record in exported["bodies"].items():
        bodies[key] = {k: v for k, v in record.items()
                       if k not in {"mesh", "material", "fbx", "cloud_material", "atmosphere_material"}}
        bodies[key].update({k: geometry["bodies"][key][k] for k in
                            ["mesh", "mesh_low", "normalization_radius_km", "radii_km", "geometry_note"]})
        bodies[key]["source_metadata"] = source_manifest["bodies"][key]
    assert len(bodies) == 71 and len(textures) == 114
    assert len(exported["ring_systems"]) == 7
    assert sum(map(len, exported["ring_systems"].values())) == 37
    result = dict(schema_version=1, bodies=bodies, textures=textures,
                  ring_systems=exported["ring_systems"], source_file_sha256=before,
                  prepared_source_maps=prepared,
                  source_metadata={"asset_manifest": "assets/source/data/asset_manifest.json",
                                   "catalog": "assets/source/data/catalog.json",
                                   "orientations": "assets/source/data/orientations.json",
                                   "sources": "assets/source/sources.json", "credits": "assets/source/CREDITS.md"},
                  coordinate_contract=geometry["coordinate_contract"], uv_contract=geometry["uv_contract"],
                  source_material_module_version=6, radiance_factor=1,
                  limitations=["Source shell heights retained; atmosphere uses a thin-shell approximation.",
                               "Eclipse shadows use up to four spherical occluders, not solar penumbrae.",
                               "Source height maps are retained; surface collision queries use the source mesh.",
                               "Low geometry is a 25% triangle derivative. Collision always uses full geometry.",
                               "Procedural albedo bakes retain their source reconstruction qualifications."])
    assert before == {name: digest(source / name) for name in before}
    (OUT / "manifest.json").write_text(json.dumps(result, indent=2) + "\n")
    print("ASSETS_COMPLETE", len(bodies), len(textures), len(prepared), flush=True)


if __name__ == "__main__":
    main()
