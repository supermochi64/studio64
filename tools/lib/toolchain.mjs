// The build tools Studio 64 needs on this computer, and a private copy of each one that is
// missing, downloaded into .runtime/ in the Studio 64 folder: no administrator rights, no
// package manager, nothing installed system-wide.
//
//   Python 3     the system's (3.10+, what emsdk needs), else python-build-standalone (all systems)
//   C/C++        the system's cc/c++ when they compile, else Zig's (zig cc / zig c++: its own libc
//                headers, so it works without gcc, Xcode or Visual Studio); on Windows w64devkit's gcc
//   make         the system's GNU make, else GNU make built from source with that compiler;
//                on Windows w64devkit's make (with its BusyBox sh, grep, cut, ... for the Makefile)
//
// Every download is pinned (version + SHA-256 checksum) and checked before it is unpacked.
// Used by the first-run setup (server/setup/) and the engine build (tools/build_engine.mjs).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RUNTIME = process.env.STUDIO_RUNTIME ? path.resolve(process.env.STUDIO_RUNTIME) : path.join(ROOT, '.runtime');
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
export const PLATFORM = `${process.platform}-${process.arch}`;

// ---- pinned downloads ------------------------------------------------------------------------
const PY = '3.12.15', PYREL = '20261013';
const pyUrl = (triple) => `https://github.com/astral-sh/python-build-standalone/releases/download/${PYREL}/cpython-${PY}+${PYREL}-${triple}-install_only_stripped.tar.gz`;
const ZIG = '0.16.0';
const zigUrl = (t, ext) => `https://ziglang.org/download/${ZIG}/zig-${t}-${ZIG}.${ext}`;

export const PINS = {
  python: {
    version: PY,
    'linux-x64': [pyUrl('x86_64-unknown-linux-gnu'), '178d3d83b6e8e99285a65d3fce9c16b87952cc5efdb4d1a0e3ff3be18ff0fc9c'],
    'linux-arm64': [pyUrl('aarch64-unknown-linux-gnu'), '9467a99bacc7d90b64b02de7fa9ecfc99b72905e64e74f7ff6b460ad95cfed5a'],
    'darwin-x64': [pyUrl('x86_64-apple-darwin'), 'd09998f85752b646873a8a6bc7eea442a0d251b1c8d2413aa8ea06ef131c3335'],
    'darwin-arm64': [pyUrl('aarch64-apple-darwin'), '9866e11cf2ae9caa1e671383786f248859a52dd8bfb702fb4c0dc2c65f1d36de'],
    'win32-x64': [pyUrl('x86_64-pc-windows-msvc'), '7a2aef48e5ee569e310b29b32681debbc5d888e92790d85331a47736c6b06aad'],
    'win32-arm64': [pyUrl('aarch64-pc-windows-msvc'), '864342350eec45119bf295d7af7d60a36842e1c6d181cce760fcc6f60e5a072a'],
  },
  zig: {
    version: ZIG,
    'linux-x64': [zigUrl('x86_64-linux', 'tar.xz'), '70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00'],
    'linux-arm64': [zigUrl('aarch64-linux', 'tar.xz'), 'ea4b09bfb22ec6f6c6ceac57ab63efb6b46e17ab08d21f69f3a48b38e1534f17'],
    'darwin-x64': [zigUrl('x86_64-macos', 'tar.xz'), '0387557ed1877bc6a2e1802c8391953baddba76081876301c522f52977b52ba7'],
    'darwin-arm64': [zigUrl('aarch64-macos', 'tar.xz'), 'b23d70deaa879b5c2d486ed3316f7eaa53e84acf6fc9cc747de152450d401489'],
  },
  make: {
    version: '4.4.1',
    any: [['https://ftp.gnu.org/gnu/make/make-4.4.1.tar.gz', 'https://ftpmirror.gnu.org/make/make-4.4.1.tar.gz'], 'dd16fb1d67bfab79a72f5e8390735c49e3e8e70b4945a15ab1f81ddb78658fb3'],
  },
  w64devkit: {
    version: '2.10.0',
    // x64 only (Windows on Arm runs it emulated)
    'win32-x64': ['https://github.com/skeeto/w64devkit/releases/download/v2.10.0/w64devkit-x64-2.10.0.7z.exe', '18d0a4c71a166f8401ab6305781bec5882b40b5e06ba9807c61cb5f3b3c6325e'],
    'win32-arm64': ['https://github.com/skeeto/w64devkit/releases/download/v2.10.0/w64devkit-x64-2.10.0.7z.exe', '18d0a4c71a166f8401ab6305781bec5882b40b5e06ba9807c61cb5f3b3c6325e'],
  },
};

export class ToolError extends Error {
  constructor(title, message = '', fix = '') { super(title); this.title = title; this.detail = message; this.fix = fix; }
}

// ---- small helpers ---------------------------------------------------------------------------
const pathKey = (env) => Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';

/** A program on PATH (with the Windows extensions), or null. */
export function which(cmd, envPath = process.env[pathKey(process.env)] || '') {
  const exts = IS_WIN ? (/\.\w+$/.test(cmd) ? [''] : (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')) : [''];
  for (const d of envPath.split(path.delimiter)) {
    if (!d) continue;
    for (const e of exts) {
      const p = path.join(d, cmd + e);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

function quiet(cmd, args, opts = {}) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000, windowsHide: true, ...opts });
    return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
  } catch (err) { return { ok: false, out: err.message }; }
}

/** macOS: are Apple's command line tools installed? (Without them /usr/bin/cc, make, git, python3 are stubs that open an install dialog.) */
let cltCache = null;
export function appleToolsInstalled() {
  if (!IS_MAC) return true;
  if (cltCache === null) cltCache = quiet('/usr/bin/xcode-select', ['-p']).ok;
  return cltCache;
}
const STUBS = new Set(['cc', 'c++', 'gcc', 'g++', 'clang', 'clang++', 'make', 'git', 'python3', 'ar', 'ranlib', 'cpp']);
/** A usable system program: on PATH and, on a Mac, not one of Apple's install-me stubs. */
export function systemTool(cmd) {
  const p = which(cmd);
  if (!p) return null;
  if (IS_MAC && !appleToolsInstalled() && p.startsWith('/usr/bin/') && STUBS.has(path.basename(p))) return null;
  return p;
}

/** Linux distribution (from /etc/os-release): { id, like, name }. */
export function distro() {
  try {
    const t = fs.readFileSync('/etc/os-release', 'utf8');
    const get = (k) => (t.match(new RegExp(`^${k}="?([^"\\n]*)"?`, 'm')) || [])[1] || '';
    return { id: get('ID'), like: get('ID_LIKE'), name: get('PRETTY_NAME') || get('NAME') };
  } catch { return { id: '', like: '', name: '' }; }
}

/** The one-line command that installs packages on this Linux, or null. */
export function installCommand(pkgs) {
  const d = distro();
  const is = (...ids) => ids.some((x) => d.id === x || d.like.split(' ').includes(x));
  const p = (m) => pkgs[m] || pkgs.default;
  if (is('debian', 'ubuntu')) return `sudo apt install ${p('apt')}`;
  if (is('fedora', 'rhel', 'centos')) return `sudo dnf install ${p('dnf')}`;
  if (is('arch')) return `sudo pacman -S ${p('pacman')}`;
  if (is('opensuse', 'suse')) return `sudo zypper install ${p('zypper')}`;
  return null;
}

/** Downloads url (or the first of several that works) to dest, checks its SHA-256. */
export async function download(urls, dest, sha256, onProgress = () => {}) {
  const list = Array.isArray(urls) ? urls : [urls];
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  let last = null;
  for (const url of list) {
    const part = `${dest}.part`;
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30 * 60 * 1000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get('content-length')) || 0;
      let got = 0;
      const hash = crypto.createHash('sha256');
      const counter = new TransformStream({
        transform(chunk, ctl) { got += chunk.length; hash.update(chunk); onProgress(got, total); ctl.enqueue(chunk); },
      });
      await pipeline(Readable.fromWeb(res.body.pipeThrough(counter)), fs.createWriteStream(part));
      const sum = hash.digest('hex');
      if (sha256 && sum !== sha256) {
        fs.rmSync(part, { force: true });
        throw new ToolError('A download was damaged', `${path.basename(dest)}: the checksum does not match (got ${sum.slice(0, 12)}…).`, 'Press Try again. If it happens again, your network may be changing downloads (a proxy or filter).');
      }
      fs.renameSync(part, dest);
      return dest;
    } catch (err) {
      fs.rmSync(part, { force: true });
      if (err instanceof ToolError) throw err;
      last = err;
    }
  }
  throw new ToolError('A download failed', `${list[0]}: ${last?.message || 'no answer'}`, 'Check your internet connection, then press Try again.');
}

/** tar for unpacking: on Windows the one that comes with Windows 10+ (it also unpacks .zip). */
function tarCmd() {
  if (IS_WIN) {
    const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(sys)) return sys;
  }
  return which('tar') || 'tar';
}

// a Python that can unpack .tar.xz when the system has no xz program (set by ensureToolchain)
let unpackPython = null;
const UNPACK_PY = `import sys, tarfile, os
src, dst, strip = sys.argv[1], sys.argv[2], int(sys.argv[3])
with tarfile.open(src) as t:
    for m in t.getmembers():
        parts = m.name.split('/')[strip:]
        if not parts or not parts[0] or '..' in parts: continue
        m.name = '/'.join(parts)
        if m.islnk(): m.linkname = '/'.join(m.linkname.split('/')[strip:])
        t.extract(m, dst, filter='tar') if hasattr(tarfile, 'data_filter') else t.extract(m, dst)
`;

/** Unpacks archive into dir (emptied first), dropping `strip` leading folders. */
export function extract(archive, dir, strip = 1) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const shim = path.join(BIN(), 'xz');
  if (/\.tar\.xz$/.test(archive) && !IS_WIN && !which('xz') && fs.existsSync(shim)) {
    // GNU tar runs xz for .tar.xz: the Python lzma shim (writeXzShim) stands in for it
    const r = quiet(tarCmd(), ['-xf', archive, '-C', dir, ...(strip ? [`--strip-components=${strip}`] : [])], { timeout: 15 * 60 * 1000, env: buildEnv(process.env, { prepend: [BIN()] }) });
    if (r.ok) return;
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
  if (/\.tar\.xz$/.test(archive) && !IS_WIN && !which('xz') && unpackPython) {
    // GNU tar needs the xz program for .tar.xz; Python's tarfile does it alone
    const r = quiet(unpackPython.cmd, [...unpackPython.pre, '-c', UNPACK_PY, archive, dir, String(strip)], { timeout: 15 * 60 * 1000 });
    if (r.ok) return;
    fs.rmSync(dir, { recursive: true, force: true });
    throw new ToolError(`Could not unpack ${path.basename(archive)}`, r.out.split('\n').slice(-2).join(' '), 'Check the free disk space, then press Try again.');
  }
  const args = ['-xf', archive, '-C', dir];
  if (strip) args.push(`--strip-components=${strip}`);
  const r = quiet(tarCmd(), args, { timeout: 15 * 60 * 1000 });
  if (!r.ok) {
    fs.rmSync(dir, { recursive: true, force: true });
    const xz = /\.xz$/.test(archive) && /xz/i.test(r.out);
    const fix = xz ? (process.platform === 'linux' ? `Install xz${installCommand({ default: 'xz-utils', dnf: 'xz', pacman: 'xz', zypper: 'xz' }) ? ` (${installCommand({ default: 'xz-utils', dnf: 'xz', pacman: 'xz', zypper: 'xz' })})` : ''}, then press Try again.` : 'Press Try again.') : 'Check the free disk space, then press Try again.';
    throw new ToolError(`Could not unpack ${path.basename(archive)}`, r.out.split('\n').slice(-2).join(' '), fix);
  }
}

function run(cmd, args, { cwd, env, onLine = () => {} } = {}) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { cwd, env, windowsHide: true }); } catch (err) { onLine(err.message); resolve(127); return; }
    const feed = (s) => { let rest = ''; s.on('data', (d) => { const parts = (rest + d).split(/\r?\n/); rest = parts.pop(); for (const l of parts) if (l) onLine(l); }); s.on('end', () => rest && onLine(rest)); };
    feed(child.stdout); feed(child.stderr);
    child.on('error', (err) => onLine(err.message));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const marker = (dir) => path.join(dir, '.studio64-ok');
const ready = (dir, version) => { try { return fs.readFileSync(marker(dir), 'utf8').trim() === version; } catch { return false; } };
const done = (dir, version) => fs.writeFileSync(marker(dir), version);

function pin(tool) {
  const p = PINS[tool];
  const f = p[PLATFORM] || p.any;
  if (!f) throw new ToolError(`No ${tool} download for this computer (${PLATFORM})`, '', 'Install it with your system\'s package manager, then press Try again.');
  return { version: p.version, urls: f[0], sha256: f[1] };
}

async function fetchTool(tool, dir, { onStatus, onProgress, strip = 1 }) {
  const { version, urls, sha256 } = pin(tool);
  const first = Array.isArray(urls) ? urls[0] : urls;
  const file = path.join(RUNTIME, 'downloads', path.basename(new URL(first).pathname));
  if (!fs.existsSync(file)) {
    onStatus?.(`Downloading ${tool === 'w64devkit' ? 'the build tools (w64devkit)' : tool === 'zig' ? 'a C compiler (Zig)' : tool === 'python' ? 'Python' : 'make'} ${version}`);
    await download(urls, file, sha256, onProgress);
  }
  if (tool !== 'w64devkit' && tool !== 'make') {
    onStatus?.(`Unpacking ${tool === 'zig' ? 'the C compiler' : tool}`);
    extract(file, dir, strip);
  }
  return { file, version };
}

// ---- the tools -------------------------------------------------------------------------------
/** A system Python 3.10+ ({ cmd, pre, version }), or null. (3.10, not 3.8: emsdk's installer
 * refuses anything older, and macOS's Command Line Tools python3 is often 3.9 -- that must fall
 * through to the private, pinned Python below, not be accepted here.) */
export function systemPython() {
  const tries = IS_WIN ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
  for (const [cmd, pre] of tries) {
    const p = systemTool(cmd);
    if (!p) continue;
    if (IS_WIN && /WindowsApps/i.test(p)) continue; // the Microsoft Store's python.exe opens the Store
    const r = quiet(p, [...pre, '-c', 'import sys, zlib, json, hashlib; print("%d.%d" % sys.version_info[:2])']);
    const m = r.ok && r.out.match(/^(\d+)\.(\d+)/m);
    if (m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 10))) return { cmd: p, pre, version: `${m[1]}.${m[2]}` };
  }
  return null;
}

const PYDIR = () => path.join(RUNTIME, 'python');
const pyExe = () => path.join(PYDIR(), IS_WIN ? 'python.exe' : path.join('bin', 'python3'));
/** The private Python in .runtime (if it is there). */
export function privatePython() {
  return ready(PYDIR(), PINS.python.version) && fs.existsSync(pyExe()) ? { cmd: pyExe(), pre: [], version: PINS.python.version.split('.').slice(0, 2).join('.'), private: true } : null;
}

/** The private Python in .runtime/, downloaded if needed (it has venv and pip, which some Linux Pythons lack). */
export async function ensurePrivatePython(opts = {}) {
  const have = privatePython();
  if (have) return have;
  const dir = PYDIR();
  await fetchTool('python', dir, opts);
  if (IS_WIN) fs.copyFileSync(path.join(dir, 'python.exe'), path.join(dir, 'python3.exe')); // the Makefile and scripts call python3
  const r = quiet(pyExe(), ['-c', 'import sys; print(sys.version)']);
  if (!r.ok) throw new ToolError('The downloaded Python does not start', r.out.slice(0, 300), `Delete the folder ${dir} and press Try again.`);
  done(dir, PINS.python.version);
  return privatePython();
}

/** Does this C and C++ compiler pair build a small program with the C library and the C++ library? */
function compilerWorks(cc, cxx, env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's64cc-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.c'), '#include <stdio.h>\n#include <math.h>\nint main(void){printf("%d\\n",(int)sqrt(4.0));return 0;}\n');
    fs.writeFileSync(path.join(dir, 'b.cpp'), '#include <vector>\n#include <cstdio>\nint main(){std::vector<int> v{1,2};std::printf("%d\\n",(int)v.size());return 0;}\n');
    const out = (n) => path.join(dir, n + (IS_WIN ? '.exe' : ''));
    const a = quiet(cc, ['a.c', '-O2', '-o', out('a'), '-lm'], { cwd: dir, env });
    const b = a.ok && quiet(cxx, ['b.cpp', '-O2', '-o', out('b')], { cwd: dir, env });
    return { ok: !!(a.ok && b.ok && quiet(out('a'), [], { cwd: dir }).ok), out: (a.ok ? b.out : a.out) || '' };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const ZIGDIR = () => path.join(RUNTIME, 'zig');
const BIN = () => path.join(RUNTIME, 'bin');
const ZIGCACHE = () => path.join(RUNTIME, 'zig-cache');

/** sh wrappers in .runtime/bin: cc, c++, ar, ranlib, ld -> zig (cpp: writeCppWrapper). */
function writeZigWrappers() {
  const zig = path.join(ZIGDIR(), 'zig');
  fs.mkdirSync(BIN(), { recursive: true });
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  const wrap = (name, sub) => {
    const f = path.join(BIN(), name);
    fs.writeFileSync(f, `#!/bin/sh\n# Studio 64: ${name} is Zig's (tools/lib/toolchain.mjs)\nexec ${q(zig)} ${sub} "$@"\n`);
    fs.chmodSync(f, 0o755);
  };
  // (-w: the decomp's tools and Zig's own libc++ print hundreds of harmless warnings into the setup's log)
  wrap('cc', 'cc -w'); wrap('gcc', 'cc -w'); wrap('c++', 'c++ -w'); wrap('g++', 'c++ -w'); wrap('ar', 'ar'); wrap('ranlib', 'ranlib');
  wrap('ld', 'ld.lld'); // (configure scripts look for one, even when cc links by itself)
}

async function ensureZig(opts) {
  const dir = ZIGDIR();
  if (!(ready(dir, PINS.zig.version) && fs.existsSync(path.join(dir, 'zig')))) {
    await fetchTool('zig', dir, opts);
    writeZigWrappers();
    // Zig builds its C library parts on first use and caches them. Done once here: a configure
    // script's link tests, many of them meant to fail, would otherwise build them again and again
    // (500 s instead of 40 s for GNU make's configure)
    opts.onStatus?.('Preparing the C compiler (once, about a minute)');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 's64zig-'));
    try {
      fs.writeFileSync(path.join(tmp, 'w.c'), '#include <stdio.h>\n#include <math.h>\nint main(void){printf("%d\\n",(int)sqrt(4.0));return 0;}\n');
      const env = buildEnv(process.env, { extra: { ZIG_GLOBAL_CACHE_DIR: ZIGCACHE(), ZIG_LOCAL_CACHE_DIR: ZIGCACHE() } });
      for (const flags of [[], ['-O2'], ['-O2', '-s']]) {
        const r = quiet(path.join(BIN(), 'cc'), ['w.c', '-o', 'w', '-lm', ...flags], { cwd: tmp, env, timeout: 10 * 60 * 1000 });
        if (!r.ok) throw new ToolError('The downloaded C compiler does not work', r.out.split('\n').slice(-3).join(' '), `Delete the folder ${dir} and press Try again.`);
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    done(dir, PINS.zig.version);
  }
  writeZigWrappers();
}

/** GNU make built from its source with cc (its build.sh needs no make). */
async function ensureMakeFromSource(env, opts) {
  const out = path.join(BIN(), 'make');
  if (ready(path.join(RUNTIME, 'make'), PINS.make.version) && fs.existsSync(out)) return out;
  const { file } = await fetchTool('make', null, opts);
  const src = path.join(RUNTIME, 'make-src');
  extract(file, src, 1);
  opts.onStatus?.('Building make (once, about a minute)');
  const log = [];
  const sh = which('sh') || '/bin/sh';
  let code = await run(sh, ['./configure', '--disable-dependency-tracking', '--without-guile', '--disable-nls', 'CC=cc', 'CFLAGS=-O2'], { cwd: src, env, onLine: (l) => log.push(l) });
  if (code === 0) code = await run(sh, ['./build.sh'], { cwd: src, env, onLine: (l) => log.push(l) });
  if (code !== 0 || !fs.existsSync(path.join(src, 'make'))) {
    opts.onLine?.(log.slice(-30).join('\n'));
    throw new ToolError('Building make failed', log.filter((l) => /error/i.test(l)).slice(-2).join(' ') || 'See the log.', 'Press Try again. If it fails again, open an issue with the log.');
  }
  fs.mkdirSync(BIN(), { recursive: true });
  fs.copyFileSync(path.join(src, 'make'), out);
  fs.chmodSync(out, 0o755);
  fs.rmSync(src, { recursive: true, force: true });
  fs.mkdirSync(path.join(RUNTIME, 'make'), { recursive: true });
  done(path.join(RUNTIME, 'make'), PINS.make.version);
  return out;
}

const W64 = () => path.join(RUNTIME, 'w64devkit');
async function ensureW64devkit(opts) {
  const dir = W64();
  if (ready(dir, PINS.w64devkit.version) && fs.existsSync(path.join(dir, 'bin', 'make.exe'))) return dir;
  const { file } = await fetchTool('w64devkit', null, opts);
  opts.onStatus?.('Unpacking the build tools (w64devkit)');
  fs.rmSync(dir, { recursive: true, force: true });
  // a self-extracting 7-Zip archive: it unpacks itself (a w64devkit folder) into -o
  const r = quiet(file, ['-y', `-o${RUNTIME}`], { timeout: 15 * 60 * 1000 });
  if (!r.ok || !fs.existsSync(path.join(dir, 'bin', 'make.exe'))) {
    throw new ToolError('Could not unpack the build tools (w64devkit)', r.out.slice(-300), 'Your antivirus may have blocked it. Allow the file, then press Try again.');
  }
  done(dir, PINS.w64devkit.version);
  return dir;
}

/** The tools that are on this computer already (nothing is downloaded): what the setup can skip. */
export function survey() {
  const python = systemPython() || privatePython();
  const make = IS_WIN ? null : systemTool('make');
  const cc = IS_WIN ? null : (systemTool('cc') || systemTool('gcc') || systemTool('clang'));
  const cxx = IS_WIN ? null : (systemTool('c++') || systemTool('g++') || systemTool('clang++'));
  return { python, make, cc, cxx, appleTools: appleToolsInstalled(), saved: loadChoice() };
}

const CHOICE = () => path.join(RUNTIME, 'toolchain.json');
function loadChoice() { try { return JSON.parse(fs.readFileSync(CHOICE(), 'utf8')); } catch { return null; } }

/**
 * Makes sure Python, a C/C++ compiler and make are there (downloading what is missing) and returns
 * { env, python: { cmd, pre, version }, notes: [what is used] }. env holds the variables to add to
 * the environment of build commands (PATH first). With download: false it never downloads and
 * throws a ToolError when something is missing.
 *   onStatus(text), onProgress(done, total) (downloads), onLine(text) (logs)
 */
export async function ensureToolchain({ download: allowDownload = true, onStatus, onProgress, onLine } = {}) {
  const opts = { onStatus, onProgress, onLine };
  const notes = [];
  const prepend = [];
  const extra = {};
  const forced = (process.env.STUDIO_TOOLCHAIN || '').toLowerCase(); // "private": always the downloaded tools (tests)
  const need = (what) => { if (!allowDownload) throw new ToolError(`${what} is missing`, '', 'Run the setup (npm start), it downloads it.'); };

  // Python
  // (Windows: always the private Python; the Makefile calls python3, which python.org's Windows Python lacks)
  let python = forced === 'private' || IS_WIN ? null : systemPython();
  if (python) notes.push(`Python ${python.version}`);
  else {
    need('Python 3');
    python = await ensurePrivatePython(opts);
    notes.push(`Python ${PINS.python.version} (private copy)`);
  }
  if (python.private) prepend.push(IS_WIN ? PYDIR() : path.dirname(pyExe()));
  unpackPython = python;
  if (!IS_WIN && !systemTool('xz')) { writeXzShim(python); prepend.push(BIN()); notes.push('xz (Python\'s lzma)'); }

  if (IS_WIN) {
    // w64devkit: gcc, g++, make, ar and a BusyBox sh with the Unix commands the Makefile uses
    if (!(ready(W64(), PINS.w64devkit.version))) need('The build tools (w64devkit)');
    const dir = await ensureW64devkit(opts);
    prepend.push(path.join(dir, 'bin'));
    Object.assign(extra, { CC: 'gcc', CXX: 'g++' });
    notes.push(`w64devkit ${PINS.w64devkit.version} (gcc, make)`);
  } else {
    // C and C++: the system's when they work, else Zig's
    const saved = loadChoice();
    let useZig = forced === 'private' || saved?.compiler === 'zig';
    if (!useZig) {
      const cc = systemTool('cc') || systemTool('gcc') || systemTool('clang');
      const cxx = systemTool('c++') || systemTool('g++') || systemTool('clang++');
      const test = cc && cxx ? compilerWorks(cc, cxx, process.env) : { ok: false, out: 'no cc/c++' };
      if (test.ok) notes.push('the system\'s C compiler');
      else { useZig = true; if (cc) onLine?.(`(the system's compiler did not build a test program: ${test.out.split('\n').slice(-2).join(' ')})`); }
    }
    if (useZig) {
      need('A C compiler');
      await ensureZig(opts);
      prepend.push(BIN());
      Object.assign(extra, { CC: 'cc', CXX: 'c++', ZIG_GLOBAL_CACHE_DIR: ZIGCACHE(), ZIG_LOCAL_CACHE_DIR: ZIGCACHE() });
      notes.push(`Zig ${PINS.zig.version} as the C compiler (private copy)`);
    }
    // make: the system's GNU make, else built from source
    let make = forced === 'private' ? null : systemTool('make');
    if (make && !/GNU Make/.test(quiet(make, ['--version']).out)) make = null;
    if (make) notes.push('the system\'s make');
    else {
      const envNow = buildEnv(process.env, { prepend: [...new Set(prepend)], extra });
      if (!(ready(path.join(RUNTIME, 'make'), PINS.make.version) && fs.existsSync(path.join(BIN(), 'make')))) need('make');
      await ensureMakeFromSource(envNow, opts);
      if (!prepend.includes(BIN())) prepend.push(BIN());
      notes.push(`GNU make ${PINS.make.version} (built here)`);
    }
    // a C preprocessor for the game's texts and level headers (GNU cpp comes with gcc; zig has none)
    if (useZig && !systemTool('cpp')) extra.STUDIO_NEED_CPP = '1';
    try { fs.mkdirSync(RUNTIME, { recursive: true }); fs.writeFileSync(CHOICE(), JSON.stringify({ compiler: useZig ? 'zig' : 'system', at: new Date().toISOString() })); } catch { /* read-only */ }
  }
  return { env: { ...extra, PATH_PREPEND: [...new Set(prepend)] }, python, notes };
}

// `xz -d` for tar on systems without the xz program (the Emscripten SDK's installer unpacks
// .tar.xz with tar, which runs xz): Python's lzma does the decompressing
const XZ_PY = `import lzma, sys, shutil
args = [a for a in sys.argv[1:]]
flags = ''.join(a[1:] for a in args if a.startswith('-') and not a.startswith('--'))
long = [a for a in args if a.startswith('--')]
files = [a for a in args if not a.startswith('-')]
if 'd' not in flags and '--decompress' not in long and '--uncompress' not in long:
    sys.stderr.write('xz (Studio 64): only decompressing is supported here\\n'); sys.exit(1)
out = sys.stdout.buffer
if not files:
    with lzma.open(sys.stdin.buffer) as f: shutil.copyfileobj(f, out)
else:
    for name in files:
        with lzma.open(name) as f: shutil.copyfileobj(f, out)
`;
function writeXzShim(python) {
  fs.mkdirSync(BIN(), { recursive: true });
  const f = path.join(BIN(), 'xz');
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  fs.writeFileSync(f, `#!/bin/sh\n# Studio 64: xz -d with Python's lzma (this system has no xz program; tools/lib/toolchain.mjs)\nexec ${[python.cmd, ...python.pre].map(q).join(' ')} -c ${q(XZ_PY)} "$@"\n`);
  fs.chmodSync(f, 0o755);
}

/** An environment for build commands: PATH with prepend first, plus extra variables. */
export function buildEnv(base, { prepend = [], extra = {} } = {}) {
  const env = { ...base };
  const k = pathKey(env);
  env[k] = [...prepend, env[k] || ''].filter(Boolean).join(path.delimiter);
  for (const [key, v] of Object.entries(extra)) if (key !== 'PATH_PREPEND') env[key] = v;
  return env;
}

/** The environment ensureToolchain() describes, applied to base. */
export function toolchainEnv(base, tc) {
  return buildEnv(base, { prepend: tc.env.PATH_PREPEND || [], extra: tc.env });
}

/** A cpp wrapper (the Emscripten SDK's clang as the C preprocessor) for systems without GNU cpp. */
export function writeCppWrapper(emsdk) {
  const clang = path.join(emsdk, 'upstream', 'bin', IS_WIN ? 'clang.exe' : 'clang');
  fs.mkdirSync(BIN(), { recursive: true });
  const f = path.join(BIN(), 'cpp');
  fs.writeFileSync(f, `#!/bin/sh\n# Studio 64: the C preprocessor is the Emscripten SDK's clang (tools/lib/toolchain.mjs)\nexec '${clang.replace(/'/g, `'\\''`)}' -E -P -x c -Wno-trigraphs "$@"\n`);
  fs.chmodSync(f, 0o755);
  return BIN();
}

// ---- the Emscripten SDK ----------------------------------------------------------------------
export const EMSDK_VERSION = '6.0.12';

/** Big downloads shared by every Studio 64 folder of this user (the Emscripten SDK, ~1.5 GB unpacked). */
export function userCache() {
  if (process.env.STUDIO_CACHE) return path.resolve(process.env.STUDIO_CACHE);
  if (IS_WIN) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'studio64');
  if (IS_MAC) return path.join(os.homedir(), 'Library', 'Caches', 'studio64');
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'studio64');
}

/** An installed and activated Emscripten SDK ($EMSDK, ~/.local/src/emsdk, or the setup's), or null. */
export function findEmsdk() {
  const dirs = [process.env.EMSDK, path.join(os.homedir(), '.local', 'src', 'emsdk'), path.join(userCache(), 'emsdk')].filter(Boolean);
  for (const d of dirs) {
    // (on Windows Emscripten 6 has emcc.exe; older ones had emcc.bat)
    const emcc = path.join(d, 'upstream', 'emscripten', 'emcc');
    const hasEmcc = IS_WIN ? ['.exe', '.bat'].some((x) => fs.existsSync(emcc + x)) : fs.existsSync(emcc);
    if (fs.existsSync(path.join(d, 'emsdk.py')) && hasEmcc && fs.existsSync(path.join(d, '.emscripten'))) return d;
  }
  return null;
}

/** What emsdk_env.sh would set: the SDK's tools first on PATH, its config. */
export function emsdkEnv(emsdk) {
  const prepend = [emsdk, path.join(emsdk, 'upstream', 'emscripten')];
  const extra = { EMSDK: emsdk, EM_CONFIG: path.join(emsdk, '.emscripten') };
  try {
    for (const n of fs.readdirSync(path.join(emsdk, 'node'))) {
      const bin = IS_WIN ? path.join(emsdk, 'node', n, 'bin') : path.join(emsdk, 'node', n, 'bin');
      const exe = path.join(bin, IS_WIN ? 'node.exe' : 'node');
      if (fs.existsSync(exe)) { prepend.push(bin); extra.EMSDK_NODE = exe; break; }
    }
  } catch { /* no node in the SDK: emcc uses the one on PATH */ }
  return { prepend, extra };
}

// `as` and `objcopy` for the one assembly file of the build (the sound player's sequence; GNU as
// syntax, its .rodata copied out): the Emscripten SDK's clang and llvm-objcopy make the same bytes.
// Used where GNU binutils are missing (a Linux without gcc) and always on macOS (Apple's as is not GNU as).
const AS_PY = `import os, sys, subprocess
clang, a = sys.argv[1], sys.argv[2:]
cmd = [clang, '--target=x86_64-unknown-linux-gnu', '-c', '-x', 'assembler']
i = 0
while i < len(a):
    x = a[i]
    if x == '--defsym': cmd.append('-Wa,--defsym,' + a[i + 1]); i += 2; continue
    if x == '-MD': i += 2; continue
    if x in ('-I', '-o'): cmd += [x, a[i + 1]]; i += 2; continue
    cmd.append(x); i += 1
sys.exit(subprocess.call(cmd))
`;
export function needBinutils() {
  if (IS_WIN) return false; // (w64devkit has GNU as and objcopy)
  return IS_MAC || !systemTool('as') || !systemTool('objcopy');
}
export function writeBinutilsWrappers(emsdk, python) {
  const bin = path.join(emsdk, 'upstream', 'bin');
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  fs.mkdirSync(BIN(), { recursive: true });
  const write = (name, body) => { const f = path.join(BIN(), name); fs.writeFileSync(f, `#!/bin/sh\n# Studio 64: ${name} from the Emscripten SDK's LLVM (tools/lib/toolchain.mjs)\n${body}\n`); fs.chmodSync(f, 0o755); };
  write('as', `exec ${[python.cmd, ...python.pre].map(q).join(' ')} -c ${q(AS_PY)} ${q(path.join(bin, 'clang'))} "$@"`);
  write('objcopy', `exec ${q(path.join(bin, 'llvm-objcopy'))} "$@"`);
  return BIN();
}
