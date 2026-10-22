// The first-run setup: everything between "here is my ROM" and the studio, run by the server
// with live progress for the browser (server/routes/setup.js, web/setup.html).
//
// Every step can run again: it skips what is already there (the compiler, converted characters,
// pictures, samples) and make only rebuilds what changed. So "Continue" after an interruption
// and "Try again" after an error are the same thing: run the pipeline again.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, LOCAL, PATHS, EMSDK_VERSION, IS_WIN, IS_MAC, userCache, findEmsdk, checkTools, hasSunshine, which, run } from './env.js';
import { ensureToolchain, ensurePrivatePython, toolchainEnv, ToolError, download, extract } from '../../tools/lib/toolchain.mjs';
import { Host, shellQuote as q } from './host.js';

const SETUP_OFF_ENV = /^(0|off|false|no)$/i.test(process.env.STUDIO_SETUP || ''); // (helper servers: never run the setup)
// STUDIO_SETUP_EXTRAS=off: no pictures and no sample hacks (they need a Chrome to render with; tests)
const EXTRAS_OFF = /^(0|off|false|no)$/i.test(process.env.STUDIO_SETUP_EXTRAS || '');

export class SetupError extends Error {
  constructor(title, message, fix) { super(title); this.title = title; this.detail = message || ''; this.fix = fix || ''; }
}

// estimate: seconds on an average machine (the time left shown in the browser starts from these)
export const STEPS = [
  { id: 'check', label: 'Check your computer', estimate: 2 },
  { id: 'compiler', label: 'Get the compiler and tools', estimate: 150 },
  { id: 'sunshine', label: 'Convert the Sunshine characters', estimate: 60 },
  { id: 'engine', label: 'Build the game for your browser', estimate: 210 },
  { id: 'data', label: 'Read the texts, font and textures', estimate: 10 },
  { id: 'pictures', label: 'Take pictures of every object and level', estimate: 900, soft: true },
  { id: 'samples', label: 'Make the sample hacks', estimate: 200, soft: true },
];
// output lines of a full engine build before it compiles the game (unpacking the ROM, the tools)
const ENGINE_LINES = 5000;
const ENGINE_FILES = 350;   // files the engine build compiles

const LOG_KEEP = 600;

function freePort() {
  return new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

export class Setup {
  constructor() {
    try { fs.mkdirSync(LOCAL, { recursive: true }); } catch { /* read-only checkout */ }
    this.log = [];
    this.state = this.load();
    if (this.state.status === 'running') this.state.status = 'interrupted'; // the server stopped while it ran
    this.running = null;
    this.background = false;
    this.children = new Set();
    this.onDone = null;
    // the extras (pictures, samples) go on in the background once the studio runs: after the restart
    // that opens it, after an interruption, or once more on a later start if one failed
    const softLeft = !EXTRAS_OFF && STEPS.some((d) => d.soft && this.state.steps?.[d.id]?.state !== 'done');
    if (!SETUP_OFF_ENV && fs.existsSync(PATHS.wasm) && (this.state.status === 'finishing' || (this.state.status === 'done' && softLeft))) {
      setTimeout(() => this.start({}, { background: true }), 3000);
    }
  }

  load() {
    try { return JSON.parse(fs.readFileSync(PATHS.state, 'utf8')); } catch { return { status: 'idle', options: {}, steps: {} }; }
  }

  save() {
    try { fs.writeFileSync(PATHS.state, JSON.stringify(this.state, null, 1)); } catch { /* read-only checkout: progress stays in memory */ }
  }

  /** True when the studio can start: the engine is built and no setup is running or stopped half way. */
  ready() {
    return fs.existsSync(PATHS.wasm) && fs.existsSync(PATHS.js) && (!this.running || this.background) && !['failed', 'interrupted', 'running'].includes(this.state.status);
  }

  addLog(line) {
    const l = String(line).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
    this.log.push(l);
    if (this.log.length > LOG_KEEP) this.log.splice(0, this.log.length - LOG_KEEP);
    try { fs.appendFileSync(PATHS.log, l + '\n'); } catch { /* ignore */ }
  }

  step(id) {
    if (!this.state.steps[id]) this.state.steps[id] = { state: 'pending' };
    return this.state.steps[id];
  }

  set(id, fields) {
    Object.assign(this.step(id), fields);
    this.dirty = true;
  }

  status() {
    const now = Date.now();
    const sunshine = !!this.state.options?.sunshine;
    const steps = STEPS.filter((s) => s.id !== 'sunshine' || sunshine || this.state.steps.sunshine?.state === 'done').map((s) => {
      let st = this.state.steps[s.id] || { state: 'pending' };
      if (st.state === 'running' && !this.running) st = { ...st, state: 'pending', startedAt: null, progress: null }; // interrupted: it starts again
      return { id: s.id, label: s.label, soft: !!s.soft, state: st.state, detail: st.detail || '', progress: st.progress ?? null, error: st.error || null,
        seconds: st.startedAt ? Math.round(((st.endedAt || now) - st.startedAt) / 1000) : null };
    });
    // time left: the running step from its progress, the others from their estimates
    let left = 0;
    const guess = this.running ? {} : this.guess();
    const est = {};
    for (const def of STEPS) est[def.id] = guess[def.id] ?? this.state.steps[def.id]?.estimate ?? def.estimate;
    for (const s of steps) {
      const def = STEPS.find((d) => d.id === s.id);
      const st = this.state.steps[s.id] || {};
      if (!!def.soft !== !!this.background && this.running) continue; // time until the studio opens (or until the extras are done)
      if (def.soft && !this.running) continue;
      if (s.state === 'pending' || !this.running) left += s.state === 'done' && !this.running ? 0 : est[s.id];
      else if (s.state === 'running') {
        const el = (now - st.startedAt) / 1000;
        const est = st.estimate ?? def.estimate;
        // early progress says little (a step may start at 10%): the estimate until 15%, then the measured pace
        // (a step that takes longer than its estimate on this machine: assume as long again, not "a minute")
        left += st.progress > 0.15 ? Math.max(1, (el * (1 - st.progress)) / st.progress) : Math.max(est - el, Math.min(el, est) * 0.5, 30);
      }
    }
    return {
      status: this.state.status, running: !!this.running, ready: this.ready(),
      steps, secondsLeft: Math.round(left), estimates: est,
      startedAt: this.state.startedAt || null, finishedAt: this.state.finishedAt || null,
      warnings: this.state.warnings || [], error: this.state.error || null,
      log: this.log.slice(-200),
      platform: process.platform,
      rom: fs.existsSync(PATHS.rom), sunshine: hasSunshine(), disc: fs.existsSync(PATHS.disc),
      options: this.state.options || {},
    };
  }

  /** Seconds for the steps whose work is (partly) done already. */
  guess() {
    // the private build tools (Python, Zig, make) take a few minutes more the first time
    if (this.toolsMissing == null) { try { const c = checkTools(); this.toolsMissing = c.downloads.filter((d) => !/Emscripten/.test(d)).length; } catch { this.toolsMissing = 0; } }
    const tools = this.toolsMissing ? 150 : 0;
    return { compiler: findEmsdk() ? 1 + tools : (tools ? 150 + tools : null), sunshine: hasSunshine() && !fs.existsSync(PATHS.disc) ? 1 : null,
      engine: fs.existsSync(path.join(ROOT, 'engine', 'build', 'us_web', 'sm64.us.f3dex2e.wasm')) ? 40 : null,
      pictures: fs.existsSync(path.join(ROOT, 'web', 'thumbs', 'hub', 'castle.jpg')) ? 20 : null,
      samples: fs.existsSync(path.join(ROOT, 'server', 'samples', 'showcase.s64hack')) ? 2 : null };
  }

  /** Starts (or continues) the setup; resolves when it ends. */
  start(options = {}, { background = false } = {}) {
    if (this.running) {
      if (!this.background || background) return this.running;
      // the user starts a setup (add the Sunshine disc) while the extras run: stop them, it runs them again
      this.cancel = true;
      for (const c of this.children) c.kill();
      return this.running.then(() => this.start(options));
    }
    this.background = background;
    this.cancel = false;
    this.state.options = { ...this.state.options, ...options };
    this.state.status = background ? 'finishing' : 'running';
    this.state.error = null;
    this.state.warnings = [];
    if (!background) { this.state.startedAt = Date.now(); this.state.finishedAt = null; }
    for (const s of STEPS) {
      const st = this.step(s.id);
      if (background ? s.soft && st.state !== 'done' : st.state !== 'done' || ['check', 'engine', 'data'].includes(s.id)) Object.assign(st, { state: 'pending', detail: '', progress: null, error: null, startedAt: null, endedAt: null });
    }
    for (const [id, v] of Object.entries(this.guess())) this.step(id).estimate = v ?? undefined;
    this.addLog(`--- setup started ${new Date().toISOString()} (${process.platform}, node ${process.version})`);
    this.timer = setInterval(() => { if (this.dirty) { this.dirty = false; this.save(); } }, 1000);
    this.running = this.runAll().finally(() => {
      clearInterval(this.timer);
      this.running = null;
      if (!background) this.state.finishedAt = Date.now();
      this.save();
      // the studio can open: restart the server (it loads the new catalog, then runs the extras)
      if (this.state.status === 'finishing' && !background) this.onDone?.();
      this.background = false;
    });
    return this.running;
  }

  async runAll() {
    const ctx = {};
    for (const def of STEPS) {
      const st = this.step(def.id);
      if (this.cancel) { this.cancel = false; return; }
      if (this.background && !def.soft) continue;
      if (def.soft && EXTRAS_OFF) {
        if (st.state !== 'done') this.set(def.id, { state: 'skipped', detail: 'Turned off (STUDIO_SETUP_EXTRAS=off)' });
        continue;
      }
      if (def.soft && !this.background) {
        // the essentials are there: open the studio now, the pictures and samples follow in the background
        if (STEPS.some((d) => d.soft && this.state.steps[d.id]?.state !== 'done')) {
          this.state.status = 'finishing';
          this.addLog('--- the studio can open; pictures and samples go on in the background');
          return;
        }
        continue;
      }
      if (def.id === 'sunshine' && !this.state.options.sunshine) { this.set('sunshine', { state: 'skipped' }); continue; }
      this.set(def.id, { state: 'running', startedAt: Date.now(), endedAt: null, progress: null, detail: '' });
      this.addLog(`== ${def.label}`);
      try {
        const skipped = await this[`step_${def.id}`](ctx, (fields) => this.set(def.id, fields));
        this.set(def.id, { state: skipped === 'skipped' ? 'skipped' : 'done', endedAt: Date.now(), progress: 1, detail: typeof skipped === 'string' && skipped !== 'skipped' ? skipped : st.detail });
      } catch (err) {
        const error = err instanceof SetupError ? { title: err.title, message: err.detail, fix: err.fix } : { title: 'Something went wrong', message: err.message, fix: '' };
        this.addLog(`!! ${error.title}${error.message ? `: ${error.message}` : ''}`);
        if (def.soft) {
          this.set(def.id, { state: 'warning', endedAt: Date.now(), error });
          this.state.warnings.push({ step: def.id, ...error });
          continue;
        }
        this.set(def.id, { state: 'failed', endedAt: Date.now(), error });
        this.state.status = 'failed';
        this.state.error = { step: def.id, ...error };
        for (const c of this.children) c.kill();
        return;
      }
    }
    this.state.status = 'done';
    this.addLog('--- setup finished');
    if (!this.background) this.state.status = 'finishing'; // (nothing left in the background: the restart still loads the new catalog)
  }

  /** Runs a command for a step: output to the log, lines to onLine. */
  exec(cmd, args, opts = {}) {
    // (every child is tracked: a failed step or a new setup over the background extras stops them all)
    if (this.cancel) return Promise.resolve(1);
    return run(cmd, args, {
      ...opts,
      onLine: (l) => { this.addLog(l); opts.onLine?.(l); },
      onSpawn: (c) => { this.children.add(c); c.on('close', () => this.children.delete(c)); },
    });
  }

  /** Where the build commands run: here, or in WSL on Windows (server/setup/host.js). */
  host(ctx) {
    if (!ctx.host) ctx.host = Host.detect();
    return ctx.host;
  }

  /** Runs [cmd, args, env] from the host (Host.cmd / Host.bash). */
  hexec([cmd, args, env], opts = {}) { return this.exec(cmd, args, { ...opts, env: { ...env, ...(opts.env || {}) } }); }

  python(ctx) {
    if (!ctx.python && this.host(ctx).wsl) ctx.python = this.host(ctx).python();
    if (!ctx.python) throw new SetupError('Python is not ready', '', 'Press Try again: the setup gets it first.');
    return ctx.python;
  }

  /** Python, a C compiler and make: the system's, or private copies in .runtime/ (tools/lib/toolchain.mjs). */
  async toolchain(ctx, { download: allow = false, set } = {}) {
    if (ctx.tc) return ctx.tc;
    try {
      ctx.tc = await ensureToolchain({
        download: allow,
        onStatus: (t) => { this.addLog(t); set?.({ detail: t }); },
        onProgress: (got, total) => { if (total) set?.({ progress: Math.min(0.2, 0.02 + 0.18 * (got / total)) }); },
        onLine: (l) => this.addLog(l),
      });
    } catch (err) {
      if (err instanceof ToolError) throw new SetupError(err.title, err.detail, err.fix);
      throw err;
    }
    ctx.python = ctx.tc.python;
    ctx.env = toolchainEnv(process.env, ctx.tc);
    return ctx.tc;
  }

  /** [cmd, args, env] for a Python script on the build host. */
  py(ctx, args, env = {}) {
    const py = this.python(ctx);
    return this.host(ctx).cmd(py.cmd, [...py.pre, ...args], { ...(ctx.env || {}), ...env });
  }

  /** emsdk's output: download sizes, a [----] ruler, then a row of '#' that never ends its line. */
  emsdkProgress(set) {
    set({ detail: `Downloading Emscripten ${EMSDK_VERSION} (about 340 MB, once)`, progress: 0.22 });
    const dl = { done: 0, size: 0, width: 0, hashes: 0, total: 340e6 };
    const show = () => set({ progress: Math.min(0.88, 0.22 + 0.66 * (dl.done + (dl.width ? dl.size * Math.min(1, dl.hashes / dl.width) : 0)) / dl.total) });
    return {
      onChunk: (t) => { if (dl.width) { dl.hashes += (t.match(/#/g) || []).length; show(); } },
      onLine: (l) => {
        let m;
        if ((m = l.match(/^Downloading: .*?(\d+) Bytes/))) {
          dl.size = Number(m[1]); dl.hashes = 0; dl.width = 0;
          dl.total = Math.max(dl.total, dl.done + dl.size);
          set({ detail: `Downloading Emscripten ${EMSDK_VERSION} (${Math.round(dl.total / 1e6)} MB, once)` });
        } else if ((m = l.match(/^\s*\[(-+)\]/))) dl.width = m[1].length;
        else if (/^Unpacking/.test(l)) {
          dl.done += dl.size; dl.size = 0; dl.width = 0;
          if (dl.done > 100e6) set({ detail: 'Unpacking the compiler', progress: 0.9 });
        }
        if (!/^Unpacking/.test(l)) show();
      },
    };
  }

  // ---- steps ---------------------------------------------------------------------------------

  async step_check(ctx, set) {
    if (!fs.existsSync(PATHS.rom)) throw new SetupError('Your Super Mario 64 ROM is missing', '', 'Drop your ROM (US version, .z64/.n64/.v64) on this page.');
    const host = this.host(ctx);
    if (host.kind === 'none') {
      throw new SetupError('WSL is not installed', 'STUDIO_BUILD_HOST=wsl asks to build in WSL (the Windows Subsystem for Linux), which is not installed yet or has no Linux distribution.',
        'Start Studio 64 without STUDIO_BUILD_HOST=wsl to build on Windows itself. Or install WSL: open PowerShell as administrator, run wsl --install, restart Windows and open "Ubuntu" once. Then press Try again.');
    }
    if (host.wsl) {
      const missing = async () => {
        const out = [];
        await this.hexec(host.bash('for t in make python3 cc c++ git; do command -v $t >/dev/null 2>&1 || echo "missing:$t"; done'), { onLine: (l) => out.push(l) });
        return out.filter((l) => l.startsWith('missing:')).map((l) => l.slice(8));
      };
      let miss = await missing();
      if (miss.length) {
        set({ detail: `Installing ${miss.join(', ')} in WSL` });
        await this.exec('wsl.exe', ['-u', 'root', '-e', 'sh', '-c', 'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential python3 python3-venv git']);
        miss = await missing();
        if (miss.length) {
          throw new SetupError(`WSL is missing ${miss.join(', ')}`, '', 'Open Ubuntu (WSL) and run: sudo apt update && sudo apt install -y build-essential python3 python3-venv git. Then press Try again.');
        }
      }
      ctx.python = host.python();
      set({ detail: 'WSL with Python, make and the C compilers' });
    } else {
      const r = checkTools();
      if (!r.ok) {
        const p = r.problems;
        throw new SetupError(p.length === 1 ? p[0].what : `${p.length} tools are missing: ${p.map((x) => x.what.replace(/ was not found.*/, '')).join(', ')}`,
          p.length > 1 ? p.map((x) => x.what).join('. ') + '.' : '', [...new Set(p.map((x) => x.fix))].join(' '));
      }
      // nothing to install by hand: what is missing is downloaded in the next step (into .runtime/)
      set({ detail: r.downloads.length ? `Found ${r.have.join(', ') || 'no build tools'}; the setup gets ${r.downloads.join(', ')}` : `${r.have.join(', ')}: all there` });
      ctx.downloads = r.downloads;
    }
    const free = (() => { try { return fs.statfsSync(ROOT); } catch { return null; } })();
    if (free) {
      const gb = (free.bavail * free.bsize) / 1e9;
      // the compiler (~1.5 GB), the build (~1 GB), the private tools (~0.5 GB)
      const need = (findEmsdk() || host.wsl ? 1.5 : 3.5) + (this.state.options.sunshine && !hasSunshine() ? 1.5 : 0);
      if (gb < need) throw new SetupError(`Not enough free disk space (${gb.toFixed(1)} GB free)`, `The setup needs about ${need} GB.`, 'Free some space on this disk, then press Try again.');
    }
  }

  async step_compiler(ctx, set) {
    const host = this.host(ctx);
    if (host.wsl) {
      // inside WSL: the Linux SDK in the WSL user's cache (tools/build_engine.sh looks there)
      const D = '"$HOME/.cache/studio64/emsdk"';
      if ((await this.hexec(host.bash(`test -f ${D}/.emscripten -a -f ${D}/upstream/emscripten/emcc || test -f "$HOME/.local/src/emsdk/.emscripten"`))) === 0) return 'Found the Emscripten SDK in WSL';
      const code = await this.hexec(host.bash(`D=${D}; if [ ! -f "$D/emsdk.py" ]; then rm -rf "$D"; mkdir -p "$(dirname "$D")"; git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$D" || exit 1; fi; `
        + `cd "$D" && python3 emsdk.py install ${EMSDK_VERSION} && python3 emsdk.py activate ${EMSDK_VERSION}`, { PYTHONUNBUFFERED: '1' }), this.emsdkProgress(set));
      if (code !== 0) throw new SetupError('Installing the compiler failed', 'emsdk install did not finish in WSL (see the log).', 'Check your internet connection and free disk space, then press Try again.');
      return `Installed Emscripten ${EMSDK_VERSION} in WSL`;
    }
    // Python, a C compiler, make: the system's, or downloaded into .runtime/ (no administrator rights)
    const tc = await this.toolchain(ctx, { download: true, set });
    this.addLog(`build tools: ${tc.notes.join(', ')}`);
    const found = findEmsdk();
    if (found) { ctx.emsdk = found; return `Found the Emscripten SDK in ${found.replace(os.homedir(), '~')}; ${tc.notes.join(', ')}`; }
    const py = this.python(ctx);
    const dir = path.join(userCache(), 'emsdk');
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    if (!fs.existsSync(path.join(dir, 'emsdk.py'))) {
      // the SDK's installer from GitHub, the release that matches (no git needed)
      set({ detail: 'Downloading the Emscripten SDK', progress: 0.2 });
      const tgz = path.join(userCache(), `emsdk-${EMSDK_VERSION}.tar.gz`);
      try {
        await download([`https://github.com/emscripten-core/emsdk/archive/refs/tags/${EMSDK_VERSION}.tar.gz`], tgz, null);
        extract(tgz, dir, 1);
      } catch (err) {
        fs.rmSync(dir, { recursive: true, force: true });
        if (err instanceof ToolError) throw new SetupError('Could not download the Emscripten SDK', err.detail, err.fix);
        throw err;
      } finally { fs.rmSync(tgz, { force: true }); }
    }
    // emsdk downloads the compiler (Node + LLVM/Binaryen/Emscripten: ~340 MB) and unpacks it
    const env = { ...ctx.env, EMSDK_PYTHON: py.cmd };
    const code = await this.exec(py.cmd, [...py.pre, path.join(dir, 'emsdk.py'), 'install', EMSDK_VERSION], { cwd: dir, env, ...this.emsdkProgress(set) });
    if (code !== 0) throw new SetupError('Installing the compiler failed', 'emsdk install did not finish (see the log).', 'Check your internet connection and free disk space, then press Try again.');
    const code2 = await this.exec(py.cmd, [...py.pre, path.join(dir, 'emsdk.py'), 'activate', EMSDK_VERSION], { cwd: dir, env });
    if (code2 !== 0) throw new SetupError('Activating the compiler failed', 'emsdk activate did not finish (see the log).', `Press Try again. If it keeps failing, delete the folder ${dir} and try again.`);
    ctx.emsdk = dir;
    return `Installed Emscripten ${EMSDK_VERSION} in ${dir.replace(os.homedir(), '~')}`;
  }

  /** A Python with numpy and Pillow (the Sunshine converter): the system's, or a private one in .setup/python. */
  async scientificPython(ctx, set) {
    const py = this.python(ctx);
    const probe = ['-c', 'import numpy, PIL'];
    if ((await run(py.cmd, [...py.pre, ...probe])) === 0) return { cmd: py.cmd, pre: py.pre };
    const vpy = path.join(PATHS.venv, IS_WIN ? 'Scripts' : 'bin', IS_WIN ? 'python.exe' : 'python');
    if (fs.existsSync(vpy) && (await run(vpy, probe)) === 0) return { cmd: vpy, pre: [] };
    set({ detail: 'Setting up Python for the converter (numpy, Pillow)' });
    if (!fs.existsSync(vpy)) {
      const out = [];
      let code = await this.exec(py.cmd, [...py.pre, '-m', 'venv', PATHS.venv], { onLine: (l) => out.push(l) });
      if (code !== 0 || !fs.existsSync(vpy)) {
        // (Debian and Ubuntu leave venv out of their Python): the private Python has it
        fs.rmSync(PATHS.venv, { recursive: true, force: true });
        this.addLog('(this Python makes no environments: using a private copy)');
        let own = null;
        try { own = await ensurePrivatePython({ onStatus: (t) => set({ detail: t }) }); } catch (err) { out.push(err.message); }
        if (own) code = await this.exec(own.cmd, ['-m', 'venv', PATHS.venv], { onLine: (l) => out.push(l) });
        if (code !== 0 || !fs.existsSync(vpy)) {
          fs.rmSync(PATHS.venv, { recursive: true, force: true });
          throw new SetupError('Could not make a Python environment for the converter', out.slice(-2).join(' '),
            process.platform === 'linux' ? 'Install the Python venv module (Debian/Ubuntu: sudo apt install python3-venv), then press Try again.' : 'Reinstall Python 3 from python.org, then press Try again.');
        }
      }
    }
    const code = await this.exec(vpy, ['-m', 'pip', 'install', '--disable-pip-version-check', '--progress-bar', 'off', '-r', path.join(ROOT, 'tools', 'requirements.txt')]);
    if (code !== 0) throw new SetupError('Could not install numpy and Pillow', 'pip install failed (see the log).', 'Check your internet connection, then press Try again.');
    return { cmd: vpy, pre: [] };
  }

  async step_sunshine(ctx, set) {
    if (hasSunshine() && !fs.existsSync(PATHS.disc)) return 'The Sunshine characters are already converted';
    if (!fs.existsSync(PATHS.disc)) throw new SetupError('The Sunshine disc is missing', '', 'Drop your Super Mario Sunshine disc image on this page again, or turn the Sunshine characters off.');
    const host = this.host(ctx);
    let n = 0;
    const onLine = (l) => {
      const m = l.match(/^(\w+): \d+ joints/);
      if (m) { n++; set({ detail: `Converted ${m[1]} (${n} of 13)`, progress: Math.min(0.97, 0.1 + n / 13 * 0.85) }); }
      else if (/^Collecting|^Installing collected/.test(l)) set({ detail: 'Setting up Python for the converter (numpy, Pillow)' });
    };
    let code;
    if (host.wsl) {
      // numpy and Pillow from the system or a venv in the WSL user's cache
      set({ detail: 'Converting Piantas, Nokis, Strollin\' Stus and more from your disc', progress: 0.05 });
      code = await this.hexec(host.bash(`V="$HOME/.cache/studio64/python"; PY=python3; if ! python3 -c 'import numpy, PIL' 2>/dev/null; then `
        + `[ -x "$V/bin/python" ] || python3 -m venv "$V" || exit 3; "$V/bin/python" -c 'import numpy, PIL' 2>/dev/null `
        + `|| "$V/bin/python" -m pip install --disable-pip-version-check --progress-bar off -r ${q(host.p(path.join(ROOT, 'tools', 'requirements.txt')))} || exit 4; PY="$V/bin/python"; fi; `
        + `exec "$PY" ${q(host.p(path.join(ROOT, 'tools', 'sms', 'convert.py')))}`, { SMS_ISO: host.p(PATHS.disc), PYTHONUNBUFFERED: '1' }), { onLine });
      if (code === 3) throw new SetupError('Could not make a Python environment in WSL', '', 'Open Ubuntu (WSL) and run: sudo apt install -y python3-venv. Then press Try again.');
      if (code === 4) throw new SetupError('Could not install numpy and Pillow in WSL', 'pip install failed (see the log).', 'Check your internet connection, then press Try again.');
    } else {
      const py = await this.scientificPython(ctx, set);
      set({ detail: 'Converting Piantas, Nokis, Strollin\' Stus and more from your disc', progress: 0.1 });
      code = await this.exec(py.cmd, [...py.pre, path.join(ROOT, 'tools', 'sms', 'convert.py')], { env: { SMS_ISO: PATHS.disc }, onLine });
    }
    if (code !== 0) {
      throw new SetupError('Converting the Sunshine characters failed', 'The disc could not be read the way the converter expects (see the log).',
        'Studio 64 is made for the USA disc (GMSE01) as .iso, .gcm or .nkit.iso. Drop another image, or turn the Sunshine characters off and press Try again.');
    }
    fs.rmSync(PATHS.disc, { force: true }); // 1.4 GB not needed any more
    return 'Converted 13 Sunshine characters';
  }

  async step_engine(ctx, set) {
    const host = this.host(ctx);
    const emsdk = ctx.emsdk || findEmsdk();
    if (!emsdk && !host.wsl) throw new SetupError('The compiler is missing', '', 'Press Try again: the setup installs it.');
    let lines = 0, compiled = 0;
    const full = !fs.existsSync(path.join(ROOT, 'engine', 'build', 'us_web', 'sm64.us.f3dex2e.wasm'));
    set({ detail: 'Unpacking the textures, sounds and levels of your ROM', progress: full ? 0.01 : null });
    const tail = [];
    let cmd;
    if (host.wsl) cmd = host.bash(`exec bash ${q(host.p(path.join(ROOT, 'tools', 'build_engine.sh')))}`);
    else {
      await this.toolchain(ctx);
      cmd = [process.execPath, [path.join(ROOT, 'tools', 'build_engine.mjs')], { ...ctx.env, EMSDK: emsdk }];
    }
    const code = await this.hexec(cmd, {
      onLine: (l) => {
        if (!/warning:|note:|^\s|In file included|warnings? generated/.test(l)) lines++; // (compiler warnings say nothing about progress)
        tail.push(l); if (tail.length > 30) tail.shift();
        if (/^emcc -c|^emcc .* -c /.test(l)) { compiled++; set({ detail: `Compiling the game (${compiled} files)` }); }
        else if (/^emcc -L/.test(l)) set({ detail: 'Linking the game' });
        else if (/^ports:INFO|generating (port|system library)/.test(l)) set({ detail: 'Building SDL2 for the browser (once, a few minutes)' });
        else if (/^\[rom_parts\]/.test(l)) set({ detail: 'Dressing the Shoggoth characters with your ROM\'s Toads and Goombas' });
        else if (!compiled && /^(cc|c\+\+|gcc|g\+\+|clang) |make\[\d\]: Entering directory .*tools/.test(l)) set({ detail: 'Building the decomp\'s asset tools' });
        else if (/^(tools\/)?(n64graphics|aifc_decode|aiff_extract_codebook|tabledesign|vadpcm_enc|skyconv|mio0|textconv)\b|^python3? tools\//.test(l)) set({ detail: `Converting textures, sounds and levels${compiled ? ` (${compiled} files compiled)` : ''}` });
        // first unpacking and the tools (about ENGINE_LINES lines), then ~350 files to compile, then the link
        if (full) set({ progress: compiled ? (/^emcc -L/.test(l) ? 0.96 : Math.min(0.95, 0.35 + 0.6 * (compiled / ENGINE_FILES))) : Math.min(0.35, 0.35 * lines / ENGINE_LINES) });
      },
    });
    if (code !== 0) {
      const text = tail.join('\n');
      if (/SHA-1|sha1|checksum/i.test(text)) throw new SetupError('The ROM does not match', 'The asset extraction rejected engine/baserom.us.z64.', 'Drop your US Super Mario 64 ROM again.');
      if (/No space left/i.test(text)) throw new SetupError('The disk is full', '', 'Free some disk space, then press Try again.');
      if (/\$'\\r'|\\r: command not found|bad interpreter/.test(text)) {
        throw new SetupError('The files have Windows line endings', 'git converted the scripts to CRLF.', 'Clone Studio 64 again with LF endings: git config --global core.autocrlf input, then clone it (inside WSL is best).');
      }
      throw new SetupError('Building the game failed', tail.filter((l) => /error|Error|failed/.test(l)).slice(-3).join(' ') || 'See the log for details.',
        'Press Try again. If it fails the same way, open an issue with the log (Show details → Copy the whole log).');
    }
    if (!fs.existsSync(PATHS.wasm)) throw new SetupError('The build finished without the game file', '', 'Press Try again.');
    return full ? `Built the game (${compiled} files)` : 'The game is up to date';
  }

  async step_data(ctx, set) {
    const host = this.host(ctx);
    if (!host.wsl) await this.toolchain(ctx);
    set({ detail: 'Texture list for the texture browser', progress: 0.2 });
    if ((await this.hexec(this.py(ctx, [host.p(path.join(ROOT, 'tools', 'gen_textures.py'))]))) !== 0) throw new SetupError('Reading the textures failed', 'tools/gen_textures.py (see the log)', 'Press Try again.');
    set({ detail: 'The game\'s texts and dialog font', progress: 0.6 });
    if ((await this.hexec(this.py(ctx, [host.p(path.join(ROOT, 'tools', 'gen_story_data.py'))]))) !== 0) throw new SetupError('Reading the texts failed', 'tools/gen_story_data.py (see the log)', 'Press Try again.');
    return 'Texts, dialog font and texture list';
  }

  /** A Chrome-family browser for the pictures and samples (installs Playwright's Chromium if there is none). */
  async browser(set) {
    const { findChrome } = await import('../../tools/lib/browser.mjs');
    let chrome = await findChrome();
    if (chrome) return chrome;
    set({ detail: 'Downloading a browser for the pictures (Chromium, ~150 MB)' });
    // Playwright's own Chromium (playwright is in node_modules; no npx: the Node next to us runs its installer)
    const cli = path.join(ROOT, 'node_modules', 'playwright', 'cli.js');
    if (fs.existsSync(cli)) await this.exec(process.execPath, [cli, 'install', 'chromium']);
    chrome = await findChrome();
    if (!chrome) throw new SetupError('No browser for the pictures', 'Studio 64 renders the pictures in Chrome, Chromium or Edge.', 'Install Google Chrome, then press Try again. Everything else works without the pictures.');
    return chrome;
  }

  /** A second server on a free port that the picture tools drive (its own projects folder, no AI). */
  async helperServer() {
    const port = await freePort();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's64setup-'));
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
      cwd: ROOT, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STUDIO_PROJECTS: dir, STUDIO_PASSWORD: '', STUDIO_AI: 'off', STUDIO_SETUP: 'off', STUDIO_SUPERVISED: '' },
    });
    this.children.add(child);
    const url = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 150; i++) {
      try { if ((await fetch(`${url}/api/config`)).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    return { url, stop: () => { child.kill(); this.children.delete(child); fs.rmSync(dir, { recursive: true, force: true }); } };
  }

  async step_pictures(ctx, set) {
    const thumbs = path.join(ROOT, 'web', 'thumbs');
    const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'server', 'data', 'catalog.json'), 'utf8'));
    const want = catalog.entries.filter((e) => (e.model !== 'MODEL_NONE' || /^(sms|sg|kt|vehicle):/.test(e.id) || (e.id.startsWith('tokyo:') && e.gfx && e.id !== 'tokyo:city')) && !e.id.startsWith('static_object')); // (as tools/make_thumbs.mjs)
    const have = (dir, f) => fs.existsSync(path.join(thumbs, dir, f));
    const levels = Object.values(catalog.levels).filter((l) => l.num).length;
    const jobs = [
      { tool: 'make_thumbs.mjs', label: 'objects', need: want.some((e) => !have('', `${e.id.replace(/:/g, '__')}.webp`)), weight: 0.7 },
      { tool: 'make_level_thumbs.mjs', label: 'levels', need: (fs.existsSync(path.join(thumbs, 'levels')) ? fs.readdirSync(path.join(thumbs, 'levels')).length : 0) < levels, weight: 0.17 },
      { tool: 'make_template_thumbs.mjs', label: 'level templates', need: !have('templates', 'island.jpg'), weight: 0.1 },
      { tool: 'make_hub_thumbs.mjs', label: 'home screen', need: !have('hub', 'castle.jpg'), weight: 0.03 },
    ];
    if (!jobs.some((j) => j.need)) return 'All pictures are there';
    const chrome = await this.browser(set);
    const server = await this.helperServer();
    const failed = [];
    try {
      let base = 0;
      for (const j of jobs) {
        if (!j.need) { base += j.weight; continue; }
        set({ detail: `Pictures of the ${j.label}`, progress: base });
        let total = j.tool === 'make_thumbs.mjs' ? want.length : j.tool === 'make_level_thumbs.mjs' ? levels : 9;
        let n = 0;
        const code = await this.exec(process.execPath, [path.join(ROOT, 'tools', j.tool)], {
          env: { STUDIO_URL: server.url, CHROME: chrome, THUMB_PROGRESS: '1', THUMB_TIMEOUT: '20000' }, // slow machines: wait instead of reloading the page
          onLine: (l) => {
            const m = l.match(/^(\d+)\/(\d+)$/);
            if (m) { n = Number(m[1]); total = Number(m[2]); } else if (/ ok$|^wrote /.test(l)) n++;
            set({ detail: `Pictures of the ${j.label} (${Math.min(n, total)} of ${total})`, progress: base + j.weight * Math.min(1, n / Math.max(1, total)) });
          },
        });
        if (code !== 0) failed.push(j.label);
        base += j.weight;
      }
    } finally { server.stop(); }
    if (failed.length) throw new SetupError(`Some pictures could not be made (${failed.join(', ')})`, 'The studio works without them; the library shows names instead.', 'Press Try again to make the missing ones.');
    return 'Pictures of every object and level';
  }

  async step_samples(ctx, set) {
    const dir = path.join(ROOT, 'server', 'samples');
    const want = ['star-isles', 'frost-peak', 'two-worlds', 'castle-remix', 'showcase'];
    // Tokyo from Shoggoth World (it ships with Studio 64: web/data/shoggoth/tokyo.json)
    if (fs.existsSync(path.join(ROOT, 'web', 'data', 'shoggoth', 'tokyo.json'))) want.push('tokyo');
    if (want.every((s) => fs.existsSync(path.join(dir, `${s}.s64hack`)))) return 'All samples are there';
    const chrome = await this.browser(set);
    set({ detail: 'Star Isles, Frost Peak, Two Worlds', progress: 0.05 });
    const code = await this.exec(process.execPath, [path.join(ROOT, 'tools', 'make_all_samples.mjs')], {
      env: { CHROME: chrome },
      onLine: (l) => {
        if (/make_castle_sample/.test(l)) set({ detail: 'Castle Remix (built in the game)', progress: 0.25 });
        else if (/make_showcase_sample/.test(l)) set({ detail: 'Showcase (every feature in one hack)', progress: 0.5 });
        else if (/make_tokyo_sample/.test(l)) set({ detail: 'Tokyo (from Shoggoth World)', progress: 0.85 });
        else if (/✓|ok\b/i.test(l)) set({ progress: Math.min(0.97, (this.step('samples').progress || 0.5) + 0.01) });
      },
    });
    const made = want.filter((s) => fs.existsSync(path.join(dir, `${s}.s64hack`)));
    if (code !== 0 && made.length < want.length) {
      throw new SetupError(`${want.length - made.length} sample hack(s) could not be made`, 'The home screen shows the ones that worked.', 'Press Try again to make the missing ones.');
    }
    return `${made.length} sample hacks`;
  }
}
