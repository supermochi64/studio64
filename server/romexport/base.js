// The decomp tree every ROM export builds on: the SM64 decompilation (downloaded, romkit.js) with
// Studio 64's changes. decomp-changes.json holds them as the engine's changes are held
// (tools/lib/engine_source.mjs): per file the places and Studio 64's own lines, never the decomp's,
// with the checksum of the file before and after, so they apply the same everywhere without a patch
// tool and fail loudly if the decomp ever changes underneath them. What they do: the build (big
// levels, the Expansion Pak's memory, the ROM's own code in the main segment, Studio 64's modules
// linked with their relocations), the engine's Studio 64 code called from the game (areas, frames,
// audio, motion, gameplay rules, dialogs, the story, the save file, Shotgun Mario, Katana Mario and
// the cars), and the older decomp's names for some fields. To change them: edit a tree made with
// tools/romkit_dev.mjs, then node tools/romkit_dev.mjs --diff writes decomp-changes.json again.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyHunks } from '../../tools/lib/engine_source.mjs';
import { stubsC } from './calls.js';
import { overlaySources, hooksC } from './overlays.js';

// the upstream decompilation every base tree starts from (its newest commit, "ique hotfix")
export const UPSTREAM = { repo: 'n64decomp/sm64', commit: '9921382a68bb0c865e5e45eb594d9c64db59b1af' };

// Studio 64's changes to the decomp's files ({ base, files: { path: { orig, sha256, hunks } } })
export const PATCHES = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'decomp-changes.json'), 'utf8'));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
/** A decomp file with Studio 64's changes, from its pristine bytes (or an error if the decomp changed). */
export function changedFile(rel, pristine) {
  const ch = PATCHES.files[rel];
  if (sha256(pristine) !== ch.orig) throw new Error(`the decomp source has changed: cannot patch ${rel}`);
  return applyHunks(pristine, ch.hunks);
}

// The hack's own settings, which an export writes into the ROM (rom.js, writeInfo): read at boot.
export const INFO_ROM = 0x01000000;
export const INFO_SIZE = 0xE00;

// The ROM's own code: n64/ (what only the ROM needs) and the engine's Studio 64 modules (the same
// code the web build runs), into src/s64/. The engine modules build against n64/n64compat.h.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..', '..', 'engine', 'src', 'studio');
// what the engine's older decomp called otherwise (renames.json)
export const RENAMES = JSON.parse(fs.readFileSync(path.join(HERE, 'renames.json'), 'utf8'));
const INSTRUMENT_NAMES = JSON.parse(fs.readFileSync(path.join(HERE, 'instrument_names.json'), 'utf8'));
export const ENGINE_MODULES = ['studio.h', 'studio_assets.h', 'objects.h', 'flow.c', 'motion.c', 'actor.c', 'rules.c', 'story.c', 'audio.c'];
// On the N64 an object's behavior is a RAM address and the behavior symbols are segment 0x13
// addresses (the PC port has one kind of address): comparisons go through segmented_to_virtual.
// What the engine tells the page (EM_ASM: Module.studioX(...)) is a C call here (s64_page_studioX,
// s64_story.c), and the older decomp's dialog answer is this one's.
// The page's call in an EM_ASM, in C: s64_page_<name>(arguments), where $N are the EM_ASM's
// arguments ("UTF8ToString($N)", ">>> 0", "| 0": as they are), JS strings C strings
function pageCall(js, args) {
  const split = (text) => {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of text) {
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
      if ('([{'.includes(ch)) depth++;
      if (')]}'.includes(ch)) depth--;
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  const m = /Module\.(studio\w+)\(/.exec(js.replace(/if\s*\(Module\.studio\w+\)/g, ''));
  if (!m) return null;
  const body = js.replace(/if\s*\(Module\.studio\w+\)/g, '');
  let i = m.index + m[0].length, depth = 1;
  const start = i;
  for (; i < body.length && depth > 0; i++) { if (body[i] === '(') depth++; else if (body[i] === ')') depth--; }
  const c = split(args);
  const mapped = split(body.slice(start, i - 1)).map((a) => a
    .replace(/^UTF8ToString\((\$\d+)\)$/, '$1')
    .replace(/\s*(>>>|\|)\s*0\s*$/, '')
    .replace(/^\$(\d+)$/, (x, n) => c[Number(n)] ?? '0')
    .replace(/^'([^']*)'$/, '"$1"'));
  return `s64_page_${m[1]}(${mapped.join(', ')});`;
}

function forN64(text) {
  return text
    .replace(/(->behavior\s*[!=]=\s*)(bhv\w+)\b/g, '$1(const BehaviorScript *) segmented_to_virtual($2)')
    .replace(/#ifdef TARGET_WEB\n(\s*want = EM_ASM_INT)/g, '#if 1\n$1')
    .replace(/EM_ASM(?:_INT)?\(\{([^}]*?Module\.studio\w+[\s\S]*?)\}\s*,\s*([^;]*?)\);/g, (m, js, args) => pageCall(js, args) || m)
    .replace(/^extern s8 gLastDialogResponse;\n/m, '')
    .replace(/^#define oBhvParams oBehParams\b.*\n/m, '') // (Tokyo's code has the newer name already)
    .replace(/\bgLastDialogResponse\b/g, 'gDialogResponse');
}

function sourceFiles() {
  const files = {};
  for (const f of fs.readdirSync(path.join(HERE, 'n64')).sort()) files[`src/s64/${f}`] = fs.readFileSync(path.join(HERE, 'n64', f), 'utf8');
  for (const f of ENGINE_MODULES) files[`src/s64/${f}`] = forN64(fs.readFileSync(path.join(ENGINE, f), 'utf8'));
  files['src/s64/s64_calls.inc'] = stubsC();
  // Studio 64's modules (overlays.js): their sources, and the game's calls into them
  const renamed = new RegExp(`\\b(${Object.keys(RENAMES).join('|')})\\b`, 'g');
  // (what the game itself reads of them is the game's: the weapons' draw flags, s64_glue.c)
  Object.assign(files, overlaySources((t) => forN64(t).replace(renamed, (w) => RENAMES[w])
    .replace(/^s32 (gStudioShotgunDraw|gStudioKatanaDraw)( = FALSE)?;/gm, 'extern s32 $1;')
    // (what a module allocates lives as long as the module: the level's memory, s64_ovl.c)
    .replace(/\bmalloc\(/g, 's64_level_malloc(')));
  files['src/s64/s64_ovl_hooks.c'] = hooksC();
  // the bank the project's sound effects play from (s64_sfx.c builds its instruments: these are
  // placeholders on a sample of the game)
  files['sound/sound_banks/27_studio_sfx.json'] = `${JSON.stringify({
    date: '2026-10-22', sample_bank: 'instruments', envelopes: { sfx: [[1, 32700], 'hang'] },
    instruments: Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`sfx${i}`, { release_rate: 208, envelope: 'sfx', sound: INSTRUMENT_NAMES['00'] }])),
    instrument_list: Array.from({ length: 16 }, (_, i) => `sfx${i}`),
  }, null, 2)}\n`;
  // Studio 64's own instrument banks (Tokyo's music: new instruments over the game's samples)
  const banks = path.join(ENGINE, '..', '..', 'sound', 'sound_banks');
  for (const f of fs.existsSync(banks) ? fs.readdirSync(banks).filter((x) => /^[0-9a-f]{2}_studio_\w+\.json$/.test(x)) : []) {
    // (the engine's decomp names the game's samples by number, this one by number and name)
    const bank = fs.readFileSync(path.join(banks, f), 'utf8');
    files[`sound/sound_banks/${f}`] = bank
      .replace(/("(?:sound|sound_lo|sound_hi|sample)":\s*")([0-9A-Fa-f]{2})"/g, (m, k, n) => `${k}${INSTRUMENT_NAMES[n.toUpperCase()] || n}"`);
    // ...and Studio 64's own samples it plays (Shoggoth World's: they come with Studio 64)
    for (const name of new Set(bank.match(/custom_\w+/g) || [])) {
      const aiff = path.join(banks, '..', 'samples', 'instruments', `${name}.aiff`);
      if (fs.existsSync(aiff)) files[`sound/samples/instruments/${name}.aiff`] = `base64:${fs.readFileSync(aiff).toString('base64')}`;
    }
  }
  // the engine's headers (its modules include them as "studio/...") and its object catalog
  const walk = (dir, rel = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      // (not the Sunshine converter's output: Nintendo's, and only on computers with the disc)
      if (e.isDirectory()) { if (!/^sms\/(gen|stub)$/.test(`${rel}${e.name}`)) walk(path.join(dir, e.name), `${rel}${e.name}/`); }
      else if (e.name.endsWith('.h')) files[`src/studio/${rel}${e.name}`] = fs.readFileSync(path.join(dir, e.name), 'utf8');
    }
  };
  walk(ENGINE);
  // (the Sunshine characters' body list: the stand-in without the disc's, names and numbers only)
  files['src/studio/sms/gen/sms_bodies.h'] = fs.readFileSync(path.join(ENGINE, 'sms', 'stub', 'sms_bodies.h'), 'utf8');
  const catalog = kitCatalog(fs.readFileSync(path.join(ENGINE, 'gen', 'catalog.inc.c'), 'utf8'));
  files['src/studio/gen/catalog.inc.c'] = catalog;
  // what the catalog names from the engine's own modules: weak, so modules not in the ROM are NULL
  const weak = new Set(catalog.match(/\b(bhv(Sms|Sg|Kt|Tk|Studio)\w*|(stv|tokyo|tk|sms|sg|kt)_\w+_(geo|dl)\w*|(stv|tokyo|tk|sms|sg|kt)_\w+)\b/g));
  for (const m of catalog.matchAll(/#include "(studio\/[^"]+)"/g)) {
    const h = files[`src/${m[1]}`] || '';
    for (const d of h.matchAll(/extern\s+[^;(]*?\b(\w+)\s*(?:\[[^\]]*\])?\s*;/g)) weak.add(d[1]);
  }
  files['src/s64/s64_catalog_weak.inc'] = `// Made by server/romexport/base.js.\n${[...weak].sort().map((n) => `${/^bhv/.test(n) ? `extern const BehaviorScript ${n}[];\n` : ''}#pragma weak ${n}`).join('\n')}\n`;
  return files;
}
/** The object catalog as the base ROM has it: without the part only computers with a Super Mario
 * Sunshine disc have (Sunshine never goes into a ROM; tools/gen_catalog.py writes that part last in
 * each table, after a marker, so every other entry keeps its index), so it is the same on every
 * computer; with this decomp's names for what the engine's older decomp called otherwise. */
export function kitCatalog(text) {
  return text.replace(/^ {4}\/\/ \(from here: only with a Super Mario Sunshine disc\)\n(?:(?!\};).*\n)*/gm, '')
    .replace(/\b[A-Za-z_]\w*\b/g, (w) => RENAMES[w] || w);
}
export const FILES = sourceFiles();

// a file's contents: text, or bytes ("base64:...")
const contents = (v) => (Buffer.isBuffer(v) ? v : v.startsWith('base64:') ? Buffer.from(v.slice(7), 'base64') : Buffer.from(v, 'utf8'));

export function applyPatches(root) {
  for (const [rel, text] of Object.entries(FILES)) {
    const file = path.join(root, rel);
    try { if (fs.readFileSync(file).equals(contents(text))) continue; } catch { /* new */ }
    try { fs.unlinkSync(file); } catch {}
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents(text));
  }
  for (const [rel, ch] of Object.entries(PATCHES.files)) {
    const file = path.join(root, rel);
    const now = fs.readFileSync(file);
    if (sha256(now) === ch.sha256) continue; // already applied
    const out = changedFile(rel, now);
    try { fs.unlinkSync(file); } catch {}
    fs.writeFileSync(file, out);
  }
}

// A source tree brought up to date from a pristine copy of the decomp: every file the changes
// touch is rebuilt from its pristine version and written only when it differs (make then rebuilds
// only what changed). For working on the ROM's code (tools/romkit_dev.mjs).
export function syncTree(root, pristine) {
  const want = new Map();
  for (const rel of Object.keys(PATCHES.files)) want.set(rel, changedFile(rel, fs.readFileSync(path.join(pristine, rel))));
  for (const [rel, text] of Object.entries(FILES)) want.set(rel, text);
  const changed = [];
  for (const [rel, text] of want) {
    const file = path.join(root, rel);
    let now = null;
    try { now = fs.readFileSync(file); } catch { /* new */ }
    if (now && now.equals(contents(text))) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try { fs.unlinkSync(file); } catch {}
    fs.writeFileSync(file, contents(text));
    changed.push(rel);
  }
  // files of ours that are gone
  const s64 = path.join(root, 'src', 's64');
  if (fs.existsSync(s64)) for (const f of fs.readdirSync(s64)) if (!want.has(`src/s64/${f}`)) { fs.rmSync(path.join(s64, f)); changed.push(`src/s64/${f} (removed)`); }
  return changed;
}
