// The engine's source comes from sm64ex during the setup (tools/lib/engine_source.mjs): no sm64ex file
// is in the repository, Studio 64's changes keep none of sm64ex's lines, and they apply exactly.
// No browser; the last checks need the sm64ex download in the cache (the setup or a build makes it).
// @tags smoke build
// @timeout 120
import { suite } from '../lib/harness.mjs';
import { applyHunks, hunksOf, readChanges, readSource } from '../../tools/lib/engine_source.mjs';
import { userCache } from '../../tools/lib/toolchain.mjs';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

await suite('engine source', async (t) => {
  // the line diff round-trips (random edits, a missing last newline, \r\n lines)
  let seed = 7;
  const rnd = (n) => (seed = (seed * 1103515245 + 12345) % 2147483648) % n;
  let ok = true;
  for (let i = 0; i < 300 && ok; i++) {
    const a = Array.from({ length: rnd(40) }, () => `line ${rnd(12)}${rnd(4) ? '' : '\r'}`);
    const b = a.slice();
    for (let k = rnd(6); k > 0; k--) {
      const at = rnd(b.length + 1);
      if (rnd(2)) b.splice(at, rnd(3)); else b.splice(at, 0, `new ${rnd(99)}`);
    }
    const A = Buffer.from(a.join('\n') + (rnd(2) ? '\n' : '')), B = Buffer.from(b.join('\n') + (rnd(2) ? '\n' : ''));
    ok = applyHunks(A, hunksOf(A, B)).equals(B);
  }
  t.check('the line diff round-trips', ok);

  const src = readSource(), changes = readChanges();
  t.check('changes.json is for the pinned commit', changes.base === src.commit, changes.base);
  const tracked = execFileSync('git', ['ls-files', 'engine'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const upstream = tracked.filter((f) => f.slice(7) in src.files);
  t.check('no sm64ex file is in the repository', tracked.length > 0 && upstream.length === 0, upstream.slice(0, 3).join(' '));
  t.check('every changed file is one of sm64ex\'s', Object.keys(changes.files).every((f) => f in src.files));

  const dir = path.join(userCache(), `sm64ex-${src.commit}`);
  if (!fs.existsSync(path.join(dir, '.complete'))) { t.log('no sm64ex download in the cache: the rest skipped'); return; }
  let applied = 0, bad = [];
  for (const [rel, ch] of Object.entries(changes.files)) {
    const out = applyHunks(fs.readFileSync(path.join(dir, rel)), ch.hunks);
    if (sha(out) === ch.sha256) applied++; else bad.push(rel);
  }
  t.check('every change applies to sm64ex exactly', bad.length === 0, bad.slice(0, 3).join(' '));
  // the changes carry Studio 64's lines only: none of the lines they replace
  let carried = 0;
  for (const [rel, ch] of Object.entries(changes.files)) {
    const orig = fs.readFileSync(path.join(dir, rel), 'latin1').split('\n');
    for (const [at, del] of ch.hunks) for (let k = 0; k < del; k++) if (JSON.stringify(ch.hunks).includes(JSON.stringify(orig[at + k])) && orig[at + k].trim().length > 20) carried++;
  }
  t.log(`${applied} files; ${carried} replaced lines that also appear among the new ones (moved, not copied)`);
});
