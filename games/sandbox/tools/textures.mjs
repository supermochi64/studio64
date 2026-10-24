// The game's textures, drawn by code (all original). Small (N64 texture memory is 4 KB): most are
// 32x32 and repeat. Vertex colours tint the light ones (stucco, metal), so a few textures make many
// looks.
import { Canvas, rng, hex, mix, shade } from './lib/png.mjs';

// 5x7 pixel font for signs and the HUD's own glyphs (our own design)
export const FONT5x7 = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'], D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10011', '10001', '10001', '01111'], H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'], J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'], L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'], N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'], R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'], V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '10101', '01010'], X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'], Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10011', '10101', '10101', '10101', '11001', '01110'], 1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00110', '01000', '10000', '11111'], 3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], 5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], 7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], 9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'], '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '$': ['00100', '01111', '10100', '01110', '00101', '11110', '00100'], '&': ['01100', '10010', '10100', '01000', '10101', '10010', '01101'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'], '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'], '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  '*': ['00100', '00100', '11111', '01110', '01110', '11011', '10001'], ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  ',': ['00000', '00000', '00000', '00000', '01100', '00100', '01000'], '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'], '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
  ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'], '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
  '#': ['01010', '11111', '01010', '01010', '01010', '11111', '01010'], '=': ['00000', '00000', '11111', '00000', '11111', '00000', '00000'],
  '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'], '>': ['01000', '00100', '00010', '00001', '00010', '00100', '01000'],
  '^': ['00100', '01110', '11111', '00100', '00100', '00100', '00100'], '_': ['00000', '00000', '00000', '00000', '00000', '00000', '11111'],
  '|': ['00100', '00100', '00100', '00100', '00100', '00100', '00100'], '"': ['01010', '01010', '00000', '00000', '00000', '00000', '00000'],
};

export function drawText(cv, text, x, y, color, scale = 1) {
  for (const ch of text.toUpperCase()) {
    const g = FONT5x7[ch] || FONT5x7[' '];
    for (let j = 0; j < 7; j++) for (let i = 0; i < 5; i++) if (g[j][i] === '1') cv.rect(x + i * scale, y + j * scale, scale, scale, color);
    x += 6 * scale;
  }
  return x;
}
export const textWidth = (text, scale = 1) => text.length * 6 * scale - scale;

const T = {};
const def = (name, w, h, fn) => { T[name] = { w, h, fn }; };

def('asphalt', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#56585c')); c.noise(r, 0.06); for (let i = 0; i < 14; i++) c.set(Math.floor(r() * 32), Math.floor(r() * 32), hex('#45474b')); });
// across a 2-lane street: kerb edge lines, double yellow in the middle (u runs across the road)
def('road2', 32, 32, (c, r) => {
  c.rect(0, 0, 32, 32, hex('#56585c')); c.noise(r, 0.06);
  c.rect(1, 0, 1, 32, hex('#d8d8d0')); c.rect(30, 0, 1, 32, hex('#d8d8d0'));
  c.rect(15, 0, 1, 32, hex('#e0b830')); c.rect(16, 0, 1, 32, hex('#e0b830'));
});
// a 4-lane avenue: double yellow, white dashes between the lanes (v repeats every 8 m)
def('road4', 32, 32, (c, r) => {
  c.rect(0, 0, 32, 32, hex('#525458')); c.noise(r, 0.06);
  c.rect(0, 0, 1, 32, hex('#d8d8d0')); c.rect(31, 0, 1, 32, hex('#d8d8d0'));
  c.rect(15, 0, 1, 32, hex('#e0b830')); c.rect(16, 0, 1, 32, hex('#e0b830'));
  c.rect(8, 0, 1, 14, hex('#d8d8d0')); c.rect(23, 0, 1, 14, hex('#d8d8d0'));
});
def('crosswalk', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#56585c')); c.noise(r, 0.05); for (let x = 1; x < 32; x += 6) c.rect(x, 3, 3, 26, hex('#d8d8d0')); });
def('sidewalk', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#b8b4aa')); c.noise(r, 0.05); c.rect(0, 0, 32, 1, hex('#9a968e')); c.rect(0, 0, 1, 32, hex('#9a968e')); c.rect(0, 16, 32, 1, hex('#a29e96')); c.rect(16, 0, 1, 32, hex('#a29e96')); });
def('concrete', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#a8a59e')); c.noise(r, 0.07, 2); });
def('grass', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#5f8f3c')); c.noise(r, 0.1); for (let i = 0; i < 60; i++) c.set(Math.floor(r() * 32), Math.floor(r() * 32), r() < 0.5 ? hex('#4c7a2e') : hex('#78a84c')); });
def('dirt', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#8d6e4c')); c.noise(r, 0.1, 2); });
def('sand', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#e2cf98')); c.noise(r, 0.06); });
def('stucco', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#f0ece4')); c.noise(r, 0.04); });
// a house wall bay (3 m wide x 3 m): stucco with a window and its frame (tinted by vertex colour)
def('housewin', 32, 32, (c, r) => {
  c.rect(0, 0, 32, 32, hex('#f0ece4')); c.noise(r, 0.035);
  c.rect(8, 7, 16, 14, hex('#ffffff')); c.rect(9, 8, 14, 12, hex('#3a4c62'));
  c.rect(9, 8, 14, 1, hex('#5a7090')); c.rect(15, 8, 2, 12, hex('#ffffff')); c.rect(9, 14, 14, 1, hex('#ffffff'));
  c.rect(7, 21, 18, 2, hex('#d8d0c4'));
});
def('housedoor', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#f0ece4')); c.noise(r, 0.035); c.rect(10, 6, 12, 26, hex('#ffffff')); c.rect(11, 7, 10, 25, hex('#6a4a30')); c.rect(13, 10, 6, 7, hex('#5a3c26')); c.rect(18, 20, 2, 2, hex('#e0c060')); });
def('garage', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#e8e4dc')); for (let y = 2; y < 32; y += 5) c.rect(0, y, 32, 1, hex('#b8b4ac')); c.noise(r, 0.03); });
// office tower: one floor x one window bay (3.5 m x 4 m)
def('office', 32, 32, (c, r) => {
  c.rect(0, 0, 32, 32, hex('#d8d8d8'));
  c.rect(2, 4, 28, 24, hex('#5d7d9c')); c.rect(2, 4, 28, 3, hex('#8eb0cc')); c.rect(15, 4, 2, 24, hex('#c8c8c8'));
  for (let i = 0; i < 8; i++) c.set(3 + Math.floor(r() * 26), 8 + Math.floor(r() * 18), hex('#7896b4'));
});
def('office2', 32, 32, (c, r) => {
  c.rect(0, 0, 32, 32, hex('#c4b49c'));
  for (let x = 2; x < 32; x += 10) c.rect(x, 6, 7, 20, hex('#34465a'));
  for (let x = 2; x < 32; x += 10) c.rect(x, 6, 7, 2, hex('#6a86a0'));
});
def('brick', 32, 32, (c, r) => {
  c.rect(0, 0, 32, 32, hex('#9a4e38'));
  for (let y = 0; y < 32; y += 4) { c.rect(0, y, 32, 1, hex('#c8b8a8')); for (let x = (y / 4) % 2 ? 4 : 0; x < 32; x += 8) c.rect(x, y, 1, 4, hex('#c8b8a8')); }
  c.noise(r, 0.06);
});
def('brickwin', 32, 32, (c, r) => {
  T.brick.fn(c, r);
  c.rect(8, 6, 16, 16, hex('#e8e0d0')); c.rect(9, 7, 14, 14, hex('#3a4656')); c.rect(15, 7, 2, 14, hex('#e8e0d0')); c.rect(7, 22, 18, 2, hex('#d0c8b8'));
});
def('shopfront', 32, 32, (c, r) => {
  c.rect(0, 0, 32, 32, hex('#e8e4dc'));
  c.rect(1, 8, 30, 24, hex('#2e3e4e')); c.rect(1, 8, 30, 2, hex('#6c8aa6')); c.rect(12, 14, 8, 18, hex('#1e2a36'));
  c.rect(0, 0, 32, 6, hex('#ffffff'));
});
def('roof', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#a8543a')); for (let y = 0; y < 32; y += 4) c.rect(0, y, 32, 1, hex('#7e3c2a')); for (let y = 0; y < 32; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < 32; x += 4) c.rect(x, y, 1, 4, hex('#8e4430')); c.noise(r, 0.05); });
def('roofflat', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#8a8680')); c.noise(r, 0.1); });
def('metal', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#e0e0e0')); for (let x = 0; x < 32; x += 4) { c.rect(x, 0, 1, 32, hex('#b0b0b0')); c.rect(x + 1, 0, 1, 32, hex('#f8f8f8')); } c.noise(r, 0.03); });
def('wood', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#9c7448')); for (let y = 0; y < 32; y += 8) c.rect(0, y, 32, 1, hex('#6e4e2e')); c.noise(r, 0.08); });
def('hedge', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#3d6e2c')); c.noise(r, 0.14, 2); });
def('leaves', 32, 32, (c, r) => {
  c.rect(0, 0, 32, 32, [0, 0, 0, 0]);
  for (let i = 0; i < 260; i++) { const x = Math.floor(r() * 32), y = Math.floor(r() * 32); const d = Math.hypot(x - 16, y - 16); if (d < 15 - r() * 3) c.setRaw(x, y, r() < 0.5 ? hex('#3f7a2c') : hex('#5a9a3a')); }
});
// a palm frond, across the texture: a stem with leaflets (alpha cut)
def('frond', 32, 32, (c, r) => {
  c.rect(0, 0, 32, 32, [0, 0, 0, 0]);
  for (let x = 0; x < 32; x++) {
    c.setRaw(x, 16, hex('#6a8a30'));
    const len = Math.round(13 * Math.sin((x / 32) * Math.PI)) + 1;
    for (let k = 1; k < len; k++) { if ((x + k) % 3 === 0) continue; c.setRaw(x, 16 - k, hex(k % 2 ? '#4c8a2a' : '#5e9e36')); c.setRaw(x, 16 + k, hex(k % 2 ? '#468024' : '#58962e')); }
  }
});
def('bark', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#8a6a48')); for (let y = 0; y < 32; y += 3) c.rect(0, y, 32, 1, hex('#6a4e34')); c.noise(r, 0.06); });
def('chainlink', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, [0, 0, 0, 0]); for (let i = 0; i < 32; i++) { c.setRaw(i, i, hex('#b0b4b8')); c.setRaw(31 - i, i, hex('#b0b4b8')); } c.rect(0, 0, 32, 2, hex('#9ca0a4')); });
def('water', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#2a6a9a', 190)); for (let i = 0; i < 40; i++) { const x = Math.floor(r() * 32), y = Math.floor(r() * 32); c.rect(x, y, 3, 1, hex('#5a9aca', 200)); } });
def('container', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#e8e8e8')); for (let x = 1; x < 32; x += 3) c.rect(x, 0, 1, 32, hex('#b4b4b4')); c.rect(0, 0, 32, 2, hex('#c8c8c8')); c.rect(0, 30, 32, 2, hex('#a0a0a0')); });
def('graffiti', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, [0, 0, 0, 0]); for (let k = 0; k < 5; k++) { let x = 4 + r() * 24, y = 6 + r() * 20; for (let i = 0; i < 30; i++) { x += (r() - 0.5) * 3; y += (r() - 0.5) * 3; c.rect(Math.floor(x), Math.floor(y), 2, 2, [255, 255, 255, 255]); } } });
def('court', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#3c6e8e')); c.noise(r, 0.03); });
def('stripe', 32, 32, (c, r) => { c.rect(0, 0, 32, 32, hex('#56585c')); c.noise(r, 0.05); c.rect(15, 0, 2, 32, hex('#e8e8e0')); });

// shop signs: 64x16, white letters on colour bands are tinted by the board's vertex colour
export const SIGNS = ['BURGERS', 'TACOS', 'PIZZA', 'MARKET', 'LIQUOR', 'DINER', 'AUTO', 'GAS', 'DONUTS', 'BARBER', 'PAWN', 'MOTEL', 'BAR', 'LAUNDRY', 'CLINIC', 'ARMS', 'POLICE', 'BANK', 'CAFE', 'GYM'];
for (const word of SIGNS) {
  def(`sign_${word.toLowerCase()}`, 64, 16, (c) => {
    c.rect(0, 0, 64, 16, hex('#ffffff'));
    c.rect(0, 0, 64, 1, hex('#c8c8c8')); c.rect(0, 15, 64, 1, hex('#a0a0a0'));
    const w = textWidth(word, 1);
    drawText(c, word, Math.floor((64 - w) / 2), 4, hex('#202020'), 1);
  });
}

// the HUD's font: ASCII 32..127 in 8x8 cells, 16 a row (white, tinted by the game)
def('font', 128, 48, (c) => {
  c.rect(0, 0, 128, 48, [0, 0, 0, 0]);
  for (let code = 32; code < 128; code++) {
    const k = code - 32, cx = (k % 16) * 8, cy = Math.floor(k / 16) * 8;
    const ch = String.fromCharCode(code);
    const g = FONT5x7[ch] || FONT5x7[ch.toUpperCase()];
    if (!g) continue;
    // lower case: the same letters, a little smaller (drawn from the capitals, squeezed into 5 rows)
    const small = ch !== ch.toUpperCase();
    for (let j = 0; j < 7; j++) for (let i = 0; i < 5; i++) {
      if (g[j][i] !== '1') continue;
      const y = small ? 2 + Math.round(j * 5 / 7) : j;
      c.setRaw(cx + i, cy + y, [255, 255, 255, 255]);
    }
  }
});

export function writeTextures(dir) {
  const out = [];
  let seed = 7;
  for (const [name, t] of Object.entries(T)) {
    const c = new Canvas(t.w, t.h);
    t.fn(c, rng(seed++ * 977));
    c.save(`${dir}/${name}.png`);
    out.push(name);
  }
  return out;
}
export const TEXTURES = T;
export { mix, shade };
