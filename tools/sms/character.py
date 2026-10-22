#!/usr/bin/env python3
"""One pipeline for any J3D (GameCube) character -> SM64 engine C data, smoothly skinned.

A character is drawn by engine/src/studio/sms/sms_models.c at runtime:

* the skeleton is posed every frame from the character's own animations (all of J3D's
  scale/rotation/translation channels, X-Y-Z rotation order, segment scale compensation),
* every vertex is skinned on the CPU from its joint weights (J3D envelopes), so bends stay
  seamless exactly like in the original game,
* each material's look is baked from its TEV program: the converter evaluates the TEV stages
  per vertex colour at a few light levels (the game's toon lighting included), which gives a
  small colour ramp per vertex; at runtime the light level of the skinned normal picks the
  colour from the ramp. The main texture of the material is drawn modulated by that colour.

Usage (see convert.py): Character(spec).emit() -> C source.
"""
import hashlib, math
import numpy as np
from PIL import Image

import j3d

RAMP = 5           # light levels per colour ramp (d = 0, .25, .5, .75, 1)
MAX_BATCH = 64     # vertices per gSPVertex load (gfx_pc keeps 64)
LAYERS = {'opaque': 0, 'alpha': 1, 'xlu': 2, 'decal': 3}  # decal: translucent, drawn onto the surface below
# material flags (sms.h)
MF_NOCULL, MF_CULLFRONT, MF_CLAMP_S, MF_CLAMP_T, MF_MIRROR_S, MF_MIRROR_T, MF_UNLIT, MF_ENVMAP = 1, 2, 4, 8, 16, 32, 64, 128
NOT_MAIN = ('polmask', 'rak_dummy', 'toon', 'h_ma_')


def fit(img, max_side):
    h, w = img.shape[:2]
    if max(h, w) <= max_side:
        return img
    s = max_side / max(h, w)
    return np.array(Image.fromarray(img, 'RGBA').resize((max(4, int(w * s)), max(4, int(h * s))), Image.LANCZOS))


def c_array(ctype, name, values, per_line=16, fmt=str):
    vals = list(values)
    lines = [', '.join(fmt(v) for v in vals[i:i + per_line]) for i in range(0, len(vals), per_line)]
    return f'static const {ctype} {name}[] = {{\n    ' + ',\n    '.join(lines) + (',' if vals else '0') + '\n};\n'


# ---- textures -----------------------------------------------------------------------

class Textures:
    """N64 texture data, shared (by content) between all the characters of one output file."""

    def __init__(self):
        self.by_hash = {}
        self.out = []

    def add(self, img, max_side, prefix):
        """img: RGBA uint8 (h, w, 4). Returns (c name, fmt, siz, w, h). Greyscale images
        become IA16, soft alpha RGBA32, everything else RGBA16."""
        img = fit(np.ascontiguousarray(img), max_side)
        h, w = img.shape[:2]
        rgb, a = img[..., :3].astype(int), img[..., 3]
        grey = (np.abs(rgb[..., 0] - rgb[..., 1]).max() < 10) and (np.abs(rgb[..., 0] - rgb[..., 2]).max() < 10)
        soft = ((a > 24) & (a < 232)).mean() > 0.02
        if grey:
            data = np.stack([img[..., 0], a], axis=-1).astype(np.uint8).tobytes()
            fmt, siz = 'G_IM_FMT_IA', 'G_IM_SIZ_16b'
        elif soft:
            data = img.astype(np.uint8).tobytes()
            fmt, siz = 'G_IM_FMT_RGBA', 'G_IM_SIZ_32b'
        else:
            v = ((rgb[..., 0] >> 3) << 11) | ((rgb[..., 1] >> 3) << 6) | ((rgb[..., 2] >> 3) << 1) | (a >= 128)
            data = v.astype('>u2').tobytes()
            fmt, siz = 'G_IM_FMT_RGBA', 'G_IM_SIZ_16b'
        key = hashlib.sha1(data + fmt.encode() + siz.encode() + bytes([w & 255, h & 255])).hexdigest()
        if key not in self.by_hash:
            name = f'sms_tex_{prefix}_{len(self.by_hash)}'
            self.by_hash[key] = (name, fmt, siz, w, h)
            lines = [', '.join(f'0x{b:02X}' for b in data[i:i + 16]) for i in range(0, len(data), 16)]
            self.out.append(f'ALIGNED8 static const u8 {name}[] = {{\n    ' + ',\n    '.join(lines) + ',\n};\n')
        return self.by_hash[key]


# ---- TEV --------------------------------------------------------------------------------

def _konst_c(sel, K):
    if sel <= 7:
        return np.full(3, (8 - sel) / 8)
    if 0x0c <= sel <= 0x0f:
        return K[sel - 0x0c][:3]
    if 0x10 <= sel <= 0x1f:
        return np.full(3, K[(sel - 0x10) % 4][(sel - 0x10) // 4])
    return np.ones(3)


def _konst_a(sel, K):
    if sel <= 7:
        return (8 - sel) / 8
    if 0x10 <= sel <= 0x1f:
        return K[(sel - 0x10) % 4][(sel - 0x10) // 4]
    return 1.0


class Tev:
    """Evaluates a J3D material's TEV program for one vertex colour at a light level."""

    def __init__(self, model, mat, main_tex, override_color=None):
        self.m, self.mat, self.main = model, mat, main_tex
        self.main_value = np.ones(4)
        self.ratio = None  # (average texel, full-light colour): ramps relative to the baked texture
        self.images = {}
        self.override_color = override_color

    def image(self, t):
        if t not in self.images:
            self.images[t] = self.m.textures[t]['image'].astype(float) / 255
        return self.images[t]

    @staticmethod
    def light(ch, v, reg, amb, d):
        enable, msrc, mask, _, _, asrc = ch
        mc = v if msrc else reg
        if not enable:
            return mc
        # only light 0 is the sun; the others are effect lights that are usually off
        return mc * np.clip((v if asrc else amb) + (d if mask & 1 else 0), 0, 1)

    def channel(self, k, vc, d):
        """Rasterized colour channel pair k (0: COLOR0A0, 1: COLOR1A1) as RGBA at light d."""
        mat = self.mat
        reg = np.array(mat['mat_colors'][k], float) / 255
        amb = np.array(mat['amb_colors'][k], float) / 255
        rgb = self.light(mat['chans'][2 * k], vc[:3], reg[:3], amb[:3], d)
        a = self.light(mat['chans'][2 * k + 1], vc[3], reg[3], amb[3], d)
        return np.append(rgb, a)

    def sample(self, stage, ras0):
        tm = stage['tex_map']
        if tm == 0xff or tm >= len(self.mat['textures']) or self.mat['textures'][tm] is None:
            return np.ones(4)
        t = self.mat['textures'][tm]
        if t == self.main:
            return self.main_value  # the texel being baked, or the texture's average
        name = self.m.textures[t]['name'].lower()
        tg = self.mat['texgens'][stage['tex_coord']] if stage['tex_coord'] < len(self.mat['texgens']) else (1, 4, 60)
        img = self.image(t)
        if tg[0] == 10:  # SRTG: the toon ramp, looked up by the lit colour
            h, w = img.shape[:2]
            x = min(w - 1, max(0, int(ras0[0] * (w - 1) + 0.5)))
            y = min(h - 1, max(0, int(ras0[1] * (h - 1) + 0.5)))
            return img[y, x]
        if 'polmask' in name:
            return np.ones(4)  # the pollution mask: bright where the character is clean
        return img.reshape(-1, 4).mean(axis=0)

    def eval(self, vc0, vc1, d):
        """RGBA (0..1) of the material for the vertex colours vc0/vc1 (RGBA 0..1) at light level d."""
        mat = self.mat
        if self.override_color is not None:
            c = np.array(self.override_color, float) / 255
            lit = np.clip(0.55 + 0.6 * d, 0, 1.15)
            return np.clip(np.append(c[:3] * lit, c[3]), 0, 1)
        regs = [np.array(c, float) / 255 for c in mat['tev_colors']]
        R = {0: regs[3].copy(), 1: regs[0].copy(), 2: regs[1].copy(), 3: regs[2].copy()}  # PREV, C0, C1, C2
        K = [np.array(c, float) / 255 for c in mat['konst']]
        c0 = self.channel(0, vc0, d)
        c1 = self.channel(1, vc1, d)
        for st in mat['stages']:
            ch = st['channel']
            ras = {0: c0, 1: c1, 2: np.full(4, c0[3]), 3: np.full(4, c1[3]), 4: c0, 5: c1}.get(ch, np.zeros(4))
            tex = self.sample(st, c0)
            kc, ka = _konst_c(st['konst_color'], K), _konst_a(st['konst_alpha'], K)
            def cin(i):
                return [R[0][:3], np.full(3, R[0][3]), R[1][:3], np.full(3, R[1][3]), R[2][:3], np.full(3, R[2][3]),
                        R[3][:3], np.full(3, R[3][3]), tex[:3], np.full(3, tex[3]), ras[:3], np.full(3, ras[3]),
                        np.ones(3), np.full(3, 0.5), kc, np.zeros(3)][i] if i < 16 else np.zeros(3)
            def ain(i):
                return [R[0][3], R[1][3], R[2][3], R[3][3], tex[3], ras[3], ka, 0.0][i] if i < 8 else 0.0
            a, b, c, dd = (cin(i) for i in st['color_in'])
            col = self.op(a, b, c, dd, st['color_op'], st['color_bias'], st['color_scale'], st['color_clamp'])
            a, b, c, dd = (ain(i) for i in st['alpha_in'])
            alp = self.op(np.array([a]), np.array([b]), np.array([c]), np.array([dd]), st['alpha_op'], st['alpha_bias'], st['alpha_scale'], st['alpha_clamp'])[0]
            R[st['color_reg'] & 3] = np.append(col, R[st['color_reg'] & 3][3])
            R[st['alpha_reg'] & 3][3] = alp
        return np.clip(R[0], 0, 1)

    @staticmethod
    def op(a, b, c, d, op, bias, scale, clamp):
        if op >= 8 or bias == 3:  # compare: d + (a > b or a == b ? c : 0), on the red channel
            eq = op & 1
            ar, br = a[..., 0], b[..., 0]
            hit = np.isclose(ar, br) if eq else ar > br + 1e-6
            return np.clip(d + np.where(hit, c, 0), 0, 1)
        v = (1 - c) * a + c * b
        v = d - v if op == 1 else d + v
        v = v + {0: 0, 1: 0.5, 2: -0.5}.get(bias, 0)
        v = v * {0: 1, 1: 2, 2: 4, 3: 0.5}.get(scale, 1)
        return np.clip(v, 0, 1) if clamp else np.clip(v, -4, 4)


# ---- the character ------------------------------------------------------------------------

class Character:
    """spec keys:
        name      C identifier of the body ("hamukuri")
        model     BMD bytes; bmt: optional BMT bytes
        scale     model units -> SM64 units
        anims     [(name, BCK bytes or None)]: the animation table (None = bind pose)
        materials {material name: override}, override keys:
                  skip (drop it), textures [RGBA images] (frames), slot (object field picking
                  the frame: 1 = oSmsEye, 2 = oSmsShirt), tint (multiplied by the object's
                  tint colour), color (RGBA: replace the TEV look by a flat lit colour),
                  layer ('opaque'/'alpha'/'xlu'), cull (False = both sides), max_side, unlit
        attach    [{model, joint, offset, scale, materials}]: extra models carried by a joint
        yaw       turns the model (SM64 angle units) so that it faces +Z like SM64 models
        still_joints  joints kept in their bind pose (locators the game animates in code)
        shadow    shadow radius (SM64 units)
        tex_max   default texture size limit
    """

    def __init__(self, spec, textures):
        self.spec = spec
        self.name = spec['name']
        self.tex = textures
        bmt = spec.get('bmt')
        self.m = m = j3d.Model(spec['model'], bmt)
        self.scale = spec.get('scale', 1.0)
        self.ov = spec.get('materials', {})
        self.build_influences()
        self.build_geometry()

    # -- skinning data
    def build_influences(self):
        m = self.m
        self.inv_bind = {j: (m.inv_bind[j] if j in m.inv_bind else np.linalg.inv(m.world[j])) for j in range(len(m.joints))}

    def vertex_influences(self, m, v, force_joint=None, offset=(0, 0, 0)):
        """[(joint, weight, pos in joint space (scaled), normal in joint space)] of a J3D vertex.
        force_joint: the vertex belongs to an attached model, carried rigidly by that joint."""
        pos = np.append(m.arrays[9][v[9]][:3], 1.0)
        nrm = m.arrays[10][v[10]][:3] if 10 in v and 10 in m.arrays else np.array([0.0, 1.0, 0.0])
        if force_joint is not None:
            p, n, _ = m.vertex_world(v)
            return [(force_joint, 1.0, (np.array(p) * self.att_scale + offset) * self.scale, n / (np.linalg.norm(n) or 1))]
        weighted, idx = m.draw[v['mtx']]
        out = []
        if weighted:
            for j, w in m.envelopes[idx]:
                ib = self.inv_bind[j]
                p = (ib @ pos)[:3]
                n = ib[:3, :3] @ nrm
                out.append((j, w, p * self.scale, n / (np.linalg.norm(n) or 1)))
        else:
            out.append((idx, 1.0, pos[:3] * self.scale, nrm / (np.linalg.norm(nrm) or 1)))
        # at most 4 influences, weights renormalised
        out.sort(key=lambda x: -x[1])
        out = out[:4]
        tot = sum(x[1] for x in out) or 1
        return [(j, w / tot, p, n) for j, w, p, n in out]

    # -- materials
    def main_texture(self, m, mat):
        stages = mat['stages']
        for st in stages:
            tm = st['tex_map']
            if tm == 0xff or tm >= len(mat['textures']) or mat['textures'][tm] is None:
                continue
            t = mat['textures'][tm]
            tg = mat['texgens'][st['tex_coord']] if st['tex_coord'] < len(mat['texgens']) else (1, 4, 60)
            name = m.textures[t]['name'].lower()
            if tg[0] == 10 or any(k in name for k in NOT_MAIN):
                continue
            return t, tg
        return None, None

    def bake(self, tev, img, max_side):
        """The texture as the material shows it in full light: every texel through the TEV."""
        img = fit(np.ascontiguousarray(img), max_side)
        flat = img.reshape(-1, 4)
        uniq, inv = np.unique(flat, axis=0, return_inverse=True)
        out = np.zeros((len(uniq), 4))
        white = np.ones(4)
        for k, t in enumerate(uniq):
            tev.main_value = t.astype(float) / 255
            out[k] = tev.eval(white, white, 1.0)
        tev.main_value = np.ones(4)
        if tev.layer == 0:
            out[:, 3] = 1
        res = (out[inv.reshape(-1)] * 255).round().clip(0, 255).astype(np.uint8)
        return res.reshape(img.shape)

    def tex_matrix(self, mat, tg):
        """The UV transform of a texgen (J3D texture SRT matrices), as a function."""
        return lambda uv: uv

    def build_geometry(self):
        self.mats = []        # dicts for C
        self.verts = []       # (uv, ramp, inf start, inf count)
        self.infs = []        # (pos, nrm, joint, weight)
        self.batches = []     # (mat index, first, count, tris)
        self.ramps = []       # [RAMP x RGBA u8]
        self._tex_images = {}  # material -> its first texture (for previews)
        ramp_index = {}
        inf_index = {}
        joint_names = [j['name'] for j in self.m.joints]
        sources = [(self.m, None, (0, 0, 0), self.ov)]
        # attached models (a brain, a hat, ...): carried rigidly by one joint
        for att in self.spec.get('attach', []):
            sources.append((j3d.Model(att['model'], att.get('bmt')), joint_names.index(att['joint']), att.get('offset', (0, 0, 0)),
                            att.get('materials', {})))
        self.att_scale = 1.0
        for k, src in enumerate(sources):
            self.att_scale = self.spec['attach'][k - 1].get('scale', 1.0) if k else 1.0
            self.build_source(*src, ramp_index, inf_index)

    def build_source(self, m, force_joint, offset, ov, ramp_index, inf_index):
        by_mat = {}
        for sh in m.shapes:
            by_mat.setdefault(sh['material'], []).extend(sh['tris'])
        for mi in sorted(by_mat):
            mat = m.materials[mi]
            o = ov.get(mat['name'], {})
            if o.get('skip'):
                continue
            tris = by_mat[mi]
            main, tg = self.main_texture(m, mat)
            if 'layer' in o:
                layer = LAYERS[o['layer']]
            elif mat['mode'] == 4 or (mat['blend'] and mat['blend_mode'][1] == 4 and mat['mode'] != 1):
                layer = 2
            elif mat['alpha_test']:
                layer = 1
            else:
                layer = 0
            tev = Tev(m, mat, main, o.get('color'))
            tev.layer = layer
            tev.tint = bool(o.get('tint'))
            frames = o.get('textures')
            if frames is None and main is not None and 'color' in o:
                # a flat colour: the texture only if asked for (keep_texture)
                frames = [m.textures[main]['image']] if o.get('keep_texture') else None
            elif frames is None and main is not None:
                # the material's own texture: baked through its TEV program at full light, the
                # vertex colours then carry only the light (and vertex colour) relative to that
                frames = [self.bake(tev, m.textures[main]['image'], o.get('max_side', self.spec.get('tex_max', 64)))]
                avg = m.textures[main]['image'].reshape(-1, 4).astype(float).mean(axis=0) / 255
                tev.main_value = avg
                tev.ratio = np.maximum(tev.eval(np.ones(4), np.ones(4), 1.0), 1 / 255)
            tinfo = None
            texnames = []
            if frames:
                for f in frames:
                    tinfo = self.tex.add(f, o.get('max_side', self.spec.get('tex_max', 64)), self.name)
                    texnames.append(tinfo[0])
            flags = 0
            cull = mat['cull'] if o.get('cull', True) else 0
            if cull == 0:
                flags |= MF_NOCULL
            elif cull == 1:
                flags |= MF_CULLFRONT
            if main is not None:
                ws, wt = m.textures[main]['wrapS'], m.textures[main]['wrapT']
                flags |= (MF_CLAMP_S if ws == 0 else MF_MIRROR_S if ws == 2 else 0)
                flags |= (MF_CLAMP_T if wt == 0 else MF_MIRROR_T if wt == 2 else 0)
            if o.get('unlit'):
                flags |= MF_UNLIT
            if tg is not None and tg[1] == 1 or o.get('envmap'):
                flags |= MF_ENVMAP  # texture coordinates from the normals: a shiny reflection
            mat_index = len(self.mats)
            if frames:
                self._tex_images[mat_index] = fit(np.ascontiguousarray(frames[0]), o.get('max_side', self.spec.get('tex_max', 64)))
            self.mats.append(dict(name=mat['name'], layer=layer, flags=flags, slot=o.get('slot', 0), tint=1 if o.get('tint') else 0,
                                  tex=tinfo, texnames=texnames))
            tw, th = (tinfo[3], tinfo[4]) if tinfo else (32, 32)

            def vkey(v):
                return (v.get(9), v.get(10), v.get(13), v.get(11), v.get(12), v['mtx'])

            # batches: greedy, triangles in order, up to MAX_BATCH distinct vertices
            batch, local = [], {}
            def flush():
                if not batch:
                    return
                first = len(self.verts)
                order = sorted(local.items(), key=lambda kv: kv[1])
                for key, _ in order:
                    self.verts.append(self.make_vertex(m, rep[key], tev, tw, th, ramp_index, inf_index, force_joint, offset))
                self.batches.append((mat_index, first, len(order), list(batch)))
            rep = {}
            for t in tris:
                keys = [vkey(v) for v in t]
                new = [k for k in dict.fromkeys(keys) if k not in local]
                if len(local) + len(new) > MAX_BATCH:
                    flush()
                    batch, local = [], {}
                    new = list(dict.fromkeys(keys))
                for k, v in zip(keys, t):
                    rep[k] = v
                for k in new:
                    local[k] = len(local)
                # GX winds front faces clockwise, the N64 counter-clockwise: turn each triangle over
                batch.append((local[keys[0]], local[keys[2]], local[keys[1]]))
            flush()

    def make_vertex(self, m, v, tev, tw, th, ramp_index, inf_index, force_joint=None, offset=(0, 0, 0)):
        uv = m.arrays[13][v[13]][:2] if 13 in v and 13 in m.arrays else (0, 0)
        u, w = int(round(uv[0] * tw * 32)), int(round(uv[1] * th * 32))
        u, w = max(-32768, min(32767, u)), max(-32768, min(32767, w))
        c0 = tuple(m.arrays[11][v[11]]) if 11 in v and 11 in m.arrays else (255, 255, 255, 255)
        c1 = tuple(m.arrays[12][v[12]]) if 12 in v and 12 in m.arrays else c0
        rkey = (id(tev), c0, c1)
        if rkey not in ramp_index:
            vc0, vc1 = np.array(c0, float) / 255, np.array(c1, float) / 255
            ramp = []
            # alpha: what the material has in full light (lit alpha channels are effects), opaque: none
            alpha = 255 if tev.layer == 0 or tev.ratio is not None else int(round(tev.eval(vc0, vc1, 1.0)[3] * 255))
            if tev.layer == 1:
                alpha = 255  # cut-outs: the texture's alpha decides
            if tev.tint and tev.layer == 0 and tev.override_color is None:
                # tinted materials (a Pianta's skin) tint only their grey parts, not the green leaves
                alpha = 255 if max(c0[:3]) - min(c0[:3]) < 40 else 254
            for k in range(RAMP):
                col = tev.eval(vc0, vc1, k / (RAMP - 1))
                if tev.ratio is not None:
                    col = np.clip(col / tev.ratio, 0, 1)
                ramp.append(tuple(int(round(x * 255)) for x in col[:3]) + (alpha,))
            ramp_index[rkey] = len(self.ramps)
            self.ramps.append(ramp)
        infl = self.vertex_influences(m, v, force_joint, offset)
        ikey = tuple((j, round(w, 4), tuple(np.round(p, 3)), tuple(np.round(n, 3))) for j, w, p, n in infl)
        if ikey not in inf_index:
            inf_index[ikey] = len(self.infs)
            self.infs.extend(infl)
        return ((u, w), ramp_index[rkey], inf_index[ikey], len(infl))

    # -- animations
    def anim_channels(self, bck):
        """Per joint 9 channel sample lists (scale xyz, rotation xyz in radians, translation xyz)."""
        m = self.m
        nj = len(m.joints)
        if bck is None:
            a, frames = None, 1
        else:
            a = j3d.JointAnim(bck)
            frames = max(1, a.length)
        chans = []
        for j in range(nj):
            js = m.joints[j]
            if a is None or j >= len(a.joints):
                s, r, t = [js['scale']], [js['rot']], [js['trans']]
                s, r, t = s * frames, r * frames, t * frames
            else:
                smp = [a.sample(j, f) for f in range(frames)]
                s, r, t = [x[0] for x in smp], [x[1] for x in smp], [x[2] for x in smp]
            if j not in self.used_joints() or js['name'] in self.spec.get('still_joints', ()):
                # an effect locator nothing hangs on (or one the game drives itself): keep it still
                s, r, t = [js['scale']] * frames, [js['rot']] * frames, [js['trans']] * frames
            for axis in range(3):
                chans.append(('s', [x[axis] for x in s]))
            for axis in range(3):
                chans.append(('r', [x[axis] for x in r]))
            for axis in range(3):
                chans.append(('t', [x[axis] * self.scale for x in t]))
        return chans, frames, (a.loop if a else 0)

    def used_joints(self):
        """Joints that move vertices, and their ancestors."""
        if getattr(self, '_used', None) is None:
            used = set()
            for j, _, _, _ in self.infs:
                while j >= 0 and j not in used:
                    used.add(j)
                    j = self.m.joints[j]['parent']
            self._used = used
        return self._used

    def emit(self, body_index, shared=None):
        """C source of the body. shared: a Character whose animations this one uses."""
        n = self.name
        out = []
        m = self.m
        nj = len(m.joints)
        for j, jt in enumerate(m.joints):
            assert jt['parent'] < j, f'{n}: joint {j} comes before its parent'
        # fixed point: positions and translations << shift
        anims = [] if shared else [(an, self.anim_channels(b)) for an, b in self.spec['anims']]
        biggest = max([abs(x) for p in self.infs for x in p[2]] + [abs(v) for _, (ch, _, _) in anims for k, vs in ch if k == 't' for v in vs] + [1])
        shift = 0
        while shift < 4 and biggest * (1 << (shift + 1)) < 30000:
            shift += 1
        if shared:
            assert len(shared.m.joints) == nj
            shift = shared.shift
        self.shift = shift
        F = 1 << shift
        # skeleton
        out.append(c_array('s8', f'sms_{n}_parents', [j['parent'] for j in m.joints]))
        out.append(c_array('u8', f'sms_{n}_ssc', [1 if j.get('ssc') else 0 for j in m.joints]))
        # materials
        for k, mt in enumerate(self.mats):
            if mt['texnames']:
                out.append(f'static const u8 *const sms_{n}_m{k}_tex[] = {{ ' + ', '.join(mt['texnames']) + ' };\n')
        rows = []
        for k, mt in enumerate(self.mats):
            t = mt['tex']
            texs = f'sms_{n}_m{k}_tex' if mt['texnames'] else 'NULL'
            fmt, siz, w, h = (t[1], t[2], t[3], t[4]) if t else (0, 0, 0, 0)
            rows.append(f'    {{ {mt["layer"]}, {mt["flags"]}, {mt["slot"]}, {mt["tint"]}, {fmt}, {siz}, {w}, {h}, {len(mt["texnames"])}, {texs} }}, /* {mt["name"]} */')
        out.append(f'static const struct SmsMaterial sms_{n}_mats[] = {{\n' + '\n'.join(rows) + '\n};\n')
        # vertices, influences, ramps
        inf_rows = []
        for j, w, p, nn in self.infs:
            ps = [max(-32768, min(32767, int(round(x * F)))) for x in p]
            ns = [max(-127, min(127, int(round(x * 127)))) for x in nn]
            inf_rows.append(f'{{ {{ {ps[0]}, {ps[1]}, {ps[2]} }}, {{ {ns[0]}, {ns[1]}, {ns[2]} }}, {j}, {max(1, min(255, int(round(w * 255))))} }}')
        out.append(c_array('struct SmsInf', f'sms_{n}_infs', inf_rows, 4))
        out.append(c_array('struct SmsVert', f'sms_{n}_verts', [f'{{ {{ {uv[0]}, {uv[1]} }}, {r}, {i}, {c} }}' for uv, r, i, c in self.verts], 6))
        out.append(f'static const u8 sms_{n}_ramps[][{RAMP}][4] = {{\n' + ',\n'.join(
            '    { ' + ', '.join(f'{{ {c[0]}, {c[1]}, {c[2]}, {c[3]} }}' for c in r) + ' }' for r in self.ramps) + ',\n};\n')
        # batches: the triangles as static display lists
        brow = []
        for k, (mi, first, count, tris) in enumerate(self.batches):
            dl = []
            for q in range(0, len(tris) - 1, 2):
                a, b = tris[q], tris[q + 1]
                dl.append(f'    gsSP2Triangles({a[0]}, {a[1]}, {a[2]}, 0, {b[0]}, {b[1]}, {b[2]}, 0),')
            if len(tris) % 2:
                a = tris[-1]
                dl.append(f'    gsSP1Triangle({a[0]}, {a[1]}, {a[2]}, 0),')
            out.append(f'static const Gfx sms_{n}_b{k}[] = {{\n' + '\n'.join(dl) + '\n    gsSPEndDisplayList(),\n};\n')
            brow.append(f'    {{ {first}, {count}, {mi}, sms_{n}_b{k} }},')
        out.append(f'static const struct SmsBatch sms_{n}_batches[] = {{\n' + '\n'.join(brow) + '\n};\n')
        # animations: SM64 Animation headers over our own channel layout (9 per joint)
        arows = []
        for an, (chans, frames, loop) in anims:
            values, index, seen = [], [], {}
            for kind, vs in chans:
                if kind == 'r':
                    q = [((int(round(v * 32768 / math.pi)) + 32768) % 65536) - 32768 for v in vs]
                elif kind == 't':
                    q = [max(-32768, min(32767, int(round(v * F)))) for v in vs]
                else:
                    # scales as half floats: some locators are scaled by 60 and more
                    q = [int(np.array([v], np.float16).view(np.int16)[0]) for v in vs]
                if all(x == q[0] for x in q):
                    q = q[:1]
                else:
                    # every other frame (the engine interpolates the odd ones), and the last one
                    q = q[::2] + ([q[-1]] if len(q) % 2 == 0 else [])
                key = tuple(q)
                if key not in seen:
                    seen[key] = len(values)
                    values += q
                index += [len(q), seen[key]]
            p = f'sms_{n}_anim_{an}'
            out.append(c_array('s16', f'{p}_values', values, 12))
            out.append(c_array('u16', f'{p}_index', index, 12))
            # ANIM_FLAG_NOLOOP when the animation plays once; ANIM_FLAG_5 keeps SM64's own code
            # (the shadow) from reading the channels as an SM64 root translation
            flags = (0 if loop == 2 else 1) | 0x20
            out.append(f'static const struct Animation {p} = {{ {flags}, 0, 0, 0, {frames}, {nj}, {p}_values, {p}_index, 0 }};\n')
            arows.append(f'    &{p},')
        if not shared:
            out.append(f'const struct Animation *const sms_{n}_anims[] = {{\n' + '\n'.join(arows) + '\n    NULL,\n};\n')
        # layers present
        layers = sorted({mt['layer'] for mt in self.mats})
        shadow = self.spec.get('shadow', 100)
        asm = '\n'.join(f'         GEO_ASM({body_index | l << 8}, geo_sms_skin),' for l in layers)
        out.append(f'const GeoLayout sms_{n}_geo[] = {{\n'
                   f'   GEO_CULLING_RADIUS({int(self.spec.get("cull_radius", 400))}),\n   GEO_OPEN_NODE(),\n'
                   f'   GEO_SHADOW(SHADOW_CIRCLE_9_VERTS, 0xB4, {shadow}),\n   GEO_OPEN_NODE(),\n'
                   f'      GEO_SCALE(0x00, {65536 >> shift}),\n      GEO_OPEN_NODE(),\n{asm}\n'
                   f'      GEO_CLOSE_NODE(),\n   GEO_CLOSE_NODE(),\n   GEO_CLOSE_NODE(),\n   GEO_END(),\n}};\n')
        self.body_row = (f'    {{ "{n}", sms_{n}_geo, {nj}, {shift}, sms_{n}_parents, sms_{n}_ssc, sms_{n}_mats, {len(self.mats)}, '
                         f'sms_{n}_batches, {len(self.batches)}, sms_{n}_verts, sms_{n}_infs, sms_{n}_ramps, sms_{shared.name if shared else n}_anims, {len(self.spec["anims"])}, {int(self.spec.get("yaw", 0)) & 0xffff:#x} }},')
        self.anim_names = [an for an, _ in self.spec['anims']]
        return '\n'.join(out)
