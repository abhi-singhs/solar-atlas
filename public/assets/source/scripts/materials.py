"""Physically motivated Blender materials. Geometry and lighting belong to caller.

All distances use 1 Blender unit = 1000 km unless body["km_per_unit"] overrides it.
Earth city emission is off until the caller supplies sun_direction_world or
animates the three inputs of the "Solar direction world" Combine XYZ node.
This is the unit vector from the body toward the Sun, in world coordinates.
"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from pathlib import Path

import bpy

_CACHE = {}
_VERSION = 6


def _key(body):
    return str(body.get("id") or body.get("name", "unnamed")).lower().replace("/", "-").replace(" ", "-")


def _entry(body, manifest):
    key = _key(body)
    key = manifest.get("body_id_aliases", {}).get(key, key)
    entries = manifest.get("bodies", {})
    if key in entries:
        return entries[key]
    name = body.get("name", "").lower()
    return next((entry for entry in entries.values() if entry.get("name", "").lower() == name), {})


def _new(body, role):
    cache_key = (_key(body), role)
    material = _CACHE.get(cache_key)
    if material is not None:
        try:
            if (material.name in bpy.data.materials and material.get("material_complete")
                    and material.get("material_module_version") == _VERSION):
                return material, None
        except ReferenceError:
            pass
    name = "Solar/" + _key(body) + "/" + role
    material = bpy.data.materials.get(name)
    if (material is not None and material.get("material_module_version") == _VERSION
            and material.get("material_complete")):
        _CACHE[cache_key] = material
        return material, None
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.node_tree.nodes.clear()
    material["material_module_version"] = _VERSION
    material["body_id"] = _key(body)
    material["role"] = role
    _CACHE[cache_key] = material
    return material, Graph(material)


class Graph:
    def __init__(self, material):
        self.material = material
        self.nodes = material.node_tree.nodes
        self.links = material.node_tree.links
        self.output = self.node("ShaderNodeOutputMaterial", "Material output", (900, 0))

    def node(self, node_type, name, location=(0, 0)):
        node = self.nodes.new(node_type)
        node.name = node.label = name
        node.location = location
        return node

    def link(self, source, target):
        self.links.new(source, target)

    def math(self, operation, name, a=None, b=None):
        node = self.node("ShaderNodeMath", name)
        node.operation = operation
        for socket, value in zip(node.inputs, (a, b)):
            if value is None:
                continue
            if isinstance(value, (int, float)):
                socket.default_value = value
            else:
                self.link(value, socket)
        return node.outputs[0]

    def ramp(self, name, source, points, interpolation="LINEAR"):
        node = self.node("ShaderNodeValToRGB", name)
        ramp = node.color_ramp
        ramp.interpolation = interpolation
        while len(ramp.elements) > 2:
            ramp.elements.remove(ramp.elements[-1])
        for index, (position, color) in enumerate(points):
            element = ramp.elements[index] if index < 2 else ramp.elements.new(position)
            element.position = position
            element.color = (*color[:3], color[3] if len(color) > 3 else 1)
        self.link(source, node.inputs[0])
        return node.outputs["Color"]

    def mix_color(self, name, fac, a, b):
        node = self.node("ShaderNodeMixRGB", name)
        for socket, value in ((node.inputs[0], fac), (node.inputs[1], a), (node.inputs[2], b)):
            if isinstance(value, (int, float)):
                socket.default_value = value
            elif isinstance(value, (list, tuple)):
                socket.default_value = (*value[:3], 1)
            else:
                self.link(value, socket)
        return node.outputs[0]

    def uv(self):
        node = self.nodes.get("Surface UV")
        if node is None:
            node = self.node("ShaderNodeUVMap", "Surface UV", (-1100, 0))
            node.uv_map = "UVMap"
        return node.outputs["UV"]

    def registered_uv(self, record, image_height):
        registration = record.get("uv_registration", {})
        values = tuple(float(registration.get(key, default)) for key, default in
                       (("u_scale", 1.), ("v_scale", 1.), ("u_offset_cycles", 0.), ("v_offset_cycles", 0.)))
        half_texel = .5/max(int(image_height), 1)
        signature = hashlib.sha256(repr((values, half_texel)).encode()).hexdigest()[:8]
        output_name = "Registered UV "+signature
        existing = self.nodes.get(output_name)
        if existing is not None:
            return existing.outputs["Vector"]
        mapping = self.node("ShaderNodeMapping", "UV scale and offset "+signature)
        mapping.vector_type = "POINT"
        _set(mapping, "Scale", (values[0], values[1], 1.))
        _set(mapping, "Location", (values[2], values[3], 0.))
        self.link(self.uv(), mapping.inputs["Vector"])
        separate = self.node("ShaderNodeSeparateXYZ", "Registered longitude and latitude "+signature)
        self.link(mapping.outputs["Vector"], separate.inputs[0])
        latitude = self.math("MAXIMUM", "Clamp south latitude "+signature, separate.outputs["Y"], half_texel)
        latitude = self.math("MINIMUM", "Clamp north latitude "+signature, latitude, 1.-half_texel)
        output = self.node("ShaderNodeCombineXYZ", output_name)
        self.link(separate.outputs["X"], output.inputs["X"])
        self.link(latitude, output.inputs["Y"])
        return output.outputs["Vector"]

    def image(self, role, record, root):
        path = (Path(root)/record["path"]).resolve()
        if not path.is_file():
            raise FileNotFoundError(f"Missing {role} map: {path}")
        space = record.get("color_space", "sRGB")
        image = next((im for im in bpy.data.images
                      if im.get("asset_absolute_path") == str(path)
                      and im.colorspace_settings.name == space), None)
        if image is None:
            image = bpy.data.images.load(str(path), check_existing=False)
            image.colorspace_settings.name = space
            image["asset_absolute_path"] = str(path)
            image["source_url"] = record.get("source_url", "")
            image["credit"] = record.get("credit", "")
            image["usage"] = record.get("usage", "")
        node = self.node("ShaderNodeTexImage", role.replace("_", " ").capitalize()+" map", (-850, 0))
        node.image = image
        node.interpolation = "Linear"
        node.extension = "REPEAT"
        node["uv_registration"] = json.dumps(record.get("uv_registration", {}))
        # Clamp V to edge texel centers so periodic U cannot also wrap the poles.
        self.link(self.registered_uv(record, image.size[1]), node.inputs["Vector"])
        return node.outputs["Color"]

    def principled(self, name, color=None, roughness=.85, ior=1.45):
        shader = self.node("ShaderNodeBsdfPrincipled", name, (600, 0))
        _set(shader, "Roughness", roughness)
        _set(shader, "Metallic", 0.)
        _set(shader, "IOR", ior)
        _set(shader, "Coat Weight", 0.)
        _set(shader, "Subsurface Weight", 0.)
        if color is not None:
            if isinstance(color, (list, tuple)):
                _set(shader, "Base Color", (*color[:3], 1.))
            else:
                self.link(color, shader.inputs["Base Color"])
        return shader


def _set(node, name, value):
    socket = node.inputs.get(name)
    if socket is not None:
        socket.default_value = value


def _metadata(material, status, description, urls, **values):
    material["source_status"] = status
    material["description"] = description
    material["source_urls"] = json.dumps(sorted(set(str(url) for url in urls if url)))
    for key, value in values.items():
        material[key] = value
    material["material_complete"] = True


def _procedural(graph, body, profile):
    color = profile.get("linear_reflectance", [.10, .095, .085])
    kind = profile.get("kind", "regolith")
    contrast = max(.18, float(profile.get("contrast", .06)))
    seed = int(profile.get("seed", int(hashlib.sha256(_key(body).encode()).hexdigest()[:8], 16)))
    coords = graph.node("ShaderNodeTexCoord", "Body-fixed reconstruction coordinates", (-1100, 350))
    noise = graph.node("ShaderNodeTexNoise", "Unresolved reflectance variation", (-850, 350))
    noise.noise_dimensions = "4D"
    _set(noise, "Scale", 3.2 + (seed % 37)/11)
    _set(noise, "Detail", 3.)
    _set(noise, "Roughness", .65)
    _set(noise, "W", (seed % 10000)/31)
    graph.link(coords.outputs["Generated"], noise.inputs["Vector"])
    dark = [max(.001, c*(1-contrast)) for c in color]
    light = [min(.97, c*(1+contrast)) for c in color]
    base = graph.ramp("Composition-constrained reflectance", noise.outputs["Fac"],
                      [(.25, dark), (.75, light)])
    if kind in {"gas", "cloud", "haze"}:
        sep = graph.node("ShaderNodeSeparateXYZ", "Cloud latitude")
        graph.link(coords.outputs["Generated"], sep.inputs[0])
        frequency = {"gas": 80., "cloud": 15., "haze": 9.}[kind]
        phase = graph.math("MULTIPLY", "Zonal frequency", sep.outputs["Z"], frequency)
        wave = graph.math("SINE", "Subtle zonal variation", phase)
        wave = graph.math("MULTIPLY_ADD", "Normalize zonal variation", wave, .5)
        wave_node = wave.node
        wave_node.inputs[2].default_value = .5
        bands = graph.ramp("Conservative cloud bands", wave, [(0., dark), (1., light)])
        base = graph.mix_color("Haze-softened cloud contrast", .72, base, bands)
    return base, noise.outputs["Fac"], coords.outputs["Generated"]


def _earth(graph, body, maps, root, base):
    shader = graph.principled("Ocean and land", base, .76, 1.333)
    if "ocean_mask" in maps:
        ocean = graph.image("ocean_mask", maps["ocean_mask"], root)
        rough = graph.ramp("Ocean versus land roughness", ocean,
                           [(0., [.78]*3), (1., [.075]*3)])
        graph.link(rough, shader.inputs["Roughness"])
    if "night" in maps:
        night = graph.image("night", maps["night"], root)
        sun = graph.node("ShaderNodeCombineXYZ", "Solar direction world", (-850, -400))
        direction = body.get("sun_direction_world", [0., 0., 0.])
        for index, value in enumerate(direction[:3]):
            sun.inputs[index].default_value = float(value)
        normalize = graph.node("ShaderNodeVectorMath", "Unit solar direction")
        normalize.operation = "NORMALIZE"
        graph.link(sun.outputs[0], normalize.inputs[0])
        geometry = graph.node("ShaderNodeNewGeometry", "World surface normal")
        dot = graph.node("ShaderNodeVectorMath", "Solar incidence")
        dot.operation = "DOT_PRODUCT"
        graph.link(normalize.outputs[0], dot.inputs[0])
        graph.link(geometry.outputs["Normal"], dot.inputs[1])
        darkness = graph.node("ShaderNodeMapRange", "Night-only city mask")
        darkness.clamp = True
        darkness.interpolation_type = "SMOOTHSTEP"
        graph.link(dot.outputs["Value"], darkness.inputs["Value"])
        _set(darkness, "From Min", -.15)
        _set(darkness, "From Max", -.035)
        _set(darkness, "To Min", 1.)
        _set(darkness, "To Max", 0.)
        emit = graph.mix_color("Masked observed city light composite", darkness.outputs["Result"],
                               [0., 0., 0.], night)
        graph.link(emit, shader.inputs["Emission Color"])
        _set(shader, "Emission Strength", .035)
        graph.material["night_lights_contract"] = (
            "Animate Solar direction world XYZ inputs with body-to-Sun world unit vector. "
            "Zero vector disables emission. Static historical composite, not dated city activity."
        )
    return shader


def configure_solar_limb(material):
    nodes, links = material.node_tree.nodes, material.node_tree.links
    if "Solar limb darkening" in nodes:
        return
    emission = nodes["Photosphere emission"]
    granulation = emission.inputs["Strength"].links[0].from_socket
    geometry = nodes.new("ShaderNodeNewGeometry")
    geometry.name = "Photosphere viewing geometry"
    dot = nodes.new("ShaderNodeVectorMath")
    dot.name = "Cosine of solar viewing angle"
    dot.operation = "DOT_PRODUCT"
    links.new(geometry.outputs["Normal"], dot.inputs[0])
    links.new(geometry.outputs["Incoming"], dot.inputs[1])
    absolute = nodes.new("ShaderNodeMath")
    absolute.operation = "ABSOLUTE"
    links.new(dot.outputs["Value"], absolute.inputs[0])
    limb = nodes.new("ShaderNodeMath")
    limb.name = "Solar limb darkening"
    limb.operation = "MULTIPLY_ADD"
    limb.inputs[1].default_value = .6
    limb.inputs[2].default_value = .4
    links.new(absolute.outputs[0], limb.inputs[0])
    product = nodes.new("ShaderNodeMath")
    product.name = "Granulation with optical limb darkening"
    product.operation = "MULTIPLY"
    links.new(granulation, product.inputs[0])
    links.new(limb.outputs[0], product.inputs[1])
    links.new(product.outputs[0], emission.inputs["Strength"])
    material["limb_darkening_note"] = (
        "Linear optical-band approximation I(mu)/I(1)=0.4+0.6*mu. "
        "Coefficient is illustrative, not calibrated to an instrument passband."
    )


def make_surface_material(body: dict, asset_manifest: dict, asset_root: Path) -> bpy.types.Material:
    material, graph = _new(body, "surface")
    if graph is None:
        return material
    entry = _entry(body, asset_manifest)
    profile = entry.get("profile", {})
    maps = entry.get("maps", {})
    key = _key(body)
    urls = [record.get("source_url") for record in maps.values()] + entry.get("references", [])
    base, detail, coords = _procedural(graph, body, profile)
    status = entry.get("source_status", "RECONSTRUCTION")
    description = entry.get("description", "Unresolved neutral regolith reconstruction.")
    description += " " + " ".join(
        record.get(field, "") for record in maps.values()
        for field in ("notes", "radiometric_treatment", "visible_color_note"))
    if not maps:
        description += " Spatial reflectance variation is a reconstruction, not observed geography."
    material["optical_model"] = "Dielectric diffuse BSDF with empirical roughness. Reflectance palettes are approximate, not measured BRDFs."
    material["asset_checksums"] = json.dumps({role: record.get("sha256", "") for role, record in maps.items()})
    material["map_uv_registration"] = json.dumps({role: record.get("uv_registration", {}) for role, record in maps.items()})
    if any(record.get("uv_registration", {}).get("status", "").startswith("UNVERIFIED") for record in maps.values()):
        description += " Texture phase is not verified against the IAU prime meridian, even when body rotation is known."
    material["km_per_unit"] = float(body.get("km_per_unit", 1000.))
    if key == "sun" or profile.get("kind") == "photosphere":
        bb = graph.node("ShaderNodeBlackbody", "5772 K photosphere")
        bb.inputs[0].default_value = 5772
        cells = graph.node("ShaderNodeTexVoronoi", "Reconstructed solar granules")
        cells.distance = "EUCLIDEAN"
        _set(cells, "Scale", 1300.)
        graph.link(coords, cells.inputs["Vector"])
        strength = graph.ramp("Restrained granulation", cells.outputs["Distance"],
                              [(0., [.96]*3), (1., [1.04]*3)])
        emission = graph.node("ShaderNodeEmission", "Photosphere emission", (600, 0))
        graph.link(bb.outputs["Color"], emission.inputs["Color"])
        graph.link(strength, emission.inputs["Strength"])
        graph.link(emission.outputs[0], graph.output.inputs["Surface"])
        configure_solar_limb(material)
        material["emission_note"] = "Photosphere display emission is normalized. Caller supplies calibrated physical solar illumination."
        status = "RECONSTRUCTION"
    else:
        if "color" in maps:
            base = graph.image("color", maps["color"], asset_root)
        kind = profile.get("kind", "regolith")
        if key == "earth" or kind == "earth":
            shader = _earth(graph, body, maps, asset_root, base)
        else:
            shader = graph.principled("Diffuse "+kind, base,
                                      .95 if kind in {"gas", "cloud", "haze"} else .86,
                                      1.31 if kind in {"ice", "volatile"} else 1.48)
            if kind in {"gas", "cloud", "haze"}:
                _set(shader, "Specular IOR Level", .12)
            else:
                _set(shader, "Specular IOR Level", .28)
            if not maps and kind not in {"gas", "cloud", "haze"}:
                roughness = graph.ramp("Unresolved roughness", detail, [(0., [.79]*3), (1., [.94]*3)])
                graph.link(roughness, shader.inputs["Roughness"])
                micro = graph.node("ShaderNodeTexNoise", "Statistical regolith microrelief")
                _set(micro, "Scale", 170. + profile.get("seed", 0) % 90)
                _set(micro, "Detail", 2.)
                graph.link(coords, micro.inputs["Vector"])
                bump = graph.node("ShaderNodeBump", "Reconstructed sub-meter microrelief")
                _set(bump, "Strength", .22)
                _set(bump, "Distance", min(.0005, float(body.get("radius_km", 1))*1e-5)/material["km_per_unit"])
                graph.link(micro.outputs["Fac"], bump.inputs["Height"])
                graph.link(bump.outputs["Normal"], shader.inputs["Normal"])
                material["microrelief_status"] = "RECONSTRUCTION; <=0.5 m amplitude, independent of albedo."
        if "height" in maps:
            record = maps["height"]
            height = graph.image("height", record, asset_root)
            bump = graph.node("ShaderNodeBump", "Measured LOLA relief at physical scale")
            _set(bump, "Strength", 1.)
            _set(bump, "Distance", 1./material["km_per_unit"])
            graph.link(height, bump.inputs["Height"])
            graph.link(bump.outputs["Normal"], shader.inputs["Normal"])
            material["height_note"] = "LOLA float height in km; bump distance converts km to scene units. No silhouette displacement."
        graph.link(shader.outputs["BSDF"], graph.output.inputs["Surface"])
    material.diffuse_color = (*profile.get("linear_reflectance", [.15, .15, .15]), 1.)
    _metadata(material, status, description, urls,
              uv_assumptions=json.dumps(asset_manifest.get("uv_contract", {})))
    return material


def make_cloud_material(body: dict, manifest: dict, root: Path) -> bpy.types.Material | None:
    entry = _entry(body, manifest)
    key = _key(body)
    maps = entry.get("maps", {})
    if key == "venus":
        if "color" not in maps:
            return None
        material, graph = _new(body, "clouds")
        if graph is None:
            return material
        image = graph.image("cloud_visible", maps["color"], root)
        shader = graph.principled("Opaque sulfuric-acid cloud envelope", image, .97, 1.44)
        _set(shader, "Specular IOR Level", .08)
        graph.link(shader.outputs[0], graph.output.inputs["Surface"])
        _metadata(material, "MIXED",
                  "Opaque visible cloud envelope. The main Venus material is also cloudy, so omitting this shell never exposes radar terrain.",
                  [maps["color"]["source_url"]], recommended_altitude_km=65.)
        return material
    if key != "earth" or "clouds" not in maps:
        return None
    material, graph = _new(body, "clouds")
    if graph is None:
        return material
    image = graph.image("clouds", maps["clouds"], root)
    opacity = graph.ramp("Cloud composite opacity estimate", image,
                         [(0., [0.]*3), (.1, [.015]*3), (.65, [.76]*3), (1., [.98]*3)])
    shader = graph.principled("Water cloud scattering approximation", [.93, .95, .98], .96, 1.333)
    _set(shader, "Specular IOR Level", .08)
    transparent = graph.node("ShaderNodeBsdfTransparent", "Clear sky")
    mix = graph.node("ShaderNodeMixShader", "Cloud coverage", (750, 0))
    graph.link(opacity, mix.inputs[0])
    graph.link(transparent.outputs[0], mix.inputs[1])
    graph.link(shader.outputs[0], mix.inputs[2])
    graph.link(mix.outputs[0], graph.output.inputs["Surface"])
    if hasattr(material, "surface_render_method"):
        material.surface_render_method = "DITHERED"
    _metadata(material, "MIXED",
              "NASA historical water-cloud composite with empirical opacity. No current weather prediction. Place shell about 8 km above Earth.",
              [maps["clouds"]["source_url"]], recommended_altitude_km=8.)
    return material


def make_atmosphere_material(body: dict) -> bpy.types.Material | None:
    parameters = {
        "earth": ([.25, .48, 1.], 8.0, .012, .12, 100.),
        "venus": ([.96, .85, .59], 5.5, .010, .45, 105.),
        "mars": ([.75, .36, .16], 10.8, .0002, .35, 65.),
        "jupiter": ([.70, .76, .87], 27., .001, .28, 160.),
        "saturn": ([.90, .76, .48], 59.5, .0006, .35, 350.),
        "uranus": ([.39, .76, .85], 27.7, .0008, .20, 160.),
        "neptune": ([.32, .56, .85], 19.7, .001, .20, 120.),
        "titan": ([.83, .44, .16], 20., .008, .60, 150.),
    }
    key = _key(body)
    if key not in parameters:
        return None
    material, graph = _new(body, "atmosphere")
    if graph is None:
        return material
    color, scale_height, sigma_per_km, anisotropy, top = parameters[key]
    unit = float(body.get("km_per_unit", 1000.))
    radius = float(body.get("radius_km", 1.))
    reference_altitude = 65. if key == "venus" else 0.
    coordinates = graph.node("ShaderNodeTexCoord", "Body-local volume coordinates")
    distance = graph.node("ShaderNodeVectorMath", "Distance from body center")
    distance.operation = "LENGTH"
    graph.link(coordinates.outputs["Object"], distance.inputs[0])
    axes = body.get("radii_km") or [radius, radius, radius]
    normalized = graph.node("ShaderNodeVectorMath", "Normalize by physical ellipsoid axes")
    normalized.operation = "DIVIDE"
    graph.link(coordinates.outputs["Object"], normalized.inputs[0])
    normalized.inputs[1].default_value = tuple(float(axis)/unit for axis in axes)
    level = graph.node("ShaderNodeVectorMath", "Ellipsoid radial level")
    level.operation = "LENGTH"
    graph.link(normalized.outputs["Vector"], level.inputs[0])
    safe_level = graph.math("MAXIMUM", "Avoid center singularity", level.outputs["Value"], 1e-12)
    surface_radius = graph.math("DIVIDE", "Local surface radius", distance.outputs["Value"], safe_level)
    altitude_units = graph.math("SUBTRACT", "Altitude above ellipsoid", distance.outputs["Value"], surface_radius)
    altitude_km = graph.math("MULTIPLY", "Altitude in km", altitude_units, unit)
    altitude = graph.math("SUBTRACT", "Altitude above visible radius", altitude_km, reference_altitude)
    altitude = graph.math("MAXIMUM", "Nonnegative altitude", altitude, 0.)
    exponent = graph.math("DIVIDE", "Density scale height", altitude, -scale_height)
    falloff = graph.math("EXPONENT", "Exponential atmospheric density", exponent)
    density = graph.math("MULTIPLY", "Extinction per Blender unit", falloff, sigma_per_km*unit)
    scatter = graph.node("ShaderNodeVolumeScatter", "Approximate atmospheric scattering", (500, -200))
    _set(scatter, "Color", (*color, 1.))
    _set(scatter, "Anisotropy", anisotropy)
    graph.link(density, scatter.inputs["Density"])
    graph.link(scatter.outputs["Volume"], graph.output.inputs["Volume"])
    _metadata(material, "RECONSTRUCTION",
              "Exponential-density scattering approximation. Not a spectrally calibrated radiative-transfer model. No emissive limb.",
              ["https://nssdc.gsfc.nasa.gov/planetary/factsheet/"],
              scale_height_km=scale_height, recommended_shell_height_km=top,
              density_reference_altitude_km=reference_altitude,
              reference_density_per_unit=sigma_per_km*unit,
              approximate_vertical_optical_depth_rgb=[sigma_per_km*scale_height*c for c in color],
              center_contract="Atmosphere object origin must coincide with body center.",
              km_per_unit=unit)
    return material


def _ring_opacity(graph, tau, incidence):
    cosine = graph.math("ABSOLUTE", "Absolute incidence", incidence)
    cosine = graph.math("MAXIMUM", "Grazing denominator epsilon", cosine, 1e-6)
    slant = graph.math("DIVIDE", "Slant optical depth", tau, cosine)
    negative = graph.math("MULTIPLY", "Negative optical depth", slant, -1.)
    transmission = graph.math("EXPONENT", "Beer-Lambert transmission", negative)
    exact = graph.math("SUBTRACT", "Exponential intercepted fraction", 1., transmission)
    # exp(-x) rounds toward 1 for tenuous dust rings. The small-x branch avoids
    # subtraction cancellation without setting a minimum visible opacity.
    half = graph.math("MULTIPLY", "Half negative slant depth", slant, -.5)
    correction = graph.math("ADD", "Thin optical-depth correction", 1., half)
    thin = graph.math("MULTIPLY", "Stable thin-ring interception", slant, correction)
    use_thin = graph.math("LESS_THAN", "Numerically thin ring", slant, .001)
    use_exact = graph.math("SUBTRACT", "Resolved exponential branch", 1., use_thin)
    a = graph.math("MULTIPLY", "Weighted thin branch", thin, use_thin)
    b = graph.math("MULTIPLY", "Weighted exponential branch", exact, use_exact)
    return graph.math("ADD", "Stable intercepted fraction", a, b)


def make_ring_material(body: dict) -> bpy.types.Material:
    key = _key(body)
    profile = body.get("ring_profile", {})
    profile = profile if isinstance(profile, dict) else {"points": profile}
    defaults = {
        "saturn": (66900., 140180., [
            [0., .025], [.104, .025], [.105, .10], [.34, .10], [.345, 1.6],
            [.690, 1.6], [.692, .015], [.754, .015], [.756, .65],
            [.909, .65], [.910, .015], [.914, .015], [.915, .65], [.967, .65], [.975, .005], [1., 0.]],
            [.54, .47, .36]),
        "jupiter": (122500., 129000., [[0., 0.], [.08, 1e-6], [.92, 1e-6], [1., 0.]], [.09, .065, .04]),
        "uranus": (38000., 51400., [[0., 0.], [.95, 0.], [.955, .8], [.985, .8], [1., 0.]], [.085, .080, .075]),
        "neptune": (41900., 62930., [[0., .001], [.1, .001], [.11, 0.], [.985, 0.], [.990, .06], [1., .06]], [.07, .06, .05]),
        "chariklo": (386., 405., [[0., 0.], [.18, .4], [.55, .4], [.60, 0.], [.86, 0.], [.9, .06], [1., .06]], [.17, .16, .14]),
        "haumea": (2252., 2322., [[0., .5], [1., .5]], [.15, .13, .11]),
        "quaoar": (4040., 4190., [[0., .04], [1., .04]], [.12, .10, .08]),
    }
    inner, outer, points, color = defaults.get(key, (1., 2., [[0., .01], [1., .01]], [.2, .18, .15]))
    points = profile.get("points", points)
    inner = float(body.get("ring_inner_km", profile.get("inner_km", inner)))
    outer = float(body.get("ring_outer_km", profile.get("outer_km", outer)))
    color = profile.get("linear_color", color)
    caller_tau = body.get("ring_optical_depth")
    if caller_tau is not None:
        caller_tau = float(caller_tau)
        if not math.isfinite(caller_tau) or caller_tau < 0:
            raise ValueError("ring_optical_depth must be finite and nonnegative")
        points = [[0., caller_tau], [1., caller_tau]]
    if not math.isfinite(inner) or not math.isfinite(outer) or not 0 < inner < outer:
        raise ValueError("Ring radii must be finite, positive, and strictly increasing")
    annulus = str(body.get("ring_name") or profile.get("name") or "rings")
    parameters = dict(name=annulus, tau=caller_tau, points=points,
                      inner_km=inner, outer_km=outer, color=color)
    fingerprint = hashlib.sha256(json.dumps(parameters, sort_keys=True).encode()).hexdigest()[:10]
    ring_body = dict(body, id=key+"-"+annulus+"-"+fingerprint)
    material, graph = _new(ring_body, "rings")
    if graph is None:
        return material
    separation = graph.node("ShaderNodeSeparateXYZ", "Ring angular and radial UV")
    graph.link(graph.uv(), separation.inputs[0])
    if caller_tau is not None:
        value = graph.node("ShaderNodeValue", "Caller normal optical depth")
        value.outputs[0].default_value = caller_tau
        tau = value.outputs[0]
    else:
        tau = graph.ramp("Radial optical depth", separation.outputs["Y"],
                         [(float(v), [float(depth)]*3) for v, depth in points])
    texture = graph.node("ShaderNodeTexNoise", "Reconstructed radial color variation")
    texture.noise_dimensions = "1D"
    _set(texture, "Scale", 320.)
    _set(texture, "Detail", 5.)
    _set(texture, "Roughness", .8)
    graph.link(separation.outputs["Y"], texture.inputs["W"])
    modulation = graph.ramp("Unresolved radial contrast", texture.outputs["Fac"],
                            [(0., [.70]*3), (1., [1.2]*3)])
    geo = graph.node("ShaderNodeNewGeometry", "Ring ray geometry")
    dot = graph.node("ShaderNodeVectorMath", "Ring incidence cosine")
    dot.operation = "DOT_PRODUCT"
    graph.link(geo.outputs["Normal"], dot.inputs[0])
    graph.link(geo.outputs["Incoming"], dot.inputs[1])
    opacity = _ring_opacity(graph, tau, dot.outputs["Value"])
    tint = graph.ramp("Ice and dust color", separation.outputs["Y"],
                     [(0., [c*.64 for c in color]), (.5, color), (1., [c*.86 for c in color])])
    fine_color = graph.node("ShaderNodeMixRGB", "Unresolved particle density shading")
    fine_color.blend_type = "MULTIPLY"
    fine_color.inputs[0].default_value = .5
    graph.link(tint, fine_color.inputs[1])
    graph.link(modulation, fine_color.inputs[2])
    tint = fine_color.outputs[0]
    shader = graph.principled("Diffuse ring particles", tint, .92, 1.31)
    _set(shader, "Specular IOR Level", .12)
    transparent = graph.node("ShaderNodeBsdfTransparent", "Ring gaps")
    mix = graph.node("ShaderNodeMixShader", "Optical-depth transparency", (750, 0))
    graph.link(opacity, mix.inputs[0])
    graph.link(transparent.outputs[0], mix.inputs[1])
    graph.link(shader.outputs[0], mix.inputs[2])
    graph.link(mix.outputs[0], graph.output.inputs["Surface"])
    if hasattr(material, "surface_render_method"):
        material.surface_render_method = "DITHERED"
    description = (
        "Caller-provided normal optical depth, band radii and name. Geometry defines all band edges and gaps. "
        if caller_tau is not None else "Approximate fallback radial optical-depth profile. "
    )
    description += "Particle color and fine radial color patterns are reconstructions. Color patterns never modify optical depth."
    urls = ["https://pds-rings.seti.org/"]
    if body.get("ring_source_url"):
        urls.append(body["ring_source_url"])
    _metadata(material, "MIXED" if caller_tau is not None else "RECONSTRUCTION",
              description, urls,
              parent_body_id=key, ring_name=annulus,
              radial_coordinate="UVMap V=normalized physical radius; U is ignored.",
              inner_radius_km=inner, outer_radius_km=outer,
              normal_optical_depth=caller_tau if caller_tau is not None else "radial profile",
              opacity_model="1-exp(-tau/max(abs(dot(N,Incoming)),1e-6)); stable x-x*x/2 for x<0.001. Applies to camera and shadow rays. No opacity floor or visibility boost.",
              profile_points=json.dumps(points),
              profile_contract="ring_name, ring_optical_depth, ring_inner_km, ring_outer_km override fallback profiles. V=0 inner to V=1 outer independently for each band. ring_profile remains supported when optical depth is omitted.")
    return material


def smoke_test(root: Path):
    """Build each material once, verify graph contracts, and save evidence."""
    root = Path(root)
    manifest = json.loads((root/"data"/"asset_manifest.json").read_text())
    catalog_path = root/"data"/"catalog.json"
    catalog_rows = {}
    if catalog_path.exists():
        catalog = json.loads(catalog_path.read_text())
        bodies = catalog if isinstance(catalog, list) else catalog["bodies"]
        if isinstance(bodies, dict):
            bodies = list(bodies.values())
        catalog_rows = {body["id"]: body for body in bodies}
        assert set(manifest["bodies"]).issubset(catalog_rows), "Catalog/manifest ID mismatch"
    objects_before = len(bpy.data.objects)
    rows = []
    failures = []
    for key, entry in manifest["bodies"].items():
        body = dict(catalog_rows.get(key, dict(id=key, name=entry["name"],
                                             radius_km=6371. if key == "earth" else 1000.)))
        try:
            material = make_surface_material(body, manifest, root)
            assert make_surface_material(body, manifest, root) == material
            assert material["source_status"] in {"OBSERVED", "MIXED", "RECONSTRUCTION"}
            assert material["description"] and json.loads(material["source_urls"])
            images = [n for n in material.node_tree.nodes if n.type == "TEX_IMAGE"]
            for node in images:
                assert node.image.size[0] > 0, f"Invalid image dimensions: {node.image.name}"
                _ = node.image.pixels[0]
                assert node.image.has_data, f"Image buffer unavailable: {node.image.name}"
            if key != "sun":
                assert not any(n.type == "EMISSION" for n in material.node_tree.nodes)
            rows.append(dict(body=key, status=material["source_status"], image_nodes=len(images),
                             node_count=len(material.node_tree.nodes), cache_ok=True))
        except Exception as error:
            failures.append(dict(body=key, error=type(error).__name__+": "+str(error)))
    assert len(bpy.data.objects) == objects_before, "Material API must not create objects"
    aux = []
    for key in ("earth", "venus", "mars", "jupiter", "saturn", "uranus", "neptune", "titan"):
        body = dict(catalog_rows.get(key, dict(id=key, name=key.capitalize(), radius_km=6371.)))
        cloud = make_cloud_material(body, manifest, root)
        atmosphere = make_atmosphere_material(body)
        aux.append(dict(body=key, cloud=bool(cloud), atmosphere=bool(atmosphere)))
    for key in ("saturn", "jupiter", "uranus", "neptune", "chariklo", "haumea", "quaoar"):
        ring = make_ring_material(dict(id=key, name=key.capitalize()))
        assert ring.node_tree.nodes["Ring angular and radial UV"].outputs["Y"].is_linked
    ring_contract_checks = {}
    for key in ("haumea", "quaoar"):
        inputs = dict(id=key, ring_name="API contract validation", ring_optical_depth=.05,
                      ring_inner_km=1000., ring_outer_km=1001.)
        ring = make_ring_material(inputs)
        assert ring["normal_optical_depth"] == inputs["ring_optical_depth"]
        assert ring["inner_radius_km"] == inputs["ring_inner_km"]
        assert ring["outer_radius_km"] == inputs["ring_outer_km"]
        ring_contract_checks[key] = "Caller overrides accepted; synthetic API test inputs, not observational parameters."
    evidence = dict(blender_version=bpy.app.version_string, material_count=len(rows),
                    material_module_version=_VERSION, real_catalog_used=bool(catalog_rows),
                    status_counts={s: sum(r["status"] == s for r in rows) for s in ("OBSERVED", "MIXED", "RECONSTRUCTION")},
                    rows=rows, auxiliary_materials=aux, failures=failures,
                    additional_ring_contract_checks=ring_contract_checks,
                    no_mesh_objects_created=len(bpy.data.objects) == objects_before,
                    image_count=len([im for im in bpy.data.images if im.get("source_url")]),
                    notes=["All 71 material graphs instantiated once. Cache identity and image loading checked.",
                           "Only Moon measured elevation connects to bump; reconstructed bodies have sub-meter statistical microrelief.",
                           "Earth cities disabled unless caller supplies solar direction. Atmospheres are non-emissive volumes."])
    validation_path = root/"data"/"material_validation.json"
    previous = json.loads(validation_path.read_text()) if validation_path.exists() else {}
    validation_path.write_text(json.dumps({**previous, **evidence}, indent=2)+"\n")
    print(json.dumps({k: v for k, v in evidence.items() if k not in {"rows", "auxiliary_materials"}}, indent=2))
    if failures or len(rows) != 71:
        raise RuntimeError("Material smoke test failed")


def render_smoke(root: Path, target_ids=None):
    """Render five isolated shader checks, never the user's connected scene."""
    from mathutils import Vector
    root = Path(root)
    manifest = json.loads((root/"data"/"asset_manifest.json").read_text())
    results = []
    targets = [("earth", 6371.), ("moon", 1737.4), ("jupiter", 71492.),
               ("saturn", 60268.), ("eris", 1163.)]
    if target_ids is not None:
        targets = [(key, radius) for key, radius in targets if key in target_ids]
    sunlight = Vector((-.7, -1., .55)).normalized()
    for key, radius in targets:
        scene = bpy.data.scenes.new("Material validation/"+key)
        bpy.context.window.scene = scene
        scene.render.engine = "CYCLES"
        scene.cycles.samples = 16
        scene.cycles.use_denoising = True
        scene.cycles.max_bounces = 6
        scene.cycles.transparent_max_bounces = 12
        scene.render.resolution_x = scene.render.resolution_y = 512
        scene.render.resolution_percentage = 100
        scene.world = bpy.data.worlds.new("Black space/"+key)
        scene.world.use_nodes = True
        scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.
        scene.view_settings.view_transform = "AgX"
        body = dict(id=key, name=key.capitalize(), radius_km=radius,
                    sun_direction_world=list(sunlight))
        r = radius/1000.
        bpy.ops.mesh.primitive_uv_sphere_add(segments=160, ring_count=80, radius=r)
        obj = bpy.context.object
        obj.name = "Material test/"+key
        if key == "saturn":
            obj.scale.z = 54364/60268
        if key == "jupiter":
            obj.scale.z = 66854/71492
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        material = make_surface_material(body, manifest, root)
        obj.data.materials.append(material)
        if key == "earth":
            sun_node = material.node_tree.nodes.get("Solar direction world")
            if sun_node:
                for i in range(3):
                    sun_node.inputs[i].default_value = sunlight[i]
            cloud = make_cloud_material(body, manifest, root)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=160, ring_count=80, radius=r+.008)
            bpy.context.object.name = "Cloud test/earth"
            bpy.context.object.data.materials.append(cloud)
            for polygon in bpy.context.object.data.polygons:
                polygon.use_smooth = True
            atmosphere = make_atmosphere_material(body)
            shell_height = atmosphere["recommended_shell_height_km"]/1000.
            bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=r+shell_height)
            bpy.context.object.name = "Atmosphere test/earth"
            bpy.context.object.data.materials.append(atmosphere)
        view_radius = r
        if key == "saturn":
            count = 512
            inner, outer = 66.9, 140.18
            vertices, faces = [], []
            for i in range(count):
                angle = math.tau*i/count
                for rr in (inner, outer):
                    vertices.append((rr*math.cos(angle), rr*math.sin(angle), 0.))
            for i in range(count):
                j = (i+1) % count
                faces.append((2*i, 2*j, 2*j+1, 2*i+1))
            mesh = bpy.data.meshes.new("Ring validation mesh")
            mesh.from_pydata(vertices, [], faces)
            uv = mesh.uv_layers.new(name="UVMap")
            for polygon in mesh.polygons:
                for loop_idx in polygon.loop_indices:
                    vi = mesh.loops[loop_idx].vertex_index
                    uv.data[loop_idx].uv = ((vi//2)/count, vi % 2)
            rings = bpy.data.objects.new("Ring test/saturn", mesh)
            scene.collection.objects.link(rings)
            rings.data.materials.append(make_ring_material(body))
            view_radius = outer
        lamp_data = bpy.data.lights.new("Shader test solar illumination", "SUN")
        lamp_data.energy = 3.
        lamp_data.angle = math.radians(.53)
        lamp = bpy.data.objects.new("Shader test Sun", lamp_data)
        scene.collection.objects.link(lamp)
        lamp.rotation_euler = (-sunlight).to_track_quat("-Z", "Y").to_euler()
        camera_data = bpy.data.cameras.new("Shader test camera")
        camera = bpy.data.objects.new("Shader test camera", camera_data)
        scene.collection.objects.link(camera)
        camera.location = Vector((3., -4., 2.))*view_radius
        camera.rotation_euler = (-camera.location).to_track_quat("-Z", "Y").to_euler()
        camera_data.type = "ORTHO"
        camera_data.ortho_scale = view_radius*2.35
        camera_data.clip_start = max(r*.00001, .000001)
        camera_data.clip_end = view_radius*20
        scene.camera = camera
        output = root/"textures"/("material_smoke_"+key+".png")
        scene.render.filepath = str(output)
        scene.render.image_settings.file_format = "PNG"
        bpy.ops.render.render(write_still=True)
        results.append(dict(body=key, path=str(output.relative_to(root)),
                            nonempty=output.is_file() and output.stat().st_size > 1000))
    path = root/"data"/"material_validation.json"
    evidence = json.loads(path.read_text())
    previews = {row["body"]: row for row in evidence.get("isolated_shader_previews", [])}
    previews.update({row["body"]: row for row in results})
    evidence["isolated_shader_previews"] = list(previews.values())
    evidence["preview_lighting"] = "Shared inspection light, not calibrated scene solar irradiance. Real relative dimensions within each isolated view."
    path.write_text(json.dumps(evidence, indent=2)+"\n")


def integration_test(root: Path):
    """Check caller IDs and recently changed paths without rebuilding all bodies."""
    root = Path(root)
    manifest = json.loads((root/"data"/"asset_manifest.json").read_text())
    catalog = json.loads((root/"data"/"catalog.json").read_text())
    bodies = catalog if isinstance(catalog, list) else catalog["bodies"]
    if isinstance(bodies, dict):
        bodies = list(bodies.values())
    missing = [body["id"] for body in bodies if body["id"] not in manifest["bodies"]]
    assert not missing, f"Manifest IDs missing from canonical catalog: {missing}"
    before = len(bpy.data.objects)
    tested = []
    earth_atmosphere = {}
    selected = {"earth", "venus", "moon", "uranus", "neptune", "halley", "encke", "churyumov-gerasimenko"}
    for body in bodies:
        if body["id"] not in selected:
            continue
        material = make_surface_material(body, manifest, root)
        assert material.get("material_complete")
        assert make_surface_material(body, manifest, root) == material
        for node in material.node_tree.nodes:
            if node.type == "TEX_IMAGE":
                assert node.image.size[0] > 0
                _ = node.image.pixels[0]
                assert node.image.has_data
        if body["id"] in {"halley", "encke", "churyumov-gerasimenko"}:
            assert _entry(body, manifest)["profile"]["kind"] == "comet"
            assert "reconstructed" in material.node_tree.nodes["Reconstructed sub-meter microrelief"].label.lower()
        if body["id"] == "earth":
            assert all(socket.default_value == 0 for socket in material.node_tree.nodes["Solar direction world"].inputs)
            atmosphere = make_atmosphere_material(body)
            assert atmosphere["reference_density_per_unit"] == 12.
            assert atmosphere["recommended_shell_height_km"] == 100.
            assert atmosphere["scale_height_km"] == 8.
            earth_atmosphere = dict(
                radius_bu=float(body["radius_km"])/1000.,
                shell_height_bu=.10, density_scale_height_bu=.008,
                reference_density_per_bu=12.,
                approximate_vertical_optical_depth_rgb=list(atmosphere["approximate_vertical_optical_depth_rgb"]),
                approximation="Exponential colored scattering with Henyey-Greenstein phase; not calibrated spectral radiative transfer.")
        if body["id"] == "venus":
            cloud = make_cloud_material(body, manifest, root)
            atmosphere = make_atmosphere_material(body)
            assert atmosphere["recommended_shell_height_km"] > cloud["recommended_altitude_km"]
            assert atmosphere["density_reference_altitude_km"] == cloud["recommended_altitude_km"]
        tested.append(body["id"])
    a = make_ring_material(dict(id="saturn", ring_profile=dict(name="test-A", points=[[0., .1], [1., .8]])))
    b = make_ring_material(dict(id="saturn", ring_profile=dict(name="test-B", points=[[0., .4], [1., 1.6]])))
    assert a != b
    assert a.node_tree.nodes["Ring angular and radial UV"].outputs["Y"].is_linked
    assert len(bpy.data.objects) == before
    path = root/"data"/"material_validation.json"
    validation = json.loads(path.read_text())
    for row in validation.get("rows", []):
        row["body"] = manifest.get("body_id_aliases", {}).get(row["body"], row["body"])
    validation["integration_contract"] = dict(
        catalog_ids_resolved=len(bodies), targeted_materials=tested,
        canonical_comet_profiles=True, earth_night_disabled_by_default=True,
        ring_annulus_cache_isolation=True, no_objects_created=True,
        earth_atmosphere=earth_atmosphere,
        material_module_version=_VERSION)
    path.write_text(json.dumps(validation, indent=2)+"\n")
    print(json.dumps(validation["integration_contract"], indent=2))


def ring_physics_test(root: Path):
    """Render scalar opacity probes in linear float, including faint dust rings."""
    root = Path(root)
    before = len(bpy.data.objects)
    ring_inputs = [
        dict(id="saturn", ring_name="B", ring_optical_depth=2., ring_inner_km=92000., ring_outer_km=117580.),
        dict(id="saturn", ring_name="A", ring_optical_depth=.6, ring_inner_km=122170., ring_outer_km=136775.),
        dict(id="saturn", ring_name="C", ring_optical_depth=.15, ring_inner_km=74658., ring_outer_km=92000.),
        dict(id="jupiter", ring_name="Main", ring_optical_depth=1e-6, ring_inner_km=122500., ring_outer_km=129000.),
    ]
    for body in ring_inputs:
        material = make_ring_material(body)
        assert material is make_ring_material(body)
        assert material["normal_optical_depth"] == body["ring_optical_depth"]
        assert material["inner_radius_km"] == body["ring_inner_km"]
        assert material["outer_radius_km"] == body["ring_outer_km"]
        assert "Radial optical depth" not in material.node_tree.nodes
        assert "Modulated optical depth" not in material.node_tree.nodes
        assert material["source_status"] == "MIXED"
        pending = [material.node_tree.nodes["Optical-depth transparency"].inputs[0].links[0].from_node]
        visited = set()
        while pending:
            node = pending.pop()
            if node.name in visited:
                continue
            visited.add(node.name)
            assert node.type not in {"TEX_NOISE", "VALTORGB"}, "Artistic pattern changed caller opacity"
            pending.extend(link.from_node for socket in node.inputs for link in socket.links)
    first = make_ring_material(ring_inputs[0])
    changed = make_ring_material(dict(ring_inputs[0], ring_optical_depth=1.5))
    assert first != changed
    try:
        make_ring_material(dict(ring_inputs[0], ring_optical_depth=-1.))
        raise AssertionError("Negative optical depth was accepted")
    except ValueError:
        pass
    assert len(bpy.data.objects) == before

    cases = [(2., 1.), (.6, 1.), (.15, 1.), (1e-6, 1.), (1e-6, .5),
             (1e-6, .1), (0., 1.), (.6, .5), (.6, -.5), (1e-6, .001)]
    scene = bpy.data.scenes.new("Ring opacity compiler validation")
    bpy.context.window.scene = scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.render.resolution_x = len(cases)*16
    scene.render.resolution_y = 16
    scene.render.resolution_percentage = 100
    scene.world = bpy.data.worlds.new("Opacity probe black")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.
    vertices, faces = [], []
    for index in range(len(cases)):
        vertices.extend([(index-.5, -.5, 0), (index+.5, -.5, 0),
                         (index+.5, .5, 0), (index-.5, .5, 0)])
        faces.append(tuple(range(index*4, index*4+4)))
    mesh = bpy.data.meshes.new("Opacity probe patches")
    mesh.from_pydata(vertices, [], faces)
    obj = bpy.data.objects.new("Opacity probe patches", mesh)
    scene.collection.objects.link(obj)
    for index, (tau, cosine) in enumerate(cases):
        material = bpy.data.materials.new(f"Opacity probe/{index}")
        material.use_nodes = True
        material.node_tree.nodes.clear()
        graph = Graph(material)
        opacity = _ring_opacity(graph, tau, cosine)
        emission = graph.node("ShaderNodeEmission", "Linear opacity probe output")
        graph.link(opacity, emission.inputs["Color"])
        emission.inputs["Strength"].default_value = 1.
        graph.link(emission.outputs[0], graph.output.inputs["Surface"])
        mesh.materials.append(material)
        mesh.polygons[index].material_index = index
    camera_data = bpy.data.cameras.new("Opacity probe camera")
    camera = bpy.data.objects.new("Opacity probe camera", camera_data)
    camera.location = ((len(cases)-1)/2., 0., 10.)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = len(cases)
    scene.collection.objects.link(camera)
    scene.camera = camera
    output = root/"textures"/"ring_opacity_validation.exr"
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    image = bpy.data.images.load(str(output), check_existing=False)
    width, height = image.size
    channels = len(image.pixels)//(width*height)
    results = []
    for index, (tau, cosine) in enumerate(cases):
        rendered = image.pixels[((height//2)*width + index*16+8)*channels]
        expected = -math.expm1(-tau/max(abs(cosine), 1e-6))
        assert math.isclose(rendered, expected, rel_tol=4e-5, abs_tol=1e-9), (tau, cosine, expected, rendered)
        results.append(dict(tau=tau, incidence_cosine=cosine, expected_alpha=expected,
                            rendered_alpha=rendered, absolute_error=abs(rendered-expected)))
    path = root/"data"/"material_validation.json"
    validation = json.loads(path.read_text())
    validation["ring_physics"] = dict(
        caller_fields=["ring_name", "ring_optical_depth", "ring_inner_km", "ring_outer_km"],
        opacity_formula="1-exp(-tau/abs(dot(N,Incoming)))",
        grazing_denominator_epsilon=1e-6, opacity_floor=False,
        artistic_variation_affects_opacity=False, gaps_defined_by_caller_meshes=True,
        changed_tau_invalidates_cache=True, zero_tau_is_transparent=True,
        material_module_version=_VERSION, linear_float_probe=str(output.relative_to(root)),
        rendered_checks=results)
    path.write_text(json.dumps(validation, indent=2)+"\n")
    print(json.dumps(validation["ring_physics"], indent=2))


def uv_registration_test(root: Path):
    """Test prime-meridian sampling, north/south isolation, and UV offsets."""
    root = Path(root)
    image_path = root/"textures"/"uv_registration_validation.png"
    test_image = bpy.data.images.new("UV registration test pattern", width=5, height=3, alpha=True)
    test_image.colorspace_settings.name = "Non-Color"
    middle = [(1, 0, 1), (1, 1, 1), (0, 1, 0), (0, 1, 1), (1, 1, 0)]
    colors = [(0, 0, 1)]*5 + middle + [(1, 0, 0)]*5
    test_image.pixels = [component for color in colors for component in (*color, 1)]
    test_image.update()
    test_image.filepath_raw = str(image_path)
    test_image.file_format = "PNG"
    test_image.save()
    cases = [
        ("north", (.5, 1.), {}, (1., 0., 0.)),
        ("south", (.5, 0.), {}, (0., 0., 1.)),
        ("prime meridian", (.5, .5), {}, (0., 1., 0.)),
        ("positive offset", (.5, .5), {"u_offset_cycles": .4}, (1., 1., 0.)),
        ("whole longitude turn", (.5, .5), {"u_offset_cycles": 1.}, (0., 1., 0.)),
        ("negative offset", (.1, .5), {"u_offset_cycles": -.2}, (1., 1., 0.)),
        ("longitude mirror", (.1, .5), {"u_scale": -1., "u_offset_cycles": 1.}, (1., 1., 0.)),
        ("explicit latitude flip", (.5, 1.), {"v_scale": -1., "v_offset_cycles": 1.}, (0., 0., 1.)),
    ]
    scene = bpy.data.scenes.new("UV registration compiler validation")
    bpy.context.window.scene = scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.use_denoising = False
    scene.render.resolution_x = len(cases)*16
    scene.render.resolution_y = 16
    scene.render.resolution_percentage = 100
    scene.world = bpy.data.worlds.new("UV test black")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.
    vertices, faces = [], []
    for index in range(len(cases)):
        vertices.extend([(index-.5, -.5, 0), (index+.5, -.5, 0),
                         (index+.5, .5, 0), (index-.5, .5, 0)])
        faces.append(tuple(range(index*4, index*4+4)))
    mesh = bpy.data.meshes.new("UV validation patches")
    mesh.from_pydata(vertices, [], faces)
    mesh.uv_layers.new(name="UVMap")
    obj = bpy.data.objects.new("UV validation patches", mesh)
    scene.collection.objects.link(obj)
    for index, (name, uv, registration, expected) in enumerate(cases):
        material = bpy.data.materials.new("UV validation/"+name)
        material.use_nodes = True
        material.node_tree.nodes.clear()
        graph = Graph(material)
        record = dict(path=str(image_path.relative_to(root)), color_space="Non-Color",
                      uv_registration=registration)
        color = graph.image("UV test", record, root)
        emission = graph.node("ShaderNodeEmission", "Linear UV test output")
        graph.link(color, emission.inputs["Color"])
        emission.inputs["Strength"].default_value = 1.
        graph.link(emission.outputs[0], graph.output.inputs["Surface"])
        mesh.materials.append(material)
        polygon = mesh.polygons[index]
        polygon.material_index = index
        for loop in polygon.loop_indices:
            mesh.uv_layers.active.data[loop].uv = uv
    camera_data = bpy.data.cameras.new("UV test camera")
    camera = bpy.data.objects.new("UV test camera", camera_data)
    camera.location = ((len(cases)-1)/2., 0., 10.)
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = len(cases)
    scene.collection.objects.link(camera)
    scene.camera = camera
    output = root/"textures"/"uv_registration_validation.exr"
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    rendered_image = bpy.data.images.load(str(output), check_existing=False)
    width, height = rendered_image.size
    channels = len(rendered_image.pixels)//(width*height)
    results = []
    for index, (name, uv, registration, expected) in enumerate(cases):
        offset = ((height//2)*width+index*16+8)*channels
        actual = list(rendered_image.pixels[offset:offset+3])
        assert max(abs(a-b) for a, b in zip(actual, expected)) < 1e-5, (name, actual, expected)
        results.append(dict(test=name, input_uv=list(uv), shader_transform=registration,
                            expected_rgb=list(expected), rendered_rgb=actual))
    manifest = json.loads((root/"data"/"asset_manifest.json").read_text())
    records = [r for b in manifest["bodies"].values() for r in b["maps"].values()]
    statuses = {}
    for record in records:
        registration = record["uv_registration"]
        status = registration["status"]
        statuses[status] = statuses.get(status, 0)+1
        assert registration["u_offset_cycles"] == registration["v_offset_cycles"] == 0.
        assert registration["u_scale"] == registration["v_scale"] == 1.
    path = root/"data"/"material_validation.json"
    validation = json.loads(path.read_text())
    validation["uv_registration"] = dict(
        prime_meridian_uv=[.5, .5], north_axis="+Z", north_v=1.,
        latitude_wrap_disabled=True, source_transforms_already_baked=True,
        registration_status_counts_by_map=statuses,
        unverified_bodies=manifest["inventory"]["unverified_meridian_bodies"],
        rendered_checks=results, material_module_version=_VERSION,
        linear_float_probe=str(output.relative_to(root)))
    path.write_text(json.dumps(validation, indent=2)+"\n")
    print(json.dumps(validation["uv_registration"], indent=2))


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    if "--integration-only" in sys.argv:
        integration_test(root)
    else:
        smoke_test(root)
        if "--render-smoke" in sys.argv:
            render_smoke(root)
