"""Build native, offline Blender scenes from the cached scientific catalog."""

import argparse
import gzip
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from materials import (  # noqa: E402
    make_atmosphere_material,
    make_cloud_material,
    make_ring_material,
    make_surface_material,
)
from rings import RINGS, RING_NOTES, RING_POLES  # noqa: E402
from animation import assign_action, new_action, add_curve, hermite_indices  # noqa: E402

KM_PER_BU = 1.0
AU_KM = 149597870.7
SUN_POWER = 3.828e26 / (KM_PER_BU * 1000.0) ** 2
ATMOSPHERE_HEIGHTS = {
    "earth": 100.0, "mars": 80.0, "titan": 250.0,
    "venus": 150.0, "jupiter": 300.0, "saturn": 400.0,
    "uranus": 200.0, "neptune": 200.0,
}
BUILD_REPORT = {"motion": [], "geometry": {}, "scenes": [], "warnings": []}


def read_json(path):
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def linked_object(collection, name, data=None):
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    return obj


def annotation_material(name, exposure):
    material = bpy.data.materials.get(name)
    if material is not None:
        return material
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (0.45, 0.61, 0.7, 1)
    emission.inputs["Strength"].default_value = 2 ** (-exposure)
    transparent = nodes.new("ShaderNodeBsdfTransparent")
    rays = nodes.new("ShaderNodeLightPath")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(rays.outputs["Is Camera Ray"], mix.inputs[0])
    links.new(transparent.outputs[0], mix.inputs[1])
    links.new(emission.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], output.inputs["Surface"])
    material["physical"] = False
    return material


def camera_text(collection, camera, text, position, size, material, name):
    data = bpy.data.curves.new(name, "FONT")
    data.body = text
    data.size = 1
    data.materials.append(material)
    obj = linked_object(collection, name, data)
    obj.parent = camera
    obj.location = position
    obj.scale = (size, size, size)
    obj["physical"] = False
    obj.visible_shadow = False
    return obj


class Builder:
    def __init__(self):
        self.catalog = read_json(ROOT / "data/catalog.json")
        self.bodies = {body["id"]: dict(body, km_per_unit=KM_PER_BU) for body in self.catalog["bodies"]}
        with gzip.open(ROOT / "data/ephemerides.json.gz", "rt") as stream:
            ephemeris = json.load(stream)
        self.meta = ephemeris["metadata"]
        self.jd = np.asarray(ephemeris["times_jd_tdb"], dtype=np.float64)
        self.seconds = (self.jd - self.jd[0]) * 86400.0
        self.frames = self.seconds / 3600.0 + 1.0
        self.frame_end = int(round(self.frames[-1]))
        self.positions = {}
        self.velocities = {}
        for key, value in ephemeris["bodies"].items():
            self.positions[key] = np.asarray(value["positions_km"], dtype=np.float64)
            self.velocities[key] = np.asarray(value["velocities_km_s"], dtype=np.float64)
        del ephemeris
        if set(self.bodies) != set(self.positions):
            raise ValueError("Catalog and ephemeris targets do not match")
        if len(self.bodies) != 71:
            raise ValueError(f"Expected 71 core bodies, received {len(self.bodies)}")
        self.orientations = read_json(ROOT / "data/orientations.json")["bodies"]
        self.assets = read_json(ROOT / "data/asset_manifest.json")
        with gzip.open(ROOT / "data/horizons/phobos-refined.json.gz", "rt") as stream:
            refined = json.load(stream)
        self.refined_jd = np.asarray(refined["times_jd_tdb"], dtype=np.float64)
        self.refined_phobos = (
            np.asarray(refined["bodies"]["phobos"]["positions_km"], dtype=np.float64),
            np.asarray(refined["bodies"]["phobos"]["velocities_km_s"], dtype=np.float64),
        )
        self.refined_context = {}
        self.meshes = {}
        self.extras = {}
        self.rotation_actions = {}
        self.motion_actions = {}
        self.sun_light = bpy.data.lights.new("Solar luminosity | scaled SI power", "POINT")
        self.sun_light.energy = SUN_POWER
        self.sun_light.shadow_soft_size = self.bodies["sun"]["radius_km"] / KM_PER_BU
        self.sun_light["luminosity_W"] = 3.828e26
        self.sun_light["km_per_blender_unit"] = KM_PER_BU
        self.sun_light["notes"] = "Finite spherical point source; inverse-square illumination."
        self.world = bpy.data.worlds.new("Space | no ambient fill")
        self.world.use_nodes = True
        self.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0

    def scene(self, name, origin):
        scene = bpy.data.scenes.new(name)
        scene.world = self.world
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 96
        scene.cycles.use_denoising = True
        scene.cycles.max_bounces = 8
        scene.cycles.transparent_max_bounces = 24
        scene.render.resolution_x = 1600
        scene.render.resolution_y = 1000
        scene.render.resolution_percentage = 100
        scene.render.image_settings.file_format = "PNG"
        scene.render.fps = 24
        scene.frame_start = 1
        scene.frame_end = self.frame_end
        scene.frame_set(1)
        scene.unit_settings.system = "METRIC"
        scene.unit_settings.scale_length = KM_PER_BU * 1000
        scene.unit_settings.length_unit = "KILOMETERS"
        scene.view_settings.view_transform = "AgX"
        scene["km_per_blender_unit"] = KM_PER_BU
        scene["reference_frame"] = "ICRF, geometric simultaneous states"
        scene["origin_id"] = origin or "solar-system-barycenter"
        scene["epoch_start_jd_tdb"] = float(self.jd[0])
        scene["epoch_stop_jd_tdb"] = float(self.jd[-1])
        scene["seconds_per_frame"] = 3600.0
        scene["date_interval_utc"] = "2026-09-05 00:00 to 2027-09-05 00:00"
        scene["time_note"] = "TDB internally; future UTC labels use the cached leap-second table."
        scene["scale_note"] = "Body dimensions and translations share one physical scale."
        scene["animation_note"] = (
            "Hourly source states, with 15-minute Phobos refinement. "
            "Cubic interpolation is approximate between samples."
        )
        for month, frame in [
            ("2026-09-05", 1), ("2026-10-05", 721), ("2026-11-05", 1465),
            ("2026-12-05", 2185), ("2027-01-05", 2929), ("2027-02-05", 3673),
            ("2027-03-05", 4345), ("2027-04-05", 5089), ("2027-05-05", 5809),
            ("2027-06-05", 6553), ("2027-07-05", 7273), ("2027-08-05", 8017),
            ("2027-09-05", 8761),
        ]:
            if frame <= scene.frame_end:
                scene.timeline_markers.new(month, frame=frame)
        BUILD_REPORT["scenes"].append({"name": name, "origin": origin, "frames": scene.frame_end})
        return scene

    def geometry(self, body):
        key = body["id"]
        radius = body["radius_km"] / KM_PER_BU
        axes = np.array(body.get("radii_km") or [body["radius_km"]] * 3) / KM_PER_BU
        detail = 160 if body["category"] in {"planet", "star"} else 96
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=detail, ring_count=detail // 2, radius=1
        )
        obj = bpy.context.object
        mesh = obj.data
        mesh.name = f"{body['name']} | physical geometry"
        shape_note = "Ellipsoid using catalog axes; no exaggerated terrain."
        if key in {"arrokoth", "67p", "67p-churyumov-gerasimenko"} or body["name"].startswith("67P/"):
            # A labeled contact-binary reconstruction, not a downloaded mission shape.
            for vertex in mesh.vertices:
                x, y, z = vertex.co
                waist = 0.56 + 0.44 * abs(float(x)) ** 0.55
                vertex.co = (x, y * waist, z * waist)
            shape_note = "RECONSTRUCTION: contact-binary waist; not a resolved mission shape."
        elif body["radius_km"] < 150 and body["category"] not in {"star", "planet"}:
            for vertex in mesh.vertices:
                x, y, z = vertex.co
                variation = 1 + 0.035 * (
                    math.sin(7 * x + 3 * y) * math.cos(6 * z - 2 * x)
                    + 0.5 * math.sin(13 * y + 5 * z)
                )
                vertex.co *= variation
                if key in {"bennu", "ryugu"}:
                    ridge = 1 + 0.10 * (1 - abs(float(z))) ** 5
                    vertex.co.x *= ridge
                    vertex.co.y *= ridge
            shape_note = "RECONSTRUCTION: modest irregularity fitted inside catalog axes."
            if key in {"bennu", "ryugu"}:
                shape_note += " Qualitative equatorial ridge; not a mission shape model."
        coordinates = np.array([v.co[:] for v in mesh.vertices])
        # Fit each catalog axis without enlarging small bodies for legibility.
        extents = np.max(np.abs(coordinates), axis=0)
        for vertex in mesh.vertices:
            vertex.co = tuple(np.asarray(vertex.co) * axes / extents)
        for polygon in mesh.polygons:
            polygon.use_smooth = True
        material = make_surface_material(body, self.assets, ROOT)
        mesh.materials.append(material)
        solar_node = material.node_tree.nodes.get("Solar direction world")
        if solar_node is not None:
            delta = self.positions["sun"] - self.positions[key]
            directions = delta / np.linalg.norm(delta, axis=1)[:, None]
            solar_action, bag = new_action(f"Day-night incidence | {body['name']}", "NODETREE")
            for axis in range(3):
                solar_node.inputs[axis].default_value = float(directions[0, axis])
                add_curve(bag, f'nodes["Solar direction world"].inputs[{axis}].default_value',
                          0, self.frames, directions[:, axis])
            assign_action(material.node_tree, solar_action)
            material["solar_direction_animation"] = "Native hourly ICRF body-to-Sun directions."
        mesh["body_id"] = key
        mesh["geometry_note"] = shape_note
        mesh["source_radius_km"] = body["radius_km"]
        mesh["axes_km"] = list(axes * KM_PER_BU)
        mesh.use_fake_user = True
        bpy.data.objects.remove(obj, do_unlink=True)
        self.meshes[key] = mesh
        self.extras[key] = []
        cloud = make_cloud_material(body, self.assets, ROOT)
        if cloud is not None:
            cloud_height = float(cloud["recommended_altitude_km"])
            cloud_mesh = mesh.copy()
            cloud_mesh.name = f"{body['name']} | clouds"
            cloud_mesh.materials.clear()
            cloud_mesh.materials.append(cloud)
            for vertex in cloud_mesh.vertices:
                vertex.co *= 1 + cloud_height / body["radius_km"]
            self.extras[key].append(("Clouds", cloud_mesh))
        atmosphere = make_atmosphere_material(body)
        if atmosphere is not None and key in ATMOSPHERE_HEIGHTS:
            height = float(atmosphere["recommended_shell_height_km"])
            atmosphere_mesh = mesh.copy()
            atmosphere_mesh.name = f"{body['name']} | atmosphere {height:g} km"
            atmosphere_mesh.materials.clear()
            atmosphere_mesh.materials.append(atmosphere)
            for vertex in atmosphere_mesh.vertices:
                vertex.co *= 1 + height / body["radius_km"]
            self.extras[key].append(("Atmosphere", atmosphere_mesh))
        BUILD_REPORT["geometry"][key] = {
            "radius_km": body["radius_km"], "axes_km": list(axes * KM_PER_BU),
            "vertices": len(mesh.vertices), "note": shape_note,
            "material": mesh.materials[0].name,
            "source_status": mesh.materials[0].get("source_status", "UNSPECIFIED"),
        }

    def prepare_orientation(self, body):
        key = body["id"]
        orientation = self.orientations.get(key)
        if not orientation:
            self.rotation_actions[key] = (None, None)
            return
        centuries = (self.jd - 2451545.0) / 36525
        days = self.jd - 2451545.0
        ra = np.polynomial.polynomial.polyval(centuries, orientation["pole_ra_deg"])
        dec = np.polynomial.polynomial.polyval(centuries, orientation["pole_dec_deg"])
        w = np.polynomial.polynomial.polyval(days, orientation["prime_meridian_deg"])
        pole, pole_bag = new_action(f"Pole | {body['name']}")
        indices = np.unique(np.array([0, len(self.jd) // 2, len(self.jd) - 1]))
        add_curve(pole_bag, "rotation_euler", 0, self.frames[indices], np.deg2rad(90 - dec[indices]))
        add_curve(pole_bag, "rotation_euler", 2, self.frames[indices], np.deg2rad(ra[indices] + 90))
        spin, spin_bag = new_action(f"Prime meridian | {body['name']}")
        phase = w - w[0] + w[0] % 360
        add_curve(spin_bag, "rotation_euler", 2, self.frames[indices], np.deg2rad(phase[indices]))
        self.rotation_actions[key] = (pole, spin)

    def motion(self, key, origin):
        cache_key = (key, origin)
        if cache_key in self.motion_actions:
            return self.motion_actions[cache_key]
        position = self.positions[key]
        velocity = self.velocities[key]
        seconds, frames = self.seconds, self.frames
        if "phobos" in (key, origin):
            position, velocity = self.refined_state(key)
            if origin:
                reference_position, reference_velocity = self.refined_state(origin)
                position = position - reference_position
                velocity = velocity - reference_velocity
            seconds = (self.refined_jd - self.jd[0]) * 86400
            frames = seconds / 3600 + 1
        elif origin:
            position = position - self.positions[origin]
            velocity = velocity - self.velocities[origin]
        tolerance = min(0.25, max(0.0001, self.bodies[key]["radius_km"] * 0.0005))
        indices, error = hermite_indices(seconds, position, velocity, tolerance)
        action, bag = new_action(f"Position | {key} relative to {origin or 'SSB'}")
        allowed = np.maximum(tolerance * 2, np.linalg.norm(position, axis=1) * 4e-7)
        for attempt in range(5):
            for curve in list(bag.fcurves):
                bag.fcurves.remove(curve)
            curves = [
                add_curve(
                    bag, "location", axis, frames[indices],
                    position[indices, axis] / KM_PER_BU,
                    velocity[indices, axis] * 3600.0 / KM_PER_BU,
                )
                for axis in range(3)
            ]
            native = np.column_stack([
                np.fromiter((curve.evaluate(float(frame)) for frame in frames), float, len(frames))
                for curve in curves
            ]) * KM_PER_BU
            native_errors = np.linalg.norm(native - position, axis=1)
            failed = np.flatnonzero(native_errors > allowed)
            if not len(failed):
                break
            # Blender's float32 handle times and Bezier inversion introduce error
            # beyond the double-precision Hermite fit. Retain offending source knots.
            indices = (np.arange(len(frames)) if attempt == 3
                       else np.unique(np.r_[indices, failed]))
        else:
            raise RuntimeError(f"Native position curves exceed their error budget: {key}/{origin}")
        self.motion_actions[cache_key] = action
        BUILD_REPORT["motion"].append({
            "body": key, "origin": origin, "keys": len(indices),
            "source_sample_fit_error_km": error, "fit_tolerance_km": tolerance,
            "max_native_source_sample_error_km": float(np.max(native_errors)),
            "note": "Native curves checked at every source epoch; independent subframe checks are separate.",
        })
        return action

    def refined_state(self, key):
        if key == "phobos":
            return self.refined_phobos
        if key in self.refined_context:
            return self.refined_context[key]
        indices = np.clip(np.searchsorted(self.jd, self.refined_jd, side="right") - 1,
                          0, len(self.jd) - 2)
        span = (self.jd[indices + 1] - self.jd[indices])[:, None] * 86400
        u = ((self.refined_jd - self.jd[indices])[:, None] * 86400) / span
        p0, p1 = self.positions[key][indices], self.positions[key][indices + 1]
        v0, v1 = self.velocities[key][indices], self.velocities[key][indices + 1]
        position = ((2*u**3 - 3*u**2 + 1)*p0 + (u**3 - 2*u**2 + u)*span*v0
                    + (-2*u**3 + 3*u**2)*p1 + (u**3 - u**2)*span*v1)
        velocity = ((6*u**2 - 6*u)*p0/span + (3*u**2 - 4*u + 1)*v0
                    + (-6*u**2 + 6*u)*p1/span + (3*u**2 - 2*u)*v1)
        self.refined_context[key] = (position, velocity)
        return position, velocity

    def body_instance(self, collection, key, origin):
        body = self.bodies[key]
        name = body["name"]
        location = linked_object(collection, f"{name} | position")
        location.empty_display_type = "PLAIN_AXES"
        location.empty_display_size = body["radius_km"] / KM_PER_BU
        location["body_id"] = key
        location["horizons_id"] = body["horizons_id"]
        location["category"] = body["category"]
        location["radius_km"] = body["radius_km"]
        location["physical_notes"] = body.get("physical_notes", "")
        location["sources"] = json.dumps(body.get("source_urls", []))
        if key != origin:
            assign_action(location, self.motion(key, origin))
        pole = linked_object(collection, f"{name} | pole")
        pole.parent = location
        pole.rotation_mode = "XYZ"
        spin = linked_object(collection, f"{name} | prime meridian")
        spin.parent = pole
        spin.rotation_mode = "XYZ"
        pole_action, spin_action = self.rotation_actions[key]
        if pole_action:
            assign_action(pole, pole_action)
            assign_action(spin, spin_action)
            pole["orientation_note"] = self.orientations[key].get("notes", "")
            pole["model"] = "IAU PCK secular polynomial; periodic corrections omitted"
        else:
            pole["orientation_note"] = "UNCONSTRAINED: fixed orientation; no invented spin or pole."
            if key in RING_POLES:
                ra, dec = map(math.radians, RING_POLES[key])
                pole.rotation_euler = (math.pi / 2 - dec, 0, ra + math.pi / 2)
                pole["orientation_note"] = (
                    "Occultation-derived pole with assumed equatorial ring plane. "
                    "Prime meridian phase is unconstrained and held fixed. " + RING_NOTES[key]
                )
        mesh_obj = linked_object(collection, f"{name} | surface", self.meshes[key])
        mesh_obj.parent = spin
        mesh_obj["body_id"] = key
        mesh_obj["radius_km"] = body["radius_km"]
        mesh_obj["source_status"] = self.meshes[key].materials[0].get("source_status", "UNSPECIFIED")
        if key == "sun":
            mesh_obj.visible_shadow = False
            light = linked_object(collection, "Sun | physical illumination", self.sun_light)
            light.parent = location
        for suffix, mesh in self.extras[key]:
            shell = linked_object(collection, f"{name} | {suffix}", mesh)
            shell.parent = spin
        for ring in RINGS.get(key, []):
            self.ring_instance(collection, body, ring, location, pole)
        return location

    def ring_instance(self, collection, body, ring, location, pole):
        name, inner, outer, tau = ring[:4]
        mesh_name = f"{body['name']} | {name} | ring mesh"
        mesh = bpy.data.meshes.get(mesh_name)
        if mesh is None:
            vertices, faces = [], []
            segments = 1024
            for i in range(segments + 1):
                theta = 2 * math.pi * i / segments
                for radial in [inner, outer]:
                    vertices.append((radial / KM_PER_BU * math.cos(theta),
                                     radial / KM_PER_BU * math.sin(theta), 0))
            for i in range(segments):
                a = 2 * i
                faces.append((a, a + 1, a + 3, a + 2))
            mesh = bpy.data.meshes.new(mesh_name)
            mesh.from_pydata(vertices, [], faces)
            uv = mesh.uv_layers.new(name="UVMap")
            for polygon in mesh.polygons:
                for loop in polygon.loop_indices:
                    vertex_index = mesh.loops[loop].vertex_index
                    uv.data[loop].uv = (vertex_index // 2 / segments, vertex_index % 2)
            ring_body = dict(body, ring_name=name, ring_optical_depth=tau,
                             ring_inner_km=inner, ring_outer_km=outer)
            mesh.materials.append(make_ring_material(ring_body))
            mesh["inner_radius_km"] = inner
            mesh["outer_radius_km"] = outer
            mesh["normal_optical_depth"] = tau
            mesh["source_note"] = RING_NOTES[body["id"]]
            mesh["geometry_note"] = "Zero-thickness optical sheet; circular mean-radius approximation."
        obj = linked_object(collection, mesh_name.replace(" | ring mesh", ""), mesh)
        obj.parent = pole
        if body["id"] in RING_POLES:
            obj.parent = location
            ra, dec = map(math.radians, RING_POLES[body["id"]])
            obj.rotation_euler = (math.pi / 2 - dec, 0, ra + math.pi / 2)
        return obj

    def camera(self, scene, name, position, target, radius, orthographic=False):
        data = bpy.data.cameras.new(name)
        camera = linked_object(scene.collection, name, data)
        camera.location = Vector(position)
        direction = Vector(target) - camera.location
        camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        data.lens = 48
        data.clip_start = max(1e-6, radius * 0.005)
        data.clip_end = max(1e4, float(np.max(np.linalg.norm(
            self.positions["sun"] - self.positions.get(scene["origin_id"], 0), axis=1
        ))) / KM_PER_BU * 3, radius * 500)
        if orthographic:
            data.type = "ORTHO"
            data.ortho_scale = radius
        scene.camera = camera
        return camera

    def closeup(self, key, index):
        body = self.bodies[key]
        scene = self.scene(f"{index:02d} | {body['name']}", key)
        content = bpy.data.collections.new(f"{body['name']} | physical system")
        scene.collection.children.link(content)
        members = {key, "sun"}
        parent = body.get("parent_id")
        if parent and parent != "sun":
            members.add(parent)
            members.update(k for k, b in self.bodies.items() if b.get("parent_id") == parent)
        else:
            members.update(k for k, b in self.bodies.items() if b.get("parent_id") == key)
        for member in sorted(members):
            self.body_instance(content, member, key)
        scene["included_bodies"] = json.dumps(sorted(members))
        scene["omitted_context"] = "Remote unrelated systems omitted from this target-centered view."
        scene["opening_frame"] = 1
        if parent and parent != "sun":
            toward_parent = self.positions[parent] - self.positions[key]
            toward_sun = self.positions["sun"] - self.positions[key]
            parent_distance = np.linalg.norm(toward_parent, axis=1)
            sun_distance = np.linalg.norm(toward_sun, axis=1)
            cosine = np.sum(toward_parent * toward_sun, axis=1) / (parent_distance * sun_distance)
            separation = np.arccos(np.clip(cosine, -1, 1))
            silhouette = np.arcsin(np.clip(
                (max(self.bodies[parent].get("radii_km") or [self.bodies[parent]["radius_km"]])
                 + body["radius_km"]) / parent_distance, 0, 1
            ))
            visible = np.flatnonzero(separation > silhouette)
            if len(visible):
                scene["opening_frame"] = int(round(self.frames[int(visible[0])]))
            scene["opening_frame_note"] = "First source frame outside the parent's geometric eclipse silhouette."
        source_radius = body["radius_km"] / KM_PER_BU
        frame_radius = max(body.get("radii_km") or [body["radius_km"]]) / KM_PER_BU
        if key in RINGS:
            frame_radius = max(frame_radius, max(r[2] for r in RINGS[key]) / KM_PER_BU)
            if key == "saturn":
                frame_radius = 145000 / KM_PER_BU
            elif key in {"jupiter", "uranus"}:
                frame_radius = source_radius * 2.3
        sun_vector = self.positions["sun"][0] - self.positions[key][0]
        if key == "sun":
            view = Vector((1, -2, 0.5)).normalized()
            scene.view_settings.exposure = 1
        else:
            sun_direction = Vector(sun_vector).normalized()
            pole_info = self.orientations.get(key)
            if pole_info:
                ra = math.radians(pole_info["pole_ra_deg"][0])
                dec = math.radians(pole_info["pole_dec_deg"][0])
                north = Vector((math.cos(ra) * math.cos(dec), math.sin(ra) * math.cos(dec), math.sin(dec)))
            elif key in RING_POLES:
                ra, dec = map(math.radians, RING_POLES[key])
                north = Vector((math.cos(ra) * math.cos(dec), math.sin(ra) * math.cos(dec), math.sin(dec)))
            else:
                north = Vector((0, 0, 1))
            tangent = sun_direction.cross(north)
            if tangent.length < 0.01:
                tangent = sun_direction.cross(Vector((0, 1, 0)))
            tangent.normalize()
            view = (sun_direction + tangent * 0.55 + north * 0.22).normalized()
            if key in RINGS:
                illuminated_side = 1 if sun_direction.dot(north) >= 0 else -1
                view = (sun_direction + tangent * 0.45 + north * 0.65 * illuminated_side).normalized()
            distance_au = np.linalg.norm(sun_vector) / AU_KM
            scene.view_settings.exposure = -8 + 2 * math.log2(distance_au)
        camera = self.camera(scene, f"{body['name']} | close-up camera",
                             view * frame_radius * 5.5, (0, 0, 0), source_radius)
        camera["view_note"] = "Target-tracking, inertial fixed offset; phase changes during the year."
        annotations = bpy.data.collections.new(f"{body['name']} | camera annotations")
        scene.collection.children.link(annotations)
        annotations["physical"] = False
        depth = frame_radius * 2
        label_material = annotation_material(f"Annotation | {key}", scene.view_settings.exposure)
        camera_text(annotations, camera, body["name"], (-depth * 0.34, depth * 0.19, -depth),
                    depth * 0.017, label_material, f"{body['name']} | title")
        status = self.meshes[key].materials[0].get("source_status", "UNSPECIFIED")
        camera_text(annotations, camera, f"True scale   /   surface {status.lower()}",
                    (-depth * 0.34, -depth * 0.206, -depth),
                    depth * 0.008, label_material, f"{body['name']} | provenance label")
        scene.frame_set(scene["opening_frame"])
        return scene

    def overview(self, inner=False):
        scene = self.scene("00 | Inner Solar System" if inner else "00 | Solar System", None)
        content = bpy.data.collections.new(f"{scene.name} | physical bodies")
        scene.collection.children.link(content)
        for key in self.bodies:
            self.body_instance(content, key, None)
        limit = AU_KM * (2.3 if inner else 110) / KM_PER_BU
        if not inner:
            limit = max(limit, max(np.linalg.norm(p[0]) / KM_PER_BU for p in self.positions.values()) * 1.2)
        axis = Vector((0.35, -0.6, 1)).normalized()
        camera = self.camera(scene, "Survey camera | true distances", axis * limit * 2.5,
                             (0, 0, 0), limit * 2, orthographic=True)
        camera.data.clip_end = limit * 10
        camera.data.clip_start = limit * 0.001
        scene.view_settings.exposure = -7
        guides = bpy.data.collections.new(f"{scene.name} | annotations, not physical bodies")
        scene.collection.children.link(guides)
        guides["physical"] = False
        guides["note"] = "Markers, fonts and path widths are annotations, not body dimensions."
        material = annotation_material("Annotation | survey", scene.view_settings.exposure)
        camera_text(guides, camera, "Inner Solar System" if inner else "Solar System",
                    (-limit * 0.92, limit * 0.52, -limit), limit * 0.047,
                    material, "Survey title")
        camera_text(guides, camera, "2026-09-05 to 2027-09-05  /  geometric ICRF ephemerides",
                    (-limit * 0.92, limit * 0.475, -limit), limit * 0.018,
                    material, "Survey interval")
        camera_text(guides, camera, "Dots and path widths are annotations. Physical bodies retain their true sizes and distances.",
                    (-limit * 0.92, -limit * 0.565, -limit), limit * 0.017,
                    material, "Survey annotation disclosure")
        wanted = ["sun", "mercury", "venus", "earth", "mars"] if inner else [
            "sun", "jupiter", "saturn", "uranus", "neptune", "pluto",
            "haumea", "makemake", "eris", "sedna", "quaoar", "gonggong",
        ]
        occupied = []
        camera_rotation = camera.rotation_euler.to_matrix()
        for key in wanted:
            if key not in self.bodies:
                continue
            body = self.bodies[key]
            mover = linked_object(guides, f"{body['name']} | annotation position")
            assign_action(mover, self.motion(key, None))
            text = bpy.data.curves.new(f"{body['name']} label", "FONT")
            text.body = body["name"]
            font_size = limit * 0.021
            text.size = 1
            text.materials.append(material)
            projected = camera_rotation.transposed() @ Vector(self.positions[key][0] / KM_PER_BU)
            offset_x, offset_y = limit * 0.012, limit * 0.012
            width = len(body["name"]) * font_size * 0.64
            height = font_size * 1.3
            for attempt in range(24):
                offset_y = limit * 0.012 + ((attempt + 1) // 2) * height * (1 if attempt % 2 else -1)
                bounds = (projected.x + offset_x, projected.y + offset_y,
                          projected.x + offset_x + width, projected.y + offset_y + height)
                if not any(bounds[0] < b[2] and bounds[2] > b[0]
                           and bounds[1] < b[3] and bounds[3] > b[1] for b in occupied):
                    break
            occupied.append(bounds)
            label = linked_object(guides, f"{body['name']} | label", text)
            label.parent = mover
            label.rotation_euler = camera.rotation_euler
            label.scale = (font_size, font_size, font_size)
            label.location = camera_rotation @ Vector((offset_x, offset_y, 0))
            leader_data = bpy.data.curves.new(f"{body['name']} | annotation leader", "CURVE")
            leader_data.dimensions = "3D"
            leader_data.bevel_depth = limit * 0.00018
            segment = leader_data.splines.new("POLY")
            segment.points.add(1)
            segment.points[0].co = (0, 0, 0, 1)
            segment.points[1].co = (*label.location, 1)
            leader_data.materials.append(material)
            leader = linked_object(guides, leader_data.name, leader_data)
            leader.parent = mover
            leader["physical"] = False
            leader.visible_shadow = False
            bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=limit * 0.0022)
            dot = bpy.context.object
            dot.name = f"{body['name']} | annotation marker, NOT radius"
            for owner in list(dot.users_collection):
                owner.objects.unlink(dot)
            guides.objects.link(dot)
            dot.parent = mover
            dot.data.materials.append(material)
            dot["physical"] = False
            dot.visible_shadow = False
            if key != "sun":
                curve = bpy.data.curves.new(f"{body['name']} | one-year trace", "CURVE")
                curve.dimensions = "3D"
                curve.bevel_depth = limit * 0.00025
                curve.bevel_resolution = 1
                stride = max(1, len(self.jd) // 400)
                points = self.positions[key][::stride] / KM_PER_BU
                spline = curve.splines.new("POLY")
                spline.points.add(len(points) - 1)
                spline.points.foreach_set("co", np.column_stack((points, np.ones(len(points)))).ravel())
                curve.materials.append(material)
                line = linked_object(guides, curve.name, curve)
                line["physical"] = False
                line.visible_shadow = False
        scene["annotation_note"] = "Survey markers are not body sizes. Traces cover only the selected year."
        scene.frame_set(1)
        return scene

    def finish(self, prototype=False):
        readme_path = ROOT / "README.md"
        if readme_path.exists():
            text = bpy.data.texts.new("START HERE | scientific model")
            text.write(readme_path.read_text())
        for filename in ["catalog.json", "asset_manifest.json", "orientations.json"]:
            text = bpy.data.texts.new(filename)
            text.write((ROOT / "data" / filename).read_text())
        notes = bpy.data.texts.new("Scientific limitations")
        notes.write(
            "All physical meshes and positions use 1 BU = 1 km.\n"
            "Use the scene selector for 71 target-centered close-ups and two surveys.\n"
            "Hourly geometric ICRF states, with 15-minute Phobos refinement, are not apparent observer positions.\n"
            "Between-source-sample motion and secular PCK orientations are approximations.\n"
            "Unknown rotations remain fixed and explicitly unconstrained.\n"
            "Surface reconstructions, clouds and ring fine structure are not dated observations.\n"
            "The source epoch and body/asset records are embedded as text data blocks.\n"
            "Survey dots, labels and line widths are annotations, not enlarged planets.\n"
        )
        initial = next(s for s in bpy.data.scenes if s.name.endswith("| Earth"))
        bpy.context.window.scene = initial
        for scene in bpy.data.scenes:
            scene.frame_set(int(scene.get("opening_frame", 1)))
        for screen in bpy.data.screens:
            for area in screen.areas:
                if area.type == "VIEW_3D":
                    area.spaces.active.region_3d.view_perspective = "CAMERA"
                    area.spaces.active.shading.type = "MATERIAL"
                    area.spaces.active.shading.use_scene_lights = True
                    area.spaces.active.shading.use_scene_world = True
                    area.spaces.active.overlay.show_overlays = False
                    area.spaces.active.clip_end = 1e9
        for image in bpy.data.images:
            if image.source == "FILE" and image.filepath and image.packed_file is None:
                image.pack()
        BUILD_REPORT["body_count"] = len(self.bodies)
        BUILD_REPORT["frame_end"] = self.frame_end
        BUILD_REPORT["km_per_blender_unit"] = KM_PER_BU
        BUILD_REPORT["solar_power_blender"] = float(self.sun_light.energy)
        BUILD_REPORT["ephemeris_metadata"] = self.meta
        (ROOT / "data/build_report.json").write_text(json.dumps(BUILD_REPORT, indent=2))
        bpy.context.preferences.filepaths.save_version = 0
        filename = "precision_prototype.blend" if prototype else "solar_system.blend"
        bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / filename), compress=True)
        print("BUILD_COMPLETE", len(self.bodies), len(bpy.data.scenes), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prototype", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    builder = Builder()
    staging = bpy.context.scene
    staging.name = "Assembly staging"
    for body in builder.bodies.values():
        builder.geometry(body)
        builder.prepare_orientation(body)
        print("GEOMETRY", body["id"], flush=True)
    keys = ["earth", "moon", "io", "phobos", "bennu", "saturn", "sedna"] if args.prototype else list(builder.bodies)
    for index, key in enumerate(keys, 1):
        builder.closeup(key, index)
        print("CLOSEUP", index, key, flush=True)
    if not args.prototype:
        builder.overview()
        builder.overview(inner=True)
    bpy.data.scenes.remove(staging)
    builder.finish(prototype=args.prototype)


if __name__ == "__main__":
    main()
