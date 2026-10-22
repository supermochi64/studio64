#!/usr/bin/env python3
"""Small sample models for tests/suite/assets.test.mjs: an OBJ + MTL + PNG platform and a GLB crate.

  python3 tests/fixtures/make_fixtures.py
"""
import json
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))


def png(path, w, h, pixel):
    rows = b''.join(b'\0' + b''.join(bytes(pixel(x, y)) for x in range(w)) for y in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b'')
    if path:
        with open(path, 'wb') as f:
            f.write(data)
    return data


def checker(x, y):
    return (230, 60, 40, 255) if ((x // 8) + (y // 8)) % 2 else (250, 230, 90, 255)


def wood(x, y):
    v = 120 + ((x * 7 + (y // 4) * 13) % 40)
    edge = x < 3 or y < 3 or x > 60 or y > 60
    return (90, 50, 20, 255) if edge else (v + 40, v, v // 2, 255)


# ---- OBJ: a 1000 x 1000 platform, 120 thick, with a raised step and a lava pool (units: game units)
def obj():
    v, vt, f = [], [], []
    def box(x0, y0, z0, x1, y1, z1, mat, uvs=1.0):
        base = len(v)
        for (x, y, z) in [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), (x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]:
            v.append((x, y, z))
        faces = [(4, 7, 6, 5), (0, 1, 2, 3), (3, 2, 6, 7), (1, 0, 4, 5), (2, 1, 5, 6), (0, 3, 7, 4)]
        t0 = len(vt)
        vt.extend([(0, 0), (uvs, 0), (uvs, uvs), (0, uvs)])
        for q in faces:
            f.append((mat, [(base + i + 1, t0 + k + 1) for k, i in enumerate(q)]))
    box(-500, 0, -500, 500, 120, 500, 'checker', 4)
    box(-450, 120, -450, -150, 240, -150, 'checker', 1)   # a step to jump on
    box(150, 110, 150, 450, 125, 450, 'lava_pool', 1)      # lava, slightly above the floor
    lines = ['# Studio 64 test platform', 'mtllib platform.mtl']
    lines += [f'v {x} {y} {z}' for (x, y, z) in v]
    lines += [f'vt {a} {b}' for (a, b) in vt]
    cur = None
    for mat, idx in f:
        if mat != cur:
            lines.append(f'usemtl {mat}')
            cur = mat
        lines.append('f ' + ' '.join(f'{a}/{b}' for a, b in idx))
    open(os.path.join(HERE, 'platform.obj'), 'w').write('\n'.join(lines) + '\n')
    open(os.path.join(HERE, 'platform.mtl'), 'w').write('newmtl checker\nKd 1 1 1\nmap_Kd checker.png\n\nnewmtl lava_pool\nKd 1 0.35 0.05\n')
    png(os.path.join(HERE, 'checker.png'), 32, 32, checker)


# ---- GLB: a 2 m wooden crate (glTF is in meters) with an embedded texture, plus a blue roof plate
def glb():
    pos, nrm, uv, idx = [], [], [], []
    def quad(p, n):
        b = len(pos)
        pos.extend(p)
        nrm.extend([n] * 4)
        uv.extend([(0, 1), (1, 1), (1, 0), (0, 0)])
        idx.extend([b, b + 1, b + 2, b, b + 2, b + 3])
    s = 1.0
    quad([(-s, 0, s), (s, 0, s), (s, 2 * s, s), (-s, 2 * s, s)], (0, 0, 1))
    quad([(s, 0, -s), (-s, 0, -s), (-s, 2 * s, -s), (s, 2 * s, -s)], (0, 0, -1))
    quad([(s, 0, s), (s, 0, -s), (s, 2 * s, -s), (s, 2 * s, s)], (1, 0, 0))
    quad([(-s, 0, -s), (-s, 0, s), (-s, 2 * s, s), (-s, 2 * s, -s)], (-1, 0, 0))
    quad([(-s, 2 * s, s), (s, 2 * s, s), (s, 2 * s, -s), (-s, 2 * s, -s)], (0, 1, 0))
    quad([(-s, 0, -s), (s, 0, -s), (s, 0, s), (-s, 0, s)], (0, -1, 0))
    n_crate = len(idx)
    # roof plate (second primitive/material), a little wider, floating above
    b = len(pos)
    pos.extend([(-1.3, 2.3, 1.3), (1.3, 2.3, 1.3), (1.3, 2.3, -1.3), (-1.3, 2.3, -1.3)])
    nrm.extend([(0, 1, 0)] * 4)
    uv.extend([(0, 0)] * 4)
    idx2 = [b, b + 1, b + 2, b, b + 2, b + 3]
    tex = png(None, 64, 64, wood)
    blobs = []
    def add(data):
        off = sum(len(x) for x in blobs)
        pad = (-len(data)) % 4
        blobs.append(data + b'\0' * pad)
        return off, len(data)
    P = add(b''.join(struct.pack('<fff', *p) for p in pos))
    N = add(b''.join(struct.pack('<fff', *p) for p in nrm))
    T = add(b''.join(struct.pack('<ff', *p) for p in uv))
    I1 = add(b''.join(struct.pack('<H', i) for i in idx))
    I2 = add(b''.join(struct.pack('<H', i) for i in idx2))
    IMG = add(tex)
    views = [{'buffer': 0, 'byteOffset': o, 'byteLength': l} for (o, l) in (P, N, T, I1, I2, IMG)]
    mins = [min(p[i] for p in pos) for i in range(3)]
    maxs = [max(p[i] for p in pos) for i in range(3)]
    gltf = {
        'asset': {'version': '2.0', 'generator': 'studio64 fixtures'},
        'scene': 0, 'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0, 'name': 'Crate'}],
        'meshes': [{'primitives': [
            {'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 3, 'material': 0},
            {'attributes': {'POSITION': 0, 'NORMAL': 1, 'TEXCOORD_0': 2}, 'indices': 4, 'material': 1}]}],
        'materials': [
            {'name': 'crate_wood', 'pbrMetallicRoughness': {'baseColorTexture': {'index': 0}}},
            {'name': 'roof', 'pbrMetallicRoughness': {'baseColorFactor': [0.2, 0.45, 1.0, 1.0]}, 'doubleSided': True}],
        'textures': [{'source': 0, 'sampler': 0}],
        'samplers': [{'wrapS': 10497, 'wrapT': 10497}],
        'images': [{'bufferView': 5, 'mimeType': 'image/png'}],
        'accessors': [
            {'bufferView': 0, 'componentType': 5126, 'count': len(pos), 'type': 'VEC3', 'min': mins, 'max': maxs},
            {'bufferView': 1, 'componentType': 5126, 'count': len(nrm), 'type': 'VEC3'},
            {'bufferView': 2, 'componentType': 5126, 'count': len(uv), 'type': 'VEC2'},
            {'bufferView': 3, 'componentType': 5123, 'count': len(idx), 'type': 'SCALAR'},
            {'bufferView': 4, 'componentType': 5123, 'count': len(idx2), 'type': 'SCALAR'}],
        'bufferViews': views,
        'buffers': [{'byteLength': sum(len(x) for x in blobs)}],
    }
    js = json.dumps(gltf).encode()
    js += b' ' * ((-len(js)) % 4)
    binc = b''.join(blobs)
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binc))
    out += struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(binc), 0x004E4942) + binc
    open(os.path.join(HERE, 'crate.glb'), 'wb').write(out)


# ---- a panorama for the sky test: blue to orange with a dark band of "mountains"
def sky():
    def px(x, y):
        t = y / 128
        if 70 < y < 90 and (x // 16) % 3:
            return (40, 60, 40, 255)
        return (int(40 + 200 * t), int(80 + 80 * t), int(230 - 160 * t), 255)
    png(os.path.join(HERE, 'sky.png'), 256, 128, px)


# ---- FBX (binary 7400, Z up like 3ds Max/Blender exports, units cm): a house with an embedded texture
def fbx():
    def prop(v):
        t, val = v
        if t == 'S':
            b = val.encode() if isinstance(val, str) else val
            return b'S' + struct.pack('<I', len(b)) + b
        if t == 'R':
            return b'R' + struct.pack('<I', len(val)) + val
        if t == 'L':
            return b'L' + struct.pack('<q', val)
        if t == 'I':
            return b'I' + struct.pack('<i', val)
        if t == 'D':
            return b'D' + struct.pack('<d', val)
        if t == 'd':
            data = b''.join(struct.pack('<d', x) for x in val)
            return b'd' + struct.pack('<III', len(val), 0, len(data)) + data
        if t == 'i':
            data = b''.join(struct.pack('<i', x) for x in val)
            return b'i' + struct.pack('<III', len(val), 0, len(data)) + data
        raise ValueError(t)

    def node(name, props=(), children=(), offset=0):
        pb = b''.join(prop(p) for p in props)
        head_len = 13 + len(name)
        body = b''
        start = offset + head_len + len(pb)
        for c in children:
            body += c(start + len(body))
        if children:
            body += b'\0' * 13
        end = offset + head_len + len(pb) + len(body)
        return struct.pack('<III', end, len(props), len(pb)) + bytes([len(name)]) + name.encode() + pb + body

    def N(name, props=(), children=()):
        return lambda off: node(name, props, children, off)

    def P(name, typ, *vals):
        return N('P', [('S', name), ('S', typ), ('S', ''), ('S', 'A')] + list(vals))

    # house: a 200 x 200 x 200 box (z up) with a pyramid roof to 320
    v = [(-100, -100, 0), (100, -100, 0), (100, 100, 0), (-100, 100, 0), (-100, -100, 200), (100, -100, 200), (100, 100, 200), (-100, 100, 200), (0, 0, 320)]
    polys = [[0, 3, 2, 1], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 8], [5, 6, 8], [6, 7, 8], [7, 4, 8]]
    pvi, uv, uvi = [], [], []
    for poly in polys:
        for k, i in enumerate(poly):
            pvi.append(i if k < len(poly) - 1 else ~i)
            uvi.append(len(uv) // 2)
            uv.extend([(k in (1, 2)) * 1.0, (k >= 2) * 1.0])
    mats = [0 if len(poly) == 4 else 1 for poly in polys]
    tex = png(None, 32, 32, lambda x, y: (200, 190, 170, 255) if (y % 8) and ((x + (y // 8) * 4) % 16) else (120, 90, 70, 255))
    objects = N('Objects', children=[
        N('Geometry', [('L', 100), ('S', 'House\0\x01Geometry'), ('S', 'Mesh')], [
            N('Vertices', [('d', [c for p in v for c in p])]),
            N('PolygonVertexIndex', [('i', pvi)]),
            N('LayerElementUV', [('I', 0)], [N('MappingInformationType', [('S', 'ByPolygonVertex')]), N('ReferenceInformationType', [('S', 'IndexToDirect')]), N('UV', [('d', uv)]), N('UVIndex', [('i', uvi)])]),
            N('LayerElementMaterial', [('I', 0)], [N('MappingInformationType', [('S', 'ByPolygon')]), N('ReferenceInformationType', [('S', 'IndexToDirect')]), N('Materials', [('i', mats)])]),
        ]),
        N('Model', [('L', 200), ('S', 'House\0\x01Model'), ('S', 'Mesh')], [N('Properties70', children=[P('Lcl Translation', 'Lcl Translation', ('D', 0.0), ('D', 0.0), ('D', 0.0))])]),
        N('Material', [('L', 300), ('S', 'walls\0\x01Material'), ('S', '')], [N('Properties70', children=[P('DiffuseColor', 'Color', ('D', 1.0), ('D', 1.0), ('D', 1.0))])]),
        N('Material', [('L', 301), ('S', 'roof_tiles\0\x01Material'), ('S', '')], [N('Properties70', children=[P('DiffuseColor', 'Color', ('D', 0.8), ('D', 0.15), ('D', 0.1))])]),
        N('Texture', [('L', 400), ('S', 'bricks\0\x01Texture'), ('S', '')], [N('RelativeFilename', [('S', 'bricks.png')])]),
        N('Video', [('L', 500), ('S', 'bricks\0\x01Video'), ('S', 'Clip')], [N('Content', [('R', tex)]), N('RelativeFilename', [('S', 'bricks.png')])]),
    ])
    conns = N('Connections', children=[
        N('C', [('S', 'OO'), ('L', 100), ('L', 200)]), N('C', [('S', 'OO'), ('L', 200), ('L', 0)]),
        N('C', [('S', 'OO'), ('L', 300), ('L', 200)]), N('C', [('S', 'OO'), ('L', 301), ('L', 200)]),
        N('C', [('S', 'OP'), ('L', 400), ('L', 300), ('S', 'DiffuseColor')]), N('C', [('S', 'OO'), ('L', 500), ('L', 400)]),
    ])
    gs = N('GlobalSettings', children=[N('Properties70', children=[P('UpAxis', 'int', ('I', 2)), P('UnitScaleFactor', 'double', ('D', 1.0))])])
    out = b'Kaydara FBX Binary  \0\x1a\0' + struct.pack('<I', 7400)
    for n in (gs, objects, conns):
        out += n(len(out))
    out += b'\0' * 13 + b'\0' * 200
    open(os.path.join(HERE, 'house.fbx'), 'wb').write(out)


obj()
glb()
fbx()
sky()
print('fixtures written to', HERE)
