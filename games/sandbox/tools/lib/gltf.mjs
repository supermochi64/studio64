// A small glTF 2.0 (.glb) writer for Tiny3D's importer (gltf_to_t3d). Every material carries the
// fast64 "f3d_mat" extras the importer reads, so the models we make go through the same pipeline
// as models made in Blender with fast64: a modder can replace any of them with their own .glb.
//
//   const g = new Gltf();
//   const m = g.material('asphalt', { tex: 'asphalt.png' });
//   const b = new MeshBuilder();
//   b.quad(m, [p0, p1, p2, p3], { color, uv: [[0,0],[4,0],[4,1],[0,1]] });
//   g.mesh('road', b);
//   g.save('assets/road.glb');
//
// Units are meters; the importer's --base-scale (64) turns them into integers.
import fs from 'node:fs';

// rdpq color combiner inputs, as fast64 numbers them
const CC = { COMBINED: 0, TEX0: 1, TEX1: 2, PRIM: 3, SHADE: 4, ENV: 5, ONE: 6, NOISE: 7, ZERO: 8 };
const CCD = { COMBINED: 0, TEX0: 1, TEX1: 2, PRIM: 3, SHADE: 4, ENV: 5, ONE: 6, ZERO: 7 }; // the D input and alpha inputs

const tileAxis = (size) => ({ mask: Math.round(Math.log2(size)), shift: 0, low: 0.0, high: size - 1 });

/**
 * fast64 material extras.
 * opts.tex       texture file name (next to the .glb), or null for vertex colours only
 * opts.texSize   [w, h] of that texture (powers of two, they repeat)
 * opts.layer     'opaque' | 'cutout' (alpha test) | 'blend' (transparent)
 * opts.fog       true: the level fog covers it
 * opts.cull      false: two-sided
 * opts.filter    'bilinear' (the default) | 'point'
 * opts.prim      true: multiply by the primitive colour (set at draw time: tints, flashes)
 * opts.emit      true: the texture unshaded (glows at night)
 * opts.glow      [r, g, b]: a flat unshaded colour (lamps)
 */
function f3dExtras(opts) {
  const tex = !!opts.tex || !!opts.texRef; // texRef: a texture the game sets at draw time (palettes)
  const [w, h] = opts.texSize || [32, 32];
  // emit: the texture as it is, not shaded (lit windows at night glow whatever the light)
  // glow: one flat colour (the material's primitive colour), unshaded: lamps, signals
  const color = opts.glow ? { A: CC.ZERO, B: CC.ZERO, C: CC.ZERO, D: CCD.PRIM }
    : opts.emit ? { A: CC.ZERO, B: CC.ZERO, C: CC.ZERO, D: CCD.TEX0 }
    : tex
    ? { A: CC.TEX0, B: CC.ZERO, C: CC.SHADE, D: CCD.ZERO }
    : { A: CC.ZERO, B: CC.ZERO, C: CC.SHADE, D: CCD.SHADE }; // (C is multiplied by 0: SHADE keeps it from reading as a texture)
  const alpha = opts.emit && opts.layer === 'blend' ? { A_alpha: CCD.ZERO, B_alpha: CCD.ZERO, C_alpha: CCD.ZERO, D_alpha: CCD.SHADE } : opts.glow ? { A_alpha: CCD.ZERO, B_alpha: CCD.ZERO, C_alpha: CCD.ZERO, D_alpha: opts.layer === 'blend' ? CCD.SHADE : CCD.ONE } : opts.emit ? { A_alpha: CCD.ZERO, B_alpha: CCD.ZERO, C_alpha: CCD.ZERO, D_alpha: CCD.TEX0 } : tex ? { A_alpha: CCD.TEX0, B_alpha: CCD.ZERO, C_alpha: CCD.SHADE, D_alpha: CCD.ZERO } : { A_alpha: CCD.ZERO, B_alpha: CCD.ZERO, C_alpha: CCD.ZERO, D_alpha: CCD.SHADE };
  const layer = { opaque: 1, cutout: 4, blend: 5 }[opts.layer || 'opaque'];
  // prim: a second cycle multiplies by the primitive colour (tints and flashes at draw time)
  const combiner2 = opts.prim
    ? { name: '', A: CC.COMBINED, B: CC.ZERO, C: CC.PRIM, D: CCD.ZERO, A_alpha: CCD.COMBINED, B_alpha: CCD.ZERO, C_alpha: CCD.PRIM, D_alpha: CCD.ZERO }
    : { name: '', A: 0, B: 8, C: 3, D: 7, A_alpha: 7, B_alpha: 7, C_alpha: 7, D_alpha: 0 };
  return {
    f3d_mat: {
      name: '', presetName: 'Custom',
      combiner1: { name: '', ...color, ...alpha },
      combiner2,
      tex0: opts.texRef ? { tex_set: 1, name: '', use_tex_reference: 1, tex_reference: '0x08000000', tex_reference_size: [w, h], tex: null, menu: 1, S: tileAxis(w), T: tileAxis(h), tex_format: 5, autoprop: 0 }
        : tex ? { tex_set: 1, name: '', tex: { name: opts.tex, type: 'Image' }, menu: 1, S: tileAxis(w), T: tileAxis(h), tex_format: 5, autoprop: 0 }
        : { tex_set: 0, name: '', tex: null, menu: 1, S: {}, T: {}, autoprop: 0, tex_format: 5 },
      tex1: { tex_set: 0, name: '', tex: null, menu: 1, S: {}, T: {}, autoprop: 0, tex_format: 7 },
      set_prim: opts.glow ? 1 : 0, set_env: 0, set_blend: 0,
      prim_color: opts.glow ? [...opts.glow.map((v) => Math.pow(v / 255, 2.2)), 1] : [1, 1, 1, 1], env_color: [0, 0, 0, 1], blend_color: [0, 0, 0, 1],
      rdp_settings: {
        g_zbuffer: 1, g_shade: 1, g_cull_front: 0, g_cull_back: opts.cull === false ? 0 : 1,
        g_fog: opts.fog === false ? 0 : 1, g_lighting: opts.lit ? 1 : 0, g_tex_gen: 0,
        g_shade_smooth: 1, g_mdsft_text_filt: opts.filter === 'point' || opts.texRef ? 0 : 2,
        g_mdsft_cycletype: opts.prim ? 1 : 0, g_mdsft_alpha_compare: 0,
        set_rendermode: 0,
      },
      draw_layer: { sm64: layer, oot: 0, name: '' },
    },
    is_f3d: 1, mat_ver: 6,
  };
}

/** Collects triangles per material (and per bone, for skinned models). */
const lin = (v) => Math.pow(Math.max(0, Math.min(255, v)) / 255, 2.2);

export class MeshBuilder {
  constructor() { this.groups = new Map(); }
  group(mat) {
    if (!this.groups.has(mat)) this.groups.set(mat, { pos: [], nrm: [], col: [], uv: [], joint: [], idx: [] });
    return this.groups.get(mat);
  }
  // one vertex; returns its index in its material group
  vert(mat, p, n, c, uv = [0, 0], joint = 0) {
    const g = this.group(mat);
    g.pos.push(p[0], p[1], p[2]); g.nrm.push(n[0], n[1], n[2]);
    // glTF colours are linear (gltf_to_t3d converts them back to gamma): store ours, given in sRGB, as linear
    g.col.push(lin(c[0]), lin(c[1]), lin(c[2]), (c[3] ?? 255) / 255);
    g.uv.push(uv[0], uv[1]); g.joint.push(joint);
    return g.pos.length / 3 - 1;
  }
  tri(mat, a, b, c) { this.group(mat).idx.push(a, b, c); }
  /** A quad p0..p3 (counter-clockwise seen from the front). opts: color (or colors[4]), uv[4], joint, normal */
  quad(mat, p, opts = {}) {
    const n = opts.normal || faceNormal(p[0], p[1], p[2]);
    const uv = opts.uv || [[0, 0], [1, 0], [1, 1], [0, 1]];
    const cols = opts.colors || [0, 1, 2, 3].map(() => opts.color || [255, 255, 255, 255]);
    const i = p.map((q, k) => this.vert(mat, q, n, cols[k], uv[k], opts.joint || 0));
    this.tri(mat, i[0], i[1], i[2]); this.tri(mat, i[0], i[2], i[3]);
  }
  triangle(mat, p, opts = {}) {
    const n = opts.normal || faceNormal(p[0], p[1], p[2]);
    const uv = opts.uv || [[0, 0], [1, 0], [0, 1]];
    const cols = opts.colors || [0, 1, 2].map(() => opts.color || [255, 255, 255, 255]);
    const i = p.map((q, k) => this.vert(mat, q, n, cols[k], uv[k], opts.joint || 0));
    this.tri(mat, i[0], i[1], i[2]);
  }
  get triangleCount() { let n = 0; for (const g of this.groups.values()) n += g.idx.length / 3; return n; }
  get empty() { return this.triangleCount === 0; }
}

export function faceNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const l = Math.hypot(...n) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

export class Gltf {
  constructor() {
    this.json = { asset: { version: '2.0', generator: 'sandbox tools' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
    this.bin = [];
    this.binLen = 0;
    this.mats = new Map();
  }
  /** A material (by name; asking twice returns the same one). */
  material(name, opts = {}) {
    if (this.mats.has(name)) return this.mats.get(name);
    const m = { index: this.json.materials.length, name };
    this.json.materials.push({ name, extras: f3dExtras(opts), ...(opts.layer === 'blend' ? { alphaMode: 'BLEND' } : {}) });
    this.mats.set(name, m);
    return m;
  }
  _view(buf, target) {
    while (this.binLen % 4) { this.bin.push(Buffer.alloc(1)); this.binLen++; }
    const view = { buffer: 0, byteOffset: this.binLen, byteLength: buf.length, ...(target ? { target } : {}) };
    this.bin.push(buf); this.binLen += buf.length;
    this.json.bufferViews.push(view);
    return this.json.bufferViews.length - 1;
  }
  _accessor(arr, type, comp, { target, normalized, minmax } = {}) {
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const Typed = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[comp];
    const ta = Typed.from(arr);
    const acc = { bufferView: this._view(Buffer.from(ta.buffer), target), componentType: comp, count: arr.length / size, type, ...(normalized ? { normalized: true } : {}) };
    if (minmax) {
      acc.min = Array(size).fill(Infinity); acc.max = Array(size).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) { const k = i % size; acc.min[k] = Math.min(acc.min[k], arr[i]); acc.max[k] = Math.max(acc.max[k], arr[i]); }
    }
    this.json.accessors.push(acc);
    return this.json.accessors.length - 1;
  }
  _primitives(builder, skinned) {
    const prims = [];
    for (const [mat, g] of builder.groups) {
      if (!g.idx.length) continue;
      const attributes = {
        POSITION: this._accessor(g.pos, 'VEC3', 5126, { target: 34962, minmax: true }),
        NORMAL: this._accessor(g.nrm, 'VEC3', 5126, { target: 34962 }),
        COLOR_0: this._accessor(g.col, 'VEC4', 5126, { target: 34962 }),
        TEXCOORD_0: this._accessor(g.uv, 'VEC2', 5126, { target: 34962 }),
      };
      if (skinned) {
        const joints = [], weights = [];
        for (const j of g.joint) { joints.push(j, 0, 0, 0); weights.push(1, 0, 0, 0); }
        attributes.JOINTS_0 = this._accessor(joints, 'VEC4', 5121, { target: 34962 });
        attributes.WEIGHTS_0 = this._accessor(weights, 'VEC4', 5126, { target: 34962 });
      }
      const big = g.pos.length / 3 > 65535;
      prims.push({ attributes, indices: this._accessor(g.idx, 'SCALAR', big ? 5125 : 5123, { target: 34963 }), material: mat.index, mode: 4 });
    }
    return prims;
  }
  /** A mesh in its own node (translation optional). */
  mesh(name, builder, { translation } = {}) {
    if (builder.empty) return -1;
    this.json.meshes.push({ name, primitives: this._primitives(builder, false) });
    this.json.nodes.push({ name, mesh: this.json.meshes.length - 1, ...(translation ? { translation } : {}) });
    this.json.scenes[0].nodes.push(this.json.nodes.length - 1);
    return this.json.nodes.length - 1;
  }
  /**
   * A skinned mesh: bones [{ name, parent (index or -1), head: [x,y,z] in model space }]; every
   * vertex belongs to one bone (MeshBuilder joint = bone index). Vertices are in model space.
   */
  skinned(name, builder, bones) {
    const first = this.json.nodes.length;
    bones.forEach((b, i) => {
      const ph = b.parent >= 0 ? bones[b.parent].head : [0, 0, 0];
      this.json.nodes.push({ name: b.name, translation: [b.head[0] - ph[0], b.head[1] - ph[1], b.head[2] - ph[2]] });
    });
    bones.forEach((b, i) => { if (b.parent >= 0) (this.json.nodes[first + b.parent].children ||= []).push(first + i); });
    const ibm = [];
    for (const b of bones) ibm.push(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -b.head[0], -b.head[1], -b.head[2], 1);
    const skin = { joints: bones.map((_, i) => first + i), inverseBindMatrices: this._accessor(ibm, 'MAT4', 5126), skeleton: first };
    this.json.skins ||= [];
    this.json.skins.push(skin);
    this.json.meshes.push({ name, primitives: this._primitives(builder, true) });
    this.json.nodes.push({ name, mesh: this.json.meshes.length - 1, skin: this.json.skins.length - 1 });
    for (let i = 0; i < bones.length; i++) if (bones[i].parent < 0) this.json.scenes[0].nodes.push(first + i);
    this.json.scenes[0].nodes.push(this.json.nodes.length - 1);
  }
  save(file) {
    while (this.binLen % 4) { this.bin.push(Buffer.alloc(1)); this.binLen++; }
    this.json.buffers = [{ byteLength: this.binLen }];
    let js = Buffer.from(JSON.stringify(this.json));
    if (js.length % 4) js = Buffer.concat([js, Buffer.alloc(4 - (js.length % 4), 0x20)]);
    const bin = Buffer.concat(this.bin);
    const head = Buffer.alloc(12);
    head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
    const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
    const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
    fs.writeFileSync(file, Buffer.concat([head, jh, js, bh, bin]));
  }
}

// ---- shapes ----------------------------------------------------------------------------------

/**
 * An axis-aligned box from min to max. opts: color, faces (which to draw: 'top','bottom','n','s',
 * 'e','w'; default all), uvScale (meters per texture repeat, world-aligned), joint, shadeSides
 * (darken the sides like baked light), colors per face { top, side, bottom }.
 */
export function box(b, mat, min, max, opts = {}) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max;
  const faces = opts.faces || ['top', 'bottom', 'n', 's', 'e', 'w'];
  // uvScale: meters per texture repeat (a number, or [across, up] for the sides); 0: one per face
  const us = Array.isArray(opts.uvScale) ? opts.uvScale[0] : opts.uvScale || 0;
  const vs = Array.isArray(opts.uvScale) ? opts.uvScale[1] : opts.uvScale || 0;
  const s = us;
  const base = opts.color || [255, 255, 255, 255];
  const fc = (name, f) => (opts.colors && opts.colors[name]) || (opts.shadeSides === false ? base : base.map((v, i) => (i < 3 ? Math.min(255, Math.round(v * f)) : v)));
  const j = opts.joint || 0;
  if (faces.includes('top')) b.quad(mat, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], { color: fc('top', 1.0), uv: s ? [[x0 / s, z1 / s], [x1 / s, z1 / s], [x1 / s, z0 / s], [x0 / s, z0 / s]] : undefined, joint: j });
  if (faces.includes('bottom')) b.quad(mat, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], { color: fc('bottom', 0.55), joint: j });
  // sides: v runs down from the top (window rows line up with floors)
  const v0 = opts.vTop ?? 0; // v at the top edge (a wall from the ground up: 0, rows start at the roof line)
  const side = (name, p, w, f, u0) => b.quad(mat, p, { color: fc(name, f), uv: s ? [[u0 / us, v0 + (y1 - y0) / vs], [(u0 + w) / us, v0 + (y1 - y0) / vs], [(u0 + w) / us, v0], [u0 / us, v0]] : undefined, joint: j });
  if (faces.includes('s')) side('s', [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], x1 - x0, 0.85, x0);     // +z
  if (faces.includes('n')) side('n', [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], x1 - x0, 0.7, -x1);     // -z
  if (faces.includes('e')) side('e', [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], z1 - z0, 0.95, -z1);    // +x
  if (faces.includes('w')) side('w', [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], z1 - z0, 0.75, z0);     // -x
}

/** A box turned by yaw (radians) around its centre. */
export function boxRotated(b, mat, center, half, yaw, opts = {}) {
  const t = new MeshBuilder();
  box(t, mat, [-half[0], center[1] - half[1], -half[2]], [half[0], center[1] + half[1], half[2]], opts);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const [m, g] of t.groups) {
    const out = b.group(m);
    const base = out.pos.length / 3;
    for (let i = 0; i < g.pos.length; i += 3) {
      const x = g.pos[i], z = g.pos[i + 2];
      out.pos.push(center[0] + x * c + z * s, g.pos[i + 1], center[2] - x * s + z * c);
      const nx = g.nrm[i], nz = g.nrm[i + 2];
      out.nrm.push(nx * c + nz * s, g.nrm[i + 1], -nx * s + nz * c);
    }
    out.col.push(...g.col); out.uv.push(...g.uv); out.joint.push(...g.joint);
    for (const k of g.idx) out.idx.push(base + k);
  }
}

/** A cylinder (n sides) standing on y0. */
export function cylinder(b, mat, cx, cz, y0, y1, r, n, opts = {}) {
  const col = opts.color || [255, 255, 255, 255];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p0 = [cx + Math.sin(a0) * r, y0, cz + Math.cos(a0) * r], p1 = [cx + Math.sin(a1) * r, y0, cz + Math.cos(a1) * r];
    const r1 = opts.rTop ?? r;
    const q0 = [cx + Math.sin(a0) * r1, y1, cz + Math.cos(a0) * r1], q1 = [cx + Math.sin(a1) * r1, y1, cz + Math.cos(a1) * r1];
    const f = 0.75 + 0.25 * Math.cos(a0 - 0.8);
    b.quad(mat, [p0, p1, q1, q0], { color: col.map((v, k) => (k < 3 ? Math.round(v * f) : v)), uv: [[i / n, 1], [(i + 1) / n, 1], [(i + 1) / n, 0], [i / n, 0]], joint: opts.joint || 0 });
    if (opts.cap !== false) b.triangle(mat, [q0, q1, [cx, y1, cz]], { color: col, joint: opts.joint || 0 });
  }
}

// ---- smooth shapes (vertex normals: lit round, not faceted) ----

/**
 * An ellipsoid. opts: color (or colorFn(normal) for baked light), uv (one texel for all), joint,
 * from/to (latitude range 0..1 from the bottom), segs, rings, rot (yaw around y), flatten (cut at y).
 */
export function ellipsoid(b, mat, c, r, opts = {}) {
  const segs = opts.segs || 8, rings = opts.rings || 6;
  const lat0 = opts.from ?? 0, lat1 = opts.to ?? 1;
  const yaw = opts.rot || 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const pt = (i, j) => {
    const v = lat0 + (lat1 - lat0) * (j / rings);
    const phi = -Math.PI / 2 + v * Math.PI, th = (i / segs) * Math.PI * 2;
    const nx0 = Math.cos(phi) * Math.sin(th), ny = Math.sin(phi), nz0 = Math.cos(phi) * Math.cos(th);
    const nx = nx0 * cy + nz0 * sy, nz = -nx0 * sy + nz0 * cy;
    const px = nx0 * r[0], pz = nz0 * r[2];
    const p = [c[0] + px * cy + pz * sy, c[1] + ny * r[1], c[2] - px * sy + pz * cy];
    // the normal of an ellipsoid: n / r^2, normalised
    let n = [nx / r[0], ny / r[1], nz / r[2]]; const l = Math.hypot(...n) || 1; n = n.map((q) => q / l);
    return { p, n };
  };
  const col = (n) => (opts.colorFn ? opts.colorFn(n) : opts.color || [255, 255, 255, 255]);
  const uv = opts.uv || [0.5, 0.5];
  const idx = [];
  for (let j = 0; j <= rings; j++) { idx.push([]); for (let i = 0; i <= segs; i++) { const q = pt(i, j); idx[j].push(b.vert(mat, q.p, q.n, col(q.n), opts.uvScale ? [(i / segs) * opts.uvScale, (j / rings) * opts.uvScale * 0.5] : uv, opts.joint || 0)); } }
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const a = idx[j][i], bb = idx[j][i + 1], cc = idx[j + 1][i + 1], d = idx[j + 1][i];
    if (j > 0 || lat0 > 0) b.tri(mat, a, bb, cc); // (the poles: one triangle per segment)
    if (j < rings - 1 || lat1 < 1) b.tri(mat, a, cc, d);
  }
}

/** A tube between two points (radii r0 at a, r1 at b), smooth, optional end caps (half spheres). */
export function tube(b, mat, a, bp, r0, r1, opts = {}) {
  const segs = opts.segs || 8;
  const d = [bp[0] - a[0], bp[1] - a[1], bp[2] - a[2]];
  const len = Math.hypot(...d) || 1;
  const ax = d.map((q) => q / len);
  // two directions across the tube
  let u = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  let v = cross(ax, u); const lv = Math.hypot(...v); v = v.map((q) => q / lv);
  u = cross(v, ax);
  const col = (n) => (opts.colorFn ? opts.colorFn(n) : opts.color || [255, 255, 255, 255]);
  const uv = opts.uv || [0.5, 0.5];
  const ring = (c, r) => { const out = []; for (let i = 0; i <= segs; i++) { const t = (i / segs) * Math.PI * 2; const n = [u[0] * Math.cos(t) + v[0] * Math.sin(t), u[1] * Math.cos(t) + v[1] * Math.sin(t), u[2] * Math.cos(t) + v[2] * Math.sin(t)]; out.push(b.vert(mat, [c[0] + n[0] * r, c[1] + n[1] * r, c[2] + n[2] * r], n, col(n), uv, opts.joint || 0)); } return out; };
  const A = ring(a, r0), B = ring(bp, r1);
  for (let i = 0; i < segs; i++) { b.tri(mat, A[i], B[i + 1], B[i]); b.tri(mat, A[i], A[i + 1], B[i + 1]); }
  if (opts.capA) ellipsoid(b, mat, a, [r0, r0, r0], { ...opts, segs, rings: 3, from: 0, to: 0.5 });
  if (opts.capB) ellipsoid(b, mat, bp, [r1, r1, r1], { ...opts, segs, rings: 3, from: 0.5, to: 1 });
}
