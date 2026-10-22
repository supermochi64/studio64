// What the first-run setup needs on this computer, where it lives, and how to fix what is missing.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const IS_WIN = process.platform === 'win32';
export const IS_MAC = process.platform === 'darwin';
export { EMSDK_VERSION, userCache, findEmsdk, which, systemPython as findPython, distro, installCommand, RUNTIME } from '../../tools/lib/toolchain.mjs';
import { which, findEmsdk, survey, installCommand, appleToolsInstalled, RUNTIME } from '../../tools/lib/toolchain.mjs';

/** Per checkout: setup state, logs, the uploaded disc, the Python environment for the Sunshine converter. */
export const LOCAL = path.join(ROOT, '.setup');

export const PATHS = {
  rom: path.join(ROOT, 'engine', 'baserom.us.z64'),
  wasm: path.join(ROOT, 'web', 'engine', 'sm64.us.f3dex2e.wasm'),
  js: path.join(ROOT, 'web', 'engine', 'sm64.us.f3dex2e.js'),
  smsGen: path.join(ROOT, 'engine', 'src', 'studio', 'sms', 'gen', 'sms_bodies.h'),
  disc: path.join(LOCAL, 'sunshine.iso'),
  state: path.join(LOCAL, 'state.json'),
  log: path.join(LOCAL, 'setup.log'),
  venv: path.join(LOCAL, 'python'),
  runtime: RUNTIME,
};

/** True when converted Sunshine characters are in the engine sources (not the stand-in). */
export function hasSunshine() {
  try { return !fs.readFileSync(PATHS.smsGen, 'utf8').includes('SMS_STUB'); } catch { return false; }
}

/**
 * What the build will use and what the setup downloads first (into .runtime/, no administrator
 * rights): Python, a C compiler and make when this computer has none. Returns
 * { ok, problems: [{ what, fix }], downloads: [names], have: [names] }: problems are only what the
 * setup can not fix by itself (no tar to unpack, no xz for the compiler's archive).
 */
export function checkTools() {
  const s = survey();
  const downloads = [], have = [], problems = [];
  if (s.python) have.push(`Python ${s.python.version}`); else downloads.push('Python');
  if (!IS_WIN) {
    if (s.cc && s.cxx) have.push('a C compiler'); else downloads.push('a C compiler (Zig)');
    if (s.make) have.push('make'); else downloads.push('make');
  } else downloads.push('the build tools (w64devkit)');
  if (!findEmsdk()) downloads.push('the Emscripten compiler');
  if (!IS_WIN && !which('tar')) problems.push({ what: 'tar was not found', fix: process.platform === 'linux' ? `Install tar: ${installCommand({ default: 'tar' }) || 'with your system\'s package manager'}.` : 'Install tar.' });
  return { ok: problems.length === 0, problems, downloads, have, appleTools: appleToolsInstalled() };
}

/** Runs a command, streaming its output lines to onLine; resolves with the exit code. */
export function run(cmd, args, { cwd = ROOT, env = {}, onLine = () => {}, onChunk = null, onSpawn = null, signal } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, PYTHONUNBUFFERED: '1', ...env }, windowsHide: true, signal }); // live output from Python tools
    } catch (err) { onLine(String(err.message)); resolve(127); return; }
    onSpawn?.(child);
    const feed = (stream) => {
      let rest = '';
      stream.on('data', (d) => {
        onChunk?.(d.toString('utf8')); // progress bars that never end their line (emsdk's ####)
        const parts = (rest + d.toString('utf8')).split(/\r?\n|\r/);
        rest = parts.pop();
        for (const l of parts) if (l) onLine(l);
      });
      stream.on('end', () => { if (rest) onLine(rest); });
    };
    feed(child.stdout);
    feed(child.stderr);
    child.on('error', (err) => { onLine(err.message); });
    child.on('close', (code) => resolve(code ?? 1));
  });
}
