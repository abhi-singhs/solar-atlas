"""Read source Blender meshes without saving the source file."""
import sys

sys.dont_write_bytecode = True

import argparse
import hashlib
import json
from pathlib import Path

import bpy
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=ROOT / "blender")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    source = args.source.resolve()
    assert Path(bpy.data.filepath).resolve() == source / "solar_system.blend"
    files = ["solar_system.blend", "data/catalog.json", "data/asset_manifest.json",
             "scripts/materials.py", "scripts/rings.py"]
    before = {name: digest(source / name) for name in files}
    catalog = json.loads((source / "data/catalog.json").read_text())["bodies"]
    out = ROOT / "public/assets/meshes"
    out.mkdir(parents=True, exist_ok=True)
    objects = {}
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.data.get("body_id"):
            if any(m and m.get("role") == "surface" for m in obj.data.materials):
                key = obj.data["body_id"]
                assert key not in objects or objects[key].data == obj.data
                objects[key] = obj
    assert len(objects) == len(catalog) == 71
    scene = bpy.data.scenes.new("Browser isolated export")
    bpy.context.window.scene = scene
    scene.unit_settings.system = "NONE"
    evidence = {}
    for index, body in enumerate(catalog):
        key = body["id"]
        print(f"EXPORT {index + 1}/71 {key}", flush=True)
        original = objects[key]
        mesh = original.data.copy()
        mesh.materials.clear()
        obj = bpy.data.objects.new(key, mesh)
        scene.collection.objects.link(obj)
        obj.matrix_world = Matrix.Identity(4)
        axes = body.get("radii_km") or [body["radius_km"]] * 3
        radius = max(axes)
        bounds = [[min(v.co[i] for v in mesh.vertices), max(v.co[i] for v in mesh.vertices)]
                  for i in range(3)]
        for i in range(3):
            assert abs(max(abs(x) for x in bounds[i]) / axes[i] - 1) < .002, (key, bounds)
        for vertex in mesh.vertices:
            vertex.co /= radius
        mesh.update()
        mesh.calc_loop_triangles()
        assert mesh.uv_layers.active is not None
        uv = mesh.uv_layers.active
        probes = []
        for axis in range(3):
            vi = max(range(len(mesh.vertices)), key=lambda i: mesh.vertices[i].co[axis])
            loop = next(l for l in mesh.loops if l.vertex_index == vi)
            probes.append(dict(source_position=list(mesh.vertices[vi].co),
                               source_uv=list(uv.data[loop.index].uv),
                               source_normal=list(mesh.vertices[vi].normal)))
        inward = sum(mesh.vertices[t.vertices[0]].co.dot(t.normal) < -1e-5
                     for t in mesh.loop_triangles)
        assert inward == 0, (key, inward)
        if key == "earth":
            assert abs(probes[0]["source_uv"][0] - .5) < .015
            assert probes[2]["source_uv"][1] > .99
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        kwargs = dict(use_selection=True, use_active_scene=True, export_format="GLB", export_yup=True,
                      export_animations=False, export_skins=False, export_morph=False,
                      export_materials="NONE", export_cameras=False, export_lights=False,
                      export_extras=False, export_texcoords=True, export_normals=True)
        target = out / f"{key}.glb"
        bpy.ops.export_scene.gltf(filepath=str(target), export_apply=False, **kwargs)
        lod = obj.modifiers.new("Runtime low quality", "DECIMATE")
        lod.ratio = .25
        low = out / f"{key}.low.glb"
        bpy.ops.export_scene.gltf(filepath=str(low), export_apply=True, **kwargs)
        assert target.stat().st_size > 1000 and low.stat().st_size > 1000
        evidence[key] = dict(mesh=f"assets/meshes/{key}.glb", mesh_low=f"assets/meshes/{key}.low.glb",
                             normalization_radius_km=radius, radii_km=axes,
                             vertices=len(mesh.vertices), triangles=len(mesh.loop_triangles),
                             source_mesh=original.data.name, geometry_note=mesh.get("geometry_note", ""),
                             source_bounds_km=bounds, cardinal_probes=probes, inward_triangles=inward,
                             sha256=digest(target), low_sha256=digest(low))
        bpy.data.objects.remove(obj, do_unlink=True)
        bpy.data.meshes.remove(mesh)
    after = {name: digest(source / name) for name in files}
    assert before == after, "Source files changed during export"
    result = dict(schema_version=1, source_file_sha256=before, source_unchanged=True,
                  coordinate_contract="GLB stores (x,z,-y). Loader restores (x,-z,y) exactly once.",
                  uv_contract="GLB stores (u,1-v). Textures use flipY=false. No image registration transform.",
                  bodies=evidence)
    (out.parent / "geometry-validation.json").write_text(json.dumps(result, indent=2) + "\n")
    print("EXPORT_COMPLETE", len(evidence), flush=True)


if __name__ == "__main__":
    main()
