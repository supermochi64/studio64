// The game's textures, drawn by code (all original). Small (N64 texture memory is 4 KB): most are
// 32x32 and repeat. Vertex colours tint the light ones (stucco, metal), so a few textures make many
// looks.
import { Canvas, rng, hex, mix, shade } from './lib/png.mjs';
import { Paint, hexc, mixc, shadec } from './lib/paint.mjs';

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

// ---- the world's textures: painted (tools/lib/paint.mjs), soft and seamless ----
const paint = (name, w, h, fn, cutout = false, opts = {}) => { T[name] = { w, h, paint: fn, opts }; };
const H = hexc;
const WHITE_ = [255, 255, 255];

// asphalt: dark, slightly mottled, with fine aggregate and a few darker patches
function asphalt(p, base = '#505257') {
  p.fill(H(base)).mottle(0.09, 3, 3).mottle(0.05, 10, 2);
  p.patches(H('#3e4044', 255), 3, 0.64, 0.06, 0.35);
  p.speckle(90, [H('#6a6c70'), H('#3a3c40'), H('#7a7a78')], [0.15, 0.4], 0.55);
}
// a painted road line that has worn a little
function roadLine(p, x0, y0, x1, y1, col) {
  p.rect(x0, y0, x1, y1, (x, y) => { const w = p.fbm(x, y, 8, 2); return [col[0], col[1], col[2], 255 * (w > 0.3 ? 0.97 : 0.8)]; }, { soft: 0.35 });
}
paint('asphalt', 32, 32, (p) => asphalt(p));
paint('road2', 32, 32, (p) => {
  asphalt(p);
  roadLine(p, 1.0, 0, 2.0, 32, H('#e6e4dc')); roadLine(p, 30.0, 0, 31.0, 32, H('#e6e4dc'));
  roadLine(p, 14.5, 0, 15.5, 32, H('#ecbc2c')); roadLine(p, 16.5, 0, 17.5, 32, H('#ecbc2c'));
});
paint('road4', 32, 32, (p) => {
  asphalt(p, '#4d4f54');
  roadLine(p, 0.2, 0, 1.0, 32, H('#e6e4dc')); roadLine(p, 31.0, 0, 31.8, 32, H('#e6e4dc'));
  roadLine(p, 14.6, 0, 15.4, 32, H('#ecbc2c')); roadLine(p, 16.6, 0, 17.4, 32, H('#ecbc2c'));
  roadLine(p, 7.6, 1, 8.4, 14, H('#e6e4dc')); roadLine(p, 23.6, 1, 24.4, 14, H('#e6e4dc'));
});
paint('crosswalk', 32, 32, (p) => { asphalt(p); for (let x = 1; x < 32; x += 6) roadLine(p, x, 3, x + 3.2, 29, H('#ecebe4')); });
paint('stripe', 32, 32, (p) => { asphalt(p); roadLine(p, 15, 0, 17, 32, H('#ecebe4')); });
// pavement slabs with their joints, each slab a little different
paint('sidewalk', 32, 32, (p) => {
  p.fill(H('#c4bfb4'));
  for (const [x, y] of [[0, 0], [16, 0], [0, 16], [16, 16]]) { const f = 0.95 + p.r() * 0.08; p.rect(x, y, x + 16, y + 16, shadec(H('#c4bfb4'), f), { soft: 0.2 }); }
  p.mottle(0.06, 4, 3).mottle(0.03, 16, 2);
  p.patches(H('#9a958c'), 4, 0.66, 0.05, 0.25);
  for (const v of [0, 16]) { p.rect(0, v - 0.35, 32, v + 0.35, H('#8a857c', 230)); p.rect(0, v + 0.35, 32, v + 0.9, H('#e4e0d8', 120)); p.rect(v - 0.35, 0, v + 0.35, 32, H('#8a857c', 230)); p.rect(v + 0.35, 0, v + 0.9, 32, H('#e4e0d8', 120)); }
  p.speckle(20, [H('#9e998f'), H('#d8d4cc')], [0.2, 0.5], 0.5);
});
paint('concrete', 32, 32, (p) => { p.fill(H('#aeaaa1')).mottle(0.08, 3, 3).mottle(0.04, 12, 2); p.patches(H('#8e8a82'), 3, 0.65, 0.07, 0.3); p.speckle(40, [H('#c4c0b8'), H('#8c8880')], [0.15, 0.35], 0.5); });
// grass: soft clumps of light and shade, little blades and the odd flower
paint('grass', 32, 32, (p) => {
  p.fill(H('#5b9638')).mottle(0.12, 3, 3);
  p.patches(H('#79b148'), 4, 0.56, 0.08, 0.55);
  p.patches(H('#3f7629'), 3, 0.62, 0.08, 0.45);
  for (let k = 0; k < 220; k++) {
    const x = p.r() * 32, y = p.r() * 32, l = 0.9 + p.r() * 1.3, dx = (p.r() - 0.5) * 0.9;
    const c = p.r() < 0.5 ? H('#86bf54', 180) : H('#3b6e26', 170);
    p.line(x, y, x + dx, y - l, 0.32, c, 0.3);
  }
  for (let k = 0; k < 5; k++) { const x = p.r() * 32, y = p.r() * 32; p.circle(x, y, 0.5, p.r() < 0.5 ? H('#f4f0d8') : H('#f2d04a'), 0.3); }
});
paint('dirt', 32, 32, (p) => { p.fill(H('#8c6c4a')).mottle(0.14, 3, 4); p.patches(H('#6e523a'), 4, 0.6, 0.08, 0.4); p.speckle(60, [H('#a8896a'), H('#5e4630'), H('#b49c80')], [0.2, 0.6], 0.7); });
paint('sand', 32, 32, (p) => {
  p.fill(H('#e8d6a0')).mottle(0.05, 3, 3);
  p.map((x, y, c) => { const f = 1 + 0.045 * Math.sin((y + p.fbm(x, y, 3, 2) * 9) * 0.8 * Math.PI / 2); return [c[0] * f, c[1] * f, c[2] * f, 255]; });
  p.speckle(40, [H('#c8b47e'), H('#fff4d0')], [0.15, 0.35], 0.6);
});
paint('stucco', 32, 32, (p) => { p.fill(H('#f1ebe0')).mottle(0.05, 4, 3).mottle(0.025, 16, 2); p.speckle(25, [H('#dcd4c6')], [0.2, 0.4], 0.5); });
// window glass: the sky reflected, darker below, with a soft diagonal sheen
function glass(p, x0, y0, x1, y1, top = '#a8c8e2', bottom = '#34506c') {
  if (top) p.vgrad(x0, y0, x1, y1, H(top), H(bottom), { soft: 0.3 });
  const w = x1 - x0, h = y1 - y0;
  p.poly([[x0 + w * 0.15, y1], [x0 + w * 0.4, y1], [x0 + w * 0.85, y0], [x0 + w * 0.6, y0]], [255, 255, 255, 50], 0.8);
  p.poly([[x0 + w * 0.45, y1], [x0 + w * 0.52, y1], [x0 + w * 0.97, y0], [x0 + w * 0.9, y0]], [255, 255, 255, 40], 0.5);
  p.rect(x0, y0, x1, y0 + Math.min(1.2, h * 0.1), [20, 30, 40, 90], { soft: 0.5 }); // the frame's shadow
}
// a house wall bay (3 m x 3 m): a framed window with curtains, a sill and a flower box
paint('housewin', 32, 32, (p) => {
  p.fill(H('#f1ebe0')).mottle(0.05, 4, 3);
  p.rect(7.6, 7.2, 24.8, 22.2, [60, 50, 40, 60], { r: 0.8, soft: 1.2 });       // shadow on the wall
  p.rect(7, 6.4, 25, 21.6, H('#fbfaf6'), { r: 0.6 }); p.bevel(7, 6.4, 25, 21.6, 0.6, 1, { a: 0.25 });
  glass(p, 8.6, 8, 23.4, 20);
  p.rect(8.6, 8, 11.2, 20, (x, y) => shadec(H('#ead8b4'), 0.92 + 0.1 * Math.sin(x * 5)), { soft: 0.3 });
  p.rect(20.8, 8, 23.4, 20, (x, y) => shadec(H('#ead8b4'), 0.92 + 0.1 * Math.sin(x * 5)), { soft: 0.3 });
  p.rect(15.4, 8, 16.6, 20, H('#fbfaf6')); p.rect(8.6, 13.4, 23.4, 14.4, H('#fbfaf6'));
  p.rect(6, 21.2, 26, 22.8, H('#e4ddd0'), { r: 0.3 }); p.bevel(6, 21.2, 26, 22.8, 0.4, 1, { a: 0.3 });
  p.rect(6.6, 22.8, 25.4, 24, [40, 30, 20, 70], { soft: 0.8 });
  // the flower box
  p.rect(8.5, 22.8, 23.5, 25.2, H('#7a5232'), { r: 0.4 }); p.bevel(8.5, 22.8, 23.5, 25.2, 0.4, 1, { a: 0.3 });
  for (let k = 0; k < 16; k++) p.circle(9 + p.r() * 14, 22.4 + p.r() * 0.8, 0.7 + p.r() * 0.4, H('#4f8a32'), 0.4);
  for (let k = 0; k < 10; k++) p.circle(9.5 + p.r() * 13, 21.9 + p.r() * 0.9, 0.5, [H('#e8485a'), H('#f6d04a'), H('#ffffff'), H('#e070c0')][k % 4], 0.3);
});
paint('housedoor', 32, 32, (p) => {
  p.fill(H('#f1ebe0')).mottle(0.05, 4, 3);
  p.rect(9.4, 5.4, 23, 32, [60, 50, 40, 60], { soft: 1.2 });
  p.rect(9, 4.6, 23, 32, H('#fbfaf6')); p.bevel(9, 4.6, 23, 32, 0.6, 1, { a: 0.25 });
  p.vgrad(10.4, 6, 21.6, 32, H('#83593a'), H('#6a4529'));
  p.map((x, y, c) => (x > 10.4 && x < 21.6 && y > 6 ? [c[0] * (1 + 0.05 * Math.sin(x * 3 + p.fbm(x, y, 4, 2) * 5)), c[1] * (1 + 0.05 * Math.sin(x * 3)), c[2], 255] : undefined));
  for (const [x0, y0, x1, y1] of [[11.6, 7.4, 15.6, 15.5], [16.4, 7.4, 20.4, 15.5], [11.6, 17, 15.6, 30.5], [16.4, 17, 20.4, 30.5]]) p.bevel(x0, y0, x1, y1, 0.5, -1, { a: 0.35 });
  glass(p, 12.2, 8, 19.8, 11.4, '#c8dcea', '#56708a');
  p.circle(19.8, 19.6, 0.65, H('#e8c45a'), 0.3); p.circle(19.6, 19.4, 0.25, H('#fff2b8'), 0.2);
  // a porch light
  p.rect(5.2, 9.5, 6.8, 13.2, H('#2e2e30'), { r: 0.4 }); p.rect(5.5, 10, 6.5, 12.6, H('#ffe9a8'), { r: 0.3 });
});
paint('garage', 32, 32, (p) => {
  p.fill(H('#ece8e0'));
  for (let y = 1; y < 32; y += 7.75) { p.vgrad(0, y, 32, y + 7.75, H('#f6f3ec'), H('#d8d4cc'), { soft: 0.2 }); p.bevel(0.6, y + 0.4, 31.4, y + 7.3, 0.5, 1, { a: 0.28 }); }
  for (let x = 2.5; x < 30; x += 7.5) glass(p, x, 2.4, x + 5.5, 6.6, '#b4ccdc', '#4a5e72');
  p.rect(0, 0, 32, 1.2, [40, 40, 40, 80]);
  p.mottle(0.03, 6, 2);
});
// an office tower bay (one floor, one window bay): a glass curtain wall and the floor's band
paint('office', 32, 32, (p) => {
  p.fill(H('#d8dbe0'));
  glass(p, 1.2, 3.4, 30.8, 26.6, '#a6cbe8', '#3c5f84');
  for (let k = 0; k < 4; k++) p.ellipse(4 + p.r() * 24, 6 + p.r() * 8, 3 + p.r() * 3, 1 + p.r(), [255, 255, 255, 45], 1.2); // clouds
  for (const x of [0.6, 16, 31.4]) { p.rect(x - 0.7, 3, x + 0.7, 27, H('#c8ccd2')); p.rect(x - 0.7, 3, x - 0.2, 27, [255, 255, 255, 90]); }
  p.rect(1, 9.4, 31, 10.2, H('#c8ccd2'));
  p.vgrad(0, 26.6, 32, 32, H('#76869a'), H('#5a687a')); p.bevel(0, 26.6, 32, 32, 0.6, 1, { a: 0.3 });
  p.rect(0, 0, 32, 3.4, H('#e2e5ea')); p.rect(0, 2.8, 32, 3.4, [30, 40, 50, 70]);
});
// a stone office front: three punched windows with sills and lintels
paint('office2', 32, 32, (p) => {
  p.fill(H('#cdbb9f')).mottle(0.06, 4, 3).mottle(0.03, 14, 2);
  for (let x = 1.6; x < 32; x += 10.6) {
    p.rect(x - 0.4, 5.6, x + 7.8, 7.0, H('#e0d2bc')); p.bevel(x - 0.4, 5.6, x + 7.8, 7.0, 0.3, 1, { a: 0.3 });
    p.rect(x + 0.4, 7.4, x + 7.4, 25.4, [40, 30, 20, 80], { soft: 0.9 });
    glass(p, x, 7, x + 7, 25, '#90b0cc', '#283a50');
    p.rect(x + 3.2, 7, x + 3.8, 25, H('#ece4d6')); p.rect(x, 15.2, x + 7, 15.8, H('#ece4d6'));
    p.rect(x - 0.6, 25, x + 7.6, 26.6, H('#e0d2bc')); p.bevel(x - 0.6, 25, x + 7.6, 26.6, 0.3, 1, { a: 0.3 });
    p.rect(x - 0.4, 26.6, x + 7.4, 27.6, [40, 30, 20, 60], { soft: 0.6 });
  }
  p.rect(0, 0, 32, 1.6, H('#b8a688')); p.rect(0, 1.6, 32, 2.2, [40, 30, 20, 60]);
});
// bricks: each a slightly different clay, with recessed mortar
function bricks(p) {
  p.fill(H('#cbbfae')).mottle(0.06, 8, 2);
  const cols = ['#a4553c', '#9a4c36', '#ad5f45', '#8f4632', '#b2654a', '#9c5240'];
  for (let row = 0; row < 8; row++) {
    const y = row * 4, off = row % 2 ? 4 : 0;
    for (let x = -off; x < 32; x += 8) {
      const c = H(cols[Math.floor(p.r() * cols.length)]);
      p.rect(x + 0.45, y + 0.45, x + 7.55, y + 3.6, c, { r: 0.45, soft: 0.4 });
      p.rect(x + 0.6, y + 0.5, x + 7.4, y + 1.1, [255, 220, 190, 45], { soft: 0.4 });
      p.rect(x + 0.6, y + 3.0, x + 7.4, y + 3.6, [40, 15, 5, 50], { soft: 0.4 });
    }
  }
  p.mottle(0.07, 4, 3);
  p.patches(H('#5a3a2e'), 3, 0.66, 0.08, 0.2);
}
paint('brick', 32, 32, bricks);
paint('brickwin', 32, 32, (p) => {
  bricks(p);
  p.rect(7.2, 6.8, 24.8, 22.6, [30, 20, 15, 90], { soft: 1 });
  p.rect(6.4, 4.2, 25.6, 6.6, H('#dcd2c2')); p.bevel(6.4, 4.2, 25.6, 6.6, 0.4, 1, { a: 0.3 });
  p.rect(7.4, 6.6, 24.6, 22, H('#3c5a46'));
  glass(p, 8.4, 7.4, 23.6, 21.2, '#9cb6c8', '#2a3a4a');
  p.rect(15.5, 7.4, 16.5, 21.2, H('#3c5a46')); p.rect(8.4, 13.8, 23.6, 14.8, H('#3c5a46'));
  p.rect(6.4, 22, 25.6, 24, H('#dcd2c2')); p.bevel(6.4, 22, 25.6, 24, 0.4, 1, { a: 0.3 });
  p.rect(6.8, 24, 25.2, 25, [30, 20, 15, 80], { soft: 0.6 });
});
// a shop front: the sign band, a lit display with goods on shelves, the door
paint('shopfront', 32, 32, (p) => {
  p.fill(H('#e8e4dc'));
  p.vgrad(0, 0, 32, 6.4, H('#fbf9f4'), H('#e4e0d8')); p.bevel(0, 0, 32, 6.4, 0.5, 1, { a: 0.3 });
  p.rect(0, 6.4, 32, 7.4, [30, 30, 30, 120], { soft: 0.5 });
  p.vgrad(1, 7.4, 31, 29.6, H('#f6dfa8'), H('#7a6650'));
  for (const sy of [14.5, 20.5, 26.5]) {
    p.rect(1, sy, 31, sy + 0.8, H('#4a3c30'));
    for (let x = 1.6; x < 30.6; x += 1.3 + p.r() * 0.8) { const h = 1.6 + p.r() * 2.6; p.rect(x, sy - h, x + 0.9 + p.r() * 0.6, sy, H(['#e24a3c', '#3c8ae0', '#f2c43c', '#58b84a', '#f0f0f0', '#c060c8', '#f08a30'][Math.floor(p.r() * 7)]), { r: 0.2, soft: 0.3 }); }
  }
  p.rect(12, 11, 20, 32, (x, y) => mixc(H('#3e5266'), H('#1e2a36'), (y - 11) / 21));
  p.rect(18.4, 19, 19.2, 24, H('#d8d8d8'), { r: 0.3 });
  glass(p, 1, 7.4, 31, 29.6, null, null);
  for (const x of [0.6, 11.6, 20.4, 31.4]) { p.rect(x - 0.6, 7.4, x + 0.6, 32, H('#585c62')); p.rect(x - 0.6, 7.4, x - 0.2, 32, [255, 255, 255, 60]); }
  p.rect(0, 29.6, 32, 32, H('#6e7278'));
});
// clay barrel tiles in overlapping rows
paint('roof', 32, 32, (p) => {
  p.fill(H('#8a3e28'));
  for (let row = 0; row < 4; row++) {
    const y = row * 8;
    for (let x = 0; x < 32; x += 4) {
      const tone = 0.9 + p.r() * 0.18;
      p.rect(x, y, x + 4, y + 8.6, (px, py) => { const u = (px - x) / 4; const s = 0.62 + 0.5 * Math.sin(u * Math.PI); return shadec(H('#bc6040'), s * tone * (1 - 0.18 * ((py - y) / 8.6))); }, { soft: 0.3 });
    }
    p.rect(0, y + 7.6, 32, y + 8.6, [40, 15, 5, 110], { soft: 0.6 });
  }
  p.mottle(0.06, 4, 2);
  p.patches(H('#6a5a3a'), 3, 0.7, 0.06, 0.25);
});
paint('roofflat', 32, 32, (p) => { p.fill(H('#8c8882')).mottle(0.08, 3, 3); p.speckle(260, [H('#a8a49c'), H('#6c6862'), H('#9a948a')], [0.15, 0.32], 0.8); p.patches(H('#6e6a64'), 3, 0.64, 0.08, 0.3); });
paint('metal', 32, 32, (p) => {
  p.fill(H('#dcdcdc'));
  p.map((x, y, c) => { const f = 0.84 + 0.2 * Math.sin((x / 4) * Math.PI * 2); return [c[0] * f, c[1] * f, c[2] * f, 255]; });
  p.mottle(0.04, 4, 3); p.patches(H('#a07a5a'), 3, 0.72, 0.06, 0.25);
});
paint('wood', 32, 32, (p) => {
  p.fill(H('#9c7448'));
  for (let y = 0; y < 32; y += 8) { const tone = 0.9 + p.r() * 0.2; p.rect(0, y, 32, y + 8, (x, yy) => shadec(H('#a27a4c'), tone * (1 + 0.08 * Math.sin(yy * 2.1 + x * 0.15 + p.fbm(x, yy, 4, 2) * 9))), { soft: 0.2 }); p.rect(0, y, 32, y + 0.7, H('#4e3620')); p.rect(0, y + 0.7, 32, y + 1.3, [255, 230, 190, 50]); }
  for (let k = 0; k < 8; k++) p.circle(2 + Math.floor(p.r() * 4) * 8, 3 + Math.floor(p.r() * 4) * 8, 0.35, H('#3e2c1c'), 0.2);
  p.mottle(0.05, 6, 2);
});
// leafy clumps: dark under, light on top
function leafy(p, dark, mid, light, n = 150) {
  for (let k = 0; k < n; k++) { const x = p.r() * 32, y = p.r() * 32, r = 1 + p.r() * 1.4; p.circle(x, y, r, H(dark), 0.6); p.circle(x - 0.35, y - 0.4, r * 0.75, H(mid), 0.6); p.circle(x - 0.6, y - 0.7, r * 0.35, H(light), 0.5); }
}
paint('hedge', 32, 32, (p) => { p.fill(H('#2f5a22')); leafy(p, '#2f5a22', '#467e30', '#6aa244', 170); });
paint('leaves', 32, 32, (p) => {
  p.clear();
  for (let k = 0; k < 34; k++) {
    const a = p.r() * Math.PI * 2, d = Math.sqrt(p.r()) * 11.5;
    const x = 16 + Math.cos(a) * d, y = 16 + Math.sin(a) * d, r = 2.4 + p.r() * 2.2;
    const lit = 1 - (y - 4) / 30;
    p.circle(x, y, r, shadec(H('#2f6624'), 0.9 + lit * 0.2), 0.5);
    p.circle(x - r * 0.25, y - r * 0.3, r * 0.65, shadec(H('#4c8c34'), 0.9 + lit * 0.25), 0.5);
    p.circle(x - r * 0.45, y - r * 0.5, r * 0.3, shadec(H('#78b44c'), 0.9 + lit * 0.2), 0.4);
  }
  for (let k = 0; k < 60; k++) { const a = p.r() * Math.PI * 2, d = 12 + p.r() * 3; p.circle(16 + Math.cos(a) * d, 16 + Math.sin(a) * d, 0.7 + p.r() * 0.6, H('#3e7a2c'), 0.3); }
}, true);
paint('frond', 32, 32, (p) => {
  p.clear();
  // leaflets: thin, arching out from the midrib toward the tip, with gaps between them
  for (let x = 0.4, k = 0; x < 31; x += 1.6, k++) {
    const len = 13.8 * Math.pow(Math.sin(((x + 2) / 34) * Math.PI), 0.8) + 0.6;
    for (const side of [-1, 1]) {
      if ((k + (side > 0 ? 1 : 0)) % 5 === 0) continue;
      const tip = [x + 3.2, 16 + side * len];
      const mid = [x + 1.0, 16 + side * len * 0.55];
      const c = mixc(H('#3a7624'), H('#72ae40'), side > 0 ? 0.2 + p.r() * 0.2 : 0.6 + p.r() * 0.3);
      p.line(x, 16, mid[0], mid[1], 0.95, c, 0.3); p.line(mid[0], mid[1], tip[0], tip[1], 0.6, c, 0.3);
    }
  }
  p.line(0, 16, 32, 16, 0.8, H('#8a9a40'), 0.3);
}, true);
paint('bark', 32, 32, (p) => {
  p.fill(H('#8c6c4a'));
  for (let y = 0; y < 32; y += 4) { p.vgrad(0, y, 32, y + 4, H('#a2805a'), H('#6a4e34'), { soft: 0.2 }); p.rect(0, y + 3.4, 32, y + 4, [40, 25, 10, 120], { soft: 0.4 }); }
  p.map((x, y, c) => { const f = 1 + 0.08 * Math.sin(x * 1.7 + p.fbm(x, y, 4, 2) * 6); return [c[0] * f, c[1] * f, c[2] * f, 255]; });
  p.mottle(0.06, 6, 2);
});
paint('chainlink', 32, 32, (p) => {
  p.clear();
  for (let k = -32; k < 64; k += 8) { p.line(k, 0, k + 32, 32, 0.55, H('#b4b8bc'), 0.3); p.line(k + 32, 0, k, 32, 0.55, H('#a4a8ac'), 0.3); }
  p.rect(0, 0, 32, 1.6, H('#9ca0a4')); p.rect(0, 0, 32, 0.6, H('#d0d4d8'));
}, true);
paint('water', 32, 32, (p) => {
  // deep blue with soft swells and a net of bright ripple lines (warped noise contours, no grid)
  p.fill(H('#2a6c9c'));
  p.map((x, y, c) => {
    const sw = p.fbm(x, y, 2, 2);
    const wx = x + (p.fbm(x + 7, y, 3, 2) - 0.5) * 9, wy = y + (p.fbm(x, y + 11, 3, 2) - 0.5) * 9;
    const n = p.fbm(wx, wy, 3, 3) * 4.0;
    const f = Math.abs(n - Math.round(n)) * 2;           // 0 on a contour, 1 between
    const line = Math.pow(1 - f, 7) * 0.55;
    const base = mixc(H('#1f5f8e'), H('#3a86b4'), sw);
    return mixc(base, H('#a8daf2'), line);
  });
});
paint('container', 32, 32, (p) => {
  p.fill(H('#e4e4e4'));
  p.map((x, y, c) => { const f = 0.86 + 0.16 * Math.sin((x / 3.2) * Math.PI * 2); return [c[0] * f, c[1] * f, c[2] * f, 255]; });
  p.rect(0, 0, 32, 2, H('#d0d0d0')); p.bevel(0, 0, 32, 2, 0.4, 1, { a: 0.3 }); p.rect(0, 30, 32, 32, H('#a8a8a8'));
  p.mottle(0.05, 4, 3); p.patches(H('#8a6a50'), 3, 0.72, 0.06, 0.25);
});
paint('graffiti', 32, 32, (p) => {
  p.clear();
  for (let k = 0; k < 4; k++) {
    let x = 4 + p.r() * 22, y = 8 + p.r() * 14, a = p.r() * 6;
    for (let i = 0; i < 18; i++) { const nx = x + Math.cos(a) * 1.4, ny = y + Math.sin(a) * 1.4; p.line(x, y, nx, ny, 2.2, [255, 255, 255, 255], 0.4); x = nx; y = ny; a += (p.r() - 0.5) * 1.6; }
  }
}, true);
// a tower's lobby: tall glass between stone piers, a revolving-door frame in the middle
paint('lobby', 32, 32, (p) => {
  p.fill(H('#d6d0c4')).mottle(0.05, 4, 3);
  glass(p, 3, 3, 29, 31, '#d8e4ec', '#3a4e62');
  p.vgrad(3, 12, 29, 31, [255, 236, 190, 60], [255, 220, 160, 20]);    // warm light from inside
  for (const x of [3, 10.5, 16, 21.5, 29]) { p.rect(x - 0.5, 3, x + 0.5, 31, H('#3a3e44')); }
  p.rect(3, 10.5, 29, 11.3, H('#3a3e44'));
  p.rect(0, 0, 3, 32, H('#cfc8ba')); p.rect(29, 0, 32, 32, H('#cfc8ba')); p.bevel(0, 0, 3, 32, 0.5, 1, { a: 0.3 }); p.bevel(29, 0, 32, 32, 0.5, 1, { a: 0.3 });
  p.rect(0, 0, 32, 3, H('#c2baa8')); p.rect(0, 2.4, 32, 3.2, [30, 30, 30, 70]);
  p.rect(13.4, 21, 14.0, 25, H('#d8d8d8')); p.rect(18, 21, 18.6, 25, H('#d8d8d8'));
});
// a canvas awning: stripes (tinted by the vertex colour) with a scalloped edge at the bottom
paint('awning', 32, 32, (p) => {
  p.fill(H('#f6f2ea'));
  for (let x = 0; x < 32; x += 8) p.rect(x, 0, x + 4, 32, H('#ffffff'));
  for (let x = 4; x < 32; x += 8) p.rect(x, 0, x + 4, 32, H('#9c9c9c'));
  p.map((x, y, c) => { const f = 0.88 + 0.12 * (1 - y / 32) + 0.04 * Math.sin(x * 0.8); return [c[0] * f, c[1] * f, c[2] * f, 255]; });
  p.rect(0, 27, 32, 28, [0, 0, 0, 60]);
});
// the grille of a rooftop air conditioner
paint('vent', 32, 32, (p) => {
  p.fill(H('#c8cacc')).mottle(0.04, 4, 2);
  p.rect(3, 3, 29, 29, H('#8e9296'), { r: 1 });
  for (let y = 4.5; y < 28; y += 2) { p.rect(4, y, 28, y + 0.9, H('#5c6064')); p.rect(4, y + 0.9, 28, y + 1.3, H('#b4b8bc')); }
  p.bevel(0, 0, 32, 32, 0.8, 1, { a: 0.35 });
  p.patches(H('#a07a5a'), 3, 0.74, 0.06, 0.25);
});
// a flower bed's planting (cut out): leafy tufts with blossoms, drawn on crossed quads
paint('flowers', 32, 32, (p) => {
  p.clear();
  for (let k = 0; k < 40; k++) { const x = 2 + p.r() * 28, y = 12 + p.r() * 19; p.line(x, 32, x + (p.r() - 0.5) * 3, y, 0.8, H(p.r() < 0.5 ? '#3c7a2a' : '#559838'), 0.3); }
  for (let k = 0; k < 18; k++) { const x = 3 + p.r() * 26, y = 6 + p.r() * 18; p.circle(x, y + 2, 2.2, H('#4a8a34'), 0.4); }
  const pet = ['#f04a5a', '#ffd23c', '#ffffff', '#e070d0', '#ff8a3c', '#6aa0ff'];
  for (let k = 0; k < 16; k++) {
    const x = 3 + p.r() * 26, y = 4 + p.r() * 18, c = H(pet[Math.floor(p.r() * pet.length)]);
    for (let a = 0; a < 5; a++) p.circle(x + Math.cos(a * 1.26) * 1.1, y + Math.sin(a * 1.26) * 1.1, 0.9, c, 0.3);
    p.circle(x, y, 0.6, H('#ffe27a'), 0.3);
  }
}, true);
// a wooden shipping crate
paint('crate', 32, 32, (p) => {
  p.fill(H('#b4895a'));
  for (let y = 0; y < 32; y += 6.4) { p.rect(0, y, 32, y + 6.4, (x, yy) => shadec(H('#b88c5c'), 0.9 + 0.12 * Math.sin(yy * 2 + x * 0.2 + p.fbm(x, yy, 4, 2) * 8)), { soft: 0.2 }); p.rect(0, y, 32, y + 0.5, H('#6a4c30')); }
  p.rect(0, 0, 32, 4, H('#8a6640')); p.rect(0, 28, 32, 32, H('#8a6640')); p.rect(0, 0, 4, 32, H('#8a6640')); p.rect(28, 0, 32, 32, H('#8a6640'));
  p.line(4, 28, 28, 4, 3.2, H('#8a6640'), 0.4);
  p.bevel(0, 0, 32, 32, 0.8, 1, { a: 0.3 }); p.bevel(4, 4, 28, 28, 0.6, -1, { a: 0.3 });
  for (const [x, y] of [[2, 2], [30, 2], [2, 30], [30, 30]]) p.circle(x, y, 0.6, H('#3a3a3a'), 0.2);
  p.mottle(0.05, 6, 2);
});
// lit windows for the night (cut out, unshaded): 4 x 4 bays of a facade, a random few lit
const LIT = ['#ffe8a8', '#fff2cc', '#ffd890', '#e8f0ff', '#ffe0b0'];
function litCells(p, nx, ny, win, chance, warm = false) {
  p.clear();
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cw = 32 / nx, ch = 32 / ny;
    for (const [x0, y0, x1, y1] of win) {
      if (p.r() > chance) continue;
      const c = H(warm ? ['#ffd890', '#ffc878', '#ffe0a0'][Math.floor(p.r() * 3)] : LIT[Math.floor(p.r() * LIT.length)]);
      p.vgrad(i * cw + x0 * cw, j * ch + y0 * ch, i * cw + x1 * cw, j * ch + y1 * ch, c, shadec(c, 0.8), { soft: 0.2 });
    }
  }
}
paint('night_office', 32, 32, (p) => litCells(p, 4, 4, [[0.06, 0.12, 0.48, 0.82], [0.52, 0.12, 0.94, 0.82]], 0.45), true);
paint('night_office2', 32, 32, (p) => litCells(p, 4, 4, [[0.06, 0.22, 0.27, 0.78], [0.39, 0.22, 0.6, 0.78], [0.72, 0.22, 0.93, 0.78]], 0.4), true);
paint('night_house', 32, 32, (p) => litCells(p, 2, 2, [[0.29, 0.27, 0.71, 0.61]], 0.55, true), true);
paint('night_brick', 32, 32, (p) => litCells(p, 2, 2, [[0.28, 0.24, 0.72, 0.65]], 0.5, true), true);
// a lamp's light (unshaded): warm white, a little brighter in the middle
paint('glow', 8, 8, (p) => { p.fill(H('#ffe6b0')); p.circle(4, 4, 3, H('#fff6dc'), 2); });
paint('glow_pool', 8, 8, (p) => p.fill(H('#ffc47a')));
paint('glow_red', 8, 8, (p) => { p.fill(H('#ff4632')); p.circle(4, 4, 3, H('#ff9a80'), 2); });
paint('glow_green', 8, 8, (p) => { p.fill(H('#3cf078')); p.circle(4, 4, 3, H('#a8ffc8'), 2); });
paint('night_lobby', 32, 32, (p) => {
  p.clear();
  p.vgrad(3.5, 3.5, 28.5, 31, H('#fff0c8'), H('#f0c080'));
  for (const x of [10.5, 16, 21.5]) p.rect(x - 0.6, 3, x + 0.6, 31, [0, 0, 0, 0]);
  p.rect(3, 10.3, 29, 11.5, [0, 0, 0, 0]);
}, true);
paint('night_shop', 32, 32, (p) => { p.clear(); p.vgrad(1.2, 8, 30.8, 29.4, H('#fff0c0'), H('#e8b070')); p.rect(12, 11, 20, 32, [0, 0, 0, 0]); p.rect(12, 11, 20, 32, H('#d8a860')); }, true);
paint('court', 32, 32, (p) => { p.fill(H('#3c7098')).mottle(0.05, 4, 3).mottle(0.03, 12, 2); });

// shop signs: 64x16, white letters on colour bands are tinted by the board's vertex colour
export const SIGNS = ['BURGERS', 'TACOS', 'PIZZA', 'MARKET', 'LIQUOR', 'DINER', 'AUTO', 'GAS', 'DONUTS', 'BARBER', 'PAWN', 'MOTEL', 'BAR', 'LAUNDRY', 'CLINIC', 'ARMS', 'POLICE', 'BANK', 'CAFE', 'GYM'];
for (const word of SIGNS) {
  // a painted board: a light face (tinted by the vertex colour), a frame, rounded letters with a shadow
  paint(`sign_${word.toLowerCase()}`, 64, 16, (p) => {
    p.vgrad(0, 0, 64, 16, H('#ffffff'), H('#e2e2e2'));
    p.bevel(0, 0, 64, 16, 0.9, 1, { a: 0.4 });
    const sc = word.length <= 6 ? 1.5 : word.length <= 8 ? 1.25 : 1.05;
    const w = (word.length * 6 - 1) * sc, x0 = (64 - w) / 2, y0 = (16 - 7 * sc) / 2;
    const glyphs = (dx, dy, c) => [...word].forEach((ch, k) => {
      const g = FONT5x7[ch] || FONT5x7[' '];
      for (let j = 0; j < 7; j++) for (let i = 0; i < 5; i++) if (g[j][i] === '1') {
        const x = x0 + (k * 6 + i) * sc + dx, y = y0 + j * sc + dy;
        p.rect(x - 0.08 * sc, y - 0.08 * sc, x + 1.08 * sc, y + 1.08 * sc, c, { r: 0.4 * sc, soft: 0.35 });
      }
    });
    glyphs(0.5, 0.6, [0, 0, 0, 70]);
    glyphs(0, 0, H('#1c1c20'));
  });
}

// the title logo: fat rounded letters with a sunset gradient, an outline and a shadow, a sun and a palm
paint('logo', 256, 72, (p) => {
  p.clear();
  // the sun behind the letters, cut by stripes
  p.circle(198, 32, 27, (x, y) => mixc(H('#ffe27a'), H('#ff6a3a'), Math.max(0, Math.min(1, (y - 6) / 52))), 0.6);
  p.map((x, y, c) => (c[3] > 0 && ((y > 41 && y < 43.4) || (y > 48 && y < 50) || (y > 54 && y < 55.6)) && Math.hypot(x - 198, y - 32) < 28.5 ? [c[0], c[1], c[2], 0] : undefined));
  // a palm on the left
  p.line(14, 72, 22, 18, 3.4, H('#4a2e1a'), 0.5);
  for (const [dx, dy] of [[-15, 8], [-12, -5], [2, -10], [14, -5], [16, 7], [-5, 11]]) p.line(22, 18, 22 + dx, 18 + dy, 3.2, H('#2a7a34'), 0.6);
  const word = 'SANDBOX', cell = 4.8, x0 = 34 + (222 - (word.length * 6 - 1) * cell) / 2, y0 = 15;
  const dots = [];
  [...word].forEach((ch, k) => { const g = FONT5x7[ch]; for (let j = 0; j < 7; j++) for (let i = 0; i < 5; i++) if (g[j][i] === '1') dots.push([x0 + (k * 6 + i) * cell, y0 + j * cell]); });
  const draw = (grow, c, r, dx = 0, dy = 0) => { for (const [x, y] of dots) p.rect(x - grow + dx, y - grow + dy, x + cell + grow + dx, y + cell + grow + dy, c, { r, soft: 0.5 }); };
  draw(2.4, [20, 10, 40, 170], 2.4, 2.5, 3.5);           // the shadow
  draw(2.2, H('#2a1238'), 2.2);                          // the outline
  draw(0.35, (x, y) => mixc(H('#fff6b0'), H('#ff7a22'), Math.max(0, Math.min(1, (y - y0) / (7 * cell)))), 0.4);
  // a glossy sheen across the upper half of the letters
  p.map((x, y, c) => (c[3] > 0 && y > y0 + 0.5 && y < y0 + 3.2 && c[0] > 200 ? mixc(c, [255, 255, 255, 255], 0.35) : undefined));
}, true, { wrap: false, sharpen: 0.1 });

// the people's default palette (the game puts each person's own colours in its place)
def('palette', 8, 4, (c) => {
  c.rect(0, 0, 8, 4, [0, 0, 0, 0]);
  const cols = ['#70462a', '#653f26', '#f6f6f0', '#2ea040', '#3a5a96', '#fafafa', '#bbbbbb', '#0e0e10', '#2ea040', '#258033', '#fafafa', '#221814', '#6e2824', '#2ea040', '#241e1c', '#0e0e10'];
  cols.forEach((h, i) => c.setRaw(i % 8, Math.floor(i / 8), hex(h)));
});

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
    let c;
    if (t.paint) { const p = new Paint(t.w, t.h, { seed: seed++ * 977, ...(t.opts || {}) }); t.paint(p); c = p.toCanvas(t.opts || {}); }
    else { c = new Canvas(t.w, t.h); t.fn(c, rng(seed++ * 977)); }
    c.save(`${dir}/${name}.png`);
    out.push(name);
  }
  return out;
}
export const TEXTURES = T;
export { mix, shade };
