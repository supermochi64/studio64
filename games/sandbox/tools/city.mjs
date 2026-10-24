// Costa Verde: the sandbox's city, generated. One continuous island city (1.3 km across) on a street
// grid: neighbourhoods, downtown towers, shops, docks, a hill park, a beach with a pier. Everything is
// made here from boxes, quads and our own textures.
//
// Output (see build_assets.mjs):
//   - per 64 m chunk: a detailed model (drawn near the player) and a simple one (far away), .glb
//   - world.bin: the collision (ground heights + boxes), the street and sidewalk networks, spots
//     (parking, gang hangouts, pickups) and the districts with their gangs, read by the game at boot
//   - map.png: the map for the radar and the pause screen
//
// Axes: +x east, +z south (north is -z, the top of the map), y up. Meters.
import { Gltf, MeshBuilder, box, boxRotated, cylinder } from './lib/gltf.mjs';
import { rng } from './lib/png.mjs';

export const WORLD = { min: -672, size: 1344, chunk: 64, chunks: 21, hcell: 4 };
export const WATER_Y = -0.5;
const PAD_Y = 0.15;         // sidewalks and lots stand on a 15 cm kerb
const SIDEWALK = 4;
export const LINES = [-576, -448, -320, -192, -64, 64, 192, 320, 448, 576];
const AVENUE_LINES = new Set([0, 3, 6, 9]); // 4 lanes (also the coast road round the island)

// district of each block (column = x, row = z from the north)
//   H hill park   S suburbs    C shops        D downtown   I docks / industry
//   R Palm Court (the player's crew)          V Violet Kings (rivals, purple)   Y Gold Coast (rivals, yellow)
//   P park        G basketball court park     B beachfront   K the cul-de-sac (home)
const DMAP = [
  'HHHSSCCII',
  'HHPSDDCII',
  'SSSDDDCVV',
  'RRRDDDVVV',
  'RKRCDCVVV',
  'RGRCCCVVV',
  'RRRCPCYYI',
  'RRRCCCYYI',
  'BBBBBBYYI',
];
export const DISTRICT_NAMES = {
  H: 'Ridge Park', S: 'Oak Hills', C: 'Commerce Row', D: 'Downtown', I: 'Port Ardent', R: 'Palm Court', K: 'Palm Court',
  V: 'Violet Heights', Y: 'Gold Coast', P: 'Central Park', G: 'Palm Court', B: 'Sunset Beach',
};
export const GANG_OF = { R: 1, K: 1, G: 1, V: 2, Y: 3 }; // 1 Palm Court Crew, 2 Violet Kings, 3 Gold Coast
const RESIDENTIAL = new Set(['R', 'V', 'Y', 'S']);

// the materials every chunk can use (fast64 settings, see lib/gltf.mjs)
const MATS = {
  asphalt: { tex: 'asphalt.png' }, road2: { tex: 'road2.png' }, road4: { tex: 'road4.png' }, crosswalk: { tex: 'crosswalk.png' },
  sidewalk: { tex: 'sidewalk.png' }, concrete: { tex: 'concrete.png' }, grass: { tex: 'grass.png' }, dirt: { tex: 'dirt.png' },
  sand: { tex: 'sand.png' }, stucco: { tex: 'stucco.png' }, housewin: { tex: 'housewin.png' }, housedoor: { tex: 'housedoor.png' },
  garage: { tex: 'garage.png' }, office: { tex: 'office.png' }, office2: { tex: 'office2.png' }, brick: { tex: 'brick.png' },
  brickwin: { tex: 'brickwin.png' }, shopfront: { tex: 'shopfront.png' }, roof: { tex: 'roof.png' }, roofflat: { tex: 'roofflat.png' },
  metal: { tex: 'metal.png' }, wood: { tex: 'wood.png' }, hedge: { tex: 'hedge.png' }, bark: { tex: 'bark.png' },
  leaves: { tex: 'leaves.png', layer: 'cutout', cull: false }, frond: { tex: 'frond.png', layer: 'cutout', cull: false },
  chainlink: { tex: 'chainlink.png', layer: 'cutout', cull: false }, container: { tex: 'container.png' }, court: { tex: 'court.png' },
  graffiti: { tex: 'graffiti.png', layer: 'cutout' }, plain: {}, plain2: { cull: false },
};

// ---- collision box flags (world.bin; the game's world.h has the same numbers) ----
export const BOX = { RAMP: 1, THIN: 2, NOCAM: 4, LOW: 8, WATER: 16 };
// ---- spot types ----
export const SPOT = { PARK: 1, HANGOUT: 2, PICKUP: 3, HOME: 4, SHOP: 5, HOSPITAL: 6, POLICE: 7, PED: 8, RAMP: 9, BENCH: 10 };
// ground kinds (per 4 m cell) for sounds and grip
export const GROUND = { ROAD: 0, CONCRETE: 1, GRASS: 2, SAND: 3, WATER: 4, DIRT: 5 };

const C = (s) => { const h = s.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 255]; };
const WHITE = [255, 255, 255, 255];
const PASTELS = ['#f2e6d0', '#e9d4b8', '#f4dcc8', '#dfe8d8', '#d8e4ec', '#f0d8d8', '#eee4b8', '#e0d0e8', '#f5efe6', '#d9cbb0'].map(C);

export class City {
  constructor(seed = 64) {
    this.r = rng(seed);
    this.chunks = new Map();     // "cx,cz" -> { detail: {g, b}, lod: {g, b} }
    this.boxes = [];
    this.spots = [];
    this.segments = [];          // streets, axis-aligned: { x0, z0, x1, z1, half, lanes, kind }
    this.pads = [];              // raised blocks: { x0, z0, x1, z1, kind, block }
    const n = (WORLD.size / WORLD.hcell) + 1;
    this.hn = n;
    this.heights = new Float32Array(n * n);
    this.ground = new Uint8Array((n - 1) * (n - 1)).fill(GROUND.GRASS);
    this.walkNodes = []; this.walkEdges = [];
    this.districtOf = (bx, bz) => (DMAP[bz] && DMAP[bz][bx]) || ' ';
  }

  // ---- chunks ----
  chunkOf(x, z) {
    const cx = Math.max(0, Math.min(WORLD.chunks - 1, Math.floor((x - WORLD.min) / WORLD.chunk)));
    const cz = Math.max(0, Math.min(WORLD.chunks - 1, Math.floor((z - WORLD.min) / WORLD.chunk)));
    const key = `${cx},${cz}`;
    if (!this.chunks.has(key)) {
      const mk = () => { const g = new Gltf(); return { g, b: new MeshBuilder(), m: (name) => g.material(name, MATS[name]) }; };
      this.chunks.set(key, { cx, cz, detail: mk(), lod: mk(), ox: WORLD.min + cx * WORLD.chunk + WORLD.chunk / 2, oz: WORLD.min + cz * WORLD.chunk + WORLD.chunk / 2 });
    }
    return this.chunks.get(key);
  }
  /** Draw into the detailed model of the chunk that holds (x, z): fn(builder, material) */
  emit(x, z, fn) { const c = this.chunkOf(x, z); fn(c.detail.b, c.detail.m); }
  lod(x, z, fn) { const c = this.chunkOf(x, z); fn(c.lod.b, c.lod.m); }
  both(x, z, fn) { this.emit(x, z, fn); this.lod(x, z, fn); }

  solid(cx, cz, hx, hz, y0, y1, opts = {}) {
    this.boxes.push({ cx, cz, hx, hz, y0, y1, yaw: opts.yaw || 0, flags: opts.flags || 0, r0: opts.r0 ?? y1, r1: opts.r1 ?? y1, kind: opts.kind || 0 });
  }
  spot(type, x, z, yaw = 0, param = 0) { this.spots.push({ type, x, z, yaw, param }); }

  // ---- terrain ----
  hIndex(i, j) { return j * this.hn + i; }
  baseHeight(x, z) {
    // the island: flat city land, coasts sloping into the sea, hills in Ridge Park
    const land = 584;
    const out = Math.max(Math.abs(x) - land, z < 0 ? -z - land : z - land - 22, 0); // the beach is a little wider
    let h = 0;
    if (out > 0) h = -out * (z > 0 && Math.abs(x) < land ? 0.07 : 0.22);
    // Ridge Park: hills over blocks (0..2, 0..1) and (2, 0)
    const hx0 = LINES[0], hx1 = LINES[3], hz0 = -680, hz1 = LINES[2];
    if (x > hx0 - 120 && x < hx1 && z > hz0 && z < hz1) {
      const edge = Math.min(x - (hx0 - 120), hx1 - 10 - x, hz1 - 10 - z, 200);
      const fall = Math.max(0, Math.min(1, edge / 70));
      const bumps = 34 * Math.exp(-((x + 470) ** 2 + (z + 500) ** 2) / (2 * 70 ** 2))
        + 22 * Math.exp(-((x + 300) ** 2 + (z + 470) ** 2) / (2 * 50 ** 2))
        + 14 * Math.exp(-((x + 540) ** 2 + (z + 380) ** 2) / (2 * 45 ** 2))
        + 4 * Math.sin(x * 0.05) * Math.cos(z * 0.06);
      // the hills inside the blocks only (the roads round them stay flat)
      const inBlock = !(Math.abs(z - LINES[0]) < 12 && x > LINES[0]) && !(Math.abs(z - LINES[2]) < 12) && !(Math.abs(x - LINES[3]) < 12);
      if (inBlock) h = Math.max(h, h + bumps * fall);
      if (x < hx0 - 8) h = Math.max(h, bumps * fall - (hx0 - 8 - x) * 0.3); // cliffs down to the sea in the west
    }
    return h;
  }
  buildHeights() {
    const n = this.hn;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = WORLD.min + i * WORLD.hcell, z = WORLD.min + j * WORLD.hcell;
      this.heights[this.hIndex(i, j)] = this.baseHeight(x, z);
    }
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const h = this.heights[this.hIndex(i, j)];
      const x = WORLD.min + i * WORLD.hcell + 2, z = WORLD.min + j * WORLD.hcell + 2;
      let g = GROUND.GRASS;
      if (h < WATER_Y - 0.2) g = GROUND.WATER;
      else if (h < 1.2 && (Math.abs(x) > 584 || Math.abs(z) > 584)) g = GROUND.SAND;
      this.ground[j * (n - 1) + i] = g;
    }
  }
  heightAt(x, z) {
    const fi = (x - WORLD.min) / WORLD.hcell, fj = (z - WORLD.min) / WORLD.hcell;
    const i = Math.max(0, Math.min(this.hn - 2, Math.floor(fi))), j = Math.max(0, Math.min(this.hn - 2, Math.floor(fj)));
    const u = fi - i, v = fj - j;
    const h = (a, b) => this.heights[this.hIndex(i + a, j + b)];
    return h(0, 0) * (1 - u) * (1 - v) + h(1, 0) * u * (1 - v) + h(0, 1) * (1 - u) * v + h(1, 1) * u * v;
  }
  setGround(x0, z0, x1, z1, g) {
    const n = this.hn - 1;
    for (let j = Math.floor((z0 - WORLD.min) / 4); j <= Math.floor((z1 - WORLD.min) / 4); j++)
      for (let i = Math.floor((x0 - WORLD.min) / 4); i <= Math.floor((x1 - WORLD.min) / 4); i++)
        if (i >= 0 && j >= 0 && i < n && j < n) this.ground[j * n + i] = g;
  }

  // the terrain where it shows: hills, coasts and beaches (the city stands on its own surfaces)
  drawTerrain() {
    const n = this.hn - 1;
    const covered = new Uint8Array(n * n);
    const mark = (x0, z0, x1, z1) => {
      for (let j = Math.ceil((z0 - WORLD.min) / 4); j < Math.floor((z1 - WORLD.min) / 4); j++)
        for (let i = Math.ceil((x0 - WORLD.min) / 4); i < Math.floor((x1 - WORLD.min) / 4); i++) if (i >= 0 && j >= 0 && i < n && j < n) covered[j * n + i] = 1;
    };
    for (const s of this.segments) mark(Math.min(s.x0, s.x1) - (s.x0 === s.x1 ? s.half : 0), Math.min(s.z0, s.z1) - (s.z0 === s.z1 ? s.half : 0), Math.max(s.x0, s.x1) + (s.x0 === s.x1 ? s.half : 0), Math.max(s.z0, s.z1) + (s.z0 === s.z1 ? s.half : 0));
    for (const p of this.pads) mark(p.x0, p.z0, p.x1, p.z1);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (covered[j * n + i]) continue;
      const hs = [this.heights[this.hIndex(i, j)], this.heights[this.hIndex(i + 1, j)], this.heights[this.hIndex(i + 1, j + 1)], this.heights[this.hIndex(i, j + 1)]];
      if (Math.max(...hs) < WATER_Y - 6) continue; // deep under water: nobody sees it
      const x0 = WORLD.min + i * 4, z0 = WORLD.min + j * 4;
      const g = this.ground[j * n + i];
      const avg = (hs[0] + hs[1] + hs[2] + hs[3]) / 4;
      const mat = g === GROUND.SAND || (avg < 0.6 && g !== GROUND.GRASS) ? 'sand' : avg > 18 ? (((i * 7 + j * 3) % 5) ? 'grass' : 'dirt') : 'grass';
      // baked light from the slope (sun from the south-east)
      const nx = (hs[0] - hs[1] + hs[3] - hs[2]) / 8, nz = (hs[0] - hs[3] + hs[1] - hs[2]) / 8;
      const lit = Math.max(0.55, Math.min(1.15, 0.92 + nx * 0.5 + nz * 0.6));
      const col = [Math.round(255 * lit), Math.round(255 * lit), Math.round(250 * lit), 255].map((v) => Math.min(255, v));
      const p = [[x0, hs[0], z0], [x0, hs[3], z0 + 4], [x0 + 4, hs[2], z0 + 4], [x0 + 4, hs[1], z0]];
      const u0 = i % 8, v0 = j % 8;
      const uvq = [[u0, v0], [u0, v0 + 1], [u0 + 1, v0 + 1], [u0 + 1, v0]];
      this.emit(x0 + 2, z0 + 2, (b, m) => b.quad(m(mat), p, { color: col, uv: uvq }));
      if (((i % 2) === 0) && ((j % 2) === 0)) {
        // the far model: 8 m quads, no texture
        const H = (a, b) => this.heights[this.hIndex(Math.min(this.hn - 1, i + a), Math.min(this.hn - 1, j + b))];
        const ph = [[x0, H(0, 0), z0], [x0, H(0, 2), z0 + 8], [x0 + 8, H(2, 2), z0 + 8], [x0 + 8, H(2, 0), z0]];
        const base = mat === 'sand' ? [226, 207, 152] : mat === 'dirt' ? [141, 110, 76] : [95, 143, 60];
        this.lod(x0 + 4, z0 + 4, (b, m) => b.quad(m('plain'), ph, { color: [...base.map((v) => Math.round(v * lit)), 255] }));
      }
    }
  }

  // ---- streets ----
  lineHalf(idx) { return AVENUE_LINES.has(idx) ? 8 : 5; }
  planStreets() {
    const L = LINES;
    const isPark = (bx, bz) => this.districtOf(bx, bz) === 'H';
    // the grid: a street between two nodes unless both blocks beside it are hill park
    for (let j = 0; j < L.length; j++) for (let i = 0; i < L.length - 1; i++) {
      const above = j > 0 ? isPark(i, j - 1) : true, below = j < 9 ? isPark(i, j) : true;
      if (above && below && j !== 0) continue;
      if (j === 0 && i < 3) continue; // the hills reach the north coast
      this.segments.push({ x0: L[i], z0: L[j], x1: L[i + 1], z1: L[j], half: this.lineHalf(j), lanes: AVENUE_LINES.has(j) ? 2 : 1, kind: 'grid' });
    }
    for (let i = 0; i < L.length; i++) for (let j = 0; j < L.length - 1; j++) {
      const left = i > 0 ? isPark(i - 1, j) : true, right = i < 9 ? isPark(i, j) : true;
      if (left && right && i !== 0) continue;
      if (i === 0 && j < 2) continue;
      this.segments.push({ x0: L[i], z0: L[j], x1: L[i], z1: L[j + 1], half: this.lineHalf(i), lanes: AVENUE_LINES.has(i) ? 2 : 1, kind: 'grid' });
    }
    // neighbourhood streets through the middle of residential blocks (east-west), and the cul-de-sac
    for (let bz = 0; bz < 9; bz++) for (let bx = 0; bx < 9; bx++) {
      const d = this.districtOf(bx, bz);
      const x0 = L[bx], x1 = L[bx + 1], zm = (L[bz] + L[bz + 1]) / 2;
      if (RESIDENTIAL.has(d)) this.segments.push({ x0, z0: zm, x1, z1: zm, half: 4.5, lanes: 1, kind: 'local' });
      if (d === 'K') this.segments.push({ x0: (x0 + x1) / 2, z0: zm - 6, x1: (x0 + x1) / 2, z1: L[bz + 1], half: 4.5, lanes: 1, kind: 'culdesac' });
    }
  }

  // nodes where streets meet; segments split there (the street network for traffic)
  buildStreetGraph() {
    const nodes = [], key = new Map();
    const node = (x, z) => { const k = `${x},${z}`; if (!key.has(k)) { key.set(k, nodes.length); nodes.push({ x, z, deg: 0 }); } return key.get(k); };
    const pts = new Set();
    for (const s of this.segments) { pts.add(`${s.x0},${s.z0}`); pts.add(`${s.x1},${s.z1}`); }
    const edges = [];
    for (const s of this.segments) {
      const horiz = s.z0 === s.z1;
      const cuts = [];
      for (const p of pts) {
        const [x, z] = p.split(',').map(Number);
        if (horiz && z === s.z0 && x > Math.min(s.x0, s.x1) && x < Math.max(s.x0, s.x1)) cuts.push(x);
        if (!horiz && x === s.x0 && z > Math.min(s.z0, s.z1) && z < Math.max(s.z0, s.z1)) cuts.push(z);
      }
      const a = horiz ? Math.min(s.x0, s.x1) : Math.min(s.z0, s.z1), b = horiz ? Math.max(s.x0, s.x1) : Math.max(s.z0, s.z1);
      const stops = [a, ...cuts.sort((p, q) => p - q), b];
      for (let k = 0; k < stops.length - 1; k++) {
        const na = horiz ? node(stops[k], s.z0) : node(s.x0, stops[k]);
        const nb = horiz ? node(stops[k + 1], s.z0) : node(s.x0, stops[k + 1]);
        edges.push({ a: na, b: nb, lanes: s.lanes, half: s.half, kind: s.kind });
        nodes[na].deg++; nodes[nb].deg++;
      }
    }
    this.streetNodes = nodes; this.streetEdges = edges;
  }
  // the half width of the widest street at a node (where the intersection square ends)
  nodeHalf(ni) {
    let h = 0;
    for (const e of this.streetEdges) if (e.a === ni || e.b === ni) h = Math.max(h, e.half);
    return h;
  }
  drawStreets() {
    const N = this.streetNodes;
    for (const e of this.streetEdges) {
      const A = N[e.a], B = N[e.b];
      const horiz = A.z === B.z;
      const ha = this.nodeHalf(e.a), hb = this.nodeHalf(e.b);
      const t = e.lanes === 2 ? 'road4' : 'road2';
      const len = horiz ? B.x - A.x : B.z - A.z;
      const s0 = (N[e.a].deg > 1 ? ha : 0), s1 = len - (N[e.b].deg > 1 ? hb : 0);
      const cw = 3; // crosswalk stripes at the ends
      const pieces = [];
      if (N[e.a].deg > 2) pieces.push([s0, s0 + cw, 'crosswalk']);
      pieces.push([N[e.a].deg > 2 ? s0 + cw : s0, N[e.b].deg > 2 ? s1 - cw : s1, t]);
      if (N[e.b].deg > 2) pieces.push([s1 - cw, s1, 'crosswalk']);
      for (const [p0, p1, mat] of pieces) {
        // in pieces of at most 32 m (texture coordinates stay small; chunks get their own part)
        for (let q = p0; q < p1 - 0.01; q += 32) {
          const q1 = Math.min(p1, q + 32);
          const w = e.half;
          let quad;
          if (horiz) quad = [[A.x + q, 0.02, A.z - w], [A.x + q, 0.02, A.z + w], [A.x + q1, 0.02, A.z + w], [A.x + q1, 0.02, A.z - w]];
          else quad = [[A.x + w, 0.02, A.z + q], [A.x - w, 0.02, A.z + q], [A.x - w, 0.02, A.z + q1], [A.x + w, 0.02, A.z + q1]];
          // u across the road (0..1), v along it (one repeat per 8 m; crosswalks: across stripes)
          const rep = mat === 'crosswalk' ? [[0, 0], [w / 3, 0], [w / 3, 1], [0, 1]] : [[0, 0], [1, 0], [1, (q1 - q) / 8], [0, (q1 - q) / 8]];
          const uv = mat === 'crosswalk' ? [[0, 0], [0, (2 * w) / 6], [1, (2 * w) / 6], [1, 0]] : rep;
          const cx = horiz ? A.x + (q + q1) / 2 : A.x, cz = horiz ? A.z : A.z + (q + q1) / 2;
          this.emit(cx, cz, (b, m) => b.quad(m(mat), quad, { color: WHITE, uv }));
          this.lod(cx, cz, (b, m) => b.quad(m('plain'), quad, { color: [86, 88, 92, 255] }));
        }
      }
    }
    // intersections: plain asphalt squares
    N.forEach((n, i) => {
      if (n.deg < 2) {
        // a dead end: the cul-de-sac's turning circle
        const r = 13;
        const pts = 12;
        for (let k = 0; k < pts; k++) {
          const a0 = (k / pts) * Math.PI * 2, a1 = ((k + 1) / pts) * Math.PI * 2;
          const tri = [[n.x, 0.02, n.z], [n.x + Math.sin(a0) * r, 0.02, n.z + Math.cos(a0) * r], [n.x + Math.sin(a1) * r, 0.02, n.z + Math.cos(a1) * r]];
          this.emit(n.x, n.z, (b, m) => b.triangle(m('asphalt'), tri, { color: WHITE, uv: tri.map((p) => [(p[0] - n.x) / 8, (p[2] - n.z) / 8]) }));
          this.lod(n.x, n.z, (b, m) => b.triangle(m('plain'), tri, { color: [86, 88, 92, 255] }));
        }
        this.spot(SPOT.HOME, n.x, n.z - 4);
        return;
      }
      const h = this.nodeHalf(i);
      const q = [[n.x - h, 0.02, n.z - h], [n.x - h, 0.02, n.z + h], [n.x + h, 0.02, n.z + h], [n.x + h, 0.02, n.z - h]];
      this.emit(n.x, n.z, (b, m) => b.quad(m('asphalt'), q, { color: WHITE, uv: [[0, 0], [0, h / 4], [h / 4, h / 4], [h / 4, 0]] }));
      this.lod(n.x, n.z, (b, m) => b.quad(m('plain'), q, { color: [86, 88, 92, 255] }));
      // traffic lights at big crossings
      if (n.deg >= 4 && h >= 8) for (const [sx, sz, yaw] of [[1, 1, 0], [-1, -1, Math.PI], [1, -1, Math.PI / 2], [-1, 1, -Math.PI / 2]]) this.trafficLight(n.x + sx * (h + 1.5), n.z + sz * (h + 1.5), yaw);
    });
    for (const e of this.streetEdges) this.setGroundForEdge(e);
  }
  setGroundForEdge(e) {
    const A = this.streetNodes[e.a], B = this.streetNodes[e.b];
    if (A.z === B.z) this.setGround(A.x, A.z - e.half, B.x, A.z + e.half, GROUND.ROAD); else this.setGround(A.x - e.half, A.z, A.x + e.half, B.z, GROUND.ROAD);
  }

  // ---- blocks ----
  // the street half-width along each side of a rectangle (0 where there is none)
  roadNear(x, z, horizontal) {
    let best = 0;
    for (const s of this.segments) {
      if (horizontal && s.z0 === s.z1 && Math.abs(s.z0 - z) < 0.01 && x >= Math.min(s.x0, s.x1) - 0.01 && x <= Math.max(s.x0, s.x1) + 0.01) best = Math.max(best, s.half);
      if (!horizontal && s.x0 === s.x1 && Math.abs(s.x0 - x) < 0.01 && z >= Math.min(s.z0, s.z1) - 0.01 && z <= Math.max(s.z0, s.z1) + 0.01) best = Math.max(best, s.half);
    }
    return best;
  }
  planBlocks() {
    const L = LINES;
    for (let bz = 0; bz < 9; bz++) for (let bx = 0; bx < 9; bx++) {
      const d = this.districtOf(bx, bz);
      if (d === 'H') continue;
      const x0 = L[bx], x1 = L[bx + 1], z0 = L[bz], z1 = L[bz + 1];
      const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
      const hN = this.roadNear(xm, z0, true), hS = this.roadNear(xm, z1, true), hW = this.roadNear(x0, zm, false), hE = this.roadNear(x1, zm, false);
      const rect = { x0: x0 + hW, z0: z0 + hN, x1: x1 - hE, z1: z1 - hS };
      const parts = [];
      if (RESIDENTIAL.has(d)) {
        parts.push({ ...rect, z1: zm - 4.5 }, { ...rect, z0: zm + 4.5 });
      } else if (d === 'K') {
        const xc = xm;
        parts.push({ x0: rect.x0, z0: rect.z0, x1: rect.x1, z1: zm - 6 - 13 }, // north of the circle
          { x0: rect.x0, z0: zm - 19, x1: xc - 4.5, z1: rect.z1 }, { x0: xc + 4.5, z0: zm - 19, x1: rect.x1, z1: rect.z1 });
      } else parts.push(rect);
      for (const p of parts) this.pads.push({ ...p, kind: d, bx, bz });
    }
  }

  drawPad(p) {
    // the raised block: a top surface (sidewalk ring + the lot inside) and the kerb sides
    const { x0, z0, x1, z1 } = p;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.solid(cx, cz, (x1 - x0) / 2, (z1 - z0) / 2, -1, PAD_Y, { flags: BOX.LOW });
    const sw = SIDEWALK;
    const inner = { x0: x0 + sw, z0: z0 + sw, x1: x1 - sw, z1: z1 - sw };
    // sidewalk strips, in pieces per chunk
    const strip = (ax, az, bx, bz) => this.tiles(ax, az, bx, bz, PAD_Y, 'sidewalk', 2);
    strip(x0, z0, x1, z0 + sw); strip(x0, z1 - sw, x1, z1); strip(x0, z0 + sw, x0 + sw, z1 - sw); strip(x1 - sw, z0 + sw, x1, z1 - sw);
    this.setGround(x0, z0, x1, z1, GROUND.CONCRETE);
    // kerbs
    const k = [[[x0, 0, z1], [x1, 0, z1], [x1, PAD_Y, z1], [x0, PAD_Y, z1]], [[x1, 0, z0], [x0, 0, z0], [x0, PAD_Y, z0], [x1, PAD_Y, z0]],
      [[x1, 0, z1], [x1, 0, z0], [x1, PAD_Y, z0], [x1, PAD_Y, z1]], [[x0, 0, z0], [x0, 0, z1], [x0, PAD_Y, z1], [x0, PAD_Y, z0]]];
    for (const q of k) {
      const mx = (q[0][0] + q[1][0]) / 2, mz = (q[0][2] + q[1][2]) / 2;
      this.emit(mx, mz, (b, m) => b.quad(m('plain'), q, { color: [170, 166, 158, 255] }));
    }
    this.lod(cx, cz, (b, m) => b.quad(m('plain'), [[x0, PAD_Y, z0], [x0, PAD_Y, z1], [x1, PAD_Y, z1], [x1, PAD_Y, z0]], { color: [176, 172, 162, 255] }));
    // walkers' network: the pad's corners (on the sidewalk, 1.8 m in)
    const c = [[x0 + 1.8, z0 + 1.8], [x1 - 1.8, z0 + 1.8], [x1 - 1.8, z1 - 1.8], [x0 + 1.8, z1 - 1.8]].map(([x, z]) => this.walkNode(x, z));
    for (let i = 0; i < 4; i++) this.walkEdge(c[i], c[(i + 1) % 4]);
    // street furniture along the sidewalks
    this.furniture(p);
    return inner;
  }
  walkNode(x, z) {
    for (let i = 0; i < this.walkNodes.length; i++) if (Math.abs(this.walkNodes[i].x - x) < 0.5 && Math.abs(this.walkNodes[i].z - z) < 0.5) return i;
    this.walkNodes.push({ x, z }); return this.walkNodes.length - 1;
  }
  walkEdge(a, b) { if (a !== b && !this.walkEdges.some((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))) this.walkEdges.push({ a, b }); }
  // crosswalks: join pad corners across a street
  linkWalks() {
    const N = this.walkNodes;
    for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
      const dx = Math.abs(N[i].x - N[j].x), dz = Math.abs(N[i].z - N[j].z);
      if ((dx < 0.5 && dz > 4 && dz < 21) || (dz < 0.5 && dx > 4 && dx < 21)) {
        // only if no block is in between (it crosses a street)
        const mx = (N[i].x + N[j].x) / 2, mz = (N[i].z + N[j].z) / 2;
        if (!this.pads.some((p) => mx > p.x0 && mx < p.x1 && mz > p.z0 && mz < p.z1)) this.walkEdge(i, j);
      }
    }
  }

  /** A textured flat surface from (ax,az) to (bx,bz) at height y, split at chunk lines; rep = meters per repeat */
  tiles(ax, az, bx, bz, y, mat, rep, color = WHITE) {
    if (bx - ax < 0.05 || bz - az < 0.05) return;
    const step = 32;
    for (let x = ax; x < bx - 0.01; x = Math.min(bx, Math.floor((x + step) / step) * step)) {
      const xe = Math.min(bx, Math.floor((x + step) / step) * step);
      for (let z = az; z < bz - 0.01; z = Math.min(bz, Math.floor((z + step) / step) * step)) {
        const ze = Math.min(bz, Math.floor((z + step) / step) * step);
        const u0 = ((x / rep) % 8 + 8) % 8, v0 = ((z / rep) % 8 + 8) % 8;
        const uv = [[u0, v0], [u0, v0 + (ze - z) / rep], [u0 + (xe - x) / rep, v0 + (ze - z) / rep], [u0 + (xe - x) / rep, v0]];
        this.emit((x + xe) / 2, (z + ze) / 2, (b, m) => b.quad(m(mat), [[x, y, z], [x, y, ze], [xe, y, ze], [xe, y, z]], { color, uv }));
      }
    }
  }

  furniture(p) {
    const r = this.r;
    const sides = [
      { ax: p.x0 + 6, az: p.z0 + 0.8, bx: p.x1 - 6, bz: p.z0 + 0.8, yaw: Math.PI }, // north edge (faces the street to the north)
      { ax: p.x0 + 6, az: p.z1 - 0.8, bx: p.x1 - 6, bz: p.z1 - 0.8, yaw: 0 },
      { ax: p.x0 + 0.8, az: p.z0 + 6, bx: p.x0 + 0.8, bz: p.z1 - 6, yaw: -Math.PI / 2 },
      { ax: p.x1 - 0.8, az: p.z0 + 6, bx: p.x1 - 0.8, bz: p.z1 - 6, yaw: Math.PI / 2 },
    ];
    sides.forEach((s, i) => {
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
      const n = Math.floor(len / 26);
      for (let k = 0; k <= n; k++) {
        const t = n ? k / n : 0.5;
        const x = s.ax + (s.bx - s.ax) * t, z = s.az + (s.bz - s.az) * t;
        if ((k + i) % 2 === 0) this.lamp(x, z, s.yaw);
        else if (r() < 0.25) this.hydrant(x, z);
        else if (r() < 0.2) this.trashcan(x, z);
        if (p.kind === 'B' || p.kind === 'R' || p.kind === 'K' || p.kind === 'Y') { if (r() < 0.25) this.palm(x + (s.bz - s.az ? 0 : 3), z + (s.bx - s.ax ? 0 : 3), r() * 6); }
        if (r() < 0.35) this.spot(SPOT.PED, x, z, s.yaw);
      }
    });
  }

  // ---- props ----
  lamp(x, z, yaw) {
    const tip = [x + Math.sin(yaw) * 1.6, z + Math.cos(yaw) * 1.6];
    this.emit(x, z, (b, m) => {
      box(b, m('plain'), [x - 0.09, PAD_Y, z - 0.09], [x + 0.09, 6.2, z + 0.09], { color: [92, 96, 100, 255], faces: ['n', 's', 'e', 'w'] });
      const ax = Math.min(x, tip[0]) - 0.06, az = Math.min(z, tip[1]) - 0.06;
      box(b, m('plain'), [ax, 6.1, az], [Math.max(x, tip[0]) + 0.06, 6.24, Math.max(z, tip[1]) + 0.06], { color: [92, 96, 100, 255] });
      box(b, m('plain'), [tip[0] - 0.25, 5.98, tip[1] - 0.25], [tip[0] + 0.25, 6.12, tip[1] + 0.25], { color: [255, 240, 190, 255], shadeSides: false });
    });
    this.solid(x, z, 0.12, 0.12, PAD_Y, 6.2, { flags: BOX.THIN });
  }
  hydrant(x, z) {
    this.emit(x, z, (b, m) => { cylinder(b, m('plain'), x, z, PAD_Y, 0.75, 0.15, 6, { color: [196, 40, 36, 255] }); box(b, m('plain'), [x - 0.22, 0.45, z - 0.06], [x + 0.22, 0.55, z + 0.06], { color: [176, 36, 30, 255] }); });
    this.solid(x, z, 0.18, 0.18, PAD_Y, 0.75, { kind: 1 });
  }
  trashcan(x, z) {
    this.emit(x, z, (b, m) => cylinder(b, m('plain'), x, z, PAD_Y, 1.0, 0.3, 6, { color: [60, 90, 70, 255] }));
    this.solid(x, z, 0.3, 0.3, PAD_Y, 1.0);
  }
  palm(x, z, seed) {
    const r = rng(Math.floor(seed * 1000) + Math.floor(x * 7 + z * 13));
    const h = 7 + r() * 6, lean = (r() - 0.5) * 1.2;
    const tx = x + lean, tz = z + lean * 0.5;
    const ground = this.heightAt(x, z) > 0.5 ? this.heightAt(x, z) : PAD_Y;
    this.emit(x, z, (b, m) => {
      // the trunk: one tapered piece, four sides
      cylinder(b, m('bark'), x, z, ground, ground + h, 0.26, 4, { color: WHITE, rTop: 0.16, cap: false });
      // fronds: drooping quads round the top (one quad each, cut out)
      const top = [tx, ground + h, tz];
      const n = 5;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + r();
        const dx = Math.sin(a), dz = Math.cos(a);
        const len = 3.8 + r() * 1.0;
        const end = [top[0] + dx * len, top[1] - 1.4 - r() * 0.8, top[2] + dz * len];
        const w = 1.0, px = -dz * w, pz = dx * w;
        b.quad(m('frond'), [[top[0] + px * 0.25, top[1] + 0.3, top[2] + pz * 0.25], [top[0] - px * 0.25, top[1] + 0.3, top[2] - pz * 0.25], [end[0] - px, end[1], end[2] - pz], [end[0] + px, end[1], end[2] + pz]], { color: WHITE, uv: [[0, 0], [0, 1], [1, 1], [1, 0]] });
      }
    });
    this.lod(x, z, (b, m) => { box(b, m('plain'), [x - 0.2, ground, z - 0.2], [x + 0.2, ground + h, z + 0.2], { color: [120, 92, 62, 255], faces: ['n', 's', 'e', 'w'] }); box(b, m('plain2'), [tx - 2.5, ground + h - 1.2, tz - 2.5], [tx + 2.5, ground + h, tz + 2.5], { color: [70, 120, 46, 255] }); });
    this.solid(x, z, 0.3, 0.3, ground, ground + h, { flags: BOX.THIN });
  }
  tree(x, z, seed, size = 1) {
    const r = rng(Math.floor(seed * 997 + x * 3 + z));
    const g = this.heightAt(x, z) > PAD_Y ? this.heightAt(x, z) : PAD_Y;
    const h = (3 + r() * 2) * size, cr = (2.2 + r() * 1.2) * size;
    this.emit(x, z, (b, m) => {
      cylinder(b, m('bark'), x, z, g - 0.3, g + h, 0.25 * size, 5, { color: WHITE, cap: false });
      // the crown: two crossed cut-out quads and a flat one, cheap and round from every side
      const cy = g + h + cr * 0.4;
      for (const a of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]) {
        const dx = Math.sin(a) * cr, dz = Math.cos(a) * cr;
        b.quad(m('leaves'), [[x - dx, cy - cr, z - dz], [x + dx, cy - cr, z + dz], [x + dx, cy + cr, z + dz], [x - dx, cy + cr, z - dz]], { color: [220 + r() * 35, 230, 220, 255].map(Math.round) });
      }
      b.quad(m('leaves'), [[x - cr, cy, z - cr], [x - cr, cy, z + cr], [x + cr, cy, z + cr], [x + cr, cy, z - cr]], { color: [200, 210, 200, 255] });
    });
    this.lod(x, z, (b, m) => box(b, m('plain'), [x - cr * 0.8, g + h - cr * 0.5, z - cr * 0.8], [x + cr * 0.8, g + h + cr * 1.2, z + cr * 0.8], { color: [64, 110, 44, 255] }));
    this.solid(x, z, 0.3, 0.3, g - 0.3, g + h, { flags: BOX.THIN });
  }
  trafficLight(x, z, yaw) {
    this.emit(x, z, (b, m) => {
      box(b, m('plain'), [x - 0.1, 0, z - 0.1], [x + 0.1, 5.2, z + 0.1], { color: [70, 74, 78, 255] });
      boxRotated(b, m('plain'), [x + Math.sin(yaw) * 2.5, 5.0, z + Math.cos(yaw) * 2.5], [0.07, 0.07, 2.6], yaw, { color: [70, 74, 78, 255] });
      const hx = x + Math.sin(yaw) * 4.2, hz = z + Math.cos(yaw) * 4.2;
      boxRotated(b, m('plain'), [hx, 4.4, hz], [0.25, 0.55, 0.22], yaw, { color: [40, 40, 40, 255] });
      boxRotated(b, m('plain'), [hx, 4.75, hz], [0.27, 0.12, 0.24], yaw, { color: [200, 40, 30, 255], shadeSides: false });
      boxRotated(b, m('plain'), [hx, 4.05, hz], [0.27, 0.12, 0.24], yaw, { color: [40, 200, 70, 255], shadeSides: false });
    });
    this.solid(x, z, 0.15, 0.15, 0, 5.2, { flags: BOX.THIN });
  }
  fence(ax, az, bx, bz, kind = 'wood', height = 1.1) {
    // a straight fence (wood, hedge, chain-link or a low wall); solid, but low enough to jump
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) return;
    const cx = (ax + bx) / 2, cz = (az + bz) / 2, yaw = Math.atan2(bx - ax, bz - az);
    const t = kind === 'hedge' ? 0.7 : kind === 'wall' ? 0.3 : 0.08;
    const mat = kind === 'hedge' ? 'hedge' : kind === 'chain' ? 'chainlink' : kind === 'wall' ? 'stucco' : 'wood';
    const col = kind === 'wall' ? [214, 204, 186, 255] : WHITE;
    this.emit(cx, cz, (b, m) => boxRotated(b, m(mat), [cx, PAD_Y + height / 2, cz], [t / 2, height / 2, len / 2], yaw, { color: col, uvScale: kind === 'chain' ? 1.2 : 2, faces: kind === 'chain' ? ['e', 'w'] : undefined }));
    if (kind === 'chain') this.emit(cx, cz, (b, m) => { for (let k = 0; k <= Math.floor(len / 3); k++) { const f = k / Math.max(1, Math.floor(len / 3)); box(b, m('plain'), [ax + (bx - ax) * f - 0.04, PAD_Y, az + (bz - az) * f - 0.04], [ax + (bx - ax) * f + 0.04, PAD_Y + height, az + (bz - az) * f + 0.04], { color: [150, 154, 158, 255] }); } });
    this.solid(cx, cz, Math.max(t / 2, 0.1), len / 2, PAD_Y, PAD_Y + height, { yaw, flags: BOX.THIN });
  }
  car_ramp(x, z, yaw, len = 10, h = 2.2, w = 4) {
    // a dirt or wooden jump ramp: up along +local z
    const g = this.heightAt(x, z);
    this.emit(x, z, (b, m) => {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      const P = (lx, ly, lz) => [x + lx * c + lz * s, g + ly, z - lx * s + lz * c];
      const hl = len / 2, hw = w / 2;
      b.quad(m('wood'), [P(hw, 0, -hl), P(-hw, 0, -hl), P(-hw, h, hl), P(hw, h, hl)], { color: WHITE, uv: [[0, 0], [w / 2, 0], [w / 2, len / 2], [0, len / 2]] });
      b.quad(m('wood'), [P(-hw, 0, hl), P(hw, 0, hl), P(hw, h, hl), P(-hw, h, hl)], { color: [170, 170, 170, 255] });
      b.triangle(m('wood'), [P(hw, 0, hl), P(hw, 0, -hl), P(hw, h, hl)], { color: [200, 200, 200, 255] });
      b.triangle(m('wood'), [P(-hw, 0, -hl), P(-hw, 0, hl), P(-hw, h, hl)], { color: [200, 200, 200, 255] });
    });
    this.solid(x, z, w / 2, len / 2, g - 0.5, g + h, { yaw, flags: BOX.RAMP, r0: g, r1: g + h });
    this.spot(SPOT.RAMP, x, z, yaw);
  }

  // ---- buildings ----
  house(x, z, w, d, facing, r, opts = {}) {
    // facing: 0 the street is +z, 1 +x, 2 -z, 3 -x. Built in a local frame (front = +z) then turned.
    const yaw = [0, Math.PI / 2, Math.PI, -Math.PI / 2][facing];
    const two = opts.two ?? r() < 0.3;
    const wallH = two ? 6.2 : 3.2;
    const col = opts.color || PASTELS[Math.floor(r() * PASTELS.length)];
    const trim = [Math.round(col[0] * 0.8), Math.round(col[1] * 0.8), Math.round(col[2] * 0.8), 255];
    const roofCol = r() < 0.5 ? WHITE : [200, 200, 210, 255];
    const g = PAD_Y;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (lx, ly, lz) => [x + lx * c + lz * s, ly, z - lx * s + lz * c];
    const hw = w / 2, hd = d / 2;
    const garage = !two && r() < 0.7;
    const gw = garage ? 3.6 : 0;
    this.emit(x, z, (b, m) => {
      const wall = (p0, p1, mat, u) => b.quad(m(mat), [P(p0[0], g, p0[1]), P(p1[0], g, p1[1]), P(p1[0], g + wallH, p1[1]), P(p0[0], g + wallH, p0[1])], { color: col, uv: [[0, two ? 2 : 1], [u, two ? 2 : 1], [u, 0], [0, 0]] });
      // front: windows, a door in the middle bay, the garage at the side
      const bays = Math.max(2, Math.round((w - gw) / 3));
      const bw = (w - gw) / bays;
      for (let k = 0; k < bays; k++) {
        const a = -hw + k * bw, bb = a + bw;
        wall([a, hd], [bb, hd], k === Math.floor(bays / 2) ? 'housedoor' : 'housewin', 1);
      }
      if (garage) {
        b.quad(m('garage'), [P(hw - gw, g, hd), P(hw, g, hd), P(hw, g + 2.6, hd), P(hw - gw, g + 2.6, hd)], { color: WHITE });
        b.quad(m('stucco'), [P(hw - gw, g + 2.6, hd), P(hw, g + 2.6, hd), P(hw, g + wallH, hd), P(hw - gw, g + wallH, hd)], { color: col, uv: [[0, 0.2], [1, 0.2], [1, 0], [0, 0]] });
      }
      wall([hw, -hd], [-hw, -hd], 'housewin', Math.max(1, Math.round(w / 3.5)));
      wall([hw, hd], [hw, -hd], 'housewin', Math.max(1, Math.round(d / 3.5)));
      wall([-hw, -hd], [-hw, hd], 'housewin', Math.max(1, Math.round(d / 3.5)));
      // roof
      const top = g + wallH, ov = 0.5;
      if (two || r() < 0.25) {
        b.quad(m('roofflat'), [P(-hw, top + 0.3, hd), P(hw, top + 0.3, hd), P(hw, top + 0.3, -hd), P(-hw, top + 0.3, -hd)], { color: WHITE, uv: [[0, 0], [w / 4, 0], [w / 4, d / 4], [0, d / 4]] });
        // parapet
        for (const [a, bb] of [[[-hw, hd], [hw, hd]], [[hw, hd], [hw, -hd]], [[hw, -hd], [-hw, -hd]], [[-hw, -hd], [-hw, hd]]]) b.quad(m('plain'), [P(a[0], top, a[1]), P(bb[0], top, bb[1]), P(bb[0], top + 0.5, bb[1]), P(a[0], top + 0.5, a[1])], { color: trim });
      } else {
        const rh = 1.6 + r() * 0.6;
        const A = P(-hw - ov, top, hd + ov), B = P(hw + ov, top, hd + ov), Cc = P(hw + ov, top, -hd - ov), D = P(-hw - ov, top, -hd - ov);
        const ridge = Math.max(0.5, (w - d) / 2);
        const R1 = P(-ridge, top + rh, 0), R2 = P(ridge, top + rh, 0);
        if (w >= d) {
          b.quad(m('roof'), [A, B, R2, R1], { color: roofCol, uv: [[0, 0], [w / 3, 0], [w / 3, 2], [0, 2]] });
          b.quad(m('roof'), [Cc, D, R1, R2], { color: [...roofCol.slice(0, 3).map((v) => Math.round(v * 0.8)), 255], uv: [[0, 0], [w / 3, 0], [w / 3, 2], [0, 2]] });
          b.triangle(m('roof'), [B, Cc, R2], { color: [...roofCol.slice(0, 3).map((v) => Math.round(v * 0.9)), 255], uv: [[0, 0], [3, 0], [1.5, 2]] });
          b.triangle(m('roof'), [D, A, R1], { color: [...roofCol.slice(0, 3).map((v) => Math.round(v * 0.7)), 255], uv: [[0, 0], [3, 0], [1.5, 2]] });
        } else {
          const Q1 = P(0, top + rh, -Math.max(0.5, (d - w) / 2)), Q2 = P(0, top + rh, Math.max(0.5, (d - w) / 2));
          b.quad(m('roof'), [B, Cc, Q1, Q2], { color: roofCol, uv: [[0, 0], [d / 3, 0], [d / 3, 2], [0, 2]] });
          b.quad(m('roof'), [D, A, Q2, Q1], { color: [...roofCol.slice(0, 3).map((v) => Math.round(v * 0.8)), 255], uv: [[0, 0], [d / 3, 0], [d / 3, 2], [0, 2]] });
          b.triangle(m('roof'), [A, B, Q2], { color: [...roofCol.slice(0, 3).map((v) => Math.round(v * 0.9)), 255], uv: [[0, 0], [3, 0], [1.5, 2]] });
          b.triangle(m('roof'), [Cc, D, Q1], { color: [...roofCol.slice(0, 3).map((v) => Math.round(v * 0.7)), 255], uv: [[0, 0], [3, 0], [1.5, 2]] });
        }
      }
      // porch step
      b.quad(m('concrete'), [P(-1.2, g + 0.12, hd + 1.4), P(1.2, g + 0.12, hd + 1.4), P(1.2, g + 0.12, hd), P(-1.2, g + 0.12, hd)], { color: WHITE });
    });
    this.lod(x, z, (b, m) => {
      const q = [P(-hw, g, -hd), P(hw, g, -hd), P(hw, g, hd), P(-hw, g, hd)];
      const minx = Math.min(...q.map((p) => p[0])), maxx = Math.max(...q.map((p) => p[0])), minz = Math.min(...q.map((p) => p[2])), maxz = Math.max(...q.map((p) => p[2]));
      box(b, m('plain'), [minx, g, minz], [maxx, g + wallH + 1, maxz], { color: col, faces: ['top', 'n', 's', 'e', 'w'], colors: { top: [168, 84, 58, 255] } });
    });
    this.solid(x, z, facing % 2 ? hd : hw, facing % 2 ? hw : hd, g, g + wallH + 0.4);
    // the yard, the drive
    const front = P(0, 0, hd + 3);
    this.spot(SPOT.HANGOUT, front[0], front[2], yaw);
    if (garage) { const dp = P(hw - gw / 2, 0, hd + 3.2); this.spot(SPOT.PARK, dp[0], dp[2], yaw + Math.PI); }
  }

  // a row of houses along each side of a lot that faces a street
  residential(p, inner) {
    const r = this.r;
    const sides = [];
    // which sides face streets: all of a pad's sides do (pads are surrounded by streets)
    const depth = 13, lotW = 15;
    // yard surfaces: grass everywhere inside, then houses on top
    this.tiles(inner.x0, inner.z0, inner.x1, inner.z1, PAD_Y + 0.005, 'grass', 4);
    this.setGround(inner.x0, inner.z0, inner.x1, inner.z1, GROUND.GRASS);
    const W = inner.x1 - inner.x0, D = inner.z1 - inner.z0;
    // houses along the north and south edges (front to the street), the corners left as yards
    for (const [edge, facing] of [['n', 2], ['s', 0]]) {
      const n = Math.floor((W - 4) / lotW);
      const start = inner.x0 + (W - n * lotW) / 2;
      for (let k = 0; k < n; k++) {
        const cx = start + k * lotW + lotW / 2;
        const w = 9 + r() * 3, d = 8 + r() * 2;
        const cz = edge === 'n' ? inner.z0 + 4 + d / 2 : inner.z1 - 4 - d / 2;
        if (D < 2 * (4 + d) + 2 && edge === 's' && D < 4 + d + 4) continue;
        this.house(cx, cz, w, d, facing, r);
        // side fences between lots, and the driveway
        const fz0 = edge === 'n' ? inner.z0 + 0.5 : inner.z1 - 0.5 - depth;
        if (k > 0) this.fence(start + k * lotW, fz0 + 1.5, start + k * lotW, fz0 + depth, r() < 0.5 ? 'wood' : 'hedge', 1.1);
        const dw = edge === 'n' ? [cx + w / 2 - 1.8, inner.z0 - SIDEWALK, cx + w / 2 + 0.2, inner.z0 + 4] : [cx + w / 2 - 1.8, inner.z1 - 4, cx + w / 2 + 0.2, inner.z1 + SIDEWALK];
        this.tiles(dw[0], dw[1], dw[2], dw[3], PAD_Y + 0.01, 'concrete', 3);
        if (r() < 0.3) this.palm(cx - w / 2 + 1, edge === 'n' ? inner.z0 + 1.5 : inner.z1 - 1.5, r() * 9);
      }
    }
    // a back fence down the middle
    if (D > 30) this.fence(inner.x0 + 2, (inner.z0 + inner.z1) / 2, inner.x1 - 2, (inner.z0 + inner.z1) / 2, 'wood', 1.6);
    void sides;
  }

  cul_de_sac(p, inner) {
    // the home: houses round the turning circle (the circle is a dead-end street node)
    this.residential(p, inner);
  }

  shop(x0, z0, x1, z1, facing, r, opts = {}) {
    // a shop building on the footprint; facing as house(); floors 1..3
    const floors = opts.floors || 1 + Math.floor(r() * 3);
    const fh = 3.6, h = floors * fh + 0.4;
    const col = opts.color || PASTELS[Math.floor(r() * PASTELS.length)];
    const word = opts.sign || ['BURGERS', 'TACOS', 'PIZZA', 'MARKET', 'LIQUOR', 'DINER', 'DONUTS', 'BARBER', 'PAWN', 'BAR', 'LAUNDRY', 'CAFE', 'GYM'][Math.floor(r() * 13)];
    const g = PAD_Y;
    this.emit((x0 + x1) / 2, (z0 + z1) / 2, (b, m) => {
      // walls: brick with windows above, stucco fronts
      const brick = r() < 0.5;
      box(b, m(brick ? 'brickwin' : 'housewin'), [x0, g, z0], [x1, g + h, z1], { color: brick ? WHITE : col, uvScale: [3.5, fh], faces: ['n', 's', 'e', 'w'], vTop: 0 });
      b.quad(m('roofflat'), [[x0, g + h, z0], [x0, g + h, z1], [x1, g + h, z1], [x1, g + h, z0]], { color: WHITE, uv: [[0, 0], [0, (z1 - z0) / 4], [(x1 - x0) / 4, (z1 - z0) / 4], [(x1 - x0) / 4, 0]] });
      // the shop front on the street side (just outside the wall)
      const e = 0.06;
      const front = [
        [[x0, z1 + e], [x1, z1 + e]], [[x1 + e, z1], [x1 + e, z0]], [[x1, z0 - e], [x0, z0 - e]], [[x0 - e, z0], [x0 - e, z1]],
      ][facing];
      const [[ax, az], [bx, bz]] = front;
      const len = Math.hypot(bx - ax, bz - az);
      b.quad(m('shopfront'), [[ax, g, az], [bx, g, bz], [bx, g + 3.4, bz], [ax, g + 3.4, az]], { color: WHITE, uv: [[0, 1], [Math.max(1, Math.round(len / 4)), 1], [Math.max(1, Math.round(len / 4)), 0], [0, 0]] });
      // the sign board and an awning
      const dx = (bx - ax) / len, dz = (bz - az) / len, nx = -dz, nz = dx; // (nx, nz) points out of the building
      const sl = Math.min(len - 1, 8), sm = 0.5 * (len - sl);
      const sa = [ax + dx * sm + nx * 0.1, az + dz * sm + nz * 0.1], sb = [ax + dx * (sm + sl) + nx * 0.1, az + dz * (sm + sl) + nz * 0.1];
      b.quad(m(`sign_${word.toLowerCase()}`), [[sa[0], g + 3.5, sa[1]], [sb[0], g + 3.5, sb[1]], [sb[0], g + 4.6, sb[1]], [sa[0], g + 4.6, sa[1]]], { color: [255, 230 - Math.floor(r() * 120), 140 + Math.floor(r() * 110), 255].map(Math.round), uv: [[0, 1], [1, 1], [1, 0], [0, 0]] });
      const ac = [[200, 40, 40, 255], [40, 110, 60, 255], [40, 70, 150, 255], [220, 160, 40, 255]][Math.floor(r() * 4)];
      b.quad(m('plain2'), [[ax + nx * 1.6, g + 2.8, az + nz * 1.6], [bx + nx * 1.6, g + 2.8, bz + nz * 1.6], [bx, g + 3.4, bz], [ax, g + 3.4, az]], { color: ac });
    });
    this.lod((x0 + x1) / 2, (z0 + z1) / 2, (b, m) => box(b, m('plain'), [x0, g, z0], [x1, g + h, z1], { color: col, faces: ['top', 'n', 's', 'e', 'w'], colors: { top: [138, 134, 128, 255] } }));
    this.solid((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, g, g + h);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const fp = [[cx, z1 + 2], [x1 + 2, cz], [cx, z0 - 2], [x0 - 2, cz]][facing];
    this.spot(SPOT.SHOP, fp[0], fp[1], [0, Math.PI / 2, Math.PI, -Math.PI / 2][facing], ['BURGERS', 'TACOS', 'PIZZA', 'MARKET', 'LIQUOR', 'DINER', 'DONUTS', 'BARBER', 'PAWN', 'BAR', 'LAUNDRY', 'CAFE', 'GYM', 'ARMS', 'CLINIC', 'POLICE'].indexOf(word) + 1);
    return { word, h };
  }

  commercial(p, inner) {
    const r = this.r;
    // shops round the edge, a car park in the middle
    this.tiles(inner.x0, inner.z0, inner.x1, inner.z1, PAD_Y + 0.005, 'asphalt', 4);
    const W = inner.x1 - inner.x0, D = inner.z1 - inner.z0;
    const sd = Math.min(16, D / 3);
    let x = inner.x0;
    while (x < inner.x1 - 8) {
      const w = Math.min(inner.x1 - x, 12 + r() * 10);
      this.shop(x, inner.z0, x + w - 0.5, inner.z0 + sd, 2, r);
      x += w;
    }
    x = inner.x0;
    while (x < inner.x1 - 8) {
      const w = Math.min(inner.x1 - x, 12 + r() * 10);
      this.shop(x, inner.z1 - sd, x + w - 0.5, inner.z1, 0, r);
      x += w;
    }
    // parking rows
    for (let px = inner.x0 + 4; px < inner.x1 - 4; px += 3.2) for (const pz of [inner.z0 + sd + 4, inner.z1 - sd - 4]) {
      if (r() < 0.25) this.spot(SPOT.PARK, px, pz, pz < (inner.z0 + inner.z1) / 2 ? Math.PI : 0);
      this.tiles(px - 0.06, pz - 2.5, px + 0.06, pz + 2.5, PAD_Y + 0.012, 'stucco', 4, [240, 240, 240, 255]);
    }
    this.spot(SPOT.PED, (inner.x0 + inner.x1) / 2, (inner.z0 + inner.z1) / 2);
    void W;
  }

  tower(x0, z0, x1, z1, h, r) {
    const g = PAD_Y;
    const kind = r() < 0.55 ? 'office' : 'office2';
    const col = kind === 'office' ? [220 + Math.floor(r() * 35), 225 + Math.floor(r() * 30), 235, 255] : PASTELS[Math.floor(r() * PASTELS.length)];
    this.emit((x0 + x1) / 2, (z0 + z1) / 2, (b, m) => {
      box(b, m(kind), [x0, g, z0], [x1, g + h, z1], { color: col.map((v, i) => (i < 3 ? Math.min(255, v) : v)), uvScale: [3.5, 4], faces: ['n', 's', 'e', 'w'] });
      b.quad(m('roofflat'), [[x0, g + h, z0], [x0, g + h, z1], [x1, g + h, z1], [x1, g + h, z0]], { color: WHITE, uv: [[0, 0], [0, (z1 - z0) / 6], [(x1 - x0) / 6, (z1 - z0) / 6], [(x1 - x0) / 6, 0]] });
      // a rooftop box (lift room), and a lobby band
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      box(b, m('plain'), [mx - 3, g + h, mz - 3], [mx + 3, g + h + 3, mz + 3], { color: [150, 150, 150, 255], faces: ['top', 'n', 's', 'e', 'w'] });
      box(b, m('plain'), [x0 - 0.2, g, z0 - 0.2], [x1 + 0.2, g + 4.5, z1 + 0.2], { color: [90, 96, 104, 255], faces: ['n', 's', 'e', 'w'] });
    });
    this.lod((x0 + x1) / 2, (z0 + z1) / 2, (b, m) => box(b, m('plain'), [x0, g, z0], [x1, g + h, z1], { color: kind === 'office' ? [120, 150, 180, 255] : [180, 160, 130, 255], faces: ['top', 'n', 's', 'e', 'w'] }));
    this.solid((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2 + 0.2, (z1 - z0) / 2 + 0.2, g, g + h);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    this.solid(mx, mz, 3, 3, g + h, g + h + 3);
  }

  downtown(p, inner) {
    const r = this.r;
    this.tiles(inner.x0, inner.z0, inner.x1, inner.z1, PAD_Y + 0.005, 'concrete', 4);
    const W = inner.x1 - inner.x0, D = inner.z1 - inner.z0;
    // 2x2 towers with a plaza between
    const gap = 10;
    const tw = (W - gap) / 2, td = (D - gap) / 2;
    const dist = Math.hypot((inner.x0 + inner.x1) / 2 - 0, (inner.z0 + inner.z1) / 2 + 150);
    for (const [ix, iz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      if (r() < 0.15) { this.tree(inner.x0 + ix * (tw + gap) + tw / 2, inner.z0 + iz * (td + gap) + td / 2, r() * 9, 1.3); continue; }
      const shrink = 2 + r() * 6;
      const x0 = inner.x0 + ix * (tw + gap) + shrink, z0 = inner.z0 + iz * (td + gap) + shrink;
      const h = Math.max(18, 110 - dist * 0.22 + (r() - 0.5) * 40);
      this.tower(x0, z0, x0 + tw - 2 * shrink, z0 + td - 2 * shrink, Math.round(h / 4) * 4, r);
    }
    const mx = (inner.x0 + inner.x1) / 2, mz = (inner.z0 + inner.z1) / 2;
    this.spot(SPOT.PED, mx, mz); this.spot(SPOT.BENCH, mx + 3, mz);
  }

  warehouse(x0, z0, x1, z1, r) {
    const g = PAD_Y;
    const h = 8 + r() * 5;
    const col = [[200, 200, 205, 255], [190, 170, 140, 255], [160, 180, 190, 255], [200, 150, 120, 255]][Math.floor(r() * 4)];
    this.emit((x0 + x1) / 2, (z0 + z1) / 2, (b, m) => {
      box(b, m('metal'), [x0, g, z0], [x1, g + h, z1], { color: col, uvScale: [2, h], faces: ['n', 's', 'e', 'w'] });
      b.quad(m('roofflat'), [[x0, g + h, z0], [x0, g + h, z1], [x1, g + h, z1], [x1, g + h, z0]], { color: WHITE, uv: [[0, 0], [0, (z1 - z0) / 6], [(x1 - x0) / 6, (z1 - z0) / 6], [(x1 - x0) / 6, 0]] });
      // roll-up doors on the south side
      for (let x = x0 + 3; x < x1 - 6; x += 9) b.quad(m('garage'), [[x, g, z1 + 0.05], [x + 5, g, z1 + 0.05], [x + 5, g + 5, z1 + 0.05], [x, g + 5, z1 + 0.05]], { color: [200, 200, 200, 255] });
    });
    this.lod((x0 + x1) / 2, (z0 + z1) / 2, (b, m) => box(b, m('plain'), [x0, g, z0], [x1, g + h, z1], { color: col, faces: ['top', 'n', 's', 'e', 'w'] }));
    this.solid((x0 + x1) / 2, (z0 + z1) / 2, (x1 - x0) / 2, (z1 - z0) / 2, g, g + h);
  }
  container(x, z, yaw, level, r) {
    const g = PAD_Y + level * 2.6;
    const col = [[190, 60, 40, 255], [40, 90, 160, 255], [60, 130, 70, 255], [200, 150, 40, 255], [150, 150, 150, 255], [120, 60, 120, 255]][Math.floor(r() * 6)];
    this.emit(x, z, (b, m) => boxRotated(b, m('container'), [x, g + 1.3, z], [1.2, 1.3, 6], yaw, { color: col, uvScale: [3, 2.6] }));
    this.lod(x, z, (b, m) => boxRotated(b, m('plain'), [x, g + 1.3, z], [1.2, 1.3, 6], yaw, { color: col }));
    this.solid(x, z, 1.2, 6, g, g + 2.6, { yaw });
  }
  industrial(p, inner) {
    const r = this.r;
    this.tiles(inner.x0, inner.z0, inner.x1, inner.z1, PAD_Y + 0.005, 'concrete', 4);
    const W = inner.x1 - inner.x0, D = inner.z1 - inner.z0;
    this.warehouse(inner.x0 + 2, inner.z0 + 2, inner.x0 + W * 0.55, inner.z0 + D * 0.45, r);
    // container yard
    for (let k = 0; k < 10; k++) {
      const x = inner.x0 + W * 0.62 + (k % 3) * 3.2, z = inner.z0 + 8 + Math.floor(k / 3) * 13;
      if (z > inner.z1 - 8) break;
      this.container(x, z, 0, 0, r);
      if (r() < 0.5) this.container(x, z, 0, 1, r);
    }
    this.warehouse(inner.x0 + 2, inner.z0 + D * 0.55, inner.x0 + W * 0.5, inner.z1 - 2, r);
    this.fence(inner.x0 + W * 0.55, inner.z1 - 1, inner.x1 - 1, inner.z1 - 1, 'chain', 2.2);
    for (let k = 0; k < 4; k++) this.spot(SPOT.PARK, inner.x0 + W * 0.56 + k * 3.2, inner.z1 - 8, 0);
  }

  park(p, inner, kind) {
    const r = this.r;
    this.tiles(inner.x0, inner.z0, inner.x1, inner.z1, PAD_Y + 0.005, 'grass', 4);
    this.setGround(inner.x0, inner.z0, inner.x1, inner.z1, GROUND.GRASS);
    const mx = (inner.x0 + inner.x1) / 2, mz = (inner.z0 + inner.z1) / 2;
    if (kind === 'G') {
      // the basketball court: Palm Court's hangout
      const cw = 15, cd = 28;
      this.tiles(mx - cw / 2, mz - cd / 2, mx + cw / 2, mz + cd / 2, PAD_Y + 0.012, 'court', 4);
      this.tiles(mx - cw / 2, mz - 0.1, mx + cw / 2, mz + 0.1, PAD_Y + 0.016, 'stucco', 4);
      for (const s of [-1, 1]) {
        const hz = mz + s * (cd / 2 - 1.2);
        this.emit(mx, hz, (b, m) => {
          box(b, m('plain'), [mx - 0.08, PAD_Y, hz - 0.08 + s * 0.5], [mx + 0.08, 3.4, hz + 0.08 + s * 0.5], { color: [80, 80, 90, 255] });
          box(b, m('plain'), [mx - 0.9, 2.9, hz - 0.04], [mx + 0.9, 3.95, hz + 0.04], { color: [240, 240, 240, 255] });
          box(b, m('plain'), [mx - 0.25, 2.95, hz - s * 0.5 - 0.25], [mx + 0.25, 3.0, hz - s * 0.5 + 0.25], { color: [220, 90, 30, 255] });
        });
        this.solid(mx, hz + s * 0.5, 0.12, 0.12, PAD_Y, 3.4, { flags: BOX.THIN });
      }
      this.fence(mx - cw / 2 - 2, mz - cd / 2 - 2, mx + cw / 2 + 2, mz - cd / 2 - 2, 'chain', 3);
      this.fence(mx - cw / 2 - 2, mz + cd / 2 + 2, mx - 2, mz + cd / 2 + 2, 'chain', 3);
      this.fence(mx - cw / 2 - 2, mz - cd / 2 - 2, mx - cw / 2 - 2, mz + cd / 2 + 2, 'chain', 3);
      this.fence(mx + cw / 2 + 2, mz - cd / 2 - 2, mx + cw / 2 + 2, mz + cd / 2 + 2, 'chain', 3);
      for (let k = 0; k < 4; k++) this.spot(SPOT.HANGOUT, mx + (k - 1.5) * 3, mz + cd / 2 + 4, 0);
      this.spot(SPOT.PICKUP, mx, mz, 0, 2); // a pistol under the hoop
    } else {
      // paths, a fountain, trees, benches
      this.tiles(mx - 2, inner.z0, mx + 2, inner.z1, PAD_Y + 0.012, 'concrete', 3);
      this.tiles(inner.x0, mz - 2, inner.x1, mz + 2, PAD_Y + 0.012, 'concrete', 3);
      this.emit(mx, mz, (b, m) => {
        cylinder(b, m('concrete'), mx, mz, PAD_Y, 0.8, 6, 12, { color: WHITE, cap: false });
        cylinder(b, m('plain'), mx, mz, 0.6, 0.62, 5.8, 12, { color: [70, 130, 190, 255] });
        cylinder(b, m('concrete'), mx, mz, 0.6, 2.6, 0.6, 6, { color: WHITE });
      });
      this.solid(mx, mz, 6, 6, PAD_Y, 0.8, { flags: BOX.LOW });
      for (let k = 0; k < 26; k++) {
        const x = inner.x0 + 4 + r() * (inner.x1 - inner.x0 - 8), z = inner.z0 + 4 + r() * (inner.z1 - inner.z0 - 8);
        if (Math.abs(x - mx) < 8 || Math.abs(z - mz) < 8) continue;
        this.tree(x, z, r() * 9);
      }
      for (const [bx, bz] of [[mx + 4, mz - 9], [mx - 4, mz + 9], [mx + 9, mz + 4], [mx - 9, mz - 4]]) this.bench(bx, bz);
      this.spot(SPOT.PED, mx + 8, mz); this.spot(SPOT.PED, mx, mz + 8); this.spot(SPOT.PICKUP, mx + 5, mz + 5, 0, 1);
    }
  }
  bench(x, z) {
    this.emit(x, z, (b, m) => { box(b, m('wood'), [x - 1, 0.5, z - 0.25], [x + 1, 0.6, z + 0.25], { color: WHITE }); box(b, m('plain'), [x - 0.9, PAD_Y, z - 0.2], [x - 0.8, 0.5, z + 0.2], { color: [60, 60, 60, 255] }); box(b, m('plain'), [x + 0.8, PAD_Y, z - 0.2], [x + 0.9, 0.5, z + 0.2], { color: [60, 60, 60, 255] }); });
    this.solid(x, z, 1, 0.25, PAD_Y, 0.6);
    this.spot(SPOT.BENCH, x, z);
  }

  beachfront(p, inner) {
    const r = this.r;
    this.tiles(inner.x0, inner.z0, inner.x1, inner.z1, PAD_Y + 0.005, 'sand', 4);
    this.setGround(inner.x0, inner.z0, inner.x1, inner.z1, GROUND.SAND);
    const W = inner.x1 - inner.x0;
    let x = inner.x0;
    while (x < inner.x1 - 10) {
      const w = Math.min(inner.x1 - x, 14 + r() * 8);
      if (r() < 0.7) this.shop(x, inner.z0, x + w - 1, inner.z0 + 14, 2, r, { floors: 1 + Math.floor(r() * 2), sign: ['TACOS', 'BAR', 'CAFE', 'MOTEL', 'DONUTS', 'BURGERS'][Math.floor(r() * 6)] });
      x += w;
    }
    for (let k = 0; k < 6; k++) this.palm(inner.x0 + 6 + r() * (W - 12), inner.z1 - 4 - r() * 20, r() * 9);
    for (let k = 0; k < 6; k++) this.spot(SPOT.PARK, inner.x0 + 10 + k * 14, inner.z1 - 6, Math.PI / 2);
  }

  // the beach south of the coast road, the pier, the docks' quay
  coast() {
    const r = this.r;
    for (let x = -560; x < 340; x += 22 + r() * 18) this.palm(x, 596 + r() * 6, r() * 9);
    // lifeguard towers
    for (const x of [-420, -220, 40, 240]) {
      const z = 612, g = this.heightAt(x, z);
      this.emit(x, z, (b, m) => {
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(b, m('wood'), [x + dx * 1.1 - 0.08, g, z + dz * 1.1 - 0.08], [x + dx * 1.1 + 0.08, g + 2.4, z + dz * 1.1 + 0.08], { color: WHITE });
        box(b, m('plain'), [x - 1.4, g + 2.4, z - 1.4], [x + 1.4, g + 4.6, z + 1.4], { color: [230, 230, 220, 255] });
        box(b, m('plain'), [x - 1.6, g + 4.6, z - 1.6], [x + 1.6, g + 4.8, z + 1.6], { color: [200, 60, 50, 255] });
      });
      this.solid(x, z, 1.4, 1.4, g + 2.4, g + 4.8);
    }
    // the pier: a wooden deck on posts out over the water, with a ramp up from the sand
    const px = -12, pw = 7, pz0 = 598, pz1 = 740, py = 2.2;
    for (let z = pz0; z < pz1; z += 16) {
      const ze = Math.min(pz1, z + 16);
      this.emit(px, (z + ze) / 2, (b, m) => {
        b.quad(m('wood'), [[px - pw, py, z], [px - pw, py, ze], [px + pw, py, ze], [px + pw, py, z]], { color: WHITE, uv: [[0, 0], [0, (ze - z) / 2], [pw, (ze - z) / 2], [pw, 0]] });
        for (const s of [-1, 1]) {
          box(b, m('wood'), [px + s * pw - 0.15, py, z], [px + s * pw + 0.15, py + 1.0, ze], { color: [200, 190, 180, 255], uvScale: 2 });
          box(b, m('wood'), [px + s * (pw - 0.6) - 0.2, -3, z + 7.8], [px + s * (pw - 0.6) + 0.2, py, z + 8.2], { color: [150, 140, 130, 255] });
        }
      });
      this.lod(px, (z + ze) / 2, (b, m) => b.quad(m('plain'), [[px - pw, py, z], [px - pw, py, ze], [px + pw, py, ze], [px + pw, py, z]], { color: [156, 116, 72, 255] }));
      for (const s of [-1, 1]) this.solid(px + s * pw, (z + ze) / 2, 0.15, (ze - z) / 2, py, py + 1.0, { flags: BOX.THIN });
    }
    this.solid(px, (pz0 + pz1) / 2, pw, (pz1 - pz0) / 2, py - 0.5, py, { flags: BOX.LOW });
    // the ramp from the boardwalk
    const rz0 = 586, rz1 = pz0;
    this.emit(px, (rz0 + rz1) / 2, (b, m) => b.quad(m('wood'), [[px - pw, PAD_Y, rz0], [px - pw, py, rz1], [px + pw, py, rz1], [px + pw, PAD_Y, rz0]], { color: WHITE, uv: [[0, 0], [0, 6], [pw, 6], [pw, 0]] }));
    this.solid(px, (rz0 + rz1) / 2, pw, (rz1 - rz0) / 2, -1, py, { flags: BOX.RAMP, r0: PAD_Y, r1: py });
    // a hut at the end of the pier
    this.emit(px, pz1 - 8, (b, m) => { box(b, m('wood'), [px - 4, py, pz1 - 12], [px + 4, py + 3.2, pz1 - 4], { color: [230, 220, 200, 255], uvScale: 2 }); box(b, m('plain'), [px - 4.6, py + 3.2, pz1 - 12.6], [px + 4.6, py + 3.5, pz1 - 3.4], { color: [40, 120, 150, 255] }); });
    this.solid(px, pz1 - 8, 4, 4, py, py + 3.5);
    this.spot(SPOT.PICKUP, px, pz1 - 2, 0, 4);
    // the docks: a concrete quay along the east coast with bollards and cranes
    const qx0 = 584, qx1 = 612;
    for (let z = -560; z < 560; z += 32) {
      const ze = Math.min(560, z + 32);
      this.tiles(qx0, z, qx1, ze, 0.6, 'concrete', 4);
      this.emit(qx1, (z + ze) / 2, (b, m) => b.quad(m('concrete'), [[qx1, -4, ze], [qx1, -4, z], [qx1, 0.6, z], [qx1, 0.6, ze]], { color: [180, 180, 180, 255], uv: [[0, 1], [4, 1], [4, 0], [0, 0]] }));
      this.lod(qx1, (z + ze) / 2, (b, m) => b.quad(m('plain'), [[qx0, 0.6, z], [qx0, 0.6, ze], [qx1, 0.6, ze], [qx1, 0.6, z]], { color: [168, 165, 158, 255] }));
    }
    this.solid((qx0 + qx1) / 2, 0, (qx1 - qx0) / 2, 560, -6, 0.6, { flags: BOX.LOW });
    for (const z of [-480, -280, 300, 480]) this.crane(604, z);
  }
  crane(x, z) {
    this.emit(x, z, (b, m) => {
      for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) box(b, m('plain'), [x + dx - 0.4, 0.6, z + dz - 0.4], [x + dx + 0.4, 22, z + dz + 0.4], { color: [210, 160, 40, 255] });
      box(b, m('plain'), [x - 5, 22, z - 5], [x + 5, 25, z + 5], { color: [200, 150, 36, 255] });
      box(b, m('plain'), [x - 30, 25, z - 1], [x + 34, 27, z + 1], { color: [210, 160, 40, 255] });
      box(b, m('plain'), [x - 2, 25, z - 2], [x + 2, 29, z + 2], { color: [230, 230, 230, 255] });
    });
    this.lod(x, z, (b, m) => { box(b, m('plain'), [x - 4.4, 0.6, z - 4.4], [x + 4.4, 25, z + 4.4], { color: [190, 140, 30, 255], faces: ['n', 's', 'e', 'w'] }); box(b, m('plain'), [x - 30, 25, z - 1], [x + 34, 27, z + 1], { color: [210, 160, 40, 255] }); });
    for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) this.solid(x + dx, z + dz, 0.4, 0.4, 0.6, 22);
    this.solid(x, z, 5, 5, 22, 25); this.solid(x + 2, z, 32, 1, 25, 27);
  }

  hills() {
    const r = this.r;
    // trees over the hills, a radio mast on the top, dirt jumps for bikes
    for (let k = 0; k < 140; k++) {
      const x = -660 + r() * 450, z = -660 + r() * 330;
      if (x > LINES[3] - 10 || z > LINES[2] - 10) continue;
      if (x > LINES[0] + 4 && z < LINES[0] + 9 && z > LINES[0] - 9) continue;
      const h = this.heightAt(x, z);
      if (h < 1.5) continue;
      this.tree(x, z, r() * 9, 1 + r() * 0.5);
    }
    const tx = -470, tz = -500, th = this.heightAt(tx, tz);
    this.emit(tx, tz, (b, m) => {
      for (let y = 0; y < 40; y += 5) box(b, m('plain'), [tx - 1.5 + y * 0.02, th + y, tz - 1.5 + y * 0.02], [tx + 1.5 - y * 0.02, th + y + 0.3, tz + 1.5 - y * 0.02], { color: [200, 60, 50, 255] });
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(b, m('plain'), [tx + dx * 1.4 - 0.1, th, tz + dz * 1.4 - 0.1], [tx + dx * 0.6 + 0.1, th + 40, tz + dz * 0.6 + 0.1], { color: [220, 220, 220, 255] });
    });
    this.lod(tx, tz, (b, m) => box(b, m('plain'), [tx - 1, th, tz - 1], [tx + 1, th + 40, tz + 1], { color: [210, 90, 80, 255] }));
    this.solid(tx, tz, 1.6, 1.6, th, th + 40);
    for (const [x, z, yaw] of [[-380, -400, 0.3], [-300, -520, 2.0], [-520, -330, -0.8], [-420, -560, 1.2], [-250, -430, 2.6]]) this.car_ramp(x, z, yaw, 10, 2.4, 5);
    this.spot(SPOT.PICKUP, tx + 4, tz + 4, 0, 5);
  }

  // ---- everything ----
  build() {
    this.buildHeights();
    this.planStreets();
    this.buildStreetGraph();
    this.planBlocks();
    for (const p of this.pads) {
      const inner = this.drawPad(p);
      const k = p.kind;
      if (RESIDENTIAL.has(k)) this.residential(p, inner);
      else if (k === 'K') this.cul_de_sac(p, inner);
      else if (k === 'C') this.commercial(p, inner);
      else if (k === 'D') this.downtown(p, inner);
      else if (k === 'I') this.industrial(p, inner);
      else if (k === 'P' || k === 'G') this.park(p, inner, k);
      else if (k === 'B') this.beachfront(p, inner);
    }
    this.linkWalks();
    this.drawStreets();
    this.coast();
    this.hills();
    this.drawTerrain();
    // the special places: the clinic, the police station, the gun shop (in Commerce Row)
    this.landmarks();
    return this;
  }
  landmarks() {
    // pick shop spots near given points for the clinic / police / arms (the game finds them by type)
    const nearest = (x, z) => this.spots.filter((s) => s.type === SPOT.SHOP).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z))[0];
    const clinic = nearest(-64, 250); if (clinic) { clinic.type = SPOT.HOSPITAL; }
    const police = nearest(100, -60); if (police) police.type = SPOT.POLICE;
    const arms = nearest(-150, 380); if (arms) arms.param = 14; // ARMS
  }

  // ---- the map picture: one pixel per 5.25 m (256 px across) ----
  drawMap(Canvas) {
    const N = 256, s = WORLD.size / N;
    const cv = new Canvas(N, N, [42, 88, 128, 255]);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const wx = WORLD.min + (x + 0.5) * s, wz = WORLD.min + (y + 0.5) * s;
      const h = this.heightAt(wx, wz);
      if (h > WATER_Y) cv.setRaw(x, y, h > 2 ? [86 + Math.min(60, h * 2), 130 + Math.min(40, h), 70, 255] : [210, 196, 150, 255]);
    }
    const fill = (x0, z0, x1, z1, c) => {
      for (let y = Math.floor((z0 - WORLD.min) / s); y < Math.ceil((z1 - WORLD.min) / s); y++)
        for (let x = Math.floor((x0 - WORLD.min) / s); x < Math.ceil((x1 - WORLD.min) / s); x++) if (x >= 0 && y >= 0 && x < N && y < N) cv.setRaw(x, y, c);
    };
    const DCOL = { R: [92, 140, 84, 255], K: [92, 140, 84, 255], G: [92, 140, 84, 255], V: [140, 108, 150, 255], Y: [170, 150, 84, 255], S: [124, 140, 110, 255], C: [150, 138, 120, 255], D: [128, 132, 140, 255], I: [120, 116, 108, 255], P: [90, 150, 70, 255], B: [200, 186, 140, 255] };
    for (const p of this.pads) fill(p.x0, p.z0, p.x1, p.z1, DCOL[p.kind] || [140, 140, 140, 255]);
    for (const b of this.boxes) if (b.y1 - b.y0 > 3 && b.hx > 2 && b.hz > 2 && !b.yaw) fill(b.cx - b.hx, b.cz - b.hz, b.cx + b.hx, b.cz + b.hz, [196, 190, 180, 255]);
    for (const e of this.streetEdges) {
      const A = this.streetNodes[e.a], B = this.streetNodes[e.b];
      const w = Math.max(e.half, 3.5);
      if (A.z === B.z) fill(A.x, A.z - w, B.x, A.z + w, [60, 62, 66, 255]); else fill(A.x - w, A.z, A.x + w, B.z, [60, 62, 66, 255]);
    }
    for (const n of this.streetNodes) if (n.deg === 1) fill(n.x - 13, n.z - 13, n.x + 13, n.z + 13, [60, 62, 66, 255]);
    fill(-19, 586, -5, 740, [156, 116, 72, 255]);
    fill(584, -560, 612, 560, [168, 165, 158, 255]);
    return cv;
  }
}

export { DMAP };
