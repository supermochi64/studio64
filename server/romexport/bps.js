// BPS patches (the format ROM hack sites and patchers use): encode a target ROM against the
// original, and apply a patch (to verify every export).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

class Writer {
  constructor(size) { this.buf = Buffer.alloc(size); this.n = 0; }
  grow(k) { if (this.n + k > this.buf.length) { const b = Buffer.alloc(Math.max(this.buf.length * 2, this.n + k)); this.buf.copy(b, 0, 0, this.n); this.buf = b; } }
  byte(v) { this.grow(1); this.buf[this.n++] = v; }
  bytes(b) { this.grow(b.length); b.copy(this.buf, this.n); this.n += b.length; }
  num(v) { // BPS variable-length number
    for (;;) {
      const x = v & 0x7F;
      v = Math.floor(v / 128);
      if (v === 0) { this.byte(0x80 | x); break; }
      this.byte(x);
      v--;
    }
  }
  done() { return this.buf.subarray(0, this.n); }
}

const SOURCE_READ = 0, TARGET_READ = 1, SOURCE_COPY = 2, TARGET_COPY = 3;
const KEY = 8;

export function createBps(source, target) {
  const w = new Writer(1 << 20);
  w.bytes(Buffer.from('BPS1'));
  w.num(source.length); w.num(target.length); w.num(0);

  // where 8-byte sequences of the source start (a hash table of the first one seen per slot)
  const BITS = 22, index = new Int32Array(1 << BITS).fill(-1);
  const hash = (b, i) => (Math.imul(b.readUInt32LE(i), 0x9E3779B1) ^ Math.imul(b.readUInt32LE(i + 4), 0x85EBCA77)) >>> (32 - BITS);
  for (let i = 0; i + KEY <= source.length; i += 4) {
    const h = hash(source, i);
    if (index[h] < 0) index[h] = i;
  }

  let pos = 0, literal = 0, sourceRel = 0, targetRel = 0;
  const action = (type, len) => w.num(((len - 1) * 4) + type);
  const flushLiteral = () => {
    if (!literal) return;
    action(TARGET_READ, literal);
    w.bytes(target.subarray(pos - literal, pos));
    literal = 0;
  };
  while (pos < target.length) {
    // same bytes at the same place
    let same = 0;
    while (pos + same < target.length && pos + same < source.length && source[pos + same] === target[pos + same]) same++;
    if (same >= 4) {
      flushLiteral();
      action(SOURCE_READ, same);
      pos += same;
      continue;
    }
    // the same bytes elsewhere in the source
    let best = 0, bestAt = -1;
    if (pos + KEY <= target.length) {
      const at = index[hash(target, pos)];
      if (at >= 0 && source.compare(target, pos, pos + KEY, at, at + KEY) === 0) {
        let n = 0;
        while (pos + n < target.length && at + n < source.length && source[at + n] === target[pos + n]) n++;
        best = n; bestAt = at;
      }
    }
    // a run of the byte before (padding): copied from the target itself
    if (pos > 0) {
      const b = target[pos - 1];
      let run = 0;
      while (pos + run < target.length && target[pos + run] === b) run++;
      if (run >= 32 && run > best) {
        flushLiteral();
        action(TARGET_COPY, run);
        const d = (pos - 1) - targetRel;
        w.num((Math.abs(d) * 2) + (d < 0 ? 1 : 0));
        targetRel = pos - 1 + run;
        pos += run;
        continue;
      }
    }
    if (best >= 16) {
      flushLiteral();
      action(SOURCE_COPY, best);
      const d = bestAt - sourceRel;
      w.num((Math.abs(d) * 2) + (d < 0 ? 1 : 0));
      sourceRel = bestAt + best;
      pos += best;
      continue;
    }
    literal++;
    pos++;
  }
  flushLiteral();

  const tail = Buffer.alloc(12);
  tail.writeUInt32LE(crc32(source), 0);
  tail.writeUInt32LE(crc32(target), 4);
  w.bytes(tail.subarray(0, 8));
  const body = w.done();
  const out = Buffer.alloc(body.length + 4);
  body.copy(out);
  out.writeUInt32LE(crc32(body), body.length);
  return out;
}

export function applyBps(source, patch) {
  if (patch.toString('latin1', 0, 4) !== 'BPS1') throw new Error('not a BPS patch');
  if (crc32(patch.subarray(0, patch.length - 4)) !== patch.readUInt32LE(patch.length - 4)) throw new Error('the patch is damaged');
  let p = 4;
  const num = () => { let data = 0, shift = 1; for (;;) { const x = patch[p++]; data += (x & 0x7F) * shift; if (x & 0x80) break; shift *= 128; data += shift; } return data; };
  const sourceSize = num(), targetSize = num(), meta = num();
  p += meta;
  if (source.length !== sourceSize) throw new Error('this patch is for a different ROM');
  if (crc32(source) !== patch.readUInt32LE(patch.length - 12)) throw new Error('this patch is for a different ROM');
  const out = Buffer.alloc(targetSize);
  let o = 0, sRel = 0, tRel = 0;
  const end = patch.length - 12;
  while (p < end) {
    const d = num(), type = d & 3, len = Math.floor(d / 4) + 1;
    if (type === SOURCE_READ) { source.copy(out, o, o, o + len); o += len; }
    else if (type === TARGET_READ) { patch.copy(out, o, p, p + len); p += len; o += len; }
    else {
      const off = num(), delta = (off & 1 ? -1 : 1) * Math.floor(off / 2);
      if (type === SOURCE_COPY) { sRel += delta; source.copy(out, o, sRel, sRel + len); sRel += len; o += len; }
      else { tRel += delta; for (let i = 0; i < len; i++) out[o++] = out[tRel++]; }
    }
  }
  if (crc32(out) !== patch.readUInt32LE(patch.length - 8)) throw new Error('the patched ROM does not match');
  return out;
}
