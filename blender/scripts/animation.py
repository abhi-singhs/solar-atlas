"""Native Blender animation curves and source-knot reduction."""

import bpy
import numpy as np


def assign_action(obj, action):
    obj.animation_data_create()
    obj.animation_data.action = action
    obj.animation_data.action_slot = action.slots[0]


def new_action(name, id_type="OBJECT"):
    action = bpy.data.actions.new(name)
    slot = action.slots.new(id_type, "Scientific transform")
    layer = action.layers.new("Published motion")
    strip = layer.strips.new(type="KEYFRAME")
    return action, strip.channelbag(slot, ensure=True)


def add_curve(bag, path, axis, frames, values, slopes=None):
    curve = bag.fcurves.new(data_path=path, index=axis)
    count = len(frames)
    curve.keyframe_points.add(count)
    coordinates = np.column_stack((frames, values)).astype(np.float32)
    curve.keyframe_points.foreach_set("co", coordinates.ravel())
    if slopes is None:
        for point in curve.keyframe_points:
            point.interpolation = "LINEAR"
    else:
        left = np.r_[frames[1] - frames[0], np.diff(frames)] / 3
        right = np.r_[np.diff(frames), frames[-1] - frames[-2]] / 3
        for point in curve.keyframe_points:
            point.interpolation = "BEZIER"
            point.handle_left_type = "FREE"
            point.handle_right_type = "FREE"
        curve.keyframe_points.foreach_set(
            "handle_left", np.column_stack((frames - left, values - slopes * left)).ravel()
        )
        curve.keyframe_points.foreach_set(
            "handle_right", np.column_stack((frames + right, values + slopes * right)).ravel()
        )
    curve.update()
    return curve


def hermite_indices(seconds, position, velocity, tolerance):
    """Retain source knots until cubic curves fit every cached position."""
    keep = {0, len(seconds) - 1}
    stack = [(0, len(seconds) - 1)]
    worst = 0.0
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        span = seconds[b] - seconds[a]
        u = ((seconds[a + 1:b] - seconds[a]) / span)[:, None]
        estimate = (
            (2 * u**3 - 3 * u**2 + 1) * position[a]
            + (u**3 - 2 * u**2 + u) * span * velocity[a]
            + (-2 * u**3 + 3 * u**2) * position[b]
            + (u**3 - u**2) * span * velocity[b]
        )
        errors = np.linalg.norm(estimate - position[a + 1:b], axis=1)
        index = int(np.argmax(errors))
        error = float(errors[index])
        if error > tolerance:
            split = a + 1 + index
            keep.add(split)
            stack.extend(((a, split), (split, b)))
        else:
            worst = max(worst, error)
    return np.array(sorted(keep)), worst
