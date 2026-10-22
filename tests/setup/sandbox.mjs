#!/usr/bin/env node
// The setup as a new user meets it, in a clean Linux without root: a downloaded distribution
// image (no compiler, no make, no git, often no Python) run with bwrap (user namespaces), the
// release ZIP unpacked into its home folder, the launcher started there (start-studio64.sh, as a
// double-click would), and the browser wizard driven from this machine with Playwright: drop the
// ROM through the file input, press Build, wait until the studio opens, then place an object and
// play (tests/setup/studio_check.test.mjs). Not part of npm test (it takes 10-20 minutes and
// downloads ~600 MB per run); see docs/testing.md.
//
//   node tests/setup/sandbox.mjs prepare <distro>...       download + unpack the images
//   node tests/setup/sandbox.mjs run <distro> [options]
//     --zip FILE          the release ZIP (default dist/studio64-<version>.zip)
//     --rom FILE          the ROM to drop (default engine/baserom.us.z64)
//     --order v64|n64     drop the ROM in this byte order (converted first)
//     --wrong-rom         drop a changed ROM and a text file first: the page must say what is wrong
//     --parent PATH       unpack the ZIP into ~/PATH (default Downloads); spaces and accents welcome
//     --hide curl,wget    make these programs missing (the launcher's other download paths)
//     --interrupt         stop the whole sandbox in the middle of the build, start again, Continue
//     --second            then stop and start again: no setup, no downloads, fast
//     --offline           then start again without any network: it must still run
//     --extras            run the background pictures and samples too (default: off)
//     --shots DIR         save the wizard's screenshots there
//     --port N            (default 8093)        --jobs N   compile jobs (default 6)
//     --keep              keep the instance folder (default: deleted after a passing run)
//   Images and instances live in $S64_SANDBOX (default ~/s64-setup-test).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = path.resolve(process.env.S64_SANDBOX || path.join(os.homedir(), 's64-setup-test'));
const DISTROS = {
  'ubuntu-22.04': 'ubuntu/jammy', 'ubuntu-24.04': 'ubuntu/noble', 'debian-12': 'debian/bookworm',
  'fedora-44': 'fedora/44', 'fedora-43': 'fedora/43', arch: 'archlinux/current',
};
const [cmd, ...rest] = process.argv.slice(2);
const flag = (k) => rest.includes(k);
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 && rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : d; };
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const imageDir = (d) => path.join(BASE, 'rootfs', d);

// ---- images -------------------------------------------------------------------------------------
async function prepare(distro) {
  const where = DISTROS[distro];
  if (!where) throw new Error(`unknown distro ${distro}: ${Object.keys(DISTROS).join(', ')}`);
  const dir = imageDir(distro);
  if (!fs.existsSync(path.join(dir, 'etc', 'os-release'))) {
    const index = await (await fetch('https://images.linuxcontainers.org/meta/1.0/index-system')).text();
    const line = index.split('\n').find((l) => l.startsWith(`${where.replace('/', ';')};amd64;default;`));
    if (!line) throw new Error(`no image for ${where}`);
    const url = `https://images.linuxcontainers.org${line.split(';').pop()}rootfs.tar.xz`;
    const file = path.join(BASE, 'rootfs-dl', `${distro}.tar.xz`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) {
      log(`downloading ${url}`);
      const r = spawnSync('curl', ['-fsSL', '-o', file, url], { stdio: 'inherit' });
      if (r.status !== 0) throw new Error('download failed');
    }
    fs.mkdirSync(dir, { recursive: true });
    spawnSync('tar', ['-xJf', file, '-C', dir, '--no-same-owner', '--no-same-permissions', '--exclude=./dev/*'], { stdio: 'ignore' });
  }
  // a plain resolv.conf (the image's points to systemd-resolved), a user with uid 1000
  const rc = path.join(dir, 'etc', 'resolv.conf');
  fs.rmSync(rc, { force: true });
  fs.copyFileSync('/etc/resolv.conf', rc);
  const passwd = fs.readFileSync(path.join(dir, 'etc', 'passwd'), 'utf8');
  if (!/^[^:]*:[^:]*:1000:/m.test(passwd)) {
    fs.appendFileSync(path.join(dir, 'etc', 'passwd'), 'player:x:1000:1000:Player:/home/player:/bin/bash\n');
    fs.appendFileSync(path.join(dir, 'etc', 'group'), 'player:x:1000:\n');
  }
  const user = passwd.split('\n').find((l) => l.split(':')[2] === '1000')?.split(':') || ['player', '', '1000', '1000', '', '/home/player'];
  fs.mkdirSync(path.join(dir, user[5].replace(/^\//, '')), { recursive: true });
  const tools = ['python3', 'gcc', 'cc', 'make', 'git', 'curl', 'wget', 'xz', 'node'].filter((t) => fs.existsSync(path.join(dir, 'usr', 'bin', t)));
  log(`${distro}: ${fs.readFileSync(path.join(dir, 'etc', 'os-release'), 'utf8').match(/PRETTY_NAME="?([^"\n]*)/)?.[1]}; has: ${tools.join(' ') || 'none of them'}`);
  return { dir, user: user[0], home: user[5] };
}

// ---- one run --------------------------------------------------------------------------------------
async function runDistro(distro) {
  const img = await prepare(distro);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const zip = path.resolve(opt('--zip', path.join(ROOT, 'dist', `studio64-${pkg.version}.zip`)));
  const rom = path.resolve(opt('--rom', path.join(ROOT, 'engine', 'baserom.us.z64')));
  const port = Number(opt('--port', 8093));
  const url = `http://127.0.0.1:${port}`;
  const parent = opt('--parent', 'Downloads');
  const label = `${distro}${flag('--interrupt') ? '-interrupt' : ''}`;
  const inst = path.join(BASE, 'inst', label);
  const report = { distro, started: new Date().toISOString(), parent, steps: {}, checks: [], timings: {} };
  const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail }); log(`${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail ? ` -- ${JSON.stringify(detail).slice(0, 400)}` : ''}`); return ok; };
  if (!fs.existsSync(zip)) throw new Error(`no ZIP at ${zip} (node tools/make_release_zip.mjs)`);
  if (await fetch(`${url}/api/config`).then(() => true, () => false)) throw new Error(`something already listens on ${port}`);

  // a fresh home with the unpacked ZIP, as a user's Downloads folder
  fs.rmSync(inst, { recursive: true, force: true });
  const home = path.join(inst, 'home');
  const tmp = path.join(inst, 'tmp');
  fs.mkdirSync(path.join(home, parent), { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  const unz = spawnSync('unzip', ['-q', zip, '-d', path.join(home, parent)]);
  if (unz.status !== 0) throw new Error(`unzip failed: ${unz.stderr}`);
  const folderIn = path.posix.join(img.home, parent, 'Studio 64');   // inside the sandbox
  const folderOut = path.join(home, parent, 'Studio 64');           // the same folder from here
  check('the ZIP unpacks with the launcher executable', (fs.statSync(path.join(folderOut, 'start-studio64.sh')).mode & 0o111) !== 0);

  let n = 0;
  let current = null;
  const hide = (opt('--hide', '') || '').split(',').filter((h) => h && fs.existsSync(path.join(img.dir, 'usr', 'bin', h)));
  const start = ({ offline = false, extra = [] } = {}) => {
    const scope = `s64sb-${distro.replace(/\W/g, '')}-${process.pid}-${++n}`;
    const args = [
      '--ro-bind', img.dir, '/', '--dev', '/dev', '--proc', '/proc', '--bind', tmp, '/tmp', '--tmpfs', '/run',
      '--bind', home, img.home,
      ...hide.flatMap((h) => ['--ro-bind', '/dev/null', `/usr/bin/${h}`]),
      '--unshare-user', '--uid', '1000', '--gid', '1000', '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--unshare-cgroup-try',
      ...(offline ? ['--unshare-net'] : []),
      '--hostname', `s64-${distro.replace(/\W/g, '')}`, '--die-with-parent',
      '--clearenv', '--setenv', 'HOME', img.home, '--setenv', 'USER', img.user, '--setenv', 'LOGNAME', img.user,
      '--setenv', 'PATH', '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'TERM', 'xterm-256color',
      '--setenv', 'PORT', String(port), '--setenv', 'STUDIO_OPEN', '0', '--setenv', 'STUDIO_JOBS', String(opt('--jobs', 6)),
      ...(flag('--extras') ? [] : ['--setenv', 'STUDIO_SETUP_EXTRAS', 'off']),
      '--chdir', folderIn, ...(extra.length ? extra : ['sh', './start-studio64.sh']),
    ];
    const logFile = path.join(inst, `launcher-${n}.log`);
    const out = fs.openSync(logFile, 'w');
    // memory: the whole sandbox may use 7 GB (+3 GB swap); an engine link needs ~4.6 GB
    const child = spawn('systemd-run', ['--user', '--scope', `--unit=${scope}`, '-p', 'MemoryMax=7G', '-p', 'MemorySwapMax=3G', '--quiet', 'bwrap', ...args], { stdio: ['ignore', out, out] });
    child.scope = scope;
    child.logFile = logFile;
    child.startedAt = Date.now();
    child.exited = new Promise((r) => child.on('exit', (code, sig) => r(code ?? sig)));
    current = child;
    return child;
  };
  const stop = async (child = current) => {
    if (!child || child.exitCode !== null) return;
    spawnSync('systemctl', ['--user', 'kill', '--signal=SIGKILL', `${child.scope}.scope`]);
    await Promise.race([child.exited, sleep(10000)]);
  };
  const memPeak = (child = current) => Number((spawnSync('systemctl', ['--user', 'show', `${child.scope}.scope`, '-p', 'MemoryPeak'], { encoding: 'utf8' }).stdout.match(/=(\d+)/) || [])[1] || 0);
  const status = () => fetch(`${url}/api/setup/status`).then((r) => r.json()).catch(() => null);
  const waitUp = async (ms, child = current) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (child.exitCode !== null) return false;
      if (await fetch(`${url}/api/config`).then((r) => r.ok, () => false)) return true;
      await sleep(500);
    }
    return false;
  };
  process.on('SIGINT', async () => { await stop(); process.exit(130); });

  const { driveWizard } = await import('./wizard.mjs');
  let ok = true;
  try {
    // 1. the launcher: Node, npm packages, the server
    const t0 = Date.now();
    start();
    const up = await waitUp(15 * 60 * 1000);
    report.timings.launcherToServer = Math.round((Date.now() - t0) / 1000);
    const launcherLog = () => fs.readFileSync(current.logFile, 'utf8');
    if (!check('the launcher starts the server', up, launcherLog().slice(-1500))) throw new Error('no server');
    check('the launcher got its own Node.js', /Node\.js is ready/.test(launcherLog()), launcherLog().slice(0, 600));

    // 2. + 3. the wizard (and with --interrupt: everything stopped in the middle of the build)
    let interrupted = !flag('--interrupt');
    const tGo = Date.now();
    const wizardOk = await driveWizard({
      url, rom, order: opt('--order', 'z64'), wrongRom: flag('--wrong-rom'), shots: opt('--shots', null), scratch: inst, report,
      onStatus: async (st, page) => {
        const run = st.steps.find((x) => x.state === 'running');
        if (interrupted || run?.id !== 'engine' || !(run.progress > 0.35)) return null;
        interrupted = true;
        log('   -- stopping everything in the middle of the build (like pulling the plug)');
        await stop();
        report.timings.interruptedAfter = Math.round((Date.now() - tGo) / 1000);
        start();
        check('after the interruption the launcher starts again', await waitUp(5 * 60 * 1000));
        await page.reload({ waitUntil: 'domcontentloaded' });
        check('the page offers to continue', await page.locator('#paused-card').waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false));
        await page.waitForTimeout(500);
        if (opt('--shots', null)) await page.screenshot({ path: path.join(opt('--shots'), 'setup-interrupted.png') });
        await page.click('#resume');
        return 'continue';
      },
    });
    if (flag('--interrupt')) check('the build was interrupted and continued', interrupted);
    report.memoryPeakMB = Math.round(memPeak() / 1e6);
    if (!wizardOk) throw new Error('setup failed');

    // 4. place an object and play
    const sc = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'setup', 'studio_check.test.mjs')], { env: { ...process.env, STUDIO_URL: url }, encoding: 'utf8', timeout: 10 * 60 * 1000 });
    const scOut = `${sc.stdout}${sc.stderr}`;
    fs.writeFileSync(path.join(inst, 'studio_check.log'), scOut);
    check('in the studio: place a Goomba with the mouse and play', sc.status === 0, scOut.split('\n').filter((l) => /FAIL|Error/.test(l)).slice(0, 8));
    const stNow = await status();
    report.stepsFinal = stNow?.steps?.map((s) => `${s.id}:${s.state}${s.seconds != null ? `:${s.seconds}s` : ''}`);
    report.tools = (fs.readFileSync(path.join(folderOut, '.setup', 'setup.log'), 'utf8').match(/build tools: (.*)/) || [])[1];

    // 5. a second start: no setup, no downloads, fast
    if (flag('--second') || flag('--offline')) {
      await stop();
      const t1 = Date.now();
      start();
      const up2 = await waitUp(5 * 60 * 1000);
      report.timings.secondStart = Math.round((Date.now() - t1) / 1000);
      const home2 = await fetch(`${url}/`).then((x) => x.text()).catch(() => '');
      check('a second start opens the studio (no setup page)', up2 && !/Set up Studio 64/.test(home2) && /<title>/.test(home2));
      for (let i = 0; i < 40 && !/opens in your web browser/.test(fs.readFileSync(current.logFile, 'utf8')); i++) await sleep(250);
      const l2 = fs.readFileSync(current.logFile, 'utf8');
      check('the second start is this new launcher (not the old server)', /opens in your web browser/.test(l2), l2.slice(-400));
      check('a second start downloads nothing', !/Getting Node\.js|Installing the npm packages/.test(l2), l2.slice(0, 500));
      check(`a second start is fast (${report.timings.secondStart} s)`, report.timings.secondStart < 30);
      const st2 = await status();
      check('a second start builds nothing', st2 && !st2.running && st2.steps.every((s) => s.state !== 'running'), st2?.steps);
    }

    // 6. offline: no network at all in the sandbox (the browser here can't reach it either: a
    // script inside checks that the studio and the game are served)
    if (flag('--offline')) {
      await stop();
      const probe = path.join(home, 'offline-check.mjs');
      fs.writeFileSync(probe, `
const url = 'http://127.0.0.1:${port}';
const out = {};
for (let i = 0; i < 240; i++) { try { if ((await fetch(url + '/api/config')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
try { const h = await (await fetch(url + '/')).text(); out.studio = /<title>/.test(h) && !/Set up Studio 64/.test(h); } catch (e) { out.err = e.message; }
try { const r = await fetch(url + '/engine/sm64.us.f3dex2e.wasm'); out.wasm = r.ok && Number(r.headers.get('content-length') || (await r.arrayBuffer()).byteLength) > 1e6; } catch (e) { out.err2 = e.message; }
try { out.internet = await fetch('https://nodejs.org', { signal: AbortSignal.timeout(4000) }).then(() => true, () => false); } catch { out.internet = false; }
console.log('OFFLINE-RESULT ' + JSON.stringify(out));
process.exit(0);
`);
      const nodeIn = fs.existsSync(path.join(folderOut, '.runtime', 'node', 'bin', 'node')) ? path.posix.join(folderIn, '.runtime/node/bin/node') : 'node';
      const c = start({ offline: true, extra: ['sh', '-c', `sh ./start-studio64.sh > "$HOME/offline-server.log" 2>&1 & "${nodeIn}" "$HOME/offline-check.mjs"`] });
      await Promise.race([c.exited, sleep(4 * 60 * 1000)]);
      const res = JSON.parse((fs.readFileSync(c.logFile, 'utf8').match(/OFFLINE-RESULT (.*)/) || [])[1] || '{}');
      check('offline: no internet in the sandbox', res.internet === false, res);
      check('offline: the studio and the game are served', res.studio && res.wasm, { res, server: fs.readFileSync(path.join(home, 'offline-server.log'), 'utf8').slice(-800) });
      await stop(c);
    }
  } catch (err) {
    ok = false;
    report.error = String(err.stack || err);
    log(`ERROR ${err.message}`);
  } finally {
    await stop();
  }
  report.ok = ok && report.checks.every((c) => c.ok);
  report.finished = new Date().toISOString();
  const file = path.join(BASE, 'reports', `${label}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 1));
  // the downloads and the build stay only when asked (they are ~3 GB)
  if (!flag('--keep') && report.ok) fs.rmSync(inst, { recursive: true, force: true });
  log(`${report.ok ? 'PASS' : 'FAIL'} ${label}: ${report.checks.filter((c) => c.ok).length}/${report.checks.length} checks; setup ${report.timings.setupToStudio}s; report ${file}`);
  return report.ok;
}

if (cmd === 'prepare') { for (const d of rest.filter((x) => !x.startsWith('--'))) await prepare(d); }
else if (cmd === 'run') process.exit((await runDistro(rest[0])) ? 0 : 1);
else { console.log('usage: node tests/setup/sandbox.mjs prepare <distro>... | run <distro> [options]'); process.exit(2); }
