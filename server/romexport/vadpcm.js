// The N64's sample format (VADPCM), as the SDK's tools make it (tools/sdk-tools in the decomp:
// tabledesign's codebook, vadpcm_enc's frames): 16 samples per 9-byte frame, each frame a 4-bit error
// per sample scaled by a power of two, after a prediction from the samples before it. A sound gets
// two predictors: its own (order 2, from its autocorrelation) and none (for its attacks).

export const ORDER = 2;
export const PREDICTORS = 2;

// The codebook of a prediction polynomial (row: 1, a1, a2): what tabledesign prints (print_entry)
function bookOf(row) {
  const table = Array.from({ length: 8 }, () => new Array(ORDER).fill(0));
  for (let i = 0; i < ORDER; i++) for (let j = i; j < ORDER; j++) table[i][j] = -row[ORDER - j + i];
  for (let i = 1; i < 8; i++) for (let j = 1; j <= ORDER; j++) if (i - j >= 0) for (let k = 0; k < ORDER; k++) table[i][k] -= row[j] * table[i - j][k];
  const out = [];
  for (let i = 0; i < ORDER; i++) for (let j = 0; j < 8; j++) {
    const f = table[j][i] * 2048;
    out.push(Math.max(-0x8000, Math.min(0x7FFF, f < 0 ? Math.trunc(f - 0.5) : Math.trunc(f + 0.5))));
  }
  return out;
}

// pcm: Int16Array -> the book (PREDICTORS * ORDER * 8 values): the sound's own predictor, then none
export function designBook(pcm) {
  const r = [0, 0, 0];
  for (let i = 0; i < pcm.length; i++) for (let k = 0; k <= ORDER; k++) if (i - k >= 0) r[k] += pcm[i] * pcm[i - k];
  let row = [1, 0, 0];
  if (r[0] > 0) {
    // Levinson-Durbin, kept stable
    const k1 = Math.max(-0.97, Math.min(0.97, -r[1] / r[0]));
    const e1 = r[0] * (1 - k1 * k1);
    const k2 = e1 > 0 ? Math.max(-0.97, Math.min(0.97, -(r[2] + k1 * r[1]) / e1)) : 0;
    row = [1, k1 + k2 * k1, k2];
  }
  return [...bookOf(row), ...bookOf([1, 0, 0])];
}

// the decoder's form of a book: per predictor, 8 rows of ORDER + 8 (readcodebook)
function expand(book) {
  const tables = [];
  for (let p = 0; p < book.length / (ORDER * 8); p++) {
    const t = Array.from({ length: 8 }, () => new Array(ORDER + 8).fill(0));
    for (let j = 0; j < ORDER; j++) for (let k = 0; k < 8; k++) t[k][j] = book[p * ORDER * 8 + j * 8 + k];
    for (let k = 1; k < 8; k++) t[k][ORDER] = t[k - 1][ORDER - 1];
    t[0][ORDER] = 1 << 11;
    for (let k = 1; k < 8; k++) {
      let j = 0;
      for (; j < k; j++) t[j][k + ORDER] = 0;
      for (; j < 8; j++) t[j][k + ORDER] = t[j - k][ORDER];
    }
    tables.push(t);
  }
  return tables;
}

// (out / 2^11, rounded down, as the hardware's decoder)
function inner(length, a, b) {
  let out = 0;
  for (let i = 0; i < length; i++) out += a[i] * b[i];
  return Math.floor(out / 2048);
}

const clamp16 = (x) => Math.max(-0x8000, Math.min(0x7FFF, x));
const qsample = (x, scale) => (x > 0 ? Math.trunc(x / scale + 0.4999999) : Math.trunc(x / scale - 0.4999999));

// pcm: Int16Array -> Buffer of frames (vencodeframe)
export function encode(pcm, book) {
  const coef = expand(book);
  const frames = Math.ceil(pcm.length / 16);
  const out = Buffer.alloc(frames * 9);
  const state = new Array(16).fill(0);
  for (let f = 0; f < frames; f++) {
    const inBuf = Array.from({ length: 16 }, (_, i) => pcm[f * 16 + i] ?? 0);
    // the predictor with the smallest error
    let best = 0, min = Infinity;
    const errors = (p) => {
      const v = new Array(16).fill(0), pred = new Array(16), e = new Array(16);
      for (let i = 0; i < ORDER; i++) v[i] = state[16 - ORDER + i];
      for (let i = 0; i < 8; i++) { pred[i] = inner(ORDER + i, coef[p][i], v); v[i + ORDER] = inBuf[i] - pred[i]; e[i] = v[i + ORDER]; }
      for (let i = 0; i < ORDER; i++) v[i] = pred[8 - ORDER + i] + v[8 + i];
      for (let i = 0; i < 8; i++) { pred[8 + i] = inner(ORDER + i, coef[p][i], v); v[i + ORDER] = inBuf[8 + i] - pred[8 + i]; e[8 + i] = v[i + ORDER]; }
      return e;
    };
    for (let p = 0; p < coef.length; p++) {
      const se = errors(p).reduce((s, x) => s + x * x, 0);
      if (se < min) { min = se; best = p; }
    }
    const ie = errors(best).map(clamp16);
    let max = 0;
    for (const x of ie) if (Math.abs(x) > Math.abs(max)) max = x;
    let scale = 0;
    for (; scale <= 12; scale++) { if (max <= 7 && max >= -8) break; max = Math.trunc(max / 2); }
    const saved = state.slice();
    const ix = new Array(16);
    scale--;
    let iter = 0, maxClip;
    do {
      iter++;
      maxClip = 0;
      scale = Math.min(12, scale + 1);
      const v = new Array(16).fill(0);
      for (let i = 0; i < ORDER; i++) v[i] = saved[16 - ORDER + i];
      for (let half = 0; half < 2; half++) {
        if (half === 1) for (let i = 0; i < ORDER; i++) v[i] = state[8 - ORDER + i];
        for (let i = 0; i < 8; i++) {
          const n = half * 8 + i;
          const pred = inner(ORDER + i, coef[best][i], v);
          ix[n] = qsample(inBuf[n] - pred, 1 << scale);
          const c = Math.max(-8, Math.min(7, ix[n])) - ix[n];
          maxClip = Math.max(maxClip, Math.abs(c));
          ix[n] += c;
          v[i + ORDER] = ix[n] * (1 << scale);
          state[n] = pred + v[i + ORDER];
        }
      }
    } while (maxClip >= 2 && iter < 2);
    out[f * 9] = (scale << 4) | (best & 0xF);
    for (let i = 0; i < 16; i += 2) out[f * 9 + 1 + i / 2] = ((ix[i] & 0xF) << 4) | (ix[i + 1] & 0xF);
  }
  return out;
}

// frames -> Int16Array (my_decodeframe: as the N64 plays them)
export function decode(data, book, length) {
  const coef = expand(book);
  const out = new Int16Array(length);
  const state = new Array(16).fill(0);
  for (let f = 0; f * 9 < data.length; f++) {
    const header = data[f * 9], scale = 1 << (header >> 4), p = header & 0xF;
    const ix = [];
    for (let i = 0; i < 8; i++) { const c = data[f * 9 + 1 + i]; ix.push(c >> 4, c & 0xF); }
    for (let i = 0; i < 16; i++) ix[i] = (ix[i] >= 8 ? ix[i] - 16 : ix[i]) * scale;
    for (let j = 0; j < 2; j++) {
      const v = new Array(16).fill(0);
      for (let i = 0; i < ORDER; i++) v[i] = j === 0 ? state[16 - ORDER + i] : state[8 - ORDER + i];
      for (let i = 0; i < 8; i++) {
        const n = j * 8 + i;
        v[ORDER + i] = ix[n];
        state[n] = inner(ORDER + i, coef[p][i], v) + ix[n];
      }
    }
    for (let i = 0; i < 16 && f * 16 + i < length; i++) out[f * 16 + i] = clamp16(state[i]);
  }
  return out;
}
