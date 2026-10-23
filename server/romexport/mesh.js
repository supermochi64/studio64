// Turns the dumped triangles of an area into N64 display lists: split into chunks (each one a
// translate node with a render range, so chunks behind the camera are skipped), vertices welded per
// material and loaded in batches that fit F3DEX2's vertex buffer.
import { toN64, log2 } from './textures.js';
import { gfx, vtx, geo, G, RENDER_MODES, RM_FOG_SHADE_A } from './n64.js';

const CHUNK = 2048;
const BATCH = 30;            // vertices per gsSPVertex (F3DEX2 holds 32)
const DRAW_DISTANCE = 32000;
const MAX_CHUNKS = 160;
const LAYER_OPAQUE = 1;
const CLEARED = G.CULL_FRONT | G.CULL_BACK | G.LIGHTING | G.TEXTURE_GEN | G.TEXTURE_GEN_LINEAR;

// Writes the area's textures, vertices and display lists into seg (labels start with prefix).
// lights: the label of a Lights1. -> { geo(seg): writes the chunks' geo nodes, stats }
// single: one model in its own coordinates (an object's): no chunks, the geo nodes are its
// display lists. fog: { color: [r, g, b], min, max } (fog positions, see fogOf); tint: [r, g, b]
// multipliers for the vertex colours
export function buildMesh(seg, dump, prefix, lights, { single = false, fog = null, tint = null } = {}) {
  const tex = dump.textures.map((t) => toN64(t));
  const stats = { tris: 0, verts: 0, chunks: 0, textures: tex.length, bytes: 0 };
  const start = seg.n;

  tex.forEach((t, i) => {
    seg.align(8).label(`${prefix}_tex${i}`).bytes(t.bytes);
    if (t.palette) seg.align(8).label(`${prefix}_tex${i}_pal`).bytes(t.palette);
  });

  // chunks by triangle centroid (bigger ones in big levels: each chunk costs a matrix every frame)
  let chunks;
  for (let size = CHUNK; !single; size *= 2) {
    chunks = new Map();
    for (const tri of dump.tris) {
      const cx = (tri.v[0].x + tri.v[1].x + tri.v[2].x) / 3, cz = (tri.v[0].z + tri.v[1].z + tri.v[2].z) / 3;
      const key = `${Math.floor(cx / size)},${Math.floor(cz / size)}`;
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(tri);
    }
    if (chunks.size <= MAX_CHUNKS || size >= 16384) break;
  }
  if (single) chunks = new Map([['0', dump.tris]]);

  const nodes = [];
  let ci = 0;
  for (const tris of chunks.values()) {
    // chunk origin: the middle of its bounds; radius for the render range
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (const tri of tris) for (const v of tri.v) {
      x0 = Math.min(x0, v.x); y0 = Math.min(y0, v.y); z0 = Math.min(z0, v.z);
      x1 = Math.max(x1, v.x); y1 = Math.max(y1, v.y); z1 = Math.max(z1, v.z);
    }
    const ox = single ? 0 : Math.round((x0 + x1) / 2), oy = single ? 0 : Math.round((y0 + y1) / 2), oz = single ? 0 : Math.round((z0 + z1) / 2);
    const radius = Math.ceil(Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2) + 64;
    const cname = `${prefix}_c${ci++}`;

    // per layer, per material
    const byLayer = new Map();
    for (const tri of tris) {
      const m = dump.materials[tri.mat];
      if (!byLayer.has(m.layer)) byLayer.set(m.layer, new Map());
      const mats = byLayer.get(m.layer);
      if (!mats.has(tri.mat)) mats.set(tri.mat, []);
      mats.get(tri.mat).push(tri);
    }

    const dls = [];
    for (const [layer, mats] of byLayer) {
      // vertices first (each material's batches), then the display list that draws them
      const draws = [];
      for (const [mi, mtris] of mats) {
        const m = dump.materials[mi];
        const t = m.tex >= 0 ? tex[m.tex] : null;
        const vname = `${cname}_m${mi}_v`;
        // the material's vertices (welded), its triangles as vertex ids, then batches that share them
        const ids = new Map(), unique = [], tri3 = [];
        for (const tri of mtris) {
          const idx = triVerts(tri, m, t, ox, oy, oz, m.lit ? null : tint).map((v) => {
            if (!ids.has(v.key)) { ids.set(v.key, unique.length); unique.push(v); }
            return ids.get(v.key);
          });
          stats.tris++;
          if (idx[0] !== idx[1] && idx[1] !== idx[2] && idx[0] !== idx[2]) tri3.push(idx);
        }
        const verts = [];
        const batches = [];
        for (const b of batchTriangles(tri3, BATCH)) {
          batches.push({ start: verts.length, n: b.verts.length, tris: b.tris });
          for (const id of b.verts) verts.push(unique[id]);
        }
        seg.align(16).label(vname);
        for (const v of verts) vtx(seg, v.x, v.y, v.z, v.s, v.t, v.c);
        stats.verts += verts.length;
        draws.push({ m, t, texName: t ? `${prefix}_tex${m.tex}` : null, vname, batches });
      }

      const dlName = `${cname}_l${layer}`;
      seg.align(8).label(dlName);
      // fog: the second cycle blends with the fog colour (the RSP puts the fog amount in the shade alpha)
      const rm = RENDER_MODES[layer] || RENDER_MODES[1];
      if (fog) {
        gfx.pipeSync(seg);
        gfx.cycleType(seg, true);
        gfx.renderMode(seg, RM_FOG_SHADE_A, rm[1]);
        gfx.geometryMode(seg, 0, G.FOG);
        gfx.fogColor(seg, fog.color);
        gfx.fogPosition(seg, fog.min, fog.max);
      }
      for (const d of draws) {
        material(seg, d.m, d.t, d.texName, lights, !!fog);
        for (const b of d.batches) {
          gfx.vertex(seg, d.vname, b.start, b.n, 0);
          for (let i = 0; i < b.tris.length; i += 2) {
            const a = b.tris[i], c = b.tris[i + 1];
            if (c) gfx.tri2(seg, a[0], a[1], a[2], c[0], c[1], c[2]);
            else gfx.tri1(seg, a[0], a[1], a[2]);
          }
        }
      }
      // what the next display list expects: untextured, shaded, lit, back faces culled, no palette
      gfx.pipeSync(seg);
      gfx.textureLut(seg, false);
      gfx.texture(seg, 0xFFFF, 0xFFFF, 0, 0, 0);
      gfx.combineShade(seg);
      gfx.geometryMode(seg, fog ? G.FOG : 0, G.LIGHTING | G.CULL_BACK);
      if (fog) {
        gfx.cycleType(seg, false);
        gfx.renderMode(seg, rm[0], rm[1]);
      }
      gfx.end(seg);
      dls.push({ layer, dlName });
    }
    nodes.push({ ox, oy, oz, radius, dls });
    stats.chunks++;
  }
  stats.bytes = seg.n - start;

  // the geo nodes: one translate node per chunk, culled by distance
  const writeGeo = (s) => {
    if (single) {
      for (const c of nodes) for (const d of c.dls) geo.displayList(s, d.layer, d.dlName);
      return;
    }
    for (const c of nodes) {
      geo.translate(s, LAYER_OPAQUE, c.ox, c.oy, c.oz);
      geo.open(s);
      geo.renderRange(s, -c.radius - 200, DRAW_DISTANCE);
      geo.open(s);
      for (const d of c.dls) geo.displayList(s, d.layer, d.dlName);
      geo.close(s);
      geo.close(s);
    }
  };
  return { geo: writeGeo, stats };
}

// Triangles (vertex id triples) -> batches of at most max vertices: each batch grows through the
// triangles that share its vertices, so most vertices are loaded once.
// -> [{ verts: [ids], tris: [[local, local, local]] }]
export function batchTriangles(tris, max) {
  const byVert = new Map();
  tris.forEach((tri, i) => { for (const v of tri) { if (!byVert.has(v)) byVert.set(v, []); byVert.get(v).push(i); } });
  const done = new Uint8Array(tris.length);
  const out = [];
  let next = 0;
  for (;;) {
    while (next < tris.length && done[next]) next++;
    if (next >= tris.length) break;
    const slot = new Map(), verts = [], local = [];
    const fresh = (i) => (slot.has(tris[i][0]) ? 0 : 1) + (slot.has(tris[i][1]) ? 0 : 1) + (slot.has(tris[i][2]) ? 0 : 1);
    const cand = new Set();
    const add = (i) => {
      done[i] = 1;
      cand.delete(i);
      local.push(tris[i].map((v) => { if (!slot.has(v)) { slot.set(v, verts.length); verts.push(v); } return slot.get(v); }));
      for (const v of tris[i]) for (const j of byVert.get(v)) if (!done[j]) cand.add(j);
    };
    add(next);
    for (;;) {
      let best = -1, cost = 4;
      for (const j of cand) {
        const c = fresh(j);
        if (c < cost) { cost = c; best = j; if (c === 0) break; }
      }
      if (best < 0) {
        // nothing touches the batch any more: the next triangle anywhere, if it fits
        while (next < tris.length && done[next]) next++;
        if (next >= tris.length || verts.length + fresh(next) > max) break;
        add(next);
        continue;
      }
      if (verts.length + cost > max) break;
      add(best);
    }
    out.push({ verts, tris: local });
  }
  return out;
}

function material(seg, m, t, texName, lights, twoCycle) {
  gfx.pipeSync(seg);
  if (twoCycle) gfx.raw(seg, ...pass2(m.combine));
  else gfx.raw(seg, m.combine[0], m.combine[1]);
  gfx.geometryMode(seg, CLEARED, m.geomode & CLEARED);
  if (m.lit) gfx.lights1(seg, lights);
  gfx.primColor(seg, 0, 0, m.prim);
  gfx.envColor(seg, m.env);
  if (t && t.palette) {
    gfx.textureLut(seg, true);
    gfx.loadTlut(seg, `${texName}_pal`, t.fmt === 'ci4' ? 16 : 256);
    gfx.loadTextureBlockCI(seg, texName, t.w, t.h, t.fmt === 'ci4' ? 4 : 8, m.cms, m.cmt, log2(t.w), log2(t.h));
    gfx.texture(seg, 0xFFFF, 0xFFFF, 0, 0, 1);
  } else if (t) {
    gfx.textureLut(seg, false);
    gfx.loadTextureBlock16(seg, texName, t.w, t.h, m.cms, m.cmt, log2(t.w), log2(t.h));
    gfx.texture(seg, 0xFFFF, 0xFFFF, 0, 0, 1);
  } else {
    gfx.texture(seg, 0xFFFF, 0xFFFF, 0, 0, 0);
  }
}

// A combine mode with its second cycle passing the first one's result on (G_CC_PASS2)
export function pass2([w0, w1]) {
  const a1 = 15, c1 = 31, b1 = 15, d1 = 0, Aa1 = 7, Ac1 = 7, Ab1 = 7, Ad1 = 0;
  w0 = (w0 & ~((0xF << 5) | 0x1F)) | (a1 << 5) | c1;
  w1 = (w1 & ~((0xF << 24) | (7 << 21) | (7 << 18) | (7 << 6) | (7 << 3) | 7)) | (b1 << 24) | (Aa1 << 21) | (Ac1 << 18) | (d1 << 6) | (Ab1 << 3) | Ad1;
  return [w0 >>> 0, w1 >>> 0];
}

// Fog for the N64 from the studio's (distances from the camera, settings.env.fog): the positions
// the RSP's fog takes are on its depth scale (0 at the near plane, 1000 at the far one), which is
// 1/distance-like, the studio's fog is linear in distance: the two agree at 15% and 85% fog.
// -> { color, min, max }
export function fogOf(f, near = 100, far = 32000) {
  if (!f?.on) return null;
  const hex = typeof f.color === 'string' ? parseInt(f.color.replace('#', ''), 16) : (f.color ?? 0xB8C8E0);
  const pos = (d) => 500 * ((far + near) / (far - near) - (2 * far * near) / ((far - near) * Math.max(near + 1, d)) + 1);
  const n = f.near ?? 1500, x = Math.max(n + 10, f.far ?? 9000);
  const p1 = pos(n + 0.15 * (x - n)), p2 = pos(n + 0.85 * (x - n));
  const span = Math.max(4, (p2 - p1) / 0.7); // the RSP takes 128000 / span as a 16-bit number
  const min = p1 - 0.15 * span, max = min + span;
  return { color: [(hex >> 16) & 0xFF, (hex >> 8) & 0xFF, hex & 0xFF], min, max };
}

// The three vertices of a triangle in chunk space, with texture coordinates moved near 0 (the
// N64 keeps them in 10.5 fixed point) and scaled to the converted texture.
function triVerts(tri, m, t, ox, oy, oz, tint) {
  const sS = t ? t.scaleS * (m.scaleS / 0x10000 || 1) : 1, sT = t ? t.scaleT * (m.scaleT / 0x10000 || 1) : 1;
  let s = tri.v.map((v) => v.s * sS), tt = tri.v.map((v) => v.t * sT);
  if (t) {
    if (!(m.cms & 2)) { const k = Math.floor(Math.min(...s) / t.w) * t.w; s = s.map((v) => v - k); }
    if (!(m.cmt & 2)) { const k = Math.floor(Math.min(...tt) / t.h) * t.h; tt = tt.map((v) => v - k); }
  }
  const c16 = (v) => Math.max(-32768, Math.min(32767, Math.round(v)));
  return tri.v.map((v, i) => {
    const o = { x: c16(v.x - ox), y: c16(v.y - oy), z: c16(v.z - oz), s: c16(s[i] * 32), t: c16(tt[i] * 32) };
    o.c = tint ? v.c.map((c, k) => (k < 3 ? Math.min(255, Math.round(c * tint[k])) : c)) : v.c; // colours, or the normal's signed bytes when lit
    o.key = `${o.x},${o.y},${o.z},${o.s},${o.t},${o.c.join(',')}`;
    return o;
  });
}
