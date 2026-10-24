// The base ROM's version is the same on every computer, so the base patch that ships with Studio 64
// fits everyone's: the object catalog it is built from must not depend on a Super Mario Sunshine
// disc or on the order a file system lists folders in. The ROM export writes catalog indices, so the
// catalog without the disc must also be the start of the one with it. No browser.
// @tags export smoke
// @timeout 120
import { suite } from '../lib/harness.mjs';
import { systemPython } from '../../tools/lib/toolchain.mjs';
import { kitCatalog } from '../../server/romexport/base.js';
import { kitVersion, patchName } from '../../server/romexport/romkit.js';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

await suite('the base ROM version is the same everywhere', async (t) => {
  const py = systemPython();
  if (!py) { t.log('no Python here: skipped'); return; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's64kit-'));
  const gen = (name, env = {}) => {
    const out = path.join(tmp, name);
    fs.mkdirSync(out);
    const r = spawnSync(py.cmd, [...py.pre, path.join(ROOT, 'tools', 'gen_catalog.py')],
      { cwd: ROOT, env: { ...process.env, S64_CATALOG_OUT: out, ...env }, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`gen_catalog.py: ${r.stderr}`);
    return { c: fs.readFileSync(path.join(out, 'catalog.inc.c'), 'utf8'), json: JSON.parse(fs.readFileSync(path.join(out, 'catalog.json'), 'utf8')) };
  };
  try {
    const here = gen('here'), again = gen('again'), plain = gen('plain', { S64_CATALOG_NO_SMS: '1' });
    t.check('the catalog comes out the same twice', here.c === again.c);
    t.check('the base ROM\'s catalog is the same with and without a Sunshine disc', kitCatalog(here.c) === kitCatalog(plain.c));
    t.check('no Sunshine character is in the base ROM\'s catalog', !/bhvSms(StrollinStu|SwoopinStu|Pokey|Blooper|Shine)\b/.test(kitCatalog(here.c)));
    const ids = (j) => j.entries.map((e) => e.id);
    t.check('without the disc, every entry has the index it has with it',
      ids(plain.json).every((id, i) => ids(here.json)[i] === id));
    t.check('without the disc, every behavior has the index it has with it',
      plain.json.behaviors.every((b, i) => here.json.behaviors[i] === b));
    t.check('the shipped base patch is the one for this version',
      fs.existsSync(path.join(ROOT, 'server', 'romexport', 'base', patchName(kitVersion()))), patchName(kitVersion()));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
