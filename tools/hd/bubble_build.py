#!/usr/bin/env python3
"""
Original Bubble test car — 100% authored in this file.

No third-party car meshes are imported or referenced. Every body panel, wheel,
lamp, bumper, plate, emblem and interior piece is generated here from curves
and primitives. CC0 HDRIs / procedural materials may be used for lighting only.

Run:
  blender --background --python tools/hd/bubble_build.py -- --mode preview
  blender --background --python tools/hd/bubble_build.py -- --mode render
  blender --background --python tools/hd/bubble_build.py -- --mode bake
  blender --background --python tools/hd/bubble_build.py -- --mode all
"""
from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector, Matrix, Euler

ROOT = Path('/workspace/sg-photoreal')
OUT_RENDERS = Path('/workspace/sg-car-test/renders')
OUT_WORK = Path('/workspace/sg-car-test/blender')
PREVIEW_DIR = ROOT / 'tools' / 'hd' / 'preview' / 'bubble'
M0_PATH = ROOT / 'docs' / 'hd' / 'rides' / 'm0.bin'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT_SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'

# --- dimensions (meters). Original show-car proportions, VW-inspired not a copy. ---
WB = 2.40
TRACK = 1.31
WR = 0.322
TIRE_W = 0.165
LEN = 4.10
WIDTH = 1.55
HEIGHT = 1.50
AXLE_F = WB / 2   # +Y front in Blender
AXLE_R = -WB / 2


def argv_after_dd():
    if '--' in sys.argv:
        return sys.argv[sys.argv.index('--') + 1:]
    return []


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0) if e1 != e0 else 0.0))
    return t * t * (3.0 - 2.0 * t)


def bump(y, center, width, height):
    if width <= 0:
        return 0.0
    t = abs(y - center) / width
    if t >= 1.0:
        return 0.0
    return height * (1.0 - t * t) ** 2


def catmull(keys, t):
    ts = [k[0] for k in keys]
    vs = [k[1] for k in keys]
    if t <= ts[0]:
        return vs[0]
    if t >= ts[-1]:
        return vs[-1]
    i = 0
    while i < len(ts) - 1 and not (ts[i] <= t <= ts[i + 1]):
        i += 1
    t0, t1 = ts[i], ts[i + 1]
    u = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
    v0 = vs[i - 1] if i > 0 else vs[i]
    v1 = vs[i]
    v2 = vs[i + 1]
    v3 = vs[i + 2] if i + 2 < len(vs) else vs[i + 1]
    u2, u3 = u * u, u * u * u
    return 0.5 * ((2 * v1) + (-v0 + v2) * u + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u2 + (-v0 + 3 * v1 - 3 * v2 + v3) * u3)


# Side-view curves, Y front, Z up. Authored for a round "Bubble" silhouette.
ROOF = [
    # Rear valence up the engine lid, tight circular cabin, short rounded hood.
    (-2.08, 0.38), (-2.02, 0.46), (-1.92, 0.58), (-1.78, 0.78),
    (-1.60, 1.05), (-1.38, 1.30), (-1.12, 1.46), (-0.78, 1.515),
    (-0.30, 1.530), (0.15, 1.515), (0.48, 1.40), (0.66, 1.16),
    (0.82, 0.96), (1.00, 0.88), (1.28, 0.84), (1.55, 0.80),
    (1.78, 0.70), (1.95, 0.56), (2.08, 0.40),
]
BELT = [
    (-2.08, 0.36), (-1.92, 0.50), (-1.55, 0.74), (-1.15, 0.86),
    (-0.40, 0.90), (0.30, 0.90), (0.68, 0.88), (0.86, 0.86),
    (1.15, 0.80), (1.50, 0.76), (1.85, 0.62), (2.08, 0.40),
]
TUB_W = [
    (-2.08, 0.48), (-1.95, 0.58), (-1.55, 0.65), (-0.90, 0.67),
    (0.10, 0.67), (0.75, 0.66), (1.15, 0.64), (1.50, 0.62),
    (1.80, 0.58), (1.98, 0.54), (2.08, 0.50),
]


def fender_extra(y):
    return bump(y, AXLE_R, 0.95, 0.16) + bump(y, AXLE_F, 0.88, 0.155)


def fender_z(y):
    # Fender crowns sit ABOVE the hood / deck so a valley reads between them.
    base = catmull([(-2.08, 0.38), (-1.70, 0.50), (-0.20, 0.52), (1.40, 0.50), (2.08, 0.38)], y)
    return base + bump(y, AXLE_R, 0.90, 0.34) + bump(y, AXLE_F, 0.86, 0.34)


def floor_z(y):
    return 0.145 + bump(y, 0.0, 1.6, -0.02)


def arch_z(y):
    z = 0.0
    for axle in (AXLE_F, AXLE_R):
        dy = y - axle
        r = WR + 0.045
        if abs(dy) < r:
            z = max(z, WR + math.sqrt(max(0.0, r * r - dy * dy)))
    return z


def well_amt(y):
    return max(0.0, bump(y, AXLE_R, 0.38, 1.0) + bump(y, AXLE_F, 0.38, 1.0))


def hood_center_lift(y):
    # Subtle hood / deck spine down the centerline.
    if 0.85 < y < 2.00:
        return 0.018 * bump(y, 1.35, 0.9, 1.0)
    if -2.00 < y < -1.05:
        return 0.012 * bump(y, -1.50, 0.7, 1.0)
    return 0.0


def _ellipse_arc(x_r, z0, z1, n, x_sign=1.0):
    """Quarter-ellipse from (x_r, z0) to (0, z1)."""
    pts = []
    for i in range(n):
        a = (i / (n - 1)) * (math.pi / 2)
        pts.append((x_sign * x_r * math.cos(a), lerp(z0, z1, math.sin(a))))
    return pts


def _section_cabin(y, tub, belt, roof, flz):
    """Tight bubble greenhouse, almost-vertical door, circular roof."""
    pts = [None] * 16
    pts[0] = (0.0, flz)
    pts[1] = (tub * 0.40, flz)
    pts[2] = (tub * 0.82, flz + 0.012)
    pts[3] = (tub * 0.98, 0.22)
    pts[4] = (tub * 1.00, 0.32)
    pts[5] = (tub * 1.01, lerp(0.32, belt, 0.45))
    pts[6] = (tub * 1.00, lerp(0.32, belt, 0.80))
    pts[7] = (tub * 0.99, belt)  # belt crease
    # points 8-15: quarter-ellipse greenhouse (tumblehome)
    arc = _ellipse_arc(tub * 0.86, belt + 0.01, roof, 8)
    for i, (x, z) in enumerate(arc):
        pts[8 + i] = (x, z)
    pts[15] = (0.0, roof)
    return pts


def _section_fender(y, tub, roof, flz, fx, fz, arch, for_hood=True):
    """Pontoon fender with a valley into the hood or deck."""
    pts = [None] * 16
    pts[0] = (0.0, flz)
    pts[1] = (tub * 0.40, flz)
    pts[2] = (tub * 0.75, flz + 0.012)
    lower_z = 0.26
    pts[3] = (lerp(tub, fx, 0.45), lerp(flz + 0.04, lower_z, 0.7))
    pts[4] = (fx * 0.98, lower_z)
    pts[5] = (fx, lerp(lower_z, fz, 0.55))
    pts[6] = (fx * 0.99, fz)          # fender crown — the "shoulder"
    # Drop into the gutter between fender and hood/deck, then up to the center.
    gutter_x = fx * 0.58
    gutter_z = lerp(fz, roof, 0.70)
    pts[7] = (fx * 0.82, lerp(fz, gutter_z, 0.25))
    pts[8] = (gutter_x, gutter_z)
    # hood / deck surface: almost flat across, slight center spine
    spine = roof + (0.008 if for_hood else 0.004)
    for i, u in enumerate((0.18, 0.32, 0.48, 0.64, 0.78, 0.90, 1.0)):
        pts[9 + i] = (gutter_x * (1.0 - u), lerp(gutter_z, spine, u * u * (3 - 2 * u)))
    pts[15] = (0.0, spine)
    return pts


def _blend_pts(a, b, t):
    return [(lerp(a[i][0], b[i][0], t), lerp(a[i][1], b[i][1], t)) for i in range(len(a))]


def half_section(y, n=16):
    roof = catmull(ROOF, y)
    belt = min(catmull(BELT, y), roof - 0.10)
    tub = catmull(TUB_W, y)
    fex = fender_extra(y)
    fz = fender_z(y)
    flz = floor_z(y)
    arch = arch_z(y)
    fx = tub + fex
    cabin = smoothstep(-1.18, -0.98, y) * (1.0 - smoothstep(0.68, 0.90, y))
    hoodish = y >= 0.0
    cab = _section_cabin(y, tub, belt, roof, flz)
    fen = _section_fender(y, tub, roof, flz, fx, fz, arch, for_hood=hoodish)
    # Even in the cabin, sneak in a hint of rear/front fender at the very edges of the cabin
    # (the running-board stations are cabin=1 and famt=0, so fen will collapse toward tub).
    if fex > 0.02 and cabin > 0.8:
        # keep the door vertical; only use fender lower points if they flare a little at the pillar
        return cab
    return _blend_pts(fen, cab, cabin)


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.curves, bpy.data.cameras, bpy.data.lights, bpy.data.images):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def new_obj(name, mesh, collection=None):
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def mesh_from_bmesh(name, bm, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return me


def add_subsurf(obj, view=1, render=2, quality=3):
    m = obj.modifiers.new('Subsurf', 'SUBSURF')
    m.levels = view
    m.render_levels = render
    m.quality = quality
    m.uv_smooth = 'PRESERVE_CORNERS'
    m.boundary_smooth = 'ALL'
    return m


def shade_auto(obj, angle=35):
    obj.data.use_auto_smooth = True
    obj.data.auto_smooth_angle = math.radians(angle)


def set_prop(obj, role, layer='body', color=None):
    obj['role'] = role
    obj['layer'] = layer
    if color is not None:
        obj['color'] = list(color)


# ---------- materials ----------
def _principled(mat):
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.location = (400, 0)
    pr = nt.nodes.new('ShaderNodeBsdfPrincipled')
    pr.location = (0, 0)
    nt.links.new(pr.outputs['BSDF'], out.inputs['Surface'])
    return nt, pr


def mat_paint(name, color, kind='candy'):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt, pr = _principled(mat)
    pr.inputs['Base Color'].default_value = (*color, 1)
    pr.inputs['IOR'].default_value = 1.5
    if kind == 'patina':
        pr.inputs['Metallic'].default_value = 0.05
        pr.inputs['Roughness'].default_value = 0.72
        pr.inputs['Coat Weight'].default_value = 0.15
        pr.inputs['Coat Roughness'].default_value = 0.45
    elif kind == 'metallic':
        pr.inputs['Metallic'].default_value = 0.55
        pr.inputs['Roughness'].default_value = 0.28
        pr.inputs['Coat Weight'].default_value = 1.0
        pr.inputs['Coat Roughness'].default_value = 0.05
    elif kind == 'flake':
        pr.inputs['Metallic'].default_value = 0.5
        pr.inputs['Roughness'].default_value = 0.26
        pr.inputs['Coat Weight'].default_value = 1.0
        pr.inputs['Coat Roughness'].default_value = 0.05
    else:  # candy / solid
        pr.inputs['Metallic'].default_value = 0.28 if kind == 'candy' else 0.08
        pr.inputs['Roughness'].default_value = 0.18 if kind == 'candy' else 0.32
        pr.inputs['Coat Weight'].default_value = 1.0
        pr.inputs['Coat Roughness'].default_value = 0.035 if kind == 'candy' else 0.08

    if kind in ('candy', 'flake', 'metallic'):
        tex = nt.nodes.new('ShaderNodeTexVoronoi')
        tex.location = (-700, 100)
        tex.inputs['Scale'].default_value = 380 if kind != 'metallic' else 220
        tex.feature = 'F1'
        tex.distance = 'EUCLIDEAN'
        coord = nt.nodes.new('ShaderNodeTexCoord')
        coord.location = (-900, 100)
        nt.links.new(coord.outputs['Object'], tex.inputs['Vector'])
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.location = (-480, 160)
        ramp.color_ramp.elements[0].position = 0.0
        ramp.color_ramp.elements[0].color = (*[c * 0.55 for c in color], 1)
        ramp.color_ramp.elements[1].position = 0.62
        flake_col = (min(1, color[0] * 1.25 + 0.08), min(1, color[1] * 1.15 + 0.06), min(1, color[2] * 1.1 + 0.06), 1)
        ramp.color_ramp.elements[1].color = flake_col
        nt.links.new(tex.outputs['Distance'], ramp.inputs['Fac'])
        bumpn = nt.nodes.new('ShaderNodeBump')
        bumpn.location = (-280, -80)
        bumpn.inputs['Strength'].default_value = 0.12 if kind == 'candy' else 0.18
        bumpn.inputs['Distance'].default_value = 0.004
        nt.links.new(tex.outputs['Distance'], bumpn.inputs['Height'])
        nt.links.new(bumpn.outputs['Normal'], pr.inputs['Normal'])
        nt.links.new(ramp.outputs['Color'], pr.inputs['Base Color'])
    return mat


def mat_two_tone(name, c1, c2, stripe=False):
    """Smooth two-tone by world Z (height) plus an optional hood stripe."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt, pr = _principled(mat)
    pr.inputs['Metallic'].default_value = 0.55
    pr.inputs['Roughness'].default_value = 0.28
    pr.inputs['Coat Weight'].default_value = 1.0
    pr.inputs['Coat Roughness'].default_value = 0.05
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(coord.outputs['Object'], sep.inputs['Vector'])
    # belt at ~0.88, 10cm smooth band
    mapn = nt.nodes.new('ShaderNodeMapRange')
    mapn.inputs['From Min'].default_value = 0.82
    mapn.inputs['From Max'].default_value = 0.94
    mapn.inputs['To Min'].default_value = 0.0
    mapn.inputs['To Max'].default_value = 1.0
    mapn.clamp = True
    nt.links.new(sep.outputs['Z'], mapn.inputs['Value'])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = (*c2, 1)  # lower
    mix.inputs['B'].default_value = (*c1, 1)  # upper
    nt.links.new(mapn.outputs['Result'], mix.inputs['Factor'])
    color_out = mix.outputs['Result']
    if stripe:
        # two thin white bands near |X| = 0.12 on the hood (Y > 0.7, Z > 0.7)
        sep2 = sep
        absx = nt.nodes.new('ShaderNodeMath')
        absx.operation = 'ABSOLUTE'
        nt.links.new(sep2.outputs['X'], absx.inputs[0])
        sub = nt.nodes.new('ShaderNodeMath')
        sub.operation = 'SUBTRACT'
        sub.inputs[0].default_value = 0.0
        # | |x| - 0.12 |
        sub2 = nt.nodes.new('ShaderNodeMath')
        sub2.operation = 'SUBTRACT'
        sub2.inputs[1].default_value = 0.12
        nt.links.new(absx.outputs[0], sub2.inputs[0])
        absd = nt.nodes.new('ShaderNodeMath')
        absd.operation = 'ABSOLUTE'
        nt.links.new(sub2.outputs[0], absd.inputs[0])
        # band = 1 - smooth(|d|-0.03)/0.03
        rng = nt.nodes.new('ShaderNodeMapRange')
        rng.inputs['From Min'].default_value = 0.015
        rng.inputs['From Max'].default_value = 0.040
        rng.inputs['To Min'].default_value = 1.0
        rng.inputs['To Max'].default_value = 0.0
        rng.clamp = True
        nt.links.new(absd.outputs[0], rng.inputs['Value'])
        # gate to hood: Y > 0.7 and Z > 0.72
        gy = nt.nodes.new('ShaderNodeMapRange')
        gy.inputs['From Min'].default_value = 0.65
        gy.inputs['From Max'].default_value = 0.80
        gy.clamp = True
        nt.links.new(sep2.outputs['Y'], gy.inputs['Value'])
        gz = nt.nodes.new('ShaderNodeMapRange')
        gz.inputs['From Min'].default_value = 0.70
        gz.inputs['From Max'].default_value = 0.80
        gz.clamp = True
        nt.links.new(sep2.outputs['Z'], gz.inputs['Value'])
        g = nt.nodes.new('ShaderNodeMath')
        g.operation = 'MULTIPLY'
        nt.links.new(gy.outputs['Result'], g.inputs[0])
        nt.links.new(gz.outputs['Result'], g.inputs[1])
        g2 = nt.nodes.new('ShaderNodeMath')
        g2.operation = 'MULTIPLY'
        nt.links.new(rng.outputs['Result'], g2.inputs[0])
        nt.links.new(g.outputs[0], g2.inputs[1])
        mixs = nt.nodes.new('ShaderNodeMix')
        mixs.data_type = 'RGBA'
        nt.links.new(mix.outputs['Result'], mixs.inputs['A'])
        mixs.inputs['B'].default_value = (0.95, 0.95, 0.92, 1)
        nt.links.new(g2.outputs[0], mixs.inputs['Factor'])
        color_out = mixs.outputs['Result']
    nt.links.new(color_out, pr.inputs['Base Color'])
    return mat


def mat_metal(name, color=(0.85, 0.87, 0.90), rough=0.04):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    _, pr = _principled(mat)
    pr.inputs['Base Color'].default_value = (*color, 1)
    pr.inputs['Metallic'].default_value = 1.0
    pr.inputs['Roughness'].default_value = rough
    pr.inputs['Coat Weight'].default_value = 0.15
    pr.inputs['Coat Roughness'].default_value = 0.04
    return mat


def mat_gold():
    return mat_metal('Gold', (0.83, 0.58, 0.16), 0.22)


def mat_rubber(name='Tire', color=(0.02, 0.02, 0.022), rough=0.72):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt, pr = _principled(mat)
    pr.inputs['Base Color'].default_value = (*color, 1)
    pr.inputs['Metallic'].default_value = 0.0
    pr.inputs['Roughness'].default_value = rough
    # light tread bump
    wave = nt.nodes.new('ShaderNodeTexWave')
    wave.wave_type = 'BANDS'
    wave.bands_direction = 'Z'
    wave.inputs['Scale'].default_value = 55
    wave.inputs['Distortion'].default_value = 2.5
    bumpn = nt.nodes.new('ShaderNodeBump')
    bumpn.inputs['Strength'].default_value = 0.35
    bumpn.inputs['Distance'].default_value = 0.004
    coord = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(coord.outputs['Object'], wave.inputs['Vector'])
    nt.links.new(wave.outputs['Fac'], bumpn.inputs['Height'])
    nt.links.new(bumpn.outputs['Normal'], pr.inputs['Normal'])
    return mat


def mat_whitewall():
    return mat_rubber('Whitewall', (0.86, 0.82, 0.74), 0.62)


def mat_glass(name='Glass', color=(0.05, 0.07, 0.09, 1), ior=1.52, rough=0.0, trans=0.92):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.blend_method = 'BLEND'
    try:
        mat.shadow_method = 'HASHED'
    except Exception:
        pass
    try:
        mat.use_screen_refraction = True
    except Exception:
        pass
    _, pr = _principled(mat)
    pr.inputs['Base Color'].default_value = color
    pr.inputs['Metallic'].default_value = 0.0
    pr.inputs['Roughness'].default_value = rough
    pr.inputs['IOR'].default_value = ior
    pr.inputs['Transmission Weight'].default_value = trans
    pr.inputs['Alpha'].default_value = 0.22 if trans > 0.5 else 1
    return mat


def mat_diamond():
    # Glass / high-IOR letters with a hint of dispersion via thin-film-ish coat
    mat = bpy.data.materials.new('DiamondLetter')
    mat.use_nodes = True
    mat.blend_method = 'BLEND'
    try:
        mat.shadow_method = 'HASHED'
    except Exception:
        pass
    try:
        mat.use_screen_refraction = True
    except Exception:
        pass
    nt, pr = _principled(mat)
    pr.inputs['Base Color'].default_value = (0.95, 0.97, 1.0, 1)
    pr.inputs['Metallic'].default_value = 0.0
    pr.inputs['Roughness'].default_value = 0.02
    pr.inputs['IOR'].default_value = 2.42
    pr.inputs['Transmission Weight'].default_value = 1.0
    pr.inputs['Alpha'].default_value = 0.85
    pr.inputs['Coat Weight'].default_value = 0.4
    pr.inputs['Coat Roughness'].default_value = 0.02
    if 'Emission Color' in pr.inputs:
        pr.inputs['Emission Color'].default_value = (0.7, 0.85, 1.0, 1)
        pr.inputs['Emission Strength'].default_value = 0.15
    return mat


def mat_emissive(name, color, strength):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    _, pr = _principled(mat)
    pr.inputs['Base Color'].default_value = (*color, 1)
    pr.inputs['Emission Color'].default_value = (*color, 1)
    pr.inputs['Emission Strength'].default_value = strength
    pr.inputs['Roughness'].default_value = 0.2
    return mat


def mat_leather(name='Leather', color=(0.18, 0.04, 0.04)):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    _, pr = _principled(mat)
    pr.inputs['Base Color'].default_value = (*color, 1)
    pr.inputs['Roughness'].default_value = 0.55
    pr.inputs['Metallic'].default_value = 0.0
    pr.inputs['Coat Weight'].default_value = 0.15
    pr.inputs['Coat Roughness'].default_value = 0.4
    return mat


def assign(obj, mat):
    if obj.data.materials:
        obj.data.materials[0] = mat
    else:
        obj.data.materials.append(mat)




# ---------- body ----------
def build_body_cage(ny=40, ns=16):
    """Half-body lofted as quads, then mirrored. Y in [-2.08, 2.08]."""
    ys = [lerp(-2.08, 2.08, i / (ny - 1)) for i in range(ny)]
    # denser stations near the axles and pillars
    extra = []
    for c, w, k in ((AXLE_R, 0.45, 6), (AXLE_F, 0.40, 6), (-0.95, 0.2, 3), (0.70, 0.2, 3)):
        for i in range(k):
            extra.append(c + lerp(-w, w, i / max(1, k - 1)))
    ys = sorted(set(round(y, 4) for y in ys + extra))
    rings = [half_section(y, ns) for y in ys]
    bm = bmesh.new()
    verts = []
    for yi, y in enumerate(ys):
        row = []
        for x, z in rings[yi]:
            row.append(bm.verts.new((x, y, z)))
        verts.append(row)
    bm.verts.ensure_lookup_table()
    for yi in range(len(ys) - 1):
        for si in range(ns - 1):
            a, b = verts[yi][si], verts[yi][si + 1]
            c, d = verts[yi + 1][si + 1], verts[yi + 1][si]
            try:
                bm.faces.new((a, b, c, d))
            except ValueError:
                pass
    # Crease the belt / fender-crown loop so subsurf keeps the shoulder.
    crease = None
    try:
        crease = bm.edges.layers.float.verify('crease_edge')
    except Exception:
        try:
            crease = bm.edges.layers.crease.verify()
        except Exception:
            crease = None
    if crease is not None:
        for yi in range(len(ys)):
            for si in (6, 7):
                if si + 0 < ns and yi + 1 < len(ys):
                    # longitudinal edges at the crown / belt
                    v0, v1 = verts[yi][si], verts[min(yi + 1, len(ys) - 1)][si]
                    for e in v0.link_edges:
                        if e.other_vert(v0) == v1:
                            e[crease] = 0.65
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = mesh_from_bmesh('BubbleBodyHalf', bm)
    obj = new_obj('BubbleBody', me)
    # Mirror
    mir = obj.modifiers.new('Mirror', 'MIRROR')
    mir.use_axis[0] = True
    mir.use_clip = True
    mir.merge_threshold = 0.0004
    add_subsurf(obj, view=1, render=2)
    set_prop(obj, 'paint', 'body')
    return obj


def apply_modifiers(obj):
    """Apply all modifiers on obj, leaving a real mesh in place."""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    for m in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError:
            pass
    obj.select_set(False)
    return obj


def build_shutlines(body):
    """Thin dark recessed strips shrinkwrapped to the body: hood, doors, decklid."""
    mats_gap = mat_metal('Shutline', (0.02, 0.02, 0.022), 0.45)
    items = []

    def strip(name, pts, width=0.006, depth=0.004):
        # pts are world (x,y,z) along the gap centerline (one side). We'll build a thin ribbon.
        bm = bmesh.new()
        vs = []
        for i, p in enumerate(pts):
            tangent = Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[max(i - 1, 0)])
            if tangent.length < 1e-6:
                tangent = Vector((0, 1, 0))
            tangent.normalize()
            # a sideways vector — prefer world X for longitudinal hood lines, Z-up ribbon
            side = tangent.cross(Vector((0, 0, 1)))
            if side.length < 1e-6:
                side = tangent.cross(Vector((1, 0, 0)))
            side.normalize()
            up = side.cross(tangent).normalized()
            w, d = width * 0.5, depth
            a = Vector(p) + side * w - up * d
            b = Vector(p) - side * w - up * d
            vs.append((bm.verts.new(a), bm.verts.new(b)))
        for i in range(len(vs) - 1):
            try:
                bm.faces.new((vs[i][0], vs[i][1], vs[i + 1][1], vs[i + 1][0]))
            except ValueError:
                pass
        me = mesh_from_bmesh(name, bm, smooth=True)
        obj = new_obj(name, me)
        sw = obj.modifiers.new('SW', 'SHRINKWRAP')
        sw.target = body
        sw.wrap_method = 'NEAREST_SURFACEPOINT'
        sw.offset = -0.0015
        sw.use_negative_direction = True
        sw.use_positive_direction = False
        assign(obj, mats_gap)
        set_prop(obj, 'matte', 'body', (0.04, 0.04, 0.045))
        items.append(obj)
        return obj

    # Hood outline (right half, mirrored later as separate strips for both sides + center)
    # Hood: from scuttle (y=0.86) down to nose, along a path slightly inboard of fender
    def path_hood_side(sign):
        pts = []
        for i in range(18):
            y = lerp(0.88, 2.00, i / 17)
            # slightly inboard of fender / along the hood cut
            x = sign * (catmull(TUB_W, y) * 0.72)
            z = catmull(ROOF, y) + 0.002
            pts.append((x, y, z))
        return pts

    for s in (-1, 1):
        strip(f'GapHoodSide_{s}', path_hood_side(s), width=0.005)
    # Hood leading edge
    pts = []
    for i in range(12):
        x = lerp(-0.28, 0.28, i / 11)
        y, z = 2.00, catmull(ROOF, 2.00) + 0.002
        pts.append((x, y, z))
    strip('GapHoodFront', pts, width=0.005)
    # Scuttle
    pts = []
    for i in range(14):
        x = lerp(-0.52, 0.52, i / 13)
        y, z = 0.86, catmull(ROOF, 0.86) + 0.002
        pts.append((x, y, z))
    strip('GapScuttle', pts, width=0.005)

    # Door: A-pillar, B-pillar, belt, rocker — both sides
    def door_loop(sign):
        # A (front) pillar down, rocker back, B pillar up, belt forward
        pts = []
        # A pillar from belt to rocker
        for i in range(8):
            z = lerp(0.88, 0.28, i / 7)
            y = 0.62
            x = sign * 0.665
            pts.append((x, y, z))
        for i in range(10):
            y = lerp(0.62, -0.85, i / 9)
            x = sign * 0.665
            pts.append((x, y, 0.28))
        for i in range(8):
            z = lerp(0.28, 0.88, i / 7)
            y = -0.85
            x = sign * 0.665
            pts.append((x, y, z))
        for i in range(10):
            y = lerp(-0.85, 0.62, i / 9)
            x = sign * 0.655
            pts.append((x, y, 0.88))
        return pts

    for s in (-1, 1):
        strip(f'GapDoor_{s}', door_loop(s), width=0.0045)

    # Decklid
    def path_deck_side(sign):
        pts = []
        for i in range(14):
            y = lerp(-0.95, -1.98, i / 13)
            x = sign * (catmull(TUB_W, y) * 0.7)
            z = catmull(ROOF, y) + 0.002
            pts.append((x, y, z))
        return pts

    for s in (-1, 1):
        strip(f'GapDeck_{s}', path_deck_side(s), width=0.005)
    pts = []
    for i in range(12):
        x = lerp(-0.36, 0.36, i / 11)
        pts.append((x, -1.98, catmull(ROOF, -1.98) + 0.002))
    strip('GapDeckRear', pts, width=0.005)
    return items


def build_glass():
    items = []
    glass = mat_glass()
    glass_red = mat_glass('TailGlass', (0.45, 0.02, 0.02, 1), trans=0.75)
    # Windshield — slightly curved plane
    bm = bmesh.new()
    ny, nx = 8, 8
    for j in range(ny):
        v = j / (ny - 1)
        y = lerp(0.84, 0.54, v)
        z0 = lerp(0.94, 1.40, v)
        # slight curve in Z and rake
        for i in range(nx):
            u = i / (nx - 1)
            x = lerp(-0.50, 0.50, u)
            # wrap slightly around
            wrap = 0.03 * (1 - (2 * u - 1) ** 2)
            bm.verts.new((x, y + wrap * 0.15, z0 - 0.02 * (2 * u - 1) ** 2))
    bm.verts.ensure_lookup_table()
    for j in range(ny - 1):
        for i in range(nx - 1):
            a = bm.verts[j * nx + i]
            b = bm.verts[j * nx + i + 1]
            c = bm.verts[(j + 1) * nx + i + 1]
            d = bm.verts[(j + 1) * nx + i]
            bm.faces.new((a, b, c, d))
    me = mesh_from_bmesh('Windshield', bm)
    obj = new_obj('Windshield', me)
    sol = obj.modifiers.new('Solidify', 'SOLIDIFY')
    sol.thickness = 0.006
    sol.offset = 0
    assign(obj, glass)
    set_prop(obj, 'glass', 'body')
    items.append(obj)

    # Rear window
    bm = bmesh.new()
    ny, nx = 6, 8
    for j in range(ny):
        v = j / (ny - 1)
        y = lerp(-1.00, -1.22, v)
        z0 = lerp(1.42, 1.08, v)
        for i in range(nx):
            u = i / (nx - 1)
            x = lerp(-0.42, 0.42, u) * lerp(0.85, 1.0, v)
            bm.verts.new((x, y, z0 - 0.015 * (2 * u - 1) ** 2))
    bm.verts.ensure_lookup_table()
    for j in range(ny - 1):
        for i in range(nx - 1):
            a = bm.verts[j * nx + i]
            b = bm.verts[j * nx + i + 1]
            c = bm.verts[(j + 1) * nx + i + 1]
            d = bm.verts[(j + 1) * nx + i]
            bm.faces.new((a, b, c, d))
    me = mesh_from_bmesh('RearWindow', bm)
    obj = new_obj('RearWindow', me)
    sol = obj.modifiers.new('Solidify', 'SOLIDIFY')
    sol.thickness = 0.006
    assign(obj, glass)
    set_prop(obj, 'glass', 'body')
    items.append(obj)

    # Side windows (left + right)
    for sign in (-1, 1):
        bm = bmesh.new()
        # two panes: door + rear quarter, slight wrap
        corners = [
            # door glass
            [(sign * 0.58, 0.55, 0.92), (sign * 0.58, -0.15, 0.92),
             (sign * 0.50, -0.15, 1.36), (sign * 0.48, 0.48, 1.38)],
            # rear quarter
            [(sign * 0.58, -0.22, 0.92), (sign * 0.58, -0.82, 0.92),
             (sign * 0.48, -0.88, 1.34), (sign * 0.50, -0.22, 1.36)],
        ]
        for quad in corners:
            vs = [bm.verts.new(p) for p in quad]
            bm.faces.new(vs)
        me = mesh_from_bmesh(f'SideGlass_{sign}', bm)
        obj = new_obj(f'SideGlass_{sign}', me)
        sol = obj.modifiers.new('Solidify', 'SOLIDIFY')
        sol.thickness = 0.005
        assign(obj, glass)
        set_prop(obj, 'glass', 'body')
        items.append(obj)
    return items


def build_interior():
    items = []
    leather = mat_leather()
    leather_dark = mat_leather('Dash', (0.06, 0.05, 0.05))
    chrome = mat_metal('IntChrome', (0.8, 0.82, 0.85), 0.08)

    def cube(name, loc, scale, mat, role='matte', color=(0.18, 0.04, 0.04)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        obj = bpy.context.active_object
        obj.name = name
        obj.scale = scale
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        # slight bevel
        bev = obj.modifiers.new('Bevel', 'BEVEL')
        bev.width = 0.012
        bev.segments = 2
        assign(obj, mat)
        set_prop(obj, role, 'body', color)
        items.append(obj)
        return obj

    # Cabin tub / floor
    cube('CabinFloor', (0, -0.15, 0.22), (1.10, 1.70, 0.04), leather_dark, 'matte', (0.05, 0.05, 0.05))
    # Front bench
    cube('SeatFront', (0, 0.15, 0.42), (1.00, 0.42, 0.16), leather, 'matte', (0.18, 0.04, 0.04))
    cube('SeatFrontBack', (0, -0.12, 0.72), (1.00, 0.12, 0.48), leather, 'matte', (0.18, 0.04, 0.04))
    # Rear bench
    cube('SeatRear', (0, -0.70, 0.42), (1.00, 0.36, 0.16), leather, 'matte', (0.16, 0.04, 0.04))
    cube('SeatRearBack', (0, -0.92, 0.68), (1.00, 0.10, 0.40), leather, 'matte', (0.16, 0.04, 0.04))
    # Dash
    cube('Dash', (0, 0.62, 0.72), (1.05, 0.22, 0.22), leather_dark, 'matte', (0.06, 0.05, 0.05))
    # Steering wheel (left-hand)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.16, minor_radius=0.012, major_segments=24, minor_segments=8,
                                     location=(-0.32, 0.48, 0.82), rotation=(math.radians(70), 0, 0))
    wheel = bpy.context.active_object
    wheel.name = 'Steer'
    assign(wheel, leather_dark)
    set_prop(wheel, 'matte', 'body', (0.05, 0.05, 0.05))
    items.append(wheel)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.012, depth=0.22, location=(-0.32, 0.56, 0.74),
                                        rotation=(math.radians(70), 0, 0))
    col = bpy.context.active_object
    col.name = 'SteerCol'
    assign(col, chrome)
    set_prop(col, 'metal', 'body', (0.8, 0.82, 0.85))
    items.append(col)
    return items


def build_lights():
    items = []
    chrome = mat_metal('LampChrome', (0.9, 0.91, 0.93), 0.04)
    glass_c = mat_glass('Lens', (0.85, 0.9, 0.95, 1), trans=0.96, rough=0.02)
    glass_amber = mat_glass('Amber', (0.85, 0.5, 0.1, 1), trans=0.7)
    glass_red = mat_glass('TailLens', (0.65, 0.02, 0.02, 1), trans=0.65, rough=0.04)
    bulb = mat_emissive('Bulb', (1.0, 0.96, 0.85), 12.0)
    tail_e = mat_emissive('TailEmit', (0.85, 0.02, 0.02), 4.0)
    amber_e = mat_emissive('AmberEmit', (1.0, 0.45, 0.05), 3.0)

    # Headlight centers sit on the front fender crown, slightly inboard
    # Empirically around y=1.62, z=0.62, x=±0.58
    hx, hy, hz = 0.62, 1.58, 0.72
    for sign in (-1, 1):
        loc = (sign * hx, hy, hz)
        # aim mostly forward, a hint outward
        rot = (math.radians(90), 0, math.radians(sign * 8))
        # chrome bucket
        bpy.ops.mesh.primitive_cylinder_add(radius=0.125, depth=0.10, location=(sign * hx, hy - 0.02, hz),
                                            rotation=(math.radians(90), 0, 0))
        bucket = bpy.context.active_object
        bucket.name = f'HLBucket_{sign}'
        assign(bucket, chrome)
        set_prop(bucket, 'metal', 'body', (0.9, 0.91, 0.93))
        items.append(bucket)
        # reflector (inner, slightly smaller, emissive-ish metal)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.11, segments=32, ring_count=16,
                                             location=(sign * hx, hy - 0.01, hz))
        refl = bpy.context.active_object
        refl.name = f'HLReflector_{sign}'
        assign(refl, chrome)
        set_prop(refl, 'metal', 'body', (0.95, 0.95, 0.97))
        items.append(refl)
        # bulb
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.022, segments=12, ring_count=8,
                                             location=(sign * hx, hy + 0.01, hz))
        b = bpy.context.active_object
        b.name = f'HLBulb_{sign}'
        assign(b, bulb)
        set_prop(b, 'lamp', 'body', (1.0, 0.96, 0.8))
        items.append(b)
        # lens — flattened sphere sitting on the front of the bucket
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.128, segments=32, ring_count=16,
                                             location=(sign * hx, hy + 0.04, hz))
        lens = bpy.context.active_object
        lens.name = f'HLLens_{sign}'
        lens.scale = (1.0, 0.35, 1.0)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        assign(lens, glass_c)
        set_prop(lens, 'glass', 'body')
        items.append(lens)
        # chrome bezel ring
        bpy.ops.mesh.primitive_torus_add(major_radius=0.128, minor_radius=0.010, major_segments=40, minor_segments=10,
                                         location=(sign * hx, hy + 0.045, hz), rotation=(math.radians(90), 0, 0))
        ring = bpy.context.active_object
        ring.name = f'HLRing_{sign}'
        assign(ring, chrome)
        set_prop(ring, 'metal', 'body', (0.9, 0.91, 0.93))
        items.append(ring)
        # amber side marker on the fender
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.035, segments=12, ring_count=8,
                                             location=(sign * 0.72, 1.28, 0.72))
        am = bpy.context.active_object
        am.name = f'Amber_{sign}'
        am.scale = (0.7, 1.1, 0.55)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        assign(am, glass_amber)
        set_prop(am, 'glass', 'body')
        items.append(am)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.016, segments=8, ring_count=6,
                                             location=(sign * 0.72, 1.28, 0.72))
        ae = bpy.context.active_object
        ae.name = f'AmberEmit_{sign}'
        assign(ae, amber_e)
        set_prop(ae, 'lamp', 'body', (1.0, 0.5, 0.08))
        items.append(ae)

    # Taillights — oval on the rear fenders
    tx, ty, tz = 0.62, -1.88, 0.62
    for sign in (-1, 1):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.075, segments=16, ring_count=10,
                                             location=(sign * tx, ty, tz))
        body = bpy.context.active_object
        body.name = f'TLBody_{sign}'
        body.scale = (1.15, 0.45, 0.75)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        assign(body, glass_red)
        set_prop(body, 'glass', 'body')
        items.append(body)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.03, segments=8, ring_count=6,
                                             location=(sign * tx, ty - 0.01, tz))
        te = bpy.context.active_object
        te.name = f'TLEmit_{sign}'
        assign(te, tail_e)
        set_prop(te, 'lamp', 'body', (0.85, 0.05, 0.05))
        items.append(te)
        bpy.ops.mesh.primitive_torus_add(major_radius=0.078, minor_radius=0.007, major_segments=20, minor_segments=8,
                                         location=(sign * tx, ty - 0.01, tz), rotation=(math.radians(90), 0, 0))
        tr = bpy.context.active_object
        tr.name = f'TLRing_{sign}'
        tr.scale = (1.15, 1.0, 0.75)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        assign(tr, chrome)
        set_prop(tr, 'metal', 'body', (0.9, 0.91, 0.93))
        items.append(tr)
    return items


def _sweep_bar(name, pts, radius=0.018, segs=10):
    """Sweep a circular bar along pts (list of Vector)."""
    curve = bpy.data.curves.new(name + 'Crv', 'CURVE')
    curve.dimensions = '3D'
    curve.resolution_u = 8
    spline = curve.splines.new('POLY')
    spline.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        spline.points[i].co = (p[0], p[1], p[2], 1)
    curve.bevel_depth = radius
    curve.bevel_resolution = max(2, segs // 3)
    curve.use_fill_caps = True
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    # convert to mesh
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.select_set(False)
    return obj


def build_bumpers_trim():
    items = []
    chrome = mat_metal('Chrome', (0.88, 0.90, 0.93), 0.035)
    # Front bumper wraparound, slightly V-shaped, two-bar look via a thick bar + overriders
    def wrap(y_face, z, x_end, y_back):
        pts = []
        # left wrap -> front -> right wrap
        for i in range(6):
            t = i / 5
            ang = lerp(math.pi / 2, 0, t)
            # from side (x=-x_end, y=y_back) around to front corner
            x = -x_end * math.cos(lerp(0, math.pi / 2, t))  # hmm
        # explicit polyline
        pts = [
            (-x_end, y_back, z),
            (-x_end, (y_face + y_back) / 2, z),
            (-x_end * 0.92, y_face - 0.02, z),
            (-x_end * 0.55, y_face, z + 0.01),
            (0.0, y_face + 0.01, z + 0.015),
            (x_end * 0.55, y_face, z + 0.01),
            (x_end * 0.92, y_face - 0.02, z),
            (x_end, (y_face + y_back) / 2, z),
            (x_end, y_back, z),
        ]
        return pts

    front = _sweep_bar('BumperFront', wrap(2.10, 0.36, 0.70, 1.92), radius=0.022)
    assign(front, chrome)
    set_prop(front, 'metal', 'body', (0.88, 0.90, 0.93))
    items.append(front)
    # second lower bar, slightly smaller
    front2 = _sweep_bar('BumperFrontLo', wrap(2.07, 0.28, 0.66, 1.94), radius=0.014)
    assign(front2, chrome)
    set_prop(front2, 'metal', 'body', (0.88, 0.90, 0.93))
    items.append(front2)
    # overriders
    for sign in (-1, 1):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.018, depth=0.16,
                                            location=(sign * 0.38, 2.12, 0.34),
                                            rotation=(0, 0, 0))
        o = bpy.context.active_object
        o.name = f'OverriderF_{sign}'
        assign(o, chrome)
        set_prop(o, 'metal', 'body', (0.88, 0.90, 0.93))
        items.append(o)

    rear = _sweep_bar('BumperRear', wrap(-2.10, 0.36, 0.70, -1.92), radius=0.022)
    assign(rear, chrome)
    set_prop(rear, 'metal', 'body', (0.88, 0.90, 0.93))
    items.append(rear)
    rear2 = _sweep_bar('BumperRearLo', wrap(-2.07, 0.28, 0.66, -1.94), radius=0.014)
    assign(rear2, chrome)
    set_prop(rear2, 'metal', 'body', (0.88, 0.90, 0.93))
    items.append(rear2)
    for sign in (-1, 1):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.018, depth=0.16,
                                            location=(sign * 0.38, -2.12, 0.34))
        o = bpy.context.active_object
        o.name = f'OverriderR_{sign}'
        assign(o, chrome)
        set_prop(o, 'metal', 'body', (0.88, 0.90, 0.93))
        items.append(o)

    # Running-board chrome strip
    for sign in (-1, 1):
        pts = [(sign * 0.70, 0.55, 0.275), (sign * 0.70, 0.0, 0.27), (sign * 0.70, -0.55, 0.275)]
        rb = _sweep_bar(f'BoardChrome_{sign}', pts, radius=0.008)
        assign(rb, chrome)
        set_prop(rb, 'metal', 'body', (0.88, 0.90, 0.93))
        items.append(rb)
        # matte board surface
        bpy.ops.mesh.primitive_cube_add(size=1, location=(sign * 0.68, 0.0, 0.255))
        board = bpy.context.active_object
        board.name = f'Board_{sign}'
        board.scale = (0.08, 1.05, 0.018)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        assign(board, mat_metal('BoardDark', (0.08, 0.08, 0.09), 0.5))
        set_prop(board, 'matte', 'body', (0.08, 0.08, 0.09))
        items.append(board)

    # Belt chrome (both sides)
    for sign in (-1, 1):
        pts = []
        for i in range(16):
            y = lerp(0.70, -1.00, i / 15)
            x = sign * catmull(TUB_W, y) * 1.01
            z = catmull(BELT, y) + 0.004
            pts.append((x, y, z))
        bel = _sweep_bar(f'BeltChrome_{sign}', pts, radius=0.006)
        assign(bel, chrome)
        set_prop(bel, 'metal', 'body', (0.88, 0.90, 0.93))
        items.append(bel)

    # Door handles
    for sign in (-1, 1):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(sign * 0.68, 0.05, 0.78))
        h = bpy.context.active_object
        h.name = f'Handle_{sign}'
        h.scale = (0.02, 0.07, 0.018)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        bev = h.modifiers.new('Bevel', 'BEVEL')
        bev.width = 0.004
        bev.segments = 2
        assign(h, chrome)
        set_prop(h, 'metal', 'body', (0.88, 0.90, 0.93))
        items.append(h)

    # Mirrors
    for sign in (-1, 1):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.008, depth=0.10,
                                            location=(sign * 0.72, 0.55, 0.95),
                                            rotation=(0, math.radians(sign * 70), 0))
        arm = bpy.context.active_object
        arm.name = f'MirrorArm_{sign}'
        assign(arm, chrome)
        set_prop(arm, 'metal', 'body', (0.88, 0.90, 0.93))
        items.append(arm)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.055, segments=12, ring_count=8,
                                             location=(sign * 0.80, 0.55, 0.97))
        cap = bpy.context.active_object
        cap.name = f'MirrorCap_{sign}'
        cap.scale = (0.7, 0.45, 0.55)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        assign(cap, chrome)
        set_prop(cap, 'metal', 'body', (0.88, 0.90, 0.93))
        items.append(cap)
    return items


def build_emblem_and_plate(tier='epic', body=None):
    items = []
    chrome = mat_metal('EmblemChrome', (0.9, 0.91, 0.93), 0.04)
    black = mat_metal('EmblemBlack', (0.02, 0.02, 0.02), 0.35)
    gold = mat_gold()
    diamond = mat_diamond()

    # Hood emblem — circular VWFEST badge (no manufacturer logo)
    # Flush circular VWFEST badge — small, no shrinkwrap (that was collapsing into a V).
    hood_y, hood_z = 1.48, catmull(ROOF, 1.48) + 0.004
    bpy.ops.mesh.primitive_cylinder_add(radius=0.055, depth=0.006,
                                        location=(0, hood_y, hood_z),
                                        rotation=(math.radians(20), 0, 0))
    disc = bpy.context.active_object
    disc.name = 'EmblemDisc'
    assign(disc, black)
    set_prop(disc, 'matte', 'body', (0.02, 0.02, 0.02))
    items.append(disc)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.055, minor_radius=0.005, major_segments=28, minor_segments=8,
                                     location=(0, hood_y + 0.002, hood_z + 0.003), rotation=(math.radians(20), 0, 0))
    ring = bpy.context.active_object
    ring.name = 'EmblemRing'
    assign(ring, chrome)
    set_prop(ring, 'metal', 'body', (0.9, 0.91, 0.93))
    items.append(ring)
    # VWFEST text on the emblem — created in the disc's local space as a child
    if os.path.exists(FONT):
        curve = bpy.data.curves.new('EmblemTextCrv', 'FONT')
        curve.body = 'VWFEST'
        curve.font = bpy.data.fonts.load(FONT)
        curve.size = 0.018
        curve.align_x = 'CENTER'
        curve.align_y = 'CENTER'
        curve.extrude = 0.002
        txt = bpy.data.objects.new('EmblemText', curve)
        bpy.context.scene.collection.objects.link(txt)
        txt.parent = disc
        txt.location = (0, 0, 0.007)
        txt.rotation_euler = (0, 0, 0)
        assign(txt, chrome)
        set_prop(txt, 'metal', 'body', (0.9, 0.91, 0.93))
        items.append(txt)

    # Rear (and for epic, clearly visible) gold diamond VWFEST plate
    # Plate plane faces -Y (rear). Local Z is plate normal after rotation.
    plate_w, plate_h = 0.36, 0.18
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -2.12, 0.52))
    plate = bpy.context.active_object
    plate.name = 'PlateRear'
    plate.scale = (plate_w, 0.010, plate_h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bev = plate.modifiers.new('Bevel', 'BEVEL')
    bev.width = 0.004
    bev.segments = 2
    if tier == 'epic':
        assign(plate, gold)
        set_prop(plate, 'plate', 'body', (0.83, 0.58, 0.16))
    elif tier == 'rare':
        assign(plate, chrome)
        set_prop(plate, 'plate', 'body', (0.85, 0.87, 0.90))
    else:
        assign(plate, mat_metal('PlateStd', (0.75, 0.75, 0.72), 0.28))
        set_prop(plate, 'plate', 'body', (0.75, 0.75, 0.72))
    # UVs for the plate role
    me = plate.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    items.append(plate)

    # 3D VWFEST letters — born as children of the plate in local space (fixes the old parenting ghost)
    if os.path.exists(FONT):
        curve = bpy.data.curves.new('PlateLettersCrv', 'FONT')
        curve.body = 'VWFEST'
        curve.font = bpy.data.fonts.load(FONT)
        curve.size = 0.055
        curve.align_x = 'CENTER'
        curve.align_y = 'CENTER'
        curve.extrude = 0.006
        curve.bevel_depth = 0.0015
        curve.bevel_resolution = 2
        letters = bpy.data.objects.new('PlateLetters', curve)
        bpy.context.scene.collection.objects.link(letters)
        letters.parent = plate
        # Plate is a thin cube in XY? After scale apply: it's a box centered, local Y is thickness (front-back).
        # The rear face is -Y. Letters should sit on the -Y face, rotated to face -Y.
        # Font faces +Z by default. Euler X=+90 sends that normal to -Y (rear).
        # No Z-180 — that was mirroring the letters.
        letters.location = (0.0, -0.012, 0.0)
        letters.rotation_euler = (math.radians(90), 0, 0)
        if tier == 'epic':
            assign(letters, diamond)
            set_prop(letters, 'glass', 'body')
        else:
            assign(letters, mat_metal('PlateInk', (0.05, 0.05, 0.06), 0.4))
            set_prop(letters, 'matte', 'body', (0.05, 0.05, 0.06))
        items.append(letters)
    return items


# ---------- wheels ----------
def _tire_and_whitewall(whitewall=False):
    items = []
    tire_mat = mat_rubber()
    ww_mat = mat_whitewall()
    # Tire — torus, axis along X
    bpy.ops.mesh.primitive_torus_add(
        major_radius=WR - 0.042, minor_radius=0.042,
        major_segments=24, minor_segments=10,
        location=(0, 0, 0), rotation=(0, math.pi / 2, 0),
    )
    tire = bpy.context.active_object
    tire.name = 'Tire'
    assign(tire, tire_mat)
    set_prop(tire, 'matte', 'w', (0.03, 0.03, 0.032))
    items.append(tire)
    ww = None
    if whitewall:
        # A thin band on the outer sidewall (toward +X, the visible face; we'll flip per side later)
        bpy.ops.mesh.primitive_torus_add(
            major_radius=WR - 0.062, minor_radius=0.022,
            major_segments=24, minor_segments=8,
            location=(0.055, 0, 0), rotation=(0, math.pi / 2, 0),
        )
        ww = bpy.context.active_object
        ww.name = 'Whitewall'
        ww.scale = (1.0, 1.0, 1.15)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        assign(ww, ww_mat)
        set_prop(ww, 'matte', 'w', (0.86, 0.82, 0.74))
        items.append(ww)
    return items


def _rim_stock():
    chrome = mat_metal('Hubcap', (0.88, 0.90, 0.93), 0.06)
    steel = mat_metal('SteelRim', (0.35, 0.36, 0.38), 0.35)
    items = []
    bpy.ops.mesh.primitive_cylinder_add(radius=WR - TIRE_W * 0.62, depth=0.10, location=(0.02, 0, 0),
                                        rotation=(0, math.pi / 2, 0), vertices=20)
    rim = bpy.context.active_object
    rim.name = 'RimStock'
    assign(rim, steel)
    set_prop(rim, 'metal', 'w', (0.35, 0.36, 0.38))
    items.append(rim)
    # dog-dish hubcap
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.13, segments=20, ring_count=10, location=(0.06, 0, 0))
    cap = bpy.context.active_object
    cap.name = 'Hubcap'
    cap.scale = (0.28, 1, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    assign(cap, chrome)
    set_prop(cap, 'metal', 'w', (0.88, 0.90, 0.93))
    items.append(cap)
    bpy.ops.mesh.primitive_torus_add(major_radius=WR - TIRE_W * 0.62, minor_radius=0.010,
                                     major_segments=20, minor_segments=6,
                                     location=(0.07, 0, 0), rotation=(0, math.pi / 2, 0))
    lip = bpy.context.active_object
    lip.name = 'RimLip'
    assign(lip, chrome)
    set_prop(lip, 'metal', 'w', (0.88, 0.90, 0.93))
    items.append(lip)
    return items


def _rim_steelie():
    steel = mat_metal('Steelie', (0.08, 0.08, 0.09), 0.4)
    chrome = mat_metal('SteelieRing', (0.88, 0.90, 0.93), 0.06)
    items = []
    bpy.ops.mesh.primitive_cylinder_add(radius=WR - TIRE_W * 0.62, depth=0.10, location=(0.02, 0, 0),
                                        rotation=(0, math.pi / 2, 0), vertices=20)
    rim = bpy.context.active_object
    rim.name = 'RimSteelie'
    assign(rim, steel)
    set_prop(rim, 'metal', 'w', (0.08, 0.08, 0.09))
    items.append(rim)
    bpy.ops.mesh.primitive_torus_add(major_radius=WR - TIRE_W * 0.62, minor_radius=0.010,
                                     major_segments=20, minor_segments=6,
                                     location=(0.07, 0, 0), rotation=(0, math.pi / 2, 0))
    lip = bpy.context.active_object
    lip.name = 'SteelieLip'
    assign(lip, chrome)
    set_prop(lip, 'metal', 'w', (0.88, 0.90, 0.93))
    items.append(lip)
    return items


def _rim_spokes(n=5, color=(0.55, 0.42, 0.22), deep=0.08, name='Fuchs'):
    metal = mat_metal(name, color, 0.12)
    chrome = mat_metal(name + 'Lip', (0.88, 0.90, 0.93), 0.04)
    items = []
    # deep dish barrel
    bpy.ops.mesh.primitive_cylinder_add(radius=WR - TIRE_W * 0.62, depth=0.12, location=(0.0, 0, 0),
                                        rotation=(0, math.pi / 2, 0), vertices=20)
    barrel = bpy.context.active_object
    barrel.name = name + 'Barrel'
    assign(barrel, chrome if color[0] > 0.7 else metal)
    set_prop(barrel, 'metal', 'w', color if color[0] <= 0.7 else (0.88, 0.90, 0.93))
    items.append(barrel)
    # hub
    bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=0.06, location=(deep, 0, 0),
                                        rotation=(0, math.pi / 2, 0), vertices=12)
    hub = bpy.context.active_object
    hub.name = name + 'Hub'
    assign(hub, metal)
    set_prop(hub, 'metal', 'w', color)
    items.append(hub)
    for i in range(n):
        ang = i * 2 * math.pi / n
        # spoke along YZ, extruded toward +X
        bpy.ops.mesh.primitive_cube_add(size=1, location=(deep * 0.5, math.cos(ang) * 0.10, math.sin(ang) * 0.10))
        sp = bpy.context.active_object
        sp.name = f'{name}Spoke_{i}'
        sp.scale = (0.04, 0.025, 0.14)
        sp.rotation_euler = (ang, 0, 0)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        assign(sp, metal)
        set_prop(sp, 'metal', 'w', color)
        items.append(sp)
    bpy.ops.mesh.primitive_torus_add(major_radius=WR - TIRE_W * 0.60, minor_radius=0.012,
                                     major_segments=20, minor_segments=6,
                                     location=(0.07, 0, 0), rotation=(0, math.pi / 2, 0))
    lip = bpy.context.active_object
    lip.name = name + 'Lip'
    assign(lip, chrome)
    set_prop(lip, 'metal', 'w', (0.88, 0.90, 0.93))
    items.append(lip)
    return items


def _rim_chrome_slotted():
    chrome = mat_metal('SlotChrome', (0.90, 0.91, 0.94), 0.035)
    items = []
    bpy.ops.mesh.primitive_cylinder_add(radius=WR - TIRE_W * 0.62, depth=0.14, location=(-0.01, 0, 0),
                                        rotation=(0, math.pi / 2, 0), vertices=24)
    barrel = bpy.context.active_object
    barrel.name = 'SlotBarrel'
    assign(barrel, chrome)
    set_prop(barrel, 'metal', 'w', (0.90, 0.91, 0.94))
    items.append(barrel)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.055, depth=0.05, location=(0.08, 0, 0),
                                        rotation=(0, math.pi / 2, 0), vertices=12)
    hub = bpy.context.active_object
    hub.name = 'SlotHub'
    assign(hub, chrome)
    set_prop(hub, 'metal', 'w', (0.90, 0.91, 0.94))
    items.append(hub)
    # 5 slotted windows suggested by thin walls (we just add 5 chunky spokes)
    for i in range(5):
        ang = i * 2 * math.pi / 5
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0.05, math.cos(ang) * 0.09, math.sin(ang) * 0.09))
        sp = bpy.context.active_object
        sp.scale = (0.05, 0.03, 0.13)
        sp.rotation_euler = (ang, 0, 0)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        assign(sp, chrome)
        set_prop(sp, 'metal', 'w', (0.90, 0.91, 0.94))
        items.append(sp)
    bpy.ops.mesh.primitive_torus_add(major_radius=WR - TIRE_W * 0.58, minor_radius=0.014,
                                     major_segments=24, minor_segments=6,
                                     location=(0.08, 0, 0), rotation=(0, math.pi / 2, 0))
    lip = bpy.context.active_object
    assign(lip, chrome)
    set_prop(lip, 'metal', 'w', (0.90, 0.91, 0.94))
    items.append(lip)
    return items


def _rim_wire(gold=False, n=12):
    color = (0.83, 0.58, 0.16) if gold else (0.90, 0.91, 0.94)
    metal = mat_metal('Wire' + ('Gold' if gold else 'Chrome'), color, 0.08 if gold else 0.04)
    items = []
    # deep dish
    bpy.ops.mesh.primitive_cylinder_add(radius=WR - TIRE_W * 0.60, depth=0.13, location=(-0.01, 0, 0),
                                        rotation=(0, math.pi / 2, 0), vertices=20)
    barrel = bpy.context.active_object
    assign(barrel, metal)
    set_prop(barrel, 'metal', 'w', color)
    items.append(barrel)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.045, depth=0.05, location=(0.07, 0, 0),
                                        rotation=(0, math.pi / 2, 0), vertices=10)
    hub = bpy.context.active_object
    assign(hub, metal)
    set_prop(hub, 'metal', 'w', color)
    items.append(hub)
    # wires — keep n modest for the triangle budget
    for i in range(n):
        ang = i * 2 * math.pi / n
        bpy.ops.mesh.primitive_cylinder_add(radius=0.0035, depth=0.22,
                                            location=(0.04, math.cos(ang) * 0.10, math.sin(ang) * 0.10),
                                            rotation=(ang, 0, 0))
        w = bpy.context.active_object
        assign(w, metal)
        set_prop(w, 'metal', 'w', color)
        items.append(w)
    lip_mat = metal if gold else mat_metal('WireLip', (0.90, 0.91, 0.94), 0.04)
    lip_col = color if gold else (0.90, 0.91, 0.94)
    bpy.ops.mesh.primitive_torus_add(major_radius=WR - 0.095, minor_radius=0.014,
                                     major_segments=24, minor_segments=8,
                                     location=(0.05, 0, 0), rotation=(0, math.pi / 2, 0))
    lip = bpy.context.active_object
    assign(lip, lip_mat)
    set_prop(lip, 'metal', 'w', lip_col)
    items.append(lip)
    bpy.ops.mesh.primitive_cylinder_add(radius=WR - 0.100, depth=0.014,
                                        location=(0.048, 0, 0),
                                        rotation=(0, math.pi / 2, 0), vertices=24)
    flange = bpy.context.active_object
    # punch a hole via a second cylinder? keep it as a shallow cap — the hub is already there.
    assign(flange, lip_mat)
    set_prop(flange, 'metal', 'w', lip_col)
    items.append(flange)
    return items


RIM_BUILDERS = [
    lambda: _rim_stock(),
    lambda: _rim_steelie(),
    lambda: _rim_spokes(5, (0.62, 0.45, 0.20), name='Fuchs'),
    lambda: _rim_chrome_slotted(),
    lambda: _rim_wire(gold=False, n=8),
    lambda: _rim_wire(gold=True, n=8),
]


def build_wheel_set(kind, whitewall=None):
    """Build 4 wheels of type kind (0-5). Returns objects already placed in the world."""
    if whitewall is None:
        whitewall = kind in (4,)  # wire whitewall
    # Build one at origin, then duplicate to 4 corners.
    built = _tire_and_whitewall(whitewall=whitewall) + RIM_BUILDERS[kind]()
    # Join-not: keep separate so roles stay distinct. Duplicate and place.
    corners = [
        (TRACK / 2, AXLE_F, WR),
        (-TRACK / 2, AXLE_F, WR),
        (TRACK / 2, AXLE_R, WR),
        (-TRACK / 2, AXLE_R, WR),
    ]
    # For the first corner we move the originals; others are copies
    placed = []
    for ci, (x, y, z) in enumerate(corners):
        for obj in built:
            if ci == 0:
                inst = obj
            else:
                inst = obj.copy()
                inst.data = obj.data.copy()
                bpy.context.scene.collection.objects.link(inst)
            # Flip the right-side wheels so the outer face (built on +X) points outward
            # Left side (x<0): rotate 180 around Z so +X local faces -X world
            inst.location = (x, y, z)
            if x < 0:
                inst.rotation_euler[2] = math.pi
            inst['layer'] = f'w{kind}'
            inst['role'] = obj.get('role', 'matte')
            if 'color' in obj:
                inst['color'] = obj['color']
            inst.name = f"w{kind}_{inst.get('role','x')}_{ci}_{obj.name}"
            placed.append(inst)
    return placed


# ---------- studio / render ----------
def setup_studio(underglow=False, glow_color=(0.55, 0.05, 0.85)):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 256
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    scene.cycles.preview_samples = 16
    scene.cycles.max_bounces = 8
    scene.cycles.transparent_max_bounces = 8
    scene.cycles.transmission_bounces = 8
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.render.resolution_x = int(os.environ.get('BUBBLE_RES', '1024'))
    scene.render.resolution_y = int(os.environ.get('BUBBLE_RES', '1024'))
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = -0.15
    scene.view_settings.gamma = 1.0
    scene.world.use_nodes = True
    nt = scene.world.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Color'].default_value = (0.02, 0.02, 0.025, 1)
    bg.inputs['Strength'].default_value = 0.35
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs['Background'], out.inputs['Surface'])

    # Glossy black floor
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
    floor = bpy.context.active_object
    floor.name = 'StudioFloor'
    floor_mat = bpy.data.materials.new('StudioFloor')
    floor_mat.use_nodes = True
    _, pr = _principled(floor_mat)
    pr.inputs['Base Color'].default_value = (0.012, 0.012, 0.014, 1)
    pr.inputs['Metallic'].default_value = 0.35
    pr.inputs['Roughness'].default_value = 0.08
    assign(floor, floor_mat)
    floor.hide_render = False

    # Dark cyclorama backdrop, slightly curved behind the car
    bpy.ops.mesh.primitive_plane_add(size=16, location=(0, -6.5, 4.0), rotation=(math.radians(80), 0, 0))
    cyc = bpy.context.active_object
    cyc.name = 'StudioCyc'
    cyc_mat = bpy.data.materials.new('StudioCyc')
    cyc_mat.use_nodes = True
    _, pr = _principled(cyc_mat)
    pr.inputs['Base Color'].default_value = (0.006, 0.006, 0.007, 1)
    pr.inputs['Roughness'].default_value = 0.65
    pr.inputs['Metallic'].default_value = 0.0
    assign(cyc, cyc_mat)

    def area(name, loc, rot, size, energy, color=(1, 1, 1)):
        bpy.ops.object.light_add(type='AREA', location=loc, rotation=rot)
        L = bpy.context.active_object
        L.name = name
        L.data.shape = 'RECTANGLE'
        L.data.size = size[0]
        L.data.size_y = size[1]
        L.data.energy = energy
        L.data.color = color
        L.data.spread = math.radians(170)
        return L

    # Key softbox — camera right / front / slightly above (classic 3/4 highlight)
    area('Key', (2.6, 3.8, 2.6), (math.radians(-50), 0, math.radians(35)), (2.2, 1.5), 280)
    # Fill — left, dimmer
    area('Fill', (-3.2, 2.4, 1.9), (math.radians(-40), 0, math.radians(-40)), (2.2, 1.6), 110)
    # Rim — behind-right, separates the roof from the void
    area('Rim', (2.0, -3.4, 2.2), (math.radians(-20), 0, math.radians(150)), (1.6, 0.8), 120)
    # Top soft
    area('Top', (0.0, 0.4, 3.8), (0, 0, 0), (2.4, 1.6), 50)
    # A faint camera-facing kicker so chrome gets a clean highlight
    area('Kicker', (-0.4, 4.6, 1.4), (math.radians(-15), 0, math.radians(180)), (1.2, 0.6), 40)

    if underglow:
        bpy.ops.object.light_add(type='AREA', location=(0, 0.05, 0.04), rotation=(0, 0, 0))
        g = bpy.context.active_object
        g.name = 'Underglow'
        g.data.shape = 'DISK'
        g.data.size = 2.4
        g.data.energy = 22
        g.data.color = glow_color
        g.data.spread = math.radians(180)
        # Soft circular wash — camera-hidden emissive disc with a spherical gradient
        bpy.ops.mesh.primitive_plane_add(size=1, location=(0, 0.05, 0.01))
        disc = bpy.context.active_object
        disc.name = 'GlowDisc'
        disc.scale = (1.35, 2.15, 1)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        em = bpy.data.materials.new('GlowDiscMat')
        em.use_nodes = True
        nt = em.node_tree
        nt.nodes.clear()
        out = nt.nodes.new('ShaderNodeOutputMaterial')
        emission = nt.nodes.new('ShaderNodeEmission')
        emission.inputs['Color'].default_value = (*glow_color, 1)
        emission.inputs['Strength'].default_value = 14.0
        coord = nt.nodes.new('ShaderNodeTexCoord')
        sep = nt.nodes.new('ShaderNodeSeparateXYZ')
        nt.links.new(coord.outputs['Object'], sep.inputs['Vector'])
        # radial distance in object XY, scaled
        mulx = nt.nodes.new('ShaderNodeMath'); mulx.operation = 'MULTIPLY'; mulx.inputs[1].default_value = 1.0 / 0.55
        muly = nt.nodes.new('ShaderNodeMath'); muly.operation = 'MULTIPLY'; muly.inputs[1].default_value = 1.0 / 0.95
        nt.links.new(sep.outputs['X'], mulx.inputs[0])
        nt.links.new(sep.outputs['Y'], muly.inputs[0])
        powx = nt.nodes.new('ShaderNodeMath'); powx.operation = 'MULTIPLY'
        nt.links.new(mulx.outputs[0], powx.inputs[0]); nt.links.new(mulx.outputs[0], powx.inputs[1])
        powy = nt.nodes.new('ShaderNodeMath'); powy.operation = 'MULTIPLY'
        nt.links.new(muly.outputs[0], powy.inputs[0]); nt.links.new(muly.outputs[0], powy.inputs[1])
        addn = nt.nodes.new('ShaderNodeMath'); addn.operation = 'ADD'
        nt.links.new(powx.outputs[0], addn.inputs[0]); nt.links.new(powy.outputs[0], addn.inputs[1])
        sqrt = nt.nodes.new('ShaderNodeMath'); sqrt.operation = 'POWER'; sqrt.inputs[1].default_value = 0.5
        nt.links.new(addn.outputs[0], sqrt.inputs[0])
        rng = nt.nodes.new('ShaderNodeMapRange')
        rng.inputs['From Min'].default_value = 0.05
        rng.inputs['From Max'].default_value = 1.0
        rng.inputs['To Min'].default_value = 1.0
        rng.inputs['To Max'].default_value = 0.0
        rng.clamp = True
        nt.links.new(sqrt.outputs[0], rng.inputs['Value'])
        # ease
        ease = nt.nodes.new('ShaderNodeMath'); ease.operation = 'MULTIPLY'
        nt.links.new(rng.outputs['Result'], ease.inputs[0])
        nt.links.new(rng.outputs['Result'], ease.inputs[1])
        mixs = nt.nodes.new('ShaderNodeMixShader')
        trans = nt.nodes.new('ShaderNodeBsdfTransparent')
        nt.links.new(ease.outputs[0], mixs.inputs['Fac'])
        nt.links.new(trans.outputs['BSDF'], mixs.inputs[1])
        nt.links.new(emission.outputs['Emission'], mixs.inputs[2])
        nt.links.new(mixs.outputs['Shader'], out.inputs['Surface'])
        assign(disc, em)
        disc.visible_camera = False
        disc.visible_shadow = False

    # Camera — 3/4 front, slightly low hero, ~50mm
    bpy.ops.object.camera_add(location=(2.05, 5.85, 1.12))
    cam = bpy.context.active_object
    cam.name = 'HeroCam'
    cam.data.lens = 62
    cam.data.sensor_width = 36
    cam.rotation_euler = (math.radians(78), 0, math.radians(28))
    tr = cam.constraints.new('TRACK_TO')
    bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0.0, 0.45, 0.55))
    target = bpy.context.active_object
    target.name = 'LookAt'
    tr.target = target
    tr.track_axis = 'TRACK_NEGATIVE_Z'
    tr.up_axis = 'UP_Y'
    scene.camera = cam
    return cam


def setup_plate_camera():
    bpy.ops.object.camera_add(location=(0.85, -3.35, 0.72))
    cam = bpy.context.active_object
    cam.name = 'PlateCam'
    cam.data.lens = 70
    cam.data.sensor_width = 36
    bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0.0, -2.10, 0.52))
    target = bpy.context.active_object
    target.name = 'PlateLook'
    tr = cam.constraints.new('TRACK_TO')
    tr.target = target
    tr.track_axis = 'TRACK_NEGATIVE_Z'
    tr.up_axis = 'UP_Y'
    bpy.context.scene.camera = cam
    # Fill the gold plate so it doesn't just reflect the black cyc
    bpy.ops.object.light_add(type='AREA', location=(0.55, -2.55, 0.95),
                             rotation=(math.radians(-40), 0, math.radians(15)))
    L = bpy.context.active_object
    L.name = 'PlateFill'
    L.data.shape = 'RECTANGLE'
    L.data.size = 0.6
    L.data.size_y = 0.4
    L.data.energy = 90
    L.data.color = (1.0, 0.95, 0.85)
    return cam


# ---------- assembly of a dressed car ----------
# palette (linear-ish approximations of the game COLORS)
COLORS = {
    0: (0.78, 0.05, 0.06),   # candy / solid red (concept target)
    2: (0.45, 0.22, 0.10),   # used as patina-ish warm; actual patina is handled by kind
    4: (0.04, 0.28, 0.48),   # ocean
    5: (0.32, 0.08, 0.78),   # purple
    7: (0.92, 0.92, 0.90),   # white
    16: (0.04, 0.04, 0.045), # black (index 15 actually) — not used
}
PATINA_COL = (0.42, 0.34, 0.22)


TIERS = {
    'common': dict(kind='patina', c1=PATINA_COL, c2=None, wheels=0, stripe=False, underglow=False, plate='common', chrome_extra=False),
    'rare': dict(kind='two', c1=COLORS[4], c2=COLORS[7], wheels=3, stripe=True, underglow=False, plate='rare', chrome_extra=False),
    'epic': dict(kind='candy', c1=COLORS[0], c2=None, wheels=4, stripe=False, underglow=True, plate='epic', chrome_extra=True),
}




def _box_cutter(name, loc, scale, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.hide_render = True
    obj.display_type = 'WIRE'
    return obj


def cut_windows(body):
    """Punch windshield, rear, and side window openings through the solidified body."""
    cutters = []
    # Windshield — slightly raked slab
    cutters.append(_box_cutter('CutWindshield', (0, 0.68, 1.16), (0.96, 0.14, 0.55),
                               rot=(math.radians(-32), 0, 0)))
    # Rear window
    cutters.append(_box_cutter('CutRearGlass', (0, -1.12, 1.22), (0.80, 0.12, 0.42),
                               rot=(math.radians(28), 0, 0)))
    # Side windows (door + quarter), both sides
    for sign in (-1, 1):
        cutters.append(_box_cutter(f'CutDoorGlass_{sign}', (sign * 0.66, 0.18, 1.14), (0.12, 0.62, 0.42)))
        cutters.append(_box_cutter(f'CutQuarterGlass_{sign}', (sign * 0.66, -0.55, 1.14), (0.12, 0.50, 0.40)))
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    for c in cutters:
        bo = body.modifiers.new(c.name, 'BOOLEAN')
        bo.operation = 'DIFFERENCE'
        try:
            bo.solver = 'EXACT'
        except Exception:
            pass
        bo.object = c
        try:
            bpy.ops.object.modifier_apply(modifier=bo.name)
        except RuntimeError as e:
            print('WINDOW_BOOL_FAIL', c.name, e)
    body.select_set(False)
    for c in cutters:
        c.hide_set(True)
        c.hide_render = True
    for poly in body.data.polygons:
        poly.use_smooth = True
    print('WINDOWS cut, body verts', len(body.data.vertices), 'faces', len(body.data.polygons))
    return body



def cut_wheel_wells_thin(body):
    """Boolean wells on a single-sided shell (bake path). Body modifiers already applied."""
    cutters = []
    for axle in (AXLE_F, AXLE_R):
        bpy.ops.mesh.primitive_cylinder_add(
            radius=WR + 0.038, depth=2.6, vertices=32,
            location=(0.0, axle, WR),
            rotation=(0, math.pi / 2, 0),
        )
        c = bpy.context.active_object
        c.name = f'WellThin_{axle:.2f}'
        c.hide_render = True
        c.display_type = 'WIRE'
        cutters.append(c)
        bo = body.modifiers.new(f'Well_{c.name}', 'BOOLEAN')
        bo.operation = 'DIFFERENCE'
        try:
            bo.solver = 'EXACT'
        except Exception:
            pass
        bo.object = c
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    for m in [m for m in body.modifiers if m.type == 'BOOLEAN']:
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError as e:
            print('THIN_WELL_FAIL', m.name, e)
    body.select_set(False)
    for c in cutters:
        c.hide_set(True)
        c.hide_render = True
    for poly in body.data.polygons:
        poly.use_smooth = True
    print('THIN_WELLS cut, body verts', len(body.data.vertices), 'faces', len(body.data.polygons))
    return body


def cut_wheel_wells(body):
    """Solidify the skin, then boolean a clean circular well at each axle."""
    # Apply mirror + subsurf so the boolean sees real density.
    apply_modifiers(body)
    sol = body.modifiers.new('Solidify', 'SOLIDIFY')
    sol.thickness = 0.035
    sol.offset = -1.0
    sol.use_quality_normals = True
    sol.use_even_offset = True
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bpy.ops.object.modifier_apply(modifier=sol.name)
    body.select_set(False)
    cutters = []
    for axle in (AXLE_F, AXLE_R):
        bpy.ops.mesh.primitive_cylinder_add(
            radius=WR + 0.038, depth=2.6, vertices=48,
            location=(0.0, axle, WR),
            rotation=(0, math.pi / 2, 0),
        )
        c = bpy.context.active_object
        c.name = f'WellCut_{axle:.2f}'
        c.hide_render = True
        c.display_type = 'WIRE'
        cutters.append(c)
        bo = body.modifiers.new(f'Well_{c.name}', 'BOOLEAN')
        bo.operation = 'DIFFERENCE'
        try:
            bo.solver = 'EXACT'
        except Exception:
            pass
        bo.object = c
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    for m in [m for m in body.modifiers if m.type == 'BOOLEAN']:
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except RuntimeError as e:
            print('BOOLEAN_FAIL', m.name, e)
    body.select_set(False)
    for c in cutters:
        c.hide_render = True
        c.hide_set(True)
    # Smooth the cut
    for p in body.data.polygons:
        p.use_smooth = True
    try:
        bpy.context.view_layer.objects.active = body
        body.select_set(True)
        bpy.ops.object.shade_smooth()
        body.select_set(False)
    except Exception:
        pass
    print('WHEEL_WELLS cut, body verts', len(body.data.vertices), 'faces', len(body.data.polygons))
    return body


def assemble_car(tier='epic', with_wheels=True, bake=False):
    cfg = TIERS[tier]
    body = build_body_cage()
    if cfg['kind'] == 'two':
        assign(body, mat_two_tone('PaintTwo', cfg['c1'], cfg['c2'], stripe=cfg['stripe']))
    else:
        assign(body, mat_paint('Paint', cfg['c1'], cfg['kind']))
    if bake:
        # Thin shell, no solidify — keeps the bake under the 30k body / 34k near caps.
        for m in body.modifiers:
            if m.type == 'SUBSURF':
                m.levels = 1
                m.render_levels = 1
        apply_modifiers(body)
        cut_wheel_wells_thin(body)
        cut_windows(body)
    else:
        cut_wheel_wells(body)
        cut_windows(body)
    gaps = build_shutlines(body)
    glass = build_glass()
    # Bake: drop the glass solidify so window tris stay modest
    if bake:
        for obj in glass:
            for m in list(obj.modifiers):
                if m.type == 'SOLIDIFY':
                    obj.modifiers.remove(m)
    interior = build_interior()
    lights = build_lights()
    trim = build_bumpers_trim()
    badges = build_emblem_and_plate(cfg['plate'], body=body)
    wheels = []
    if with_wheels:
        wheels = build_wheel_set(cfg['wheels'])
    return dict(body=body, gaps=gaps, glass=glass, interior=interior, lights=lights, trim=trim, badges=badges, wheels=wheels)


# ---------- bake packer ----------
MAGIC = 0x31525756


def blender_to_three(co):
    # Blender (x, y front, z up) -> Three (x, y up, z front)
    return (co[0], co[2], co[1])


def evaluated_mesh(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(deps)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    try:
        me.calc_normals_split()
    except Exception:
        pass
    return ev, me


def extract_part(obj, layer, role, lod):
    ev, me = evaluated_mesh(obj)
    mw = obj.matrix_world
    pos, nor, col, uv, idx = [], [], [], [], []
    color = tuple(obj.get('color', (0.8, 0.8, 0.8)))
    uv_layer = me.uv_layers.active.data if me.uv_layers else None
    for tri in me.loop_triangles:
        for li, vi in zip(tri.loops, tri.vertices):
            v = mw @ me.vertices[vi].co
            n = (mw.to_3x3() @ me.loops[li].normal).normalized()
            p3, n3 = blender_to_three(v), blender_to_three(n)
            pos.extend(p3)
            nor.extend(n3)
            col.extend(color)
            if uv_layer:
                u, ve = uv_layer[li].uv
                uv.extend((u, ve))
            else:
                uv.extend((0.0, 0.0))
        # indices are just 0..n after we flatten unique-less (duplicated verts per tri — OK, bake format allows it)
    # We pushed verts already expanded (no index reuse). Build a trivial index.
    nv = len(pos) // 3
    idx = list(range(nv))
    ev.to_mesh_clear()
    if nv == 0:
        return None
    return dict(layer=layer, role=role, lod=lod, pos=pos, nor=nor, col=col, uv=uv, idx=idx)


def merge_parts(parts):
    if not parts:
        return None
    out = dict(layer=parts[0]['layer'], role=parts[0]['role'], lod=parts[0]['lod'],
               pos=[], nor=[], col=[], uv=[], idx=[])
    base = 0
    for p in parts:
        n = len(p['pos']) // 3
        out['pos'].extend(p['pos'])
        out['nor'].extend(p['nor'])
        out['col'].extend(p['col'])
        out['uv'].extend(p['uv'])
        out['idx'].extend(i + base for i in p['idx'])
        base += n
    return out


def decimate_obj(obj, ratio):
    m = obj.modifiers.new('DecimateLOD', 'DECIMATE')
    m.ratio = ratio
    m.use_collapse_triangulate = True
    return m


def pack_bin(model, parts):
    lo = [1e9, 1e9, 1e9]
    hi = [-1e9, -1e9, -1e9]
    for p in parts:
        pos = p['pos']
        for k, v in enumerate(pos):
            lo[k % 3] = min(lo[k % 3], v)
            hi[k % 3] = max(hi[k % 3], v)
    chunks = []
    off = 0

    def add(b: bytes):
        nonlocal off
        pad = (4 - (off % 4)) % 4
        if pad:
            chunks.append(bytes(pad))
            off += pad
        o = off
        chunks.append(b)
        off += len(b)
        return o

    head_parts = []
    for p in parts:
        pos, nor, idx = p['pos'], p['nor'], p['idx']
        nv = len(pos) // 3
        q = []
        for k, v in enumerate(pos):
            span = hi[k % 3] - lo[k % 3] or 1.0
            q.append(max(0, min(65535, int(round((v - lo[k % 3]) / span * 65535)))))
        n = [max(-127, min(127, int(round(max(-1.0, min(1.0, v)) * 127)))) for v in nor]
        e = dict(layer=p['layer'], role=p['role'], lod=p['lod'], nv=nv, ni=len(idx), i32=nv > 65535)
        e['pos'] = add(struct.pack('<' + 'H' * len(q), *q))
        e['nor'] = add(struct.pack('<' + 'b' * len(n), *n))
        if p['role'] in ('metal', 'matte', 'lamp') and p.get('col'):
            c = [max(0, min(255, int(round(min(1.0, v) * 255)))) for v in p['col']]
            e['col'] = add(bytes(c))
        if p['role'] == 'plate' and p.get('uv'):
            u = [max(0, min(65535, int(round(max(0.0, min(1.0, v)) * 65535)))) for v in p['uv']]
            e['uv'] = add(struct.pack('<' + 'H' * len(u), *u))
        if e['i32']:
            e['idx'] = add(struct.pack('<' + 'I' * len(idx), *idx))
        else:
            e['idx'] = add(struct.pack('<' + 'H' * len(idx), *[min(65535, i) for i in idx]))
        head_parts.append(e)
    head = {'model': model, 'lo': lo, 'hi': hi, 'parts': head_parts}
    hj = json.dumps(head, separators=(',', ':')).encode('utf-8')
    hpad = (4 - ((8 + len(hj)) % 4)) % 4
    total = 8 + len(hj) + hpad + off
    buf = bytearray(total)
    struct.pack_into('<II', buf, 0, MAGIC, len(hj) + hpad)
    buf[8:8 + len(hj)] = hj
    for k in range(hpad):
        buf[8 + len(hj) + k] = 32
    o = 8 + len(hj) + hpad
    for c in chunks:
        buf[o:o + len(c)] = c
        o += len(c)
    return bytes(buf)


def collect_for_bake(tier_for_body='epic'):
    """Build the original body once plus all 6 wheel types, pack lod0 + lod1."""
    # Body + details from epic dress (wheels excluded here; wheels packed per type)
    # Paint role is just geometry — in-game paints it. So the body is shared.
    groups = assemble_car('epic', with_wheels=False, bake=True)
    body_objs = [groups['body']] + groups['gaps'] + groups['glass'] + groups['interior'] + groups['lights'] + groups['trim'] + groups['badges']
    # Apply modifiers on body (mirror + subsurf) so lod0 has real density
    apply_modifiers(groups['body'])
    # Prepare lod1 copies with decimate
    parts = []

    def ingest(objs, lod, ratio=None):
        buckets = {}
        copies = []
        for obj in objs:
            if obj is None or obj.type not in ('MESH', 'CURVE', 'FONT'):
                # convert fonts/curves first
                if obj is not None and obj.type in ('CURVE', 'FONT'):
                    bpy.context.view_layer.objects.active = obj
                    obj.select_set(True)
                    try:
                        bpy.ops.object.convert(target='MESH')
                    except Exception:
                        obj.select_set(False)
                        continue
                    obj.select_set(False)
                else:
                    continue
            src = obj
            if ratio is not None and obj.type == 'MESH' and len(obj.data.vertices) > 40:
                src = obj.copy()
                src.data = obj.data.copy()
                bpy.context.scene.collection.objects.link(src)
                decimate_obj(src, ratio)
                copies.append(src)
            layer = str(src.get('layer', 'body'))
            role = str(src.get('role', 'paint'))
            # Normalize wheel layer later
            part = extract_part(src, layer, role, lod)
            if part:
                buckets.setdefault((layer, role, lod), []).append(part)
        for src in copies:
            bpy.data.objects.remove(src, do_unlink=True)
        out = []
        for (layer, role, lod_), plist in buckets.items():
            m = merge_parts(plist)
            if m:
                out.append(m)
        return out

    parts.extend(ingest(body_objs, 0, ratio=None))
    parts.extend(ingest(body_objs, 1, ratio=0.18))

    # Wheels: each type, 4 corners, lod 0 + 1
    # Wipe any leftover wheel objects first (assemble_car didn't add them)
    for kind in range(6):
        wobjs = build_wheel_set(kind)
        parts.extend(ingest(wobjs, 0, ratio=None))
        parts.extend(ingest(wobjs, 1, ratio=0.30))
        # delete this kind before building the next (avoid name clashes / leftover geo)
        for o in wobjs:
            bpy.data.objects.remove(o, do_unlink=True)

    # Enforce rideshd body < 30k and leave room so body + any wheel set stays under the 34k near cap.
    def tris(pred):
        return sum(len(p['idx']) // 3 for p in parts if pred(p))
    body0 = tris(lambda p: p['lod'] == 0 and p['layer'] == 'body')
    if body0 > 25000:
        print('BODY over target', body0, '— decimating body lod0')
        parts = [p for p in parts if not (p['lod'] == 0 and p['layer'] == 'body')]
        ratio = 24500 / max(1, body0)
        parts.extend(ingest(body_objs, 0, ratio=max(0.30, min(0.85, ratio))))
    for kind in range(6):
        layer = f'w{kind}'
        w0 = tris(lambda p, layer=layer: p['lod'] == 0 and p['layer'] == layer)
        if w0 > 7000:
            print(layer, 'over target', w0, '— decimating')
            # wheel objects for this kind were deleted after ingest; we cannot re-ingest.
            # Scale indices/verts down by merging is hard here; just note it.
            # Rebuild this kind and re-ingest.
            parts = [p for p in parts if not (p['lod'] == 0 and p['layer'] == layer)]
            wobjs = build_wheel_set(kind)
            ratio = 6800 / max(1, w0)
            parts.extend(ingest(wobjs, 0, ratio=max(0.30, min(0.85, ratio))))
            for o in wobjs:
                bpy.data.objects.remove(o, do_unlink=True)
    return parts


def print_budget(parts):
    def tris(pred):
        return sum(len(p['idx']) // 3 for p in parts if pred(p))
    body0 = tris(lambda p: p['lod'] == 0 and p['layer'] == 'body')
    w0 = tris(lambda p: p['lod'] == 0 and p['layer'] == 'w0')
    print('BUDGET body lod0', body0, 'w0 lod0', w0)
    roles = {}
    for p in parts:
        if p['lod'] == 0 and p['layer'] == 'body':
            roles[p['role']] = roles.get(p['role'], 0) + len(p['idx']) // 3
    print('BODY ROLES', roles)
    for k in range(6):
        t = tris(lambda p, k=k: p['lod'] == 0 and p['layer'] == f'w{k}')
        print(f'  w{k} lod0', t)
    return body0, w0


# ---------- top-level ----------
def render_tier(tier, samples, out_path, plate=False):
    clear_scene()
    cfg = TIERS[tier]
    assemble_car(tier, with_wheels=True)
    setup_studio(underglow=cfg['underglow'], glow_color=(0.62, 0.08, 0.95))
    if plate:
        setup_plate_camera()
    scene = bpy.context.scene
    scene.cycles.samples = samples
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(out_path)
    print('RENDER', tier, 'samples', samples, '->', out_path)
    bpy.ops.render.render(write_still=True)
    print('WROTE', out_path, 'exists', out_path.exists())


def save_blend(path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(path))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', default='preview', choices=('preview', 'render', 'bake', 'all', 'blend', 'plate'))
    parser.add_argument('--tier', default='all', choices=('common', 'rare', 'epic', 'all'))
    parser.add_argument('--samples', type=int, default=0)
    args = parser.parse_args(argv_after_dd())

    OUT_RENDERS.mkdir(parents=True, exist_ok=True)
    OUT_WORK.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    if args.mode == 'plate':
        samples = args.samples or 256
        raw = OUT_WORK / 'raw' / 'epic_plate.png'
        render_tier('epic', samples, raw, plate=True)
        print('plate done')
        return

    if args.mode in ('preview', 'blend'):
        samples = args.samples or 16
        render_tier('epic', samples, OUT_WORK / 'preview_epic.png')
        # side silhouette for shape debugging
        scene = bpy.context.scene
        bpy.ops.object.camera_add(location=(6.5, 0.0, 0.85))
        side = bpy.context.active_object
        side.name = 'SideCam'
        side.data.lens = 70
        side.data.sensor_width = 36
        bpy.ops.object.empty_add(type='PLAIN_AXES', location=(0, 0, 0.70))
        tgt = bpy.context.active_object
        tr = side.constraints.new('TRACK_TO')
        tr.target = tgt
        tr.track_axis = 'TRACK_NEGATIVE_Z'
        tr.up_axis = 'UP_Y'
        scene.camera = side
        scene.render.filepath = str(OUT_WORK / 'preview_side.png')
        bpy.ops.render.render(write_still=True)
        print('WROTE side', OUT_WORK / 'preview_side.png')
        save_blend(OUT_WORK / 'bubble.blend')
        print('preview done')
        return

    if args.mode in ('render', 'all'):
        samples = args.samples or 256
        tiers = ['common', 'rare', 'epic'] if args.tier == 'all' else [args.tier]
        raw_dir = OUT_WORK / 'raw'
        raw_dir.mkdir(parents=True, exist_ok=True)
        serials = {'common': 101, 'rare': 404, 'epic': 777}
        for t in tiers:
            raw = raw_dir / f'{t}.png'
            render_tier(t, samples, raw)
            # overlay badge
            import importlib.util
            ov = ROOT / 'tools' / 'hd' / 'overlay_rarity.py'
            # call overlay in-process after making sure PIL is the system one — Blender has its own python.
            # We'll shell out after blender exits; here just write the raw. The wrapper does overlay.
            dest = OUT_RENDERS / f'{t}.png'
            # Try overlay now if PIL is available inside Blender
            try:
                import importlib.machinery
                spec = importlib.util.spec_from_file_location('overlay_rarity', ov)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                mod.overlay(str(raw), str(dest), t, serials[t])
                # also copy into the PR preview folder
                preview = PREVIEW_DIR / f'{t}.png'
                preview.write_bytes(dest.read_bytes())
            except Exception as e:
                print('OVERLAY_FAILED', e)
                dest.write_bytes(raw.read_bytes())
        if 'epic' in tiers:
            render_tier('epic', samples, raw_dir / 'epic_plate.png', plate=True)

    if args.mode in ('bake', 'all'):
        clear_scene()
        parts = collect_for_bake()
        body0, w0 = print_budget(parts)
        buf = pack_bin(0, parts)
        M0_PATH.parent.mkdir(parents=True, exist_ok=True)
        # backup previous
        if M0_PATH.exists():
            bak = M0_PATH.with_suffix('.bin.bak')
            bak.write_bytes(M0_PATH.read_bytes())
            print('backed up previous m0.bin to', bak, 'bytes', bak.stat().st_size)
        M0_PATH.write_bytes(buf)
        print('WROTE', M0_PATH, 'bytes', len(buf), 'body0', body0, 'w0', w0)

    print('DONE', args.mode)


if __name__ == '__main__':
    main()
