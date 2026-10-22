// N64 texture formats: decode the game's textures (RGBA16/32, IA, I) to RGBA8,
// and bring any image to N64 sizes and colour depths (power-of-two sizes,
// RGBA16 5551, greyscale I/IA, palettes like CI4/CI8).

// ---- decoding ---------------------------------------------------------------------

// bytes: Uint8Array of the texture; returns Uint8ClampedArray w*h*4.
export function decodeN64(bytes, fmt, bits, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  const n = w * h;
  const put = (i, r, g, b, a) => { out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a; };
  if (fmt === 'rgba' && bits === 16) {
    for (let i = 0; i < n; i++) {
      const v = (bytes[i * 2] << 8) | bytes[i * 2 + 1];
      put(i, ((v >> 11) & 31) * 255 / 31, ((v >> 6) & 31) * 255 / 31, ((v >> 1) & 31) * 255 / 31, v & 1 ? 255 : 0);
    }
  } else if (fmt === 'rgba' && bits === 32) {
    out.set(bytes.subarray(0, n * 4));
  } else if (fmt === 'ia' && bits === 16) {
    for (let i = 0; i < n; i++) put(i, bytes[i * 2], bytes[i * 2], bytes[i * 2], bytes[i * 2 + 1]);
  } else if (fmt === 'ia' && bits === 8) {
    for (let i = 0; i < n; i++) {
      const v = bytes[i], c = (v >> 4) * 17;
      put(i, c, c, c, (v & 15) * 17);
    }
  } else if (fmt === 'ia' && bits === 4) {
    for (let i = 0; i < n; i++) {
      const v = (bytes[i >> 1] >> (i & 1 ? 0 : 4)) & 15, c = ((v >> 1) * 255) / 7;
      put(i, c, c, c, v & 1 ? 255 : 0);
    }
  } else if (fmt === 'ia' && bits === 1) {
    for (let i = 0; i < n; i++) {
      const v = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
      put(i, 255, 255, 255, v ? 255 : 0);
    }
  } else if (fmt === 'i' && bits === 8) {
    for (let i = 0; i < n; i++) put(i, bytes[i], bytes[i], bytes[i], 255);
  } else if (fmt === 'i' && bits === 4) {
    for (let i = 0; i < n; i++) {
      const c = ((bytes[i >> 1] >> (i & 1 ? 0 : 4)) & 15) * 17;
      put(i, c, c, c, 255);
    }
  } else {
    // palette textures: show the indices as grey
    for (let i = 0; i < n; i++) {
      const c = bits === 4 ? ((bytes[i >> 1] >> (i & 1 ? 0 : 4)) & 15) * 17 : bytes[i];
      put(i, c, c, c, 255);
    }
  }
  return out;
}

// RGBA8 -> big-endian RGBA16 (5551) bytes, the format the block materials and skies use.
export function encodeRGBA16(rgba, w, h) {
  const out = new Uint8Array(w * h * 2);
  for (let i = 0; i < w * h; i++) {
    const r = Math.round(rgba[i * 4] * 31 / 255), g = Math.round(rgba[i * 4 + 1] * 31 / 255), b = Math.round(rgba[i * 4 + 2] * 31 / 255);
    const v = (r << 11) | (g << 6) | (b << 1) | (rgba[i * 4 + 3] >= 128 ? 1 : 0);
    out[i * 2] = v >> 8;
    out[i * 2 + 1] = v & 255;
  }
  return out;
}

// ---- N64-friendly conversion ----------------------------------------------------------

export const TEX_FORMATS = {
  rgba16: { label: 'RGBA16 (N64 colour)', hint: '32 levels per channel, 1-bit alpha' },
  rgba32: { label: 'RGBA32 (full colour)', hint: 'no colour loss' },
  ci8: { label: 'CI8 (256 colours)', hint: 'palette, like many N64 textures' },
  ci4: { label: 'CI4 (16 colours)', hint: 'small palette, very retro' },
  ia8: { label: 'IA8 (grey + alpha)', hint: 'greyscale, tinted by the material colour' },
  i4: { label: 'I4 (16 greys)', hint: 'greyscale, very small' },
};

export const pow2 = (v, max) => {
  let p = 1;
  while (p * 2 <= v && p < max) p *= 2;
  // round to the nearer power of two
  if (p * 2 <= max && v - p > p * 2 - v) p *= 2;
  return Math.max(4, Math.min(max, p));
};

// Draw any image source into an RGBA8 buffer of w*h (smooth scaling, or nearest for pixel art).
export function rasterize(src, w, h, { smooth = true, crop = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = smooth;
  g.imageSmoothingQuality = 'high';
  if (crop) g.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  else g.drawImage(src, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

// Image data (RGBA8) -> canvas.
export function toCanvas(rgba, w, h, scale = 1) {
  const c = document.createElement('canvas');
  c.width = w * scale;
  c.height = h * scale;
  const g = c.getContext('2d');
  const img = new ImageData(new Uint8ClampedArray(rgba), w, h);
  if (scale === 1) { g.putImageData(img, 0, 0); return c; }
  const t = document.createElement('canvas');
  t.width = w; t.height = h;
  t.getContext('2d').putImageData(img, 0, 0);
  g.imageSmoothingEnabled = false;
  g.drawImage(t, 0, 0, c.width, c.height);
  return c;
}

export const toDataURL = (rgba, w, h, scale = 1) => toCanvas(rgba, w, h, scale).toDataURL('image/png');

export async function toPNGBlob(rgba, w, h) {
  const c = toCanvas(rgba, w, h);
  return new Promise((ok) => c.toBlob(ok, 'image/png'));
}

export async function blobToRGBA(blob) {
  const bmp = await createImageBitmap(blob);
  const rgba = rasterize(bmp, bmp.width, bmp.height, { smooth: false });
  const out = { rgba, w: bmp.width, h: bmp.height };
  bmp.close?.();
  return out;
}

// Median-cut palette of up to n colours (alpha kept apart: fully transparent pixels stay transparent).
function palette(rgba, n) {
  const px = [];
  for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] >= 128) px.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  if (!px.length) return [[0, 0, 0]];
  let boxes = [px];
  while (boxes.length < n) {
    let bi = -1, best = -1, axis = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let a = 0; a < 3; a++) {
        let lo = 255, hi = 0;
        for (const p of b) { if (p[a] < lo) lo = p[a]; if (p[a] > hi) hi = p[a]; }
        if (hi - lo > best) { best = hi - lo; bi = i; axis = a; }
      }
    });
    if (bi < 0 || best <= 0) break;
    const b = boxes[bi].sort((p, q) => p[axis] - q[axis]);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.map((b) => {
    const s = [0, 0, 0];
    for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
    return s.map((v) => Math.round(v / b.length));
  });
}

// Quantize RGBA8 in place to an N64 format's look.
export function quantize(rgba, format, { alpha = 'auto' } = {}) {
  const n = rgba.length / 4;
  const cut = alpha !== 'blend';
  if (format === 'rgba16') {
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) rgba[i * 4 + k] = Math.round(Math.round(rgba[i * 4 + k] * 31 / 255) * 255 / 31);
      rgba[i * 4 + 3] = rgba[i * 4 + 3] >= 128 ? 255 : 0;
    }
  } else if (format === 'ia8' || format === 'i4') {
    for (let i = 0; i < n; i++) {
      const y = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
      const q = Math.round(Math.round(y * 15 / 255) * 17);
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = q;
      if (format === 'i4') rgba[i * 4 + 3] = 255;
      else rgba[i * 4 + 3] = cut ? (rgba[i * 4 + 3] >= 128 ? 255 : 0) : Math.round(Math.round(rgba[i * 4 + 3] * 15 / 255) * 17);
    }
  } else if (format === 'ci4' || format === 'ci8') {
    const pal = palette(rgba, format === 'ci4' ? 16 : 256).map((c) => c.map((v) => Math.round(Math.round(v * 31 / 255) * 255 / 31)));
    for (let i = 0; i < n; i++) {
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      let best = 0, bd = 1e9;
      for (let p = 0; p < pal.length; p++) {
        const d = (pal[p][0] - r) ** 2 + (pal[p][1] - g) ** 2 + (pal[p][2] - b) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      rgba[i * 4] = pal[best][0]; rgba[i * 4 + 1] = pal[best][1]; rgba[i * 4 + 2] = pal[best][2];
      rgba[i * 4 + 3] = rgba[i * 4 + 3] >= 128 ? 255 : 0;
    }
  } else if (alpha !== 'blend') {
    for (let i = 0; i < n; i++) rgba[i * 4 + 3] = rgba[i * 4 + 3] >= 128 ? 255 : 0;
  }
  return rgba;
}

// What kind of alpha an image has: 'opaque', 'cutout' (only on/off) or 'blend'.
export function alphaKind(rgba) {
  let partial = 0, clear = 0;
  for (let i = 3; i < rgba.length; i += 4) {
    const a = rgba[i];
    if (a < 250) { if (a < 8) clear++; else partial++; }
  }
  const n = rgba.length / 4;
  if (partial > n * 0.02) return 'blend';
  if (clear + partial > 0) return 'cutout';
  return 'opaque';
}

// ---- colour tools (recolour, tint) -------------------------------------------------------

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

export function hslToRgb(h, s, l) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

export const parseColor = (c) => {
  if (Array.isArray(c)) return c;
  const s = String(c || '').replace('#', '');
  const v = parseInt(s.length === 3 ? s.split('').map((x) => x + x).join('') : s, 16);
  return Number.isFinite(v) ? [(v >> 16) & 255, (v >> 8) & 255, v & 255] : [255, 255, 255];
};
export const hex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// Recolour a copy: hue shift (degrees), saturation and brightness factors, a tint colour
// mixed in by `tint_amount` (0..1, keeping the shading), contrast, invert.
export function recolor(rgba, { hue = 0, saturation = 1, brightness = 1, contrast = 1, tint = null, tint_amount = 0, invert = false, colorize = null } = {}) {
  const out = new Uint8ClampedArray(rgba);
  const tc = tint ? parseColor(tint) : null;
  const cz = colorize ? rgbToHsl(...parseColor(colorize)) : null;
  for (let i = 0; i < out.length; i += 4) {
    let [h, s, l] = rgbToHsl(out[i], out[i + 1], out[i + 2]);
    if (cz) { h = cz[0]; s = cz[1] * Math.max(0.35, s + 0.5); }
    h = (h + hue / 360 + 10) % 1;
    s = Math.max(0, Math.min(1, s * saturation));
    l = Math.max(0, Math.min(1, ((l - 0.5) * contrast + 0.5) * brightness));
    let [r, g, b] = hslToRgb(h, s, l);
    if (tc && tint_amount > 0) {
      const y = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      r = r * (1 - tint_amount) + tc[0] * y * 1.25 * tint_amount;
      g = g * (1 - tint_amount) + tc[1] * y * 1.25 * tint_amount;
      b = b * (1 - tint_amount) + tc[2] * y * 1.25 * tint_amount;
    }
    if (invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
    out[i] = r; out[i + 1] = g; out[i + 2] = b;
  }
  return out;
}

// ---- generated patterns (for Claude and quick fills) ---------------------------------------

const hash2 = (x, y, s) => {
  let h = (x * 374761393 + y * 668265263 + s * 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) & 0xffff) / 65535;
};
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi;
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return (a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv;
}
// Tileable noise: wrap the lattice at `period`.
function tnoise(x, y, period, s) {
  const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi;
  const m = (k) => ((k % period) + period) % period;
  const a = hash2(m(xi), m(yi), s), b = hash2(m(xi + 1), m(yi), s), c = hash2(m(xi), m(yi + 1), s), d = hash2(m(xi + 1), m(yi + 1), s);
  const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return (a * (1 - su) + b * su) * (1 - sv) + (c * (1 - su) + d * su) * sv;
}

export const PATTERNS = ['solid', 'noise', 'checker', 'stripes', 'bricks', 'tiles', 'gradient', 'dots', 'wood', 'grass', 'stone'];

// A tileable w*h pattern in colours a and b.
export function pattern(kind, w, h, { a = '#8a8a8a', b = '#5a5a5a', scale = 1, seed = 1 } = {}) {
  const ca = parseColor(a), cb = parseColor(b);
  const out = new Uint8ClampedArray(w * h * 4);
  const fbm = (x, y, oct, per) => {
    let v = 0, amp = 0.5, f = 1;
    for (let o = 0; o < oct; o++) { v += amp * tnoise(x * f, y * f, per * f, seed + o); amp /= 2; f *= 2; }
    return v / (1 - Math.pow(0.5, oct));
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      let t = 0;
      const per = Math.max(1, Math.round(4 * scale));
      switch (kind) {
        case 'noise': t = fbm(u * per, v * per, 4, per); break;
        case 'checker': { const n = Math.max(1, Math.round(2 * scale)); t = (Math.floor(u * n * 2) + Math.floor(v * n * 2)) % 2; break; }
        case 'stripes': { const n = Math.max(1, Math.round(4 * scale)); t = Math.floor(u * n * 2) % 2; break; }
        case 'bricks': {
          const rows = Math.max(1, Math.round(4 * scale)), cols = Math.max(1, Math.round(2 * scale));
          const ry = v * rows, row = Math.floor(ry);
          const rx = u * cols + (row % 2) * 0.5;
          const fx = rx - Math.floor(rx), fy = ry - row;
          const mortar = fx < 0.06 || fy < 0.12;
          t = mortar ? 1 : 0.15 * fbm(u * 8, v * 8, 2, 8);
          break;
        }
        case 'tiles': { const n = Math.max(1, Math.round(2 * scale)); const fx = (u * n) % 1, fy = (v * n) % 1; t = fx < 0.07 || fy < 0.07 ? 1 : 0.1 * fbm(u * 6, v * 6, 2, 6); break; }
        case 'gradient': t = v; break;
        case 'dots': { const n = Math.max(1, Math.round(3 * scale)); const fx = (u * n) % 1 - 0.5, fy = (v * n) % 1 - 0.5; t = fx * fx + fy * fy < 0.08 ? 1 : 0; break; }
        case 'wood': { const g = fbm(u * 2, v * 8, 3, 2); t = (Math.sin((u * 6 * scale + g * 2.5) * Math.PI * 2) * 0.5 + 0.5) * 0.7 + g * 0.3; break; }
        case 'grass': t = Math.pow(fbm(u * 8, v * 8, 4, 8), 1.3); break;
        case 'stone': { const g = fbm(u * per, v * per, 5, per); t = g > 0.62 ? 1 : g * 0.6; break; }
        default: t = 0;
      }
      const i = (y * w + x) * 4;
      out[i] = ca[0] + (cb[0] - ca[0]) * t;
      out[i + 1] = ca[1] + (cb[1] - ca[1]) * t;
      out[i + 2] = ca[2] + (cb[2] - ca[2]) * t;
      out[i + 3] = 255;
    }
  }
  return out;
}

export { vnoise };
