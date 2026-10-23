// Binary N64 data, as the decomp's macros would compile it: F3DEX2 display lists, geo layouts,
// level scripts and collision, written into one segment with pointers between its parts
// (tests/romexport.test.mjs checks every encoding against the macros compiled by GCC).

export class Segment {
  constructor(segment) {
    this.segment = segment;
    this.buf = Buffer.alloc(1 << 16);
    this.n = 0;
    this.labels = new Map();
    this.fixups = [];
  }
  grow(k) {
    if (this.n + k <= this.buf.length) return;
    const b = Buffer.alloc(Math.max(this.buf.length * 2, this.n + k));
    this.buf.copy(b, 0, 0, this.n);
    this.buf = b;
  }
  align(a) { this.grow(a); while (this.n % a) this.buf[this.n++] = 0; return this; }
  label(name) {
    if (this.labels.has(name)) throw new Error(`label ${name} twice`);
    this.labels.set(name, this.n);
    return this;
  }
  u8(v) { this.grow(1); this.buf[this.n++] = v & 0xFF; return this; }
  u16(v) { this.grow(2); this.buf.writeUInt16BE(v & 0xFFFF, this.n); this.n += 2; return this; }
  s16(v) { this.grow(2); this.buf.writeInt16BE(Math.max(-32768, Math.min(32767, Math.round(v))), this.n); this.n += 2; return this; }
  u32(v) { this.grow(4); this.buf.writeUInt32BE(v >>> 0, this.n); this.n += 4; return this; }
  bytes(b) { this.grow(b.length); b.copy(this.buf, this.n); this.n += b.length; return this; }
  // the segmented address of a label (+ add bytes), filled in by done()
  ref(name, add = 0) { this.fixups.push({ at: this.n, name, add }); return this.u32(0); }
  // the same into a word written before (patching data copied in with bytes())
  refAt(at, name, add = 0) { this.fixups.push({ at, name, add }); return this; }
  put32(at, v) { this.buf.writeUInt32BE(v >>> 0, at); return this; }
  // command words: CMD_BBBB, CMD_BBH, CMD_HH
  bbbb(a, b, c, d) { return this.u32(((a & 0xFF) << 24) | ((b & 0xFF) << 16) | ((c & 0xFF) << 8) | (d & 0xFF)); }
  bbh(a, b, c) { return this.u32(((a & 0xFF) << 24) | ((b & 0xFF) << 16) | (c & 0xFFFF)); }
  hh(a, b) { return this.u32(((a & 0xFFFF) << 16) | (b & 0xFFFF)); }
  address(name) {
    if (!this.labels.has(name)) throw new Error(`no label ${name}`);
    return ((this.segment << 24) | this.labels.get(name)) >>> 0;
  }
  done() {
    for (const f of this.fixups) this.buf.writeUInt32BE((this.address(f.name) + f.add) >>> 0, f.at);
    return Buffer.from(this.buf.subarray(0, this.n));
  }
}

// ---- display lists (F3DEX2) ------------------------------------------------------------------
export const G = {
  ZBUFFER: 0x1, SHADE: 0x4, CULL_FRONT: 0x200, CULL_BACK: 0x400, FOG: 0x10000,
  LIGHTING: 0x20000, TEXTURE_GEN: 0x40000, TEXTURE_GEN_LINEAR: 0x80000, SHADING_SMOOTH: 0x200000,
};
const IM_FMT_RGBA = 0, IM_FMT_CI = 2, IM_SIZ_4b = 0, IM_SIZ_8b = 1, IM_SIZ_16b = 2, TX_LOADTILE = 7, TX_RENDERTILE = 0;
const TX_LDBLK_MAX_TXL = 2047;

export const gfx = {
  pipeSync: (s) => s.u32(0xE7000000).u32(0),
  loadSync: (s) => s.u32(0xE6000000).u32(0),
  end: (s) => s.u32(0xDF000000).u32(0),
  raw: (s, w0, w1) => s.u32(w0).u32(w1),
  geometryMode: (s, clear, set) => s.u32(0xD9000000 | (~clear & 0xFFFFFF)).u32(set),
  texture: (s, sc, tc, level, tile, on) => s.u32(0xD7000000 | ((level & 7) << 11) | ((tile & 7) << 8) | ((on & 0x7F) << 1)).u32(((sc & 0xFFFF) << 16) | (tc & 0xFFFF)),
  primColor: (s, m, l, [r, g, b, a]) => s.u32(0xFA000000 | ((m & 0xFF) << 8) | (l & 0xFF)).u32(((r << 24) | (g << 16) | (b << 8) | a) >>> 0),
  envColor: (s, [r, g, b, a]) => s.u32(0xFB000000).u32(((r << 24) | (g << 16) | (b << 8) | a) >>> 0),
  // gsSPSetLights1(lights): the number of lights, the light, the ambient colour
  lights1: (s, name) => s.u32(0xDB020000).u32(0x18).u32(0xDC08060A).ref(name, 8).u32(0xDC08090A).ref(name, 0),
  vertex: (s, name, start, n, v0 = 0) => s.u32(0x01000000 | ((n & 0xFF) << 12) | (((v0 + n) & 0x7F) << 1)).ref(name, start * 16),
  tri1: (s, a, b, c) => s.u32(0x05000000 | (a * 2 << 16) | (b * 2 << 8) | (c * 2)).u32(0),
  tri2: (s, a, b, c, d, e, f) => s.u32(0x06000000 | (a * 2 << 16) | (b * 2 << 8) | (c * 2)).u32((d * 2 << 16) | (e * 2 << 8) | (f * 2)),
  setTile: (s, fmt, siz, line, tmem, tile, pal, cmt, maskt, shiftt, cms, masks, shifts) => s
    .u32(0xF5000000 | ((fmt & 7) << 21) | ((siz & 3) << 19) | ((line & 0x1FF) << 9) | (tmem & 0x1FF))
    .u32(((tile & 7) << 24) | ((pal & 0xF) << 20) | ((cmt & 3) << 18) | ((maskt & 0xF) << 14) | ((shiftt & 0xF) << 10) | ((cms & 3) << 8) | ((masks & 0xF) << 4) | (shifts & 0xF)),
  // gsDPLoadTextureBlock for an RGBA16 w x h texture
  loadTextureBlock16(s, name, w, h, cms, cmt, masks, maskt) {
    const words = Math.max(1, (w * 2) / 8);
    const dxt = Math.floor(((1 << 11) + words - 1) / words);
    s.u32(0xFD000000 | (IM_FMT_RGBA << 21) | (IM_SIZ_16b << 19)).ref(name);
    gfx.setTile(s, IM_FMT_RGBA, IM_SIZ_16b, 0, 0, TX_LOADTILE, 0, cmt, maskt, 0, cms, masks, 0);
    gfx.loadSync(s);
    s.u32(0xF3000000).u32((TX_LOADTILE << 24) | (Math.min(w * h - 1, TX_LDBLK_MAX_TXL) << 12) | (dxt & 0xFFF));
    gfx.pipeSync(s);
    gfx.setTile(s, IM_FMT_RGBA, IM_SIZ_16b, ((w * 2) + 7) >> 3, 0, TX_RENDERTILE, 0, cmt, maskt, 0, cms, masks, 0);
    s.u32(0xF2000000).u32((TX_RENDERTILE << 24) | (((w - 1) << 2) << 12) | ((h - 1) << 2));
  },
  // gsDPLoadTextureBlock(_4b) for a CI8 or CI4 w x h texture
  loadTextureBlockCI(s, name, w, h, bits, cms, cmt, masks, maskt) {
    const words = bits === 8 ? Math.max(1, w / 8) : Math.max(1, w / 16);
    const dxt = Math.floor(((1 << 11) + words - 1) / words);
    const count = bits === 8 ? ((w * h + 1) >> 1) - 1 : ((w * h + 3) >> 2) - 1;
    s.u32(0xFD000000 | (IM_FMT_CI << 21) | (IM_SIZ_16b << 19)).ref(name);
    gfx.setTile(s, IM_FMT_CI, IM_SIZ_16b, 0, 0, TX_LOADTILE, 0, cmt, maskt, 0, cms, masks, 0);
    gfx.loadSync(s);
    s.u32(0xF3000000).u32((TX_LOADTILE << 24) | (Math.min(count, TX_LDBLK_MAX_TXL) << 12) | (dxt & 0xFFF));
    gfx.pipeSync(s);
    const line = bits === 8 ? (w + 7) >> 3 : ((w >> 1) + 7) >> 3;
    gfx.setTile(s, IM_FMT_CI, bits === 8 ? IM_SIZ_8b : IM_SIZ_4b, line, 0, TX_RENDERTILE, 0, cmt, maskt, 0, cms, masks, 0);
    s.u32(0xF2000000).u32((TX_RENDERTILE << 24) | (((w - 1) << 2) << 12) | ((h - 1) << 2));
  },
  // gsDPLoadTLUT_pal256 / gsDPLoadTLUT_pal16(0, ...): the palette (RGBA16) into the top of TMEM
  loadTlut(s, name, colors) {
    s.u32(0xFD000000 | (IM_FMT_RGBA << 21) | (IM_SIZ_16b << 19)).ref(name);
    s.u32(0xE8000000).u32(0); // tile sync
    gfx.setTile(s, IM_FMT_RGBA, 0, 0, 256, TX_LOADTILE, 0, 0, 0, 0, 0, 0, 0);
    gfx.loadSync(s);
    s.u32(0xF0000000).u32((TX_LOADTILE << 24) | ((colors - 1) << 14));
    gfx.pipeSync(s);
  },
  textureLut: (s, rgba16) => s.u32(0xE3001001).u32(rgba16 ? 0x8000 : 0), // gsDPSetTextureLUT(G_TT_RGBA16 / G_TT_NONE)
  combineShade: (s) => s.u32(0xFCFFFFFF).u32(0xFFFE793C), // gsDPSetCombineMode(G_CC_SHADE, G_CC_SHADE)
  cycleType: (s, two) => s.u32(0xE3000A01).u32(two ? 0x00100000 : 0),
  renderMode: (s, c0, c1) => s.u32(0xE200001C).u32((c0 | c1) >>> 0),
  fogColor: (s, [r, g, b]) => s.u32(0xF8000000).u32(((r << 24) | (g << 16) | (b << 8) | 0xFF) >>> 0),
  // gsSPFogPosition with fractional positions (0..1000 between the near and far plane)
  fogPosition(s, min, max) {
    const fm = Math.round(128000 / (max - min)), fo = Math.round(((500 - min) * 256) / (max - min));
    return s.u32(0xDB080000).u32(((fm & 0xFFFF) << 16) | (fo & 0xFFFF));
  },
};

// the game's render modes per layer (rendering_graph_node.c, z-buffered): [first cycle, second cycle]
export const RENDER_MODES = [
  [0x00442230, 0x00112230], [0x00442078, 0x00112078], [0x00442D58, 0x00112D58], [0x00442478, 0x00112478],
  [0x00443078, 0x00113078], [0x004049D8, 0x001049D8], [0x00404DD8, 0x00104DD8], [0x004045D8, 0x001045D8],
];
export const RM_FOG_SHADE_A = 0xC8000000;

// Vtx: position, flag, texture coordinates, colour (or normal)
export function vtx(s, x, y, z, ts, tt, c) {
  s.s16(x).s16(y).s16(z).u16(0).s16(ts).s16(tt);
  for (const v of c) s.u8(v);
}

// gdSPDefLights1(ambient, colour, direction)
export function lights1(s, [ar, ag, ab], [r, g, b], [x, y, z]) {
  s.align(8);
  s.u8(ar).u8(ag).u8(ab).u8(0).u8(ar).u8(ag).u8(ab).u8(0);
  s.u8(r).u8(g).u8(b).u8(0).u8(r).u8(g).u8(b).u8(0);
  s.u8(x).u8(y).u8(z).u8(0).u32(0);
}

// ---- geo layouts -----------------------------------------------------------------------------
export const geo = {
  end: (s) => s.bbh(0x01, 0, 0),
  start: (s) => s.bbh(0x0B, 0, 0),
  open: (s) => s.bbh(0x04, 0, 0),
  close: (s) => s.bbh(0x05, 0, 0),
  screenArea: (s, n, x, y, w, h) => s.bbh(0x08, 0, n).hh(x, y).hh(w, h),
  ortho: (s, scale) => s.bbh(0x09, 0, scale),
  frustumWithFunc: (s, fov, near, far, fn) => s.bbh(0x0A, 1, fov).hh(near, far).u32(fn),
  zbuffer: (s, on) => s.bbh(0x0C, on, 0),
  renderRange: (s, min, max) => s.bbh(0x0D, 0, 0).hh(min, max),
  camera: (s, type, x1, y1, z1, x2, y2, z2, fn) => s.bbh(0x0F, 0, type).hh(x1, y1).hh(z1, x2).hh(y2, z2).u32(fn),
  translate: (s, layer, x, y, z) => s.bbh(0x11, layer, x).hh(y, z),
  displayList: (s, layer, name) => s.bbh(0x15, layer, 0).ref(name),
  renderObj: (s) => s.bbh(0x17, 0, 0),
  asm: (s, param, fn) => s.bbh(0x18, 0, param).u32(fn),
  background: (s, bg, fn) => s.bbh(0x19, 0, bg).u32(fn),
};

// ---- level scripts ---------------------------------------------------------------------------
export const script = {
  exit: (s) => s.bbh(0x02, 0x04, 0),
  sleepBeforeExit: (s, frames) => s.bbh(0x04, 0x04, frames),
  jumpLink: (s, target) => s.bbh(0x06, 0x08, 0).u32(target),
  jumpLinkRef: (s, name) => s.bbh(0x06, 0x08, 0).ref(name),
  return: (s) => s.bbh(0x07, 0x04, 0),
  call: (s, arg, fn) => s.bbh(0x11, 0x08, arg).u32(fn),
  jump: (s, addr) => s.bbh(0x05, 0x08, 0).u32(addr),
  callLoop: (s, arg, fn) => s.bbh(0x12, 0x08, arg).u32(fn),
  loadRaw: (s, seg, start, end) => s.bbh(0x17, 0x0C, seg).u32(start).u32(end),
  loadMio0: (s, seg, start, end) => s.bbh(0x18, 0x0C, seg).u32(start).u32(end),
  loadMio0Texture: (s, seg, start, end) => s.bbh(0x1A, 0x0C, seg).u32(start).u32(end),
  initLevel: (s) => s.bbh(0x1B, 0x04, 0),
  clearLevel: (s) => s.bbh(0x1C, 0x04, 0),
  allocLevelPool: (s) => s.bbh(0x1D, 0x04, 0),
  freeLevelPool: (s) => s.bbh(0x1E, 0x04, 0),
  area: (s, index, geoName) => s.bbbb(0x1F, 0x08, index, 0).ref(geoName),
  endArea: (s) => s.bbh(0x20, 0x04, 0),
  loadModelFromGeo: (s, model, geoAddr) => s.bbh(0x22, 0x08, model).u32(geoAddr),
  // angles in degrees, as in the decomp's OBJECT()
  object: (s, model, x, y, z, ax, ay, az, bparams, bhv, acts = 0x1F) => s.bbbb(0x24, 0x18, acts, model).hh(x, y).hh(z, ax).hh(ay, az).u32(bparams).u32(bhv),
  mario: (s, model, arg, bhv) => s.bbbb(0x25, 0x0C, 0, model).u32(arg).u32(bhv),
  warpNode: (s, id, level, area, node, flags) => s.bbbb(0x26, 0x08, id, level).bbbb(area, node, flags, 0),
  marioPos: (s, area, yaw, x, y, z) => s.bbbb(0x2B, 0x0C, area, 0).hh(yaw, x).hh(y, z),
  terrain: (s, name) => s.bbh(0x2E, 0x08, 0).ref(name),
  terrainType: (s, type) => s.bbh(0x31, 0x04, type),
  backgroundMusic: (s, preset, seq) => s.bbh(0x36, 0x08, preset).hh(seq, 0),
};

// the level script's EXECUTE (LOAD_AND_EXECUTE) command
export function executeCmd(seg, romStart, romEnd, entry) {
  const b = Buffer.alloc(16);
  b.writeUInt32BE((0x00 << 24 | 0x10 << 16 | seg) >>> 0, 0);
  b.writeUInt32BE(romStart >>> 0, 4);
  b.writeUInt32BE(romEnd >>> 0, 8);
  b.writeUInt32BE(entry >>> 0, 12);
  return b;
}

// ---- collision -------------------------------------------------------------------------------
export const COL = { VERTICES: 0x40, CONTINUE: 0x41, END: 0x42, ENVIRONMENT: 0x44 };
