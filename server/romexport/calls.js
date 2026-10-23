// Setup calls: what the page tells the engine when an area loads (motion paths, custom objects,
// rules, environment, zones), recorded while the export visits the area and played again by the
// ROM at the same moment (n64/s64_core.c). The functions are the engine's own; their signatures are
// read from its source, and the ROM gets a typed stub for each (s64_calls.inc, made here).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'engine', 'src', 'studio');

// the calls the ROM plays (pure set-up: what depends on play progress, the ROM keeps itself)
export const REPLAYED = [
  'studio_actors_reset', 'studio_actor_set', 'studio_mover_setup',
  'studio_motion_reset_all', 'studio_motion_set', 'studio_motion_clear',
  'studio_path_override_clear', 'studio_path_override_add', 'studio_path_override_done',
  'studio_rules_set', 'studio_rules_level_start',
  'studio_zones_reset', 'studio_zone_add',
  'studio_env_camera', 'studio_env_fog', 'studio_env_tint', 'studio_env_light', 'studio_env_death',
  'studio_env_ambient', 'studio_env_weather', 'studio_env_boxes_reset', 'studio_env_box', 'studio_env_boxes_apply',
  'studio_story_watch_clear', 'studio_story_watch', 'studio_set_visible',
  'studio_locks_reset', 'studio_lock_set',
  // Studio 64's modules (overlays.js: when the level has them)
  'studio_shotgun_level_start', 'studio_shotgun_rule', 'studio_katana_level_start', 'studio_katana_rule',
  'studio_katana_duel_config', 'studio_vehicle_area_reset', 'studio_vehicle_config', 'studio_race_config',
];
// what the export writes itself instead of recording (it depends on the editor's play progress)
const WRITTEN = new Set(['studio_locks_reset', 'studio_lock_set', 'studio_story_watch_clear', 'studio_story_watch']);

// C parameter -> what the call carries: i (integer), f (float), slot (an object, by uid), floats
// / bytes (an array, its length in the next parameter), str (a string)
function kindOf(type, name) {
  const t = type.replace(/\s+/g, ' ').trim();
  if (/^const f32 \*$/.test(t)) return 'floats';
  if (/^const u8 \*$/.test(t)) return 'bytes';
  if (/^const char \*$/.test(t)) return 'str';
  if (/^f32$/.test(t)) return 'f';
  if (/^[su](8|16|32)$/.test(t)) return name === 'slot' ? 'slot' : 'i';
  throw new Error(`unsupported parameter type ${t}`);
}

let sigs = null;
// name -> { params: [{ name, type, kind }] }
export function signatures() {
  if (sigs) return sigs;
  sigs = {};
  for (const f of fs.readdirSync(ENGINE).filter((x) => x.endsWith('.c'))) {
    const src = fs.readFileSync(path.join(ENGINE, f), 'utf8');
    for (const m of src.matchAll(/EMSCRIPTEN_KEEPALIVE\s+[\w\s*]+?\b(studio_\w+)\(([^)]*)\)\s*\{/g)) {
      if (!REPLAYED.includes(m[1])) continue;
      const params = m[2].trim() === 'void' ? [] : m[2].split(',').map((p) => {
        const mm = /^(.*?)(\w+)$/.exec(p.trim());
        return { type: mm[1].trim(), name: mm[2], kind: kindOf(mm[1], mm[2]) };
      });
      sigs[m[1]] = { params };
    }
  }
  const missing = REPLAYED.filter((n) => !sigs[n]);
  if (missing.length) throw new Error(`no engine function ${missing.join(', ')}`);
  return sigs;
}

// What the browser needs to record the calls: name -> parameter kinds
export function captureSpec() {
  return Object.fromEntries(Object.entries(signatures()).filter(([n]) => !WRITTEN.has(n)).map(([n, s]) => [n, s.params.map((p) => p.kind)]));
}

// The ROM's stubs: s64_calls.inc (included by s64_core.c): one function per call, reading its
// arguments from the recorded words, and the table the recordings index.
export function stubsC() {
  const out = ['// Made by server/romexport/calls.js from the engine\'s function signatures.', ''];
  REPLAYED.forEach((name, id) => {
    const s = signatures()[name];
    const ret = /void/.test(name) ? 'void' : 's32';
    void ret;
    out.push(`${prototype(name)};`);
    const args = s.params.map((p, i) => {
      if (p.kind === 'i') return `(${p.type}) a[${i}]`;
      if (p.kind === 'f') return `s64_f32(a[${i}])`;
      if (p.kind === 'slot') return `slot${i}`;
      return `(${p.type}) s64_seg_ptr(a[${i}])`;
    });
    const slots = s.params.map((p, i) => (p.kind === 'slot' ? i : -1)).filter((i) => i >= 0);
    out.push(`static void call_${id}(const u32 *a) {`);
    for (const i of slots) out.push(`    s32 slot${i} = s64_slot_of_uid(a[${i}]);`, `    if (slot${i} < 0) return;`);
    if (!slots.length && !s.params.length) out.push('    (void) a;');
    out.push(`    ${name}(${args.join(', ')});`, '}', '');
  });
  out.push('static void (*const sCalls[])(const u32 *) = {', ...REPLAYED.map((_, id) => `    call_${id},`), '};', '');
  return out.join('\n');
}

function prototype(name) {
  const src = fs.readdirSync(ENGINE).filter((x) => x.endsWith('.c')).map((f) => fs.readFileSync(path.join(ENGINE, f), 'utf8')).join('\n');
  const m = new RegExp(`EMSCRIPTEN_KEEPALIVE\\s+([\\w\\s*]+?)\\b${name}\\(([^)]*)\\)`).exec(src);
  return `${m[1].trim()} ${name}(${m[2].replace(/\s+/g, ' ').trim()})`;
}

/**
 * Writes the recorded calls of an area into seg (label name): u16 count, then per call u16 id,
 * u16 argc and the arguments as words (arrays and strings go after, by segmented address).
 * calls: [[name, ...args]] as recorded (arrays as number lists, strings as text, objects as uids)
 */
export function writeCalls(seg, name, calls) {
  const known = calls.filter((c) => REPLAYED.includes(c[0]));
  const blobs = [];
  seg.align(4).label(name);
  seg.u16(known.length).u16(0);
  known.forEach((c, n) => {
    const s = signatures()[c[0]];
    seg.u16(REPLAYED.indexOf(c[0])).u16(s.params.length);
    s.params.forEach((p, i) => {
      const v = c[1 + i];
      if (p.kind === 'f') { const b = Buffer.alloc(4); b.writeFloatBE(Number(v) || 0); seg.u32(b.readUInt32BE(0)); }
      else if (p.kind === 'floats' || p.kind === 'bytes' || p.kind === 'str') {
        const label = `${name}_${n}_${i}`;
        blobs.push({ label, kind: p.kind, v });
        seg.ref(label);
      } else seg.u32(Number(v) >>> 0);
    });
  });
  for (const b of blobs) {
    seg.align(4).label(b.label);
    if (b.kind === 'floats') for (const x of b.v) { const t = Buffer.alloc(4); t.writeFloatBE(Number(x) || 0); seg.bytes(t); }
    else if (b.kind === 'bytes') seg.bytes(Buffer.from(b.v));
    else seg.bytes(Buffer.from(`${b.v}\0`, 'latin1'));
  }
  return known.length;
}
