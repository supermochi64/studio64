#!/usr/bin/env node
// Refresh the Shoggoth content from a Shoggoth World checkout (developer tool).
//
//   node tools/shoggoth/refresh.mjs [path/to/sm64-master]      (or SHOGGOTH_DIR; default ../sm64-master)
//   npm run shoggoth:refresh
//
// Studio 64 ships the Shoggoth content (Tokyo, Shotgun Mario and the gangsters, the cars, Katana Mario and
// the katana fighters) in the repository; this is how it is made. It only reads the checkout (the hack
// must have been built once: some textures come from its build/us) and then:
//   1. runs the four extractors: tools/import_shoggoth_tokyo.mjs, tools/shotgun_extract.py,
//      tools/vehicles/extract_cars.py, tools/katana_extract.py,
//   2. takes the game's own data back out of what they wrote (tools/shoggoth/split_vanilla.py: the
//      vanilla Toad's and Goomba's triangles and textures become recipes, rom_recipes.json, that every
//      engine build turns back into C from the user's ROM: tools/shoggoth/rom_parts.py),
//   3. checks that nothing of the game's is left (split_vanilla.py --check) and makes the romgen files
//      for this machine.
// Then rebuild the engine (npm run build:engine) and commit the result.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.resolve(process.argv[2] || process.env.SHOGGOTH_DIR || path.join(ROOT, '..', 'sm64-master'));
if (!fs.existsSync(path.join(SRC, 'levels', 'tokyo'))) {
  console.error(`No Shoggoth World checkout at ${SRC} (levels/tokyo). Nothing to refresh: the shipped content stays as it is.`);
  process.exit(1);
}
const PY = process.env.PYTHON || 'python3';
const run = (cmd, args, env = {}) => {
  console.log(`$ ${[cmd, ...args].map((a) => path.relative(ROOT, a) && !a.startsWith('-') && fs.existsSync(a) ? path.relative(ROOT, a) : a).join(' ')}`);
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, SHOGGOTH_DIR: SRC, ...env } });
};

// 1. extract
run(process.execPath, [path.join(ROOT, 'tools', 'import_shoggoth_tokyo.mjs'), '--force', SRC]);
run(PY, [path.join(ROOT, 'tools', 'shotgun_extract.py')]);
run(PY, [path.join(ROOT, 'tools', 'vehicles', 'extract_cars.py'), SRC]);
run(PY, [path.join(ROOT, 'tools', 'katana_extract.py'), SRC]);

// 2. the game's data out (package, recipes, files)
// (tools/shoggoth/packages.json: each package's recipes and the files they came out of)
const PACKAGES = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'shoggoth', 'packages.json'), 'utf8'));
const split = path.join(ROOT, 'tools', 'shoggoth', 'split_vanilla.py');
for (const p of PACKAGES) run(PY, [split, p.name, path.join(ROOT, p.recipes), ...p.files.map((f) => path.join(ROOT, f))]);

// 3. check, and this machine's romgen files
run(process.execPath, [path.join(ROOT, 'tools', 'shoggoth', 'check_shipped.mjs')]);
run(PY, [path.join(ROOT, 'tools', 'shoggoth', 'rom_parts.py'), '--force']);
console.log('Shoggoth content refreshed. Rebuild the engine: npm run build:engine');
