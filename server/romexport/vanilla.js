// The original levels in the base ROM, read for an export that edits them: their level script
// (segment 0x0E, which an export copies and patches), their compressed level data (segment 7:
// collision, macro objects) and the object presets the game spawns from those.

// MIO0, the game's compression (decompress only)
export function mio0(buf) {
  if (buf.toString('latin1', 0, 4) !== 'MIO0') throw new Error('not MIO0 data');
  const size = buf.readUInt32BE(4);
  let comp = buf.readUInt32BE(8), raw = buf.readUInt32BE(12), bitsAt = 16;
  const out = Buffer.alloc(size);
  let o = 0, bits = 0, left = 0;
  while (o < size) {
    if (!left) { bits = buf.readUInt32BE(bitsAt); bitsAt += 4; left = 32; }
    if (bits & 0x80000000) out[o++] = buf[raw++];
    else {
      const v = buf.readUInt16BE(comp); comp += 2;
      const n = (v >> 12) + 3, back = (v & 0xFFF) + 1;
      for (let k = 0; k < n && o < size; k++, o++) out[o] = out[o - back];
    }
    bits = (bits << 1) >>> 0;
    left--;
  }
  return out;
}

// a table in the game's code (main segment) -> its bytes in the ROM
function codeAt(rom, ix, name, length) {
  const addr = ix.symbols[name];
  if (addr === undefined) throw new Error(`the base ROM has no ${name}`);
  const at = addr - ix.symbols._mainSegmentStart + ix.symbols._mainSegmentRomStart;
  return rom.subarray(at, at + length);
}

// macro object preset -> its behavior; special object preset -> { type, behavior }
export function presets(rom, ix) {
  const macro = [];
  const m = codeAt(rom, ix, 'sMacroObjectPresets', 0x200 * 8);
  for (let i = 0; i < 0x200; i++) macro.push(m.readUInt32BE(i * 8));
  const special = new Map();
  const sp = codeAt(rom, ix, 'sSpecialObjectPresets', 0x100 * 8);
  for (let i = 0; i < 0x100; i++) {
    const id = sp[i * 8];
    if (special.has(id)) break;
    special.set(id, { type: sp[i * 8 + 1], behavior: sp.readUInt32BE(i * 8 + 4) });
    if (id === 0xFF) break;
  }
  return { macro, special };
}
// extra values after preset, x, y, z per special object type (SPTYPE_*)
const SPECIAL_EXTRA = [0, 1, 2, 3, 1];

// A level's script segment as it is in the base ROM, with what is where in it:
// { seg, entry, seg7: [romStart, romEnd], globals: [script addresses], areas: Map(index ->
//   { geo, terrainAt, macroAt, musicAt, roomsAt, objects: [{ at, model, x, y, z, bhv }] }) }
export function readLevel(rom, ix, folder) {
  const at = ix.execute[folder];
  if (at === undefined) throw new Error(`the base ROM has no level script entry for ${folder}`);
  const start = rom.readUInt32BE(at + 4), end = rom.readUInt32BE(at + 8);
  const entry = rom.readUInt32BE(at + 12) & 0xFFFFFF;
  const seg = Buffer.from(rom.subarray(start, end));
  const areas = new Map(), globals = [];
  let seg7 = null;
  const seen = new Set();
  const walk = (o, area, depth) => {
    for (let n = 0; n < 4000 && o + 4 <= seg.length; n++) {
      const cmd = seg[o], len = seg[o + 1];
      if (!len) return;
      const w = (k) => seg.readUInt32BE(o + k);
      if (cmd === 0x1F) { area = { index: seg[o + 2], geo: w(4) & 0xFFFFFF, objects: [], terrainAt: -1, macroAt: -1, musicAt: -1, roomsAt: -1 }; areas.set(area.index, area); }
      else if (cmd === 0x20) area = null;
      else if (cmd === 0x24 && area) area.objects.push({ at: o, model: seg[o + 3], x: seg.readInt16BE(o + 4), y: seg.readInt16BE(o + 6), z: seg.readInt16BE(o + 8), bhv: w(20) });
      else if (cmd === 0x2E && area) area.terrainAt = o;
      else if (cmd === 0x39 && area) area.macroAt = o;
      else if (cmd === 0x2F && area) area.roomsAt = o;
      else if (cmd === 0x36 && area) area.musicAt = o;
      else if (cmd === 0x18 && seg[o + 3] === 0x07) seg7 = [w(4), w(8)];
      else if (cmd === 0x06) {
        const t = w(4);
        if ((t >>> 24) === 0x0E && !seen.has(`${t}:${area?.index}`)) { seen.add(`${t}:${area?.index}`); walk(t & 0xFFFFFF, area, depth + 1); } else globals.push(t);
      } else if ((cmd === 0x07 && depth > 0) || cmd === 0x02 || cmd === 0x01) return;
      o += len;
    }
  };
  walk(entry, null, 0);
  return { seg, entry, seg7, globals, areas };
}

// The display lists an area's geo layout (in seg, the level's segment 0x0E) draws with
// GEO_DISPLAY_LIST, in the order the game builds them: { order: [addr] (each once), at: Map(addr ->
// [command offsets]) }, or null when the layout branches out of its segment.
export function geoDisplayLists(seg, from) {
  const order = [], at = new Map(), stack = [];
  const size = (c, p) => {
    switch (c) {
      case 0x08: case 0x13: case 0x1C: return 12;
      case 0x0F: return 20;
      case 0x1F: return 16;
      case 0x0A: return p ? 12 : 8;
      case 0x10: return [16, 8, 8, 4][(p >> 4) & 7] + (p & 0x80 ? 4 : 0);
      case 0x11: case 0x12: case 0x14: case 0x1D: return 8 + (p & 0x80 ? 4 : 0);
      case 0x00: case 0x02: case 0x0D: case 0x0E: case 0x15: case 0x16: case 0x18: case 0x19: case 0x1A: case 0x1E: return 8;
      default: return 4;
    }
  };
  let o = from;
  for (let guard = 0; guard < 100000; guard++) {
    if (o < 0 || o + 4 > seg.length) return null;
    const c = seg[o], p = seg[o + 1];
    if (c === 0x00 || c === 0x02) {
      const t = seg.readUInt32BE(o + 4);
      if ((t >>> 24) !== 0x0E) return null;
      if (c === 0x00 || p === 1) stack.push(o + 8);
      o = t & 0xFFFFFF;
      continue;
    }
    if (c === 0x01 || c === 0x03) {
      if (!stack.length) break;
      o = stack.pop();
      continue;
    }
    if (c === 0x15) {
      const addr = seg.readUInt32BE(o + 4);
      if (addr) {
        if (!at.has(addr)) { at.set(addr, []); order.push(addr); }
        at.get(addr).push(o);
      }
    }
    o += size(c, p);
  }
  return { order, at };
}

// A display list flattened as the engine's sculpting reads it (engine/src/studio/world.c, parse_dl):
// its commands other than vertices, triangles, calls and culling, in order, as 8-byte words.
// read(addr) -> { buf, at } for a segmented address, or null.
export function flatDisplayList(read, addr, depth = 0, out = []) {
  const r = read(addr);
  if (!r || depth > 10) return null;
  for (let o = r.at; o + 8 <= r.buf.length; o += 8) {
    const op = r.buf[o];
    if (op === 0x01 || op === 0x05 || op === 0x06 || op === 0x03) continue; // G_VTX, G_TRI1, G_TRI2, G_CULLDL
    if (op === 0xDE) { // G_DL
      if (!flatDisplayList(read, r.buf.readUInt32BE(o + 4), depth + 1, out)) return null;
      if (r.buf[o + 1] === 1) return out; // G_DL_NOPUSH: a branch
      continue;
    }
    if (op === 0xDF) return out; // G_ENDDL
    out.push(r.buf.subarray(o, o + 8));
  }
  return null;
}

// The level's segment 7 (compressed level data), decompressed.
export function levelData(rom, level) {
  if (!level.seg7) return null;
  return mio0(rom.subarray(level.seg7[0], level.seg7[1]));
}

// Collision data at a segment 7 address -> { verts: [[x, y, z]], groups: [{ type, tris: [[a, b, c, force?]] }],
//   specials: [{ preset, shorts: [...] }], env: [[id, x1, z1, x2, z2, y]] }
export function readCollision(data, addr, pre) {
  let o = addr & 0xFFFFFF;
  const r = () => { const v = data.readInt16BE(o); o += 2; return v; };
  const col = { verts: [], groups: [], specials: [], env: [] };
  const HAS_FORCE = new Set([0x0004, 0x000E, 0x0024, 0x0025, 0x0027, 0x002C, 0x002D]);
  for (let guard = 0; guard < 100000; guard++) {
    const t = r() & 0xFFFF;
    if (t === 0x40) { const n = r(); for (let i = 0; i < n; i++) col.verts.push([r(), r(), r()]); }
    else if (t === 0x41) continue;
    else if (t === 0x42) break;
    else if (t === 0x43) {
      const n = r();
      for (let i = 0; i < n; i++) {
        const preset = r() & 0xFF;
        const sp = pre.special.get(preset);
        const shorts = [r(), r(), r()];
        for (let k = 0; k < (SPECIAL_EXTRA[sp?.type] ?? 0); k++) shorts.push(r());
        col.specials.push({ preset, behavior: sp?.behavior, shorts });
      }
    } else if (t === 0x44) { const n = r(); for (let i = 0; i < n; i++) col.env.push([r(), r(), r(), r(), r(), r()]); }
    else {
      const n = r();
      const tris = [];
      for (let i = 0; i < n; i++) { const tri = [r(), r(), r()]; if (HAS_FORCE.has(t)) tri.push(r()); tris.push(tri); }
      col.groups.push({ type: t, tris });
    }
  }
  return col;
}

// Macro objects at a segment 7 address -> [{ shorts: [presetYaw, x, y, z, param], behavior }]
export function readMacros(data, addr, pre) {
  let o = addr & 0xFFFFFF;
  const list = [];
  for (let guard = 0; guard < 2000; guard++) {
    const head = data.readUInt16BE(o);
    if (head === 0x001E) break;
    const shorts = [0, 1, 2, 3, 4].map((k) => data.readInt16BE(o + k * 2));
    list.push({ shorts, behavior: pre.macro[(head & 0x1FF) - 0x1F] });
    o += 10;
  }
  return list;
}
