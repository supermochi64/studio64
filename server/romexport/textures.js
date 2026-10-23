// Textures for the N64: power-of-two sides, at most 2048 texels (4 KB of TMEM), RGBA16 -- or with a
// palette (CI8, CI4) when they have few enough colours: the same picture in a half or a quarter of
// the memory.

const MAX_TEXELS = 2048;

const pow2Below = (n) => { let p = 1; while (p * 2 <= n) p *= 2; return p; };

// Box-filters an RGBA8 image to w x h.
function resample(src, sw, sh, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * sh) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * sw) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / w));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * sw + xx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
    }
  }
  return out;
}

// -> { w, h, bytes (RGBA16 big endian), scaleS, scaleT (dumped texture coordinates -> texels), alpha }
export function toN64(tex) {
  let w = pow2Below(tex.w), h = pow2Below(tex.h);
  while (w * h > MAX_TEXELS) {
    if (w >= h) w /= 2; else h /= 2;
  }
  const px = w === tex.w && h === tex.h ? tex.rgba : resample(tex.rgba, tex.w, tex.h, w, h);
  const bytes = Buffer.alloc(w * h * 2);
  let alpha = false;
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4] >> 3, g = px[i * 4 + 1] >> 3, b = px[i * 4 + 2] >> 3, a = px[i * 4 + 3] >= 128 ? 1 : 0;
    if (!a) alpha = true;
    bytes.writeUInt16BE((r << 11) | (g << 6) | (b << 1) | a, i * 2);
  }
  const out = { w, h, bytes, fmt: 'rgba16', scaleS: w / (tex.tileW || tex.w), scaleT: h / (tex.tileH || tex.h), alpha };
  // few colours: indices into a palette (exactly the same colours)
  const colors = new Map();
  for (let i = 0; i < w * h && colors.size <= 256; i++) { const c = bytes.readUInt16BE(i * 2); if (!colors.has(c)) colors.set(c, colors.size); }
  if (colors.size <= 256) {
    const ci4 = colors.size <= 16;
    const palette = Buffer.alloc((ci4 ? 16 : 256) * 2);
    for (const [c, i] of colors) palette.writeUInt16BE(c, i * 2);
    const texels = Buffer.alloc(ci4 ? (w * h) / 2 : w * h);
    for (let i = 0; i < w * h; i++) {
      const k = colors.get(bytes.readUInt16BE(i * 2));
      if (ci4) texels[i >> 1] |= (i & 1) ? k : k << 4;
      else texels[i] = k;
    }
    return { ...out, bytes: texels, fmt: ci4 ? 'ci4' : 'ci8', palette };
  }
  return out;
}

export const log2 = (n) => Math.round(Math.log2(n));
