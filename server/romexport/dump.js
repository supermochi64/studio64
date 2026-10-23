// Reads the area dump the engine writes (engine/src/studio/romdump.c).

export function parseDump(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.toString('latin1', 0, 4) !== 'S64D') throw new Error('not an area dump');
  let o = 4;
  const u32 = () => { const v = b.readUInt32LE(o); o += 4; return v; };
  const i32 = () => { const v = b.readInt32LE(o); o += 4; return v; };
  const u16 = () => { const v = b.readUInt16LE(o); o += 2; return v; };
  const s16 = () => { const v = b.readInt16LE(o); o += 2; return v; };
  const u8 = () => b[o++];
  const f32 = () => { const v = b.readFloatLE(o); o += 4; return v; };

  const version = u32();
  if (version !== 2 && version !== 3) throw new Error(`unknown dump version ${version}`);

  const textures = [];
  for (let n = u32(), i = 0; i < n; i++) {
    // w x h image; texture coordinates are in texels of a tileW x tileH tile
    const w = u16(), h = u16(), tileW = u16(), tileH = u16();
    textures.push({ w, h, tileW, tileH, rgba: b.subarray(o, o + w * h * 4) });
    o += w * h * 4;
  }

  const materials = [];
  for (let n = u32(), i = 0; i < n; i++) {
    const m = { tex: i32(), combine: [u32(), u32()], geomode: u32(), othermode: [u32(), u32()] };
    m.layer = u8(); m.lit = u8(); m.cms = u8(); m.cmt = u8();
    m.prim = [u8(), u8(), u8(), u8()];
    m.env = [u8(), u8(), u8(), u8()];
    m.scaleS = u16(); m.scaleT = u16();
    materials.push(m);
  }

  const ntri = u32();
  const tris = new Array(ntri);
  for (let i = 0; i < ntri; i++) {
    const mat = u16(); u16();
    const v = [];
    for (let k = 0; k < 3; k++) {
      const x = f32(), y = f32(), z = f32(), s = f32(), t = f32();
      v.push({ x, y, z, s, t, c: [u8(), u8(), u8(), u8()] });
    }
    tris[i] = { mat, v };
  }

  const collision = [];
  for (let n = u32(), i = 0; i < n; i++) {
    const v = [s16(), s16(), s16(), s16(), s16(), s16(), s16(), s16(), s16()];
    collision.push({ v, type: s16(), force: s16(), uid: u32() });
  }

  const water = [];
  for (let n = u32(), i = 0; i < n; i++) water.push({ id: s16(), x1: s16(), z1: s16(), x2: s16(), z2: s16(), y: s16() });

  // an original level's sculpted shape (engine/src/studio/world.c, studio_sculpt_write): its display
  // lists in the area's order, the changed ones as [raw command | triangle run], and its collision
  let sculpt = null;
  if (version >= 3 && u32()) {
    sculpt = { dls: [], tris: [], hasRooms: false };
    for (let n = u32(), i = 0; i < n; i++) {
      const dl = { nraw: u32(), changed: !!u32() };
      if (dl.changed) {
        const cmds = [];
        for (let k = u32(), j = 0; j < k; j++) cmds.push(i32());
        dl.runs = [];
        for (let k = u32(), j = 0; j < k; j++) {
          const count = u32(), lit = !!u32();
          dl.runs.push({ lit, vtx: Buffer.from(b.subarray(o, o + count * 48)) });
          o += count * 48;
        }
        dl.cmds = cmds.map((c) => (c < 0 ? -1 : 0)); // runs come in command order
      }
      sculpt.dls.push(dl);
    }
    for (let n = u32(), i = 0; i < n; i++) {
      const v = [s16(), s16(), s16(), s16(), s16(), s16(), s16(), s16(), s16()];
      sculpt.tris.push({ v, type: s16(), force: s16(), room: s16() });
    }
    sculpt.hasRooms = !!u32();
  }

  return { textures, materials, tris, collision, water, sculpt };
}
