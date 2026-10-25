// The engine's source comes from sm64ex (github.com/sm64pc/sm64ex) at a pinned commit, downloaded during
// the setup: the decompiled game, its levels, models and text are not in this repository. Studio 64 keeps
// only its own files in engine/ and, in engine-upstream/, what it changes in sm64ex's files: for each file
// the places and Studio 64's own new lines (never the lines they replace) and the checksum of the result.
//   engine-upstream/source.json    the commit, where to get it, the SHA-256 of every file in it
//   engine-upstream/changes.json   Studio 64's changes to sm64ex's files, and the files it removes
// ensureEngineSource() puts sm64ex's files into engine/ and applies the changes (once per version);
// tools/engine_source.mjs diff writes changes.json again after you changed an sm64ex file in engine/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, ToolError, download, extract, userCache } from './toolchain.mjs';

export const ENGINE = path.join(ROOT, 'engine');
const UP = path.join(ROOT, 'engine-upstream');
const STAMP = path.join(ENGINE, '.engine-source.json');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
export const readSource = () => JSON.parse(fs.readFileSync(path.join(UP, 'source.json'), 'utf8'));
export const readChanges = () => JSON.parse(fs.readFileSync(path.join(UP, 'changes.json'), 'utf8'));
const stampOf = (src, changesText) => ({ commit: src.commit, changes: sha(changesText) });

/** The untouched sm64ex tree in the shared cache (downloaded and checked once). */
export async function pristine({ onStatus = () => {}, onProgress = () => {} } = {}) {
  const src = readSource();
  const dir = path.join(userCache(), `sm64ex-${src.commit}`);
  const done = path.join(dir, '.complete');
  if (fs.existsSync(done)) return dir;
  onStatus(`Downloading the game engine's source (sm64ex ${src.commit.slice(0, 7)}, about ${Math.round(src.size / 1e6)} MB, once)`);
  const tgz = path.join(userCache(), 'downloads', `sm64ex-${src.commit}.tar.gz`);
  fs.mkdirSync(path.dirname(tgz), { recursive: true });
  // (no archive checksum: GitHub may pack it differently over time; every file is checked below)
  if (!fs.existsSync(tgz)) await download(src.urls, tgz, null, onProgress);
  const tmp = `${dir}.tmp`;
  extract(tgz, tmp, 1);
  const bad = [];
  for (const [rel, want] of Object.entries(src.files)) {
    const f = path.join(tmp, rel);
    if (!fs.existsSync(f) || sha(fs.readFileSync(f)) !== want) bad.push(rel);
  }
  if (bad.length) {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(tgz, { force: true });
    throw new ToolError('The engine source download was damaged', `${bad.length} file(s) do not match, for example ${bad[0]}.`, 'Press Try again. If it happens again, your network may be changing downloads (a proxy or filter).');
  }
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  fs.writeFileSync(done, src.commit);
  return dir;
}

/** A file's lines (split at \n, so \r and a missing last newline stay as they are). */
const linesOf = (buf) => buf.toString('latin1').split('\n');
const bufOf = (lines) => Buffer.from(lines.join('\n'), 'latin1');

/** Studio 64's version of an sm64ex file: the hunks [start, removed, added lines] applied from the end. */
export function applyHunks(buf, hunks) {
  const lines = linesOf(buf);
  for (const [at, del, add] of [...hunks].sort((a, b) => b[0] - a[0])) lines.splice(at, del, ...add);
  return bufOf(lines);
}

/** The hunks that turn a into b (Myers' diff on lines): only positions and b's own lines. */
export function hunksOf(aBuf, bBuf) {
  const a = linesOf(aBuf), b = linesOf(bBuf);
  // trim the common start and end, then diff the middle
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const A = a.slice(s, a.length - e), B = b.slice(s, b.length - e);
  const n = A.length, m = B.length, max = n + m, off = max + 1;
  const v = new Int32Array(2 * max + 3), trace = [];
  let found = n === 0 && m === 0;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
  }
  // walk back: the edit script as (aIndex, bIndex) steps
  const edits = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d], k = x - y;
    const prevK = (k === -d || (k !== d && vv[off + k - 1] < vv[off + k + 1])) ? k + 1 : k - 1;
    const px = vv[off + prevK], py = px - prevK;
    while (x > px && y > py) { x--; y--; edits.push(['=', x, y]); }
    if (d > 0) { if (x === px) { y--; edits.push(['+', x, y]); } else { x--; edits.push(['-', x, y]); } }
  }
  edits.reverse();
  const hunks = [];
  let cur = null;
  for (const [op, i, j] of edits) {
    if (op === '=') { cur = null; continue; }
    if (!cur) { cur = [s + i, 0, []]; hunks.push(cur); }
    if (op === '-') cur[1]++; else cur[2].push(B[j]);
  }
  // a line the diff removed and added again at a hunk's edge stays where it was (so the hunks carry
  // only new lines): trim what the removed and the added lines share at the start and at the end
  for (const h of hunks) {
    while (h[1] && h[2].length && a[h[0]] === h[2][0]) { h[0]++; h[1]--; h[2].shift(); }
    while (h[1] && h[2].length && a[h[0] + h[1] - 1] === h[2][h[2].length - 1]) { h[1]--; h[2].pop(); }
  }
  return hunks.filter((h) => h[1] || h[2].length);
}

function walk(dir, rel = '', out = []) {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(dir, r, out); else if (e.isFile()) out.push(r);
  }
  return out;
}

/** sm64ex's files in engine/, with Studio 64's changes (nothing to do when they are already there). */
export async function ensureEngineSource({ onStatus = () => {}, onProgress = () => {}, force = false } = {}) {
  const src = readSource();
  const changesText = fs.readFileSync(path.join(UP, 'changes.json'), 'utf8');
  const want = stampOf(src, changesText);
  let have = null;
  try { have = JSON.parse(fs.readFileSync(STAMP, 'utf8')); } catch { /* first time */ }
  if (!force && have && have.commit === want.commit && have.changes === want.changes) return false;
  const changes = JSON.parse(changesText);
  const dir = await pristine({ onStatus, onProgress });
  onStatus("Putting the engine's source together");
  const backup = path.join(ENGINE, '.engine-source-backup');
  let saved = 0;
  for (const rel of Object.keys(src.files)) {
    const from = path.join(dir, rel), to = path.join(ENGINE, rel);
    const ch = changes.files[rel];
    const body = ch ? applyHunks(fs.readFileSync(from), ch.hunks) : fs.readFileSync(from);
    if (ch && sha(body) !== ch.sha256) throw new ToolError('Applying Studio 64\'s changes to the engine failed', `${rel} does not come out as it should.`, 'Download Studio 64 again (the folder may be incomplete).');
    let old = null;
    try { old = fs.readFileSync(to); } catch { /* new */ }
    if (old && old.equals(body)) continue;
    // a file someone changed by hand since the last time (and did not write into changes.json): kept aside
    if (old && have && !(changes.files[rel] && sha(old) === changes.files[rel].sha256) && sha(old) !== src.files[rel]) {
      fs.mkdirSync(path.dirname(path.join(backup, rel)), { recursive: true });
      fs.writeFileSync(path.join(backup, rel), old);
      saved++;
    }
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, body);
    fs.chmodSync(to, fs.statSync(from).mode & 0o777);
  }
  for (const rel of changes.deleted || []) fs.rmSync(path.join(ENGINE, rel), { force: true });
  fs.writeFileSync(STAMP, `${JSON.stringify(want)}\n`);
  if (saved) onStatus(`(${saved} file(s) you had changed are in engine/.engine-source-backup/)`);
  return true;
}

/** changes.json from what is in engine/ now (for developers: after changing an sm64ex file). */
export async function writeChanges() {
  const src = readSource();
  const dir = await pristine();
  const files = {}, deleted = [];
  for (const rel of Object.keys(src.files).sort()) {
    const to = path.join(ENGINE, rel);
    if (!fs.existsSync(to)) { deleted.push(rel); continue; }
    const a = fs.readFileSync(path.join(dir, rel)), b = fs.readFileSync(to);
    if (a.equals(b)) continue;
    const hunks = hunksOf(a, b);
    if (!applyHunks(a, hunks).equals(b)) throw new Error(`diff of ${rel} does not round-trip`);
    files[rel] = { sha256: sha(b), hunks };
  }
  const text = `${JSON.stringify({ base: src.commit, files, deleted }, null, 1)}\n`;
  fs.writeFileSync(path.join(UP, 'changes.json'), text);
  fs.writeFileSync(STAMP, `${JSON.stringify(stampOf(src, text))}\n`);
  return { files: Object.keys(files).length, deleted: deleted.length };
}

/** source.json for a commit (for developers, when moving to another sm64ex version). */
export async function writeSource(commit, tarball) {
  const tmp = fs.mkdtempSync(path.join(userCache(), 'sm64ex-new-'));
  extract(tarball, tmp, 1);
  const files = {};
  for (const rel of walk(tmp).sort()) files[rel] = sha(fs.readFileSync(path.join(tmp, rel)));
  fs.rmSync(tmp, { recursive: true, force: true });
  const src = {
    repo: 'https://github.com/sm64pc/sm64ex', commit,
    urls: [`https://codeload.github.com/sm64pc/sm64ex/tar.gz/${commit}`, `https://github.com/sm64pc/sm64ex/archive/${commit}.tar.gz`],
    size: fs.statSync(tarball).size, files,
  };
  fs.mkdirSync(UP, { recursive: true });
  fs.writeFileSync(path.join(UP, 'source.json'), `${JSON.stringify(src, null, 1)}\n`);
  return Object.keys(files).length;
}
