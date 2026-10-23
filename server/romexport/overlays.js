// Studio 64's own modules in the ROM (Super Mario Sunshine characters, Shotgun and Katana Mario,
// the cars, Tokyo's city life): overlays, as N64 games load their code. Each module's code and data
// (the engine's own source) is compiled with the game's, linked against the game's symbols at a
// placeholder address and stored after the game in the base ROM with what moves with it (relocations).
// A hack's ROM loads the modules it uses at boot (n64/s64_ovl.c) into the main memory pool.
//
// The game reaches a module two ways: calls (hooks the patches add, HOOKS) go through trampolines that
// do nothing while the module is not there, and its data (the catalog's behaviors and models) is
// weak in the game: where the game's data points at it (the game's own relocations, --emit-relocs)
// is filled in when the module loads.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.resolve(HERE, '..', '..', 'engine', 'src', 'studio');

// the modules: what they compile (engine/src/studio/...), the folders of data they include, the
// catalog entries that need them, behaviors the engine keeps in its data/behavior_data.c (taken
// from there, with the includes of a file of the module: bhvFrom), and what the ROM leaves out of
// them (omit: only what something reaches is linked, and these are not reached from the game), and
// the modules it cannot work without (requires; other calls between modules do nothing while the
// other module is not in the level)
// (only Studio 64's own: the Sunshine characters are Nintendo's models, which a ROM hack someone
// shares must not contain -- they stay in the browser, NINTENDO_IDS)
export const OVERLAYS = [
  { name: 'shotgun', files: ['shotgun.c', 'shotgun_objects.c', 'shotgun_behaviors.c'], data: ['shotgun', 'romgen/shotgun'], ids: /^sg:/ },
  // (the katana's cuts react like the shotgun's shots: its weapon code is in the shotgun's module)
  { name: 'katana', files: ['katana.c', 'katana_fighters.c', 'katana_behaviors.c'], data: ['katana', 'romgen/katana'], ids: /^kt:/, requires: ['shotgun'] },
  { name: 'vehicles', files: ['vehicle.c', 'vehicle_race.c', 'vehicle_behaviors.c', 'vehicle_models.c'], data: ['vehicles', 'romgen/vehicles'], ids: /^vehicle:/ },
  // (the city itself is the level's own geometry in an exported ROM: its object stays out)
  { name: 'tokyo', files: ['shoggoth/*.c'], data: ['shoggoth', 'romgen/tokyo'], ids: /^tokyo:/, omit: ['bhvTkCity', 'tokyo_city_geo'] },
];

// a module's compiled files (relative to engine/src/studio)
function filesOf(ov) {
  return ov.files.flatMap((f) => {
    if (!f.endsWith('/*.c')) return [f];
    const dir = f.slice(0, -4);
    return fs.readdirSync(path.join(ENGINE, dir)).filter((x) => x.endsWith('.c') && !x.endsWith('.inc.c')).sort().map((x) => `${dir}/${x}`);
  });
}

// the modules this computer can build (their data is there: some is made from the game at build time)
export const available = () => OVERLAYS.filter((ov) => [...filesOf(ov), ...ov.data].every((f) => fs.existsSync(path.join(ENGINE, f))));

// catalog entries whose models are Nintendo's (from other games): never in a ROM
export const NINTENDO_IDS = /^sms:/;

// the game's calls into modules: trampolines in the game, slot = index. The game's hooks (base.js
// patches: Mario's step, the camera, his body, the HUD), the story (s64_story.c), the set-up the
// export recorded (calls.js) and the frame (s64_core.c).
export const HOOKS = [
  'studio_shotgun_before_step', 'studio_shotgun_after_step', 'studio_shotgun_anim_part', 'studio_shotgun_part_drawn',
  'studio_shotgun_camera', 'studio_shotgun_hud', 'studio_shotgun_give', 'studio_shotgun_has', 'studio_shotgun_rule',
  'studio_shotgun_level_start',
  'studio_katana_before_step', 'studio_katana_after_step', 'studio_katana_action', 'studio_katana_anim_part',
  'studio_katana_part_drawn', 'studio_katana_camera', 'studio_katana_give', 'studio_katana_has', 'studio_katana_rule',
  'studio_katana_level_start', 'studio_katana_duel_config',
  'studio_vehicle_before_step', 'studio_vehicle_action', 'studio_vehicle_camera', 'studio_vehicle_hud',
  'studio_vehicle_config', 'studio_vehicle_area_reset', 'studio_race_config', 'studio_race_start',
  'studio_tokyo_frame',
];

const LINK_BASE = 0x81000000; // (no RAM; 64 KB aligned, as the modules load)
const MODULE_SPAN = 0x01000000; // module i is linked at LINK_BASE + i * MODULE_SPAN
const R_MIPS_32 = 2, R_MIPS_26 = 4, R_MIPS_HI16 = 5, R_MIPS_LO16 = 6;
export const DIR_MAGIC = 0x53363456; // "S64V"

// The modules' sources for the build tree (src/studio/<dir>/...: the engine's headers are mirrored
// there, so their includes work as in the engine). transform: base.js's forN64.
export function overlaySources(transform) {
  const files = {};
  const add = (rel) => {
    const text = fs.readFileSync(path.join(ENGINE, rel), 'utf8');
    files[`src/studio/${rel}`] = /\.inc\.c$|\.h$/.test(rel) && text.length > 200000 ? text : transform(text);
  };
  for (const ov of available()) {
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(ENGINE, rel), { withFileTypes: true })) {
        if (e.isDirectory()) { if (e.name !== 'stub') walk(`${rel}/${e.name}`); continue; }
        if (/\.(c|h)$/.test(e.name)) add(`${rel}/${e.name}`);
      }
    };
    for (const d of ov.data) walk(d);
    for (const f of filesOf(ov)) add(f);
    if (ov.behaviors?.length) files[`src/studio/s64_bhv_${ov.name}.c`] = dataBehaviors(ov);
  }
  return files;
}

// a module's behaviors from the engine's data/behavior_data.c
function dataBehaviors(ov) {
  const data = fs.readFileSync(path.resolve(ENGINE, '..', '..', 'data', 'behavior_data.c'), 'utf8');
  const from = path.dirname(ov.bhvFrom);
  const head = fs.readFileSync(path.join(ENGINE, ov.bhvFrom), 'utf8').split('\n').filter((l) => /^#(include|define OBJECT_FIELDS)/.test(l))
    .map((l) => l.replace(/^#include "(?!studio\/|game\/|engine\/|audio\/)([^"]+\.h)"/, (m, h) => (fs.existsSync(path.join(ENGINE, from, h)) ? `#include "studio/${from}/${h}"` : m)));
  const out = ['// Made by server/romexport/overlays.js from the engine\'s data/behavior_data.c.', ...head, ''];
  for (const name of ov.behaviors) {
    const m = new RegExp(`const BehaviorScript ${name}\\[\\] = \\{[\\s\\S]*?\\n\\};`).exec(data);
    if (!m) throw new Error(`${name} is not in the engine's behavior_data.c`);
    out.push(m[0], '');
  }
  return out.join('\n');
}

// what make compiles of a module (relative to the tree)
function objectsOf(ov) {
  return [...filesOf(ov), ...(ov.behaviors?.length ? [`s64_bhv_${ov.name}.c`] : [])].map((f) => `src/studio/${f.replace(/\.c$/, '.o')}`);
}

// The trampolines (s64_ovl_hooks.c): each hook jumps through its slot, or returns 0.
export function hooksC() {
  const out = ['// Made by server/romexport/overlays.js: the game\'s calls into Studio 64\'s modules.', '#include <ultra64.h>', '',
    `u32 gS64OvlSlots[${Math.max(1, HOOKS.length)}];`, `const s32 gS64OvlHookCount = ${HOOKS.length};`, ''];
  HOOKS.forEach((name, k) => {
    out.push(`__asm__(".section .text\\n.set noreorder\\n.globl ${name}\\n.type ${name}, @function\\n${name}:\\n"`,
      `        "lui $t9, %hi(gS64OvlSlots + ${k * 4})\\nlw $t9, %lo(gS64OvlSlots + ${k * 4})($t9)\\n"`,
      `        "beqz $t9, 1f\\nnop\\njr $t9\\nnop\\n1: jr $ra\\nmove $v0, $zero\\n.set reorder\\n");`);
  });
  return `${out.join('\n')}\n`;
}

// ---- ELF (32-bit, big-endian) ----------------------------------------------------------------------
export function parseElf(buf) {
  const shoff = buf.readUInt32BE(0x20), shentsize = buf.readUInt16BE(0x2E), shnum = buf.readUInt16BE(0x30), shstrndx = buf.readUInt16BE(0x32);
  const sections = [];
  for (let i = 0; i < shnum; i++) {
    const o = shoff + i * shentsize;
    sections.push({ index: i, nameOff: buf.readUInt32BE(o), type: buf.readUInt32BE(o + 4), addr: buf.readUInt32BE(o + 12), offset: buf.readUInt32BE(o + 16),
      size: buf.readUInt32BE(o + 20), link: buf.readUInt32BE(o + 24), info: buf.readUInt32BE(o + 28) });
  }
  const str = (sec, off) => { const s = sections[sec]; const e = buf.indexOf(0, s.offset + off); return buf.toString('latin1', s.offset + off, e); };
  for (const s of sections) s.name = str(shstrndx, s.nameOff);
  const symtab = sections.find((s) => s.type === 2);
  const symbols = [];
  if (symtab) {
    for (let o = symtab.offset; o < symtab.offset + symtab.size; o += 16) {
      const info = buf[o + 12];
      symbols.push({ name: str(symtab.link, buf.readUInt32BE(o)), value: buf.readUInt32BE(o + 4), size: buf.readUInt32BE(o + 8), bind: info >> 4, type: info & 15, shndx: buf.readUInt16BE(o + 14) });
    }
  }
  // relocations (REL): per target section, [{ at (address), type, sym }]
  const rels = new Map();
  for (const s of sections.filter((x) => x.type === 9)) {
    const list = [];
    for (let o = s.offset; o < s.offset + s.size; o += 8) {
      const info = buf.readUInt32BE(o + 4);
      list.push({ at: buf.readUInt32BE(o), type: info & 0xFF, sym: info >>> 8 });
    }
    rels.set(s.info, list);
  }
  return { sections, symbols, rels };
}


// What moves when modules load: a module's references to itself and to the other modules (the
// symbol of a relocation is one of its own, or another module's address), as the loader takes them:
// u32 type << 28 | module << 24 | offset. Modules load 64 KB aligned (as they are linked), so the
// low halves of addresses (LO16) never change: only the high halves move.
function moving(list, base, self, symbols, own) {
  const out = [];
  for (const r of list) {
    const s = symbols[r.sym];
    if (!s) continue;
    let target = -1;
    if (own.has(s.shndx)) target = self;
    else if (s.shndx === 0xFFF1 && s.value >= LINK_BASE && s.value < LINK_BASE + OVERLAYS.length * MODULE_SPAN) target = Math.floor((s.value - LINK_BASE) / MODULE_SPAN);
    if (target < 0) continue;
    if (r.type === R_MIPS_32 || r.type === R_MIPS_26 || r.type === R_MIPS_HI16) out.push(((r.type << 28) | (target << 24) | (r.at - base)) >>> 0);
    else if (r.type !== R_MIPS_LO16 && r.type !== 0) throw new Error(`relocation type ${r.type} at ${r.at.toString(16)} is not supported`);
  }
  return out;
}

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const out = [];
    const child = spawn(cmd, args, opts);
    child.stdout.on('data', (d) => out.push(String(d)));
    child.stderr.on('data', (d) => out.push(String(d)));
    child.on('close', (code) => resolve({ code, out: out.join('') }));
    child.on('error', (e) => resolve({ code: -1, out: String(e) }));
  });
}

/**
 * After the game is built: compiles and links the modules, and puts them with the directory the
 * loader reads after the game in the ROM.
 * tool(name) -> path of a MIPS binutil; makeArgs: the make variables of the build; onLine: log
 * -> { rom: Buffer (the game and the modules), dir: ROM address of the directory, overlays: [{ name, size }] }
 */
export async function buildOverlays(tree, z64, { tool, makeArgs = [], env, onLine = () => {} }) {
  const build = path.join(tree, 'build', 'us');
  const mainElf = parseElf(fs.readFileSync(path.join(build, 'sm64.us.elf')));
  const mods = available();

  // the modules' objects (the game's compile rule)
  const objs = mods.map(objectsOf);
  for (const o of objs.flat()) fs.mkdirSync(path.dirname(path.join(build, o)), { recursive: true });
  const made = await run('make', ['-j8', ...makeArgs, ...objs.flat().map((o) => `build/us/${o}`)], { cwd: tree, env });
  if (made.code !== 0) { onLine(made.out); throw new Error(`the modules did not compile: ${made.out.split('\n').filter((l) => /error/.test(l)).slice(0, 6).join('; ')}`); }

  // the game's symbols (but its trampolines are what other modules call), then each module's
  const main = new Map();
  for (const s of mainElf.symbols) {
    if (s.shndx !== 0 && s.name && (s.bind === 1 || s.bind === 2 || s.shndx === 0xFFF1) && !s.name.startsWith('.') && !main.has(s.name)) main.set(s.name, s.value);
  }
  const baseOf = (i) => LINK_BASE + OVERLAYS.indexOf(mods[i]) * MODULE_SPAN;
  const scriptOf = (i) => {
    const f = path.join(build, `s64ovl_${mods[i].name}.ld`);
    fs.writeFileSync(f, `OUTPUT_ARCH (mips)
SECTIONS {
  . = 0x${baseOf(i).toString(16)};
  .ovl : { *(.text .text.*) *(.rodata .rodata.* .rodata1) *(.data .data.* .sdata .sdata.*) . = ALIGN(16); }
  .ovlbss (NOLOAD) : { *(.bss .bss.* .sbss .sbss.* COMMON) . = ALIGN(16); }
  /DISCARD/ : { *(.MIPS.abiflags) *(.reginfo) *(.pdr) *(.comment) *(.gnu.attributes) *(.mdebug*) *(.note*) }
}
`);
    return f;
  };
  // final: unresolved symbols are errors; roots: only what they reach is linked (with the
  // modules compiled into one section per function and datum)
  const link = async (i, symbols, final, roots = null) => {
    const provide = path.join(build, `s64ovl_${mods[i].name}_syms.ld`);
    fs.writeFileSync(provide, [...symbols].map(([n, v]) => `PROVIDE(${n} = 0x${v.toString(16)});`).join('\n'));
    const out = path.join(build, `s64ovl_${mods[i].name}.elf`);
    const r = await run(tool('ld'), ['-T', provide, '-T', scriptOf(i), '--emit-relocs', '--no-check-sections',
      ...(roots ? ['--gc-sections', ...[...roots].flatMap((n) => ['-u', n])] : []),
      ...(final ? [] : ['--unresolved-symbols=ignore-all', '--noinhibit-exec']), '-o', out, ...objs[i].map((o) => path.join(build, o))], { cwd: tree, env });
    if (r.code !== 0 && (final || !fs.existsSync(out))) {
      onLine(r.out);
      const missing = [...new Set([...r.out.matchAll(/undefined reference to `([^']+)'/g)].map((m) => m[1]))];
      throw new Error(`the module ${mods[i].name} did not link${missing.length ? `: it needs ${missing.slice(0, 20).join(', ')}` : `: ${r.out.split('\n').slice(0, 4).join('; ')}`}`);
    }
    return fs.readFileSync(out);
  };
  const ownSections = (elf) => new Set(elf.sections.filter((x) => x.name === '.ovl' || x.name === '.ovlbss').map((x) => x.index));
  const definedIn = (elf) => { const own = ownSections(elf); return new Map(elf.symbols.filter((s) => (s.bind === 1 || s.bind === 2) && own.has(s.shndx)).map((s) => [s.name, s.value])); };

  // which actor bank a model's data is in (the decomp's actors/groupN.h; common0 and common1 are always loaded)
  const bankOfSymbol = new Map();
  for (const f of fs.readdirSync(path.join(tree, 'actors')).filter((x) => /^group\d+\.h$/.test(x))) {
    for (const m of fs.readFileSync(path.join(tree, 'actors', f), 'utf8').matchAll(/extern\s+[^;]*?\b(\w+)\s*\[\s*\]\s*;/g)) bankOfSymbol.set(m[1], f.replace('.h', ''));
  }

  // 1. each module alone: what it has, and what it needs of the others
  const has = [], needs = [];
  for (let i = 0; i < mods.length; i++) {
    const elf = parseElf(await link(i, main, false));
    has.push(definedIn(elf));
    needs.push(new Set(elf.symbols.filter((s) => s.shndx === 0 && s.name && (s.bind === 1 || s.bind === 2)).map((s) => s.name)));
  }
  // what is reached: the hooks, what the game's data points at (its weak symbols), what the
  // other modules use -- but not what a module leaves out of the ROM
  const gameWants = new Set();
  for (const list of mainElf.rels.values()) for (const r of list) { const s = mainElf.symbols[r.sym]; if (s && s.shndx === 0 && s.bind === 2) gameWants.add(s.name); }
  const rootsOf = (i) => new Set([...has[i].keys()].filter((n) => !(mods[i].omit || []).includes(n)
    && (HOOKS.includes(n) || gameWants.has(n) || needs.some((set, j) => j !== i && set.has(n)))));
  // 2. each module with only what is reached: where everything ends up
  const exportsOf = [];
  for (let i = 0; i < mods.length; i++) {
    const own = new Map([...main].filter(([n]) => !has[i].has(n))); // (its own come first, the hooks too)
    const elf = parseElf(await link(i, own, false, rootsOf(i)));
    exportsOf.push(new Map([...definedIn(elf)].map(([n, v]) => [n, v - baseOf(i)])));
  }
  // 3. linked with the game and the other modules
  const linked = [];
  for (let i = 0; i < mods.length; i++) {
    // the game's (but the other modules' hooks through the game's trampolines), then the others'
    const symbols = new Map([...main].filter(([n]) => !has[i].has(n) && (!exportsOf.some((e) => e.has(n)) || HOOKS.includes(n))));
    exportsOf.forEach((e, j) => { if (j !== i) for (const [n, off] of e) if (!symbols.has(n)) symbols.set(n, baseOf(j) + off); });
    // (what the game names of a module the ROM has not -- the Sunshine characters -- is nowhere)
    for (const n of needs[i]) if (!symbols.has(n) && gameWants.has(n)) symbols.set(n, 0);
    const buf = await link(i, symbols, true, rootsOf(i));
    const elf = parseElf(buf);
    const sec = elf.sections.find((x) => x.name === '.ovl');
    const bss = elf.sections.find((x) => x.name === '.ovlbss');
    // the game's actor banks it draws from (their segment: the level loads them, objects.js)
    const banks = new Set();
    for (const list of elf.rels.values()) for (const r of list) {
      const sy = elf.symbols[r.sym];
      if (sy && sy.shndx === 0xFFF1 && bankOfSymbol.has(sy.name)) banks.add(bankOfSymbol.get(sy.name));
    }
    linked.push({
      ov: mods[i], index: OVERLAYS.indexOf(mods[i]), link: baseOf(i), banks: [...banks].sort(),
      image: Buffer.from(buf.subarray(sec.offset, sec.offset + sec.size)), bss: bss?.size || 0,
      relocs: moving(elf.rels.get(sec.index) || [], baseOf(i), OVERLAYS.indexOf(mods[i]), elf.symbols, ownSections(elf)),
      exports: exportsOf[i],
    });
  }

  // where the game's data points at the modules (weak symbols): filled in at load (pointers in its
  // data: the catalog)
  const fixups = [];
  const unresolved = new Set();
  for (const [secIndex, list] of mainElf.rels) {
    const sec = mainElf.sections[secIndex];
    if (!sec || sec.type !== 1 || sec.addr < 0x80000000) continue;
    for (const r of list) {
      const s = mainElf.symbols[r.sym];
      if (!s || s.shndx !== 0 || s.bind !== 2) continue;
      const owner = linked.find((l) => l.exports.has(s.name));
      if (!owner) { unresolved.add(s.name); continue; }
      if (r.type !== R_MIPS_32) throw new Error(`the game's code takes ${s.name} of a module directly (relocation ${r.type})`);
      fixups.push([r.at, owner.index, owner.exports.get(s.name)]);
    }
  }

  // the directory: a header, an entry per module (by its index in OVERLAYS: absent ones are empty),
  // the fixups, then per module its relocations, its hooks and its image
  const count = OVERLAYS.length;
  const fixAt = 16 + count * 32;
  let at = fixAt + fixups.length * 12;
  const entries = linked.map((l) => {
    const hooks = HOOKS.map((h, k) => [k, l.exports.get(h)]).filter(([, o]) => o !== undefined);
    const e = { l, hooks, relocAt: at };
    at += l.relocs.length * 4;
    e.hooksAt = at;
    at = Math.ceil((at + hooks.length * 8) / 16) * 16;
    e.imageAt = at;
    at = Math.ceil((at + l.image.length) / 16) * 16;
    return e;
  });
  const dir = Buffer.alloc(at);
  dir.writeUInt32BE(DIR_MAGIC, 0);
  dir.writeUInt32BE(count, 4);
  dir.writeUInt32BE(fixups.length, 8);
  dir.writeUInt32BE(fixAt, 12);
  for (const e of entries) {
    const o = 16 + e.l.index * 32;
    dir.writeUInt32BE(e.imageAt, o);
    dir.writeUInt32BE(e.l.image.length, o + 4);
    dir.writeUInt32BE(e.l.bss, o + 8);
    dir.writeUInt32BE(e.l.relocs.length, o + 12);
    dir.writeUInt32BE(e.relocAt, o + 16);
    dir.writeUInt32BE(e.hooks.length, o + 20);
    dir.writeUInt32BE(e.hooksAt, o + 24);
    dir.writeUInt32BE(e.l.link, o + 28);
    e.l.relocs.forEach((w, k) => dir.writeUInt32BE(w, e.relocAt + k * 4));
    e.hooks.forEach(([k, off], j) => { dir.writeUInt32BE(k, e.hooksAt + j * 8); dir.writeUInt32BE(off, e.hooksAt + j * 8 + 4); });
    e.l.image.copy(dir, e.imageAt);
  }
  fixups.forEach(([a, owner, off], k) => {
    dir.writeUInt32BE(a >>> 0, fixAt + k * 12);
    dir.writeUInt32BE(owner, fixAt + k * 12 + 4);
    dir.writeUInt32BE(off, fixAt + k * 12 + 8);
  });
  const dirAt = Math.ceil(z64.length / 16) * 16;
  const rom = Buffer.alloc(dirAt + dir.length);
  z64.copy(rom);
  dir.copy(rom, dirAt);
  return {
    rom, dir: dirAt,
    overlays: linked.map((l) => ({ name: l.ov.name, index: l.index, size: l.image.length + l.bss, relocs: l.relocs.length, banks: l.banks })),
    fixups: fixups.length, unresolved: [...unresolved],
  };
}
