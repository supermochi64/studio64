#!/usr/bin/env python3
"""Nintendo J3D (GameCube) models and animations: BMD/BDL models, BTI textures, BCK
joint animations and BTP texture-pattern animations.

Only what a port to another engine needs: the skeleton, skinning, triangles with
positions/normals/colors/UVs per material, each material's texture and colors, and
joint animation curves that can be sampled at any frame.
"""
import math, struct
import numpy as np


def u8(d, o): return d[o]
def u16(d, o): return struct.unpack_from('>H', d, o)[0]
def s16(d, o): return struct.unpack_from('>h', d, o)[0]
def u32(d, o): return struct.unpack_from('>I', d, o)[0]
def f32(d, o): return struct.unpack_from('>f', d, o)[0]


def name_table(d, o):
    n = u16(d, o)
    return [d[o + u16(d, o + 4 + i * 4 + 2):d.index(b'\0', o + u16(d, o + 4 + i * 4 + 2))].decode('shift_jis', 'replace') for i in range(n)]


def sections(d):
    n, o, out = u32(d, 12), 0x20, {}
    for _ in range(n):
        tag = d[o:o + 4].decode()
        size = u32(d, o + 4)
        out[tag] = o
        o += size
    return out


# ---- textures --------------------------------------------------------------------

BLOCK = {0: (8, 8, 4), 1: (8, 4, 8), 2: (8, 4, 8), 3: (4, 4, 16), 4: (4, 4, 16), 5: (4, 4, 16), 6: (4, 4, 32),
         8: (8, 8, 4), 9: (8, 4, 8), 10: (4, 4, 16), 14: (8, 8, 4)}


def rgb565(v):
    return ((v >> 11) & 31) * 255 // 31, ((v >> 5) & 63) * 255 // 63, (v & 31) * 255 // 31, 255


def rgb5a3(v):
    if v & 0x8000:
        return ((v >> 10) & 31) * 255 // 31, ((v >> 5) & 31) * 255 // 31, (v & 31) * 255 // 31, 255
    return ((v >> 8) & 15) * 17, ((v >> 4) & 15) * 17, (v & 15) * 17, ((v >> 12) & 7) * 255 // 7


def decode_texture(d, fmt, w, h, off, pal=None):
    """RGBA uint8 image (h, w, 4) from GameCube tiled texture data."""
    img = np.zeros((h, w, 4), np.uint8)
    bw, bh, bpp = BLOCK[fmt]
    p = off
    for by in range(0, h, bh):
        for bx in range(0, w, bw):
            if fmt == 14:  # CMPR: 2x2 sub-blocks of DXT1
                for sy in (0, 4):
                    for sx in (0, 4):
                        c0, c1 = u16(d, p), u16(d, p + 2)
                        bits = u32(d, p + 4)
                        p += 8
                        a, b = rgb565(c0), rgb565(c1)
                        if c0 > c1:
                            cols = [a, b, tuple((2 * a[i] + b[i]) // 3 for i in range(3)) + (255,), tuple((a[i] + 2 * b[i]) // 3 for i in range(3)) + (255,)]
                        else:
                            cols = [a, b, tuple((a[i] + b[i]) // 2 for i in range(3)) + (255,), (0, 0, 0, 0)]
                        for yy in range(4):
                            for xx in range(4):
                                idx = (bits >> (30 - 2 * (yy * 4 + xx))) & 3
                                X, Y = bx + sx + xx, by + sy + yy
                                if X < w and Y < h:
                                    img[Y, X] = cols[idx]
                continue
            if fmt == 6:  # RGBA8: AR plane then GB plane
                for k in range(16):
                    X, Y = bx + k % 4, by + k // 4
                    A, R = d[p + k * 2], d[p + k * 2 + 1]
                    G, B = d[p + 32 + k * 2], d[p + 32 + k * 2 + 1]
                    if X < w and Y < h:
                        img[Y, X] = (R, G, B, A)
                p += 64
                continue
            for yy in range(bh):
                for xx in range(bw):
                    X, Y = bx + xx, by + yy
                    k = yy * bw + xx
                    if fmt == 0:  # I4
                        v = (d[p + k // 2] >> (4 if k % 2 == 0 else 0)) & 15
                        c = (v * 17,) * 3 + (v * 17,)
                    elif fmt == 1:  # I8
                        v = d[p + k]
                        c = (v, v, v, v)
                    elif fmt == 2:  # IA4
                        v = d[p + k]
                        c = ((v & 15) * 17,) * 3 + ((v >> 4) * 17,)
                    elif fmt == 3:  # IA8
                        c = (d[p + k * 2 + 1],) * 3 + (d[p + k * 2],)
                    elif fmt == 4:
                        c = rgb565(u16(d, p + k * 2))
                    elif fmt == 5:
                        c = rgb5a3(u16(d, p + k * 2))
                    elif fmt in (8, 9, 10):  # C4, C8, C14X2
                        i = (d[p + k // 2] >> (4 if k % 2 == 0 else 0)) & 15 if fmt == 8 else d[p + k] if fmt == 9 else u16(d, p + k * 2) & 0x3fff
                        c = pal[i] if pal is not None and i < len(pal) else (255, 0, 255, 255)
                    if X < w and Y < h:
                        img[Y, X] = c
            p += bw * bh * bpp // 8
    return img


def palette(d, fmt, count, off):
    conv = {0: lambda v: ((v & 0xff),) * 3 + ((v >> 8),), 1: rgb565, 2: rgb5a3}[fmt]
    return [conv(u16(d, off + i * 2)) for i in range(count)]


def bti_header(d, o, name=''):
    fmt, alpha, w, h, ws, wt = d[o], d[o + 1], u16(d, o + 2), u16(d, o + 4), d[o + 6], d[o + 7]
    pal_fmt, pal_count, pal_off = d[o + 9], u16(d, o + 10), u32(d, o + 12)
    data_off = u32(d, o + 0x1c)
    pal = palette(d, pal_fmt, pal_count, o + pal_off) if pal_count else None
    return {'name': name, 'format': fmt, 'width': w, 'height': h, 'wrapS': ws, 'wrapT': wt,
            'image': decode_texture(d, fmt, w, h, o + data_off, pal)}


def read_bti(d):
    return bti_header(d, 0)


# ---- models ------------------------------------------------------------------------

GX_PRIMS = {0x90: 'tris', 0x98: 'strip', 0xa0: 'fan', 0x80: 'quads'}


def euler_matrix(rx, ry, rz):
    """J3D joint rotation: X, then Y, then Z (radians)."""
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


def srt(s, r, t):
    m = np.eye(4)
    m[:3, :3] = euler_matrix(*r) @ np.diag(s)
    m[:3, 3] = t
    return m


class Model:
    def __init__(self, d, bmt=None):
        """d: a BMD/BDL model; bmt: an optional material table (BMT) replacing its materials
        and textures (Sunshine keeps the looks of some characters in separate BMT files)."""
        self.d = d
        self.sec = sections(d)
        self.read_joints()
        self.read_inf()
        self.read_vtx()
        self.read_evp_drw()
        self.mat_d, self.mat_sec = d, self.sec
        if bmt is not None:
            self.mat_d, self.mat_sec = bmt, sections(bmt)
        self.read_textures()
        self.read_materials()
        self.read_shapes()
        if bmt is not None and 'MAT3' in self.sec:
            # the shapes use the model's own material numbers: map them by name into the table
            o = self.sec['MAT3']
            own = name_table(d, o + u32(d, o + 0x0c + 2 * 4))
            n_own = u16(d, o + 8)
            remap = [u16(d, o + u32(d, o + 0x10) + i * 2) for i in range(n_own)]
            names = [m['name'] for m in self.materials]
            for sh in self.shapes:
                k = sh['material']
                if k < len(own) and own[k] in names:
                    sh['material'] = names.index(own[k])

    # skeleton
    def read_joints(self):
        d, o = self.d, self.sec['JNT1']
        n = u16(d, o + 8)
        eo, ro, no = o + u32(d, o + 12), o + u32(d, o + 16), o + u32(d, o + 20)
        names = name_table(d, no)
        self.joints = []
        for i in range(n):
            e = eo + u16(d, ro + i * 2) * 0x40
            ssc = d[e + 2] == 1  # the joint ignores its parent's scale (Maya segment scale compensate)
            s = [f32(d, e + 4 + k * 4) for k in range(3)]
            r = [s16(d, e + 16 + k * 2) * math.pi / 32768 for k in range(3)]
            t = [f32(d, e + 24 + k * 4) for k in range(3)]
            self.joints.append({'name': names[i] if i < len(names) else f'joint{i}', 'scale': s, 'rot': r, 'trans': t, 'ssc': ssc, 'parent': -1, 'children': []})

    def read_inf(self):
        """Joint parents and which material each shape uses, from the scene graph."""
        d, o = self.d, self.sec['INF1']
        p = o + u32(d, o + 0x14)
        joint_stack, last_joint, mat_stack, last_mat, last_kind = [], -1, [], -1, None
        self.shape_material = {}
        depth_kinds = []
        while True:
            kind, idx = u16(d, p), u16(d, p + 2)
            p += 4
            if kind == 0:
                break
            if kind == 1:  # open: the last node becomes the parent
                depth_kinds.append(('joint', last_joint) if last_kind == 0x10 else ('mat', last_mat) if last_kind == 0x11 else ('other', None))
                if last_kind == 0x10:
                    joint_stack.append(last_joint)
                if last_kind == 0x11:
                    mat_stack.append(last_mat)
            elif kind == 2:
                k, _ = depth_kinds.pop()
                if k == 'joint':
                    joint_stack.pop()
                if k == 'mat':
                    mat_stack.pop()
            elif kind == 0x10:
                if joint_stack:
                    self.joints[idx]['parent'] = joint_stack[-1]
                    self.joints[joint_stack[-1]]['children'].append(idx)
                last_joint = idx
            elif kind == 0x11:
                last_mat = idx
            elif kind == 0x12:
                self.shape_material[idx] = last_mat
            last_kind = kind
        # bind pose: world matrices
        self.world = [None] * len(self.joints)
        def walk(i, parent):
            j = self.joints[i]
            self.world[i] = parent @ srt(j['scale'], j['rot'], j['trans'])
            for c in j['children']:
                walk(c, self.world[i])
        for i, j in enumerate(self.joints):
            if j['parent'] < 0:
                walk(i, np.eye(4))

    # vertex arrays
    def read_vtx(self):
        d, o = self.d, self.sec['VTX1']
        fo = o + u32(d, o + 8)
        offs = [u32(d, o + 12 + k * 4) for k in range(13)]
        size = u32(d, o + 4)
        fmts = {}
        while True:
            attr, cnt, typ, frac = u32(d, fo), u32(d, fo + 4), u32(d, fo + 8), d[fo + 12]
            fo += 16
            if attr == 0xff:
                break
            fmts[attr] = (cnt, typ, frac)
        nonzero = sorted(x for x in offs if x) + [size]
        self.arrays = {}
        slot = {9: 0, 10: 1, 11: 3, 12: 4, **{13 + k: 5 + k for k in range(8)}}
        for attr, (cnt, typ, frac) in fmts.items():
            start = offs[slot[attr]]
            end = nonzero[nonzero.index(start) + 1]
            raw = d[o + start:o + end]
            if attr in (11, 12):  # colors
                csize = {0: 2, 1: 3, 2: 4, 3: 2, 4: 3, 5: 4}[typ]
                cols = []
                for k in range(0, len(raw) - csize + 1, csize):
                    if typ == 5 or typ == 2:
                        cols.append(tuple(raw[k:k + 4]) if typ == 5 else tuple(raw[k:k + 3]) + (255,))
                    elif typ == 1:
                        cols.append(tuple(raw[k:k + 3]) + (255,))
                    elif typ == 0:
                        cols.append(rgb565(struct.unpack_from('>H', raw, k)[0]))
                    elif typ == 3:
                        v = struct.unpack_from('>H', raw, k)[0]
                        cols.append(tuple(((v >> s) & 15) * 17 for s in (12, 8, 4, 0)))
                    else:
                        v = (raw[k] << 16) | (raw[k + 1] << 8) | raw[k + 2]
                        cols.append(tuple(((v >> s) & 63) * 255 // 63 for s in (18, 12, 6, 0)))
                self.arrays[attr] = np.array(cols, np.uint8)
                continue
            comps = {9: 2 + cnt, 10: 3, **{13 + k: 1 + cnt for k in range(8)}}[attr]
            dt = {0: '>u1', 1: '>i1', 2: '>u2', 3: '>i2', 4: '>f4'}[typ]
            arr = np.frombuffer(raw[:len(raw) // np.dtype(dt).itemsize * np.dtype(dt).itemsize], dt).astype(np.float64)
            if typ != 4:
                arr = arr / (1 << frac)
            self.arrays[attr] = arr[:len(arr) // comps * comps].reshape(-1, comps)

    # skinning
    def read_evp_drw(self):
        d = self.d
        self.envelopes, self.inv_bind = [], {}
        if 'EVP1' in self.sec:
            o = self.sec['EVP1']
            n = u16(d, o + 8)
            co, io, wo, mo = (o + u32(d, o + 12 + k * 4) for k in range(4))
            k = 0
            maxj = -1
            for e in range(n):
                cnt = d[co + e]
                env = []
                for _ in range(cnt):
                    env.append((u16(d, io + k * 2), f32(d, wo + k * 4)))
                    maxj = max(maxj, env[-1][0])
                    k += 1
                self.envelopes.append(env)
            for j in range(maxj + 1):
                m = np.eye(4)
                m[:3, :] = np.array([f32(d, mo + j * 48 + q * 4) for q in range(12)]).reshape(3, 4)
                self.inv_bind[j] = m
        o = self.sec['DRW1']
        n = u16(d, o + 8)
        wo, do = o + u32(d, o + 12), o + u32(d, o + 16)
        self.draw = [(d[wo + i], u16(d, do + i * 2)) for i in range(n)]

    def draw_weights(self, i):
        """[(joint, weight)] for a draw-matrix entry."""
        weighted, idx = self.draw[i]
        return self.envelopes[idx] if weighted else [(idx, 1.0)]

    # materials and textures
    def read_textures(self):
        d, sec = self.mat_d, self.mat_sec
        self.textures = []
        if 'TEX1' not in sec:
            return
        o = sec['TEX1']
        n = u16(d, o + 8)
        ho, no = o + u32(d, o + 12), o + u32(d, o + 16)
        names = name_table(d, no) if u32(d, o + 16) else [f'tex{i}' for i in range(n)]
        for i in range(n):
            self.textures.append(bti_header(d, ho + i * 32, names[i]))

    def read_materials(self):
        """Each material: its name, textures, colours and the TEV program that combines them
        (enough to bake what a material looks like; see tev_eval)."""
        d, o = self.mat_d, self.mat_sec['MAT3']
        n = u16(d, o + 8)
        off = [u32(d, o + 0x0c + k * 4) for k in range(30)]
        entries, remap, names = o + off[0], o + off[1], name_table(d, o + off[2])
        T = lambda k: o + off[k]
        def rgba8(base, i):
            return tuple(d[base + i * 4:base + i * 4 + 4])
        self.materials = []
        for i in range(n):
            e = entries + u16(d, remap + i * 2) * 0x14c
            idx = lambda at, k=0: u16(d, e + at + k * 2)
            tex = [idx(0x84, k) for k in range(8)]
            tex = [u16(d, T(15) + t * 2) if t != 0xffff else None for t in tex]
            mc = idx(0x08)
            color = rgba8(T(5), mc) if mc != 0xffff else (255, 255, 255, 255)
            ac = idx(0x14)
            amb = rgba8(T(8), ac) if ac != 0xffff and off[8] else (0, 0, 0, 255)
            ch = idx(0x0c)
            chan = tuple(d[T(7) + ch * 8:T(7) + ch * 8 + 6]) if ch != 0xffff and off[7] else (0, 0, 0, 0, 0, 0)
            ach = idx(0x0c, 1)
            achan = tuple(d[T(7) + ach * 8:T(7) + ach * 8 + 6]) if ach != 0xffff and off[7] else chan
            chans = []  # COLOR0, ALPHA0, COLOR1, ALPHA1: (lit, material source, light mask, diffuse fn, attenuation, ambient source)
            for k in range(4):
                c = idx(0x0c, k)
                chans.append(tuple(d[T(7) + c * 8:T(7) + c * 8 + 6]) if c != 0xffff and off[7] else (0, 0, 0, 0, 0, 0))
            mat_colors = [rgba8(T(5), idx(0x08, k)) if idx(0x08, k) != 0xffff else (255, 255, 255, 255) for k in range(2)]
            amb_colors = [rgba8(T(8), idx(0x14, k)) if idx(0x14, k) != 0xffff and off[8] else (0, 0, 0, 255) for k in range(2)]
            cull_i = d[e + 1]
            cull = u32(d, T(4) + cull_i * 4) if off[4] else 2  # 0 none, 1 front, 2 back, 3 all
            stages_n = d[T(19) + d[e + 4]] if off[19] else 1
            tev_colors = []
            for k in range(4):
                t = idx(0xdc, k)
                tev_colors.append(tuple(s16(d, T(17) + t * 8 + q * 2) for q in range(4)) if t != 0xffff else (255, 255, 255, 255))
            konst = []
            for k in range(4):
                t = idx(0x94, k)
                konst.append(rgba8(T(18), t) if t != 0xffff else (255, 255, 255, 255))
            stages = []
            for k in range(stages_n):
                so, oo = idx(0xe4, k), idx(0xbc, k)
                st = T(20) + so * 20
                order = tuple(d[T(16) + oo * 4:T(16) + oo * 4 + 3]) if oo != 0xffff else (0xff, 0xff, 0xff)
                stages.append({'tex_coord': order[0], 'tex_map': order[1], 'channel': order[2],
                               'color_in': tuple(d[st + 1:st + 5]), 'color_op': d[st + 5], 'color_bias': d[st + 6],
                               'color_scale': d[st + 7], 'color_clamp': d[st + 8], 'color_reg': d[st + 9],
                               'alpha_in': tuple(d[st + 10:st + 14]), 'alpha_op': d[st + 14], 'alpha_bias': d[st + 15],
                               'alpha_scale': d[st + 16], 'alpha_clamp': d[st + 17], 'alpha_reg': d[st + 18],
                               'konst_color': d[e + 0x9c + k], 'konst_alpha': d[e + 0xac + k]})
            acmp = idx(0x146)
            alpha_cmp = tuple(d[T(24) + acmp * 8:T(24) + acmp * 8 + 5]) if acmp != 0xffff else (7, 0, 0, 7, 0)
            bl = idx(0x148)
            blend = tuple(d[T(25) + bl * 4:T(25) + bl * 4 + 4]) if bl != 0xffff else (0, 1, 0, 0)
            texgens = []
            tg_n = d[T(10) + d[e + 3]] if off[10] else 1
            for k in range(tg_n):
                t = idx(0x28, k)
                texgens.append(tuple(d[T(11) + t * 4:T(11) + t * 4 + 3]) if t != 0xffff else (1, 4, 60))
            self.materials.append({'name': names[i] if i < len(names) else f'mat{i}',
                                   'texture': tex[0], 'textures': tex, 'color': color, 'amb': amb,
                                   'chan': chan, 'achan': achan, 'chans': chans, 'mat_colors': mat_colors, 'amb_colors': amb_colors, 'mode': d[e],
                                   'alpha_test': alpha_cmp[0] != 7 or alpha_cmp[3] != 7, 'alpha_cmp': alpha_cmp,
                                   'blend': blend[0] == 1, 'blend_mode': blend, 'cull': cull,
                                   'tev_colors': tev_colors, 'konst': konst, 'stages': stages, 'texgens': texgens})

    # geometry
    def read_shapes(self):
        d, o = self.d, self.sec['SHP1']
        n = u16(d, o + 8)
        eo, ro = o + u32(d, o + 12), o + u32(d, o + 16)
        attr_o, mtab_o, prim_o, mdata_o, pkt_o = (o + u32(d, o + 0x18 + k * 4) for k in range(5))
        self.shapes = []
        for si in range(n):
            e = eo + u16(d, ro + si * 2) * 0x28
            mtype, npk, aoff, first_md, first_pk = d[e], u16(d, e + 2), u16(d, e + 4), u16(d, e + 6), u16(d, e + 8)
            attrs = []
            a = attr_o + aoff
            while True:
                at, ty = u32(d, a), u32(d, a + 4)
                a += 8
                if at == 0xff:
                    break
                attrs.append((at, ty))
            tris = []  # each vertex: dict of attribute -> index, plus 'mtx' (draw index)
            mtx_table = [0] * 10
            for pk in range(npk):
                md = mdata_o + (first_md + pk) * 8
                cnt, first = u16(d, md + 2), u32(d, md + 4)
                for k in range(cnt):
                    v = u16(d, mtab_o + (first + k) * 2)
                    if v != 0xffff:
                        mtx_table[k] = v
                size, poff = u32(d, pkt_o + (first_pk + pk) * 8), u32(d, pkt_o + (first_pk + pk) * 8 + 4)
                p, end = prim_o + poff, prim_o + poff + size
                while p < end:
                    op = d[p]
                    if op not in GX_PRIMS:
                        break
                    cnt_v = u16(d, p + 1)
                    p += 3
                    verts = []
                    for _ in range(cnt_v):
                        v = {}
                        for at, ty in attrs:
                            if ty == 1:
                                val = d[p]; p += 1
                            elif ty == 2:
                                val = d[p]; p += 1
                            elif ty == 3:
                                val = u16(d, p); p += 2
                            else:
                                continue
                            v[at] = val
                        slot = v.get(0, 0) // 3
                        v['mtx'] = mtx_table[slot]
                        verts.append(v)
                    kind = GX_PRIMS[op]
                    if kind == 'tris':
                        tris += [verts[k:k + 3] for k in range(0, len(verts) - 2, 3)]
                    elif kind == 'strip':
                        for k in range(len(verts) - 2):
                            tris.append([verts[k], verts[k + 1], verts[k + 2]] if k % 2 == 0 else [verts[k + 1], verts[k], verts[k + 2]])
                    elif kind == 'fan':
                        tris += [[verts[0], verts[k], verts[k + 1]] for k in range(1, len(verts) - 1)]
            self.shapes.append({'material': self.shape_material.get(si, 0), 'tris': tris, 'mtype': mtype})

    def vertex_world(self, v):
        """Bind-pose model-space position, normal and the joint weights of a vertex."""
        pos = np.append(self.arrays[9][v[9]][:3], 1.0)
        nrm = self.arrays[10][v[10]] if 10 in v and 10 in self.arrays else np.array([0, 1, 0])
        weighted, idx = self.draw[v['mtx']]
        if weighted:
            return pos[:3], nrm, self.envelopes[idx]
        # vertices bound to one joint are stored in that joint's space
        w = self.world[idx]
        return (w @ pos)[:3], w[:3, :3] @ nrm, [(idx, 1.0)]


# ---- joint animations ----------------------------------------------------------------

def hermite(t, t0, v0, out0, t1, v1, in1):
    if t1 == t0:
        return v0
    s = (t - t0) / (t1 - t0)
    s2, s3 = s * s, s * s * s
    h0, h1 = 2 * s3 - 3 * s2 + 1, -2 * s3 + 3 * s2
    h2, h3 = s3 - 2 * s2 + s, s3 - s2
    return h0 * v0 + h1 * v1 + (h2 * out0 + h3 * in1) * (t1 - t0)


class Curve:
    def __init__(self, keys):
        self.keys = keys  # [(time, value, in, out)]

    def at(self, t):
        k = self.keys
        if len(k) == 1:
            return k[0][1]
        if t <= k[0][0]:
            return k[0][1]
        for a, b in zip(k, k[1:]):
            if t <= b[0]:
                return hermite(t, a[0], a[1], a[3], b[0], b[1], b[2])
        return k[-1][1]


class JointAnim:
    """BCK (ANK1): per joint, scale/rotation/translation curves for x, y, z."""

    def __init__(self, d):
        o = sections(d)['ANK1']
        self.loop = d[o + 8]
        angle_mul = d[o + 9]
        self.length = u16(d, o + 10)
        n = u16(d, o + 12)
        tab = o + u32(d, o + 0x14)
        sv, rv, tv = o + u32(d, o + 0x18), o + u32(d, o + 0x1c), o + u32(d, o + 0x20)
        rot_scale = (2 ** angle_mul) * math.pi / 32768
        def curve(p, base, kind):
            count, index, mode = u16(d, p), u16(d, p + 2), u16(d, p + 4)
            val = (lambda i: f32(d, base + i * 4)) if kind != 'r' else (lambda i: s16(d, base + i * 2) * rot_scale)
            if count == 1:
                return Curve([(0, val(index), 0, 0)])
            step = 3 if mode == 0 else 4
            keys = []
            for k in range(count):
                q = index + k * step
                t, v, ti = val(q) if kind != 'r' else f32_or(d, base, q), val(q + 1), val(q + 2)
                to = val(q + 3) if step == 4 else ti
                keys.append((t, v, ti, to))
            return Curve(keys)
        def f32_or(d, base, q):
            return s16(d, base + q * 2)  # rotation key times are stored as s16 too
        self.joints = []
        for j in range(n):
            p = tab + j * 54
            comps = []
            for axis in range(3):
                q = p + axis * 18
                comps.append((curve(q, sv, 's'), curve(q + 6, rv, 'r'), curve(q + 12, tv, 't')))
            self.joints.append(comps)

    def sample(self, joint, t):
        """(scale xyz, rotation xyz radians, translation xyz) of a joint at frame t."""
        c = self.joints[joint]
        return [c[a][0].at(t) for a in range(3)], [c[a][1].at(t) for a in range(3)], [c[a][2].at(t) for a in range(3)]
