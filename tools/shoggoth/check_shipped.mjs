#!/usr/bin/env node
// Checks that the shipped Shoggoth content holds none of the game's own data (no vanilla triangles, no
// textures recoloured from vanilla ones): tools/shoggoth/split_vanilla.py --check on every package of
// tools/shoggoth/packages.json. Needs the game's actor files (engine/actors: the decomp's models and the
// textures extracted from your ROM). Exit code 1 if anything is found. Run by refresh.mjs and a test.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PY = process.env.PYTHON || 'python3';
let bad = 0;
for (const p of JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'shoggoth', 'packages.json'), 'utf8'))) {
  const r = spawnSync(PY, [path.join(ROOT, 'tools', 'shoggoth', 'split_vanilla.py'), '--check', p.name, path.join(ROOT, p.recipes),
    ...p.files.map((f) => path.join(ROOT, f))], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) bad++;
}
process.exit(bad ? 1 : 0);
