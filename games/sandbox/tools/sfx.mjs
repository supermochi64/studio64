// Sound effects made offline (the rest are made by the game at start-up, src/sound.c): footsteps on
// each kind of ground, landings, swim strokes, splashes. Soft and short, like a 3D platformer's: you
// hear the feet without noticing them. Written as one bank (assets/sfx.bin, the voice bank's format);
// the order matches SFX_ in src/sound.h.
import fs from 'node:fs';
import path from 'node:path';
import { SR, wav } from './lib/synth.mjs';

let seed = 4242;
const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; };
const rnd = () => (noise() + 1) / 2;
const buf = (sec) => new Float32Array(Math.ceil(sec * SR));
// a two-pole band-pass (resonant) filter
function bandpass(f, q) {
  let low = 0, band = 0;
  const k = 2 * Math.sin(Math.PI * Math.min(f, SR / 6.5) / SR);
  return (x) => { low += k * band; const high = x - low - band / q; band += k * high; return band; };
}
function lowpass(cut) { let y = 0; const k = 1 - Math.exp(-2 * Math.PI * cut / SR); return (x) => (y += (x - y) * k); }
function normalize(b, peak = 0.9) { let m = 1e-6; for (const v of b) m = Math.max(m, Math.abs(v)); for (let i = 0; i < b.length; i++) b[i] *= peak / m; return b; }

// a shoe on pavement: a soft tap (heel, then the sole), a dull body under it
function stepHard(v) {
  const b = buf(0.09), bp = bandpass(900 + v * 500, 1.4), bp2 = bandpass(2600 + v * 600, 2), lp = lowpass(260);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const heel = Math.exp(-t * 95), sole = t > 0.022 ? Math.exp(-(t - 0.022) * 75) * 0.55 : 0;
    const n = noise();
    b[i] = bp(n) * (heel + sole) * 1.2 + bp2(n) * heel * 0.35 + lp(n) * (heel + sole) * 1.6;
  }
  return normalize(b, 0.8);
}
// grass: a quick crunchy rustle (many tiny ticks)
function stepGrass(v) {
  const b = buf(0.12), bp = bandpass(3400 + v * 700, 1.1), lp = lowpass(1800);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t * 400) * Math.exp(-t * 32);
    const ticks = rnd() < 0.08 ? 1 : 0.25;
    b[i] = (bp(noise()) * ticks * 1.4 + lp(noise()) * 0.25) * env;
  }
  return normalize(b, 0.7);
}
// sand: a soft "shff"
function stepSand(v) {
  const b = buf(0.14), lp = lowpass(1500 + v * 400), bp = bandpass(700, 0.8);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t * 120) * Math.exp(-t * 22);
    const n = noise();
    b[i] = (lp(n) * 0.9 + bp(n) * 0.5) * env;
  }
  return normalize(b, 0.65);
}
// wood (the pier, the boardwalk): a hollow knock
function stepWood(v) {
  const b = buf(0.12);
  let p1 = 0, p2 = 0;
  const f1 = 170 + v * 25, f2 = 410 + v * 40, bp = bandpass(1800, 1.5);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    p1 += f1 / SR; p2 += f2 / SR;
    b[i] = Math.sin(p1 * 2 * Math.PI) * Math.exp(-t * 38) * 0.9 + Math.sin(p2 * 2 * Math.PI) * Math.exp(-t * 60) * 0.5 + bp(noise()) * Math.exp(-t * 160) * 0.8;
  }
  return normalize(b, 0.8);
}
// shallow water: a splashy plop with a bubble
function stepWater(v) {
  const b = buf(0.18), bp = bandpass(1300 + v * 400, 0.9);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    ph += (900 - t * 3500 + v * 120) / SR;
    b[i] = bp(noise()) * Math.min(1, t * 300) * Math.exp(-t * 18) + Math.sin(ph * 2 * Math.PI) * Math.exp(-t * 30) * 0.35;
  }
  return normalize(b, 0.75);
}
// landing on the feet: a thud and a scuff
function land() {
  const b = buf(0.16), lp = lowpass(180), bp = bandpass(1100, 1.2);
  let ph = 0;
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    ph += (110 - t * 250) / SR;
    const n = noise();
    b[i] = Math.sin(ph * 2 * Math.PI) * Math.exp(-t * 30) * 0.8 + lp(n) * Math.exp(-t * 26) * 2.2 + bp(n) * Math.exp(-t * 55) * 0.7;
  }
  return normalize(b, 0.85);
}
// a swim stroke: water pushed away, a swirl of bubbles
function swimStroke(v) {
  const b = buf(0.45), bp = bandpass(600 + v * 200, 0.7), lp = lowpass(900);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const env = Math.min(1, t * 9) * Math.exp(-t * 7);
    let x = bp(noise()) * 0.9 + lp(noise()) * 0.6;
    // bubbles: little rising chirps
    const bt = (t * 23 + v) % 1;
    if (t > 0.12) x += Math.sin(bt * (1200 + 900 * bt) * 0.06) * Math.exp(-bt * 9) * 0.25 * Math.exp(-(t - 0.12) * 6);
    b[i] = x * env;
  }
  return normalize(b, 0.7);
}
// into the water
function splash() {
  const b = buf(0.8), bp = bandpass(1400, 0.6), lp = lowpass(600);
  for (let i = 0; i < b.length; i++) {
    const t = i / SR;
    const n = noise();
    b[i] = (bp(n) * Math.exp(-t * 7) * 1.1 + lp(n) * Math.exp(-t * 4) * 0.9) * Math.min(1, t * 500);
    const bt = (t * 17) % 1;
    if (t > 0.15) b[i] += Math.sin(bt * 60 * (1 + bt)) * Math.exp(-bt * 7) * 0.12 * Math.exp(-(t - 0.15) * 4);
  }
  return normalize(b, 0.9);
}
// hands on a pole or a ledge
function grab() {
  const b = buf(0.08), bp = bandpass(1600, 2), lp = lowpass(400);
  for (let i = 0; i < b.length; i++) { const t = i / SR; const n = noise(); b[i] = (bp(n) * 0.8 + lp(n) * 1.5) * Math.exp(-t * 70); }
  return normalize(b, 0.7);
}

export const SFX = [
  ['step_hard0', () => stepHard(0)], ['step_hard1', () => stepHard(0.5)], ['step_hard2', () => stepHard(1)],
  ['step_grass0', () => stepGrass(0)], ['step_grass1', () => stepGrass(0.5)], ['step_grass2', () => stepGrass(1)],
  ['step_sand0', () => stepSand(0)], ['step_sand1', () => stepSand(1)],
  ['step_wood0', () => stepWood(0)], ['step_wood1', () => stepWood(1)],
  ['step_water0', () => stepWater(0)], ['step_water1', () => stepWater(1)],
  ['land', land], ['swim0', () => swimStroke(0)], ['swim1', () => swimStroke(0.7)], ['splash', splash], ['grab', grab],
];

export function buildSfx(outDir) {
  fs.mkdirSync(path.join(outDir, 'audio'), { recursive: true });
  const clips = SFX.map(([, fn]) => fn());
  SFX.forEach(([name], i) => fs.writeFileSync(path.join(outDir, 'audio', `sfx_${name}.wav`), wav([clips[i]])));
  const total = clips.reduce((s, c) => s + c.length, 0);
  const head = 8 + clips.length * 8;
  const out = Buffer.alloc(head + total * 2);
  out.write('VOX1', 0); out.writeUInt32BE(clips.length, 4);
  let off = 0;
  clips.forEach((c, i) => {
    out.writeUInt32BE(off, 8 + i * 8); out.writeUInt32BE(c.length, 12 + i * 8);
    for (let k = 0; k < c.length; k++) out.writeInt16BE(Math.max(-32767, Math.min(32767, Math.round(c[k] * 30000))), head + (off + k) * 2);
    off += c.length;
  });
  fs.writeFileSync(path.join(outDir, 'sfx.bin'), out);
  return out.length;
}
