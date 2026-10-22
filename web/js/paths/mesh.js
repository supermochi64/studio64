// Roads & nature: a small mesh builder for the engine's model slots (src/studio/assets.c).
// Triangles are oriented by the normal they should face, shaded like the game's own geometry
// (lit from above, AO from the vertex colours) and uploaded with their collision.

import { shadeOf } from '../asset_mesh.js';

export const SURF = { normal: 0x0000, not_slippery: 0x0015, slippery: 0x0014, hard: 0x0030 };

// material flags (studio_assets.h)
export const MAT = { OPAQUE: 0, CUTOUT: 1, BLEND: 2, DOUBLE: 4, UNLIT: 128, CLAMP_S: 2 << 3, CLAMP_T: 2 << 5 };

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// A vertex: p position, uv, c colour multiplier [r, g, b] (255 = the texture as it is), a alpha,
// n optional normal for smooth shading (otherwise the triangle's own normal shades it).
export const V = (p, uv = [0, 0], c = [255, 255, 255], a = 255, n = null) => ({ p, uv, c, a, n });

export class Mesh {
  constructor() {
    this.mats = new Map(); // key -> { tex, flags, data: number[] }
    this.col = [];          // collision: 9 numbers per triangle
    this.colTypes = [];
    this.tris = 0;
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
  }

  // A material: tex = { w, h, rgba } or null (vertex colours only).
  mat(key, tex = null, flags = 0) {
    if (!this.mats.has(key)) this.mats.set(key, { tex, flags, data: [] });
    return key;
  }

  // One triangle. `face`: the direction it should face (flipped if the winding disagrees);
  // null keeps the winding. `lit`: shade by the normal (false: flat colours as given).
  tri(key, a, b, c, face = null, lit = true) {
    const m = this.mats.get(key);
    if (!m) throw new Error(`no material ${key}`);
    let nrm = cross(sub(b.p, a.p), sub(c.p, a.p));
    if (face && nrm[0] * face[0] + nrm[1] * face[1] + nrm[2] * face[2] < 0) { const t = b; b = c; c = t; nrm = [-nrm[0], -nrm[1], -nrm[2]]; }
    const L = Math.hypot(nrm[0], nrm[1], nrm[2]);
    if (L < 1e-6) return;
    const fs = lit ? shadeOf(nrm[0] / L, nrm[1] / L, nrm[2] / L) : 1;
    for (const v of [a, b, c]) {
      const sh = lit && v.n ? shadeOf(v.n[0], v.n[1], v.n[2]) : fs;
      m.data.push(v.p[0], v.p[1], v.p[2], v.uv[0], v.uv[1],
        Math.min(255, v.c[0] * sh), Math.min(255, v.c[1] * sh), Math.min(255, v.c[2] * sh), v.a ?? 255);
      for (let k = 0; k < 3; k++) { if (v.p[k] < this.min[k]) this.min[k] = v.p[k]; if (v.p[k] > this.max[k]) this.max[k] = v.p[k]; }
    }
    this.tris++;
  }

  // A quad a-b-c-d (in order around it).
  quad(key, a, b, c, d, face = null, lit = true) {
    this.tri(key, a, b, c, face, lit);
    this.tri(key, a, c, d, face, lit);
  }

  // Collision triangle facing `face` (floors: up; walls: outward).
  colTri(a, b, c, type = 0, face = null) {
    let n = cross(sub(b, a), sub(c, a));
    if (face && n[0] * face[0] + n[1] * face[1] + n[2] * face[2] < 0) { const t = b; b = c; c = t; n = [-n[0], -n[1], -n[2]]; }
    const q = [...a, ...b, ...c].map((v) => Math.round(v));
    const ax = q[3] - q[0], ay = q[4] - q[1], az = q[5] - q[2], bx = q[6] - q[0], by = q[7] - q[1], bz = q[8] - q[2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    if (nx * nx + ny * ny + nz * nz < 4) return; // degenerate after rounding: the game divides by it
    this.col.push(...q);
    this.colTypes.push(type);
  }
  colQuad(a, b, c, d, type = 0, face = null) { this.colTri(a, b, c, type, face); this.colTri(a, c, d, type, face); }
  // A wall Mario bumps into from both sides: a thin slab. (Two walls in the same plane facing
  // opposite ways push him through: SM64 resolves a wall within his radius on either side.)
  colWall(a, b, c, d, type = 0, thick = 18) {
    let n = cross(sub(b, a), sub(c, a));
    n = [n[0], 0, n[2]];
    const L = Math.hypot(n[0], n[2]) || 1;
    const o = [(n[0] / L) * thick / 2, 0, (n[2] / L) * thick / 2];
    const off = (p, k) => [p[0] + o[0] * k, p[1], p[2] + o[2] * k];
    this.colQuad(off(a, 1), off(b, 1), off(c, 1), off(d, 1), type, o);
    this.colQuad(off(a, -1), off(b, -1), off(c, -1), off(d, -1), type, [-o[0], 0, -o[2]]);
    // the ends, so he can't slip in sideways
    for (const [p, q] of [[a, d], [b, c]]) {
      const e = sub(p === a ? a : b, p === a ? b : a);
      this.colQuad(off(p, 1), off(p, -1), off(q, -1), off(q, 1), type, [e[0], 0, e[2]]);
    }
  }

  empty() { return this.tris === 0 && this.colTypes.length === 0; }
  center() {
    if (this.min[0] > this.max[0]) return [0, 0, 0];
    return [Math.round((this.min[0] + this.max[0]) / 2), Math.round((this.min[1] + this.max[1]) / 2), Math.round((this.min[2] + this.max[2]) / 2)];
  }

  // Into engine model `slot`, positions relative to `origin`. Returns the triangles drawn.
  upload(engine, slot, origin) {
    const M = engine.M;
    if (!M._studio_model_begin(slot)) throw new Error('no model slot');
    const [ox, oy, oz] = origin;
    let drawn = 0;
    for (const m of this.mats.values()) {
      if (!m.data.length) continue;
      let tp = 0;
      if (m.tex) { tp = M._malloc(m.tex.rgba.length); M.HEAPU8.set(m.tex.rgba, tp); }
      const mi = M._studio_model_material(slot, tp, m.tex ? m.tex.w : 0, m.tex ? m.tex.h : 0, m.flags);
      if (tp) M._free(tp);
      if (mi < 0) continue;
      const n = m.data.length / 27;
      const buf = new Float32Array(m.data);
      for (let i = 0; i < buf.length; i += 9) { buf[i] -= ox; buf[i + 1] -= oy; buf[i + 2] -= oz; }
      const p = M._malloc(buf.byteLength);
      new Float32Array(M.HEAPU8.buffer, p, buf.length).set(buf);
      M._studio_model_tris(slot, mi, p, n);
      M._free(p);
      drawn += n;
    }
    if (this.colTypes.length) {
      const c = this.col.slice();
      for (let i = 0; i < c.length; i += 3) { c[i] -= ox; c[i + 1] -= oy; c[i + 2] -= oz; }
      const tp = M._malloc(c.length * 2), yp = M._malloc(this.colTypes.length * 2);
      new Int16Array(M.HEAPU8.buffer, tp, c.length).set(c);
      new Int16Array(M.HEAPU8.buffer, yp, this.colTypes.length).set(this.colTypes);
      M._studio_model_collision(slot, tp, yp, this.colTypes.length);
      M._free(tp); M._free(yp);
    }
    M._studio_model_end(slot);
    return drawn;
  }
}

// ---- shapes ---------------------------------------------------------------------------------

// An axis-aligned or rotated box from 8 corners: bottom a b c d, top e f g h (counter-clockwise from
// above). Faces get their own shade; `uvScale` units per texture repeat.
export function box(mesh, key, corners, { col = [255, 255, 255], uvScale = 64, bottom = false, sides = [1, 1, 1, 1], top = true, topCol = null } = {}) {
  const [a, b, c, d, e, f, g, h] = corners;
  const cen = corners.reduce((s, p) => [s[0] + p[0] / 8, s[1] + p[1] / 8, s[2] + p[2] / 8], [0, 0, 0]);
  const face = (p, q, r, s, tint) => {
    const mid = [(p[0] + q[0] + r[0] + s[0]) / 4, (p[1] + q[1] + r[1] + s[1]) / 4, (p[2] + q[2] + r[2] + s[2]) / 4];
    const out = sub(mid, cen);
    const w = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / uvScale, hh = Math.hypot(s[0] - p[0], s[1] - p[1], s[2] - p[2]) / uvScale;
    mesh.quad(key, V(p, [0, hh], tint), V(q, [w, hh], tint), V(r, [w, 0], tint), V(s, [0, 0], tint), out);
  };
  const sideList = [[a, b, f, e], [b, c, g, f], [c, d, h, g], [d, a, e, h]];
  sideList.forEach((sd, i) => { if (sides[i]) face(sd[0], sd[1], sd[2], sd[3], col); });
  if (top) face(e, f, g, h, topCol || col);
  if (bottom) face(a, d, c, b, col);
}

// A box around a segment p0 -> p1 (ground plane direction), half width hw, from y0 to y1 at each end.
export function segBox(p0, p1, hw, h0, h1, lift0 = 0, lift1 = 0) {
  const dx = p1[0] - p0[0], dz = p1[2] - p0[2], L = Math.hypot(dx, dz) || 1;
  const rx = (-dz / L) * hw, rz = (dx / L) * hw;
  const y00 = p0[1] + lift0, y10 = p1[1] + lift1;
  return [
    [p0[0] - rx, y00, p0[2] - rz], [p1[0] - rx, y10, p1[2] - rz], [p1[0] + rx, y10, p1[2] + rz], [p0[0] + rx, y00, p0[2] + rz],
    [p0[0] - rx, y00 + h0, p0[2] - rz], [p1[0] - rx, y10 + h1, p1[2] - rz], [p1[0] + rx, y10 + h1, p1[2] + rz], [p0[0] + rx, y00 + h0, p0[2] + rz],
  ];
}

// An upright prism (n sides) at base [x, y, z], radius r0 -> r1, height h. Smooth side shading.
export function prism(mesh, key, base, { n = 6, r0 = 20, r1 = 15, h = 100, col = [255, 255, 255], topCol = null, uvScale = 64, cap = true, rot = 0, lean = [0, 0] } = {}) {
  const [x, y, z] = base;
  const ring = (r, yy, dx, dz) => Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2;
    return [x + dx + Math.cos(a) * r, yy, z + dz + Math.sin(a) * r];
  });
  const lo = ring(r0, y, 0, 0), hi = ring(r1, y + h, lean[0], lean[1]);
  const circ = 2 * Math.PI * Math.max(r0, r1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a0 = rot + (i / n) * Math.PI * 2, a1 = rot + (j / n) * Math.PI * 2;
    const n0 = [Math.cos(a0), 0.15, Math.sin(a0)], n1 = [Math.cos(a1), 0.15, Math.sin(a1)];
    const u0 = (i / n) * circ / uvScale, u1 = ((i + 1) / n) * circ / uvScale, vh = h / uvScale;
    mesh.quad(key, V(lo[i], [u0, vh], col, 255, n0), V(lo[j], [u1, vh], col, 255, n1), V(hi[j], [u1, 0], col, 255, n1), V(hi[i], [u0, 0], col, 255, n0),
      [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)]);
  }
  if (cap && r1 > 0.5) {
    const c = [x + lean[0], y + h, z + lean[1]];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      mesh.tri(key, V(c, [0.5, 0.5], topCol || col), V(hi[i], [0.5 + Math.cos((i / n) * 6.28) / 2, 0.5], topCol || col), V(hi[j], [0.5, 0.5 + Math.sin((j / n) * 6.28) / 2], topCol || col), [0, 1, 0]);
    }
  }
  return { lo, hi };
}

// A low-poly ellipsoid blob (lat-long), smooth shaded, with optional per-vertex jitter.
export function blob(mesh, key, center, { rx = 100, ry = 80, rz = 100, seg = 6, rings = 4, col = [255, 255, 255], jitter = 0, rand = Math.random, uvScale = 80, bottomShade = 0.62, flatBottom = false } = {}) {
  const [cx, cy, cz] = center;
  const pts = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI; // 0 top .. pi bottom
    const row = [];
    for (let s = 0; s < seg; s++) {
      const th = (s / seg) * Math.PI * 2 + (r % 2) * (Math.PI / seg);
      let nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
      if (flatBottom && ny < -0.2) ny = -0.2;
      const j = r === 0 || r === rings ? 0 : 1 + (rand() - 0.5) * jitter;
      row.push({ p: [cx + nx * rx * j, cy + ny * ry * j, cz + nz * rz * j], n: [nx, ny, nz], uv: [(s / seg) * (2 * Math.PI * rx) / uvScale, (r / rings) * (Math.PI * ry) / uvScale] });
    }
    pts.push(row);
  }
  // darker toward the bottom: soft ambient occlusion like SM64's baked trees
  const shadeAt = (ny) => { const t = (ny + 1) / 2; return bottomShade + (1 - bottomShade) * t; };
  const vtx = (q) => { const k = shadeAt(q.n[1]); return V(q.p, q.uv, [col[0] * k, col[1] * k, col[2] * k], 255, q.n); };
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < seg; s++) {
      const s1 = (s + 1) % seg;
      const a = pts[r][s], b = pts[r][s1], c = pts[r + 1][s1], d = pts[r + 1][s];
      const out = [(a.n[0] + c.n[0]) / 2, (a.n[1] + c.n[1]) / 2, (a.n[2] + c.n[2]) / 2];
      if (r === 0) mesh.tri(key, vtx(a), vtx(c), vtx(d), out);
      else if (r === rings - 1) mesh.tri(key, vtx(a), vtx(b), vtx(c), out);
      else mesh.quad(key, vtx(a), vtx(b), vtx(c), vtx(d), out);
    }
  }
}

// Crossed quads (a billboard you can walk around): `count` planes through the base point.
export function crossed(mesh, key, base, { w = 60, h = 80, count = 2, rot = 0, col = [255, 255, 255], tilt = [0, 0], topCol = null } = {}) {
  const [x, y, z] = base;
  for (let k = 0; k < count; k++) {
    const a = rot + (k / count) * Math.PI;
    const dx = Math.cos(a) * w / 2, dz = Math.sin(a) * w / 2;
    const tx = tilt[0] * h, tz = tilt[1] * h;
    const tc = topCol || col;
    mesh.quad(key, V([x - dx, y, z - dz], [0, 1], col), V([x + dx, y, z + dz], [1, 1], col), V([x + dx + tx, y + h, z + dz + tz], [1, 0], tc), V([x - dx + tx, y + h, z - dz + tz], [0, 0], tc), null);
  }
}
