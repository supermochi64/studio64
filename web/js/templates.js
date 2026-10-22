// Level templates: finished-looking starting points for custom levels. Each one
// shapes a heightmap, carves walkable paths, paints it naturally and places a
// landmark built from blocks plus trees, rocks, wildlife and a few coins.
import { Terrain, fbm } from './terrain.js';
import { GENERATORS, blockDefaults, material } from './generators.js';

export const TEMPLATES = {
  island: { label: 'Tropical island', sky: 0, music: 3 },
  meadow: { label: 'Rolling meadow', sky: 0, music: 3 },
  mountain: { label: 'Mountain', sky: 4, music: 8 },
  desert: { label: 'Desert dunes', sky: 5, music: 6 },
  snow: { label: 'Snow land', sky: 4, music: 8 },
  lava: { label: 'Lava land', sky: 1, music: 7 },
  canyon: { label: 'Canyon', sky: 5, music: 6 },
  flat: { label: 'Flat grass', sky: 0, music: 3 },
  sky: { label: 'Sky islands', sky: 8, music: 9 },
};

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const clampH = (v) => Math.max(-30000, Math.min(30000, Math.round(v)));
const ridged = (x, z, seed) => 1 - Math.abs(fbm(x, z, seed, 4));
const NORTH = 0x8000; // yaw facing -Z
const yawTo = (dx, dz) => Math.round((Math.atan2(dx, dz) / Math.PI) * 32768) & 0xffff;

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = {
  'tree:bubbly_tree': 'Tree', 'tree:palm_tree': 'Palm tree', 'tree:snow_tree': 'Snowy pine', 'tree:spiky_tree': 'Pine tree',
  rock_solid: 'Rock', butterfly: 'Butterfly', triplet_butterfly: 'Butterflies', bird: 'Birds', fish_group: 'Fish',
  'prop:seaweed': 'Seaweed', coin_formation: 'Coins', goomba: 'Goomba', small_bully: 'Bully', pokey: 'Pokey',
  small_penguin: 'Penguin', spindrift: 'Spindrift', 'flame:red_flame': 'Flame', 'prop:koopa_flag': 'Flag', recovery_heart: 'Heart',
};

class Builder {
  constructor(seed) {
    this.seed = seed;
    this.rand = mulberry32(seed);
    this.t = new Terrain({ nx: 128, nz: 128, cell: 64 });
    this.half = 4096;
    this.water = null;
    this.paths = [];
    this.keep = [];      // circles that decorations stay out of (structures, spawn)
    this.blocks = [];
    this.objects = [];
  }

  r(a = 0, b = 1) { return a + (b - a) * this.rand(); }
  h(x, z) { return this.t.heightAt(x, z); }
  edge(x, z) { return Math.min(this.half - Math.abs(x), this.half - Math.abs(z)); }
  slope(x, z) {
    const e = 64;
    return Math.hypot(this.h(x + e, z) - this.h(x - e, z), this.h(x, z + e) - this.h(x, z - e)) / (2 * e);
  }

  // Sets every grid point from fn(x, z, h).
  shape(fn) {
    const t = this.t;
    t.forPoints((i, j, x, z) => { const id = t.idx(i, j); t.h[id] = clampH(fn(x, z, t.h[id])); });
  }

  // Hills rising toward the edges, so the level is a valley with a natural border.
  border(height, width = 1100, seed = 31) {
    this.shape((x, z, h) => {
      const w = 1 - smoothstep(0, width, this.edge(x, z));
      return h + w * w * height * (0.75 + 0.5 * fbm(x / 900, z / 900, this.seed + seed));
    });
  }

  bump(x0, z0, r, height, power = 2) {
    this.shape((x, z, h) => h + height * Math.exp(-Math.pow(Math.hypot(x - x0, z - z0) / (r * 0.55), power)));
  }

  // Blends a round area toward one height (a flat top, a plaza, a building site).
  flat(x0, z0, r, height = this.h(x0, z0), soft = 0.45) {
    this.shape((x, z, h) => h + (height - h) * (1 - smoothstep(r, r * (1 + soft), Math.hypot(x - x0, z - z0))));
    return height;
  }

  // A walkable path along `points`: its height follows the ground, smoothed and
  // kept under maxGrade, and the ground around blends into it.
  path(points, { width = 340, material: mat = 'dirt', maxGrade = 0.26, paint = true, blend = 320 } = {}) {
    const pts = [];
    for (let k = 1; k < points.length; k++) {
      const [ax, az] = points[k - 1], [bx, bz] = points[k];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 48));
      for (let s = 0; s < n; s++) pts.push([lerp(ax, bx, s / n), lerp(az, bz, s / n)]);
    }
    pts.push(points[points.length - 1]);
    let hs = pts.map(([x, z]) => this.h(x, z));
    for (let pass = 0; pass < 8; pass++) hs = hs.map((v, i) => (hs[Math.max(0, i - 2)] + hs[Math.max(0, i - 1)] + v + hs[Math.min(hs.length - 1, i + 1)] + hs[Math.min(hs.length - 1, i + 2)]) / 5);
    const step = 48 * maxGrade;
    for (let i = 1; i < hs.length; i++) hs[i] = Math.max(hs[i - 1] - step, Math.min(hs[i - 1] + step, hs[i]));
    for (let i = hs.length - 2; i >= 0; i--) hs[i] = Math.max(hs[i + 1] - step, Math.min(hs[i + 1] + step, hs[i]));
    const inner = width * 0.5, outer = inner + blend; // blend: how far the ground eases into the path
    this.shape((x, z, h) => {
      let best = Infinity, bh = 0;
      for (let i = 0; i < pts.length; i += 2) {
        const d = Math.hypot(x - pts[i][0], z - pts[i][1]);
        if (d < best) { best = d; bh = hs[i]; }
      }
      if (best >= outer) return h;
      return h + (bh - h) * (1 - smoothstep(inner, outer, best));
    });
    const p = { pts, hs, width, material: mat, paint };
    this.paths.push(p);
    return p;
  }

  // Point and heading at fraction f along a path.
  along(p, f) {
    const i = Math.max(0, Math.min(p.pts.length - 2, Math.round(f * (p.pts.length - 1))));
    const [x, z] = p.pts[i], [x2, z2] = p.pts[i + 1];
    return { x, z, y: this.h(x, z), yaw: yawTo(x2 - x, z2 - z) };
  }

  nearPath(x, z, margin) {
    for (const p of this.paths) {
      for (let i = 0; i < p.pts.length; i += 3) if (Math.hypot(x - p.pts[i][0], z - p.pts[i][1]) < p.width * 0.5 + margin) return true;
    }
    return false;
  }

  // Materials by height and slope, with noisy borders and patches of a second
  // ground material, then the paths on top.
  paint({ base = 'grass', alt = 'dark grass', altAmount = 0.28, steep = 'rock', steepness = 0.8, mid = null, midSteepness = 0.5,
    beach = 'sand', beachLine = 70, high = null, highLine = 2400, low = null, lowLine = -1e9, under = null } = {}) {
    const t = this.t, M = (m) => material(m);
    for (let j = 0; j < t.nz; j++) for (let i = 0; i < t.nx; i++) {
      const x = t.wx(i + 0.5), z = t.wz(j + 0.5);
      const a = t.h[t.idx(i, j)], b = t.h[t.idx(i + 1, j)], c = t.h[t.idx(i, j + 1)], d = t.h[t.idx(i + 1, j + 1)];
      const avg = (a + b + c + d) / 4;
      const slope = Math.max(Math.abs(a - d), Math.abs(b - c)) / (t.cell * Math.SQRT2);
      const n = fbm(x / 650, z / 650, this.seed + 5, 3);
      let m = base;
      if (alt && fbm(x / 1100, z / 1100, this.seed + 9, 3) > 0.32 - altAmount) m = alt;
      if (mid && slope > midSteepness + n * 0.1) m = mid;
      if (slope > steepness + n * 0.12) m = steep;
      if (high && avg > highLine + n * 220 && slope < steepness + 0.25) m = high;
      if (this.water !== null && avg < this.water + beachLine + n * 45) m = avg < this.water - 60 && under ? under : beach;
      if (low && avg < lowLine + n * 30) m = low;
      t.m[j * t.nx + i] = M(m);
    }
    for (const p of this.paths) {
      if (!p.paint) continue;
      for (let j = 0; j < t.nz; j++) for (let i = 0; i < t.nx; i++) {
        const x = t.wx(i + 0.5), z = t.wz(j + 0.5);
        const r = p.width * 0.5 * (0.85 + 0.3 * fbm(x / 300, z / 300, this.seed + 13, 2));
        for (let k = 0; k < p.pts.length; k += 2) {
          if (Math.hypot(x - p.pts[k][0], z - p.pts[k][1]) < r) { t.m[j * t.nx + i] = M(p.material); break; }
        }
      }
    }
  }

  paintDisc(x0, z0, r, mat) {
    const t = this.t;
    for (let j = 0; j < t.nz; j++) for (let i = 0; i < t.nx; i++) {
      const x = t.wx(i + 0.5), z = t.wz(j + 0.5);
      if (Math.hypot(x - x0, z - z0) < r * (0.9 + 0.2 * fbm(x / 300, z / 300, this.seed + 17, 2))) t.m[j * t.nx + i] = material(mat);
    }
  }

  block(b, x, y, z, yaw = 0, name) {
    const block = blockDefaults(b);
    this.blocks.push({ block, x: Math.round(x), y: Math.round(y), z: Math.round(z), yaw: yaw & 0xffff, pitch: 0, roll: 0, name: name || `${b.top || b.material || 'Grass'} block` });
  }

  build(kind, params, name) {
    for (const r of GENERATORS[kind].build(params)) this.blocks.push({ ...r, name });
  }

  obj(entry, x, z, { y, lift = 0, yaw = this.r(0, 65536), bparams = 0, scale = 1, name } = {}) {
    this.objects.push({ entry, x: Math.round(x), y: Math.round(y ?? this.h(x, z) + lift), z: Math.round(z), yaw: yaw & 0xffff, pitch: 0, roll: 0,
      bparams: bparams >>> 0, scale, name: name || NAMES[entry] || entry });
  }

  // Random placements that keep their distance from each other, the paths and the keep-out circles.
  scatter(entry, count, { where = () => true, minDist = 450, maxSlope = 0.55, pathMargin = 160, above = -1e9, below = 1e9, scale = [1, 1], lift = 0, bparams = 0, inset = 300 } = {}) {
    const placed = [];
    for (let tries = 0; tries < count * 60 && placed.length < count; tries++) {
      const x = this.r(-this.half + inset, this.half - inset), z = this.r(-this.half + inset, this.half - inset);
      const y = this.h(x, z);
      if (y < above || y > below || !where(x, z, y) || this.slope(x, z) > maxSlope) continue;
      if (this.nearPath(x, z, pathMargin) || this.keep.some((k) => Math.hypot(x - k.x, z - k.z) < k.r)) continue;
      if (placed.some((p) => Math.hypot(x - p[0], z - p[1]) < minDist)) continue;
      if (this.objects.some((o) => o.entry === entry && Math.hypot(x - o.x, z - o.z) < minDist)) continue;
      placed.push([x, z]);
      this.obj(entry, x, z, { lift, scale: Math.round(this.r(scale[0], scale[1]) * 100) / 100, bparams });
    }
    return placed;
  }

  // A bridge between two points on the ground (heights from the terrain unless given).
  bridge(a, b, { width = 300, material: mat = 'wood planks', y1, y2, name = 'Bridge' } = {}) {
    this.build('bridge', { x: a[0], y: y1 ?? this.h(a[0], a[1]) + 6, z: a[1], x2: b[0], y2: y2 ?? this.h(b[0], b[1]) + 6, z2: b[1], width, thickness: 50, material: mat }, name);
    this.keep.push({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, r: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + 200 });
  }

  // Where a path dips below `level` (a stream crossing): the banks on either side.
  crossing(p, level) {
    let first = -1, last = -1;
    for (let i = 0; i < p.pts.length; i++) {
      if (this.h(p.pts[i][0], p.pts[i][1]) < level) { if (first < 0) first = i; last = i; }
    }
    if (first < 0) return null;
    const a = p.pts[Math.max(0, first - 4)], b = p.pts[Math.min(p.pts.length - 1, last + 4)];
    return [a, b];
  }

  coins(x, z, { ring = false, yaw = 0, lift = 30, y } = {}) {
    this.obj('coin_formation', x, z, { y, lift, yaw, bparams: ring ? 0x00020000 : 0 });
  }

  result(tpl, spawn, water = null) {
    const settings = { sky: tpl.sky, music: tpl.music, water: water ? { on: true, height: water.height, extent: water.extent || 8000 } : { on: false, height: 0 } };
    return { terrain: this.t, settings, spawn: { ...spawn, x: Math.round(spawn.x), y: Math.round(spawn.y), z: Math.round(spawn.z) }, blocks: this.blocks, objects: this.objects };
  }
}

// Points of a spiral around (cx, cz) from radius r0 to r1, starting at angle a0 (0 = +Z).
function spiral(cx, cz, r0, r1, a0, turns, n = 48) {
  return Array.from({ length: n + 1 }, (_, k) => {
    const f = k / n, a = a0 + f * turns * Math.PI * 2, r = lerp(r0, r1, f);
    return [cx + Math.sin(a) * r, cz + Math.cos(a) * r];
  });
}

// ---- the templates -------------------------------------------------------------

const BUILD = {
  meadow(b, tpl) {
    const s = b.seed, W = -140;
    b.water = W;
    b.shape((x, z) => 230 + fbm(x / 2600, z / 2600, s) * 230 + fbm(x / 700, z / 700, s + 1) * 30);
    b.border(1500, 1150);
    // the landmark: a round hill with a flat top
    b.bump(1900, -1750, 2400, 1000);
    b.flat(1900, -1750, 420, b.h(1900, -1750) - 30);
    // a pond fed by a stream
    b.shape((x, z, h) => {
      const d = Math.hypot(x + 1850, z - 1450) / (900 * (1 + 0.18 * fbm(x / 500, z / 500, s + 3)));
      return h + (W - 280 - h) * (1 - smoothstep(0.5, 1.25, d));
    });
    const main = b.path([[0, 2450], [180, 2000], [-180, 1300], [250, 350], [950, -650], [1450, -1250], [1850, -1700]], { width: 330, material: 'dirt' });
    b.path([[-180, 1300], [-850, 1150], [-1200, 1250]], { width: 280, material: 'dirt' });
    b.t.op({ op: 'river', points: [[-1500, 1450], [-600, 1600], [350, 1650], [1500, 1950], [2900, 2500]], width: 520, depth: -W + 150 });
    b.paint({ base: 'grass', alt: 'dark grass', steep: 'rock', steepness: 0.95, mid: 'dirt', midSteepness: 0.62, beachLine: 75 });
    const cross = b.crossing(main, W + 20);
    if (cross) b.bridge(cross[0], cross[1], { width: 320 });
    b.keep.push({ x: 0, z: 2450, r: 500 }, { x: 1900, z: -1750, r: 380 });
    // a lookout tower on the hill
    const top = b.h(1900, -1750);
    b.build('spiral', { x: 2150, y: top, z: -2000, radius: 300, steps: 14, rise: 55, width: 220, material: 'castle stone' }, 'Lookout tower');
    b.keep.push({ x: 2150, z: -2000, r: 450 });
    b.scatter('tree:bubbly_tree', 30, { where: (x, z) => b.edge(x, z) < 1500 || fbm(x / 1500, z / 1500, s + 21) > 0.15, minDist: 420, maxSlope: 0.65, above: W + 80, scale: [0.85, 1.25] });
    b.scatter('rock_solid', 6, { minDist: 900, above: W + 40, scale: [0.4, 0.75], maxSlope: 0.5 });
    b.scatter('triplet_butterfly', 3, { above: W + 60, minDist: 1200 });
    b.scatter('bird', 2, { where: (x, z) => b.edge(x, z) < 1600, minDist: 2000, maxSlope: 2 });
    b.scatter('goomba', 3, { where: (x, z) => Math.hypot(x, z - 2450) > 1500, above: W + 60, minDist: 900, maxSlope: 0.4 });
    for (const f of [0.22, 0.48, 0.74]) { const p = b.along(main, f); b.coins(p.x, p.z, { yaw: p.yaw }); }
    b.coins(1900, -1750, { ring: true, y: top + 30 });
    return b.result(tpl, { x: 0, y: b.h(0, 2450) + 200, z: 2450, yaw: NORTH }, { height: W, extent: 4096 });
  },

  island(b, tpl) {
    const s = b.seed;
    b.water = 0;
    b.shape((x, z) => {
      const wx = x + fbm(x / 1500, z / 1500, s) * 520, wz = z + fbm(x / 1500 + 7, z / 1500 + 3, s) * 520;
      const d = Math.hypot(wx, wz * 1.08) / 2900;
      let h = 170 + fbm(x / 1500, z / 1500, s + 2) * 110 + (1 - Math.min(1, d)) * 220;
      h = lerp(h, 45, smoothstep(0.6, 0.85, d));
      h = lerp(h, -30, smoothstep(0.86, 0.97, d));
      h = lerp(h, -520, smoothstep(0.97, 1.12, d));
      return lerp(h, -820 + fbm(x / 900, z / 900, s + 4) * 90, smoothstep(1.12, 1.5, d));
    });
    // a peak with a lookout, and a cove on the west side
    b.shape((x, z, h) => {
      const d = Math.hypot(x - 650, z + 750) / 1750;
      if (d >= 1.3) return h;
      return h + 1450 * Math.pow(Math.max(0, 1 - d), 1.5) * (0.85 + 0.3 * ridged(x / 900, z / 900, s + 6));
    });
    b.flat(650, -750, 300, b.h(650, -750) - 60);
    b.shape((x, z, h) => lerp(h, Math.min(h, -320), 1 - smoothstep(0.45, 1.0, Math.hypot(x + 2550, z - 250) / 1050)));
    // the pier: find the beach due south of the center
    let beachZ = 1500;
    while (beachZ < 3800 && b.h(0, beachZ) > 25) beachZ += 40;
    const spawnZ = beachZ - 450;
    const trail = b.path([[0, spawnZ], [-350, spawnZ - 700]].concat(spiral(650, -750, 1900, 260, -0.7, 1.1, 40)), { width: 300, material: 'dirt' });
    b.paint({ base: 'grass', alt: 'dark grass', steep: 'rock', steepness: 0.9, beachLine: 105, under: 'sand' });
    const deckY = 70, pierLen = 1300;
    b.block({ shape: 0, sx: 300, sy: 40, sz: pierLen, top: 'wood planks', side: 'wood planks' }, 0, deckY - 40, beachZ - 120 + pierLen / 2, 0, 'Pier');
    b.block({ shape: 0, sx: 700, sy: 40, sz: 600, top: 'wood planks', side: 'wood planks' }, 0, deckY - 40, beachZ - 120 + pierLen + 280, 0, 'Pier end');
    for (let k = 0; k * 330 < pierLen + 400; k++) {
      for (const sx of [-130, 130]) {
        const z = beachZ + k * 330, ground = b.h(sx, z);
        if (ground < deckY - 60) b.block({ shape: 3, sx: 60, sy: deckY - 40 - ground + 60, sz: 60, top: 'wood planks', side: 'wood planks' }, sx, ground - 60, z, 0, 'Pier post');
      }
    }
    b.keep.push({ x: 0, z: beachZ + pierLen / 2, r: 500 }, { x: 0, z: spawnZ, r: 450 }, { x: 650, z: -750, r: 330 });
    b.scatter('tree:palm_tree', 18, { above: 18, below: 160, minDist: 380, maxSlope: 0.5, scale: [0.9, 1.3] });
    b.scatter('tree:bubbly_tree', 9, { above: 180, minDist: 520, maxSlope: 0.55 });
    b.scatter('rock_solid', 7, { above: -260, below: 10, minDist: 700, maxSlope: 1.2, scale: [0.5, 1.1], pathMargin: 0 });
    b.scatter('prop:seaweed', 14, { above: -900, below: -200, minDist: 350, maxSlope: 2, pathMargin: 0 });
    b.scatter('fish_group', 3, { below: -380, minDist: 1800, maxSlope: 2, lift: 260, pathMargin: 0 });
    b.scatter('triplet_butterfly', 2, { above: 150, minDist: 1500 });
    b.scatter('bird', 2, { above: 300, minDist: 2000, maxSlope: 2 });
    b.coins(0, beachZ + pierLen + 280, { ring: true, y: deckY + 30 });
    for (const f of [0.3, 0.62]) { const p = b.along(trail, f); b.coins(p.x, p.z, { yaw: p.yaw }); }
    b.coins(650, -750, { ring: true, y: b.h(650, -750) + 30 });
    return b.result(tpl, { x: 0, y: b.h(0, spawnZ) + 200, z: spawnZ, yaw: NORTH }, { height: 0, extent: 8000 });
  },

  mountain(b, tpl) {
    const s = b.seed, cx = 0, cz = -700;
    b.shape((x, z) => 150 + fbm(x / 2200, z / 2200, s) * 160);
    b.border(1700, 1100);
    b.shape((x, z, h) => {
      const d = Math.hypot(x - cx, z - cz) / 2900;
      if (d >= 1.2) return h;
      return h + 2900 * Math.pow(Math.max(0, 1 - d), 1.3) * (0.8 + 0.32 * ridged(x / 1000, z / 1000, s + 2));
    });
    const peak = b.flat(cx, cz, 260, b.h(cx, cz) - 80);
    // a ledge trail winding up; a narrow blend keeps natural slopes between its loops
    const trail = b.path([[0, 2350], [0, 2050]].concat(spiral(cx, cz, 2700, 240, 0, 1.5, 56)), { width: 360, material: 'cobblestone', maxGrade: 0.3, blend: 150 });
    b.paint({ base: 'grass', alt: 'dark grass', steep: 'rock', steepness: 1.05, mid: 'dirt', midSteepness: 0.7, high: 'snow', highLine: 2050 });
    b.keep.push({ x: 0, z: 2350, r: 450 }, { x: 0, z: 3100, r: 650 }, { x: cx, z: cz, r: 320 });
    b.obj('prop:koopa_flag', cx + 120, cz - 60, { y: peak });
    b.coins(cx, cz, { ring: true, y: peak + 30 });
    b.scatter('tree:spiky_tree', 26, { below: 1200, minDist: 380, maxSlope: 0.7, scale: [0.9, 1.4] });
    b.scatter('tree:snow_tree', 12, { above: 1200, below: 2100, minDist: 420, maxSlope: 0.75 });
    b.scatter('rock_solid', 7, { minDist: 900, maxSlope: 0.8, scale: [0.4, 0.8] });
    b.scatter('bird', 3, { minDist: 1800, maxSlope: 2, above: 400 });
    b.scatter('goomba', 2, { below: 600, minDist: 1200, maxSlope: 0.35, where: (x, z) => Math.hypot(x, z - 2350) > 1200 });
    for (const f of [0.2, 0.45, 0.7]) { const p = b.along(trail, f); b.coins(p.x, p.z, { yaw: p.yaw }); }
    return b.result(tpl, { x: 0, y: b.h(0, 2350) + 200, z: 2350, yaw: NORTH });
  },

  desert(b, tpl) {
    const s = b.seed, W = -60;
    b.water = W;
    b.shape((x, z) => {
      const ph = (x * 0.8 + z * 0.6) / 520 + fbm(x / 2600, z / 2600, s) * 4;
      const dune = Math.pow(1 - Math.abs(Math.sin(ph)), 2) * 170;
      return 240 + dune + fbm(x / 1900, z / 1900, s + 1) * 140;
    });
    b.border(1500, 1250);
    b.shape((x, z, h) => (b.edge(x, z) < 1300 ? lerp(h, Math.round(h / 260) * 260, 0.75) : h));
    // oasis
    b.shape((x, z, h) => {
      const d = Math.hypot(x + 1700, z - 1550) / (720 * (1 + 0.15 * fbm(x / 400, z / 400, s + 3)));
      return h + (W - 230 - h) * (1 - smoothstep(0.45, 1.3, d));
    });
    // the pyramid on a flat site, with stairs up its south face
    const px = 1450, pz = -1500;
    const base = b.flat(px, pz, 1300, b.h(px, pz));
    const tiers = 6, tierH = 190;
    for (let k = 0; k < tiers; k++) {
      const size = 1900 - k * 300;
      // the bottom tier reaches into the ground so it never floats over a dip
      b.block({ shape: 0, sx: size, sy: tierH + (k ? 0 : 80), sz: size, top: 'sand', side: 'stone block' }, px, base + k * tierH - (k ? 0 : 80), pz, 0, 'Pyramid');
    }
    // stairs from in front of the pyramid up to its top, above the terraces all the way
    const stairDepth = 1200;
    b.block({ shape: 2, sx: 360, sy: tiers * tierH, sz: stairDepth, steps: 28, top: 'stone block', side: 'stone block' }, px, base, pz + 1350 - stairDepth / 2, NORTH, 'Pyramid stairs');
    b.keep.push({ x: px, z: pz, r: 1250 });
    b.coins(px, pz, { ring: true, y: base + tiers * tierH + 30 });
    // ruins: a circle of broken pillars on a stone floor
    const rx = -1500, rz = -1300, rbase = b.flat(rx, rz, 650, b.h(rx, rz));
    b.paintDisc(rx, rz, 640, 'stone path');
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2, tall = [700, 420, 650, 260, 700, 520, 330, 700][k];
      b.block({ shape: 3, sx: 150, sy: tall, sz: 150, top: 'stone block', side: 'stone block' }, rx + Math.sin(a) * 500, rbase - 20, rz + Math.cos(a) * 500, 0, 'Ruin pillar');
    }
    b.block({ shape: 0, sx: 160, sy: 140, sz: 480, top: 'stone block', side: 'stone block' }, rx + 120, rbase - 20, rz + 80, 0x2400, 'Fallen pillar');
    b.keep.push({ x: rx, z: rz, r: 750 });
    const trail = b.path([[0, 2250], [-250, 2100], [200, 900], [900, 0], [1450, -450]], { width: 300, material: 'stone path' });
    b.path([[-250, 2100], [-1000, 1850]], { width: 260, material: 'stone path' });
    b.paint({ base: 'sand', alt: null, steep: 'orange brick', steepness: 0.85, beachLine: 110, beach: 'grass', under: 'sand' });
    b.paintDisc(rx, rz, 640, 'stone path');
    b.keep.push({ x: 0, z: 2250, r: 450 }, { x: 0, z: 3000, r: 650 });
    b.scatter('tree:palm_tree', 8, { where: (x, z) => Math.hypot(x + 1700, z - 1550) < 1250, above: W + 40, minDist: 320, scale: [0.9, 1.3] });
    b.scatter('rock_solid', 6, { minDist: 1000, maxSlope: 0.6, scale: [0.4, 0.8] });
    b.scatter('pokey', 2, { minDist: 1500, maxSlope: 0.3, where: (x, z) => Math.hypot(x, z - 2250) > 1500 });
    for (const f of [0.3, 0.65]) { const p = b.along(trail, f); b.coins(p.x, p.z, { yaw: p.yaw }); }
    return b.result(tpl, { x: 0, y: b.h(0, 2250) + 200, z: 2250, yaw: NORTH }, { height: W, extent: 4096 });
  },

  snow(b, tpl) {
    const s = b.seed;
    b.shape((x, z) => 140 + fbm(x / 2300, z / 2300, s) * 300 + fbm(x / 600, z / 600, s + 1) * 25);
    b.border(1800, 1150);
    // a big hill with an ice slide down to the frozen lake
    b.bump(-1900, -1900, 2300, 1350);
    const hillTop = b.flat(-1900, -1900, 380, b.h(-1900, -1900) - 40);
    const lake = b.flat(1300, 300, 1050, 20, 0.35);
    const slide = b.path([[-1650, -1650], [-1100, -900], [-300, -900], [300, -350], [700, 0]], { width: 420, material: 'ice', maxGrade: 0.38 });
    const trail = b.path([[0, 2250], [-200, 2300], [-1000, 1600], [-1900, 900], [-2600, -200], [-2500, -1300], [-2050, -1750]], { width: 320, material: 'cobblestone', maxGrade: 0.26 });
    b.paint({ base: 'snow', alt: null, steep: 'rock', steepness: 0.8, mid: null });
    b.paintDisc(1300, 300, 950, 'ice');
    // a log cabin
    const cx = 900, cz = 1900, cy = b.flat(cx, cz, 520, b.h(cx, cz));
    b.block({ shape: 0, sx: 760, sy: 360, sz: 560, top: 'wood planks', side: 'wood planks' }, cx, cy - 20, cz, 0, 'Cabin');
    for (let k = 0; k < 4; k++) b.block({ shape: 0, sx: 860 - k * 60, sy: 70, sz: 640 - k * 150, top: 'roof', side: 'roof' }, cx, cy + 340 + k * 70, cz, 0, 'Cabin roof');
    b.block({ shape: 3, sx: 120, sy: 300, sz: 120, top: 'red brick', side: 'red brick' }, cx + 250, cy + 400, cz - 150, 0, 'Chimney');
    b.block({ shape: 0, sx: 160, sy: 240, sz: 30, top: 'dark brick', side: 'dark brick' }, cx, cy - 20, cz + 290, 0, 'Cabin door');
    b.keep.push({ x: cx, z: cz, r: 700 }, { x: 0, z: 2250, r: 450 }, { x: 0, z: 3000, r: 650 }, { x: 1300, z: 300, r: 1100 }, { x: -1900, z: -1900, r: 450 });
    b.coins(-1900, -1900, { ring: true, y: hillTop + 30 });
    for (const f of [0.3, 0.6, 0.9]) { const p = b.along(slide, f); b.coins(p.x, p.z, { yaw: p.yaw }); }
    { const p = b.along(trail, 0.5); b.coins(p.x, p.z, { yaw: p.yaw }); }
    b.scatter('tree:snow_tree', 34, { minDist: 380, maxSlope: 0.75, scale: [0.85, 1.35], where: (x, z) => b.edge(x, z) < 1700 || fbm(x / 1300, z / 1300, s + 21) > 0.1 });
    b.scatter('rock_solid', 5, { minDist: 1100, maxSlope: 0.7, scale: [0.4, 0.7] });
    b.scatter('small_penguin', 2, { where: (x, z) => Math.hypot(x - cx, z - cz) < 1400, minDist: 400, maxSlope: 0.3, pathMargin: 0 });
    b.scatter('spindrift', 2, { where: (x, z) => Math.hypot(x, z - 2250) > 1800, minDist: 1500, maxSlope: 0.35 });
    return b.result(tpl, { x: 0, y: b.h(0, 2250) + 200, z: 2250, yaw: NORTH });
  },

  lava(b, tpl) {
    const s = b.seed, SEA = -220;
    const isles = [
      { x: 0, z: 2800, r: 950, top: 120 }, { x: -1950, z: 900, r: 760, top: 300 }, { x: 1900, z: 700, r: 700, top: 460 },
      { x: 0, z: -200, r: 650, top: 320 },
    ];
    b.shape((x, z) => {
      let h = SEA + fbm(x / 900, z / 900, s) * 40;
      for (const i of isles) {
        const d = Math.hypot(x - i.x, z - i.z) / (i.r * (1 + 0.18 * fbm(x / 500, z / 500, s + i.r)));
        if (d < 1) h = Math.max(h, lerp(i.top + fbm(x / 400, z / 400, s + 2) * 40, SEA, smoothstep(0.62, 1.0, d)));
      }
      return h;
    });
    // the volcano, its crater full of lava
    b.shape((x, z, h) => {
      const d = Math.hypot(x, z + 2500) / 1700;
      if (d >= 1.15) return h;
      const cone = SEA + 2100 * Math.pow(Math.max(0, 1 - d), 1.3) * (0.85 + 0.25 * ridged(x / 700, z / 700, s + 4));
      const crater = d < 0.22 ? lerp(cone, 1350, 1 - smoothstep(0.12, 0.22, d)) : cone;
      return Math.max(h, crater);
    });
    const foot = [0, -1250]; // where the volcano rises out of the lava toward the middle island
    const trail = b.path([foot, [600, -1500]].concat(spiral(0, -2500, 1000, 520, 0.6, 0.85, 24)), { width: 300, material: 'cobblestone', maxGrade: 0.3 });
    b.paint({ base: 'rock', alt: 'dirt', altAmount: 0.15, steep: 'rock', steepness: 0.9, low: 'lava', lowLine: SEA + 70 });
    b.paintDisc(0, -2500, 340, 'lava');
    // stone bridges between the islands, with flames on posts at the ends
    const links = [[0, 3], [3, 1], [3, 2], [0, 1]];
    for (const [a, c] of links) {
      const A = isles[a], C = isles[c];
      const dx = C.x - A.x, dz = C.z - A.z, len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      const p1 = [A.x + ux * A.r * 0.62, A.z + uz * A.r * 0.62], p2 = [C.x - ux * C.r * 0.62, C.z - uz * C.r * 0.62];
      b.bridge(p1, p2, { width: 300, material: 'dark brick', y1: b.h(...p1) + 6, y2: b.h(...p2) + 6, name: 'Stone bridge' });
      for (const p of [p1, p2]) {
        for (const side of [-1, 1]) {
          const fx = p[0] + uz * 210 * side, fz = p[1] - ux * 210 * side, fy = b.h(fx, fz);
          b.block({ shape: 3, sx: 90, sy: 220, sz: 90, top: 'dark brick', side: 'dark brick' }, fx, fy - 20, fz, 0, 'Torch post');
          b.obj('flame:red_flame', fx, fz, { y: fy + 205 });
        }
      }
    }
    // the way to the volcano from the middle island
    b.bridge([0, -200 - 650 * 0.62], foot, { width: 300, material: 'dark brick', name: 'Stone bridge' });
    b.keep.push({ x: 0, z: 2800, r: 420 });
    b.scatter('rock_solid', 6, { above: SEA + 100, minDist: 700, maxSlope: 0.7, scale: [0.4, 0.75] });
    b.scatter('small_bully', 2, { above: SEA + 150, minDist: 1500, maxSlope: 0.3, where: (x, z) => Math.hypot(x, z - 2800) > 1300 });
    for (const i of isles.slice(1)) b.coins(i.x, i.z, { ring: true, y: b.h(i.x, i.z) + 30 });
    { const p = b.along(trail, 0.5); b.coins(p.x, p.z, { yaw: p.yaw }); }
    return b.result(tpl, { x: 0, y: b.h(0, 2800) + 200, z: 2800, yaw: NORTH });
  },

  canyon(b, tpl) {
    const s = b.seed, W = -250, TOP = 900;
    b.water = W;
    const river = [[-4300, -2600], [-2300, -1200], [-700, -900], [500, 300], [1900, 700], [4300, 2300]];
    b.shape((x, z) => TOP + fbm(x / 1500, z / 1500, s) * 110 + fbm(x / 500, z / 500, s + 1) * 20);
    b.border(600, 900);
    b.t.op({ op: 'river', points: river, width: 1900, depth: -W + 220 });
    b.shape((x, z, h) => (h > W + 60 ? lerp(h, Math.round(h / 230) * 230, 0.7) : h));
    // bridges from rim to rim across the river
    const span = (p, q) => {
      const dx = q[0] - p[0], dz = q[1] - p[1], len = Math.hypot(dx, dz), nx = -dz / len, nz = dx / len;
      const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
      const rim = (dir) => { let d = 200; while (d < 2500 && b.h(mx + nx * d * dir, mz + nz * d * dir) < TOP - 120) d += 40; return [mx + nx * (d + 60) * dir, mz + nz * (d + 60) * dir]; };
      return [rim(-1), rim(1)];
    };
    const [a1, a2] = span(river[1], river[2]), [c1, c2] = span(river[3], river[4]);
    b.bridge(a1, a2, { width: 280, name: 'Rope bridge' });
    b.bridge(c1, c2, { width: 280, name: 'Rope bridge' });
    const sx = -1300, sz = 2300;
    b.flat(sx, sz, 450);
    const trail = b.path([[sx, sz], [-600, 1900], [c2[0], c2[1]]], { width: 300, material: 'dirt', maxGrade: 0.2 });
    b.paint({ base: 'sand', alt: 'dirt', altAmount: -0.05, steep: 'orange brick', steepness: 0.6, beach: 'dirt', beachLine: 60, under: 'sand' });
    b.keep.push({ x: sx, z: sz, r: 450 }, { x: sx - 400, z: sz + 700, r: 650 });
    b.scatter('tree:spiky_tree', 12, { above: TOP - 150, minDist: 600, maxSlope: 0.4, scale: [0.9, 1.3] });
    b.scatter('tree:palm_tree', 5, { above: W + 20, below: W + 200, minDist: 500, maxSlope: 0.5 });
    b.scatter('rock_solid', 8, { minDist: 800, maxSlope: 0.9, scale: [0.4, 0.8] });
    b.scatter('fish_group', 2, { below: W - 120, minDist: 2000, maxSlope: 2, lift: 120, pathMargin: 0 });
    b.scatter('bird', 3, { above: TOP - 200, minDist: 2000, maxSlope: 2 });
    b.coins((a1[0] + a2[0]) / 2, (a1[1] + a2[1]) / 2, { y: b.h(...a1) + 40, yaw: yawTo(a2[0] - a1[0], a2[1] - a1[1]) });
    { const p = b.along(trail, 0.5); b.coins(p.x, p.z, { yaw: p.yaw }); }
    return b.result(tpl, { x: sx, y: b.h(sx, sz) + 200, z: sz, yaw: yawTo(c2[0] - sx, c2[1] - sz) }, { height: W, extent: 4096 });
  },

  flat(b, tpl) {
    b.shape(() => 0);
    b.paint({ base: 'grass', alt: 'dark grass', altAmount: 0.15 });
    b.paintDisc(0, 0, 420, 'cobblestone');
    return b.result(tpl, { x: 0, y: 200, z: 0, yaw: NORTH });
  },

  sky(b, tpl) {
    // floating islands of grass and earth, linked by stepping stones
    const isles = [
      { x: 0, y: 0, z: 0, size: 1100 }, { x: -1500, y: 350, z: -1350, size: 800 }, { x: 1400, y: 650, z: -1600, size: 850 },
      { x: 100, y: 1050, z: -3000, size: 950 }, { x: -1900, y: 1450, z: -3200, size: 650 }, { x: 2000, y: 1850, z: -3300, size: 750 },
    ];
    for (const i of isles) {
      b.block({ shape: 0, sx: i.size, sy: 220, sz: i.size, top: 'grass', side: 'grass' }, i.x, i.y - 220, i.z, 0, 'Sky island');
      b.block({ shape: 0, sx: i.size * 0.72, sy: 260, sz: i.size * 0.72, top: 'dirt', side: 'dirt' }, i.x, i.y - 480, i.z, 0x1000, 'Sky island');
      b.block({ shape: 0, sx: i.size * 0.42, sy: 260, sz: i.size * 0.42, top: 'rock', side: 'rock' }, i.x, i.y - 740, i.z, 0x2000, 'Sky island');
    }
    const links = [[0, 1], [0, 2], [2, 3], [1, 4], [3, 5]];
    for (const [a, c] of links) {
      const A = isles[a], C = isles[c];
      const dx = C.x - A.x, dz = C.z - A.z, len = Math.hypot(dx, dz);
      const gap = len - (A.size + C.size) / 2;
      const count = Math.max(1, Math.round(gap / 420));
      const ux = dx / len, uz = dz / len;
      for (let k = 1; k <= count; k++) {
        const f = k / (count + 1);
        const x = A.x + ux * (A.size / 2 + gap * f), z = A.z + uz * (A.size / 2 + gap * f);
        b.block({ shape: 0, sx: 260, sy: 60, sz: 260, top: 'wood planks', side: 'wood planks' }, x, lerp(A.y, C.y, f) - 60, z, yawTo(dx, dz), 'Stepping stone');
      }
    }
    for (const i of isles) {
      const n = i.size > 900 ? 2 : 1;
      for (let k = 0; k < n; k++) b.obj('tree:bubbly_tree', i.x + (k ? -1 : 1) * i.size * 0.28, i.z - i.size * 0.25, { y: i.y, scale: 0.9 });
    }
    for (const i of isles.slice(1)) b.coins(i.x, i.z, { ring: true, y: i.y + 30 });
    b.obj('triplet_butterfly', 250, 250, { y: 0 });
    return { terrain: null, settings: { sky: tpl.sky, music: tpl.music, water: { on: false, height: 0 } }, spawn: { x: 0, y: 300, z: 300, yaw: NORTH }, blocks: b.blocks, objects: b.objects };
  },
};

// Build a template: { terrain | null, settings, spawn, blocks, objects }.
export function makeTemplate(name, seed = (Math.random() * 1e6) | 0) {
  const tpl = TEMPLATES[name] ? name : 'meadow';
  return BUILD[tpl](new Builder(seed), TEMPLATES[tpl]);
}
