#!/usr/bin/env python3
# Photoreal NFT studio renders of the Bubble test car (model 0) in Blender Cycles.
# Free Blender + CC0 Poly Haven HDRI (reflections only). No VW badges or VW model names.
# Usage:
#   blender --background --python tools/hd/render_bubble_nft.py -- \
#     --bin docs/hd/rides/m0.bin --hdri docs/assets/kloppenheim_06_puresky_1k.hdr \
#     --out /workspace/sg-car-test/renders

from __future__ import annotations
import json, math, os, struct, sys
from collections import defaultdict

# ---------------------------------------------------------------------------
# Ride bake parser (same layout as src/hdcars.js)
# ---------------------------------------------------------------------------
MAGIC = 0x31525756
DROP = [0, 0.04, 0.08, -0.12, 0.06]
COLORS = ['e63946', 'f4a261', 'ffd166', '06d6a0', '118ab2', '9b5de5', 'f15bb5', 'f8f9fa', 'fb8500', '2a9d8f', '80ed99', '3a0ca3', '1d3557', 'a8dadc', 'bc4749', '212529']
PATINA = ['8a7f5c', '7d6b52', '6b8f7a', '9a6b4f', '8f8f86']
SPECS = {
    'common': dict(serial=101, tier=0, model=0, paint=5, c1=2, c2=16, wheels=0, stance=0, plate=0, extras=0),
    'rare':   dict(serial=404, tier=1, model=0, paint=4, c1=4, c2=7, wheels=3, stance=1, plate=1, extras=1 << 4),
    'epic':   dict(serial=777, tier=2, model=0, paint=2, c1=5, c2=16, wheels=5, stance=4, plate=2, extras=(1 << 7) | (1 << 9)),
}
TIER_HEX = {'common': '#B8C0CC', 'rare': '#4EA8FF', 'epic': '#B46BFF'}
PLATE_TEX = {}
PAINT_KIND = ['solid', 'metallic', 'candy', 'flake', 'two', 'patina']


def hex_rgb(h):
    h = h.strip('#')
    return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0, 1.0)


def parse_bake(path):
    data = open(path, 'rb').read()
    magic, hl = struct.unpack_from('<II', data, 0)
    if magic != MAGIC:
        raise SystemExit('bad ride bake: %s' % path)
    head = json.loads(data[8:8 + hl].decode().rstrip())
    o0 = 8 + hl
    lo, hi = head['lo'], head['hi']
    parts = defaultdict(lambda: [[], []])
    for e in head['parts']:
        nv, ni = e['nv'], e['ni']
        q = struct.unpack_from('<' + 'H' * (nv * 3), data, o0 + e['pos'])
        n = struct.unpack_from('<' + 'b' * (nv * 3), data, o0 + e['nor'])
        pos, nor = [], []
        for k in range(nv * 3):
            a = k % 3
            pos.append(lo[a] + (q[k] / 65535.0) * (hi[a] - lo[a]))
            nor.append(n[k] / 127.0)
        if e.get('i32'):
            idx = struct.unpack_from('<' + 'I' * ni, data, o0 + e['idx'])
        else:
            idx = struct.unpack_from('<' + 'H' * ni, data, o0 + e['idx'])
        col = uv = None
        if 'col' in e:
            c = struct.unpack_from('<' + 'B' * (nv * 3), data, o0 + e['col'])
            col = [v / 255.0 for v in c]
        if 'uv' in e:
            u = struct.unpack_from('<' + 'H' * (nv * 2), data, o0 + e['uv'])
            uv = [v / 65535.0 for v in u]
        parts[e['layer']][e['lod']].append(dict(role=e['role'], pos=pos, nor=nor, idx=idx, col=col, uv=uv, nv=nv, tris=ni / 3))
    extras = [int(k[1:]) for k in parts if k.startswith('x')]
    return dict(parts=parts, extras=extras, lo=lo, hi=hi)


def assemble(bake, spec, lod=0, layer_list=None):
    kind = PAINT_KIND[spec['paint']]
    if kind == 'patina':
        c1 = hex_rgb(PATINA[spec['c1'] % len(PATINA)])
    else:
        c1 = hex_rgb(COLORS[spec['c1']])
    c2 = hex_rgb(COLORS[spec['c2']]) if spec['c2'] != 16 else c1
    y_off = -(DROP[spec['stance']] if spec['stance'] < len(DROP) else 0)
    if layer_list is None:
        wl = 'w%d' % spec['wheels']
        if wl not in bake['parts']:
            wl = 'w0'
        xs = ['x%d' % b for b in bake['extras'] if spec['extras'] & (1 << b)]
        layers = ['body', wl] + xs
    else:
        layers = [L for L in layer_list if L in bake['parts']]
    baked_two = any(p['role'] == 'paint2' for L in layers for p in bake['parts'][L][lod])
    split = (not baked_two) and spec['c2'] != 16 and c1 != c2
    belt = 0.70 + y_off
    by_role = defaultdict(lambda: dict(pos=[], nor=[], col=[], uv=[], idx=[], nv=0))
    tris = 0
    for L in layers:
        for p in bake['parts'].get(L, [[], []])[lod]:
            role = 'paint' if p['role'] == 'paint2' else p['role']
            off = 0 if L.startswith('w') else y_off
            start = by_role[role]['nv']
            nv = p['nv']
            for k in range(nv):
                x, y, z = p['pos'][k * 3], p['pos'][k * 3 + 1] + off, p['pos'][k * 3 + 2]
                by_role[role]['pos'].extend((x, y, z))
                by_role[role]['nor'].extend(p['nor'][k * 3:k * 3 + 3])
                if p['role'] in ('paint', 'paint2') or (p['role'] == 'paint' and split):
                    use = c2 if (p['role'] == 'paint2' or (p['role'] == 'paint' and split and y < belt)) else c1
                    if p['role'] == 'paint' or p['role'] == 'paint2':
                        sh = 0.84 + 0.16 * min(1, max(0, (y - 0.3) / 1.0))
                        du = 0.3 * (1 - min(1, max(0, (y - 0.18) / 0.3)))
                        dust = (0.54, 0.48, 0.38)
                        col = tuple(use[i] * sh * (1 - du) + dust[i] * du for i in range(3))
                    else:
                        col = use[:3]
                    by_role[role]['col'].extend(col)
                elif p['col']:
                    by_role[role]['col'].extend(p['col'][k * 3:k * 3 + 3])
                else:
                    by_role[role]['col'].extend((1, 1, 1))
                if p['uv']:
                    by_role[role]['uv'].extend(p['uv'][k * 2:k * 2 + 2])
            for i in p['idx']:
                by_role[role]['idx'].append(i + start)
            by_role[role]['nv'] += nv
            tris += p['tris']
    return by_role, tris, dict(c1=c1, c2=c2, kind=kind, y_off=y_off)


# ---------------------------------------------------------------------------
# Blender scene
# ---------------------------------------------------------------------------
def inp(node, *names):
    for n in names:
        if n in node.inputs:
            return node.inputs[n]
    return None


def set_in(node, names, value):
    s = inp(node, *names) if isinstance(names, (list, tuple)) else inp(node, names)
    if s is not None:
        s.default_value = value
        return True
    return False


def make_mat(name, **kw):
    import bpy
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    p = nt.nodes.get('Principled BSDF')
    out = nt.nodes.get('Material Output')
    set_in(p, ('Base Color', 'Base Color'), kw.get('color', (0.8, 0.8, 0.8, 1)))
    set_in(p, 'Metallic', kw.get('metallic', 0.0))
    set_in(p, 'Roughness', kw.get('roughness', 0.4))
    set_in(p, ('IOR',), kw.get('ior', 1.5))
    set_in(p, ('Coat Weight', 'Coat', 'Clearcoat'), kw.get('coat', 0.0))
    set_in(p, ('Coat Roughness', 'Clearcoat Roughness'), kw.get('coat_rough', 0.05))
    if kw.get('transmission', 0) > 0:
        set_in(p, ('Transmission Weight', 'Transmission'), kw.get('transmission'))
    if kw.get('emission'):
        set_in(p, ('Emission Color', 'Emission'), kw['emission'])
        set_in(p, ('Emission Strength',), kw.get('emission_strength', 1.0))
    if kw.get('alpha', 1) < 1:
        set_in(p, 'Alpha', kw['alpha'])
        mat.blend_method = 'BLEND'
    if kw.get('thin_film'):
        set_in(p, ('Thin Film Thickness', 'Iridescence'), kw['thin_film'])
        set_in(p, ('Thin Film IOR', 'Iridescence IOR'), kw.get('thin_ior', 1.4))
    if kw.get('dispersion'):
        set_in(p, ('Dispersion', 'Dispersion Scale'), kw['dispersion'])
    mat['role'] = kw.get('role', '')
    return mat, p, nt


def vertex_color_mat(base, attr='Col'):
    import bpy
    nt = base.node_tree
    p = nt.nodes.get('Principled BSDF')
    # Blender 4.x: Color Attribute node (Vertex Color is a compatibility alias when present)
    col = nt.nodes.new('ShaderNodeAttribute')
    col.attribute_name = attr
    if hasattr(col, 'attribute_type'):
        try:
            col.attribute_type = 'GEOMETRY'
        except Exception:
            pass
    col.location = (-400, 200)
    # Use the baked vertex colour as the albedo directly (it already holds paint / chrome / rubber).
    out = col.outputs['Color'] if 'Color' in col.outputs else col.outputs[0]
    nt.links.new(out, p.inputs['Base Color'])
    return base


def flake_nodes(nt, p, strength=0.5):
    # Procedural metal flake: noise-driven glossy tint on the coat
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 220.0
    noise.inputs['Detail'].default_value = 8.0
    noise.location = (-600, -200)
    obj = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(obj.outputs['Object'], noise.inputs['Vector'])
    cr = inp(p, 'Coat Roughness', 'Clearcoat Roughness')
    if cr:
        # leave coat sharp; flake is a slight roughness jitter on the base
        pass
    rough = inp(p, 'Roughness')
    if rough and not rough.is_linked:
        add = nt.nodes.new('ShaderNodeMath')
        add.operation = 'MULTIPLY_ADD'
        add.inputs[1].default_value = 0.08 * strength
        add.inputs[2].default_value = rough.default_value
        nt.links.new(noise.outputs['Fac'], add.inputs[0])
        nt.links.new(add.outputs[0], rough)


def mesh_from_role(name, role, data):
    import bpy
    mesh = bpy.data.meshes.new(name)
    nv = data['nv']
    verts = [(data['pos'][k * 3], data['pos'][k * 3 + 1], data['pos'][k * 3 + 2]) for k in range(nv)]
    faces = []
    idx = data['idx']
    for k in range(0, len(idx), 3):
        a, b, c = idx[k], idx[k + 1], idx[k + 2]
        if a == b or b == c or a == c:
            continue
        faces.append((a, b, c))
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    import bmesh
    from mathutils import Vector
    nors = data['nor']
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    for f in bm.faces:
        avg = Vector((0.0, 0.0, 0.0))
        for v in f.verts:
            avg += Vector((nors[v.index * 3], nors[v.index * 3 + 1], nors[v.index * 3 + 2]))
        if avg.length_squared > 0 and avg.dot(f.normal) < 0:
            f.normal_flip()
    bm.to_mesh(mesh)
    bm.free()
    for poly in mesh.polygons:
        poly.use_smooth = True
    # Single color attribute (corner, float).
    if 'Col' in mesh.color_attributes:
        mesh.color_attributes.remove(mesh.color_attributes['Col'])
    attr = mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    cols = data['col']
    for loop in mesh.loops:
        vi = loop.vertex_index
        attr.data[loop.index].color = (cols[vi * 3], cols[vi * 3 + 1], cols[vi * 3 + 2], 1.0)
    if data['uv'] and len(data['uv']) >= nv * 2:
        uv_layer = mesh.uv_layers.new(name='UVMap')
        uvs = data['uv']
        for loop in mesh.loops:
            vi = loop.vertex_index
            uv_layer.data[loop.index].uv = (uvs[vi * 2], uvs[vi * 2 + 1])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def paint_material(kind, name, base_color=(1, 1, 1, 1)):
    if kind == 'patina':
        mat, p, nt = make_mat(name, color=base_color, metallic=0.0, roughness=0.88, coat=0.0, role='paint')
    elif kind == 'candy':
        mat, p, nt = make_mat(name, color=base_color, metallic=0.32, roughness=0.16, coat=1.0, coat_rough=0.02, thin_film=0.35, thin_ior=1.4, role='paint')
        flake_nodes(nt, p, 0.3)
    elif kind == 'flake':
        mat, p, nt = make_mat(name, color=base_color, metallic=0.5, roughness=0.24, coat=1.0, coat_rough=0.028, role='paint')
        flake_nodes(nt, p, 0.8)
    elif kind in ('metallic', 'two'):
        mat, p, nt = make_mat(name, color=base_color, metallic=0.55, roughness=0.3, coat=1.0, coat_rough=0.035, role='paint')
        flake_nodes(nt, p, 0.4)
    else:
        mat, p, nt = make_mat(name, color=base_color, metallic=0.0, roughness=0.28, coat=1.0, coat_rough=0.04, role='paint')
    vertex_color_mat(mat)
    return mat


def role_material(role, kind, plate_kind, name, paint_color=(1,1,1,1)):
    if role == 'paint':
        return paint_material(kind, name, paint_color)
    if role == 'metal':
        mat, p, nt = make_mat(name, color=(1, 1, 1, 1), metallic=1.0, roughness=0.08, coat=0.2, coat_rough=0.05, role='metal')
        vertex_color_mat(mat)
        return mat
    if role == 'matte':
        mat, p, nt = make_mat(name, color=(1, 1, 1, 1), metallic=0.0, roughness=0.92, role='matte')
        # procedural tyre tread bump
        noise = nt.nodes.new('ShaderNodeTexWave')
        noise.wave_type = 'BANDS'
        noise.bands_direction = 'Z'
        try:
            noise.inputs['Scale'].default_value = 52.0
            noise.inputs['Distortion'].default_value = 1.5
        except Exception:
            pass
        bump = nt.nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.25
        nt.links.new(noise.outputs['Color'] if 'Color' in noise.outputs else noise.outputs[0], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], p.inputs['Normal'])
        vertex_color_mat(mat)
        return mat
    if role == 'glass':
        mat, p, nt = make_mat(name, color=(0.07, 0.12, 0.16, 1), metallic=0.0, roughness=0.02, ior=1.52, transmission=0.9, coat=0.45, coat_rough=0.02, alpha=0.85, role='glass')
        mat.use_screen_refraction = True
        vertex_color_mat(mat)
        return mat
    if role == 'lamp':
        mat, p, nt = make_mat(name, color=(1, 1, 1, 1), metallic=0.0, roughness=0.05, coat=1.0, coat_rough=0.02,
                              emission=(1, 0.96, 0.85, 1), emission_strength=4.0, role='lamp')
        vertex_color_mat(mat)
        return mat
    if role == 'plate':
        if plate_kind == 2:
            mat, p, nt = make_mat(name, color=(0.831, 0.686, 0.216, 1), metallic=1.0, roughness=0.12, ior=1.5, role='plate')
        elif plate_kind == 1:
            mat, p, nt = make_mat(name, color=(0.85, 0.87, 0.9, 1), metallic=1.0, roughness=0.14, role='plate')
        else:
            mat, p, nt = make_mat(name, color=(0.95, 0.93, 0.88, 1), metallic=0.15, roughness=0.45, role='plate')
        key = {2: 'gold', 1: 'chrome'}.get(plate_kind, 'standard')
        tex = PLATE_TEX.get(key)
        if tex:
            img = nt.nodes.new('ShaderNodeTexImage')
            img.image = tex
            img.interpolation = 'Closest'
            if plate_kind == 2:
                # Keep gold metal in the field; use the texture (ice letters on gold) as the albedo.
                nt.links.new(img.outputs['Color'], p.inputs['Base Color'])
            else:
                nt.links.new(img.outputs['Color'], p.inputs['Base Color'])
        return mat
    return make_mat(name, role=role)[0]


def add_plate_letters(plate_obj, collection, plate_kind=2):
    """Raised diamond-glass 'VWFEST' letters on a gold plate, facing the plate normal."""
    import bpy
    from mathutils import Vector, Matrix
    # Estimate plate center, size, and outward normal from the mesh
    mesh = plate_obj.data
    if not mesh.polygons:
        return
    # Average center + normal
    c = Vector((0, 0, 0)); n = Vector((0, 0, 0)); area = 0
    for poly in mesh.polygons:
        c += poly.center * poly.area
        n += poly.normal * poly.area
        area += poly.area
    if area <= 0:
        return
    c = plate_obj.matrix_world @ (c / area)
    n = (plate_obj.matrix_world.to_3x3() @ (n / area)).normalized()
    # Width along the longer in-plane axis (usually X)
    xs = [(plate_obj.matrix_world @ v.co) for v in mesh.vertices]
    # Build a frame: n, up hint (world Y), side
    up = Vector((0, 1, 0))
    if abs(n.dot(up)) > 0.9:
        up = Vector((1, 0, 0))
    side = n.cross(up).normalized()
    up = side.cross(n).normalized()
    # Plate half-width
    pts = xs
    mid = sum(pts, Vector((0, 0, 0))) / len(pts)
    half_w = max((p - mid).dot(side) for p in pts)
    half_h = max((p - mid).dot(up) for p in pts)

    curve = bpy.data.curves.new('vwfest_letters', 'FONT')
    curve.body = 'VWFEST'
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.extrude = 0.008
    curve.bevel_depth = 0.0012
    curve.size = max(0.11, half_w * 2.1)
    obj = bpy.data.objects.new('vwfest_letters', curve)
    collection.objects.link(obj)
    # Orient: text local +X is right, +Y up, +Z toward camera (Blender text faces -Z by default? Font objects face +Y actually? )
    # Font object: characters in XY plane, facing +Z.
    rot = Matrix((
        (side.x, up.x, n.x),
        (side.y, up.y, n.y),
        (side.z, up.z, n.z),
    )).to_quaternion()
    # Text faces +Z; we want +Z = n (outward)
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = rot
    obj.location = mid + n * 0.014

    if plate_kind == 2:
        dmat, p, nt = make_mat('diamond_letter', color=(0.92, 0.95, 1.0, 1), metallic=0.0, roughness=0.01,
                               ior=2.42, transmission=1.0, coat=0.2, coat_rough=0.01, dispersion=0.035)
        set_in(p, ('Emission Color', 'Emission'), (0.85, 0.92, 1.0, 1))
        set_in(p, ('Emission Strength',), 0.15)
    else:
        dmat, p, nt = make_mat('plate_letter', color=(0.08, 0.12, 0.22, 1), metallic=0.0, roughness=0.45)
    obj.data.materials.append(dmat)
    return obj


def add_underglow(y_off=0.0):
    import bpy
    mat, p, nt = make_mat('underglow', color=(0.77, 0.3, 1, 1), metallic=0.0, roughness=0.4,
                          emission=(0.77, 0.3, 1, 1), emission_strength=12.0)
    g = bpy.data.objects.new('underglow', None)
    bpy.context.collection.objects.link(g)
    for sx in (-1, 1):
        bpy.ops.mesh.primitive_cylinder_add(radius=0.035, depth=2.5, location=(sx * 0.62, 0.08 + y_off, 0), rotation=(math.pi / 2, 0, 0))
        rail = bpy.context.active_object
        rail.name = 'glow_rail'
        rail.data.materials.append(mat)
        rail.parent = g
    # Under-car area light
    lamp_data = bpy.data.lights.new('underglow_light', 'AREA')
    lamp_data.energy = 40
    lamp_data.color = (0.75, 0.25, 1.0)
    lamp_data.size = 1.6
    lamp_data.shape = 'DISK'
    lamp = bpy.data.objects.new('underglow_light', lamp_data)
    lamp.location = (0, 0.05, 0)
    lamp.rotation_euler = (0, 0, 0)
    lamp.rotation_euler.x = math.radians(-90)
    bpy.context.collection.objects.link(lamp)
    return g


def apply_hydraulics(objs, mode='three'):
    # Rotate/lift body-ish objects (everything except wheels) around origin.
    import mathutils
    if mode != 'three':
        return
    # body rotation z=-0.17, x=0.07, y+=0.18 (matches src/cars.js hydraulics 'three')
    rx, rz, dy = 0.07, -0.17, 0.18
    for obj in objs:
        if obj.name.startswith('w') or 'wheel' in obj.name or obj.name.startswith('glow'):
            continue
        # skip wheels by name prefix 'm0_w'
        if '_w' in obj.name and '_x' not in obj.name and '_body' not in obj.name and 'plate' not in obj.name and 'letter' not in obj.name:
            continue
        obj.location.y += dy
        obj.rotation_euler.x += rx
        obj.rotation_euler.z += rz


def build_studio(hdri_path):
    import bpy
    # Studio in Blender Z-up. The car group is later rotated +90° about X (Three.js Y-up -> Blender Z-up).
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
    floor = bpy.context.active_object
    floor.name = 'studio_floor'
    smat, p, nt = make_mat('studio', color=(0.08, 0.082, 0.085, 1), metallic=0.0, roughness=0.42)
    floor.data.materials.append(smat)

    # Slightly glossy floor mix
    gloss = nt.nodes.new('ShaderNodeBsdfGlossy') if 'ShaderNodeBsdfGlossy' in dir(bpy.types) else None
    # skip if missing; roughness 0.55 is fine

    # World: HDRI for lighting/reflections, dark for camera rays
    world = bpy.context.scene.world
    world.use_nodes = True
    wnt = world.node_tree
    wnt.nodes.clear()
    out = wnt.nodes.new('ShaderNodeOutputWorld')
    bg_env = wnt.nodes.new('ShaderNodeBackground')
    bg_dark = wnt.nodes.new('ShaderNodeBackground')
    bg_dark.inputs['Color'].default_value = (0.08, 0.082, 0.085, 1)
    bg_dark.inputs['Strength'].default_value = 1.0
    env = wnt.nodes.new('ShaderNodeTexEnvironment')
    if hdri_path and os.path.exists(hdri_path):
        env.image = bpy.data.images.load(hdri_path)
    bg_env.inputs['Strength'].default_value = 0.85
    wnt.links.new(env.outputs['Color'], bg_env.inputs['Color'])
    lp = wnt.nodes.new('ShaderNodeLightPath')
    mix = wnt.nodes.new('ShaderNodeMixShader')
    wnt.links.new(lp.outputs['Is Camera Ray'], mix.inputs['Fac'])
    wnt.links.new(bg_env.outputs['Background'], mix.inputs[1])
    wnt.links.new(bg_dark.outputs['Background'], mix.inputs[2])
    wnt.links.new(mix.outputs['Shader'], out.inputs['Surface'])

    def area(name, loc, rot, size, energy, color, shape='RECTANGLE', size_y=None):
        d = bpy.data.lights.new(name, 'AREA')
        d.energy = energy
        d.color = color
        d.shape = shape
        d.size = size
        if size_y and hasattr(d, 'size_y'):
            d.size_y = size_y
        o = bpy.data.objects.new(name, d)
        o.location = loc
        o.rotation_euler = rot
        bpy.context.collection.objects.link(o)
        return o

    # Key, fill, rim (Blender Z-up, looking toward origin)
    area('key', (3.6, -3.2, 3.2), (math.radians(65), 0, math.radians(40)), 1.8, 250, (1.0, 0.96, 0.9), 'RECTANGLE', 1.2)
    area('fill', (-3.8, -1.6, 2.2), (math.radians(70), 0, math.radians(-50)), 2.4, 60, (0.75, 0.82, 1.0), 'RECTANGLE', 1.6)
    area('rim', (-1.2, 3.8, 2.6), (math.radians(55), 0, math.radians(190)), 1.2, 140, (1.0, 0.95, 0.85), 'DISK')
    area('kick', (0.0, -4.5, 0.4), (math.radians(80), 0, 0), 1.6, 30, (1, 1, 1), 'RECTANGLE', 0.3)


def setup_cycles(scene, samples=64):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
    scene.cycles.preview_samples = 16
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.color_depth = '8'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Filmic'
    scene.view_settings.look = 'Medium High Contrast'
    scene.view_settings.exposure = 0.15
    scene.cycles.max_bounces = 8
    scene.cycles.transmission_bounces = 8
    scene.cycles.transparent_max_bounces = 8


def add_camera(angle):
    import bpy
    from mathutils import Vector
    cam_data = bpy.data.cameras.new('nft_cam')
    cam_data.lens = 50
    cam_data.sensor_width = 36
    cam_data.dof.use_dof = True
    cam_data.dof.aperture_fstop = 8.0
    cam = bpy.data.objects.new('nft_cam', cam_data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    # Car group is rotated +90 X (Three Y-up -> Blender Z-up):
    # Three +Z (front) -> Blender -Y. Three +Y (up) -> Blender +Z. Rear plate at Three z≈-2.1 -> Blender y≈+2.1
    if angle == 'rear':
        loc = (3.8, 5.9, 1.45)
        target = (0.0, 1.1, 0.6)
        cam_data.dof.aperture_fstop = 6.3
        cam_data.lens = 50
    else:
        loc = (5.4, -6.4, 2.05)
        target = (0.0, 0.15, 0.68)
        cam_data.lens = 50
    cam.location = loc
    direction = Vector(target) - Vector(loc)
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    cam_data.dof.focus_object = None
    cam_data.dof.focus_distance = direction.length
    return cam


def clear_scene():
    import bpy
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for d in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.curves, bpy.data.images):
        for b in list(d):
            if b.users == 0:
                d.remove(b)


def build_car(bake, rarity, spec):
    import bpy
    from mathutils import Euler
    roles, tris, meta = assemble(bake, spec, lod=0)
    print('assembled', rarity, 'tris', int(tris), 'roles', list(roles))
    root = bpy.data.objects.new('bubble_%s' % rarity, None)
    bpy.context.collection.objects.link(root)
    body_objs = []
    plate_objs = []
    for role, data in roles.items():
        if data['nv'] == 0:
            continue
        obj = mesh_from_role('bubble_%s_%s' % (rarity, role), role, data)
        mat = role_material(role, meta['kind'], spec['plate'], 'mat_%s_%s' % (rarity, role))
        if obj.data.materials:
            obj.data.materials[0] = mat
        else:
            obj.data.materials.append(mat)
        obj.parent = root
        body_objs.append(obj)
        if role == 'plate':
            plate_objs.append(obj)
    # Rotate Three.js Y-up into Blender Z-up
    root.rotation_euler = Euler((math.radians(90), 0, 0), 'XYZ')
    # diamond letters in object space before? letters added after parenting, in world space after we update
    bpy.context.view_layer.update()
    letter_objs = []
    if spec['plate'] == 2:
        for pl in plate_objs:
            lo = add_diamond_letters(pl, bpy.context.collection)
            if lo:
                lo.parent = root
                letter_objs.append(lo)
    if spec['extras'] & (1 << 9):
        add_underglow(meta['y_off'])
    if spec['stance'] == 4:
        # hydraulics: apply in Three space before the 90° rot, as local on children
        for obj in body_objs + letter_objs:
            if obj in plate_objs or True:
                # skip nothing except we need wheels un-moved. Wheels were merged into metal/matte of w* layers
                # PROBLEM: wheels and body are merged per role, not per layer. Hydraulics in-game only lifts `body` group, not wheels.
                # Our assemble merged wheels into the same metal/matte meshes as? No: we concatenated layers into roles, so wheels ARE merged with body metal/matte!
                # That's a problem for hydraulics pose.
                # Fix: assemble wheels into separate objects.
                pass
    return root, tris, body_objs, plate_objs, meta


# The wheel-merge issue is real. I'll re-assemble with per-layer objects.

def build_car_layered(bake, rarity, spec):
    import bpy
    from mathutils import Euler
    kind = PAINT_KIND[spec['paint']]
    if kind == 'patina':
        meta_c1 = hex_rgb(PATINA[spec['c1'] % len(PATINA)])
    else:
        meta_c1 = hex_rgb(COLORS[spec['c1']])
    y_off = -(DROP[spec['stance']] if spec['stance'] < len(DROP) else 0)
    wl = 'w%d' % spec['wheels']
    if wl not in bake['parts']:
        wl = 'w0'
    xs = ['x%d' % b for b in bake['extras'] if spec['extras'] & (1 << b)]
    # assemble per layer so wheels stay on the ground when the body hops
    root = bpy.data.objects.new('bubble_%s' % rarity, None)
    bpy.context.collection.objects.link(root)
    body_root = bpy.data.objects.new('bubble_%s_body' % rarity, None)
    bpy.context.collection.objects.link(body_root)
    body_root.parent = root
    plate_objs = []
    total_tris = 0
    for L in ['body', wl] + xs:
        fake_spec = dict(spec)
        # temporary assemble of a single layer
        one = dict(parts={L: bake['parts'][L]}, extras=bake['extras'] if L.startswith('x') else [], lo=bake['lo'], hi=bake['hi'])
        # Reuse assemble but only one layer: hack by passing a bake with only that layer in 'body' or keep going manually
        roles, tris, meta = assemble_layers(bake, spec, [L], lod=0)
        total_tris += tris
        layer_empty = bpy.data.objects.new('L_%s_%s' % (rarity, L), None)
        bpy.context.collection.objects.link(layer_empty)
        parent = root if L.startswith('w') else body_root
        layer_empty.parent = parent
        for role, data in roles.items():
            if data['nv'] == 0:
                continue
            obj = mesh_from_role('bubble_%s_%s_%s' % (rarity, L, role), role, data)
            mat = role_material(role, kind, spec['plate'], 'mat_%s_%s_%s' % (rarity, L, role), paint_color=meta_c1)
            obj.data.materials.append(mat)
            obj.parent = layer_empty
            if role == 'plate':
                plate_objs.append(obj)
    root.rotation_euler = Euler((math.radians(90), 0, 0), 'XYZ')
    bpy.context.view_layer.update()
    bpy.context.view_layer.update()
    # Plate lettering comes from the baked VWFEST texture (3D text was leaving a floor ghost).
    if spec['extras'] & (1 << 9):
        # underglow parented to body so it hops
        # add rails in Three space (parented to body_root, so after root Rx they stand up)
        import bpy as _b
        mat, p, nt = make_mat('underglow_%s' % rarity, color=(0.77, 0.3, 1, 1), metallic=0.0, roughness=0.4,
                              emission=(0.77, 0.3, 1, 1), emission_strength=14.0)
        for sx in (-1, 1):
            mesh = _b.data.meshes.new('rail')
            # cylinder along Z in Three space
            _b.ops.mesh.primitive_cylinder_add(radius=0.035, depth=2.0, location=(sx * 0.58, 0.06, 0), rotation=(0, 0, 0))
            rail = _b.context.active_object
            rail.data.materials.append(mat)
            rail.parent = body_root
        lamp_data = _b.data.lights.new('underglow_light_%s' % rarity, 'AREA')
        lamp_data.energy = 55
        lamp_data.color = (0.75, 0.25, 1.0)
        lamp_data.size = 1.8
        lamp_data.shape = 'DISK'
        lamp = _b.data.objects.new('underglow_light_%s' % rarity, lamp_data)
        lamp.location = (0, 0.04, 0)
        lamp.rotation_euler = (0, 0, 0)  # in Three Y-up parented to body; after root Rx, this needs to point down in Blender
        # body_root is under root which has Rx 90, so local -Y? Light default -Z. Set local rotation so it points to -Y (Three down is -Y).
        lamp.rotation_euler = (math.radians(90), 0, 0)
        lamp.parent = body_root
        bpy.context.collection.objects.link(lamp)
    if spec['stance'] == 4:
        # three-wheel hydraulics on the body only, in Three/local space
        body_root.location.y += 0.18
        body_root.rotation_euler.x += 0.07
        body_root.rotation_euler.z += -0.17
    return root, total_tris, plate_objs, dict(kind=kind, y_off=y_off)


def assemble_layers(bake, spec, layers, lod=0):
    # like assemble() but only the given layers
    slim = dict(parts={L: bake['parts'][L] for L in layers if L in bake['parts']}, extras=bake.get('extras', []), lo=bake['lo'], hi=bake['hi'])
    return assemble(bake, spec, lod, layer_list=layers)


def parse_args(argv):
    args = dict(bin=None, hdri=None, out='.', samples=64, only=None, plates=None)
    i = 0
    while i < len(argv):
        if argv[i] == '--bin' and i + 1 < len(argv):
            args['bin'] = argv[i + 1]; i += 2
        elif argv[i] == '--hdri' and i + 1 < len(argv):
            args['hdri'] = argv[i + 1]; i += 2
        elif argv[i] == '--out' and i + 1 < len(argv):
            args['out'] = argv[i + 1]; i += 2
        elif argv[i] == '--samples' and i + 1 < len(argv):
            args['samples'] = int(argv[i + 1]); i += 2
        elif argv[i] == '--only' and i + 1 < len(argv):
            args['only'] = argv[i + 1]; i += 2
        elif argv[i] == '--plates' and i + 1 < len(argv):
            args['plates'] = argv[i + 1]; i += 2
        else:
            i += 1
    return args


def main():
    import bpy
    argv = sys.argv
    argv = argv[argv.index('--') + 1:] if '--' in argv else argv[1:]
    args = parse_args(argv)
    if not args['bin']:
        raise SystemExit('need --bin')
    bake = parse_bake(args['bin'])
    os.makedirs(args['out'], exist_ok=True)
    rarities = [args['only']] if args['only'] else ['common', 'rare', 'epic']
    stats = {}
    for rarity in rarities:
        clear_scene()
        PLATE_TEX.clear()
        if args.get('plates'):
            for key in ('standard', 'chrome', 'gold'):
                fp = os.path.join(args['plates'], key + '.png')
                if os.path.exists(fp):
                    PLATE_TEX[key] = bpy.data.images.load(fp)
        setup_cycles(bpy.context.scene, samples=args['samples'])
        build_studio(args['hdri'])
        spec = SPECS[rarity]
        root, tris, plate_objs, meta = build_car_layered(bake, rarity, spec)
        add_camera('rear' if rarity == 'epic' else 'front')
        out = os.path.join(args['out'], '%s_raw.png' % rarity)
        bpy.context.scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        stats[rarity] = dict(tris=int(tris), path=out)
        print('RENDERED', rarity, out, 'tris', int(tris))
    json.dump(stats, open(os.path.join(args['out'], 'render-stats.json'), 'w'), indent=2)


if __name__ == '__main__':
    main()
