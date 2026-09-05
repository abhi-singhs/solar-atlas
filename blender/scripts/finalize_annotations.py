"""Use object scale for annotations that exceed Blender's font-size limit."""

import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from materials import configure_solar_limb

for material in bpy.data.materials:
    if material.get("body_id") == "sun" and material.get("role") == "surface":
        configure_solar_limb(material)
for scene in bpy.data.scenes:
    if scene.get("origin_id") == "sun":
        scene.view_settings.exposure = 1
for material in bpy.data.materials:
    if material.name == "Annotation | sun":
        for node in material.node_tree.nodes:
            if node.bl_idname == "ShaderNodeEmission":
                node.inputs["Strength"].default_value = .5
changed = 0
for scene in bpy.data.scenes:
    camera = scene.camera
    for obj in scene.objects:
        if obj.type != "FONT" or obj.parent != camera:
            continue
        depth = abs(obj.location.z)
        if obj.name.startswith("Survey title"):
            size = depth * 0.047
        elif obj.name.startswith("Survey interval"):
            size = depth * 0.018
        elif obj.name.startswith("Survey annotation disclosure"):
            size = depth * 0.017
        elif "provenance label" in obj.name:
            size = depth * 0.008
        else:
            size = depth * 0.017
        obj.data.size = 1
        obj.scale = (size, size, size)
        changed += 1
    if scene.get("origin_id") != "solar-system-barycenter":
        continue
    scene.frame_set(1)
    limit = camera.data.ortho_scale / 2
    rotation = camera.rotation_euler.to_matrix()
    wanted = (["Sun", "Mercury", "Venus", "Earth", "Mars"] if "Inner" in scene.name
              else ["Sun", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
                    "Haumea", "Makemake", "Eris", "Sedna", "Quaoar", "Gonggong"])
    labels = {obj.data.body: obj for obj in scene.objects
              if obj.type == "FONT" and obj.parent != camera}
    occupied = []
    for name in wanted:
        label = labels[name]
        mover = label.parent
        projected = rotation.transposed() @ mover.location
        size = limit * 0.021
        width, height = len(name) * size * 0.64, size * 1.3
        offset_x = limit * 0.012
        for attempt in range(24):
            offset_y = limit * 0.012 + ((attempt + 1) // 2) * height * (1 if attempt % 2 else -1)
            bounds = (projected.x + offset_x, projected.y + offset_y,
                      projected.x + offset_x + width, projected.y + offset_y + height)
            if not any(bounds[0] < b[2] and bounds[2] > b[0]
                       and bounds[1] < b[3] and bounds[3] > b[1] for b in occupied):
                break
        occupied.append(bounds)
        label.location = rotation @ Vector((offset_x, offset_y, 0))
        label.data.size = 1
        label.scale = (size, size, size)
        for child in mover.children:
            if child.type == "CURVE" and "annotation leader" in child.name:
                child.data.splines[0].points[1].co = (*label.location, 1)
        changed += 1
for obj in bpy.data.objects:
    if obj.type == "MESH" and obj.get("body_id"):
        assert tuple(obj.scale) == (1, 1, 1), f"Physical body scaled by annotation fix: {obj.name}"
for name in ["README.md", "CREDITS.md"]:
    text = bpy.data.texts.get("START HERE | scientific model" if name == "README.md" else name)
    if text is None:
        text = bpy.data.texts.new(name)
    text.clear()
    text.write((ROOT / name).read_text())
bpy.context.window.scene = next(scene for scene in bpy.data.scenes if scene.get("origin_id") == "earth")
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "solar_system.blend"), compress=True)
path = ROOT / "validation.json"
report = json.loads(path.read_text())
report["annotation_checks"] = {
    "status": "PASS", "text_objects": changed,
    "note": "Unit font data with object-scale sizing bypasses the 10000-unit font limit. Physical body scales unchanged.",
}
path.write_text(json.dumps(report, indent=2))
print("ANNOTATIONS_COMPLETE", changed)
