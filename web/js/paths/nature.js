// Roads & nature: plants, rocks and mushrooms. Every kind is a small low-poly model in the style of
// SM64 (vertex-shaded blobs and prisms, cut-out sprites for grass and flowers) or one of the game's
// own trees (real objects: Mario can climb them). Painted plants are batched per 2048-unit chunk
// into a few models, so thousands of them cost a handful of objects.

import { Mesh, V, MAT, prism, blob, crossed } from './mesh.js';
import * as T from './textures.js';
import { rng, clamp } from './geom.js';

export const CHUNK = 2048;

const GREEN = [96, 196, 60], DARK = [60, 140, 64], BARK = [140, 98, 62];
const tulip = (c) => ({ sprite: ['tulip', c], w: 46, h: 70 });
const flower = (id, label, spec, extra = {}) => ({ id, label, group: 'Flowers', spacing: 34, scale: [0.8, 1.25], align: 0.6, small: true, ...spec, ...extra });

// type: 'sm64' (a game object), 'mesh' (built here). small: hidden from further away (LOD).
export const KINDS = [
  // trees
  { id: 'oak', label: 'Round tree', group: 'Trees', spacing: 280, scale: [0.85, 1.3], align: 0, collision: 'trunk', icon: ['blob', GREEN] },
  { id: 'pine', label: 'Pine', group: 'Trees', spacing: 230, scale: [0.85, 1.35], align: 0, collision: 'trunk', icon: ['cone', DARK] },
  { id: 'palm', label: 'Palm', group: 'Trees', spacing: 300, scale: [0.85, 1.25], align: 0, collision: 'trunk', icon: ['palm', [96, 168, 64]] },
  { id: 'cherry', label: 'Cherry blossom', group: 'Trees', spacing: 280, scale: [0.85, 1.25], align: 0, collision: 'trunk', icon: ['blob', [244, 172, 204]] },
  { id: 'autumn', label: 'Autumn tree', group: 'Trees', spacing: 280, scale: [0.85, 1.3], align: 0, collision: 'trunk', icon: ['blob', [228, 120, 44]] },
  { id: 'dead', label: 'Dead tree', group: 'Trees', spacing: 260, scale: [0.85, 1.3], align: 0, collision: 'trunk', icon: ['dead', [130, 116, 100]] },
  { id: 'sm64_bubbly', label: 'SM64 bubbly tree', group: 'Game trees', type: 'sm64', entry: 'tree:bubbly_tree', spacing: 320, scale: [1, 1], align: 0, icon: ['blob', [60, 160, 60]], climb: true },
  { id: 'sm64_pine', label: 'SM64 pine', group: 'Game trees', type: 'sm64', entry: 'tree:spiky_tree', spacing: 300, scale: [1, 1], align: 0, icon: ['cone', [50, 120, 70]], climb: true },
  { id: 'sm64_snow', label: 'SM64 snowy pine', group: 'Game trees', type: 'sm64', entry: 'tree:snow_tree', spacing: 300, scale: [1, 1], align: 0, icon: ['cone', [200, 220, 230]], climb: true },
  { id: 'sm64_palm', label: 'SM64 palm', group: 'Game trees', type: 'sm64', entry: 'tree:palm_tree', spacing: 320, scale: [1, 1], align: 0, icon: ['palm', [80, 150, 60]], climb: true },
  // bushes
  { id: 'bush', label: 'Bush', group: 'Bushes', spacing: 120, scale: [0.75, 1.3], align: 0.5, icon: ['bush', [92, 152, 62]] },
  { id: 'bush_berry', label: 'Berry bush', group: 'Bushes', spacing: 120, scale: [0.75, 1.25], align: 0.5, icon: ['bush', [80, 140, 60], [220, 40, 50]] },
  { id: 'bush_flower', label: 'Flowering bush', group: 'Bushes', spacing: 120, scale: [0.75, 1.25], align: 0.5, icon: ['bush', [90, 150, 70], [250, 160, 210]] },
  { id: 'hedgeball', label: 'Round shrub', group: 'Bushes', spacing: 110, scale: [0.8, 1.2], align: 0, icon: ['bush', [60, 120, 56]] },
  // flowers
  flower('tulip_red', 'Red tulips', tulip([226, 46, 52])),
  flower('tulip_yellow', 'Yellow tulips', tulip([246, 206, 50])),
  flower('tulip_pink', 'Pink tulips', tulip([244, 128, 180])),
  flower('tulip_purple', 'Purple tulips', tulip([150, 86, 210])),
  flower('daisy', 'Daisies', { sprite: ['daisy', [250, 250, 246]], w: 40, h: 40 }),
  flower('daisy_yellow', 'Yellow daisies', { sprite: ['daisy', [252, 214, 70]], w: 40, h: 40 }),
  flower('sunflower', 'Sunflowers', { sprite: ['sunflower', [250, 200, 40]], w: 74, h: 150 }, { spacing: 60 }),
  flower('rose_red', 'Red roses', { sprite: ['rose', [214, 30, 50]], w: 60, h: 52 }, { spacing: 50 }),
  flower('rose_white', 'White roses', { sprite: ['rose', [248, 244, 236]], w: 60, h: 52 }, { spacing: 50 }),
  flower('rose_pink', 'Pink roses', { sprite: ['rose', [246, 150, 186]], w: 60, h: 52 }, { spacing: 50 }),
  flower('bluebell', 'Bluebells', { sprite: ['bell', [100, 120, 236]], w: 44, h: 70 }),
  flower('poppy', 'Poppies', { sprite: ['poppy', [236, 70, 40]], w: 40, h: 40 }),
  // grass
  { id: 'grass', label: 'Grass tufts', group: 'Grass', spacing: 40, scale: [0.7, 1.3], align: 0.8, small: true, sprite: ['grass'], w: 64, h: 44, count: 3, icon: ['sprite'] },
  { id: 'tallgrass', label: 'Tall grass', group: 'Grass', spacing: 50, scale: [0.8, 1.3], align: 0.6, small: true, sprite: ['tallgrass'], w: 70, h: 120, count: 3, icon: ['sprite'] },
  { id: 'fern', label: 'Ferns', group: 'Grass', spacing: 60, scale: [0.8, 1.3], align: 0.6, small: true, sprite: ['fern'], w: 80, h: 64, count: 3, icon: ['sprite'] },
  { id: 'reeds', label: 'Reeds', group: 'Grass', spacing: 50, scale: [0.8, 1.3], align: 0.2, small: true, sprite: ['reeds'], w: 64, h: 160, count: 2, water: 'near', icon: ['sprite'] },
  // rocks & mushrooms
  { id: 'rock_small', label: 'Small rocks', group: 'Rocks & mushrooms', spacing: 70, scale: [0.6, 1.4], align: 0.8, small: true, icon: ['rock', [150, 146, 140]] },
  { id: 'rock_big', label: 'Boulder', group: 'Rocks & mushrooms', spacing: 300, scale: [0.8, 1.4], align: 0.3, collision: 'solid', icon: ['rock', [130, 126, 120]] },
  { id: 'mushroom_red', label: 'Red mushrooms', group: 'Rocks & mushrooms', spacing: 50, scale: [0.7, 1.4], align: 0.4, small: true, icon: ['mushroom', [220, 40, 30]] },
  { id: 'mushroom_brown', label: 'Brown mushrooms', group: 'Rocks & mushrooms', spacing: 46, scale: [0.7, 1.3], align: 0.4, small: true, icon: ['mushroom', [150, 100, 60]] },
  { id: 'mushroom_big', label: 'Giant mushroom', group: 'Rocks & mushrooms', spacing: 420, scale: [0.85, 1.3], align: 0, collision: 'solid', icon: ['mushroom', [220, 40, 30]] },
  // water
  { id: 'lilypad', label: 'Lily pads', group: 'Water', spacing: 90, scale: [0.7, 1.4], align: 0, small: true, water: 'on', icon: ['lily', [90, 160, 60]] },
];
export const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k]));
export const GROUPS = [...new Set(KINDS.map((k) => k.group))];

export const PRESETS = {
  meadow: { label: 'Meadow', kinds: { grass: 6, daisy: 2, tulip_red: 1, tulip_yellow: 1, poppy: 1, bluebell: 0.6, bush: 0.4, oak: 0.08 }, density: 45 },
  forest: { label: 'Forest', kinds: { oak: 2, pine: 2.4, bush: 1, fern: 2.5, mushroom_red: 0.5, rock_small: 0.7, grass: 2 }, density: 55 },
  flowerbed: { label: 'Flower bed', kinds: { tulip_red: 1, tulip_yellow: 1, tulip_pink: 1, tulip_purple: 1, rose_red: 0.7, daisy: 0.8, bluebell: 0.6 }, density: 85 },
  jungle: { label: 'Jungle', kinds: { palm: 1.6, fern: 3, tallgrass: 3, bush_flower: 1, bush: 1, reeds: 0.4 }, density: 60 },
  autumn: { label: 'Autumn', kinds: { autumn: 2.2, dead: 0.3, bush_berry: 1, mushroom_brown: 1, rock_small: 0.6, grass: 1.5 }, density: 50 },
  pond: { label: 'Pond edge', kinds: { reeds: 2, lilypad: 2, tallgrass: 1, rock_small: 0.5 }, density: 55 },
};

// ---- a mesh that places what is drawn into it (move, turn, tilt, scale) -------------------------

class Placed {
  constructor(mesh, inst, align) {
    this.mesh = mesh;
    this.mats = mesh.mats;
    const s = inst.s, cy = Math.cos(inst.yaw), sy = Math.sin(inst.yaw);
    // tilt: the up axis leans toward the ground normal by `align`
    let nx = (inst.nx || 0) * align, nz = (inst.nz || 0) * align;
    const ny = Math.sqrt(Math.max(0.2, 1 - nx * nx - nz * nz));
    const L = Math.hypot(nx, ny, nz); nx /= L; nz /= L;
    const up = [nx, ny / L, nz];
    // a frame: x' from yaw, made perpendicular to up
    let ax = [cy, 0, -sy];
    const d = ax[0] * up[0] + ax[2] * up[2];
    ax = [ax[0] - up[0] * d, ax[1] - up[1] * d, ax[2] - up[2] * d];
    const la = Math.hypot(...ax) || 1; ax = ax.map((v) => v / la);
    const az = [ax[1] * up[2] - ax[2] * up[1], ax[2] * up[0] - ax[0] * up[2], ax[0] * up[1] - ax[1] * up[0]];
    this.m = { ax, up, az, s, o: [inst.x, inst.y, inst.z] };
  }
  P(p) { const { ax, up, az, s, o } = this.m; return [o[0] + (ax[0] * p[0] + up[0] * p[1] + az[0] * p[2]) * s, o[1] + (ax[1] * p[0] + up[1] * p[1] + az[1] * p[2]) * s, o[2] + (ax[2] * p[0] + up[2] * p[1] + az[2] * p[2]) * s]; }
  N(n) { if (!n) return n; const { ax, up, az } = this.m; return [ax[0] * n[0] + up[0] * n[1] + az[0] * n[2], ax[1] * n[0] + up[1] * n[1] + az[1] * n[2], ax[2] * n[0] + up[2] * n[1] + az[2] * n[2]]; }
  mat(...a) { return this.mesh.mat(...a); }
  tri(key, a, b, c, face, lit) {
    const t = (v) => ({ ...v, p: this.P(v.p), n: this.N(v.n) });
    this.mesh.tri(key, t(a), t(b), t(c), face ? this.N(face) : null, lit);
  }
  quad(key, a, b, c, d, face, lit) { this.tri(key, a, b, c, face, lit); this.tri(key, a, c, d, face, lit); }
  colTri(a, b, c, type, face) { this.mesh.colTri(this.P(a), this.P(b), this.P(c), type, face ? this.N(face) : null); }
  colQuad(a, b, c, d, type, face) { this.colTri(a, b, c, type, face); this.colTri(a, c, d, type, face); }
}

const mix = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const vary = (c, r, amt = 0.14) => mix(c, 1 - amt / 2 + r() * amt);

// collision for a trunk: a 6-sided wall ring
function trunkCollision(m, r, h, y0 = -20) {
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p0 = [Math.cos(a0) * r, y0, Math.sin(a0) * r], p1 = [Math.cos(a1) * r, y0, Math.sin(a1) * r];
    const out = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
    m.colQuad(p0, p1, [p1[0], h, p1[2]], [p0[0], h, p0[2]], 0, out);
  }
}

function canopyTree(m, r, leafCols, trunkCol) {
  prism(m, 'bark', [0, -12, 0], { n: 6, r0: 22, r1: 13, h: 185, col: trunkCol, uvScale: 64, cap: false, rot: r() * 3 });
  // a little root flare
  prism(m, 'bark', [0, -12, 0], { n: 6, r0: 30, r1: 20, h: 26, col: mix(trunkCol, 0.85), uvScale: 64, cap: false, rot: r() * 3 });
  const blobs = [[0, 240, 0, 128, 96], [62 + r() * 18, 205, 26, 84, 70], [-58 - r() * 16, 210, -22, 88, 72], [8, 296, -10, 78, 62], [-12, 196, 70, 70, 58]];
  for (const [x, y, z, rr, ry] of blobs) {
    const col = leafCols[Math.floor(r() * leafCols.length)];
    blob(m, 'leaf', [x, y, z], { rx: rr, ry, rz: rr * (0.9 + r() * 0.2), seg: 7, rings: 4, col: vary(col, r), jitter: 0.16, rand: r, uvScale: 70 });
  }
  trunkCollision(m, 20, 170);
}

const KIND_BUILD = {
  oak: (m, r) => canopyTree(m, r, [GREEN, [84, 178, 54], [124, 210, 76]], BARK),
  cherry: (m, r) => canopyTree(m, r, [[246, 178, 208], [240, 160, 196], [250, 200, 222]], [104, 72, 62]),
  autumn: (m, r) => canopyTree(m, r, [[232, 124, 44], [216, 78, 40], [240, 184, 62], [196, 100, 40]], [110, 80, 56]),
  pine: (m, r) => {
    prism(m, 'bark', [0, -12, 0], { n: 6, r0: 15, r1: 10, h: 120, col: [112, 80, 54], uvScale: 64, cap: false });
    const tiers = [[60, 120, 150], [150, 92, 135], [235, 64, 118]];
    tiers.forEach(([y, rad, h], k) => {
      const col = vary(k === 2 ? [70, 160, 76] : [56, 140, 68], r);
      const rot = r() * 3;
      prism(m, 'leaf', [0, y, 0], { n: 8, r0: rad, r1: 0, h, col, uvScale: 60, cap: false, rot });
      // the underside, darker
      for (let i = 0; i < 8; i++) {
        const a0 = rot + (i / 8) * Math.PI * 2, a1 = rot + ((i + 1) / 8) * Math.PI * 2;
        m.tri('leaf', V([0, y + 18, 0], [0.5, 0.5], mix(col, 0.45)), V([Math.cos(a1) * rad, y, Math.sin(a1) * rad], [1, 0], mix(col, 0.55)), V([Math.cos(a0) * rad, y, Math.sin(a0) * rad], [0, 1], mix(col, 0.55)), [0, -1, 0]);
      }
    });
    trunkCollision(m, 14, 160);
  },
  palm: (m, r) => {
    const bend = 40 + r() * 50, H = 300;
    const pt = (t) => [bend * t * t, t * H, 0];
    const N = 6;
    for (let k = 0; k < N; k++) {
      const p0 = pt(k / N), p1 = pt((k + 1) / N);
      const r0 = 15 - k * 1.1, r1 = 15 - (k + 1) * 1.1;
      prism(m, 'bark', [p0[0], p0[1] - (k === 0 ? 12 : 0), p0[2]], { n: 6, r0: r0 + 1.5, r1, h: p1[1] - p0[1] + (k === 0 ? 12 : 0), col: k % 2 ? [196, 162, 112] : [176, 142, 96], uvScale: 40, cap: false, lean: [p1[0] - p0[0], 0] });
    }
    const top = pt(1);
    const fronds = 7;
    for (let f = 0; f < fronds; f++) {
      const a = (f / fronds) * Math.PI * 2 + r() * 0.4;
      const dx = Math.cos(a), dz = Math.sin(a);
      const L = 150 + r() * 40;
      let prev = top, prevW = 26;
      for (let s = 1; s <= 3; s++) {
        const t = s / 3;
        const p = [top[0] + dx * L * t, top[1] + 30 * t - 110 * t * t, top[2] + dz * L * t];
        const w = 26 * (1 - t) + 6;
        const ox = -dz, oz = dx;
        m.quad('frond', V([prev[0] - ox * prevW, prev[1], prev[2] - oz * prevW], [0, 1 - (t - 1 / 3)]), V([prev[0] + ox * prevW, prev[1], prev[2] + oz * prevW], [1, 1 - (t - 1 / 3)]),
          V([p[0] + ox * w, p[1], p[2] + oz * w], [1, 1 - t]), V([p[0] - ox * w, p[1], p[2] - oz * w], [0, 1 - t]), [0, 1, 0]);
        prev = p; prevW = w;
      }
    }
    for (let c = 0; c < 3; c++) {
      const a = c * 2.1;
      blob(m, 'plain', [top[0] + Math.cos(a) * 14, top[1] - 16, top[2] + Math.sin(a) * 14], { rx: 11, ry: 12, rz: 11, seg: 5, rings: 3, col: [120, 82, 40], rand: r });
    }
    trunkCollision(m, 15, 220);
  },
  dead: (m, r) => {
    const col = [140, 126, 110];
    prism(m, 'bark', [0, -12, 0], { n: 5, r0: 18, r1: 7, h: 220, col, uvScale: 48, cap: true, rot: r() * 3 });
    for (let b = 0; b < 5; b++) {
      const a = r() * Math.PI * 2, y = 90 + b * 26 + r() * 20, len = 70 + r() * 50;
      const lx = Math.cos(a) * len, lz = Math.sin(a) * len;
      prism(m, 'bark', [Math.cos(a) * 6, y, Math.sin(a) * 6], { n: 4, r0: 6 - b * 0.6, r1: 1.5, h: len * 0.6, col: mix(col, 0.92), uvScale: 48, cap: false, lean: [lx, lz] });
    }
    trunkCollision(m, 16, 180);
  },
  bush: (m, r) => {
    blob(m, 'leaf', [0, 26, 0], { rx: 74, ry: 52, rz: 66, seg: 7, rings: 4, col: vary([90, 176, 60], r), jitter: 0.18, rand: r, flatBottom: true, uvScale: 60 });
    blob(m, 'leaf', [36, 18, 24], { rx: 46, ry: 36, rz: 42, seg: 6, rings: 3, col: vary([104, 190, 70], r), jitter: 0.15, rand: r, flatBottom: true, uvScale: 60 });
  },
  bush_berry: (m, r) => {
    KIND_BUILD.bush(m, r);
    for (let i = 0; i < 7; i++) {
      const a = r() * 6.28, h = 20 + r() * 50;
      blob(m, 'plain', [Math.cos(a) * 62, h, Math.sin(a) * 56], { rx: 7, ry: 7, rz: 7, seg: 4, rings: 2, col: [226, 36, 52], rand: r, bottomShade: 0.7 });
    }
  },
  bush_flower: (m, r) => {
    KIND_BUILD.bush(m, r);
    for (let i = 0; i < 9; i++) {
      const a = r() * 6.28, h = 26 + r() * 46;
      blob(m, 'plain', [Math.cos(a) * 64, h, Math.sin(a) * 58], { rx: 9, ry: 7, rz: 9, seg: 5, rings: 2, col: i % 3 ? [250, 168, 214] : [252, 246, 250], rand: r, bottomShade: 0.8 });
    }
  },
  hedgeball: (m, r) => {
    prism(m, 'bark', [0, -10, 0], { n: 5, r0: 8, r1: 7, h: 40, col: BARK, cap: false });
    blob(m, 'leaf', [0, 80, 0], { rx: 56, ry: 56, rz: 56, seg: 8, rings: 5, col: vary([64, 150, 58], r), jitter: 0.06, rand: r, uvScale: 50 });
  },
  rock_small: (m, r) => {
    blob(m, 'rock', [0, 8, 0], { rx: 38, ry: 24, rz: 32, seg: 6, rings: 3, col: vary([214, 210, 204], r, 0.2), jitter: 0.4, rand: r, uvScale: 48, bottomShade: 0.55 });
  },
  rock_big: (m, r) => {
    blob(m, 'rock', [0, 40, 0], { rx: 150, ry: 104, rz: 130, seg: 7, rings: 4, col: vary([210, 206, 198], r, 0.16), jitter: 0.32, rand: r, uvScale: 80, bottomShade: 0.5 });
    // a box-ish collision: top floor + sides
    const h = 118, w = 120, d = 104;
    const c = [[-w, -d], [w, -d], [w, d], [-w, d]];
    m.colQuad([c[0][0], h, c[0][1]], [c[1][0], h, c[1][1]], [c[2][0], h, c[2][1]], [c[3][0], h, c[3][1]], 0, [0, 1, 0]);
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      m.colQuad([a[0] * 1.15, -20, a[1] * 1.15], [b[0] * 1.15, -20, b[1] * 1.15], [b[0], h, b[1]], [a[0], h, a[1]], 0, [(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2]);
    }
  },
  mushroom_red: (m, r) => mushroom(m, r, 'cap', [255, 255, 255]),
  mushroom_brown: (m, r) => mushroom(m, r, 'leaf', vary([176, 118, 70], r)),
  mushroom_big: (m, r) => {
    prism(m, 'plain', [0, -14, 0], { n: 8, r0: 56, r1: 44, h: 230, col: [246, 236, 210], cap: false });
    blob(m, 'cap', [0, 228, 0], { rx: 200, ry: 104, rz: 200, seg: 10, rings: 5, col: [255, 255, 255], rand: r, uvScale: 140, flatBottom: true, bottomShade: 0.6 });
    // standing on the cap: a flat top, the stem's walls
    const n = 8, top = 300, rad = 150;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      m.colTri([0, top, 0], [Math.cos(a0) * rad, top - 24, Math.sin(a0) * rad], [Math.cos(a1) * rad, top - 24, Math.sin(a1) * rad], 0, [0, 1, 0]);
      const o = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      m.colQuad([Math.cos(a0) * rad, top - 24, Math.sin(a0) * rad], [Math.cos(a1) * rad, top - 24, Math.sin(a1) * rad], [Math.cos(a1) * rad, top - 100, Math.sin(a1) * rad], [Math.cos(a0) * rad, top - 100, Math.sin(a0) * rad], 0, o);
    }
    trunkCollision(m, 50, 200);
  },
  lilypad: (m, r) => {
    const n = 10, rad = 44, notch = Math.floor(r() * n);
    for (let i = 0; i < n; i++) {
      if (i === notch) continue;
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const uv = (a) => [0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2];
      m.tri('lily', V([0, 1.5, 0], [0.5, 0.5]), V([Math.cos(a1) * rad, 1, Math.sin(a1) * rad], uv(a1)), V([Math.cos(a0) * rad, 1, Math.sin(a0) * rad], uv(a0)), [0, 1, 0]);
    }
    if (r() < 0.3) crossed(m, 'blossom', [8, 1, 4], { w: 22, h: 22, count: 2, rot: r() * 3 });
  },
};

function mushroom(m, r, capKey, capCol) {
  prism(m, 'plain', [0, -6, 0], { n: 6, r0: 9, r1: 7, h: 40, col: [246, 238, 214], cap: false });
  blob(m, capKey, [0, 36, 0], { rx: 30, ry: 22, rz: 30, seg: 7, rings: 3, col: capCol, rand: r, uvScale: 40, flatBottom: true, bottomShade: 0.55 });
}

function spriteKind(m, k, r) {
  const key = `spr:${k.id}`;
  const h = k.h, w = k.w;
  crossed(m, key, [0, -3, 0], { w, h, count: k.count || 2, rot: r() * Math.PI, col: [212, 212, 212], topCol: [255, 255, 255] });
}

// Materials a chunk mesh may use.
function chunkMaterials(mesh) {
  mesh.mat('leaf', T.leaves(), 0);
  mesh.mat('bark', T.bark(), 0);
  mesh.mat('rock', T.rockTex(), 0);
  mesh.mat('cap', T.mushroomCap(), 0);
  mesh.mat('plain', null, 0);
  mesh.mat('lily', T.lilyPad(), MAT.CUTOUT);
  mesh.mat('frond', T.sprite('frond'), MAT.CUTOUT | MAT.DOUBLE);
  mesh.mat('blossom', T.sprite('blossom', [250, 170, 210]), MAT.CUTOUT | MAT.DOUBLE);
  for (const k of KINDS) if (k.sprite) mesh.mat(`spr:${k.id}`, T.sprite(k.sprite[0], k.sprite[1]), MAT.CUTOUT | MAT.DOUBLE);
}

// A stored item [kind, x, y, z, yawDeg, scalePct, nx100, nz100] -> an instance.
export const itemInst = (it) => ({ kind: it[0], x: it[1], y: it[2], z: it[3], yaw: ((it[4] || 0) * Math.PI) / 180, s: (it[5] || 100) / 100, nx: (it[6] || 0) / 100, nz: (it[7] || 0) / 100 });

// Build one mesh with every instance (in world coordinates).
export function buildNatureMesh(insts) {
  const mesh = new Mesh();
  chunkMaterials(mesh);
  for (const inst of insts) {
    const k = KIND[inst.kind];
    if (!k || k.type === 'sm64') continue;
    const seed = (Math.round(inst.x) * 73856093) ^ (Math.round(inst.z) * 19349663);
    const r = rng(seed);
    const pm = new Placed(mesh, inst, k.align ?? 0);
    pm._seed = seed;
    if (k.sprite) spriteKind(pm, k, r);
    else KIND_BUILD[k.id]?.(pm, r);
  }
  return mesh;
}

// About how many triangles one of a kind draws (for the budget shown in the panel).
const TRI_EST = {};
export function trisOf(kind) {
  if (TRI_EST[kind] !== undefined) return TRI_EST[kind];
  const k = KIND[kind];
  if (!k || k.type === 'sm64') return (TRI_EST[kind] = 0);
  return (TRI_EST[kind] = buildNatureMesh([{ kind, x: 0, y: 0, z: 0, yaw: 0, s: 1 }]).tris);
}

// A small picture for the palette (canvas data URL).
export function kindIcon(k, size = 44) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const css = (col, kk = 1) => `rgb(${clamp(col[0] * kk, 0, 255) | 0},${clamp(col[1] * kk, 0, 255) | 0},${clamp(col[2] * kk, 0, 255) | 0})`;
  const s = size / 44;
  g.scale(s, s);
  if (k.sprite) {
    const tex = T.sprite(k.sprite[0], k.sprite[1]);
    const t = document.createElement('canvas');
    t.width = tex.w; t.height = tex.h;
    const img = t.getContext('2d').createImageData(tex.w, tex.h);
    img.data.set(tex.rgba);
    t.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    const hh = 40, ww = (tex.w / tex.h) * hh;
    g.drawImage(t, 22 - ww / 2, 2, ww, hh);
    return c.toDataURL();
  }
  const [shape, col, accent] = k.icon || ['blob', GREEN];
  const trunk = (x, y, w, h) => { g.fillStyle = css(BARK); g.fillRect(x, y, w, h); };
  if (shape === 'blob') {
    trunk(19, 26, 6, 16);
    for (const [x, y, r, kk] of [[22, 18, 13, 1], [13, 23, 8, 0.85], [31, 23, 8, 0.9], [22, 10, 8, 1.1]]) { g.fillStyle = css(col, kk); g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  } else if (shape === 'cone') {
    trunk(20, 34, 4, 9);
    for (const [y, w, h] of [[36, 17, 15], [27, 13, 13], [18, 9, 12]]) { g.fillStyle = css(col, 1 - y / 160); g.beginPath(); g.moveTo(22 - w, y); g.lineTo(22 + w, y); g.lineTo(22, y - h); g.fill(); }
  } else if (shape === 'palm') {
    g.strokeStyle = css([180, 146, 100]); g.lineWidth = 4; g.beginPath(); g.moveTo(18, 43); g.quadraticCurveTo(18, 22, 26, 13); g.stroke();
    g.strokeStyle = css(col); g.lineWidth = 3;
    for (const a of [-2.6, -1.9, -1.2, -0.5, 0.2]) { g.beginPath(); g.moveTo(26, 13); g.quadraticCurveTo(26 + Math.cos(a) * 10, 13 + Math.sin(a) * 10 - 2, 26 + Math.cos(a) * 17, 16 + Math.sin(a) * 9 + 8); g.stroke(); }
  } else if (shape === 'dead') {
    g.strokeStyle = css(col); g.lineCap = 'round';
    for (const [x0, y0, x1, y1, w] of [[22, 43, 22, 10, 5], [22, 26, 12, 14, 2.5], [22, 22, 32, 10, 2.5], [22, 32, 31, 24, 2], [22, 16, 16, 6, 2]]) { g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
  } else if (shape === 'bush') {
    for (const [x, y, r, kk] of [[17, 30, 12, 0.9], [28, 31, 10, 1], [22, 24, 11, 1.1]]) { g.fillStyle = css(col, kk); g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    if (accent) { g.fillStyle = css(accent); for (const [x, y] of [[14, 26], [24, 20], [30, 28], [20, 33], [27, 36]]) { g.beginPath(); g.arc(x, y, 2.4, 0, 7); g.fill(); } }
  } else if (shape === 'rock') {
    g.fillStyle = css(col); g.beginPath(); g.moveTo(6, 40); g.lineTo(10, 24); g.lineTo(22, 16); g.lineTo(34, 21); g.lineTo(39, 40); g.fill();
    g.fillStyle = css(col, 1.2); g.beginPath(); g.moveTo(10, 24); g.lineTo(22, 16); g.lineTo(24, 26); g.fill();
  } else if (shape === 'mushroom') {
    g.fillStyle = css([246, 238, 214]); g.fillRect(18, 24, 8, 17);
    g.fillStyle = css(col); g.beginPath(); g.ellipse(22, 25, 17, 13, 0, Math.PI, 0); g.fill();
    if (col[0] > 200 && col[1] < 80) { g.fillStyle = '#fff'; for (const [x, y] of [[15, 19], [24, 15], [30, 21]]) { g.beginPath(); g.arc(x, y, 2.6, 0, 7); g.fill(); } }
  } else if (shape === 'lily') {
    g.fillStyle = '#3d6fa8'; g.fillRect(0, 30, 44, 14);
    g.fillStyle = css(col); g.beginPath(); g.ellipse(20, 32, 16, 7, 0, 0.3, Math.PI * 2 - 0.2); g.lineTo(20, 32); g.fill();
    g.fillStyle = '#f6a8cc'; g.beginPath(); g.arc(28, 27, 4, 0, 7); g.fill();
  }
  return c.toDataURL();
}
