#!/usr/bin/env node
// Working on the ROM's code: keeps a build tree of the base ROM up to date with
// server/romexport/ (base.js changes, n64/ sources, the engine's Studio 64 modules) and rebuilds
// only what changed. --install makes the result this Studio 64's base ROM (for ROM exports).
//   node tools/romkit_dev.mjs [--install] [--tree DIR] [-j N]
// (needs engine/baserom.us.z64; the tree defaults to <romkit>/dev)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureToolchain, toolchainEnv, buildEnv, extract, ROOT } from './lib/toolchain.mjs';
import { KIT_DIR, kitVersion, ensureMips, makeVars, pristineDir, downloadDecomp, indexKit } from '../server/romexport/romkit.js';
import { syncTree } from '../server/romexport/base.js';
import { buildOverlays } from '../server/romexport/overlays.js';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const tree = path.resolve(opt('--tree', path.join(KIT_DIR, 'dev')));
const jobs = opt('-j', String(Math.min(os.cpus().length, 8)));

const tc = await ensureToolchain({ onStatus: console.log });
const mips = await ensureMips({ onStatus: console.log });
const env = buildEnv(toolchainEnv(process.env, tc), { prepend: [mips.bin] });

const pristine = pristineDir();
if (!fs.existsSync(path.join(pristine, 'Makefile'))) extract(await downloadDecomp(console.log), pristine, 1);
if (!fs.existsSync(path.join(tree, 'Makefile'))) {
  console.log(`New build tree: ${tree}`);
  fs.cpSync(pristine, tree, { recursive: true, preserveTimestamps: true });
  const cached = fs.readdirSync(KIT_DIR).find((d) => d.startsWith('tools-') && fs.existsSync(path.join(KIT_DIR, d, '.studio64-ok')));
  if (cached) fs.cpSync(path.join(KIT_DIR, cached), path.join(tree, 'tools'), { recursive: true, preserveTimestamps: true });
}
fs.copyFileSync(path.join(ROOT, 'engine', 'baserom.us.z64'), path.join(tree, 'baserom.us.z64'));
const changed = syncTree(tree, pristine);
console.log(changed.length ? `Changed: ${changed.join(', ')}` : 'No source changes');
// (make does not see its own flags change: the modules compile again with them)
if (changed.includes('Makefile')) fs.rmSync(path.join(tree, 'build', 'us', 'src', 'studio'), { recursive: true, force: true });

const code = await new Promise((resolve) => {
  const child = spawn('make', ['-k', `-j${jobs}`, ...makeVars(mips, env, tc.python.pre?.length ? null : tc.python.cmd)], { cwd: tree, env });
  const keep = (d) => { for (const l of String(d).split('\n')) if (/error|warning: implicit|undefined reference|Error \d/.test(l)) console.log(l); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  child.on('close', resolve);
});
if (code !== 0) { console.log('Build failed'); process.exit(1); }
const game = fs.readFileSync(path.join(tree, 'build', 'us', 'sm64.us.z64'));
// Studio 64's modules after the game
let ovl;
try {
  ovl = await buildOverlays(tree, game, { tool: (n) => path.join(mips.bin, `${mips.prefix}${n}`), makeArgs: makeVars(mips, env, tc.python.pre?.length ? null : tc.python.cmd), env, onLine: console.log });
} catch (e) { console.log(`Modules: ${e.message}`); process.exit(1); }
const z64 = ovl.rom;
console.log(`Built: ${path.join(tree, 'build', 'us')} (ROM ${z64.length} bytes; modules ${ovl.overlays.map((o) => `${o.name} ${(o.size / 1024).toFixed(0)} KB`).join(', ')}; ${ovl.fixups} fixups${ovl.unresolved.length ? `; not in a module: ${ovl.unresolved.slice(0, 12).join(' ')}` : ''})`);

if (args.includes('--install')) {
  const dir = path.join(KIT_DIR, kitVersion());
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'romkit.json'), JSON.stringify({ ...(await indexKit(tree, z64, mips, env)), modules: { dir: ovl.dir, list: ovl.overlays } }));
  fs.writeFileSync(path.join(dir, 'base.z64'), z64);
  // (older versions of the base ROM are not needed any more, as after a full build)
  for (const d of fs.readdirSync(KIT_DIR)) if (/^[0-9a-f]{12}$/.test(d) && d !== kitVersion()) fs.rmSync(path.join(KIT_DIR, d), { recursive: true, force: true });
  console.log(`Installed as base ROM ${kitVersion()} (restart the server to use it)`);
}
