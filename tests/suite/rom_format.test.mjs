// ROM export data: display list, geo and level script commands encode exactly as the decomp's
// macros compile (words taken from GCC's output of gbi.h), collision and text come out as the game
// reads them, and BPS patches rebuild the target.
// @tags export smoke
// @timeout 120
import crypto from 'node:crypto';
import { suite } from '../lib/harness.mjs';
import { Segment, gfx, geo, script, vtx, lights1, executeCmd, RENDER_MODES, RM_FOG_SHADE_A } from '../../server/romexport/n64.js';
import { pass2 } from '../../server/romexport/mesh.js';
import { toN64 } from '../../server/romexport/textures.js';
import { designBook, encode as vencode, decode as vdecode } from '../../server/romexport/vadpcm.js';
import { buildCollision } from '../../server/romexport/collision.js';
import { encodeText, gameText, envOf } from '../../server/romexport/rom.js';
import { createBps, applyBps, crc32 } from '../../server/romexport/bps.js';
import { geoDisplayLists, flatDisplayList } from '../../server/romexport/vanilla.js';
import { parseDump } from '../../server/romexport/dump.js';

const words = (buf) => Array.from({ length: buf.length / 4 }, (_, i) => buf.readUInt32BE(i * 4).toString(16).padStart(8, '0')).join(' ');

await suite('ROM data format', async (t) => {
  // ---- display lists: each against the words of the macro compiled by mips64-elf-gcc -------------
  const one = (fn) => { const s = new Segment(0x0E); s.label('x'); fn(s); s.label('vtx'); s.label('tex'); s.label('lt'); return words(s.done()); };
  // (labels sit at the end: their segmented addresses are 0x0E000000 + the commands' length)
  t.eq('gsSPVertex(v + 4, 30, 0)', one((s) => gfx.vertex(s, 'vtx', 4, 30, 0)), '0101e03c 0e000048');
  t.eq('gsSP1Triangle(1, 2, 3, 0)', one((s) => gfx.tri1(s, 1, 2, 3)), '05020406 00000000');
  t.eq('gsSP2Triangles(1, 2, 3, 0, 4, 5, 29, 0)', one((s) => gfx.tri2(s, 1, 2, 3, 4, 5, 29)), '06020406 00080a3a');
  t.eq('gsSPTexture(0xFFFF, 0xFFFF, 0, 0, G_ON)', one((s) => gfx.texture(s, 0xFFFF, 0xFFFF, 0, 0, 1)), 'd7000002 ffffffff');
  t.eq('gsSPClearGeometryMode(cull, lighting, texgen)', one((s) => gfx.geometryMode(s, 0x200 | 0x400 | 0x20000 | 0x40000 | 0x80000, 0)), 'd9f1f9ff 00000000');
  t.eq('gsSPSetGeometryMode(G_LIGHTING | G_CULL_BACK)', one((s) => gfx.geometryMode(s, 0, 0x20000 | 0x400)), 'd9ffffff 00020400');
  t.eq('gsSPSetLights1(lt)', one((s) => gfx.lights1(s, 'lt')), 'db020000 00000018 dc08060a 0e000020 dc08090a 0e000018');
  t.eq('gsDPSetPrimColor(0, 0, 1, 2, 3, 4)', one((s) => gfx.primColor(s, 0, 0, [1, 2, 3, 4])), 'fa000000 01020304');
  t.eq('gsDPSetEnvColor(5, 6, 7, 8)', one((s) => gfx.envColor(s, [5, 6, 7, 8])), 'fb000000 05060708');
  t.eq('gsDPLoadTextureBlock(tex, RGBA, 16b, 64, 32, 0, CLAMP, MIRROR, 6, 5)', one((s) => gfx.loadTextureBlock16(s, 'tex', 64, 32, 2, 1, 6, 5)),
    'fd100000 0e000038 f5100000 07054260 e6000000 00000000 f3000000 077ff080 e7000000 00000000 f5102000 00054260 f2000000 000fc07c');
  t.eq('gsDPSetCombineMode(G_CC_SHADE, G_CC_SHADE)', one((s) => gfx.combineShade(s)), 'fcffffff fffe793c');
  t.eq('gsSPEndDisplayList()', one((s) => gfx.end(s)), 'df000000 00000000');
  t.eq('gdSPDefLights1(0x66, 0x66, 0x66, 0xFF, 0xFF, 0xFF, 0x28, 0x28, 0x28)', one((s) => lights1(s, [0x66, 0x66, 0x66], [0xFF, 0xFF, 0xFF], [0x28, 0x28, 0x28])),
    '66666600 66666600 ffffff00 ffffff00 28282800 00000000');
  t.eq('Vtx {{-5, 6, 7}, 0, {100, -200}, {1, 2, 3, 255}}', one((s) => vtx(s, -5, 6, 7, 100, -200, [1, 2, 3, 255])), 'fffb0006 00070000 0064ff38 010203ff');

  // ---- geo layouts and level scripts (CMD_BBH / CMD_HH words of the macros) ----------------------
  t.eq('GEO_CAMERA(1, 0, 2000, 6000, 3072, 0, -4608, fn)', one((s) => geo.camera(s, 1, 0, 2000, 6000, 3072, 0, -4608, 0x8010fa64)), '0f000001 000007d0 17700c00 0000ee00 8010fa64');
  t.eq('GEO_CAMERA_FRUSTUM_WITH_FUNC(45, 100, 32000, fn)', one((s) => geo.frustumWithFunc(s, 45, 100, 32000, 0x80120488)), '0a01002d 00647d00 80120488');
  t.eq('GEO_TRANSLATE_NODE(LAYER_OPAQUE, -2048, 31, 4096)', one((s) => geo.translate(s, 1, -2048, 31, 4096)), '1101f800 001f1000');
  t.eq('GEO_RENDER_RANGE(-1500, 32000)', one((s) => geo.renderRange(s, -1500, 32000)), '0d000000 fa247d00');
  t.eq('OBJECT(MODEL_STAR, 1, -2, 3, 0, 180, 359, 0x01020304, bhv)', one((s) => script.object(s, 0x7A, 1, -2, 3, 0, 180, 359, 0x01020304, 0x13001234)),
    '24181f7a 0001fffe 00030000 00b40167 01020304 13001234');
  t.eq('WARP_NODE(0x0A, LEVEL_BOB, 1, 0x0A, WARP_NO_CHECKPOINT)', one((s) => script.warpNode(s, 0x0A, 9, 1, 0x0A, 0)), '26080a09 010a0000');
  t.eq('MARIO_POS(1, 180, 0, 487, 2450)', one((s) => script.marioPos(s, 1, 180, 0, 487, 2450)), '2b0c0100 00b40000 01e70992');
  t.eq('EXECUTE(0x0E, start, end, entry)', words(executeCmd(0x0E, 0x01001000, 0x01126610, 0x0E1250B4)), '0010000e 01001000 01126610 0e1250b4');
  const r = new Segment(0x0E); r.u32(0); r.align(8).label('here'); r.ref('here', 4);
  t.eq('segment references and alignment', words(r.done()), '00000000 00000000 0e00000c');

  // ---- collision: vertices welded, groups, the death plane, water ----------------------------------
  const dump = {
    collision: [
      { v: [0, 0, 0, 0, 0, 100, 100, 0, 0], type: 0, force: 0 },
      { v: [100, 0, 0, 0, 0, 100, 100, 0, 100], type: 0, force: 0 },
      { v: [0, 0, 0, 0, 50, 0, 0, 0, 0], type: 0, force: 0 }, // degenerate
      { v: [0, 0, 0, 0, 0, 100, 100, 0, 0], type: 0x0E, force: 0x1234 }, // with a force
      { v: [0, 0, 0, 0, 0, 100, 100, 0, 0], type: 0x50, force: 0 }, // a command number as a type
    ],
    water: [{ id: 0, x1: -10, z1: -10, x2: 10, z2: 10, y: -5 }],
  };
  const cs = new Segment(0x0E);
  const st = buildCollision(cs, dump, 'col', { deathY: -2000 });
  const col = cs.done();
  const s16 = (i) => col.readInt16BE(i * 2);
  t.eq('collision stats', JSON.stringify(st), JSON.stringify({ verts: 9, tris: 6, water: 1, deathPlane: -2000, drawnTris: 5 }));
  t.eq('starts with the vertices', [s16(0), s16(1)].join(), '64,9');
  const after = 2 + 9 * 3;
  t.eq('first group: 3 default triangles (the command-number type became default)', [s16(after), s16(after + 1)].join(), '0,3');
  t.eq('the force group keeps its force', [s16(after + 2 + 9), s16(after + 2 + 10), s16(after + 2 + 14)].join(), `14,1,${0x1234}`);
  t.eq('ends with the water box and the end', Array.from({ length: 10 }, (_, i) => s16(col.length / 2 - 10 + i)).join(), '65,68,1,0,-10,-10,10,10,-5,66');

  // ---- text in the game's characters ---------------------------------------------------------------
  t.eq('gameText', gameText('Café Héllo: «World»_2!'), 'CAFE HELLO: WORLD 2!');
  t.eq('encodeText', encodeText(' 1 BOB-OMB', 12).toString('hex'), '9e019e0b180b9f18160bffff');
  const env = envOf({ weather: 'snow', camera: { mode: 'open' }, light: { color: '#ff8000', ambient: 0.5, yaw: 0, pitch: 90 } });
  t.eq('environment', JSON.stringify(env), JSON.stringify({ lights: [[128, 64, 0], [255, 128, 0], [0, 120, 0]], fog: null, tint: null, envfx: 1, camera: 16 }));
  const tinted = envOf({ light: { color: '#ffffff', tint: '#80ff00', ambient: 1 } });
  t.eq('a tint colours the sun', JSON.stringify(tinted.lights.slice(0, 2)), JSON.stringify([[128, 255, 0], [128, 255, 0]]));
  const fog = envOf({ fog: { on: true, color: '#0a141e', near: 800, far: 5000 } }).fog;
  t.check('fog: its colour, positions on the depth scale', fog.color.join() === '10,20,30' && fog.min > 880 && fog.min < fog.max && fog.max < 1000, JSON.stringify(fog));

  // ---- fog commands: against the compiled macros ------------------------------------------------------
  t.eq('gsSPFogPosition(960, 1000)', one((s) => gfx.fogPosition(s, 960, 1000)), 'db080000 0c80f480');
  t.eq('gsDPSetFogColor(10, 20, 30, 255)', one((s) => gfx.fogColor(s, [10, 20, 30])), 'f8000000 0a141eff');
  t.eq('gsDPSetCycleType(G_CYC_2CYCLE)', one((s) => gfx.cycleType(s, true)), 'e3000a01 00100000');
  t.eq('gsDPSetCycleType(G_CYC_1CYCLE)', one((s) => gfx.cycleType(s, false)), 'e3000a01 00000000');
  t.eq('gsDPSetRenderMode(G_RM_FOG_SHADE_A, G_RM_AA_ZB_OPA_SURF2)', one((s) => gfx.renderMode(s, RM_FOG_SHADE_A, RENDER_MODES[1][1])), 'e200001c c8112078');
  t.eq('gsDPSetRenderMode(G_RM_AA_ZB_OPA_SURF, G_RM_AA_ZB_OPA_SURF2)', one((s) => gfx.renderMode(s, ...RENDER_MODES[1])), 'e200001c 00552078');
  // ---- textures with a palette: against the compiled macros --------------------------------------------
  t.eq('gsDPLoadTLUT_pal256(tex)', one((s) => gfx.loadTlut(s, 'tex', 256)).replace(/0e00[0-9a-f]{4}/, 'ADDR'),
    'fd100000 ADDR e8000000 00000000 f5000100 07000000 e6000000 00000000 f0000000 073fc000 e7000000 00000000');
  t.eq('gsDPLoadTLUT_pal16(0, tex)', one((s) => gfx.loadTlut(s, 'tex', 16)).replace(/0e00[0-9a-f]{4}/, 'ADDR'),
    'fd100000 ADDR e8000000 00000000 f5000100 07000000 e6000000 00000000 f0000000 0703c000 e7000000 00000000');
  t.eq('gsDPLoadTextureBlock(tex, CI, 8b, 32, 64, 0, CLAMP, MIRROR, 5, 6)', one((s) => gfx.loadTextureBlockCI(s, 'tex', 32, 64, 8, 2, 1, 5, 6)).replace(/0e00[0-9a-f]{4}/, 'ADDR'),
    'fd500000 ADDR f5500000 07058250 e6000000 00000000 f3000000 073ff200 e7000000 00000000 f5480800 00058250 f2000000 0007c0fc');
  t.eq('gsDPLoadTextureBlock_4b(tex, CI, 32, 64, 0, WRAP, WRAP, 5, 6)', one((s) => gfx.loadTextureBlockCI(s, 'tex', 32, 64, 4, 0, 0, 5, 6)).replace(/0e00[0-9a-f]{4}/, 'ADDR'),
    'fd500000 ADDR f5500000 07018050 e6000000 00000000 f3000000 071ff400 e7000000 00000000 f5400400 00018050 f2000000 0007c0fc');
  t.eq('gsDPLoadTextureBlock_4b(tex, CI, 64, 16, ...)', one((s) => gfx.loadTextureBlockCI(s, 'tex', 64, 16, 4, 0, 0, 6, 4)).replace(/0e00[0-9a-f]{4}/, 'ADDR'),
    'fd500000 ADDR f5500000 07010060 e6000000 00000000 f3000000 070ff200 e7000000 00000000 f5400800 00010060 f2000000 000fc03c');
  t.eq('gsDPLoadTextureBlock(tex, CI, 8b, 16, 64, ...)', one((s) => gfx.loadTextureBlockCI(s, 'tex', 16, 64, 8, 0, 0, 4, 6)).replace(/0e00[0-9a-f]{4}/, 'ADDR'),
    'fd500000 ADDR f5500000 07018040 e6000000 00000000 f3000000 071ff400 e7000000 00000000 f5480400 00018040 f2000000 0003c0fc');
  t.eq('gsDPSetTextureLUT(G_TT_RGBA16), (G_TT_NONE)', one((s) => { gfx.textureLut(s, true); gfx.textureLut(s, false); }), 'e3001001 00008000 e3001001 00000000');
  const few = toN64({ w: 4, h: 4, rgba: Buffer.from(Array.from({ length: 16 }, (_, i) => [i * 16, 0, 0, 255]).flat()) });
  t.eq('16 colours: CI4 with their palette', [few.fmt, few.bytes.length, few.palette.length, few.bytes[0].toString(16)].join(), 'ci4,8,32,1');
  t.eq('the palette holds the RGBA16 colours', few.palette.readUInt16BE(2).toString(16), ((16 >> 3) << 11 | 1).toString(16));
  // ---- sound effects: the N64's sample format (VADPCM), round trip -------------------------------------
  const tone = new Int16Array(4000).map((_, i) => Math.round(Math.sin(i * 0.17) * 15000));
  const book = designBook(tone), frames = vencode(tone, book), back = vdecode(frames, book, tone.length);
  let sig = 0, err = 0;
  for (let i = 0; i < tone.length; i++) { sig += tone[i] ** 2; err += (tone[i] - back[i]) ** 2; }
  t.eq('VADPCM: 9 bytes per 16 samples, two predictors of order 2', [frames.length, book.length].join(), `${Math.ceil(4000 / 16) * 9},32`);
  t.check('VADPCM: a tone comes back clean (above 30 dB)', 10 * Math.log10(sig / err) > 30, 10 * Math.log10(sig / err));
  t.check('VADPCM: silence is silence', vdecode(vencode(new Int16Array(64), designBook(new Int16Array(64))), designBook(new Int16Array(64)), 64).every((x) => x === 0));
  t.eq('gsSPClearGeometryMode(G_FOG)', one((s) => gfx.geometryMode(s, 0x10000, 0)), 'd9feffff 00000000');
  t.eq('G_CC_MODULATERGB, G_CC_MODULATERGB -> G_CC_MODULATERGB, G_CC_PASS2', pass2([0xfc127e24, 0xfffff9fc]).map((w) => w.toString(16)).join(' '), 'fc127fff fffff838');

  // ---- sculpted original levels: their display lists found and flattened as the engine reads them ----
  const g = new Segment(0x0E);
  geo.start(g); geo.open(g);
  g.bbh(0x15, 1, 0).u32(0x07001000);                         // GEO_DISPLAY_LIST
  g.u32(0x02010000).ref('sub');                               // GEO_BRANCH(1, sub)
  g.bbh(0x10, 0x10 | 0x80 | 1, 5).hh(6, 7).u32(0x07003000);   // GEO_TRANSLATE_WITH_DL: no display list node
  g.bbh(0x15, 4, 0).u32(0x07001000);                         // the same list again
  geo.close(g); geo.end(g);
  g.label('sub').bbh(0x15, 1, 0).u32(0x07002000).bbh(0x03, 0, 0);
  const found = geoDisplayLists(g.done(), 0);
  t.eq('geo layout: its display lists in build order, each once', found.order.map((a) => a.toString(16)).join(), '7001000,7002000');
  t.eq('geo layout: every node that draws one', found.at.get(0x07001000).length, 2);
  const dl = Buffer.alloc(0x60);
  [[0x00, 0xE7000000, 0], [0x08, 0x03000000, 0x1E], [0x10, 0xDE000000, 0x07000040], [0x18, 0x01004008, 0x07000060],
    [0x20, 0x06000204, 0x00060402], [0x28, 0xD7000002, 0xFFFFFFFF], [0x30, 0xDF000000, 0],
    [0x40, 0xFCFFFFFF, 0xFFFE793C], [0x48, 0x05000204, 0], [0x50, 0xDF000000, 0]].forEach(([o, w0, w1]) => { dl.writeUInt32BE(w0 >>> 0, o); dl.writeUInt32BE(w1 >>> 0, o + 4); });
  const flat = flatDisplayList((a) => ((a >>> 24) === 7 ? { buf: dl, at: a & 0xFFFFFF } : null), 0x07000000);
  t.eq('display list flattened as the engine sculpts it (calls followed, vertices and triangles left out)',
    flat.map((c) => c.toString('hex')).join(' '), 'e700000000000000 fcfffffffffe793c d7000002ffffffff');
  const le = (...v) => Buffer.concat(v.map((x) => { const b = Buffer.alloc(4); b.writeInt32LE(x); return b; }));
  const s16le = (...v) => Buffer.concat(v.map((x) => { const b = Buffer.alloc(2); b.writeInt16LE(x); return b; }));
  const sculpted = parseDump(Buffer.concat([Buffer.from('S64D'), le(3, 0, 0, 0, 0, 0), le(1, 2, 5, 0, 2, 1, 3, -1, 0, -1, 1, 1, 0),
    Buffer.alloc(48, 7), le(1), s16le(1, 2, 3, 4, 5, 6, 7, 8, 9, 0x15, 0, 3), le(1)])).sculpt;
  t.eq('area dump: an original level\'s sculpted shape', JSON.stringify([sculpted.dls.map((d) => d.changed), sculpted.dls[1].cmds, sculpted.dls[1].runs[0].vtx.length, sculpted.tris[0].room, sculpted.hasRooms]),
    '[[false,true],[-1,0,-1],48,3,true]');

  // ---- BPS: edits, moved blocks, padding --------------------------------------------------------------
  const src = crypto.randomBytes(1 << 20);
  const dst = Buffer.alloc(3 << 20);
  src.copy(dst);
  for (let i = 0; i < 4000; i++) dst[(i * 7919) % src.length] ^= 0x5A;           // scattered edits
  src.copy(dst, src.length + 4096, 65536, 65536 + 200000);                          // a block from elsewhere
  dst.fill(0xFF, 2 << 20, (2 << 20) + 300000);                                       // a run
  const patch = createBps(src, dst);
  t.check('BPS rebuilds the target', applyBps(src, patch).equals(dst));
  t.check('BPS stores runs and moved blocks compactly', patch.length < 60000, patch.length);
  t.eq('BPS checksums', patch.readUInt32LE(patch.length - 12), crc32(src));
  let refused = '';
  try { applyBps(crypto.randomBytes(src.length), patch); } catch (e) { refused = e.message; }
  t.check('BPS refuses another ROM', /different ROM/.test(refused), refused);
});
