// Painting textures the N64 way: soft, airbrushed and readable. Everything is drawn at a high resolution
// (anti-aliased shapes, gradients, bevels, seamless noise), then boxed down to the small texture the
// console uses, so a 32x32 tile keeps smooth shading instead of hard pixels. Drawing wraps round the
// edges, so every texture tiles.
import { Canvas } from './png.mjs';

export const hexc = (h, a = 255) => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255, a]; };
export const lerp = (a, b, t) => a + (b - a) * t;
export const mixc = (a, b, t) => [0, 1, 2, 3].map((i) => lerp(a[i] ?? 255, b[i] ?? 255, t));
export const shadec = (c, f) => [c[0] * f, c[1] * f, c[2] * f, c[3] ?? 255];
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export class Paint {
  constructor(w, h, { ss = 8, seed = 1, wrap = true } = {}) {
    this.w = w; this.h = h; this.ss = ss; this.W = w * ss; this.H = h * ss; this.wrap = wrap;
    this.px = new Float32Array(this.W * this.H * 4);
    this.seed = seed;
    let s = seed >>> 0 || 1;
    this.r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    // a lattice of random values for the seamless noise
    this.lat = new Float32Array(256 * 256); for (let i = 0; i < this.lat.length; i++) this.lat[i] = this.r();
  }
  // ---- low level (coordinates in texture pixels, fractional) ----
  _blend(X, Y, c, a) {
    if (this.wrap) { X = ((X % this.W) + this.W) % this.W; Y = ((Y % this.H) + this.H) % this.H; } else if (X < 0 || Y < 0 || X >= this.W || Y >= this.H) return;
    const i = (Y * this.W + X) * 4, p = this.px;
    const ca = (c[3] ?? 255) / 255 * a;
    if (ca <= 0) return;
    const da = p[i + 3];
    const oa = ca + da * (1 - ca);
    for (let k = 0; k < 3; k++) p[i + k] = oa > 0 ? (c[k] * ca + p[i + k] * da * (1 - ca)) / oa : 0;
    p[i + 3] = oa;
  }
  // coverage-shaded fill of everything where fn(x, y) (in texture pixels) returns coverage 0..1
  shape(x0, y0, x1, y1, c, cover) {
    const S = this.ss;
    const X0 = Math.floor(x0 * S), X1 = Math.ceil(x1 * S), Y0 = Math.floor(y0 * S), Y1 = Math.ceil(y1 * S);
    for (let Y = Y0; Y < Y1; Y++) for (let X = X0; X < X1; X++) {
      const x = (X + 0.5) / S, y = (Y + 0.5) / S;
      const a = cover(x, y);
      if (a > 0) this._blend(X, Y, typeof c === 'function' ? c(x, y) : c, a);
    }
  }
  fill(c) { for (let i = 0; i < this.W * this.H; i++) { this.px[i * 4] = c[0]; this.px[i * 4 + 1] = c[1]; this.px[i * 4 + 2] = c[2]; this.px[i * 4 + 3] = (c[3] ?? 255) / 255; } return this; }
  clear() { this.px.fill(0); return this; }
  // ---- shapes ----
  // a rectangle, optionally rounded (radius) and soft-edged (feather), colour or fn(x, y)
  rect(x0, y0, x1, y1, c, { r = 0, soft = 0.5 } = {}) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hx = (x1 - x0) / 2, hy = (y1 - y0) / 2;
    const f = Math.max(soft, 1 / this.ss);
    this.shape(x0 - f, y0 - f, x1 + f, y1 + f, c, (x, y) => {
      const qx = Math.abs(x - cx) - (hx - r), qy = Math.abs(y - cy) - (hy - r);
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      return 1 - smooth(-f / 2, f / 2, d);
    });
    return this;
  }
  circle(x, y, rad, c, soft = 0.5) {
    const f = Math.max(soft, 1 / this.ss);
    this.shape(x - rad - f, y - rad - f, x + rad + f, y + rad + f, c, (px, py) => 1 - smooth(-f / 2, f / 2, Math.hypot(px - x, py - y) - rad));
    return this;
  }
  ellipse(x, y, rx, ry, c, soft = 0.5) {
    const f = Math.max(soft, 1 / this.ss);
    this.shape(x - rx - f, y - ry - f, x + rx + f, y + ry + f, c, (px, py) => { const d = Math.hypot((px - x) / rx, (py - y) / ry); return 1 - smooth(1 - f / Math.min(rx, ry) / 2, 1 + f / Math.min(rx, ry) / 2, d); });
    return this;
  }
  line(x0, y0, x1, y1, width, c, soft = 0.5) {
    const f = Math.max(soft, 1 / this.ss), hw = width / 2;
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
    this.shape(Math.min(x0, x1) - hw - f, Math.min(y0, y1) - hw - f, Math.max(x0, x1) + hw + f, Math.max(y0, y1) + hw + f, c, (x, y) => {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2));
      return 1 - smooth(hw - f / 2, hw + f / 2, Math.hypot(x - (x0 + dx * t), y - (y0 + dy * t)));
    });
    return this;
  }
  poly(pts, c, soft = 0.5) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const f = Math.max(soft, 1 / this.ss);
    this.shape(Math.min(...xs) - f, Math.min(...ys) - f, Math.max(...xs) + f, Math.max(...ys) + f, c, (x, y) => {
      let inside = false, dmin = 1e9;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        const dx = xj - xi, dy = yj - yi, L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((x - xi) * dx + (y - yi) * dy) / L2));
        dmin = Math.min(dmin, Math.hypot(x - (xi + dx * t), y - (yi + dy * t)));
      }
      const d = inside ? -dmin : dmin;
      return 1 - smooth(-f / 2, f / 2, d);
    });
    return this;
  }
  // a vertical (or horizontal) gradient over a rectangle
  vgrad(x0, y0, x1, y1, top, bottom, opts = {}) { return this.rect(x0, y0, x1, y1, (x, y) => mixc(top, bottom, (y - y0) / (y1 - y0)), opts); }
  hgrad(x0, y0, x1, y1, left, right, opts = {}) { return this.rect(x0, y0, x1, y1, (x, y) => mixc(left, right, (x - x0) / (x1 - x0)), opts); }
  // a raised (or sunk: depth < 0) panel edge: light on the top and left, shadow on the bottom and right
  bevel(x0, y0, x1, y1, width = 1, depth = 1, { light = [255, 255, 255], dark = [0, 0, 0], a = 0.35 } = {}) {
    const L = [...light, 255 * a], D = [...dark, 255 * a];
    const hi = depth > 0 ? L : D, lo = depth > 0 ? D : L;
    this.rect(x0, y0, x1, y0 + width, hi, { soft: 0.6 });
    this.rect(x0, y0, x0 + width, y1, hi, { soft: 0.6 });
    this.rect(x0, y1 - width, x1, y1, lo, { soft: 0.6 });
    this.rect(x1 - width, y0, x1, y1, lo, { soft: 0.6 });
    return this;
  }
  // ---- noise (seamless: periodic over the texture) ----
  noise(x, y, cells) {
    // value noise with `cells` lattice cells across the width (and proportionally down)
    const cx = cells, cy = Math.max(1, Math.round(cells * this.h / this.w));
    const u = (x / this.w) * cx, v = (y / this.h) * cy;
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const L = (a, b) => this.lat[(((b % cy) + cy) % cy) * 256 + (((a % cx) + cx) % cx) + ((cells * 37) & 127)];
    const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
    return lerp(lerp(L(i, j), L(i + 1, j), su), lerp(L(i, j + 1), L(i + 1, j + 1), su), sv);
  }
  fbm(x, y, base = 4, oct = 4, gain = 0.5) {
    let v = 0, a = 1, n = 0, c = base;
    for (let o = 0; o < oct; o++) { v += this.noise(x, y, c) * a; n += a; a *= gain; c *= 2; }
    return v / n;
  }
  // tint the whole texture (or a region) by noise: amount is +- brightness
  mottle(amount, base = 4, oct = 4, region = null) {
    const S = this.ss;
    const [x0, y0, x1, y1] = region || [0, 0, this.w, this.h];
    for (let Y = Math.floor(y0 * S); Y < y1 * S; Y++) for (let X = Math.floor(x0 * S); X < x1 * S; X++) {
      const n = this.fbm((X + 0.5) / S, (Y + 0.5) / S, base, oct) * 2 - 1;
      const i = (Y * this.W + X) * 4; const f = 1 + n * amount;
      for (let k = 0; k < 3; k++) this.px[i + k] = Math.max(0, Math.min(255, this.px[i + k] * f));
    }
    return this;
  }
  // tint by a colour where noise is above a threshold (patches: moss, stains, wear)
  patches(c, base, threshold, softness = 0.08, strength = 1) {
    const S = this.ss;
    for (let Y = 0; Y < this.H; Y++) for (let X = 0; X < this.W; X++) {
      const n = this.fbm((X + 0.5) / S, (Y + 0.5) / S, base, 3);
      const a = smooth(threshold - softness, threshold + softness, n) * strength;
      if (a > 0) this._blend(X, Y, c, a);
    }
    return this;
  }
  // scattered little dabs (gravel, leaf litter, grass blades)
  speckle(count, colors, size = [0.3, 0.8], alpha = 1, region = null) {
    const [x0, y0, x1, y1] = region || [0, 0, this.w, this.h];
    for (let k = 0; k < count; k++) {
      const x = x0 + this.r() * (x1 - x0), y = y0 + this.r() * (y1 - y0);
      const c = colors[Math.floor(this.r() * colors.length)];
      this.circle(x, y, size[0] + this.r() * (size[1] - size[0]), [c[0], c[1], c[2], (c[3] ?? 255) * alpha], 0.4);
    }
    return this;
  }
  // per-pixel function: fn(x, y, rgba) -> rgba (or undefined to keep)
  map(fn) {
    const S = this.ss;
    for (let Y = 0; Y < this.H; Y++) for (let X = 0; X < this.W; X++) {
      const i = (Y * this.W + X) * 4;
      const c = [this.px[i], this.px[i + 1], this.px[i + 2], this.px[i + 3] * 255];
      const o = fn((X + 0.5) / S, (Y + 0.5) / S, c);
      if (o) { this.px[i] = o[0]; this.px[i + 1] = o[1]; this.px[i + 2] = o[2]; this.px[i + 3] = (o[3] ?? 255) / 255; }
    }
    return this;
  }
  // ---- the result ----
  toCanvas({ sharpen = 0.25 } = {}) {
    const cv = new Canvas(this.w, this.h);
    const S = this.ss, n = S * S;
    const out = new Float32Array(this.w * this.h * 4);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const k = ((y * S + j) * this.W + x * S + i) * 4, al = this.px[k + 3];
        r += this.px[k] * al; g += this.px[k + 1] * al; b += this.px[k + 2] * al; a += al;
      }
      const o = (y * this.w + x) * 4;
      out[o] = a ? r / a : 0; out[o + 1] = a ? g / a : 0; out[o + 2] = a ? b / a : 0; out[o + 3] = a / n;
    }
    // empty texels take their neighbours' colour, so filtering does not pull dark fringes into cut-outs
    for (let pass = 0; pass < 4; pass++) {
      for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
        const o = (y * this.w + x) * 4;
        if (out[o + 3] > 0.02) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = ((((y + dy) % this.h + this.h) % this.h) * this.w + (((x + dx) % this.w + this.w) % this.w)) * 4;
          if (out[k + 3] > 0.02 || (out[k] + out[k + 1] + out[k + 2]) > 0) { r += out[k]; g += out[k + 1]; b += out[k + 2]; c++; }
        }
        if (c && out[o] + out[o + 1] + out[o + 2] === 0) { out[o] = r / c; out[o + 1] = g / c; out[o + 2] = b / c; }
      }
    }
    // a light unsharp pass: bilinear filtering softens again on the console
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const o = (y * this.w + x) * 4;
      const at = (xx, yy) => (((yy + this.h) % this.h) * this.w + ((xx + this.w) % this.w)) * 4;
      const px = [];
      for (let k = 0; k < 3; k++) {
        const blur = (out[at(x - 1, y) + k] + out[at(x + 1, y) + k] + out[at(x, y - 1) + k] + out[at(x, y + 1) + k]) / 4;
        px.push(Math.max(0, Math.min(255, Math.round(out[o + k] + (out[o + k] - blur) * sharpen))));
      }
      const al = out[o + 3];
      // cut-outs: one bit of alpha on the console (RGBA 5551), so decide it here at half
      px.push(al >= 0.5 ? 255 : 0);
      cv.setRaw(x, y, px);
    }
    return cv;
  }
}
