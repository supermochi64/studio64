// The base ROM every export builds on: the SM64 decompilation with Studio 64's changes (base.js),
// built once on this computer from the player's own ROM, plus an index of where everything is in
// it (romkit.json). An export then only adds data (rom.js), so it needs no compiler and takes
// seconds.
//
// Built here, not shipped: the base ROM is the game's code, so it comes from the player's ROM.
// What is downloaded: the decompilation's source (github.com/n64decomp/sm64) and an N64 C compiler
// (libdragon's GCC build for MIPS) when this computer has none.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { ensureToolchain, toolchainEnv, buildEnv, download, extract, userCache, which, ToolError, PLATFORM } from '../../tools/lib/toolchain.mjs';
import { UPSTREAM, PATCHES, FILES, INFO_ROM, applyPatches } from './base.js';
import { indexDecomp } from './decompindex.js';
import { applyBps } from './bps.js';
import { buildOverlays } from './overlays.js';

export const KIT_DIR = process.env.STUDIO_ROMKIT ? path.resolve(process.env.STUDIO_ROMKIT) : path.join(userCache(), 'romkit');
const IS_WIN = process.platform === 'win32';

const DECOMP = {
  url: `https://codeload.github.com/${UPSTREAM.repo}/tar.gz/${UPSTREAM.commit}`,
  sha256: '513e114fe66c4b2e0d13b8ce840722c0a29702c28771b54a8b7a8cc01cf6593f',
};

// libdragon's toolchain (GCC for the N64's MIPS CPU); a continuous release, so a newer build is
// accepted when GitHub's own checksum for it matches
const MIPS_RELEASE = 'https://github.com/DragonMinded/libdragon/releases/download/toolchain-continuous-prerelease/';
const MIPS = {
  'linux-x64': ['gcc-toolchain-mips64-x86_64.deb', 'fac8e6572493a66468b7d45df41b042f90b1a630ec96aa218bd5fb1f320a0a4d'],
  'linux-arm64': ['gcc-toolchain-mips64-aarch64.deb', '271a6f10c891b316a4e47959698cc7d9a8da1261ca3aa13edea0c82de22bc4b4'],
  'win32-x64': ['gcc-toolchain-mips64-win64.zip', 'bd201c35afee4aceb9d2a80c6dc9d25eb2a4d426b1b26ef38e33881641b4d1d0'],
};

// the make variables of a build (also tools/romkit_dev.mjs)
export function makeVars(mips, env, python) {
  const cpp = which('cpp', env.PATH) ? [] : [`CPP=${mips.prefix}cpp -U_LANGUAGE_C -ULANGUAGE_C`];
  return ['VERSION=us', 'COMPILER=gcc', 'GRUCODE=f3dex2', 'COMPARE=0', `CROSS=${mips.prefix}`, ...cpp, ...(python ? [`PYTHON=${python}`] : [])];
}
export const pristineDir = () => path.join(KIT_DIR, `pristine-${UPSTREAM.commit.slice(0, 8)}`);
export async function downloadDecomp(onStatus = () => {}) {
  const tgz = path.join(KIT_DIR, 'downloads', `sm64-${UPSTREAM.commit.slice(0, 8)}.tar.gz`);
  if (!fs.existsSync(tgz)) {
    onStatus('Downloading the SM64 decompilation (15 MB)');
    await download(DECOMP.url, tgz, DECOMP.sha256);
  }
  return tgz;
}

const BUILD_LINES = 4600; // lines a full build of the game prints (for its progress)
const TOOLS_LINES = 270;  // and of its tools

/** The base ROM's version: changes whenever the source or Studio 64's changes do. */
export function kitVersion() {
  return crypto.createHash('sha1').update(JSON.stringify([UPSTREAM, PATCHES, FILES, 'us', 'gcc', 'f3dex2'])).digest('hex').slice(0, 12);
}
const kitPath = () => path.join(KIT_DIR, kitVersion());

/** { ready, version, rom, index } */
export function kitStatus() {
  const dir = kitPath();
  const rom = path.join(dir, 'base.z64'), index = path.join(dir, 'romkit.json');
  return { ready: fs.existsSync(rom) && fs.existsSync(index), version: kitVersion(), dir, rom, index };
}

export function loadKit() {
  const s = kitStatus();
  if (!s.ready) return null;
  return { rom: fs.readFileSync(s.rom), index: JSON.parse(fs.readFileSync(s.index, 'utf8')), version: s.version };
}

function runLines(cmd, args, { cwd, env, onLine, signal }) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { cwd, env, windowsHide: true, signal }); } catch (err) { onLine(err.message); resolve(127); return; }
    const feed = (s) => { let rest = ''; s.on('data', (d) => { const parts = (rest + d).split(/\r?\n/); rest = parts.pop(); for (const l of parts) if (l) onLine(l); }); s.on('end', () => rest && onLine(rest)); };
    feed(child.stdout); feed(child.stderr);
    child.on('error', (err) => onLine(err.message));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

// ---- the N64 compiler ------------------------------------------------------------------------
function mipsIn(dir) {
  const gcc = path.join(dir, 'bin', IS_WIN ? 'mips64-elf-gcc.exe' : 'mips64-elf-gcc');
  return fs.existsSync(gcc) ? { bin: path.join(dir, 'bin'), prefix: 'mips64-elf-' } : null;
}

/** An N64 C compiler: on PATH, in ~/.local/mips, or downloaded into the kit folder. */
export async function ensureMips({ onStatus = () => {}, onProgress = () => {} } = {}) {
  for (const prefix of ['mips-linux-gnu-', 'mips64-linux-gnu-', 'mips64-elf-']) {
    const gcc = which(`${prefix}gcc`), ld = which(`${prefix}ld`);
    if (gcc && ld) return { bin: path.dirname(gcc), prefix, note: `${prefix}gcc (this computer's)` };
  }
  const dir = path.join(KIT_DIR, 'mips');
  const have = mipsIn(dir);
  if (have) return { ...have, note: 'libdragon toolchain (downloaded)' };
  const local = mipsIn(path.join(os.homedir(), '.local', 'mips'));
  if (local && !process.env.STUDIO_MIPS_DOWNLOAD) return { ...local, note: '~/.local/mips' };

  const pin = MIPS[PLATFORM];
  if (!pin) {
    throw new ToolError('No N64 compiler download for this computer', `There is no ready-made N64 compiler for ${PLATFORM}.`,
      process.platform === 'darwin' ? 'Install one with Homebrew (brew install tehzz/n64-dev/mips64-elf-gcc), then press Try again.' : 'Install a mips64-elf or mips-linux-gnu GCC, then press Try again.');
  }
  const [name, sha] = pin;
  const file = path.join(KIT_DIR, 'downloads', name);
  if (!fs.existsSync(file)) {
    onStatus('Downloading the N64 compiler (about 100 MB, once)');
    await download(MIPS_RELEASE + name, file, null, onProgress);
    const sum = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (sum !== sha && sum !== await githubDigest(name)) {
      fs.rmSync(file, { force: true });
      throw new ToolError('The N64 compiler download was damaged', `${name}: the checksum does not match.`, 'Press Try again.');
    }
  }
  onStatus('Unpacking the N64 compiler');
  const tmp = path.join(KIT_DIR, 'mips.unpack');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  if (name.endsWith('.deb')) {
    // a .deb is an ar archive; the files are in data.tar.* under opt/libdragon
    const data = debMember(fs.readFileSync(file), /^data\.tar/);
    const tar = path.join(tmp, data.name);
    fs.writeFileSync(tar, data.bytes);
    extract(tar, path.join(tmp, 'x'), 0);
    fs.renameSync(path.join(tmp, 'x', 'opt', 'libdragon'), dir);
  } else {
    extract(file, path.join(tmp, 'x'), 0);
    const gcc = findFile(path.join(tmp, 'x'), 'mips64-elf-gcc.exe');
    if (!gcc) throw new ToolError('The N64 compiler download has no compiler in it', name, 'Press Try again.');
    fs.renameSync(path.dirname(path.dirname(gcc)), dir);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  const got = mipsIn(dir);
  if (!got) throw new ToolError('Could not unpack the N64 compiler', name, 'Check the free disk space, then press Try again.');
  return { ...got, note: 'libdragon toolchain (downloaded)' };
}

async function githubDigest(name) {
  try {
    const r = await fetch('https://api.github.com/repos/DragonMinded/libdragon/releases/tags/toolchain-continuous-prerelease', { signal: AbortSignal.timeout(20000) });
    const asset = (await r.json()).assets?.find((a) => a.name === name);
    return String(asset?.digest || '').replace(/^sha256:/, '') || null;
  } catch { return null; }
}

function debMember(buf, re) {
  if (buf.toString('latin1', 0, 8) !== '!<arch>\n') throw new ToolError('The N64 compiler download is not a .deb', '', 'Press Try again.');
  let o = 8;
  while (o + 60 <= buf.length) {
    const name = buf.toString('latin1', o, o + 16).trim().replace(/\/$/, '');
    const size = Number(buf.toString('latin1', o + 48, o + 58).trim());
    if (re.test(name)) return { name, bytes: buf.subarray(o + 60, o + 60 + size) };
    o += 60 + size + (size & 1);
  }
  throw new ToolError('The N64 compiler download is incomplete', '', 'Press Try again.');
}

function findFile(dir, name) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === name) return p;
    if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; }
  }
  return null;
}

// ---- the base ROM ----------------------------------------------------------------------------
let building = null;

/**
 * Builds the base ROM when this version has none yet. rom: the player's original ROM (z64).
 * onStatus(text), onProgress(fraction), onLine(text). Resolves with loadKit().
 */
export function ensureKit(opts) {
  if (kitStatus().ready) return Promise.resolve(loadKit());
  if (!building) building = makeKit(opts).finally(() => { building = null; });
  return building;
}

// The base ROM as a patch for the original game, as ROM hacks are shared: it comes with Studio 64
// (server/romexport/base/, made by tools/make_romkit.mjs: only the changes, no Nintendo files) and
// every computer applies it to its player's own ROM. Without one for this version (working on the
// ROM's code) it is built here.
const SHIPPED = path.join(path.dirname(fileURLToPath(import.meta.url)), 'base');
export const patchName = (version = kitVersion()) => `studio64-base-${version}.bps`;
export const indexName = (version = kitVersion()) => `studio64-base-${version}.json`;
export const shippedDir = () => SHIPPED;

async function makeKit(opts) {
  for (const dir of [SHIPPED, KIT_DIR]) {
    const f = [path.join(dir, patchName()), path.join(dir, indexName())];
    if (f.every((x) => fs.existsSync(x))) return kitFromPatch(opts.rom, fs.readFileSync(f[0]), fs.readFileSync(f[1], 'utf8'));
  }
  const canBuild = MIPS[PLATFORM] || ['mips-linux-gnu-gcc', 'mips64-linux-gnu-gcc', 'mips64-elf-gcc'].some((c) => which(c)) || mipsIn(path.join(KIT_DIR, 'mips'));
  if (canBuild) return buildKit(opts);
  throw new ToolError('This Studio 64 has no base ROM for its version', `no ${patchName()} in ${SHIPPED}, and no N64 compiler on this computer`,
    'Use a released version of Studio 64 (it comes with it), or install a mips64-elf GCC and press Try again.');
}

function kitFromPatch(rom, patch, indexText) {
  const z64 = applyBps(rom, patch);
  const index = JSON.parse(indexText);
  if (index.version !== kitVersion()) throw new ToolError('The ROM builder does not fit this Studio 64', `it is version ${index.version}, this Studio 64 needs ${kitVersion()}`, 'Update Studio 64.');
  const dir = kitPath();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'romkit.json'), JSON.stringify(index));
  fs.writeFileSync(path.join(dir, 'base.z64'), z64);
  return loadKit();
}

async function buildKit({ rom, onStatus = () => {}, onProgress = () => {}, onLine = () => {}, signal } = {}) {
  const dir = kitPath();
  const tree = path.join(dir, 'sm64');
  const log = [];
  const line = (l) => { log.push(l); if (log.length > 400) log.shift(); onLine(l); };
  const fail = (title, fix) => { throw new ToolError(title, log.slice(-6).join('\n'), fix); };

  onStatus('Checking the build tools');
  const tc = await ensureToolchain({ onStatus, onProgress: (d, t) => t && onProgress(0.05 * d / t), onLine: line });
  const mips = await ensureMips({ onStatus, onProgress: (d, t) => t && onProgress(0.05 + 0.15 * d / t) });
  line(`Tools: ${[...tc.notes, mips.note].join(', ')}`);

  // the source, with Studio 64's changes
  const marker = path.join(tree, '.studio64-source');
  if (!fs.existsSync(marker)) {
    const tgz = path.join(KIT_DIR, 'downloads', `sm64-${UPSTREAM.commit.slice(0, 8)}.tar.gz`);
    if (!fs.existsSync(tgz)) {
      onStatus('Downloading the SM64 decompilation (15 MB)');
      await download(DECOMP.url, tgz, DECOMP.sha256, (d, t) => onProgress(0.2 + 0.05 * d / (t || 16e6)));
    }
    onStatus('Unpacking the decompilation');
    extract(tgz, tree, 1);
    applyPatches(tree);
    fs.writeFileSync(marker, UPSTREAM.commit);
  }
  fs.writeFileSync(path.join(tree, 'baserom.us.z64'), rom);

  const env = buildEnv(toolchainEnv(process.env, tc), { prepend: [mips.bin] });
  const jobs = String(Math.max(1, Math.min(os.cpus().length, 8)));
  const py = tc.python.pre?.length ? null : tc.python.cmd;

  // the decomp's own tools, with this computer's C compiler (its Makefile names gcc); kept for
  // the next version of the base ROM (they only change with the decomp)
  const toolsCache = path.join(KIT_DIR, `tools-${crypto.createHash('sha1').update(JSON.stringify([UPSTREAM, PATCHES.filter((p) => p.file.startsWith('tools/'))])).digest('hex').slice(0, 12)}`);
  if (fs.existsSync(path.join(toolsCache, '.studio64-ok'))) fs.cpSync(toolsCache, path.join(tree, 'tools'), { recursive: true, preserveTimestamps: true });
  onStatus('Building the decompilation\'s tools');
  const toolVars = [tc.env.CC ? `CC=${tc.env.CC}` : null, tc.env.CXX ? `CXX=${tc.env.CXX}` : null].filter(Boolean);
  let t = 0;
  if (await runLines('make', ['-C', 'tools', `-j${jobs}`, ...toolVars], { cwd: tree, env, signal, onLine: (l) => { line(l); t++; onProgress(0.25 + 0.3 * Math.min(1, t / TOOLS_LINES)); } }) !== 0) {
    fail('Could not build the decompilation\'s tools', 'Look at the log for the first error.');
  }
  if (!fs.existsSync(path.join(toolsCache, '.studio64-ok'))) {
    fs.rmSync(toolsCache, { recursive: true, force: true });
    fs.cpSync(path.join(tree, 'tools'), toolsCache, { recursive: true, preserveTimestamps: true });
    fs.writeFileSync(path.join(toolsCache, '.studio64-ok'), UPSTREAM.commit);
  }

  onStatus('Building the base ROM (a few minutes, once)');
  let n = 0;
  // (the C preprocessor for assembly and the linker script: the system's, as the Makefile expects;
  // else the N64 compiler's without the C language it assumes)
  const vars = makeVars(mips, env, py);
  const code = await runLines('make', [`-j${jobs}`, ...vars], {
    cwd: tree, env, signal,
    onLine: (l) => { line(l); n++; onProgress(0.55 + 0.42 * Math.min(1, n / BUILD_LINES)); },
  });
  const built = path.join(tree, 'build', 'us', 'sm64.us.z64');
  if (code !== 0 || !fs.existsSync(built)) fail('The base ROM did not build', 'Look at the log for the first error.');

  onStatus('Building Studio 64\'s modules');
  let ovl;
  try {
    ovl = await buildOverlays(tree, fs.readFileSync(built), { tool: (n) => path.join(mips.bin, `${mips.prefix}${n}`), makeArgs: vars, env, onLine: line });
  } catch (e) { line(e.message); fail('Studio 64\'s modules did not build', 'Look at the log for the first error.'); }

  onStatus('Indexing the base ROM');
  const z64 = ovl.rom;
  if (z64.length > INFO_ROM) fail(`The base ROM is too big (${z64.length} bytes)`, '');
  const index = { ...(await indexKit(tree, z64, mips, env)), modules: { dir: ovl.dir, list: ovl.overlays } };
  fs.writeFileSync(path.join(dir, 'romkit.json'), JSON.stringify(index));
  fs.writeFileSync(path.join(dir, 'base.z64'), z64);
  fs.rmSync(path.join(tree, 'baserom.us.z64'), { force: true });
  // older versions of the base ROM are not needed any more
  for (const d of fs.readdirSync(KIT_DIR)) {
    if (/^[0-9a-f]{12}$/.test(d) && d !== kitVersion()) fs.rmSync(path.join(KIT_DIR, d), { recursive: true, force: true });
  }
  onProgress(1);
  return loadKit();
}

// ---- what is where ---------------------------------------------------------------------------
export async function indexKit(tree, z64, mips, env) {
  // symbols: name -> address (segmented for data in segments, RAM for code, ROM for segment bounds)
  const nm = [];
  const elf = path.join(tree, 'build', 'us', 'sm64.us.elf');
  await runLines(path.join(mips.bin, `${mips.prefix}nm`), [elf], { cwd: tree, env, onLine: (l) => nm.push(l) });
  const symbols = {};
  for (const l of nm) {
    const m = /^([0-9a-fA-F]{8}) (\w) (\S+)$/.exec(l);
    if (m && !(m[3] in symbols)) symbols[m[3]] = parseInt(m[1], 16);
  }

  // model ids (some are other models' names)
  const models = {};
  const raw = {};
  for (const m of fs.readFileSync(path.join(tree, 'include', 'model_ids.h'), 'utf8').matchAll(/^#define (MODEL_\w+)\s+(\w+)/gm)) raw[m[1]] = m[2];
  const resolve = (v, depth = 0) => /^(0x[0-9a-f]+|\d+)$/i.test(v) ? Number(v) : (raw[v] && depth < 8 ? resolve(raw[v], depth + 1) : null);
  for (const k of Object.keys(raw)) { const v = resolve(raw[k]); if (v !== null) models[k] = v; }

  // levels in their enum order (LEVEL_NONE is 0)
  const levels = {}, folders = {};
  let num = 1;
  for (const m of fs.readFileSync(path.join(tree, 'levels', 'level_defines.h'), 'utf8').matchAll(/^(STUB_LEVEL|DEFINE_LEVEL)\(\s*"[^"]*",\s*(LEVEL_\w+),\s*\w+,\s*(\w+)?/gm)) {
    levels[m[2]] = num;
    if (m[1] === 'DEFINE_LEVEL') folders[m[3]] = num;
    num++;
  }

  // each level's EXECUTE in the main level scripts (an export points it at the new level) and
  // its original star and death exits
  const execute = {}, exits = {};
  for (const [folder, n] of Object.entries(folders)) {
    const start = symbols[`_${folder}SegmentRomStart`], end = symbols[`_${folder}SegmentRomEnd`];
    if (start === undefined) continue;
    const pat = Buffer.alloc(12);
    pat.writeUInt32BE(0x0010000E, 0); pat.writeUInt32BE(start, 4); pat.writeUInt32BE(end, 8);
    const at = z64.indexOf(pat);
    if (at >= 0 && z64.indexOf(pat, at + 1) < 0) execute[folder] = at;
    try {
      const s = fs.readFileSync(path.join(tree, 'levels', folder, 'script.c'), 'utf8');
      const get = (id) => {
        const m = new RegExp(`WARP_NODE\\(/\\*id\\*/ ${id},\\s*/\\*destLevel\\*/ (LEVEL_\\w+),\\s*/\\*destArea\\*/ (\\w+),\\s*/\\*destNode\\*/ (\\w+),\\s*/\\*flags\\*/ (\\w+)\\)`).exec(s);
        const node = (t) => /^WARP_NODE_[0-9A-F]{2}$/.test(t) ? parseInt(t.slice(10), 16) : ({ WARP_NODE_SUCCESS: 0xF0, WARP_NODE_DEATH: 0xF1 })[t] ?? Number(t);
        return m ? [levels[m[1]], Number(m[2]), node(m[3]), m[4] === 'WARP_CHECKPOINT' ? 0x80 : 0] : null;
      };
      exits[folder] = { success: get('WARP_NODE_SUCCESS'), death: get('WARP_NODE_DEATH') };
    } catch { /* no script */ }
    void n;
  }

  const ix = indexDecomp(tree);
  return {
    version: kitVersion(), upstream: UPSTREAM.commit, grucode: 'f3dex2', baseSize: z64.length,
    symbols, models, levels, folders, execute, exits,
    soundBanks: fs.readdirSync(path.join(tree, 'sound', 'sound_banks')).filter((f) => f.endsWith('.json')).length,
    geoBank: Object.fromEntries(ix.geoBank), funcOfBank: Object.fromEntries(ix.funcOfBank), globalModels: Object.fromEntries(ix.globalModels),
  };
}
