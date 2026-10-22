#!/usr/bin/env node
// Tokyo from the Shoggoth World hack as a Studio 64 level template.
//
//   node tools/import_shoggoth_tokyo.mjs [path/to/sm64-master]      (or SHOGGOTH_DIR=...)
//
// Reads the generated level data of LEVEL_TOKYO from a Shoggoth World checkout (branch `shoggoth`,
// default ../sm64-master next to this folder; it is only read, never changed) and writes:
//
//   engine/src/studio/shoggoth/gen/        the level's display lists, collision, textures and models as
//                                          C for the engine (compiled into it: src/studio/shoggoth/),
//                                          plus catalog.json (the "tokyo:*" objects of the library)
//   engine/sound/sound_banks/26_studio_tokyo.json   the instruments of Tokyo's music (game samples only)
//   web/data/shoggoth/tokyo.json           the template: spawn, objects, stars, texts, the music (.m64)
//   web/data/shoggoth/tokyo_sky.png        the night sky (game layout, 2x: Studio 64's "sharp" sky)
//
// Everything written ships with Studio 64 (Shoggoth World is by the same author). Run it through
// tools/shoggoth/refresh.mjs (npm run shoggoth:refresh), which then takes the game's own data back out
// of the C (the dressed Toads and the oni: tools/shoggoth/split_vanilla.py).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodePNG, encodePNG, encodeTexture, incC } from './shoggoth/n64tex.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const FORCE = process.argv.includes('--force');
const SRC = path.resolve(args[0] || process.env.SHOGGOTH_DIR || path.join(ROOT, '..', 'sm64-master'));
const LV = path.join(SRC, 'levels', 'tokyo');
const GEN = path.join(ROOT, 'engine', 'src', 'studio', 'shoggoth', 'gen');
const GEN_TK = path.join(GEN, 'tokyo');
const WEB = path.join(ROOT, 'web', 'data', 'shoggoth');
const BANK_OUT = path.join(ROOT, 'engine', 'sound', 'sound_banks', '26_studio_tokyo.json');
const STAMP = path.join(GEN, 'stamp.json');
const VERSION = 7; // bump when the output format changes

const log = (...a) => console.log('[tokyo]', ...a);

if (!fs.existsSync(path.join(LV, 'model.inc.c')) || !fs.existsSync(path.join(LV, 'geo.c'))) {
  log(`no Shoggoth World Tokyo at ${SRC} (levels/tokyo): skipped, the Tokyo template stays off`);
  process.exit(0);
}

// ---- up to date? --------------------------------------------------------------------------------

const inputs = [
  ...fs.readdirSync(LV).map((f) => path.join(LV, f)),
  path.join(SRC, 'textures', 'skyboxes', 'tokyo_night.png'),
  path.join(SRC, 'sound', 'sequences', 'us', '24_custom_level_tokyo.s'),
  path.join(SRC, 'tools', 'shoggoth', 'music', 'bank.py'),
  path.join(SRC, 'text', 'us', 'shoggoth_dialogs.h'),
  path.join(SRC, 'tools', 'shoggoth', 'intro_art', 'tokyo.png'),
  path.join(SRC, 'src', 'game', 'shoggoth', 'enemies_tokyo.c'),
  path.join(SRC, 'data', 'sh_enemies_tokyo_bhv.inc.c'),
  fileURLToPath(import.meta.url),
].filter((f) => fs.existsSync(f));
const sig = crypto.createHash('sha1');
sig.update(String(VERSION));
for (const f of inputs.sort()) { const s = fs.statSync(f); sig.update(`${f}:${s.size}:${s.mtimeMs}`); }
const SIG = sig.digest('hex');
const outputsThere = [path.join(GEN, 'tokyo_data.inc.c'), path.join(WEB, 'tokyo.json'), BANK_OUT].every((f) => fs.existsSync(f));
if (!FORCE && outputsThere) {
  try { if (JSON.parse(fs.readFileSync(STAMP, 'utf8')).sig === SIG) { log('up to date'); process.exit(0); } } catch { /* rebuild */ }
}

fs.rmSync(GEN_TK, { recursive: true, force: true });
fs.mkdirSync(GEN_TK, { recursive: true });
fs.mkdirSync(WEB, { recursive: true });
const read = (f) => fs.readFileSync(f, 'utf8');
const write = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

// ---- textures -----------------------------------------------------------------------------------

let texCount = 0;
for (const f of fs.readdirSync(LV)) {
  if (f.endsWith('.png')) {
    const fmt = f.split('.').slice(-2)[0];
    if (!/^(rgba16|rgba32|ia16|ia8|ia4|i8|i4)$/.test(fmt)) continue;
    write(path.join(GEN_TK, f.replace(/\.png$/, '.inc.c')), incC(encodeTexture(decodePNG(fs.readFileSync(path.join(LV, f))), fmt)));
    texCount++;
  } else if (/\.(ci4|ci8)(\.pal)?\.inc\.c$|\.(rgba16|ia8|i4|ia4|i8|ia16|rgba32)\.inc\.c$/.test(f)) {
    fs.copyFileSync(path.join(LV, f), path.join(GEN_TK, f));
    texCount++;
  }
}
const local = (s) => s.replace(/#include "levels\/tokyo\//g, '#include "');
write(path.join(GEN_TK, 'texture.inc.c'), local(read(path.join(LV, 'texture.inc.c'))));
log(`${texCount} textures`);

// ---- display lists, collision, models -----------------------------------------------------------

write(path.join(GEN_TK, 'model.inc.c'), local(read(path.join(LV, 'model.inc.c'))));
write(path.join(GEN_TK, 'header.h'), read(path.join(LV, 'header.h')).replace(/TOKYO_HEADER_H/g, 'STUDIO_TOKYO_HEADER_H'));

// geo.c: every model as it is; the area's geo becomes tokyo_city_geo, the city alone (no screen,
// camera, sky or object nodes: a custom level has those) for the studio's tokyo:city object
const geo = read(path.join(LV, 'geo.c'));
const body = geo.slice(geo.indexOf('const GeoLayout'));
const areaStart = body.indexOf('const GeoLayout tokyo_geo_area_1[]');
const areaEnd = body.indexOf('};', areaStart) + 2;
const area = body.slice(areaStart, areaEnd).split('\n');
const fxAt = area.findIndex((l) => l.includes('geo_sh_fx_tables'));
const objAt = area.findIndex((l) => l.includes('GEO_RENDER_OBJ'));
if (fxAt < 0 || objAt < 0) throw new Error('tokyo_geo_area_1 has a new shape: update import_shoggoth_tokyo.mjs');
const inner = area.slice(fxAt + 1, objAt).map((l) => l.replace(/^ {16}/, '        ')).join('\n');
const cityGeo = `// The city of tokyo_geo_area_1 (made by tools/import_shoggoth_tokyo.mjs)
const GeoLayout tokyo_city_geo[] = {
    GEO_CULLING_RADIUS(32000),
    GEO_OPEN_NODE(),
${inner}
    GEO_CLOSE_NODE(),
    GEO_END(),
};
`;
const bg = (area.find((l) => l.includes('GEO_BACKGROUND')) || '').match(/GEO_BACKGROUND\((\w+)/)?.[1];
write(path.join(GEN_TK, 'geo.inc.c'), body.slice(0, areaStart) + cityGeo + body.slice(areaEnd));

// ---- the level script: objects, models, warps, spawn ---------------------------------------------

const script = read(path.join(LV, 'script.c'));
const modelGeo = {};
for (const m of script.matchAll(/LOAD_MODEL_FROM_GEO\((\w+),\s*(\w+)\)/g)) modelGeo[m[1]] = m[2];
const spawn = script.match(/MARIO_POS\([^,]+,\s*\/\*yaw\*\/\s*(-?\d+),\s*\/\*pos\*\/\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\)/);
const ang = (d) => Math.round((Number(d) / 360) * 65536) & 0xffff;
// bparams: BPARAMn(...) with numbers, (x) >> 8 of dialog ids (only the Toads use them: ignored here)
const evalParams = (s) => {
  let e = s.replace(/\/\*[^*]*\*\//g, '').replace(/STORY_COND\([^)]*\)|\bSC_ALWAYS\b|DIALOG_\w+/g, '0');
  e = e.replace(/BPARAM1\(/g, 'P1(').replace(/BPARAM2\(/g, 'P2(').replace(/BPARAM3\(/g, 'P3(').replace(/BPARAM4\(/g, 'P4(');
  if (!/^[\s\dxXa-fA-FP1234()|<>+\-*&,]*$/.test(e)) throw new Error(`bparams: ${s}`);
  // eslint-disable-next-line no-new-func
  return Function('P1', 'P2', 'P3', 'P4', `return (${e || 0}) >>> 0;`)((v) => (v & 255) << 24, (v) => (v & 255) << 16, (v) => (v & 255) << 8, (v) => v & 255) >>> 0;
};
const objects = [];
for (const line of script.split('\n')) {
  const m = line.match(/OBJECT(_STORY)?\((.*)\),\s*$/);
  if (!m) continue;
  let a = m[2];
  if (m[1]) a = a.replace(/^(STORY_COND\([^)]*\)|\w+),\s*(STORY_COND\([^)]*\)|\w+),\s*/, '');
  const f = a.match(/\/\*model\*\/\s*(\w+),\s*\/\*pos\*\/\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*\/\*angle\*\/\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*\/\*bhvParam\*\/\s*(.*),\s*\/\*bhv\*\/\s*(\w+)$/);
  if (!f) continue;
  const dialog = f[8].match(/DIALOG_(SH_\w+)/)?.[1] || null;
  objects.push({ model: f[1], geo: modelGeo[f[1]] || null, x: +f[2], y: +f[3], z: +f[4], pitch: ang(f[5]), yaw: ang(f[6]), roll: ang(f[7]),
    bparams: evalParams(f[8]), bhv: f[9], ...(dialog ? { dialog } : {}), ...(m[1] ? { story: true } : {}) });
}
const warpNodes = [...script.matchAll(/WARP_NODE\(\/\*id\*\/\s*(\w+),\s*\/\*destLevel\*\/\s*(\w+),\s*\/\*destArea\*\/\s*(\d+),\s*\/\*destNode\*\/\s*(\w+)/g)]
  .map((w) => ({ id: w[1], level: w[2], area: +w[3], node: w[4] }));
const music = script.match(/SET_BACKGROUND_MUSIC\(\/\*settingsPreset\*\/\s*(\d+),\s*\/\*seq\*\/\s*(\w+)\)/);
log(`${objects.length} objects in the level script`);

// ---- the catalog: Tokyo's models as library objects ----------------------------------------------

// model -> [id, name, behavior] (the behaviors are in engine/src/studio/shoggoth/tokyo.c)
const MODELS = {
  MODEL_TK_TRAFFIC_LIGHT: ['traffic_light', 'Traffic light', 'bhvTkProp', ['0x03000102', '0x03000002']],
  MODEL_TK_PED_SIGNAL: ['ped_signal', 'Pedestrian signal', 'bhvTkProp', ['0x02000003']],
  MODEL_TK_SCREEN_BIG: ['screen_big', 'Giant screen', 'bhvTkProp', ['0x04960000']],
  MODEL_TK_SCREEN_2: ['screen_2', 'Screen', 'bhvTkProp', ['0x03820000']],
  MODEL_TK_SCREEN_TALL: ['screen_tall', 'Tall screen', 'bhvTkProp', ['0x036E0000']],
  MODEL_TK_NEON_FLICKER: ['neon_hotel', 'Flickering neon', 'bhvTkProp', ['0x02000001']],
  MODEL_TK_WATERFALL: ['waterfall', 'Waterfall', 'bhvTkProp', ['0x04060000']],
  MODEL_TK_TAXI: ['taxi', 'Taxi', 'bhvTkCar', ['0x00500000']],
  MODEL_TK_KEI: ['kei', 'Kei car', 'bhvTkCar', ['0x01500000']],
  MODEL_TK_BUS: ['bus', 'City bus', 'bhvTkCar', ['0x02500000']],
  MODEL_TK_KEI_TRUCK: ['kei_truck', 'Kei truck', 'bhvTkCar', ['0x07500000']],
  MODEL_TK_TRAIN: ['train', 'Commuter train', 'bhvTkTrain', ['0x03D81E00']],
  MODEL_TK_BOAT: ['boat', 'Canal boat', 'bhvTkBoat', ['0x04280000']],
  MODEL_TK_CRANE_JIB: ['crane_jib', 'Crane jib', 'bhvTkCraneJib', ['0x05000000']],
  MODEL_TK_LIFT: ['lift', 'Glass lift', 'bhvTkLift', ['0x06550000', '0x06280000']],
  MODEL_SH_FIREFLY: ['firefly', 'Firefly', 'bhvTkFirefly', ['0x00000000']],
  MODEL_TK_PEDESTRIAN: ['salaryman', 'Salaryman', 'bhvTkPedestrian', ['0x00000000', '0x01100000', '0x02200000']],
  MODEL_TK_PEOPLE_1: ['office_lady', 'Office worker', 'bhvTkPedestrian', ['0x00000000']],
  MODEL_TK_PEOPLE_2: ['schoolkid', 'Schoolkid', 'bhvTkPedestrian', ['0x00000000']],
  MODEL_TK_PEOPLE_3: ['sailor', 'Sailor uniform', 'bhvTkPedestrian', ['0x00000000']],
  MODEL_TK_PEOPLE_4: ['harajuku', 'Harajuku style', 'bhvTkPedestrian', ['0x00000000']],
  MODEL_TK_PEOPLE_5: ['station_staff', 'Station staff', 'bhvTkPedestrian', ['0x00000000']],
  MODEL_TK_PEOPLE_6: ['takoyaki', 'Takoyaki vendor', 'bhvTkPedestrian', ['0x00000000']],
  MODEL_TK_PEOPLE_7: ['miko', 'Shrine maiden', 'bhvTkPedestrian', ['0x00000000']],
  MODEL_TK_PEOPLE_8: ['builder', 'Builder', 'bhvTkPedestrian', ['0x00000000']],
  MODEL_TK_PEOPLE_9: ['boatman', 'Boatman', 'bhvTkPedestrian', ['0x00000000']],
  MODEL_TK_YAKUZA: ['yakuza', 'Yakuza', 'bhvTkPedestrian', ['0x00000000']],
  MODEL_TK_YAKUZA_BOSS: ['drift_king', 'The Drift King', 'bhvTkPedestrian', ['0x00000000']],
  MODEL_TK_STATIONMASTER: ['stationmaster', 'Stationmaster', 'bhvTkPedestrian', ['0x00000000']],
  MODEL_TK_TUNER: ['tuner', 'Tuner car', 'bhvStaticObject', ['0x00000000']],
  MODEL_TK_ONI: ['oni_red', 'Oni (red)', 'bhvGoomba', ['0x00000000', '0x00010000']],
  MODEL_TK_AO_ONI: ['oni_blue', 'Ao-oni (blue)', 'bhvGoomba', ['0x00000000', '0x00010000']],
  MODEL_TK_CHOCHIN: ['chochin', 'Chochin-obake', 'bhvTkChochin', ['0x00000000', '0x01000000']],
  MODEL_TK_KAPPA: ['kappa', 'Kappa', 'bhvTkKappa', ['0x41455155']],
  MODEL_TK_TANUKI: ['tanuki', 'Tanuki', 'bhvTkTanuki', ['0x01000000', '0x02000000', '0x03000000']],
};
const catalog = [{ id: 'tokyo:city', bhv: 'bhvTkCity', gfx: 'tokyo_city_geo', name: 'Tokyo (the whole city)', params: ['0x00000000'] },
  { id: 'tokyo:petals', bhv: 'bhvTkPetalEmitter', gfx: null, name: 'Falling petals / fireflies', params: ['0x3C0C0000', '0x3C0C0100'] }];
for (const [model, [id, name, bhv, params]] of Object.entries(MODELS)) {
  if (!modelGeo[model]) continue;
  catalog.push({ id: `tokyo:${id}`, bhv, gfx: modelGeo[model], name, params });
}
write(path.join(GEN, 'catalog.json'), JSON.stringify(catalog, null, 1));

// ---- the yokai: the hack's own code for them (engine/src/studio/shoggoth/tokyo_enemies.c) ---------

const enemyC = path.join(SRC, 'src', 'game', 'shoggoth', 'enemies_tokyo.c');
const enemyBhv = path.join(SRC, 'data', 'sh_enemies_tokyo_bhv.inc.c');
if (fs.existsSync(enemyC) && fs.existsSync(enemyBhv)) {
  write(path.join(GEN, 'enemies_tokyo.inc.c'), `// Copied from ${path.relative(ROOT, enemyC)} by tools/import_shoggoth_tokyo.mjs - do not edit.\n` + read(enemyC));
  write(path.join(GEN, 'enemies_tokyo_bhv.inc.c'), `// Copied from ${path.relative(ROOT, enemyBhv)} by tools/import_shoggoth_tokyo.mjs - do not edit.\n` + read(enemyBhv));
} else {
  for (const f of ['enemies_tokyo.inc.c', 'enemies_tokyo_bhv.inc.c']) fs.rmSync(path.join(GEN, f), { force: true });
  for (const id of ['tokyo:chochin', 'tokyo:kappa', 'tokyo:tanuki']) catalog.splice(catalog.findIndex((e) => e.id === id), 1);
  write(path.join(GEN, 'catalog.json'), JSON.stringify(catalog, null, 1));
}

// ---- the C the engine compiles (src/studio/shoggoth/tokyo_data.c includes it) ---------------------

write(path.join(GEN, 'tokyo_data.inc.c'), `// Generated by tools/import_shoggoth_tokyo.mjs from ${path.relative(ROOT, SRC) || SRC} - do not edit.
// Shoggoth World's Tokyo (levels/tokyo): textures, display lists, collision and models.
#define STUDIO_TOKYO_DATA 1
#include "tokyo/header.h"
#include "tokyo/texture.inc.c"
#include "tokyo/model.inc.c"
#include "tokyo/geo.inc.c"
`);

// ---- the night sky --------------------------------------------------------------------------------

const skyPng = path.join(SRC, 'textures', 'skyboxes', 'tokyo_night.png');
let sky = null;
if (fs.existsSync(skyPng)) {
  const img = decodePNG(fs.readFileSync(skyPng));
  fs.copyFileSync(skyPng, path.join(WEB, 'tokyo_sky.png'));
  sky = { file: 'tokyo_sky.png', w: img.w, h: img.h, background: bg };
}

// ---- the template's card in the New level dialog: the night sky with Tokyo's own city title card ----

function sample(img, x, y) {
  // bilinear, clamped
  const x0 = Math.max(0, Math.min(img.w - 1, Math.floor(x))), y0 = Math.max(0, Math.min(img.h - 1, Math.floor(y)));
  const x1 = Math.min(img.w - 1, x0 + 1), y1 = Math.min(img.h - 1, y0 + 1), fx = x - Math.floor(x), fy = y - Math.floor(y);
  const out = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const a = img.rgba[(y0 * img.w + x0) * 4 + k], b = img.rgba[(y0 * img.w + x1) * 4 + k];
    const c = img.rgba[(y1 * img.w + x0) * 4 + k], d = img.rgba[(y1 * img.w + x1) * 4 + k];
    out[k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }
  return out;
}
if (sky) {
  const W = 400, H = 250;
  const bgImg = decodePNG(fs.readFileSync(skyPng));
  const card = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = sample(bgImg, (x / W) * bgImg.w, 20 + (y / H) * 310);
    card.set([c[0], c[1], c[2], 255], (y * W + x) * 4);
  }
  const logoPng = path.join(SRC, 'tools', 'shoggoth', 'intro_art', 'tokyo.png');
  if (fs.existsSync(logoPng)) {
    const logo = decodePNG(fs.readFileSync(logoPng));
    const lw = 250, lh = Math.round((logo.h / logo.w) * lw), ox = 14, oy = H - lh - 6;
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      const c = sample(logo, (x / lw) * logo.w, (y / lh) * logo.h), a = c[3] / 255, i = ((oy + y) * W + ox + x) * 4;
      for (let k = 0; k < 3; k++) card[i + k] = Math.round(card[i + k] * (1 - a) + c[k] * a);
    }
  }
  fs.writeFileSync(path.join(WEB, 'tokyo_card.png'), encodePNG(W, H, card));
}

// ---- the music: the sequence as the game plays it, its instruments as a sound bank ----------------

let song = null;
try {
  const seqS = path.join(SRC, 'sound', 'sequences', 'us', '24_custom_level_tokyo.s');
  const tmp = fs.mkdtempSync(path.join(GEN, '.seq-'));
  try {
    const pre = execFileSync('cpp', ['-P', '-I', path.join(SRC, 'sound', 'sequences'), '-I', path.join(SRC, 'include'), seqS], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    fs.writeFileSync(path.join(tmp, 'seq.s'), pre);
    execFileSync('as', [path.join(tmp, 'seq.s'), '-o', path.join(tmp, 'seq.o')], { stdio: 'ignore' });
    execFileSync('objcopy', ['-O', 'binary', '-j', '.rodata', path.join(tmp, 'seq.o'), path.join(tmp, 'seq.m64')], { stdio: 'ignore' });
    song = fs.readFileSync(path.join(tmp, 'seq.m64'));
  } catch {
    // no host assembler: the checkout's own build of it
    const built = path.join(SRC, 'build', 'us', 'sound', 'sequences', 'us', '24_custom_level_tokyo.m64');
    if (fs.existsSync(built)) song = fs.readFileSync(built);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
} catch (err) { log('music:', err.message); }

// Shoggoth's bank 26_shoggoth lists its instruments in tools/shoggoth/music/bank.py; the program
// numbers of the sequence index that list. Instruments from the game's own samples are kept (the
// studio's samples are named by number only: "41_pan_flute_C3" is "41"; they come from the user's ROM),
// and the hack's synthesised samples (custom_sh_*, made by its synth_samples.py) are
// copied next to them into engine/sound/samples/instruments/ (they ship with Studio 64). The katana
// fight theme (tools/katana_extract.py) plays on the same bank.
function bankJson() {
  const py = read(path.join(SRC, 'tools', 'shoggoth', 'music', 'bank.py'));
  const envs = {};
  for (const m of py.slice(py.indexOf('ENVELOPES'), py.indexOf('}', py.indexOf('ENVELOPES'))).matchAll(/"(\w+)":\s*(\[.*?"hang"\])/g)) envs[m[1]] = JSON.parse(m[2]);
  const instBlock = py.slice(py.indexOf('INSTRUMENTS = ['), py.indexOf('PROGRAM ='));
  const insts = [...instBlock.matchAll(/\("(\w+)",\s*(\{[^}]*\}),\s*"(\w+)",\s*(\d+)\)/g)].map((m) => ({ name: m[1], spec: JSON.parse(m[2].replace(/'/g, '"')), env: m[3], release: +m[4] }));
  const drumBlock = py.slice(py.indexOf('DRUMS = ['), py.indexOf('DRUM ='));
  const drums = [...drumBlock.matchAll(/\("(\w+)",\s*"([^"]+)",\s*([\d.]+),\s*(\d+)\)/g)].map((m) => ({ name: m[1], sample: m[2], mult: +m[3], pan: +m[4] }));
  const sampleDir = path.join(SRC, 'sound', 'samples', 'instruments');
  const studioSamples = new Set(fs.readdirSync(path.join(ROOT, 'engine', 'sound', 'samples', 'instruments')).map((f) => f.replace(/\.aiff$/, '')));
  const num = (s) => (/^[0-9A-F]{2}(_|$)/.test(s) ? s.slice(0, 2) : null);
  const custom = (s) => /^custom_sh_\w+$/.test(s) && fs.existsSync(path.join(sampleDir, `${s}.aiff`));
  const ok = (s) => custom(s) || (num(s) && studioSamples.has(num(s)));
  const sname = (s) => {
    if (!custom(s)) return num(s);
    const to = path.join(ROOT, 'engine', 'sound', 'samples', 'instruments', `${s}.aiff`);
    if (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(path.join(sampleDir, `${s}.aiff`)).size) fs.copyFileSync(path.join(sampleDir, `${s}.aiff`), to);
    return s;
  };
  const rate = (name) => {
    const b = fs.readFileSync(path.join(sampleDir, `${name}.aiff`));
    for (let i = 12; i < b.length - 8;) {
      const id = b.toString('ascii', i, i + 4), sz = b.readUInt32BE(i + 4);
      if (id === 'COMM') {
        const e = b.readUInt16BE(i + 8 + 8), m = b.readBigUInt64BE(i + 8 + 10);
        return Number(m) * 2 ** (e - 16383 - 63);
      }
      i += 8 + sz + (sz & 1);
    }
    throw new Error(`no sample rate in ${name}`);
  };
  const instruments = {}, list = [];
  const usedEnvs = new Set(['drum']);
  for (const it of insts) {
    const sounds = ['sound', 'sound_lo', 'sound_hi'].filter((k) => it.spec[k]);
    if (!sounds.every((k) => ok(it.spec[k]))) { list.push(null); continue; }
    const inst = { release_rate: it.release, envelope: it.env };
    for (const [k, v] of Object.entries(it.spec)) inst[k] = sounds.includes(k) ? sname(v) : v;
    instruments[it.name] = inst;
    list.push(it.name);
    usedEnvs.add(it.env);
  }
  const fallback = drums.find((d) => ok(d.sample));
  instruments.percussion = drums.map((d) => {
    const dd = ok(d.sample) ? d : { ...fallback, pan: d.pan };
    return { release_rate: 10, pan: dd.pan, envelope: 'drum', sound: { sample: sname(dd.sample), tuning: Math.round((rate(dd.sample) / 32000) * dd.mult * 1e6) / 1e6 } };
  });
  return { date: '2026-10-20', sample_bank: 'instruments', envelopes: Object.fromEntries(Object.entries(envs).filter(([k]) => usedEnvs.has(k))), instrument_list: list, instruments };
}
let bankOk = false;
try {
  const bank = JSON.stringify(bankJson(), null, 2);
  if (!fs.existsSync(BANK_OUT) || read(BANK_OUT) !== bank) write(BANK_OUT, bank);
  bankOk = true;
} catch (err) { log('sound bank:', err.message); }
// the bank's number in the engine: banks are numbered by their file names in order
const bankIndex = bankOk ? fs.readdirSync(path.dirname(BANK_OUT)).filter((f) => f.endsWith('.json')).sort().indexOf(path.basename(BANK_OUT)) : -1;

// ---- texts: what the Toads and the sign say --------------------------------------------------------

const texts = {};
const dlg = path.join(SRC, 'text', 'us', 'shoggoth_dialogs.h');
if (fs.existsSync(dlg)) {
  for (const m of read(dlg).matchAll(/DEFINE_DIALOG\(DIALOG_(SH_TK_\w+|SH_TOKYO_WELCOME),[^_]*_\("((?:[^"\\]|\\.|\\\n)*)"\)\)/g)) {
    texts[m[1]] = m[2].replace(/\\\n/g, '').replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
  }
}

// ---- the template ---------------------------------------------------------------------------------

const template = {
  source: 'Shoggoth World (levels/tokyo)',
  name: 'Tokyo',
  spawn: spawn ? { x: +spawn[2], y: +spawn[3], z: +spawn[4], yaw: ang(spawn[1]) } : { x: 0, y: 200, z: 0, yaw: 0 },
  music: music ? { preset: +music[1], seq: music[2] } : null,
  song: song && bankIndex >= 0 ? { m64: song.toString('base64'), bank: bankIndex, bytes: song.length } : null,
  sky,
  card: fs.existsSync(path.join(WEB, 'tokyo_card.png')) ? 'tokyo_card.png' : null,
  objects,
  warpNodes,
  texts,
};
write(path.join(WEB, 'tokyo.json'), JSON.stringify(template));

// the engine must recompile the files that include the generated data
for (const f of ['tokyo_data.o', 'tokyo.o', 'tokyo_behaviors.o', 'tokyo_enemies.o', 'tokyo_enemies_bhv.o']) fs.rmSync(path.join(ROOT, 'engine', 'build', 'us_web', 'src', 'studio', 'shoggoth', f), { force: true });
write(STAMP, JSON.stringify({ sig: SIG, from: path.basename(SRC), at: new Date().toISOString() }));
log(`wrote ${path.relative(ROOT, GEN)}, ${path.relative(ROOT, WEB)}/tokyo.json${song ? ` (music ${song.length} bytes, bank ${bankIndex})` : ''}`);
