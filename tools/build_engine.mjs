#!/usr/bin/env node
// Builds the SM64 WebAssembly engine and copies it into web/engine/.
//   npm run build:engine          (the first-run setup in the browser runs this too)
// Needs your ROM at engine/baserom.us.z64 and the Emscripten SDK (EMSDK, ~/.local/src/emsdk or the
// copy the setup installs in the Studio 64 cache). Python, the C compiler and make come from this
// computer or, when missing, from .runtime/ (tools/lib/toolchain.mjs downloads them).
//   STUDIO_JOBS   parallel compile jobs (default: CPU cores, fewer on a machine with little memory)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, ToolError, ensureToolchain, toolchainEnv, buildEnv, findEmsdk, emsdkEnv, writeCppWrapper, needBinutils, writeBinutilsWrappers, which } from './lib/toolchain.mjs';

const ENGINE = path.join(ROOT, 'engine');
const say = (s) => console.log(s);
const fail = (msg) => { console.error(msg); process.exit(1); };

// one build at a time: several people (or terminals) may share this tree; a lock left by a killed build is taken over
const LOCK = path.join(ENGINE, '.build.lock.d');
async function lock() {
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(LOCK); fs.writeFileSync(path.join(LOCK, 'pid'), String(process.pid)); return; } catch (err) { if (err.code !== 'EEXIST') throw err; }
    let pid = 0;
    try { pid = Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')); } catch { /* being written */ }
    let alive = false;
    if (pid) { try { process.kill(pid, 0); alive = true; } catch (err) { alive = err.code === 'EPERM'; } }
    if (pid && !alive) { fs.rmSync(LOCK, { recursive: true, force: true }); continue; }
    if (i === 0) say('(waiting for another engine build to finish)');
    await new Promise((r) => setTimeout(r, 1000));
  }
}
const unlock = () => { try { if (Number(fs.readFileSync(path.join(LOCK, 'pid'), 'utf8')) === process.pid) fs.rmSync(LOCK, { recursive: true, force: true }); } catch { /* gone */ } };
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { unlock(); process.exit(130); });
process.on('exit', unlock);

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', windowsHide: true, ...opts });
    child.on('error', (err) => { console.error(`${cmd}: ${err.message}`); resolve(127); });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

await lock();

// the tools (downloads into .runtime/ only what this computer lacks)
let tc;
try {
  tc = await ensureToolchain({ onStatus: (s) => say(`[tools] ${s}`), onLine: (l) => say(l) });
} catch (err) {
  fail(err instanceof ToolError ? `${err.title}${err.detail ? `: ${err.detail}` : ''}\n${err.fix}` : err.stack);
}
say(`[tools] ${tc.notes.join(', ')}`);

const emsdk = findEmsdk();
if (!emsdk) fail('The Emscripten SDK was not found. Run npm start (the setup installs it), or install it and set EMSDK=/path/to/emsdk.');
const em = emsdkEnv(emsdk);
let env = toolchainEnv(process.env, tc);
env = buildEnv(env, { prepend: em.prepend, extra: em.extra });
if (tc.env.STUDIO_NEED_CPP) env = buildEnv(env, { prepend: [writeCppWrapper(emsdk)] }); // no GNU cpp here: clang -E
if (needBinutils()) env = buildEnv(env, { prepend: [writeBinutilsWrappers(emsdk, tc.python)] }); // no GNU as/objcopy: LLVM's
if (!which('emcc', env[Object.keys(env).find((k) => k.toUpperCase() === 'PATH')])) fail(`emcc not found in ${emsdk}: run its "emsdk activate" for its version`);
const PY = [tc.python.cmd, ...tc.python.pre];
if (!tc.python.pre.length) env.EMSDK_PYTHON = tc.python.cmd; // (emcc's launcher runs this Python)

if (!fs.existsSync(path.join(ENGINE, 'baserom.us.z64'))) fail('engine/baserom.us.z64 missing: copy your US Super Mario 64 ROM there (or run npm start and drop it into the browser)');

// Super Mario Sunshine characters are optional: without a converted disc, gen/ gets the stand-in
const SMS = path.join(ENGINE, 'src', 'studio', 'sms');
if (!fs.existsSync(path.join(SMS, 'gen', 'sms_data.inc.c')) || !fs.existsSync(path.join(SMS, 'gen', 'sms_bodies.h'))) {
  fs.mkdirSync(path.join(SMS, 'gen'), { recursive: true });
  for (const f of ['sms_data.inc.c', 'sms_bodies.h']) fs.copyFileSync(path.join(SMS, 'stub', f), path.join(SMS, 'gen', f));
}

// The Shoggoth content (Tokyo, Shotgun Mario, the cars, Katana Mario: shipped in the repository) has a
// few pieces built on the game's own models and textures -- the dressed Toads, the Goomba gangsters
// and oni: those are made from your ROM's data here (tools/shoggoth/rom_parts.py -> engine/src/studio/romgen/).
if (await run(PY[0], [...PY.slice(1), path.join(ROOT, 'tools', 'shoggoth', 'rom_parts.py')], { cwd: ROOT, env }) !== 0) fail('tools/shoggoth/rom_parts.py failed');

// Which optional data is there decides what src/studio compiles (__has_include, stand-ins); make
// can't see a header appear, so when that set changes, those objects are compiled again
const has = (f) => (fs.existsSync(path.join(ENGINE, f)) ? 1 : 0);
const stubs = (() => { try { return (fs.readFileSync(path.join(SMS, 'gen', 'sms_bodies.h'), 'utf8').match(/SMS_STUB/g) || []).length; } catch { return 0; } })();
const OPT = `sms:${stubs} shotgun:${has('src/studio/shotgun/models.inc.c')} tokyo:${has('src/studio/shoggoth/gen/tokyo_data.inc.c')} cars:${has('src/studio/vehicles/cars.inc.c')}`;
const BUILD = path.join(ENGINE, 'build', 'us_web');
const STAMP = path.join(BUILD, '.studio_optional');
if (fs.existsSync(BUILD) && (() => { try { return fs.readFileSync(STAMP, 'utf8').trim(); } catch { return ''; } })() !== OPT) {
  fs.rmSync(path.join(BUILD, 'src', 'studio'), { recursive: true, force: true });
  fs.rmSync(path.join(BUILD, 'data', 'behavior_data.o'), { force: true });
}

if (await run(PY[0], [...PY.slice(1), path.join(ROOT, 'tools', 'gen_catalog.py')], { cwd: ROOT, env }) !== 0) fail('tools/gen_catalog.py failed');

// compile jobs: the cores, but about 0.6 GB of memory per job (the link alone needs ~4.5 GB)
const cores = os.availableParallelism?.() || os.cpus().length || 4;
const byMemory = Math.max(1, Math.floor((os.totalmem() / 1e9 - 2) / 0.6));
const JOBS = Number(process.env.STUDIO_JOBS) || Math.max(1, Math.min(cores, byMemory));
// make by its name (found on PATH, the private one first): the Makefile runs $(MAKE) unquoted, so an
// absolute path with a space ("Studio 64") would break it
if (!which('make', env[Object.keys(env).find((k) => k.toUpperCase() === 'PATH')])) fail('make was not found');
say(`make TARGET_WEB=1 VERSION=us -j${JOBS}`);
if (await run('make', ['TARGET_WEB=1', 'VERSION=us', `-j${JOBS}`], { cwd: ENGINE, env }) !== 0) fail('make failed');

fs.mkdirSync(BUILD, { recursive: true });
fs.writeFileSync(STAMP, OPT);
const WEB = path.join(ROOT, 'web', 'engine');
fs.mkdirSync(WEB, { recursive: true });
// copy then rename: a page loading the game right now never gets a half-written file
for (const f of ['sm64.us.f3dex2e.wasm', 'sm64.us.f3dex2e.js']) {
  fs.copyFileSync(path.join(BUILD, f), path.join(WEB, `.${f}.tmp`));
  fs.renameSync(path.join(WEB, `.${f}.tmp`), path.join(WEB, f));
}
say('engine -> web/engine');
