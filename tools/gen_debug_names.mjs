// Names for the debug overlay: Mario's actions, surface types and save file flags,
// read from the engine's headers -> web/data/debug_names.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, 'engine', p), 'utf8');
const nice = (s) => s.toLowerCase().replace(/_/g, ' ');

const actions = {};
for (const m of read('include/sm64.h').matchAll(/^#define ACT_([A-Z0-9_]+)\s+0x([0-9A-Fa-f]{8})/gm)) {
  if (/MASK$|^GROUP|^FLAG/.test(m[1])) continue;
  actions[parseInt(m[2], 16) >>> 0] = nice(m[1]);
}
const surfaces = {};
for (const m of read('include/surface_terrains.h').matchAll(/^#define SURFACE_([A-Z0-9_]+)\s+0x([0-9A-Fa-f]{4})\s*(?:\/\/\s*(.*))?$/gm)) {
  if (/^CLASS|^FLAG/.test(m[1])) continue;
  const id = parseInt(m[2], 16);
  if (surfaces[id]) continue;
  surfaces[id] = { name: nice(m[1]), note: (m[3] || '').trim() };
}
const flags = {};
for (const m of read('src/game/save_file.h').matchAll(/^#define SAVE_FLAG_([A-Z0-9_]+)\s+\/\*\s*0x([0-9A-Fa-f]+)\s*\*\//gm)) {
  flags[m[1]] = parseInt(m[2], 16);
}
const out = { actions, surfaces, flags };
fs.writeFileSync(path.join(ROOT, 'web/data/debug_names.json'), JSON.stringify(out));
console.log(`actions ${Object.keys(actions).length}, surfaces ${Object.keys(surfaces).length}, flags ${Object.keys(flags).length}`);
