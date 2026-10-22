"""Shoggoth content without Nintendo's data: the shared parts of split_vanilla.py (developer tool) and
rom_parts.py (run by every engine build).

A few of the Shoggoth World models are built on the game's own meshes and textures: the dressed Toads
(toad_rig.py / toad_dress.py: the vanilla Toad's triangles re-lit, gear hung on his bones, his cap in new
colours), the Goomba gangsters and oni (the Goomba's feet re-lit, his face recoloured and painted on).
The repository ships everything the hack made itself and, for those pieces, only *recipes*:

  * a display list that draws vanilla triangles is stored as its own commands (lights, combiners: the
    user's) plus references to the vanilla triangles it draws ("triangle 12 of toad_seg6_dl_06007EB0",
    with the vertex fields the hack changed, e.g. UVs zeroed) -- the vertices and the triangles come
    from the game's own model files at build time;
  * a texture made from a vanilla texture is stored as the recolour (a few linear colour models and,
    per texel of the region they apply to, which one), the hack's own paint (texels that are neither
    recoloured nor the game's) and the palette -- the texels come from the textures your ROM gives
    the build (engine/actors/<actor>/*.png, extracted by sm64ex's extract_assets.py).

rom_parts.py turns the recipes into C under engine/src/studio/romgen/ (gitignored), which the shipped C
includes where the vanilla data was. Standard library only.
"""
import base64
import json
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ENGINE = os.path.join(ROOT, 'engine')
sys.path.insert(0, os.path.dirname(HERE))
import pngio  # noqa: E402  (tools/pngio.py)

VTX_RE = re.compile(r'\{\s*\{\s*\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\}\s*,\s*(-?\w+)\s*,\s*\{\s*(-?\d+)\s*,\s*(-?\d+)\s*\}\s*,'
                    r'\s*\{\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)\s*\}\s*\}\s*\}')
DEF_RE = re.compile(r'^(?P<head>(?:static\s+)?(?:const\s+)?(?:ALIGNED8\s+)?(?:static\s+)?(?:const\s+)?(?P<type>Vtx|Gfx|Texture|u8|u16)'
                    r'\s+(?P<name>\w+)\s*\[[^\]]*\]\s*=\s*)\{', re.M)
VTX_LIMIT = 32          # vertices per gsSPVertex in rebuilt lists (the renderer holds 64)


def num(s):
    return int(s, 0)


def parse_vtx(body):
    return [tuple(num(g) for g in m.groups()) for m in VTX_RE.finditer(body)]


def definitions(text):
    """name -> {type, head, start, end, body} for every top-level Vtx/Gfx/texture array (decomp layout:
    the definition ends at the first line that is '};')."""
    out = {}
    for m in DEF_RE.finditer(text):
        end = text.find('\n};', m.end())
        if end < 0:
            continue
        out[m.group('name')] = {'type': m.group('type'), 'head': m.group('head'), 'start': m.start(),
                                'end': end + 3, 'body': text[m.end():end + 1]}
    return out


def commands(body):
    """The commands of a display list body, one per line (as the decomp and the hack write them)."""
    out = []
    for line in body.split('\n'):
        s = line.strip()
        if not s or s.startswith('//'):
            continue
        out.append(s.rstrip(','))
    return out


VERTEX_CMD = re.compile(r'gsSPVertex\(\s*(\w+)(?:\s*\+\s*(\d+))?\s*,\s*(\d+)\s*,\s*(\d+)\s*\)')
TRI1 = re.compile(r'gsSP1Triangle\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\w+\s*\)')
TRI2 = re.compile(r'gsSP2Triangles\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\w+\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\w+\s*\)')


def walk(cmds, vtx_arrays):
    """Yields ('c', command) for every command but vertex loads and triangles, and ('t', (v0, v1, v2))
    for every triangle: each corner is (array, index, vertex tuple)."""
    slots = [None] * 64
    for c in cmds:
        m = VERTEX_CMD.match(c)
        if m:
            arr, off, n, at = m.group(1), int(m.group(2) or 0), int(m.group(3)), int(m.group(4))
            vs = vtx_arrays.get(arr)
            if vs is None:
                yield ('c', c)            # (a vertex array we don't know: keep the command as it is)
                continue
            for i in range(n):
                slots[at + i] = (arr, off + i, vs[off + i]) if off + i < len(vs) else None
            continue
        m = TRI2.match(c)
        if m:
            g = [int(x) for x in m.groups()]
            yield ('t', (slots[g[0]], slots[g[1]], slots[g[2]]))
            yield ('t', (slots[g[3]], slots[g[4]], slots[g[5]]))
            continue
        m = TRI1.match(c)
        if m:
            g = [int(x) for x in m.groups()]
            yield ('t', (slots[g[0]], slots[g[1]], slots[g[2]]))
            continue
        yield ('c', c)


# ---------------------------------------------------------------------------------------------- the game's data

class Vanilla:
    """The game's actor models (engine/actors/*/model.inc.c: vertices and display lists) and textures (the
    PNGs extract_assets.py makes from the ROM)."""

    def __init__(self, engine=ENGINE):
        self.engine = engine
        self._dls = None
        self._tris = None
        self._tex = {}

    def _load(self):
        self._vtx, self._dls = {}, {}
        adir = os.path.join(self.engine, 'actors')
        for actor in sorted(os.listdir(adir)):
            d = os.path.join(adir, actor)
            if not os.path.isdir(d):
                continue
            for f in sorted(os.listdir(d)):
                if not f.endswith('.c') or 'anim' in f:
                    continue
                text = open(os.path.join(d, f), errors='replace').read()
                if 'Vtx' not in text and 'Gfx' not in text:
                    continue
                for name, df in definitions(text).items():
                    if df['type'] == 'Vtx':
                        self._vtx[name] = parse_vtx(df['body'])
                    elif df['type'] == 'Gfx':
                        self._dls[name] = commands(df['body'])

    def dl_triangles(self, dl):
        """The triangles a vanilla display list draws itself (not its sub-lists'), in order."""
        if self._dls is None:
            self._load()
        return [t[1] for t in walk(self._dls[dl], self._vtx) if t[0] == 't' and None not in t[1]]

    def triangle_index(self):
        """sorted position triple -> [(dl, index)] for every vanilla actor triangle."""
        if self._tris is None:
            if self._dls is None:
                self._load()
            self._tris = {}
            for dl in self._dls:
                for i, tri in enumerate(self.dl_triangles(dl)):
                    key = tuple(sorted(c[2][:3] for c in tri))
                    self._tris.setdefault(key, []).append((dl, i))
        return self._tris

    def texture(self, rel):
        """RGBA texels [(r, g, b, a)] and the size of a game texture (a path under engine/, a PNG)."""
        if rel not in self._tex:
            w, h, rgba = pngio.read_rgba(os.path.join(self.engine, rel))
            self._tex[rel] = (w, h, [tuple(rgba[i * 4:i * 4 + 4]) for i in range(w * h)])
        return self._tex[rel]

    def textures_of_size(self, w, h):
        if not hasattr(self, '_sizes'):
            self._sizes = {}
        if (w, h) not in self._sizes:
            self._sizes[(w, h)] = self._textures_of_size(w, h)
        return self._sizes[(w, h)]

    def _textures_of_size(self, w, h):
        out = []
        adir = os.path.join(self.engine, 'actors')
        for actor in sorted(os.listdir(adir)):
            d = os.path.join(adir, actor)
            if not os.path.isdir(d):
                continue
            for f in sorted(os.listdir(d)):
                if f.endswith('.png'):
                    rel = 'actors/%s/%s' % (actor, f)
                    try:
                        tw, th, _ = self.texture(rel)
                    except Exception:
                        continue
                    if (tw, th) == (w, h):
                        out.append(rel)
        return out


# ---------------------------------------------------------------------------------------------- textures

def c5(v):
    return (v << 3) | (v >> 2)


def rgba16_decode(b, n):
    out = []
    for i in range(n):
        v = (b[2 * i] << 8) | b[2 * i + 1]
        out.append((c5(v >> 11 & 31), c5(v >> 6 & 31), c5(v >> 1 & 31), 255 if v & 1 else 0))
    return out


def rgba16_value(p):
    r, g, b, a = p
    return ((r >> 3) << 11) | ((g >> 3) << 6) | ((b >> 3) << 1) | (1 if a >= 128 else 0)


def palette_decode(b):
    return rgba16_decode(b, len(b) // 2)


def ci_decode(b, siz, n):
    if siz == 8:
        return list(b[:n])
    out = []
    for i in range(n):
        v = b[i // 2]
        out.append(v >> 4 if i % 2 == 0 else v & 15)
    return out


def ci_encode(idx, siz):
    if siz == 8:
        return bytes(idx)
    return bytes(((idx[i] & 15) << 4) | (idx[i + 1] & 15) for i in range(0, len(idx), 2))


def rgba16_encode(px):
    out = bytearray()
    for p in px:
        v = rgba16_value(p)
        out += bytes((v >> 8, v & 255))
    return bytes(out)


def c_bytes(data, per_line=16):
    lines = []
    for i in range(0, len(data), per_line):
        lines.append(''.join('0x%02X,' % b for b in data[i:i + per_line]))
    return '\n'.join(lines) + '\n'


def hex_bytes(text):
    return bytes(int(h, 16) for h in re.findall(r'0x([0-9A-Fa-f]{1,2})\b', text))


# features of a vanilla texel the recolours are linear in (charkit.py / toad_dress.py use these)
FEATURES = {
    'v': lambda p: max(p[0], p[1], p[2]) / 255.0,                 # HSV value (the Goomba skin recolours)
    'gb': lambda p: (p[1] + p[2]) / 510.0,                         # toad_dress.cap_texture: white .. the spot
    'lum': lambda p: (p[0] + p[1] + p[2]) / 765.0,                 # the tiger sprite
}


def is_skin(p):
    """charkit.is_skin: a Goomba-skin (brown) texel of the vanilla face."""
    r, g, b = p[0] / 255.0, p[1] / 255.0, p[2] / 255.0
    mx, mn = max(r, g, b), min(r, g, b)
    v = mx
    s = 0.0 if mx == 0 else (mx - mn) / mx
    if mx == mn:
        h = 0.0
    elif mx == r:
        h = ((g - b) / (mx - mn)) % 6 / 6.0
    elif mx == g:
        h = ((b - r) / (mx - mn) + 2) / 6.0
    else:
        h = ((r - g) / (mx - mn) + 4) / 6.0
    return h <= 0.14 and s > 0.35 and v > 0.12


RULES = {
    'all': lambda p: True,
    'opaque': lambda p: p[3] > 0,
    'skin': is_skin,
}


def predict(model, f):
    return tuple(max(0.0, min(255.0, model[c] + model[3 + c] * f)) for c in range(3))


def nearest(pal, rgb, alpha):
    best, bi = None, 0
    for i, q in enumerate(pal):
        d = (q[0] - rgb[0]) ** 2 + (q[1] - rgb[1]) ** 2 + (q[2] - rgb[2]) ** 2 + (0 if (q[3] > 0) == (alpha > 0) else 1e7)
        if best is None or d < best:
            best, bi = d, i
    return bi


def build_texture(recipe, vanilla):
    """A texture's bytes from its recipe and the game's texture (rom_parts.py)."""
    w, h, V = vanilla.texture(recipe['base'])
    assert (w, h) == (recipe['w'], recipe['h']), 'the game texture %s is %dx%d' % (recipe['base'], w, h)
    rule, feat = RULES[recipe['rule']], FEATURES[recipe['feature']]
    models = recipe['models']
    codes = base64.b64decode(recipe['codes'])
    lit = {i: v for i, v in recipe['literal']}
    fmt = recipe['fmt']
    pal = [tuple(p) for p in recipe['palette']] if fmt.startswith('ci') else None
    out, k = [], 0
    for i, p in enumerate(V):
        if rule(p):
            code = codes[k]
            k += 1
            rgb, a = (p[:3], p[3]) if code == 255 else (predict(models[code], feat(p)), p[3])
        else:
            rgb, a = p[:3], p[3]
        if i in lit:
            out.append(lit[i])
        elif pal is not None:
            out.append(nearest(pal, rgb, a))
        else:
            out.append(rgba16_value((int(round(rgb[0])), int(round(rgb[1])), int(round(rgb[2])), a)))
    if fmt.startswith('ci'):
        return ci_encode(out, int(fmt[2:]))
    return b''.join(bytes((v >> 8, v & 255)) for v in out)


# ---------------------------------------------------------------------------------------------- display lists

def vtx_c(v):
    x, y, z, flag, s, t, a, b, c, d = v
    return '    {{{%6d, %6d, %6d}, %d, {%6d, %6d}, {0x%02x, 0x%02x, 0x%02x, 0x%02x}}},' % (x, y, z, flag, s, t, a & 255, b & 255, c & 255, d & 255)


def corner_of(vanilla_corner, over):
    v = list(vanilla_corner)
    for k, val in over.items():
        if k == 'st':
            v[4], v[5] = val
        elif k == 'c':
            v[6:10] = val
        elif k == 'f':
            v[3] = val
    return tuple(v)


def build_dl(recipe, vanilla):
    """The C of a display list from its recipe: vertex arrays and the list (rom_parts.py)."""
    name = recipe['name']
    defaults = recipe.get('over', {})
    lines, vtx_src, nv = [], [], 0
    batch, idx = [], {}

    def flush():
        nonlocal nv
        if not batch:
            return
        vname = '%s_rv%d' % (name, nv)
        nv += 1
        vtx_src.append('static const Vtx %s[] = {' % vname)
        for v in sorted(idx, key=lambda k: idx[k]):
            vtx_src.append(vtx_c(v))
        vtx_src.append('};')
        lines.append('    gsSPVertex(%s, %d, 0),' % (vname, len(idx)))
        for i in range(0, len(batch), 2):
            if i + 1 < len(batch):
                lines.append('    gsSP2Triangles(%d, %d, %d, 0x0, %d, %d, %d, 0x0),' % (batch[i] + batch[i + 1]))
            else:
                lines.append('    gsSP1Triangle(%d, %d, %d, 0x0),' % batch[i])
        batch.clear()
        idx.clear()

    cache = {}
    for item in recipe['items']:
        if item[0] == 'c':
            flush()
            lines.append('    %s,' % item[1])
            continue
        if item[0] == 'v':
            _, dl, ti, perm, overs = item
            if dl not in cache:
                cache[dl] = vanilla.dl_triangles(dl)
            tri = cache[dl][ti]
            vs = []
            for k in range(3):
                o = dict(defaults)
                o.update(overs[k] if overs else {})
                vs.append(corner_of(tri[perm[k]][2], o))
        else:
            vs = [tuple(v) for v in item[1]]
        new = [v for v in dict.fromkeys(vs) if v not in idx]
        if len(idx) + len(new) > VTX_LIMIT:
            flush()
        for v in vs:
            if v not in idx:
                idx[v] = len(idx)
        batch.append(tuple(idx[v] for v in vs))
    flush()
    return '\n'.join(vtx_src + ['', '%s{' % recipe['head']] + lines + ['};', ''])


def load_recipes(path):
    with open(path) as f:
        return json.load(f)
