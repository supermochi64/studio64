// A tiny PNG writer (RGBA8) and a canvas to draw procedural textures on. No dependencies.
import fs from 'node:fs';
import zlib from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// Deterministic random numbers (mulberry32).
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export class Canvas {
  constructor(w, h, fill = [0, 0, 0, 255]) {
    this.w = w; this.h = h;
    this.px = new Uint8Array(w * h * 4);
    this.rect(0, 0, w, h, fill);
  }
  set(x, y, c) {
    x = ((x % this.w) + this.w) % this.w; y = ((y % this.h) + this.h) % this.h; // wraps: textures tile
    const i = (y * this.w + x) * 4;
    if (c[3] === 0) { this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; this.px[i + 3] = 0; return; } // clear (transparent)
    const a = (c[3] ?? 255) / 255;
    for (let k = 0; k < 3; k++) this.px[i + k] = Math.round(this.px[i + k] * (1 - a) + c[k] * a);
    this.px[i + 3] = Math.max(this.px[i + 3], c[3] ?? 255);
  }
  setRaw(x, y, c) { const i = (y * this.w + x) * 4; this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; this.px[i + 3] = c[3] ?? 255; }
  get(x, y) { const i = (y * this.w + x) * 4; return [this.px[i], this.px[i + 1], this.px[i + 2], this.px[i + 3]]; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  // per-pixel brightness noise, amount 0..1
  noise(r, amount, chunky = 1) {
    for (let y = 0; y < this.h; y += chunky) for (let x = 0; x < this.w; x += chunky) {
      const d = (r() - 0.5) * 2 * amount * 255;
      for (let j = 0; j < chunky; j++) for (let i = 0; i < chunky; i++) {
        const k = ((y + j) * this.w + (x + i)) * 4;
        for (let c = 0; c < 3; c++) this.px[k + c] = Math.max(0, Math.min(255, this.px[k + c] + d));
      }
    }
  }
  save(file) { fs.writeFileSync(file, encodePng(this.w, this.h, this.px)); }
}

export const hex = (s, a = 255) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16), a];
export const mix = (a, b, t) => a.map((v, i) => Math.round(v + ((b[i] ?? 255) - v) * t));
export const shade = (c, f) => [Math.min(255, Math.round(c[0] * f)), Math.min(255, Math.round(c[1] * f)), Math.min(255, Math.round(c[2] * f)), c[3] ?? 255];
