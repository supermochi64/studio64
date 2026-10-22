// Decomp export: edits of original levels become level script C (OBJECT / WARP_NODE) that
// compiles against the decomp's headers (engine/include), with notes for what it cannot hold.
// @tags projects export
// @timeout 120
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { suite, URL_BASE, ROOT } from '../lib/harness.mjs';
import { zipRead } from '../../server/zip.js';

await suite('decomp export', async (t) => {
  const catalog = await fetch(`${URL_BASE}/api/catalog`).then((r) => r.json());
  // every vanilla catalog object once in BoB, a pipe pair, a removal, a block, a Sunshine Pianta
  const objs = catalog.entries.filter((e) => !/^(sms|sg|kt|vehicle|tokyo):/.test(e.id)).map((e, i) => ({ uid: 1000 + i, entry: e.id, x: i * 10, y: 0, z: 0, yaw: (i * 997) & 0xffff, bparams: parseInt(e.params?.[0] || '0', 16) >>> 0, scale: 1 }));
  const doc = {
    name: 'Decomp test', boot: { level: 9 }, levels: [],
    areas: {
      '9:1': { objects: [...objs, { uid: 9, block: { shape: 0, sx: 100, sy: 100, sz: 100 }, x: 0, y: 0, z: 0 }, { uid: 10, entry: 'sms:pianta_man', x: 0, y: 0, z: 0 }], removals: [{ bhv: 'bhvGoomba', name: 'Goomba', x: 1, y: 2, z: 3 }], warps: [{ node: 0x9a, destLevel: 9, destArea: 1, destNode: 0x9b }, { node: 0x9b, destLevel: 16, destArea: 1, destNode: 0x0a }] },
      '16:1': { objects: [{ uid: 5, entry: 'star', x: 0, y: 500, z: 0, bparams: 0x03000000, star: { name: 'Roof star' } }], removals: [], warps: [] },
    },
  };
  const imp = await fetch(`${URL_BASE}/api/hub/import`, { method: 'POST', body: JSON.stringify(doc) }).then((r) => r.json());
  t.must('test project imported', !!imp.id, imp);
  const buf = Buffer.from(await (await fetch(`${URL_BASE}/api/projects/${imp.id}/decomp.zip`)).arrayBuffer());
  const files = zipRead(buf);
  t.check('README and two level files', files.has('README.txt') && files.has('levels/bob/studio_area_1.inc.c') && files.has('levels/castle_grounds/studio_area_1.inc.c'), [...files.keys()]);
  const bob = files.get('levels/bob/studio_area_1.inc.c').toString();
  t.eq('every catalog object became an OBJECT', (bob.match(/^\s+OBJECT\(/gm) || []).length, objs.length);
  t.check('the pipe warps became WARP_NODEs', /WARP_NODE\(\/\*id\*\/ 0x9A, \/\*destLevel\*\/ LEVEL_BOB, \/\*destArea\*\/ 1, \/\*destNode\*\/ 0x9B/.test(bob) && /LEVEL_CASTLE_GROUNDS/.test(bob));
  t.check('notes: the removed Goomba, the block, the custom object', /remove the original Goomba \(bhvGoomba\)/.test(bob) && /1 block/.test(bob) && /1 object\(s\) use Studio 64/.test(bob));
  // compile both files against the decomp headers
  let cc = null;
  for (const c of ['gcc', 'clang', 'cc']) { try { execFileSync(c, ['--version'], { stdio: 'ignore' }); cc = c; break; } catch { /* next */ } }
  if (!cc) { t.log('no C compiler: compile check skipped'); return; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's64decomp-'));
  for (const [n, d] of files) { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), d); }
  for (const [n] of files) {
    if (!n.endsWith('.inc.c')) continue;
    const main = path.join(dir, `check_${n.replace(/\W/g, '_')}.c`);
    fs.writeFileSync(main, `#include <ultra64.h>\n#include "sm64.h"\n#include "behavior_data.h"\n#include "model_ids.h"\n#include "level_commands.h"\n#include "${n}"\nconst void *use = ${path.basename(n, '.inc.c')};\n`);
    let err = '';
    try {
      execFileSync(cc, ['-fsyntax-only', '-Werror=implicit-function-declaration', '-I', path.join(ROOT, 'engine/include'), '-I', path.join(ROOT, 'engine/src'), '-I', path.join(ROOT, 'engine'), '-I', dir, '-DVERSION_US', '-DNON_MATCHING', '-DAVOID_UB', '-D_LANGUAGE_C', '-DF3DEX_GBI_2E', main], { stdio: 'pipe' });
    } catch (e) { err = String(e.stderr || e.message).slice(0, 800); }
    t.check(`${n} compiles against the decomp headers`, !err, err);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
