#!/usr/bin/env node
// Makes the release ZIP that people download (no git, no developer tools needed):
//
//   studio64-<version>.zip
//   └── Studio 64/
//       ├── Start Studio 64.bat        Windows: double-click
//       ├── Start Studio 64.command    macOS: double-click (executable)
//       ├── start-studio64.sh          Linux: double-click / ./start-studio64.sh (executable)
//       ├── GETTING STARTED.txt        the three steps, for people who never open GitHub
//       ├── README.md, LICENSE, docs/
//       └── engine/ server/ tools/ web/ package.json package-lock.json ...
//
// It holds what git would publish: everything the .gitignore files leave out stays out (your ROM,
// everything extracted or built from it, node_modules, the setup's downloads), and the developer
// files too (tests/, .github/, nested .git folders). Then it checks that no file of
// the game's data slipped in.
//   node tools/make_release_zip.mjs [--out dir] [--name "Studio 64"] [--check-git]
//   --check-git   also compare the engine/ file list with git's (needs git; for developers)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const OUT = path.resolve(opt('--out', path.join(ROOT, 'dist')));
const TOP = opt('--name', 'Studio 64');
const ZIP = path.join(OUT, `studio64-${pkg.version}.zip`);

// developer files that git publishes but a download does not need
const DEV = [/^tests\/(?!lib\/).+/ /* (tests/lib: the sample makers drive the game with its harness) */, /(^|\/)\.github\//, /^dist\//, /(^|\/)\.git(\/|$)/, /^\.gitignore$/, /^\.gitattributes$/, /(^|\/)__pycache__\//,
  /^engine\/lib\/discord\// /* desktop-only Discord libraries */];
// what the top folder may hold (anything else there, like a work folder of a promo video, stays out)
const TOP_ALLOW = new Set(['Start Studio 64.bat', 'Start Studio 64.command', 'start-studio64.sh', 'GETTING STARTED.txt', 'README.md', 'LICENSE', 'CHANGELOG.md',
  'CONTRIBUTING.md', 'package.json', 'package-lock.json', 'start.sh', 'Dockerfile', 'docker-compose.yml', '.dockerignore',
  'docs', 'engine', 'server', 'tools', 'web', 'tests']);
const skippedTop = [];
// executables in the ZIP (the rest keeps the mode it has here, minus write bits for others)
const EXEC = new Set(['Start Studio 64.command', 'start-studio64.sh', 'start.sh', 'tools/launch.sh', 'tools/build_engine.sh']);

// ---- .gitignore --------------------------------------------------------------------------------
function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === '/';
        re += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '[') { const j = glob.indexOf(']', i + 1); if (j > i) { re += glob.slice(i, j + 1).replace(/^\[!/, '[^'); i = j; } else re += '\\['; }
    else if (c === '\\' && i + 1 < glob.length) { re += glob[i + 1].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'); i++; }
    else re += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  return re;
}

function parseIgnore(file, base) {
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const rules = [];
  for (let line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    line = line.replace(/(?<!\\)\s+$/, '');
    if (!line) continue;
    let neg = false;
    if (line.startsWith('!')) { neg = true; line = line.slice(1); }
    else if (line.startsWith('\\!') || line.startsWith('\\#')) line = line.slice(1);
    let dirOnly = false;
    if (line.endsWith('/')) { dirOnly = true; line = line.slice(0, -1); }
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    const body = globToRe(line);
    rules.push({ neg, dirOnly, base, re: new RegExp(anchored ? `^${body}$` : `(?:^|/)${body}$`) });
  }
  return rules;
}

/** Is rel (a path from ROOT; isDir) ignored by these rules? The last matching rule wins. */
function ignored(rules, rel, isDir) {
  let out = false;
  for (const r of rules) {
    if (r.dirOnly && !isDir) continue;
    if (r.base && !(rel === r.base || rel.startsWith(r.base + '/'))) continue;
    const sub = r.base ? rel.slice(r.base.length + 1) : rel;
    if (!sub) continue;
    if (r.re.test(sub)) out = !r.neg;
  }
  return out;
}

// ---- the files -----------------------------------------------------------------------------------
const files = [];
function walk(dirRel, rules) {
  const abs = path.join(ROOT, dirRel);
  const here = [...rules, ...parseIgnore(path.join(abs, '.gitignore'), dirRel)];
  for (const ent of fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = dirRel ? `${dirRel}/${ent.name}` : ent.name;
    if (ent.isSymbolicLink()) continue;
    const isDir = ent.isDirectory();
    if (!dirRel && !TOP_ALLOW.has(ent.name)) { if (!ignored(here, rel, isDir) && !DEV.some((re) => re.test(isDir ? `${rel}/` : rel))) skippedTop.push(ent.name); continue; }
    if (DEV.some((re) => re.test(isDir ? `${rel}/` : rel))) continue;
    if (ignored(here, rel, isDir)) continue;
    if (isDir) walk(rel, here);
    else if (ent.isFile()) files.push(rel);
  }
}
walk('', []);
if (skippedTop.length) console.log(`(left out, not part of Studio 64: ${skippedTop.join(', ')})`);

// ---- no game data --------------------------------------------------------------------------------
const bad = files.filter((f) => /\.(z64|n64|v64|iso|gcm|wasm)$/i.test(f)
  || /^web\/(engine|thumbs)\//.test(f) || /^engine\/(build|src\/studio\/(gen|romgen|sms\/gen))\//.test(f)
  || /^engine\/(levels|actors|textures)\/.*\.png$/.test(f) && !/custom/.test(f)
  || /^engine\/sound\/.*\.(aiff|m64)$/.test(f) && !/custom/.test(f)
  || /^server\/(projects\/|samples\/.*\.s64hack$)/.test(f) || /^web\/data\/(story_font\.png|story_texts\.json|textures\.json)$/.test(f));
if (bad.length) {
  console.error(`These files come from the game or a build and must not be in the ZIP:\n  ${bad.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
// the base ROM for ROM exports comes with it (as a patch: tools/make_romkit.mjs), for this version
{
  // (its version needs the object catalog, which the engine build makes: a fresh checkout makes it here)
  const gen = path.join(ROOT, 'engine', 'src', 'studio', 'gen', 'catalog.inc.c');
  if (!fs.existsSync(gen)) {
    const { systemPython } = await import('./lib/toolchain.mjs');
    const py = process.env.S64_PYTHON ? { cmd: process.env.S64_PYTHON, pre: [] } : systemPython();
    if (!py) { console.error('Python 3.10+ is needed to make the object catalog (tools/gen_catalog.py)'); process.exit(1); }
    fs.mkdirSync(OUT, { recursive: true });
    const out = fs.mkdtempSync(path.join(OUT, '.catalog-'));
    const r = spawnSync(py.cmd, [...py.pre, path.join(ROOT, 'tools', 'gen_catalog.py')], { cwd: ROOT, env: { ...process.env, S64_CATALOG_OUT: out }, stdio: 'inherit' });
    if (r.status !== 0) { console.error('tools/gen_catalog.py failed'); process.exit(1); }
    fs.mkdirSync(path.dirname(gen), { recursive: true });
    fs.copyFileSync(path.join(out, 'catalog.inc.c'), gen);
    fs.rmSync(out, { recursive: true, force: true });
  }
  const { kitVersion, patchName } = await import('../server/romexport/romkit.js');
  if (!files.includes(`server/romexport/base/${patchName(kitVersion())}`)) {
    console.error(`The ZIP needs the base ROM patch for this version (${patchName(kitVersion())}): run node tools/make_romkit.mjs`);
    process.exit(1);
  }
}
for (const need of ['Start Studio 64.bat', 'Start Studio 64.command', 'start-studio64.sh', 'GETTING STARTED.txt', 'tools/launch.sh', 'tools/launch.ps1', 'tools/start.mjs', 'package.json', 'package-lock.json']) {
  if (!files.includes(need)) { console.error(`The ZIP needs ${need}`); process.exit(1); }
}

if (args.includes('--check-git')) {
  const g = spawnSync('git', ['-C', path.join(ROOT, 'engine'), 'ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (g.status !== 0) { console.error('git ls-files failed:', g.stderr); process.exit(1); }
  const fromGit = new Set(g.stdout.split('\n').filter(Boolean).map((f) => `engine/${f}`).filter((f) => fs.existsSync(path.join(ROOT, f)) && !ignored(parseIgnore(path.join(ROOT, '.gitignore'), ''), f, false) && !DEV.some((re) => re.test(f))));
  const mine = new Set(files.filter((f) => f.startsWith('engine/')));
  const onlyGit = [...fromGit].filter((f) => !mine.has(f)), onlyMine = [...mine].filter((f) => !fromGit.has(f));
  console.log(`engine/: ${mine.size} files, git: ${fromGit.size}; only git: ${onlyGit.length}, only here: ${onlyMine.length}`);
  for (const f of [...onlyGit.slice(0, 10).map((x) => `  git only: ${x}`), ...onlyMine.slice(0, 10).map((x) => `  zip only: ${x}`)]) console.log(f);
  if (onlyGit.length || onlyMine.length) process.exit(1);
}

// ---- the ZIP (Unix permissions, UTF-8 names) -------------------------------------------------------
function dos(d) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}
fs.mkdirSync(OUT, { recursive: true });
const tmp = `${ZIP}.tmp`;
const fd = fs.openSync(tmp, 'w');
let offset = 0;
const central = [];
const write = (buf) => { fs.writeSync(fd, buf); offset += buf.length; };
const dirs = new Set();
const entries = [];
for (const f of files) {
  const parts = f.split('/');
  for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
}
for (const d of [...dirs].sort()) entries.push({ rel: d, dir: true });
for (const f of files) entries.push({ rel: f, dir: false });
entries.unshift({ rel: '', dir: true });
let raw = 0;
for (const e of entries) {
  const name = Buffer.from(e.rel ? `${TOP}/${e.rel}${e.dir ? '/' : ''}` : `${TOP}/`, 'utf8');
  const st = fs.statSync(path.join(ROOT, e.rel || '.'));
  const mode = e.dir ? 0o40755 : 0o100000 | (EXEC.has(e.rel) || (st.mode & 0o111) ? 0o755 : 0o644);
  const data = e.dir ? Buffer.alloc(0) : fs.readFileSync(path.join(ROOT, e.rel));
  raw += data.length;
  const store = e.dir || data.length < 64 || /\.(png|jpe?g|webp|gif|zip|gz|xz|mp3|ogg|woff2?)$/i.test(e.rel);
  const body = store ? data : zlib.deflateRawSync(data, { level: 9 });
  const crc = zlib.crc32(data) >>> 0;
  const { time, date } = dos(st.mtime);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(store ? 0 : 8, 8);
  local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
  const at = offset;
  write(local); write(name); write(body);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE((3 << 8) | 20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(store ? 0 : 8, 10);
  c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24);
  c.writeUInt16LE(name.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36);
  c.writeUInt32LE(((mode << 16) | (e.dir ? 0x10 : 0)) >>> 0, 38); c.writeUInt32LE(at, 42);
  central.push(Buffer.concat([c, name]));
  if (offset > 0xfffffff0) { console.error('The ZIP is too big (4 GB): ZIP64 is not supported here'); process.exit(1); }
}
const cdStart = offset;
for (const c of central) write(c);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(offset - cdStart, 12); end.writeUInt32LE(cdStart, 16);
write(end);
fs.closeSync(fd);
if (entries.length > 0xffff) { fs.rmSync(tmp); console.error('Too many files for a ZIP without ZIP64'); process.exit(1); }
fs.renameSync(tmp, ZIP);
console.log(`${path.relative(process.cwd(), ZIP)}: ${files.length} files, ${(raw / 1e6).toFixed(1)} MB -> ${(offset / 1e6).toFixed(1)} MB`);
