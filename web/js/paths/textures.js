// Roads & nature: textures. Game textures where SM64 has a fitting one (cobblestone, stone path,
// dirt, wood, rock: read from the engine's block materials) and small hand-made N64-style ones
// (32x32 / 32x64, few colours, dithered) for the rest. Leaves and bark are light grey and get
// their colour from the vertex colours, so one texture serves green, pink and autumn trees.

import { hash2, noise2, clamp } from './geom.js';

const cache = new Map();

// Transparent texels take the colours of the painted ones next to them (ring by ring): texture
// filtering then blends a cut-out's edge with its own colours, not with black -- small sprites
// (flowers) were mostly dark fringe.
function bleed(rgba, w, h) {
  const known = new Uint8Array(w * h);
  let left = 0;
  for (let i = 0; i < w * h; i++) { if (rgba[i * 4 + 3] > 0) known[i] = 1; else left++; }
  if (!left || left === w * h) return;
  for (let pass = 0; pass < 16 && left; pass++) {
    const add = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (known[i]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || !known[yy * w + xx]) continue;
        const o = (yy * w + xx) * 4;
        r += rgba[o]; g += rgba[o + 1]; b += rgba[o + 2]; n++;
      }
      if (n) add.push([i, r / n, g / n, b / n]);
    }
    for (const [i, r, g, b] of add) { rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; known[i] = 1; left--; }
    if (!add.length) break;
  }
}

function make(key, w, h, fn) {
  if (cache.has(key)) return cache.get(key);
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = fn(x, y);
    const o = (y * w + x) * 4;
    rgba[o] = clamp(c[0], 0, 255); rgba[o + 1] = clamp(c[1], 0, 255); rgba[o + 2] = clamp(c[2], 0, 255); rgba[o + 3] = c[3] ?? 255;
  }
  bleed(rgba, w, h);
  const t = { w, h, rgba };
  cache.set(key, t);
  return t;
}

// A canvas-like painter for sprites: transparent, then shapes.
function paint(key, w, h, draw) {
  if (cache.has(key)) return cache.get(key);
  const rgba = new Uint8Array(w * h * 4);
  const px = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const o = (y * w + x) * 4;
    rgba[o] = clamp(c[0], 0, 255); rgba[o + 1] = clamp(c[1], 0, 255); rgba[o + 2] = clamp(c[2], 0, 255); rgba[o + 3] = 255;
  };
  const disc = (cx, cy, r, c, shade = true) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      const k = shade ? 1.12 - 0.35 * ((x - cx + (y - cy)) / (2 * r) + 0.5) : 1;
      px(x, y, [c[0] * k, c[1] * k, c[2] * k]);
    }
  };
  const ellipse = (cx, cy, rx, ry, c, ang = 0) => {
    const R = Math.max(rx, ry);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
      const dx = x - cx, dy = y - cy;
      const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      if ((u * u) / (rx * rx) + (v * v) / (ry * ry) <= 1) {
        const k = 1.08 - 0.25 * (v / ry + 1) / 2;
        px(x, y, [c[0] * k, c[1] * k, c[2] * k]);
      }
    }
  };
  const line = (x0, y0, x1, y1, c, wdt = 1) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      for (let a = 0; a < wdt; a++) px(x + a - (wdt - 1) / 2, y, c);
    }
  };
  draw({ px, disc, ellipse, line, w, h });
  bleed(rgba, w, h);
  const t = { w, h, rgba };
  cache.set(key, t);
  return t;
}

const n2 = (x, y, f, s) => noise2(x * f, y * f, s);
// wrap-around noise so a texture tiles without seams
const tn = (x, y, size, f, s) => {
  const u = x / size, v = y / size;
  const a = n2(x, y, f, s), b = n2(x - size, y, f, s), c = n2(x, y - size, f, s), d = n2(x - size, y - size, f, s);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
};

// ---- game textures --------------------------------------------------------------------

// Block material i (src/studio/editor.c sMaterials) as RGBA32 32x32.
export function gameTexture(engine, index) {
  const key = `game:${index}`;
  if (cache.has(key)) return cache.get(key);
  const M = engine?.M;
  const ptr = M?._studio_material_texels?.(index, 0);
  if (!ptr) return null;
  const src = M.HEAPU8.subarray(ptr, ptr + 2048);
  const rgba = new Uint8Array(32 * 32 * 4);
  for (let p = 0; p < 1024; p++) {
    const v = (src[p * 2] << 8) | src[p * 2 + 1];
    rgba[p * 4] = ((v >> 11) & 31) * 8.226;
    rgba[p * 4 + 1] = ((v >> 6) & 31) * 8.226;
    rgba[p * 4 + 2] = ((v >> 1) & 31) * 8.226;
    rgba[p * 4 + 3] = 255;
  }
  const t = { w: 32, h: 32, rgba };
  cache.set(key, t);
  return t;
}

// ---- surfaces -------------------------------------------------------------------------

export const asphalt = () => make('asphalt', 32, 32, (x, y) => {
  const n = tn(x, y, 32, 0.35, 3) * 18 + tn(x, y, 32, 1.1, 4) * 10;
  const sp = hash2(x, y, 9);
  const v = 70 + n + (sp > 0.94 ? 34 : sp < 0.05 ? -14 : 0);
  return [v, v + 2, v + 7];
});

export const concrete = () => make('concrete', 32, 32, (x, y) => {
  const n = tn(x, y, 32, 0.5, 11) * 12 + hash2(x, y, 12) * 8;
  const grout = x % 16 === 0 || y % 16 === 0;
  const v = (grout ? 132 : 178) + n - (x % 16 === 1 || y % 16 === 1 ? 6 : 0);
  return [v, v - 1, v - 6];
});

export const curbStone = () => make('curb', 32, 32, (x, y) => {
  const n = tn(x, y, 32, 0.6, 21) * 14 + hash2(x, y, 22) * 8;
  const seam = x % 32 === 0;
  const v = (seam ? 150 : 200) + n;
  return [v, v - 2, v - 8];
});

export const gravel = () => paint('gravel', 32, 32, ({ px, disc }) => {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const v = 116 + hash2(x, y, 31) * 22; px(x, y, [v + 6, v, v - 12]); }
  for (let i = 0; i < 70; i++) {
    const cx = hash2(i, 1, 33) * 32, cy = hash2(i, 2, 33) * 32, r = 1.2 + hash2(i, 3, 33) * 1.8;
    const g = 120 + hash2(i, 4, 33) * 90, warm = hash2(i, 5, 33) * 18;
    for (const ox of [-32, 0, 32]) for (const oy of [-32, 0, 32]) disc(cx + ox, cy + oy, r, [g + warm, g + warm * 0.5, g - 8]);
  }
});

export const dirtTex = () => make('dirt', 32, 32, (x, y) => {
  const n = tn(x, y, 32, 0.3, 41) * 26 + tn(x, y, 32, 0.9, 42) * 14;
  const sp = hash2(x, y, 43);
  return [118 + n + (sp > 0.95 ? 22 : 0), 84 + n * 0.8, 52 + n * 0.5];
});

export const planks = () => make('planks', 32, 32, (x, y) => {
  // four planks across (rows), grain along x, dark gaps, two nails each end
  const row = Math.floor(y / 8), yy = y % 8;
  const tone = [0, 14, -8, 8][row];
  const grain = tn(x, y * 4, 32, 0.25, 51 + row) * 22;
  let v = 150 + tone + grain - (yy === 0 ? 70 : yy === 7 ? 26 : yy === 1 ? -10 : 0);
  if ((x === 3 || x === 28) && (yy === 3 || yy === 5)) v -= 70;
  return [v, v * 0.7, v * 0.42];
});

export const stoneWall = () => make('stonewall', 32, 32, (x, y) => {
  // irregular stone blocks with mortar, offset rows
  const row = Math.floor(y / 11);
  const off = row % 2 ? 9 : 0;
  const bx = (x + off) % 16;
  const mortar = y % 11 === 0 || bx === 0;
  const id = Math.floor((x + off) / 16) + row * 7;
  const tone = hash2(id, row, 61) * 40 - 20;
  const n = tn(x, y, 32, 0.6, 62) * 16;
  const v = mortar ? 96 + n * 0.5 : 156 + tone + n - (bx === 1 || y % 11 === 1 ? -12 : 0);
  return [v, v - 4, v - 12];
});

export const metal = () => make('metal', 32, 32, (x, y) => {
  const band = Math.abs(((y % 32) / 31) * 2 - 1);
  const v = 150 + band * 60 + hash2(x, y, 71) * 10;
  return [v, v + 3, v + 8];
});

// ---- plants ---------------------------------------------------------------------------

export const leaves = () => paint('leaves', 32, 32, ({ px, ellipse }) => {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) { const v = 168 + tn(x, y, 32, 0.4, 81) * 40; px(x, y, [v, v, v]); }
  for (let i = 0; i < 46; i++) {
    const cx = hash2(i, 1, 83) * 32, cy = hash2(i, 2, 83) * 32, a = hash2(i, 3, 83) * 3.14;
    const v = 215 + hash2(i, 4, 83) * 40;
    for (const ox of [-32, 0, 32]) for (const oy of [-32, 0, 32]) ellipse(cx + ox, cy + oy, 3.4, 1.9, [v, v, v], a);
  }
});

export const bark = () => make('bark', 32, 32, (x, y) => {
  const n = tn(x * 3, y * 0.6, 96, 0.35, 91) * 60 + hash2(x, y, 92) * 14;
  const crack = tn(x * 2, y * 0.3, 64, 0.5, 93) < 0.25 ? -45 : 0;
  const v = 160 + n + crack;
  return [v, v, v];
});

export const rockTex = () => make('rock', 32, 32, (x, y) => {
  const n = tn(x, y, 32, 0.25, 101) * 40 + tn(x, y, 32, 0.8, 102) * 18;
  const crack = Math.abs(tn(x, y, 32, 0.15, 103) - 0.5) < 0.04 ? -40 : 0;
  const v = 120 + n + crack;
  return [v, v - 2, v - 8];
});

export const mushroomCap = () => paint('mushcap', 32, 32, ({ px, disc }) => {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) px(x, y, [214 + hash2(x, y, 111) * 16, 34, 26]);
  for (const [cx, cy, r] of [[6, 7, 4], [22, 5, 3.4], [15, 18, 4.6], [28, 22, 3], [5, 25, 3.2], [20, 29, 2.6]]) {
    for (const ox of [-32, 0, 32]) for (const oy of [-32, 0, 32]) disc(cx + ox, cy + oy, r, [250, 248, 240], false);
  }
});

export const lilyPad = () => make('lily', 32, 32, (x, y) => {
  const dx = x - 15.5, dy = y - 15.5, a = Math.atan2(dy, dx), r = Math.hypot(dx, dy);
  const vein = Math.abs(Math.sin(a * 5)) < 0.12 && r > 3 ? 26 : 0;
  const v = 100 + tn(x, y, 32, 0.5, 121) * 30 + vein - r * 0.6;
  return [v * 0.55, v + 30, v * 0.35];
});

// Sprites (cut-out). Grass, reeds, ferns and flowers in a few shapes and any colour.
export function sprite(kind, color = [230, 60, 60]) {
  const key = `spr:${kind}:${color.join(',')}`;
  const stem = [70, 150, 50], stemDark = [44, 110, 36];
  const C = (k) => [color[0] * k, color[1] * k, color[2] * k];
  switch (kind) {
    case 'grass': return paint(key, 32, 32, ({ line }) => {
      for (let i = 0; i < 11; i++) {
        const x0 = 3 + hash2(i, 1, 131) * 26, lean = (hash2(i, 2, 131) - 0.5) * 14, top = 2 + hash2(i, 3, 131) * 12;
        const g = hash2(i, 4, 131) > 0.5 ? [96, 176, 60] : [64, 140, 44];
        line(x0, 31, x0 + lean, top, g, 2);
      }
    });
    case 'tallgrass': return paint(key, 32, 64, ({ line }) => {
      for (let i = 0; i < 13; i++) {
        const x0 = 3 + hash2(i, 1, 141) * 26, lean = (hash2(i, 2, 141) - 0.5) * 20, top = 2 + hash2(i, 3, 141) * 22;
        const g = hash2(i, 4, 141) > 0.5 ? [140, 186, 74] : [92, 150, 56];
        line(x0, 63, x0 + lean, top, g, 2);
      }
    });
    case 'reeds': return paint(key, 32, 64, ({ line, ellipse }) => {
      for (let i = 0; i < 7; i++) {
        const x0 = 4 + i * 4 + hash2(i, 1, 151) * 3, lean = (hash2(i, 2, 151) - 0.5) * 6, top = 4 + hash2(i, 3, 151) * 16;
        line(x0, 63, x0 + lean, top, i % 2 ? [92, 140, 60] : [70, 120, 48], 1);
        if (i % 2 === 0) ellipse(x0 + lean * 0.9, top + 7, 1.8, 5, [120, 72, 40]);
      }
      for (let i = 0; i < 6; i++) line(2 + hash2(i, 5, 151) * 28, 63, 2 + hash2(i, 6, 151) * 28, 30 + hash2(i, 7, 151) * 20, [84, 150, 60], 2);
    });
    case 'fern': return paint(key, 32, 32, ({ line }) => {
      for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
        const ex = 16 + s * (6 + k * 4), ey = 4 + k * 6;
        line(16, 31, ex, ey, [60, 140, 50], 2);
        for (let j = 1; j < 6; j++) { const t = j / 6, x = 16 + (ex - 16) * t, y = 31 + (ey - 31) * t; line(x, y, x + s * 3, y - 2, [80, 170, 60], 1); }
      }
    });
    case 'tulip': return paint(key, 32, 64, ({ line, ellipse, disc }) => {
      for (const [x, h] of [[10, 26], [21, 20], [16, 32]]) {
        line(x, 63, x + 1, h + 6, stem, 2);
        ellipse(x - 3, 56 - (63 - h) * 0.2, 2, 7, stemDark, -0.4);
        disc(x + 1, h + 3, 4.6, C(1));
        ellipse(x - 2, h, 2, 4.4, C(1.08));
        ellipse(x + 4, h, 2, 4.4, C(1.08));
        ellipse(x + 1, h - 1, 2, 4, C(0.86));
      }
    });
    case 'daisy': return paint(key, 32, 32, ({ line, ellipse, disc }) => {
      for (const [x, y] of [[9, 12], [22, 9], [16, 19]]) {
        line(x, 31, x, y + 3, stem, 1);
        for (let p = 0; p < 8; p++) { const a = (p / 8) * 6.283; ellipse(x + Math.cos(a) * 3.4, y + Math.sin(a) * 3.4, 2.6, 1.3, C(1), a); }
        disc(x, y, 1.9, [250, 200, 40]);
      }
    });
    case 'sunflower': return paint(key, 32, 64, ({ line, ellipse, disc }) => {
      line(16, 63, 16, 18, [70, 140, 40], 3);
      ellipse(10, 44, 6, 2.6, [60, 140, 40], 0.5);
      ellipse(22, 36, 6, 2.6, [60, 140, 40], -0.5);
      for (let p = 0; p < 14; p++) { const a = (p / 14) * 6.283; ellipse(16 + Math.cos(a) * 8.5, 13 + Math.sin(a) * 8.5, 4.4, 1.9, [252, 206, 40], a); }
      disc(16, 13, 6, [110, 66, 28]);
    });
    case 'rose': return paint(key, 32, 32, ({ ellipse, disc }) => {
      for (let i = 0; i < 9; i++) ellipse(4 + hash2(i, 1, 161) * 24, 14 + hash2(i, 2, 161) * 17, 4.5, 2.4, i % 2 ? [56, 128, 44] : [40, 100, 34], hash2(i, 3, 161) * 3);
      for (const [x, y] of [[9, 11], [22, 13], [15, 20], [25, 23], [6, 22]]) { disc(x, y, 3.6, C(1)); disc(x - 0.5, y - 0.5, 1.6, C(0.7)); }
    });
    case 'bell': return paint(key, 32, 64, ({ line, ellipse }) => {
      for (const [x, h] of [[9, 20], [20, 14], [15, 28]]) {
        line(x, 63, x, h, stem, 1);
        for (let k = 0; k < 4; k++) { const y = h + 4 + k * 6; line(x, y - 2, x + 3, y, stem, 1); ellipse(x + 3.5, y + 2, 2.2, 3, C(1)); }
      }
    });
    case 'poppy': return paint(key, 32, 32, ({ line, ellipse, disc }) => {
      for (const [x, y] of [[9, 10], [22, 8], [16, 16]]) {
        line(x, 31, x, y + 2, stem, 1);
        for (let p = 0; p < 4; p++) { const a = (p / 4) * 6.283 + 0.4; ellipse(x + Math.cos(a) * 2.6, y + Math.sin(a) * 2.6, 3.4, 2.6, C(1), a); }
        disc(x, y, 1.4, [40, 30, 30]);
      }
    });
    case 'blossom': return paint(key, 16, 16, ({ disc }) => {
      for (let p = 0; p < 5; p++) { const a = (p / 5) * 6.283; disc(8 + Math.cos(a) * 3.6, 8 + Math.sin(a) * 3.6, 3, C(1)); }
      disc(8, 8, 2, [250, 220, 90]);
    });
    case 'frond': return paint(key, 16, 64, ({ line }) => {
      line(8, 63, 8, 0, [80, 120, 40], 2);
      for (let j = 2; j < 62; j += 3) { const len = 7 * Math.sin((j / 64) * Math.PI) + 1; line(8, j, 8 - len, j - 3, [60, 150, 50], 1); line(8, j, 8 + len, j - 3, [74, 168, 58], 1); }
    });
    default: return null;
  }
}

// ---- fences ---------------------------------------------------------------------------

export const picket = () => paint('picket', 32, 32, ({ px }) => {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const xx = x % 16;
    const board = xx >= 3 && xx <= 12;
    const point = y < 6 ? Math.abs(xx - 7.5) <= y * 0.9 : true;
    const rail = (y >= 9 && y <= 12) || (y >= 23 && y <= 26);
    if ((board && point) || rail) {
      const v = 236 - (xx === 3 || xx === 12 ? 30 : 0) - (rail && !board ? 22 : 0) + hash2(x, y, 171) * 10;
      px(x, y, [v, v, v - 6]);
    }
  }
});

export const ironBars = () => paint('iron', 32, 32, ({ px }) => {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const xx = x % 8;
    const bar = xx >= 3 && xx <= 4 && y >= 4;
    const spear = y < 5 && Math.abs(xx - 3.5) <= (y - 0.5) * 0.7 && y > 0;
    const rail = (y >= 7 && y <= 8) || (y >= 27 && y <= 28);
    if (bar || spear || rail) { const v = spear ? 70 : 34 + (xx === 4 ? 20 : 0); px(x, y, [v, v, v + 6]); }
  }
});

export const chainLink = () => paint('chain', 32, 32, ({ px }) => {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const a = (x + y) % 8, b = (x - y + 64) % 8;
    if (a === 0 || b === 0) { const v = 170 + hash2(x, y, 181) * 30; px(x, y, [v, v + 4, v + 10]); }
  }
});

export const bamboo = () => paint('bamboo', 32, 32, ({ px }) => {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const xx = x % 8;
    if (xx >= 1 && xx <= 6) {
      const node = (y + (Math.floor(x / 8) * 5)) % 16 === 0;
      const k = 1 - Math.abs(xx - 3.5) / 5;
      const v = node ? 0.7 : k;
      px(x, y, [196 * v + 20, 196 * v + 30, 90 * v]);
    }
    if ((y >= 9 && y <= 10) || (y >= 23 && y <= 24)) px(x, y, [120, 84, 40]);
  }
});

// A colour swatch of a texture for the panels (data URL), scaled up with crisp pixels.
export function swatch(tex, size = 40, tint = null) {
  if (!tex) return '';
  const c = document.createElement('canvas');
  c.width = tex.w; c.height = tex.h;
  const g = c.getContext('2d');
  const img = g.createImageData(tex.w, tex.h);
  img.data.set(tex.rgba);
  if (tint) for (let i = 0; i < img.data.length; i += 4) { img.data[i] = img.data[i] * tint[0] / 255; img.data[i + 1] = img.data[i + 1] * tint[1] / 255; img.data[i + 2] = img.data[i + 2] * tint[2] / 255; }
  g.putImageData(img, 0, 0);
  const o = document.createElement('canvas');
  o.width = size; o.height = Math.round((size * tex.h) / tex.w);
  const og = o.getContext('2d');
  og.imageSmoothingEnabled = false;
  og.drawImage(c, 0, 0, o.width, o.height);
  return o.toDataURL();
}
