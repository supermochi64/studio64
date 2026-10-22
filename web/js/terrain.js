// Heightmap terrain for custom levels: brushes, shape operations and auto painting
// (the level templates are in templates.js). Pure data; the engine draws whatever ends up in `h`/`m`.
import { material } from './generators.js';

export const SKIES = [
  { id: 0, name: 'Blue sky' }, { id: 8, name: 'Above the clouds' }, { id: 3, name: 'Below the clouds' },
  { id: 4, name: 'Snowy mountains' }, { id: 5, name: 'Desert' }, { id: 1, name: 'Flaming sky' },
  { id: 9, name: 'Purple sky' }, { id: 7, name: 'Green sky' }, { id: 6, name: 'Haunted' }, { id: 2, name: 'Underwater city' },
];
export const MUSIC = [
  { seq: 3, name: 'Bob-omb Battlefield' }, { seq: 5, name: 'Water (Dire, Dire Docks)' }, { seq: 8, name: 'Snow' },
  { seq: 6, name: 'Hot (Lava / Desert)' }, { seq: 9, name: 'Slide / Rainbow' }, { seq: 10, name: 'Haunted' },
  { seq: 12, name: 'Underground' }, { seq: 4, name: 'Castle' }, { seq: 7, name: 'Bowser road' },
  { seq: 25, name: 'Final Bowser' }, { seq: 22, name: 'Boss' }, { seq: 19, name: 'Merry-go-round' },
  { seq: 20, name: 'Race' }, { seq: 14, name: 'Wing cap' }, { seq: 15, name: 'Metal cap' },
  { seq: 24, name: 'Endless stairs' }, { seq: 2, name: 'Title screen' }, { seq: 33, name: 'File select' },
];
export const BRUSHES = ['raise', 'lower', 'smooth', 'flatten', 'paint'];

// ---- noise -------------------------------------------------------------------

function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function valueNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
}
export function fbm(x, y, seed = 1, octaves = 5) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise(x * freq, y * freq, seed + o * 17) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm; // about -1..1
}
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clampH = (v) => Math.max(-30000, Math.min(30000, Math.round(v)));

// ---- base64 -----------------------------------------------------------------

function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---- terrain ---------------------------------------------------------------

export class Terrain {
  constructor({ nx = 64, nz = 64, cell = 128, x0, z0, h, m } = {}) {
    this.nx = nx;
    this.nz = nz;
    this.cell = cell;
    this.x0 = x0 ?? -(nx * cell) / 2;
    this.z0 = z0 ?? -(nz * cell) / 2;
    this.h = h || new Int16Array((nx + 1) * (nz + 1));
    this.m = m || new Uint8Array(nx * nz);
  }

  static decode(t) {
    const h = new Int16Array(fromB64(t.h).buffer);
    const m = fromB64(t.m);
    return new Terrain({ nx: t.nx, nz: t.nz, cell: t.cell, x0: t.x0, z0: t.z0, h, m });
  }

  encode() {
    return { nx: this.nx, nz: this.nz, cell: this.cell, x0: this.x0, z0: this.z0,
      h: toB64(new Uint8Array(this.h.buffer, this.h.byteOffset, this.h.byteLength)), m: toB64(this.m) };
  }

  clone() { return new Terrain({ ...this, h: this.h.slice(), m: this.m.slice() }); }

  idx(i, j) { return j * (this.nx + 1) + i; }
  gx(x) { return (x - this.x0) / this.cell; }
  gz(z) { return (z - this.z0) / this.cell; }
  wx(i) { return this.x0 + i * this.cell; }
  wz(j) { return this.z0 + j * this.cell; }
  contains(x, z) { const i = this.gx(x), j = this.gz(z); return i >= 0 && j >= 0 && i <= this.nx && j <= this.nz; }
  bounds() { return { minX: this.x0, maxX: this.x0 + this.nx * this.cell, minZ: this.z0, maxZ: this.z0 + this.nz * this.cell }; }

  heightAt(x, z) {
    const fi = Math.max(0, Math.min(this.nx, this.gx(x))), fj = Math.max(0, Math.min(this.nz, this.gz(z)));
    const i = Math.min(this.nx - 1, Math.floor(fi)), j = Math.min(this.nz - 1, Math.floor(fj));
    const u = fi - i, v = fj - j;
    const a = this.h[this.idx(i, j)], b = this.h[this.idx(i + 1, j)], c = this.h[this.idx(i, j + 1)], d = this.h[this.idx(i + 1, j + 1)];
    return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
  }

  // Calls fn(i, j, x, z) for every grid point; returns the dirty rectangle.
  forPoints(fn, x0 = -1e9, z0 = -1e9, x1 = 1e9, z1 = 1e9) {
    const i0 = Math.max(0, Math.floor(this.gx(x0))), i1 = Math.min(this.nx, Math.ceil(this.gx(x1)));
    const j0 = Math.max(0, Math.floor(this.gz(z0))), j1 = Math.min(this.nz, Math.ceil(this.gz(z1)));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(i, j, this.wx(i), this.wz(j));
    return { i0: Math.max(0, i0 - 1), j0: Math.max(0, j0 - 1), i1: Math.min(this.nx, i1 + 1), j1: Math.min(this.nz, j1 + 1) };
  }

  // Interactive brushes. strength: units per dab (raise/lower) or 0..100 (smooth/flatten).
  brush(mode, x, z, r, strength, target = 0) {
    const fall = (d) => { const t = d / r; if (t >= 1) return 0; const q = 1 - t * t; return q * q; };
    if (mode === 'smooth') {
      const src = this.h.slice();
      const k = Math.min(1, strength / 100);
      return this.forPoints((i, j, px, pz) => {
        const w = fall(Math.hypot(px - x, pz - z));
        if (!w) return;
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii > this.nx || jj > this.nz) continue;
          s += src[this.idx(ii, jj)]; n++;
        }
        const id = this.idx(i, j);
        this.h[id] = clampH(src[id] + (s / n - src[id]) * k * w);
      }, x - r, z - r, x + r, z + r);
    }
    return this.forPoints((i, j, px, pz) => {
      const w = fall(Math.hypot(px - x, pz - z));
      if (!w) return;
      const id = this.idx(i, j);
      if (mode === 'raise') this.h[id] = clampH(this.h[id] + strength * w);
      else if (mode === 'lower') this.h[id] = clampH(this.h[id] - strength * w);
      else if (mode === 'flatten') this.h[id] = clampH(this.h[id] + (target - this.h[id]) * Math.min(1, strength / 100) * w);
    }, x - r, z - r, x + r, z + r);
  }

  paint(mat, x, z, r) {
    const mi = material(mat);
    const i0 = Math.max(0, Math.floor(this.gx(x - r))), i1 = Math.min(this.nx - 1, Math.ceil(this.gx(x + r)));
    const j0 = Math.max(0, Math.floor(this.gz(z - r))), j1 = Math.min(this.nz - 1, Math.ceil(this.gz(z + r)));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cx = this.wx(i + 0.5), cz = this.wz(j + 0.5);
      if (Math.hypot(cx - x, cz - z) <= r) this.m[j * this.nx + i] = mi;
    }
    return { i0, j0, i1: i1 + 1, j1: j1 + 1 };
  }

  // ---- shape operations (used by templates and by Claude) ----------------------

  op(o) {
    const all = { i0: 0, j0: 0, i1: this.nx, j1: this.nz };
    const add = (fn) => { this.forPoints((i, j, x, z) => { const id = this.idx(i, j); this.h[id] = clampH(fn(this.h[id], x, z)); }); return all; };
    const d = (x, z) => Math.hypot(x - (o.x ?? 0), z - (o.z ?? 0));
    const r = o.radius ?? 1500;
    switch (o.op) {
      case 'hill': return add((h, x, z) => h + (o.height ?? 800) * Math.exp(-Math.pow(d(x, z) / (r * 0.55), 2)));
      case 'mountain': return add((h, x, z) => {
        const t = d(x, z) / r;
        if (t >= 1.4) return h;
        const peak = Math.pow(Math.max(0, 1 - t), 1.6);
        const rough = 1 + fbm(x / 900, z / 900, o.seed ?? 3) * 0.25;
        return h + (o.height ?? 3000) * peak * rough;
      });
      case 'valley': case 'crater': return add((h, x, z) => {
        const t = d(x, z) / r;
        if (o.op === 'valley') return h - (o.depth ?? 600) * Math.exp(-Math.pow(t / 0.55, 2));
        const rim = (o.rim ?? 300) * Math.exp(-Math.pow((t - 1) / 0.25, 2));
        return h + rim - (o.depth ?? 700) * (1 - smoothstep(0.6, 1.0, t));
      });
      case 'plateau': return add((h, x, z) => {
        const t = d(x, z) / r;
        const target = o.height ?? 800;
        const w = 1 - smoothstep(0.75, 1.15, t);
        return h + (target - h) * w;
      });
      case 'flatten': return add((h, x, z) => {
        const w = 1 - smoothstep(0.7, 1.0, d(x, z) / r);
        return h + ((o.height ?? 0) - h) * w;
      });
      case 'raise': case 'lower': return add((h, x, z) => {
        const w = 1 - smoothstep(0.5, 1.0, d(x, z) / r);
        return h + (o.op === 'lower' ? -1 : 1) * (o.amount ?? o.height ?? 300) * w;
      });
      case 'ridge': case 'carve_path': case 'river': {
        const pts = o.points || [o.from, o.to].filter(Boolean);
        if (pts.length < 2) throw new Error(`${o.op} needs points (or from/to)`);
        const width = o.width ?? (o.op === 'ridge' ? 900 : 400);
        return add((h, x, z) => {
          let best = Infinity;
          for (let k = 1; k < pts.length; k++) best = Math.min(best, segDist(x, z, pts[k - 1], pts[k]));
          const w = 1 - smoothstep(width * 0.35, width * 0.5 + 150, best);
          if (!w) return h;
          if (o.op === 'ridge') return h + (o.height ?? 900) * w;
          if (o.op === 'river') return h + ((o.depth !== undefined ? -o.depth : (o.height ?? -300)) - h) * w;
          // a path keeps a smooth height: blend toward the local average along it
          return h + ((o.height ?? h) - h) * w;
        });
      }
      case 'noise': return add((h, x, z) => h + fbm(x / (o.scale ?? 1800), z / (o.scale ?? 1800), o.seed ?? 7) * (o.amount ?? 250));
      case 'terraces': return add((h) => Math.round(h / (o.step ?? 250)) * (o.step ?? 250) * 0.7 + h * 0.3);
      case 'island': return add((h, x, z) => {
        const t = d(x, z) / (o.radius ?? 3600);
        const land = 1 - smoothstep(0.55, 1.0, t);
        return h * land + (o.height ?? 400) * land + (o.seaFloor ?? -500) * (1 - land);
      });
      case 'set': case 'fill': return add(() => o.height ?? 0);
      case 'scale': return add((h) => h * (o.factor ?? 1));
      case 'smooth': this.blur(o.passes ?? 2); return all;
      case 'heightmap': return this.fromGrid(o.grid, o.min ?? 0, o.max ?? 2000, o.blend ?? 1);
      case 'paint': {
        if (o.x === undefined) { this.m.fill(material(o.material)); return all; }
        return this.paint(o.material, o.x, o.z, r);
      }
      case 'paint_auto': this.autoPaint(o); return all;
      default: throw new Error(`unknown terrain op "${o.op}"`);
    }
  }

  // A coarse grid of numbers (rows from min z to max z, columns from min x to max x),
  // 0..1 or raw heights, smoothly stretched over the whole terrain.
  fromGrid(grid, min, max, blend = 1) {
    const rows = grid.length, cols = grid[0].length;
    const flat = grid.flat();
    const lo = Math.min(...flat), hi = Math.max(...flat);
    const unit = hi <= 1 && lo >= 0;
    const sample = (u, v) => {
      const x = u * (cols - 1), y = v * (rows - 1);
      const xi = Math.min(cols - 2, Math.floor(x)), yi = Math.min(rows - 2, Math.floor(y));
      const fx = x - xi, fy = y - yi;
      const g = (a, b) => grid[Math.max(0, Math.min(rows - 1, b))][Math.max(0, Math.min(cols - 1, a))];
      // smooth (cubic-ish) blend between cells
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const top = g(xi, yi) * (1 - sx) + g(xi + 1, yi) * sx;
      const bot = g(xi, yi + 1) * (1 - sx) + g(xi + 1, yi + 1) * sx;
      return top * (1 - sy) + bot * sy;
    };
    this.forPoints((i, j) => {
      const raw = cols < 2 || rows < 2 ? flat[0] : sample(i / this.nx, j / this.nz);
      const target = unit ? min + raw * (max - min) : raw;
      const id = this.idx(i, j);
      this.h[id] = clampH(this.h[id] * (1 - blend) + target * blend);
    });
    return { i0: 0, j0: 0, i1: this.nx, j1: this.nz };
  }

  // Box blur of the whole heightmap (passes x 3x3).
  blur(passes = 1) {
    for (let p = 0; p < passes; p++) {
      const src = this.h.slice();
      for (let j = 0; j <= this.nz; j++) for (let i = 0; i <= this.nx; i++) {
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii > this.nx || jj > this.nz) continue;
          s += src[this.idx(ii, jj)]; n++;
        }
        this.h[this.idx(i, j)] = clampH(s / n);
      }
    }
  }

  // Materials from height and slope.
  autoPaint({ water = null, beach = 'sand', base = 'grass', steep = 'rock', high = null, highLine = 2400, low = null, lowLine = null, steepness = 0.75 } = {}) {
    const mb = material(base), ms = material(steep), mbeach = material(beach);
    const mh = high ? material(high) : null, ml = low ? material(low) : null;
    for (let j = 0; j < this.nz; j++) for (let i = 0; i < this.nx; i++) {
      const a = this.h[this.idx(i, j)], b = this.h[this.idx(i + 1, j)], c = this.h[this.idx(i, j + 1)], d = this.h[this.idx(i + 1, j + 1)];
      const avg = (a + b + c + d) / 4;
      const slope = Math.max(Math.abs(a - d), Math.abs(b - c)) / (this.cell * Math.SQRT2);
      let m = mb;
      if (ml !== null && lowLine !== null && avg < lowLine) m = ml;
      else if (water !== null && avg < water + 60) m = mbeach;
      else if (slope > steepness) m = ms;
      else if (mh !== null && avg > highLine + fbm(i / 6, j / 6, 5) * 150) m = mh;
      this.m[j * this.nx + i] = m;
    }
  }
}

function segDist(x, z, a, b) {
  const ax = a[0] ?? a.x, az = a[1] ?? a.z, bx = b[0] ?? b.x, bz = b[1] ?? b.z;
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

// A grayscale image becomes the terrain heights (dark = low, bright = high).
export async function terrainFromImage(file, { min = -200, max = 2500, nx = 128, nz = 128 } = {}) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = url; });
  const c = document.createElement('canvas');
  c.width = nx + 1; c.height = nz + 1;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, nx + 1, nz + 1);
  const d = g.getImageData(0, 0, nx + 1, nz + 1).data;
  URL.revokeObjectURL(url);
  const t = new Terrain({ nx, nz, cell: 8192 / nx });
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const k = (j * (nx + 1) + i) * 4;
    const lum = (d[k] * 0.3 + d[k + 1] * 0.59 + d[k + 2] * 0.11) / 255;
    t.h[t.idx(i, j)] = clampH(min + lum * (max - min));
  }
  t.blur(2);
  t.autoPaint({ water: min + (max - min) * 0.08, high: 'snow', highLine: min + (max - min) * 0.8 });
  return t;
}
