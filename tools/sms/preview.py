#!/usr/bin/env python3
"""Quick look at a J3D model in bind pose: flat triangles textured at their centroid."""
import sys, math
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, __file__.rsplit('/', 1)[0])
import j3d


def render(model, size=512, yaw=0.5, pitch=0.25, posed=None, look=None):
    tris = []
    for sh in model.shapes:
        mat = model.materials[sh['material']] if sh['material'] < len(model.materials) else None
        tex = model.textures[mat['texture']]['image'] if mat and mat['texture'] is not None and mat['texture'] < len(model.textures) else None
        over = (look or {}).get(mat['name'] if mat else '')
        if over:
            tex = over.get('texture', tex)
            if over.get('notex'):
                tex = None
            mat = {**mat, 'color': over.get('color', mat['color'])}
        for t in sh['tris']:
            ps, cs = [], []
            for v in t:
                p, n, w = model.vertex_world(v)
                if posed is not None:
                    p = posed(p, w)
                ps.append(p)
            uv = None
            if 13 in t[0] and 13 in model.arrays:
                uv = np.mean([model.arrays[13][v[13]][:2] for v in t], axis=0)
            col = np.array(mat['color'][:3] if mat else (200, 200, 200), float)
            if tex is not None and uv is not None:
                h, w_ = tex.shape[:2]
                x, y = int(uv[0] * w_) % w_, int(uv[1] * h) % h
                c = tex[y, x]
                if c[3] < 40:
                    continue
                col = col * c[:3] / 255.0
            if 11 in t[0] and 11 in model.arrays and not look:
                col = col * np.mean([model.arrays[11][v[11]][:3] for v in t], axis=0) / 255.0
            tris.append((np.array(ps), col))
    allp = np.concatenate([t[0] for t in tris])
    center = (allp.max(0) + allp.min(0)) / 2
    rad = np.abs(allp - center).max()
    cy, sy, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    R = np.array([[cy, 0, -sy], [0, 1, 0], [sy, 0, cy]])
    P = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]]) @ R
    light = np.array([0.4, 0.8, 0.45]); light /= np.linalg.norm(light)
    img = Image.new('RGB', (size, size), (40, 44, 52))
    dr = ImageDraw.Draw(img)
    proj = []
    for ps, col in tris:
        q = (ps - center) @ P.T
        n = np.cross(ps[1] - ps[0], ps[2] - ps[0]); ln = np.linalg.norm(n)
        shade = 0.45 + 0.55 * abs(n @ light) / ln if ln > 0 else 1
        proj.append((q[:, 2].mean(), q, np.clip(col * shade, 0, 255)))
    proj.sort(key=lambda x: x[0])
    for _, q, col in proj:
        pts = [(size / 2 + x / rad * size * 0.45, size / 2 - y / rad * size * 0.45) for x, y, z in q]
        dr.polygon(pts, fill=tuple(int(c) for c in col))
    return img


if __name__ == '__main__':
    m = j3d.Model(open(sys.argv[1], 'rb').read())
    print(len(m.joints), 'joints', len(m.shapes), 'shapes', sum(len(s['tris']) for s in m.shapes), 'tris', len(m.materials), 'materials', len(m.textures), 'textures')
    print([j['name'] for j in m.joints])
    print([(t['name'], t['format'], t['width'], t['height']) for t in m.textures])
    imgs = [render(m, 400, yaw) for yaw in (0, 1.2, 3.14)]
    out = Image.new('RGB', (1200, 400))
    for i, im in enumerate(imgs):
        out.paste(im, (i * 400, 0))
    out.save(sys.argv[2])


# ---- converted characters ----------------------------------------------------------------

def pose_character(ch, anim=0, frame=0):
    """Model-space 3x4 joint matrices of a converted character (character.Character) at a frame,
    computed the way engine/src/studio/sms/sms_models.c does it."""
    chans, frames, _ = ch.anim_channels(ch.spec['anims'][anim][1])
    frame = min(frame, frames - 1)
    world, scales = [], []
    for j, jt in enumerate(ch.m.joints):
        c = [chans[j * 9 + k][1][frame] for k in range(9)]
        s, r, t = c[0:3], c[3:6], c[6:9]
        l = np.eye(4)
        l[:3, :3] = j3d.euler_matrix(*r) @ np.diag(s)
        l[:3, 3] = t
        scales.append(s)
        p = jt['parent']
        if p < 0:
            world.append(l)
            continue
        pm = world[p].copy()
        if jt.get('ssc'):
            pm[:3, :3] = pm[:3, :3] @ np.diag([1 / (x or 1) for x in scales[p]])
        world.append(pm @ l)
    return world


def render_character(ch, anim=0, frame=0, size=400, yaw=0.5, pitch=0.25, light=(0.35, 0.8, 0.5)):
    """The converted data drawn like the engine draws it: skinned, ramp-lit, textured."""
    world = pose_character(ch, anim, frame)
    lv = np.array(light) / np.linalg.norm(light)
    pos, col = [], []
    for uv, ramp, inf, cnt in ch.verts:
        p, n, wsum = np.zeros(3), np.zeros(3), 0
        for j, w, ip, inn in ch.infs[inf:inf + cnt]:
            p += w * (world[j][:3, :3] @ ip + world[j][:3, 3])
            n += w * (world[j][:3, :3] @ inn)
            wsum += w
        pos.append(p / wsum)
        col.append((n / (np.linalg.norm(n) or 1), ramp, uv))
    cy, sy, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    R = np.array([[cy, 0, -sy], [0, 1, 0], [sy, 0, cy]])
    P = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]]) @ R
    lm = P.T @ lv  # light in model space (light given in view space)
    allp = np.array(pos)
    center = (allp.max(0) + allp.min(0)) / 2
    rad = np.abs(allp - center).max() or 1
    img = Image.new('RGB', (size, size), (40, 44, 52))
    dr = ImageDraw.Draw(img)
    polys = []
    tex_cache = {}
    for mi, first, count, tris in ch.batches:
        mat = ch.mats[mi]
        for a, b, c in tris:
            ids = [first + a, first + b, first + c]
            ps = np.array([pos[i] for i in ids])
            q = (ps - center) @ P.T
            # back faces (counter-clockwise front, like the N64)
            area = (q[1, 0] - q[0, 0]) * (q[2, 1] - q[0, 1]) - (q[2, 0] - q[0, 0]) * (q[1, 1] - q[0, 1])
            if area < 0 and not (mat['flags'] & 1):
                continue
            rgb = np.zeros(3)
            for i in ids:
                n, ramp, uv = col[i]
                d = max(0.0, float(n @ lm))
                t = d * 4
                k = min(3, int(t))
                r0, r1 = np.array(ch.ramps[ramp][k][:3], float), np.array(ch.ramps[ramp][k + 1][:3], float)
                rgb += r0 + (r1 - r0) * (t - k)
            rgb /= 3
            if mat['tex'] is not None and mat['texnames']:
                uv = np.mean([col[i][2] for i in ids], axis=0) / 32
                w, h = mat['tex'][3], mat['tex'][4]
                img_t = tex_cache.get(mi)
                if img_t is None:
                    img_t = tex_cache[mi] = ch._tex_images[mi]
                th, tw = img_t.shape[:2]
                x, y = int(uv[0] * tw / w) % tw, int(uv[1] * th / h) % th
                texel = img_t[y, x]
                if texel[3] < 100 and mat['layer'] > 0:
                    continue
                rgb = rgb * texel[:3] / 255
            polys.append((q[:, 2].mean(), q, rgb))
    polys.sort(key=lambda x: x[0])
    for _, q, rgb in polys:
        pts = [(size / 2 + x / rad * size * 0.45, size / 2 - y / rad * size * 0.45) for x, y, z in q]
        dr.polygon(pts, fill=tuple(int(min(255, c)) for c in rgb))
    return img


def render_character_px(ch, anim=0, frame=0, size=320, yaw=0.5, pitch=0.25, light=(0.35, 0.8, 0.5), bg=(40, 44, 52)):
    """Per-pixel version of render_character (z-buffer, textures sampled per pixel with the
    material's clamp/mirror/wrap modes, cut-out alpha): the closest look at the converted data."""
    world = pose_character(ch, anim, frame)
    lv = np.array(light) / np.linalg.norm(light)
    pos, nrm = [], []
    for uv, ramp, inf, cnt in ch.verts:
        p, n, wsum = np.zeros(3), np.zeros(3), 0
        for j, w, ip, inn in ch.infs[inf:inf + cnt]:
            p += w * (world[j][:3, :3] @ ip + world[j][:3, 3])
            n += w * (world[j][:3, :3] @ inn)
            wsum += w
        pos.append(p / wsum)
        nrm.append(n / (np.linalg.norm(n) or 1))
    pos, nrm = np.array(pos), np.array(nrm)
    cy, sy, cp, sp = math.cos(yaw), math.sin(yaw), math.cos(pitch), math.sin(pitch)
    R = np.array([[cy, 0, -sy], [0, 1, 0], [sy, 0, cy]])
    P = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]]) @ R
    lm = P.T @ lv
    center = (pos.max(0) + pos.min(0)) / 2
    rad = np.abs(pos - center).max() or 1
    q = (pos - center) @ P.T
    sx = size / 2 + q[:, 0] / rad * size * 0.45
    sy_ = size / 2 - q[:, 1] / rad * size * 0.45
    col = np.zeros((size, size, 3)) + np.array(bg)
    zbuf = np.full((size, size), -1e9)
    # vertex colours from the ramps
    vcol = np.zeros((len(pos), 4))
    for i, (uv, ramp, inf, cnt) in enumerate(ch.verts):
        d = max(0.0, float(nrm[i] @ lm)) * (len(ch.ramps[ramp]) - 1)
        k = min(len(ch.ramps[ramp]) - 2, int(d))
        r0, r1 = np.array(ch.ramps[ramp][k], float), np.array(ch.ramps[ramp][k + 1], float)
        vcol[i] = r0 + (r1 - r0) * (d - k)
    order = sorted(range(len(ch.batches)), key=lambda b: ch.mats[ch.batches[b][0]]['layer'])
    for bi in order:
        mi, first, count, tris = ch.batches[bi]
        mat = ch.mats[mi]
        img = ch._tex_images.get(mi) if mat['texnames'] else None
        for a, b, c in tris:
            ids = [first + a, first + b, first + c]
            xs, ys = sx[ids], sy_[ids]
            area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0])
            if area == 0 or (area > 0 and not (mat['flags'] & 1)):  # screen y is down: front faces have area < 0
                continue
            x0, x1 = max(0, int(xs.min())), min(size - 1, int(xs.max()) + 1)
            y0, y1 = max(0, int(ys.min())), min(size - 1, int(ys.max()) + 1)
            if x1 < x0 or y1 < y0:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            w0 = ((xs[1] - gx) * (ys[2] - gy) - (xs[2] - gx) * (ys[1] - gy)) / area
            w1 = ((xs[2] - gx) * (ys[0] - gy) - (xs[0] - gx) * (ys[2] - gy)) / area
            w2 = 1 - w0 - w1
            inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            if not inside.any():
                continue
            z = w0 * q[ids[0], 2] + w1 * q[ids[1], 2] + w2 * q[ids[2], 2]
            c = w0[..., None] * vcol[ids[0]] + w1[..., None] * vcol[ids[1]] + w2[..., None] * vcol[ids[2]]
            if img is not None:
                th, tw = img.shape[:2]
                uv = np.array([ch.verts[i][0] for i in ids], float) / 32
                u = (w0 * uv[0, 0] + w1 * uv[1, 0] + w2 * uv[2, 0]) * tw / mat['tex'][3]
                v = (w0 * uv[0, 1] + w1 * uv[1, 1] + w2 * uv[2, 1]) * th / mat['tex'][4]
                def address(t, n, clamp, mirror):
                    t = np.floor(t).astype(int)
                    if clamp:
                        return np.clip(t, 0, n - 1)
                    if mirror:
                        t = np.mod(t, 2 * n)
                        return np.where(t >= n, 2 * n - 1 - t, t)
                    return np.mod(t, n)
                ui = address(u, tw, mat['flags'] & 4, mat['flags'] & 16)
                vi = address(v, th, mat['flags'] & 8, mat['flags'] & 32)
                tex = img[vi, ui].astype(float)
                if mat['layer'] == 1:
                    inside &= tex[..., 3] >= 128
                c = c.copy()
                c[..., :3] = c[..., :3] * tex[..., :3] / 255
                c[..., 3] = c[..., 3] * tex[..., 3] / 255
            sub = zbuf[y0:y1 + 1, x0:x1 + 1]
            vis = inside & (z > sub)
            if mat['layer'] >= 2:
                a = (c[..., 3] / 255)[..., None]
                dst = col[y0:y1 + 1, x0:x1 + 1]
                dst[vis] = (dst * (1 - a) + c[..., :3] * a)[vis]
            else:
                col[y0:y1 + 1, x0:x1 + 1][vis] = c[..., :3][vis]
                sub[vis] = z[vis]
    return Image.fromarray(col.clip(0, 255).astype(np.uint8))
