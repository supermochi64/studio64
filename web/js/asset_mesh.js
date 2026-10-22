// Imported scene -> game-ready model package, and package -> engine.
//
// A package is what the project stores for a model (one binary asset file):
// triangles in game units (with uvs, colours and normals), and per material its
// N64-converted texture (PNG) and colour. The material's game settings (surface
// type, alpha mode, double-sided, wrap) live in the project's model metadata, so
// they can change without re-importing.

import { pow2, rasterize, quantize, alphaKind, toPNGBlob, blobToRGBA } from './texcodec.js';

export const SURFACE_TYPES = {
  normal: 0x0000, not_slippery: 0x0015, slippery: 0x0014, ice: 0x0013, lava: 0x0001, death: 0x000A, hangable: 0x0005,
  hard: 0x0030, noisy: 0x0029, quicksand: 0x0022, shallow_sand: 0x0021, vanish_wall: 0x007B,
};
export const SURFACE_NAMES = {
  normal: 'Normal', not_slippery: 'Grippy (climb slopes)', slippery: 'Slippery', ice: 'Ice (very slippery)', lava: 'Lava (burns)',
  death: 'Death floor', hangable: 'Hangable ceiling', hard: 'Hard (fall damage)', noisy: 'Normal, noisy steps', quicksand: 'Quicksand',
  shallow_sand: 'Shallow sand', vanish_wall: 'Vanish-cap wall', water: 'Water (swim, no collision)', none: 'No collision (decoration)',
};
const WRAP_BITS = { repeat: 0, mirror: 1, clamp: 2 };
export const MAX_TRIS = 120000;

// Guess a material's surface from its name ("Lava", "ice_floor", "Water").
export function guessSurface(name) {
  const n = String(name || '').toLowerCase();
  if (/lava|magma|fire/.test(n)) return 'lava';
  if (/water|ocean|sea\b|lake|river/.test(n)) return 'water';
  if (/ice|frozen/.test(n)) return 'ice';
  if (/quicksand/.test(n)) return 'quicksand';
  if (/death|void|kill/.test(n)) return 'death';
  if (/hang|grate|mesh_ceiling|ceiling_net/.test(n)) return 'hangable';
  if (/leaf|leaves|foliage|grass_blade|flower|vine|decal|nocol|no_col/.test(n)) return 'none';
  if (/slide|slippery/.test(n)) return 'slippery';
  return 'normal';
}

// ---------------------------------------------------------------------------
// building

// opts: { scale, rotate: [x, y, z] degrees, zUp, origin: 'bottom' | 'center' | 'file',
//         texMax, texFormat, smoothTextures }
export async function buildPackage(scene, opts = {}) {
  const { scale = 1, rotate = [0, 0, 0], origin = 'bottom', texMax = 64, texFormat = 'rgba16', smoothTextures = true } = opts;
  const zUp = opts.zUp ?? scene.upAxis === 'z';
  // rotation: Z-up -> Y-up first, then the user's turns (degrees, X then Y then Z)
  const rad = rotate.map((d) => (d * Math.PI) / 180);
  const rotX = (v, a) => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
  const rotY = (v, a) => [v[0] * Math.cos(a) + v[2] * Math.sin(a), v[1], -v[0] * Math.sin(a) + v[2] * Math.cos(a)];
  const rotZ = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
  const turn = (v) => {
    let p = zUp ? [v[0], v[2], -v[1]] : v;
    if (rad[0]) p = rotX(p, rad[0]);
    if (rad[1]) p = rotY(p, rad[1]);
    if (rad[2]) p = rotZ(p, rad[2]);
    return p;
  };

  let tris = 0;
  for (const m of scene.meshes) tris += m.indices.length / 3;
  if (tris > MAX_TRIS) throw new Error(`the model has ${tris} triangles; the limit is ${MAX_TRIS} (decimate it in Blender first)`);

  const pos = new Float32Array(tris * 9), uv = new Float32Array(tris * 6), col = new Uint8Array(tris * 12), nrm = new Int8Array(tris * 9);
  const mat = new Uint16Array(tris);
  let t = 0;
  for (const m of scene.meshes) {
    const P = m.positions, U = m.uvs, C = m.colors, N = m.normals, I = m.indices;
    const mc = scene.materials[m.material]?.color || [1, 1, 1, 1];
    for (let k = 0; k < I.length; k += 3, t++) {
      const v = [0, 1, 2].map((j) => turn([P[I[k + j] * 3] * scale, P[I[k + j] * 3 + 1] * scale, P[I[k + j] * 3 + 2] * scale]));
      // face normal for missing normals (and to check the given ones)
      const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      let fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const fl = Math.hypot(...fn) || 1;
      fn = fn.map((x) => x / fl);
      for (let j = 0; j < 3; j++) {
        const vi = I[k + j];
        pos.set(v[j], t * 9 + j * 3);
        if (U) { uv[t * 6 + j * 2] = U[vi * 2]; uv[t * 6 + j * 2 + 1] = U[vi * 2 + 1]; }
        let n = fn;
        if (N) {
          const g = turn([N[vi * 3], N[vi * 3 + 1], N[vi * 3 + 2]]);
          const l = Math.hypot(...g);
          if (l > 0.01) n = g.map((x) => x / l);
        }
        nrm[t * 9 + j * 3] = Math.round(n[0] * 127); nrm[t * 9 + j * 3 + 1] = Math.round(n[1] * 127); nrm[t * 9 + j * 3 + 2] = Math.round(n[2] * 127);
        const c = C ? [C[vi * 4], C[vi * 4 + 1], C[vi * 4 + 2], C[vi * 4 + 3]] : [1, 1, 1, 1];
        for (let q = 0; q < 4; q++) col[t * 12 + j * 4 + q] = Math.max(0, Math.min(255, Math.round(c[q] * (q < 3 ? mc[q] : mc[3]) * 255)));
      }
      mat[t] = m.material;
    }
  }
  // origin
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) { if (pos[i + a] < min[a]) min[a] = pos[i + a]; if (pos[i + a] > max[a]) max[a] = pos[i + a]; }
  if (origin !== 'file') {
    const off = [(min[0] + max[0]) / 2, origin === 'bottom' ? min[1] : (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) pos[i + a] -= off[a];
    for (let a = 0; a < 3; a++) { min[a] -= off[a]; max[a] -= off[a]; }
  }
  const extent = Math.max(...max.map(Math.abs), ...min.map(Math.abs));
  if (extent > 32000) throw new Error(`the model is ${Math.round(extent * 2)} units across at this scale; the game allows 64000: lower the scale`);

  // materials: textures to N64 sizes and formats
  const materials = [];
  for (const [i, m] of scene.materials.entries()) {
    const used = mat.includes(i);
    const out = { name: m.name, color: m.color, alphaMode: m.alphaMode, doubleSided: m.doubleSided, wrapS: m.wrapS, wrapT: m.wrapT, unlit: !!m.unlit, used };
    if (m.image && used) {
      const w = pow2(m.image.width, texMax), h = pow2(m.image.height, texMax);
      const rgba = rasterize(m.image, w, h, { smooth: smoothTextures });
      const kind = m.alphaMode === 'BLEND' ? 'blend' : m.alphaMode === 'MASK' ? 'cutout' : alphaKind(rgba);
      quantize(rgba, texFormat, { alpha: kind });
      out.tex = { w, h, rgba, alpha: kind };
      out.srcSize = [m.image.width, m.image.height];
    }
    materials.push(out);
  }
  return { version: 1, name: scene.name, tris, pos, uv, col, nrm, mat, materials, bounds: { min, max }, format: scene.format, texFormat, texMax };
}

// Default per-material game settings for a fresh import.
export function defaultMaterialMeta(pkg) {
  return pkg.materials.map((m) => {
    const alpha = m.tex?.alpha === 'blend' || m.alphaMode === 'BLEND' || m.color[3] < 0.99 ? 'blend' : (m.tex?.alpha === 'cutout' || m.alphaMode === 'MASK') ? 'cutout' : 'opaque';
    let surface = guessSurface(m.name);
    if (alpha === 'cutout' && surface === 'normal' && /leaf|tree|plant|grass|bush/i.test(m.name)) surface = 'none';
    return { name: m.name, surface, alpha, double: !!m.doubleSided || alpha === 'cutout', wrapS: m.wrapS || 'repeat', wrapT: m.wrapT || 'repeat', unlit: !!m.unlit };
  });
}

// ---------------------------------------------------------------------------
// package file: "S64M", u32 header length, JSON header, then the binary chunks

export async function encodePackage(pkg) {
  const chunks = [];
  const header = { version: 1, name: pkg.name, tris: pkg.tris, bounds: pkg.bounds, format: pkg.format, texFormat: pkg.texFormat, texMax: pkg.texMax, chunks: {}, materials: [] };
  let off = 0;
  const add = (key, bytes) => { header.chunks[key] = [off, bytes.byteLength]; chunks.push(bytes); off += bytes.byteLength; };
  add('pos', new Uint8Array(pkg.pos.buffer, pkg.pos.byteOffset, pkg.pos.byteLength));
  add('uv', new Uint8Array(pkg.uv.buffer, pkg.uv.byteOffset, pkg.uv.byteLength));
  add('col', pkg.col);
  add('nrm', new Uint8Array(pkg.nrm.buffer, pkg.nrm.byteOffset, pkg.nrm.byteLength));
  add('mat', new Uint8Array(pkg.mat.buffer, pkg.mat.byteOffset, pkg.mat.byteLength));
  for (const [i, m] of pkg.materials.entries()) {
    const hm = { name: m.name, color: m.color, alphaMode: m.alphaMode, doubleSided: m.doubleSided, wrapS: m.wrapS, wrapT: m.wrapT, unlit: m.unlit };
    if (m.tex) {
      const png = new Uint8Array(await (await toPNGBlob(m.tex.rgba, m.tex.w, m.tex.h)).arrayBuffer());
      add(`tex${i}`, png);
      hm.tex = { chunk: `tex${i}`, w: m.tex.w, h: m.tex.h, alpha: m.tex.alpha };
    }
    header.materials.push(hm);
  }
  const hj = new TextEncoder().encode(JSON.stringify(header));
  const pad = (4 - ((8 + hj.length) % 4)) % 4; // keep the float chunks aligned
  const out = new Uint8Array(8 + hj.length + pad + off);
  out.set([0x53, 0x36, 0x34, 0x4d]);
  new DataView(out.buffer).setUint32(4, hj.length + pad, true);
  out.set(hj, 8);
  out.fill(0x20, 8 + hj.length, 8 + hj.length + pad);
  let p = 8 + hj.length + pad;
  for (const c of chunks) { out.set(c, p); p += c.byteLength; }
  return out;
}

export async function decodePackage(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] !== 0x53 || u8[1] !== 0x36 || u8[2] !== 0x34 || u8[3] !== 0x4d) throw new Error('not a Studio 64 model package');
  const hl = new DataView(u8.buffer, u8.byteOffset).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hl)));
  const base = 8 + hl;
  const chunk = (k) => { const [o, l] = header.chunks[k]; return u8.slice(base + o, base + o + l); };
  const f32 = (k) => new Float32Array(chunk(k).buffer);
  const pkg = {
    ...header, pos: f32('pos'), uv: f32('uv'), col: chunk('col'), nrm: new Int8Array(chunk('nrm').buffer), mat: new Uint16Array(chunk('mat').buffer),
    materials: [],
  };
  for (const m of header.materials) {
    const out = { ...m };
    if (m.tex) {
      const img = await blobToRGBA(new Blob([chunk(m.tex.chunk)], { type: 'image/png' }));
      out.tex = { w: img.w, h: img.h, rgba: img.rgba, alpha: m.tex.alpha };
    }
    pkg.materials.push(out);
  }
  return pkg;
}

// ---------------------------------------------------------------------------
// into the engine

const SUN = (() => { const v = [0.38, 0.84, 0.38]; const l = Math.hypot(...v); return v.map((x) => x / l); })();

// Vertex shade like the game's own geometry: lit from above, sides a bit darker.
export const shadeOf = (nx, ny, nz) => {
  const d = Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
  return Math.min(1.05, 0.5 + 0.55 * d);
};

// Upload a package as engine model `slot`. meta: { materials: [{ surface, alpha, double, wrapS, wrapT, unlit }], lighting }
// Returns { tris, collision, water: [[minx,miny,minz,maxx,maxy,maxz], ...] } (water boxes in model space).
export function uploadPackage(engine, slot, pkg, meta = {}) {
  const M = engine.M;
  const mm = meta.materials || defaultMaterialMeta(pkg);
  const lighting = meta.lighting || 'baked';
  if (!M._studio_model_begin(slot)) throw new Error('no model slot free');
  const engineMat = [];
  for (const [i, m] of pkg.materials.entries()) {
    const s = mm[i] || {};
    const alpha = s.alpha === 'blend' ? 2 : s.alpha === 'cutout' ? 1 : 0;
    // 128: flat colours, the area's light (settings.env.light) does not shade it
    const flags = alpha | (s.double ? 4 : 0) | ((WRAP_BITS[s.wrapS] || 0) << 3) | ((WRAP_BITS[s.wrapT] || 0) << 5) | (s.unlit || lighting === 'flat' ? 128 : 0);
    let ptr = 0;
    if (m.tex) {
      ptr = M._malloc(m.tex.rgba.length);
      M.HEAPU8.set(m.tex.rgba, ptr);
    }
    engineMat.push(M._studio_model_material(slot, ptr, m.tex ? m.tex.w : 0, m.tex ? m.tex.h : 0, flags));
    if (ptr) M._free(ptr);
  }
  // triangles per material
  const byMat = new Map();
  for (let t = 0; t < pkg.tris; t++) {
    const k = pkg.mat[t];
    if (!byMat.has(k)) byMat.set(k, []);
    byMat.get(k).push(t);
  }
  let drawn = 0;
  const colTris = [], colTypes = [], water = [];
  for (const [k, list] of byMat) {
    const s = mm[k] || {};
    const flat = s.unlit || lighting === 'flat';
    const buf = new Float32Array(list.length * 27);
    let o = 0;
    for (const t of list) {
      for (let j = 0; j < 3; j++) {
        const pi = t * 9 + j * 3;
        buf[o++] = pkg.pos[pi]; buf[o++] = pkg.pos[pi + 1]; buf[o++] = pkg.pos[pi + 2];
        buf[o++] = pkg.uv[t * 6 + j * 2]; buf[o++] = pkg.uv[t * 6 + j * 2 + 1];
        const sh = flat ? 1 : shadeOf(pkg.nrm[pi] / 127, pkg.nrm[pi + 1] / 127, pkg.nrm[pi + 2] / 127);
        const ci = t * 12 + j * 4;
        buf[o++] = Math.min(255, pkg.col[ci] * sh); buf[o++] = Math.min(255, pkg.col[ci + 1] * sh); buf[o++] = Math.min(255, pkg.col[ci + 2] * sh);
        buf[o++] = s.alpha === 'blend' ? pkg.col[ci + 3] : 255;
      }
    }
    const ptr = M._malloc(buf.byteLength);
    new Float32Array(M.HEAPU8.buffer, ptr, buf.length).set(buf);
    M._studio_model_tris(slot, engineMat[k], ptr, list.length);
    M._free(ptr);
    drawn += list.length;
    const surface = s.surface || 'normal';
    if (surface === 'water') {
      const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (const t of list) for (let j = 0; j < 9; j += 3) for (let a = 0; a < 3; a++) {
        const v = pkg.pos[t * 9 + j + a];
        if (v < b[a]) b[a] = v;
        if (v > b[a + 3]) b[a + 3] = v;
      }
      water.push(b);
    } else if (surface !== 'none') {
      const type = SURFACE_TYPES[surface] ?? 0;
      for (const t of list) {
        // skip degenerate triangles: the game divides by their normal length
        const p = pkg.pos.subarray(t * 9, t * 9 + 9);
        const q = Array.from(p, (v) => Math.round(v));
        const ax = q[3] - q[0], ay = q[4] - q[1], az = q[5] - q[2], bx = q[6] - q[0], by = q[7] - q[1], bz = q[8] - q[2];
        const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        if (nx * nx + ny * ny + nz * nz < 1) continue;
        const L = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (s.double && Math.abs(ny / L) <= 0.01) {
          // a double-sided wall: its two faces may not lie in one plane. The game pushes Mario out
          // of every wall he is within his radius of, even from behind, so two opposite walls in
          // one plane push him in opposite directions and the sum puts him THROUGH the wall. Each
          // face moves 12 units out along its own normal (a thin slab): from either side the face
          // he meets first stops him. (Floors and ceilings in one plane are fine: the game looks
          // for ceilings 80 units above the floor.)
          const o = [Math.round((nx / L) * 12), 0, Math.round((nz / L) * 12)];
          colTris.push(...q.map((v, i) => v + o[i % 3]));
          colTypes.push(type);
          colTris.push(q[0] - o[0], q[1], q[2] - o[2], q[6] - o[0], q[7], q[8] - o[2], q[3] - o[0], q[4], q[5] - o[2]);
          colTypes.push(type);
          continue;
        }
        colTris.push(...q);
        colTypes.push(type);
        if (s.double) { colTris.push(q[0], q[1], q[2], q[6], q[7], q[8], q[3], q[4], q[5]); colTypes.push(type); }
      }
    }
  }
  if (colTypes.length) {
    const tp = M._malloc(colTris.length * 2), yp = M._malloc(colTypes.length * 2);
    new Int16Array(M.HEAPU8.buffer, tp, colTris.length).set(colTris);
    new Int16Array(M.HEAPU8.buffer, yp, colTypes.length).set(colTypes);
    M._studio_model_collision(slot, tp, yp, colTypes.length);
    M._free(tp); M._free(yp);
  }
  M._studio_model_end(slot);
  return { tris: drawn, collision: colTypes.length, water };
}
