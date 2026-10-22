#!/usr/bin/env python3
"""Take the game's own data out of extracted Shoggoth World C (developer tool; tools/shoggoth/refresh.mjs
runs it after every extraction from the checkout).

    python3 tools/shoggoth/split_vanilla.py [--check] <package> <recipes.json> <file.c> [<file.c> ...]

(--check: change nothing, fail if any of the game's data is in the files.)

Every display list that draws triangles of a vanilla actor model (engine/actors/*/model.inc.c) and every
texture made from a vanilla actor texture (engine/actors/*/*.png, extracted from the ROM) is replaced, in
place, by an #include of engine/src/studio/romgen/<package>/<name>.inc.c, and its recipe is written to
<recipes.json>; the vertex arrays only those lists used are removed. tools/shoggoth/rom_parts.py (run by
every engine build) makes the romgen files from the recipes and the game's data again, so the result
compiles to the same model -- see tools/shoggoth/vanilla.py.

It checks itself: every rebuilt display list draws the same triangles and every rebuilt texture has the
same texels as the extracted one, or it stops.
"""
import base64
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vanilla as V  # noqa: E402

KNOWN_BASES = ['actors/toad/toad_head.rgba16.png', 'actors/toad/toad_face.rgba16.png', 'actors/goomba/goomba_face.rgba16.png',
               'actors/goomba/goomba_face_blink.rgba16.png', 'actors/goomba/goomba_body.rgba16.png']
TOL = 18.0          # how far (per channel) a recoloured texel may be from a model and still count as it


def resolve_include(cfile, inc):
    for cand in (os.path.join(os.path.dirname(cfile), os.path.basename(inc)), os.path.join(os.path.dirname(cfile), inc),
                 os.path.join(V.ENGINE, 'src', inc)):
        if os.path.exists(cand):
            return cand
    return None


class Package:
    def __init__(self, name, files):
        self.name = name
        self.files = files
        self.text = {f: open(f).read() for f in files}
        self.defs = {}
        for f, t in self.text.items():
            for n, d in V.definitions(t).items():
                d['file'] = f
                self.defs[n] = d
        self.vtx = {n: V.parse_vtx(d['body']) for n, d in self.defs.items() if d['type'] == 'Vtx'}

    def tex_bytes(self, name):
        d = self.defs[name]
        m = re.search(r'#include "([^"]+)"', d['body'])
        if m:
            if 'romgen/' in m.group(1):
                return None, None          # (made from the game's data at build time)
            p = resolve_include(d['file'], m.group(1))
            if p is None:
                return None, None
            body = open(p).read()
            if 'romgen/' in body:
                return None, None
            return V.hex_bytes(body), p
        return V.hex_bytes(d['body']), None


def tri_match(vtri, gtri):
    """The permutation p (gtri[k] is vtri[p[k]]) with the fewest changed fields, and those changes."""
    best = None
    for p in ((0, 1, 2), (1, 2, 0), (2, 0, 1), (0, 2, 1), (2, 1, 0), (1, 0, 2)):
        if any(vtri[p[k]][2][:3] != gtri[k][2][:3] for k in range(3)):
            continue
        overs = []
        for k in range(3):
            a, b = vtri[p[k]][2], gtri[k][2]
            o = {}
            if a[4:6] != b[4:6]:
                o['st'] = list(b[4:6])
            if a[6:10] != b[6:10]:
                o['c'] = list(b[6:10])
            if a[3] != b[3]:
                o['f'] = b[3]
            overs.append(o)
        cost = sum(len(o) for o in overs) + (0 if p[0] == 0 and p[1] == 1 else 0.5)
        if best is None or cost < best[0]:
            best = (cost, list(p), overs)
    return best


def split_dls(pkg, van, recipes, report):
    tindex = van.triangle_index()
    derived = {}
    for name, d in pkg.defs.items():
        if d['type'] != 'Gfx':
            continue
        cmds = V.commands(d['body'])
        if not any(c.startswith('gsSPVertex') for c in cmds):
            continue
        items, nvan, nlit, used = [], 0, 0, set()
        for kind, x in V.walk(cmds, pkg.vtx):
            if kind == 'c':
                items.append(['c', x])
                continue
            if None in x:
                raise SystemExit('%s: a triangle with an unloaded vertex' % name)
            used.update(c[0] for c in x)
            key = tuple(sorted(c[2][:3] for c in x))
            best = None
            for (vdl, vi) in tindex.get(key, []):
                m = tri_match(van.dl_triangles(vdl)[vi], x)
                if m and (best is None or m[0] < best[0]):
                    best = (m[0], vdl, vi, m[1], m[2])
            if best:
                items.append(['v', best[1], best[2], best[3], best[4]])
                nvan += 1
            else:
                items.append(['l', [list(c[2]) for c in x]])
                nlit += 1
        if nvan == 0:
            continue
        # the changes every vanilla corner shares become the list's default
        corners = [o for it in items if it[0] == 'v' for o in it[4]]
        over = {}
        for k in ('st', 'c', 'f'):
            vals = [json.dumps(o.get(k)) for o in corners]
            if vals and vals.count(vals[0]) == len(vals) and corners[0].get(k) is not None:
                over[k] = corners[0][k]
        for it in items:
            if it[0] == 'v':
                it[4] = [{k: v for k, v in o.items() if k not in over} for o in it[4]]
                if not any(it[4]):
                    it[4] = None
        derived[name] = {'name': name, 'head': d['head'], 'over': over, 'items': items, 'vtx': sorted(used)}
        report.append('  list %-52s %4d game triangles, %3d of its own' % (name, nvan, nlit))
    # vertex arrays that only derived lists load go too
    users = {}
    for name, d in pkg.defs.items():
        if d['type'] == 'Gfx' and name not in derived:
            for m in V.VERTEX_CMD.finditer(d['body']):
                users.setdefault(m.group(1), set()).add(name)
    drop = set()
    for dname, r in derived.items():
        for v in r['vtx']:
            if v in users:
                report.append('  WARNING: %s is also loaded by %s (kept)' % (v, sorted(users[v])))
            else:
                drop.add(v)
        del r['vtx']
        recipes['dls'][dname] = r
    return derived, drop


def tex_loads(pkg):
    """texture symbol -> (fmt, siz, w, h, [palette symbols]) from the display lists' loads."""
    alltext = '\n'.join(pkg.text.values())
    res = {}
    for m in re.finditer(r'gsDPLoadTextureBlock(_4b)?\(\s*(\w+),\s*G_IM_FMT_(\w+),\s*(?:G_IM_SIZ_(\d+)b,\s*)?(\d+),\s*(\d+)', alltext):
        siz = 4 if m.group(1) else int(m.group(4))
        res.setdefault(m.group(2), (m.group(3), siz, int(m.group(5)), int(m.group(6))))
    for m in re.finditer(r'gsDPSetTextureImage\(G_IM_FMT_(\w+),\s*G_IM_SIZ_(\d+)b\w*,\s*\d+,\s*(\w+)\)(.{0,600}?)gsDPLoadBlock\(G_TX_LOADTILE,\s*0,\s*0,\s*(\d+)\s*\*\s*(\d+)', alltext, re.S):
        res.setdefault(m.group(3), (m.group(1), int(m.group(2)), int(m.group(5)), int(m.group(6))))
    for m in re.finditer(r'gsDPSetTextureImage\(G_IM_FMT_(\w+),\s*G_IM_SIZ_(\d+)b\w*,\s*\d+,\s*(\w+)\)(.{0,800}?)gsDPSetTileSize\([^,]+,\s*0,\s*0,\s*\(?(\d+)\s*-\s*1\)?\s*<<\s*G_TEXTURE_IMAGE_FRAC,\s*\(?(\d+)\s*-\s*1', alltext, re.S):
        res.setdefault(m.group(3), (m.group(1), int(m.group(2)), int(m.group(5)), int(m.group(6))))
    pals = {}
    for m in re.finditer(r'gsDPLoadTLUT_pal(16|256)\(\s*\d+,\s*(\w+)\)(.{0,500}?)gsDPLoadTextureBlock(?:_4b)?\(\s*(\w+)', alltext, re.S):
        pals.setdefault(m.group(4), []).append(m.group(2))
    allpals = sorted(set(re.findall(r'gsDPLoadTLUT_pal16\(\s*\d+,\s*(\w+)\)', alltext)))
    out = {}
    for sym, (fmt, siz, w, h) in res.items():
        if sym not in pkg.defs:
            continue
        cand = pals.get(sym) or ([sym + '_pal'] if sym + '_pal' in pkg.defs else allpals)
        out[sym] = (fmt, siz, w, h, cand)
    return out


def feats(px, w, h, S=16):
    lum, val, al = [], [], []
    for y in range(S):
        for x in range(S):
            acc, cnt = [0, 0, 0, 0], 0
            for yy in range(y * h // S, max(y * h // S + 1, (y + 1) * h // S)):
                for xx in range(x * w // S, max(x * w // S + 1, (x + 1) * w // S)):
                    p = px[yy * w + xx]
                    cnt += 1
                    for k in range(4):
                        acc[k] += p[k]
            p = [a / cnt for a in acc]
            lum.append(0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2])
            val.append(max(p[:3]))
            al.append(p[3])
    return lum, val, al


def corr(a, b):
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((x - mb) ** 2 for x in b)
    if va < 1e-6 or vb < 1e-6:
        return None
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb)


_FEATS = {}


def similarity(O, Vt, w, h, vkey=None):
    lo, vo, ao = feats(O, w, h)
    if vkey is not None and vkey in _FEATS:
        lv, vv, av = _FEATS[vkey]
    else:
        lv, vv, av = feats(Vt, w, h)
        if vkey is not None:
            _FEATS[vkey] = (lv, vv, av)
    s = max(corr(lo, lv) or 0, corr(vo, vv) or 0)
    alpha_same = all((a[3] > 0) == (b[3] > 0) for a, b in zip(O, Vt)) and any(p[3] == 0 for p in Vt) and any(p[3] > 0 for p in Vt)
    return s, alpha_same


def index_similarity(idx, Vt, w, h, vkey):
    """A CI texture's indices as intensities against a game texture (any palette order: |corr|)."""
    g = [(i, i, i, 255) for i in idx]
    lo, _, _ = feats(g, w, h)
    if vkey not in _FEATS:
        _FEATS[vkey] = feats(Vt, w, h)
    lv, vv, av = _FEATS[vkey]
    return max(abs(corr(lo, lv) or 0), abs(corr(lo, vv) or 0))


def lstsq_model(pairs):
    """out_c = a_c + b_c * f over [(f, (r, g, b))]."""
    n = len(pairs)
    sf = sum(f for f, _ in pairs)
    sff = sum(f * f for f, _ in pairs)
    model = []
    det = n * sff - sf * sf
    for c in range(3):
        so = sum(o[c] for _, o in pairs)
        sfo = sum(f * o[c] for f, o in pairs)
        if abs(det) < 1e-9:
            model.append((so / n, 0.0))
        else:
            b = (n * sfo - sf * so) / det
            model.append(((so - b * sf) / n, b))
    return [model[0][0], model[1][0], model[2][0], model[0][1], model[1][1], model[2][1]]


def refine(m, pts):
    """Nudge a model so its predictions land in the same RGBA16 steps as the texels (exact rebuilds)."""
    m = list(m)
    for c in range(3):
        want = [(f, o[c] >> 3) for f, o in pts]
        def score(a, b):
            return sum(1 for f, q in want if int(round(max(0.0, min(255.0, a + b * f)))) >> 3 == q)
        best = (score(m[c], m[3 + c]), m[c], m[3 + c])
        for step in (2.0, 0.5, 0.125):
            a0, b0 = best[1], best[2]
            for da in range(-6, 7):
                for db in range(-6, 7):
                    a, b = a0 + da * step, b0 + db * step
                    sc = score(a, b)
                    if sc > best[0]:
                        best = (sc, a, b)
        m[c], m[3 + c] = best[1], best[2]
    return m


def err(model, f, o):
    p = V.predict(model, f)
    return max(abs(p[c] - o[c]) for c in range(3))


def quick_explained(O, Vt):
    """How much of O one linear recolour of Vt explains (a cheap first look)."""
    best = 0.0
    for feature in ('v', 'gb', 'lum'):
        ffn = V.FEATURES[feature]
        pts = [(ffn(p), o) for p, o in zip(Vt, O)]
        m = lstsq_model(pts)
        best = max(best, sum(1 for f, o in pts if err(m, f, o) <= TOL) / len(pts))
    return best


def fit_texture(O, Vt, fmt, pal, orig_idx):
    """The cheapest recipe (fewest literal texels) for O from the game texture Vt."""
    best = None
    for rule in ('skin', 'opaque', 'all'):
        rfn = V.RULES[rule]
        region = [i for i, p in enumerate(Vt) if rfn(p)]
        if not region:
            continue
        for feature in ('v', 'gb', 'lum'):
            ffn = V.FEATURES[feature]
            models = []
            # keep: the game's own texel; then up to three linear models, each fitted on what's left
            def unexplained():
                out = []
                for i in region:
                    o, p = O[i], Vt[i]
                    if max(abs(o[c] - p[c]) for c in range(3)) <= TOL:
                        continue
                    if any(err(m, ffn(p), o) <= TOL for m in models):
                        continue
                    out.append(i)
                return out
            left = unexplained()
            for _ in range(3):
                if len(left) < 6:
                    break
                pts = [(ffn(Vt[i]), O[i]) for i in left]
                m = lstsq_model(pts)
                for _it in range(4):          # refit on the texels it explains
                    near = [(f, o) for f, o in pts if err(m, f, o) <= TOL * 1.5]
                    if len(near) < 6:
                        break
                    m = lstsq_model(near)
                if sum(1 for f, o in pts if err(m, f, o) <= TOL) < 6:
                    break
                if fmt == 'rgba16':
                    m = refine(m, [(f, o) for f, o in pts if err(m, f, o) <= TOL])
                models.append(m)
                left = unexplained()
            codes, lit = bytearray(), []
            rset = set(region)
            for i, p in enumerate(Vt):
                if i in rset:
                    o = O[i]
                    cands = [(max(abs(o[c] - p[c]) for c in range(3)), 255)] + [(err(m, ffn(p), o), k) for k, m in enumerate(models)]
                    e, code = min(cands)
                    codes.append(code)
                    rgb = p[:3] if code == 255 else V.predict(models[code], ffn(p))
                else:
                    rgb = p[:3]
                a = p[3]
                if fmt.startswith('ci'):
                    if V.nearest(pal, rgb, a) != orig_idx[i]:
                        lit.append([i, orig_idx[i]])
                else:
                    want = V.rgba16_value(O[i])
                    if V.rgba16_value((int(round(rgb[0])), int(round(rgb[1])), int(round(rgb[2])), a)) != want:
                        lit.append([i, want])
            cand = {'rule': rule, 'feature': feature, 'models': [[round(x, 4) for x in m] for m in models],
                    'codes': base64.b64encode(bytes(codes)).decode(), 'literal': lit}
            if best is None or len(lit) < len(best['literal']):
                best = cand
    return best


def split_textures(pkg, van, recipes, report):
    loads = tex_loads(pkg)
    changed = {}
    for sym, (fmt, siz, w, h, pal_cands) in sorted(loads.items()):
        if w < 8 or h < 8 or fmt not in ('RGBA', 'CI') or (fmt == 'RGBA' and siz != 16):
            continue
        raw, incfile = pkg.tex_bytes(sym)
        if raw is None:
            continue
        n = w * h
        if fmt == 'RGBA':
            if len(raw) < n * 2:
                continue
            O, pal, idx, pal_sym = V.rgba16_decode(raw, n), None, None, None
        else:
            idx = V.ci_decode(raw, siz, n)
            pal_sym, O, best_s = None, None, -1
            own = [ps for ps in pal_cands if ps == sym + '_pal'] or (pal_cands if len(pal_cands) == 1 else [])
            if own and own[0] in pkg.defs:
                # its own palette: decoded as drawn (the general check below decides)
                pal_sym = own[0]
                pal = V.palette_decode(pkg.tex_bytes(pal_sym)[0])
                O = [pal[i] if i < len(pal) else (0, 0, 0, 0) for i in idx]
            else:
                # a palette chosen elsewhere (the crowd's caps): try the ones in use
                likely = [vrel for vrel in van.textures_of_size(w, h) if index_similarity(idx, van.texture(vrel)[2], w, h, vrel) > 0.8]
                if not likely:
                    continue
                for ps in pal_cands:
                    if ps not in pkg.defs:
                        continue
                    pb, _ = pkg.tex_bytes(ps)
                    p = V.palette_decode(pb)
                    if max(idx) >= len(p):
                        continue
                    cand = [p[i] for i in idx]
                    for vrel in likely:
                        s, _a = similarity(cand, van.texture(vrel)[2], w, h, vrel)
                        if s > best_s:
                            best_s, pal_sym, O, pal = s, ps, cand, p
            if O is None:
                continue
        scored = []
        for vrel in van.textures_of_size(w, h):
            Vt = van.texture(vrel)[2]
            s, alpha_same = similarity(O, Vt, w, h, vrel)
            scored.append((max(s, 0.99 if alpha_same else 0), vrel))
        scored.sort(reverse=True)
        known = [k for k in KNOWN_BASES if k in van.textures_of_size(w, h)]
        cands = [c for sc, c in scored if sc >= 0.85][:6]
        cands += [k for k in known if k not in cands and quick_explained(O, van.texture(k)[2]) >= 0.5]
        if not cands:
            continue
        tfmt = 'rgba16' if fmt == 'RGBA' else 'ci%d' % siz
        # the base: of the game textures it resembles (and the ones the Shoggoth kits recolour), the one that
        # explains the most texels
        r, vrel = None, None
        for cand in cands:
            rc = fit_texture(O, van.texture(cand)[2], tfmt, pal, idx)
            if r is None or len(rc['literal']) < len(r['literal']):
                r, vrel = rc, cand
        top = dict((c, sc) for sc, c in scored).get(vrel, 0)
        codes = base64.b64decode(r['codes'])
        rfn = V.RULES[r['rule']]
        lit_at = set(i for i, _ in r['literal'])
        Vb = van.texture(vrel)[2]
        uses_game = (255 in codes or any(max(abs(x) for x in m[3:]) >= 8 for m in r['models'])
                     or any(not rfn(p) and i not in lit_at for i, p in enumerate(Vb)))
        if not uses_game or len(r['literal']) > n // 2 or (top < 0.95 and len(r['literal']) > n // 10):
            if top >= 0.85:
                report.append('  (texture %s resembles %s (%.2f), but it is the hack\'s own: %d of %d texels not from it -- kept)'
                              % (sym, vrel, top, len(r['literal']), n))
            continue
        r.update({'name': sym, 'base': vrel, 'fmt': tfmt, 'w': w, 'h': h, 'palette': [list(p) for p in pal] if pal else None,
                  'palette_of': pal_sym})
        # (check: rebuilt exactly)
        rebuilt = V.build_texture(r, van)
        if rebuilt != raw[:len(rebuilt)]:
            raise SystemExit('texture %s does not rebuild exactly' % sym)
        recipes['textures'][sym] = r
        changed[sym] = incfile
        report.append('  texture %-48s from %-40s %3d x %-3d %4d of %d texels the hack\'s own (%d colour models)'
                      % (sym, vrel, w, h, len(r['literal']), n, len(r['models'])))
    return changed


def main():
    check = '--check' in sys.argv
    args = [a for a in sys.argv[1:] if a != '--check']
    if len(args) < 3:
        print(__doc__)
        sys.exit(2)
    name, rpath, files = args[0], args[1], [os.path.abspath(f) for f in args[2:]]
    van = V.Vanilla()
    pkg = Package(name, files)
    recipes = {'package': name, 'dls': {}, 'textures': {}}
    report = []
    derived, drop = split_dls(pkg, van, recipes, report)
    texs = split_textures(pkg, van, recipes, report)
    if check:
        # (the shipped files: nothing of the game's may be left in them)
        if recipes['dls'] or recipes['textures']:
            print('[%s] the game\'s data is still in the shipped files:' % name)
            for line in report:
                print(line)
            sys.exit(1)
        print('[%s] no game data in %d files' % (name, len(files)))
        return
    # check the lists: rebuilt, they draw the same triangles
    for dname, r in recipes['dls'].items():
        src = V.build_dl(r, van)
        d = V.definitions(src)
        vtx = {n: V.parse_vtx(x['body']) for n, x in d.items() if x['type'] == 'Vtx'}
        new = [t for k, t in V.walk(V.commands(d[dname]['body']), vtx) if k == 't']
        old = [t for k, t in V.walk(V.commands(pkg.defs[dname]['body']), pkg.vtx) if k == 't']
        if [tuple(c[2] for c in t) for t in new] != [tuple(c[2] for c in t) for t in old]:
            raise SystemExit('display list %s does not rebuild to the same triangles' % dname)
    inc = lambda n: '#include "studio/romgen/%s/%s.inc.c"' % (name, n)
    for f in files:
        text = pkg.text[f]
        cuts = []
        for n, d in pkg.defs.items():
            if d['file'] != f:
                continue
            if n in derived:
                cuts.append((d['start'], d['end'], inc(n) + '   // (made from the game\'s data at build time: tools/shoggoth/rom_parts.py)'))
            elif n in drop:
                cuts.append((d['start'], d['end'] + (1 if text[d['end']:d['end'] + 1] == '\n' else 0), ''))
            elif n in texs and texs[n] is None:
                cuts.append((d['start'], d['end'], d['head'] + '{\n' + inc(n) + '\n};'))
        for a, b, s in sorted(cuts, reverse=True):
            text = text[:a] + s + text[b:]
        with open(f, 'w') as fh:
            fh.write(text)
    for n, incfile in texs.items():
        if incfile:
            with open(incfile, 'w') as fh:
                fh.write(inc(n) + '\n')
    os.makedirs(os.path.dirname(os.path.abspath(rpath)), exist_ok=True)
    with open(rpath, 'w') as fh:
        json.dump(recipes, fh, separators=(',', ':'))
    print('[%s] %d display lists and %d textures made from the game\'s data at build time (%s)' % (
        name, len(recipes['dls']), len(recipes['textures']), os.path.relpath(rpath, V.ROOT)))
    for line in report:
        print(line)


if __name__ == '__main__':
    main()
