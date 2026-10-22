// Your Super Mario 64 ROM: unzip it if needed, put it in .z64 byte order, check that it is the
// US version (the only one the decomp's asset extraction knows), and say kindly what is wrong.
import crypto from 'node:crypto';
import zlib from 'node:zlib';

export const US_SHA1 = '9bef1128717f958171a4afac3ed78ee2bb4e86ce';
const KNOWN = {
  '8a20a5c83d6ceb0f0506cfc9fa20d8f438cafe51': 'the Japanese version',
  '4ac5721683d0e0b6bbb561b58a71740845dceea9': 'the European (PAL) version',
  '3f319ae697533a255a1003d09202379d78d5a2e0': 'the Japanese Shindou version',
};
const REGIONS = { E: 'the US version', J: 'the Japanese version', P: 'the European (PAL) version', U: 'the Australian version' };

/** The first ROM-looking file of a .zip (stored or deflated), or null. */
function unzip(buf) {
  // end of central directory record
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = [];
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    files.push({ name, method, csize, size, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const rom = files.find((f) => /\.(z64|n64|v64|rom|bin)$/i.test(f.name)) || files.sort((a, b) => b.size - a.size)[0];
  if (!rom || rom.size > 64 << 20) return null;
  const start = rom.local + 30 + buf.readUInt16LE(rom.local + 26) + buf.readUInt16LE(rom.local + 28);
  const data = buf.subarray(start, start + rom.csize);
  if (rom.method === 0) return { name: rom.name, data: Buffer.from(data) };
  if (rom.method === 8) return { name: rom.name, data: zlib.inflateRawSync(data) };
  return null;
}

/** Big-endian (.z64) copy of a ROM in any of the three byte orders, or null if it is no N64 ROM. */
export function toZ64(buf) {
  const head = buf.readUInt32BE(0);
  if (head === 0x80371240) return { order: 'z64', data: buf };
  const out = Buffer.from(buf);
  if (head === 0x37804012) { // .v64: 16-bit words swapped
    for (let i = 0; i + 1 < out.length; i += 2) { const t = out[i]; out[i] = out[i + 1]; out[i + 1] = t; }
    return { order: 'v64', data: out };
  }
  if (head === 0x40123780) { // .n64: little-endian 32-bit words
    for (let i = 0; i + 3 < out.length; i += 4) { out.writeUInt32BE(buf.readUInt32LE(i), i); }
    return { order: 'n64', data: out };
  }
  return null;
}

/**
 * Checks a dropped file. Returns { ok: true, data, order, note } with the .z64 bytes,
 * or { ok: false, title, message } to show the user.
 */
export function checkRom(input, fileName = '') {
  let buf = input;
  let name = fileName;
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
    const inner = unzip(buf);
    if (!inner) return { ok: false, title: 'This zip has no ROM inside', message: 'Unzip it yourself and drop the .z64, .n64 or .v64 file.' };
    buf = inner.data;
    name = inner.name;
  }
  if (/\.(7z|rar)$/i.test(name) || (buf.length > 6 && buf.subarray(0, 6).toString('latin1') === '7z\xbc\xaf\x27\x1c')) {
    return { ok: false, title: 'Unpack the archive first', message: 'This is a 7-Zip or RAR archive. Unpack it and drop the .z64, .n64 or .v64 file that is inside.' };
  }
  if (buf.length < 0x1000) return { ok: false, title: 'This is not a ROM', message: `The file is only ${buf.length} bytes. A Super Mario 64 ROM is 8 MB (a .z64, .n64 or .v64 file).` };
  const conv = toZ64(buf);
  if (!conv) {
    return { ok: false, title: 'This is not an N64 ROM', message: 'Studio 64 needs your Super Mario 64 cartridge as a ROM file: .z64, .n64 or .v64, 8 MB.' };
  }
  const rom = conv.data;
  const title = rom.subarray(0x20, 0x34).toString('latin1').replace(/\0/g, '').trim();
  const region = String.fromCharCode(rom[0x3e]);
  const sha1 = crypto.createHash('sha1').update(rom).digest('hex');
  const orderNote = conv.order === 'z64' ? '' : ` (converted from .${conv.order} byte order)`;
  if (sha1 === US_SHA1) return { ok: true, data: rom, order: conv.order, sha1, note: `Super Mario 64, US version${orderNote}` };
  if (KNOWN[sha1]) {
    return { ok: false, title: `This is ${KNOWN[sha1]}`, message: 'Studio 64 is built on the decompilation of the US (NTSC) version, so it needs exactly that one. Please use a backup of a US cartridge.' };
  }
  if (!/MARIO ?64/i.test(title)) {
    return { ok: false, title: 'This is not Super Mario 64', message: `The ROM says it is “${title || 'unnamed'}”. Studio 64 needs Super Mario 64 (US version).` };
  }
  if (region !== 'E') {
    return { ok: false, title: `This is ${REGIONS[region] || 'another version'} of Super Mario 64`, message: 'Studio 64 needs the US (NTSC) version. Please use a backup of a US cartridge.' };
  }
  if (rom.length !== 8 << 20) {
    return { ok: false, title: 'This ROM has been changed', message: `It is ${(rom.length / 1048576).toFixed(1)} MB instead of 8 MB: probably a ROM hack or an expanded ROM. Studio 64 needs the original, unmodified US ROM.` };
  }
  return { ok: false, title: 'This ROM has been changed', message: 'It is the US version, but not the original: a ROM hack, a patched ROM or a bad dump. Studio 64 needs the unmodified US ROM (SHA-1 9bef1128…).' };
}
