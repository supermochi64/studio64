// PNG decoding and the decomp's texture encodings (the same bytes as its n64graphics tool), for the
// importers of Shoggoth World levels (tools/import_shoggoth_tokyo.mjs).
import zlib from 'node:zlib';

// Decode a non-interlaced 8-bit PNG (gray, gray+alpha, RGB, RGBA, palette) to RGBA bytes.
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (interlace) throw new Error('interlaced PNG');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!ch) throw new Error(`PNG colour type ${type}`);
  const bitsPP = depth * ch;
  const bpp = Math.max(1, bitsPP >> 3);
  const stride = (w * bitsPP + 7) >> 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0, b = prev ? prev[x] : 0, c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      row[x] = v & 255;
    }
  }
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const sample = (k) => {
      if (depth === 8) return px[y * stride + x * ch + k];
      if (depth === 16) return px[y * stride + (x * ch + k) * 2];
      const per = 8 / depth, byte = px[y * stride + Math.floor(x / per)];
      const v = (byte >> (8 - depth * (x % per + 1))) & ((1 << depth) - 1);
      return type === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
    };
    if (type === 0) { const g = sample(0); out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = 255; }
    else if (type === 4) { const g = sample(0); out[o] = out[o + 1] = out[o + 2] = g; out[o + 3] = sample(1); }
    else if (type === 2) { out[o] = sample(0); out[o + 1] = sample(1); out[o + 2] = sample(2); out[o + 3] = 255; }
    else if (type === 6) { out[o] = sample(0); out[o + 1] = sample(1); out[o + 2] = sample(2); out[o + 3] = sample(3); }
    else { const i = sample(0); out[o] = palette[i * 3]; out[o + 1] = palette[i * 3 + 1]; out[o + 2] = palette[i * 3 + 2]; out[o + 3] = trns && i < trns.length ? trns[i] : 255; }
  }
  return { w, h, rgba: out, gray: type === 0 || type === 4 };
}

const s85 = (v) => Math.floor(((v + 4) * 0x1f) / 0xff);
const s84 = (v) => Math.floor(v / 0x11);
const s83 = (v) => Math.floor(v / 0x24);
const lum = (img, i) => (img.gray ? img.rgba[i * 4] : (img.rgba[i * 4] * 77 + img.rgba[i * 4 + 1] * 150 + img.rgba[i * 4 + 2] * 29) >> 8);

// The raw texture bytes of `img` in format fmt (rgba16, rgba32, ia16, ia8, ia4, ia1, i8, i4).
export function encodeTexture(img, fmt) {
  const n = img.w * img.h, p = img.rgba;
  const out = [];
  switch (fmt) {
    case 'rgba16':
      for (let i = 0; i < n; i++) {
        const v = (s85(p[i * 4]) << 11) | (s85(p[i * 4 + 1]) << 6) | (s85(p[i * 4 + 2]) << 1) | (p[i * 4 + 3] ? 1 : 0);
        out.push(v >> 8, v & 255);
      }
      break;
    case 'rgba32': for (let i = 0; i < n * 4; i++) out.push(p[i]); break;
    case 'ia16': for (let i = 0; i < n; i++) out.push(lum(img, i), p[i * 4 + 3]); break;
    case 'ia8': for (let i = 0; i < n; i++) out.push((s84(lum(img, i)) << 4) | s84(p[i * 4 + 3])); break;
    case 'ia4':
      for (let i = 0; i < n; i += 2) {
        const a = (s83(lum(img, i)) << 1) | (p[i * 4 + 3] ? 1 : 0), b = (s83(lum(img, i + 1)) << 1) | (p[(i + 1) * 4 + 3] ? 1 : 0);
        out.push((a << 4) | b);
      }
      break;
    case 'i8': for (let i = 0; i < n; i++) out.push(lum(img, i)); break;
    case 'i4': for (let i = 0; i < n; i += 2) out.push((s84(lum(img, i)) << 4) | s84(lum(img, i + 1))); break;
    default: throw new Error(`texture format ${fmt}`);
  }
  return out;
}

// The bytes as the decomp writes them into a .inc.c ("0x12,0x34,...").
export function incC(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += '0x' + bytes[i].toString(16).padStart(2, '0') + ',' + ((i & 15) === 15 ? '\n' : '');
  return s + '\n';
}

// PNG bytes from RGBA (no filtering; for previews and skies).
export function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy ? rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4) : raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
