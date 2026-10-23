// Roads & nature: the edits. Shared by the build-mode tools (ui.js) and the AI's rpc methods
// (rpc.js), so both make the same records and the same undo steps.

import { ROAD_STYLES, styleOf } from './roads.js';
import { LINE_STYLES } from './lines.js';
import { KIND } from './nature.js';
import { touchNature } from './runtime.js';
import { hash2 } from './geom.js';

export const randUid = () => 1 + Math.floor(Math.random() * 0x7efffffe);
const clone = (v) => JSON.parse(JSON.stringify(v));
const round = (p) => p.map((v, i) => (i === 3 ? (v ? Math.round(v) : undefined) : Math.round(v))).filter((v) => v !== undefined);

export class PathsOps {
  constructor(rt, editor) {
    this.rt = rt;
    this.editor = editor;
  }

  records() { return this.editor.records(); }
  find(uid) { return this.records().find((r) => r.uid === uid) || null; }
  commit(op) { this.editor.commit(op); }

  // ---- roads -------------------------------------------------------------------------------

  roadRecord({ style = 'asphalt', pts, width, closed = false, smooth = true, name, material, ...rest }) {
    const st = style === 'custom' ? { label: 'Custom path', width: 260 } : (ROAD_STYLES[style] || ROAD_STYLES.asphalt);
    const road = { style, width: Math.round(width || st.width), pts: pts.map(round), closed: !!closed && pts.length > 2, smooth: smooth !== false, ...rest };
    if (style === 'custom') road.material = material | 0;
    const c = centroid(road.pts);
    return { uid: randUid(), name: name || st.label, x: c[0], y: c[1], z: c[2], road };
  }

  // A finished road: fitted to the ground and stored as one edit.
  addRoad(rec, summary) {
    this.rt.fit(rec);
    if (!this.records().includes(rec)) this.records().push(rec);
    this.commit({ type: 'add', records: [rec], rules: [], summary: summary || `Drew ${article(rec.name)}` });
    this.rt.sync();
    return rec;
  }

  // Change a road or line (fields of rec.road / rec.line); refit when its shape changed.
  update(rec, changes, summary, { refit = true } = {}) {
    const body = rec.road || rec.line;
    Object.assign(body, changes);
    for (const k of Object.keys(changes)) if (changes[k] === undefined || changes[k] === null) delete body[k];
    if (refit) this.rt.fit(rec);
    const c = centroid(body.pts);
    rec.x = c[0]; rec.y = c[1]; rec.z = c[2];
    const fields = { x: rec.x, y: rec.y, z: rec.z, [rec.road ? 'road' : 'line']: clone(body) };
    if (changes.name) fields.name = rec.name = changes.name;
    this.commit({ type: 'update', uid: rec.uid, fields, summary: summary || `Changed ${rec.name || 'the road'}` });
    this.rt.sync();
    return rec;
  }

  remove(rec, summary) {
    const list = this.records();
    const i = list.indexOf(rec);
    if (i >= 0) list.splice(i, 1);
    this.commit({ type: 'remove', uids: [rec.uid], rules: [], summary: summary || `Removed ${rec.name || 'a road'}` });
    this.rt.sync();
  }

  // ---- lines ---------------------------------------------------------------------------------

  lineRecord({ style = 'picket', pts, closed = false, smooth = false, name, scale, gaps, gates }) {
    const st = LINE_STYLES[style] || LINE_STYLES.picket;
    const line = { style, pts: pts.map((p) => p.slice(0, 3).map(Math.round)), closed: !!closed && pts.length > 2, smooth: !!smooth };
    if (scale && scale !== 1) line.scale = scale;
    if (gaps?.length) line.gaps = gaps;
    if (gates?.length) line.gates = gates;
    const c = centroid(line.pts);
    return { uid: randUid(), name: name || st.label, x: c[0], y: c[1], z: c[2], line };
  }

  addLine(rec, summary) {
    this.rt.fit(rec);
    if (!this.records().includes(rec)) this.records().push(rec);
    this.commit({ type: 'add', records: [rec], rules: [], summary: summary || `Built ${article(rec.name)}` });
    this.rt.sync();
    return rec;
  }

  // ---- nature --------------------------------------------------------------------------------

  // One painted stroke as one record.
  addPlants(items, summary) {
    if (!items.length) return null;
    const c = centroid(items.map((it) => [it[1], it[2], it[3]]));
    const rec = { uid: randUid(), name: 'Plants', x: c[0], y: c[1], z: c[2], nature: { items } };
    this.records().push(rec);
    this.commit({ type: 'add', records: [rec], rules: [], summary: summary || `Planted ${describeItems(items)}` });
    this.rt.sync();
    return rec;
  }

  // Remove plants where test(item) is true, as one edit. Returns how many went.
  erasePlants(test, summary) {
    const updates = [];
    let n = 0;
    for (const rec of this.records().filter((r) => r.nature)) {
      const items = rec.nature.items || [];
      const keep = items.filter((it) => !test(it));
      if (keep.length === items.length) continue;
      n += items.length - keep.length;
      rec.nature.items = keep;
      touchNature(rec);
      updates.push({ uid: rec.uid, fields: { nature: { items: keep } } });
    }
    if (!updates.length) return 0;
    this.commit({ type: 'update_many', updates, summary: summary || `Removed ${n} plant${n === 1 ? '' : 's'}` });
    this.rt.sync();
    return n;
  }

  // ---- scattering (the brush and the AI's paint_nature) ----------------------------------------

  // Scatter plants of `kinds` ({ id: weight }) into a circle (cx, cz, r). Returns new items.
  scatter({ kinds, cx, cz, r, density = 50, scaleJitter = 0.3, rotate = true, align = true, avoidPaths = true, avoidWater = true, existing = null, seed = Math.random() * 1e9 }) {
    const list = Object.entries(kinds).filter(([id, w]) => KIND[id] && w > 0);
    if (!list.length) return [];
    const total = list.reduce((s, [, w]) => s + w, 0);
    const pickKind = (u) => { let a = u * total; for (const [id, w] of list) { if ((a -= w) <= 0) return id; } return list[list.length - 1][0]; };
    const near = existing || this.plantIndex();
    const out = [];
    // attempts: how many of the average kind fit, times the density
    const avgSpacing = list.reduce((s, [id, w]) => s + KIND[id].spacing * w, 0) / total;
    const attempts = Math.min(400, Math.ceil(((Math.PI * r * r) / (avgSpacing * avgSpacing)) * (density / 100) * 1.4) + 1);
    let k = 0;
    for (let a = 0; a < attempts; a++) {
      const u1 = hash2(a, 1, seed), u2 = hash2(a, 2, seed), u3 = hash2(a, 3, seed), u4 = hash2(a, 4, seed), u5 = hash2(a, 5, seed);
      if (u5 > density / 100 + 0.25) continue;
      const ang = u1 * Math.PI * 2, rad = Math.sqrt(u2) * r;
      const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
      const id = pickKind(u3);
      const K = KIND[id];
      const g = this.rt.groundAt(x, z, 20000);
      if (g == null) continue;
      const water = this.rt.engine.water(x, z);
      const wet = water > -10000 && water > g + 5;
      let y = g;
      if (K.water === 'on') { if (!wet) continue; y = water; } else if (wet && (avoidWater || K.water !== 'near')) continue;
      if (avoidPaths && this.rt.pickAt(x, z, 30)) continue;
      // keep the kind's spacing to the plants around
      const sp = K.spacing * 0.9;
      if (near.some(x, z, sp)) continue;
      // the slope: trees do not grow on cliffs (up to about 53 degrees; small plants about 63)
      const n = this.normalAt(x, z, g);
      if (n[1] < (K.align === 0 ? 0.6 : 0.45)) continue;
      const s = Math.round(100 * (K.scale[0] + (K.scale[1] - K.scale[0]) * u4) * (1 + (hash2(a, 6, seed) - 0.5) * scaleJitter));
      const yaw = rotate ? Math.round(hash2(a, 7, seed) * 360) : 0;
      const tilt = align && !wet ? [Math.round(n[0] * 100), Math.round(n[2] * 100)] : [0, 0];
      const it = [id, Math.round(x), Math.round(y), Math.round(z), yaw, s, tilt[0], tilt[1]];
      out.push(it);
      near.add(x, z, K.spacing);
      if (++k > 300) break;
    }
    return out;
  }

  normalAt(x, z, g) {
    const d = 24;
    const a = this.rt.groundAt(x + d, z, g + 100) ?? g, b = this.rt.groundAt(x - d, z, g + 100) ?? g;
    const c = this.rt.groundAt(x, z + d, g + 100) ?? g, e = this.rt.groundAt(x, z - d, g + 100) ?? g;
    const nx = (b - a) / (2 * d), nz = (e - c) / (2 * d);
    const L = Math.hypot(nx, 1, nz);
    return [nx / L, 1 / L, nz / L];
  }

  // A spatial index of the plants of this area (spacing checks).
  plantIndex() {
    const cell = 128, grid = new Map();
    const key = (i, j) => `${i},${j}`;
    const idx = {
      add(x, z, sp) {
        const k = key(Math.floor(x / cell), Math.floor(z / cell));
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([x, z, sp]);
      },
      some(x, z, sp) {
        const i0 = Math.floor((x - 400) / cell), i1 = Math.floor((x + 400) / cell), j0 = Math.floor((z - 400) / cell), j1 = Math.floor((z + 400) / cell);
        for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
          for (const p of grid.get(key(i, j)) || []) {
            const need = Math.min(sp, p[2] * 0.9); // grass may grow under a tree, trees keep apart
            if (Math.hypot(p[0] - x, p[1] - z) < need) return true;
          }
        }
        return false;
      },
    };
    for (const rec of this.records().filter((r) => r.nature)) for (const it of rec.nature.items || []) idx.add(it[1], it[3], KIND[it[0]]?.spacing || 60);
    return idx;
  }
}

export function centroid(pts) {
  if (!pts.length) return [0, 0, 0];
  const s = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
  return s.map((v) => Math.round(v / pts.length));
}

export function article(name) {
  const n = String(name || 'road').toLowerCase();
  return `${/^[aeiou]/.test(n) ? 'an' : 'a'} ${n}`;
}

export function describeItems(items) {
  const counts = new Map();
  for (const it of items) counts.set(it[0], (counts.get(it[0]) || 0) + 1);
  const parts = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, c]) => `${c} ${(KIND[id]?.label || id).toLowerCase()}`);
  return parts.join(', ') + (counts.size > 3 ? ' and more' : '');
}

export function lengthOf(rec) {
  const pts = (rec.road || rec.line).pts;
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
  if ((rec.road || rec.line).closed && pts.length > 2) L += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][2] - pts[pts.length - 1][2]);
  return Math.round(L);
}

export { styleOf };
