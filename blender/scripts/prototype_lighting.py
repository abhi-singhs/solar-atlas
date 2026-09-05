"""A neutral calibration sphere, not a scientific body asset."""

from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = 640
scene.render.resolution_y = 400
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "AgX"
scene.view_settings.exposure = -8
world = bpy.data.worlds.new("No fill")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0
scene.world = world
bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=6.371)
body = bpy.context.object
for polygon in body.data.polygons:
    polygon.use_smooth = True
material = bpy.data.materials.new("18 percent Lambertian calibration")
material.use_nodes = True
nodes = material.node_tree.nodes
nodes.clear()
diffuse = nodes.new("ShaderNodeBsdfDiffuse")
diffuse.inputs["Color"].default_value = (0.18, 0.18, 0.18, 1)
output = nodes.new("ShaderNodeOutputMaterial")
material.node_tree.links.new(diffuse.outputs[0], output.inputs["Surface"])
body.data.materials.append(material)
source = bpy.data.lights.new("Scaled solar luminosity", "POINT")
source.energy = 3.828e14
source.shadow_soft_size = 695.7
sun = bpy.data.objects.new("Solar source at 1 AU", source)
scene.collection.objects.link(sun)
sun.location = (149597.8707, 0, 0)
camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
scene.collection.objects.link(camera)
camera.location = (22, -15, 8)
camera.rotation_euler = (-camera.location).to_track_quat("-Z", "Y").to_euler()
camera.data.lens = 48
camera.data.clip_start = 0.01
camera.data.clip_end = 1e6
scene.camera = camera
scene.render.filepath = str(ROOT / "renders/lighting-prototype.png")
bpy.ops.render.render(write_still=True)
print("LIGHTING_PROTOTYPE_COMPLETE")
