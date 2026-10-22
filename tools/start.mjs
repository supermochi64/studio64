#!/usr/bin/env node
// npm start: everything a fresh checkout needs to run, in one command.
//  1. checks Node, installs the npm packages if they are missing,
//  2. starts the server (server/index.js) and opens the browser,
//  3. starts the server again when the first-run setup asks for it (exit code 75).
// Without a built game the browser shows the setup: drop your ROM, the rest is automatic.
//   STUDIO_OPEN=0      don't open a browser      PORT, HOST, ...: see docs/settings.md
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8064);
const HOST = process.env.HOST || '127.0.0.1';
const IS_WIN = process.platform === 'win32';

const say = (s) => console.log(`  ${s}`);
const major = Number(process.versions.node.split('.')[0]);
if (major < 18) {
  console.error(`\n  Studio 64 needs Node.js 18 or newer (this is ${process.version}). Get it from https://nodejs.org\n`);
  process.exit(1);
}

// 1. npm packages
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const missing = Object.keys(pkg.dependencies || {}).filter((d) => !fs.existsSync(path.join(ROOT, 'node_modules', d, 'package.json')));
if (missing.length) {
  say(`Installing the npm packages (${missing.length} missing, once)...`);
  // npm's own script, run by this Node (the launchers' private Node has no npm on PATH)
  const besideNode = [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')];   // Linux, macOS
  const npm = [process.env.npm_execpath, ...besideNode].find((f) => f && /\.(c?js|mjs)$/.test(f) && fs.existsSync(f));
  const args = ['install', '--no-audit', '--no-fund', '--loglevel=error'];
  const r = npm
    ? spawnSync(process.execPath, [npm, ...args], { cwd: ROOT, stdio: 'inherit' })
    : spawnSync(IS_WIN ? 'npm.cmd' : 'npm', args, { cwd: ROOT, stdio: 'inherit', shell: IS_WIN });
  if (r.status !== 0) {
    console.error('\n  npm install failed. Check your internet connection and start Studio 64 again.\n');
    process.exit(1);
  }
}

// which Studio 64 folder a server runs from (server/index.js answers it in /api/config)
const INSTANCE = (await import('node:crypto')).createHash('sha1').update(ROOT).digest('hex').slice(0, 12);
let PORT_NOW = PORT;
const urlOf = (port) => (HOST === '0.0.0.0' || HOST === '127.0.0.1' ? `http://localhost:${port}` : `http://${HOST}:${port}`);

/** What answers on a port: 'ours' (this folder's Studio 64), 'other' (another program or Studio 64 folder), or null (free). */
async function probe(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/config`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return 'other';
    const c = await r.json().catch(() => ({}));
    return c.instance === INSTANCE || (c.instance === undefined && 'models' in c && !process.env.STUDIO_LAUNCHER) ? 'ours' : 'other';
  } catch (err) {
    // nothing listening: free (a program that is not a web server would refuse the request too)
    return (await portFree(port)) ? null : 'other';
  }
}
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer().once('error', () => resolve(false)).once('listening', () => s.close(() => resolve(true)));
    s.listen(port, HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1');
  });
}
const alive = async () => (await probe(PORT_NOW)) === 'ours';

function openBrowser(url) {
  if (/^(0|off|false|no)$/i.test(process.env.STUDIO_OPEN || '') || process.env.CI) return;
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return; // a server without a desktop
  const [cmd, args] = IS_WIN ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => {}).unref(); } catch { /* no browser: the URL is printed */ }
}

const seen = await probe(PORT_NOW);
if (seen === 'ours') {
  say(`Studio 64 is already running: ${urlOf(PORT_NOW)}`);
  say('(It runs in its other window. This window can be closed.)');
  openBrowser(urlOf(PORT_NOW));
  process.exit(0);
}
if (seen === 'other') {
  // the port is taken (another program, or another Studio 64 folder): the next free one, unless PORT was chosen
  if (process.env.PORT) {
    console.error(`\n  Port ${PORT} is already in use by another program. Start Studio 64 on another port: PORT=${PORT + 1} npm start\n`);
    process.exit(1);
  }
  for (let p = PORT + 1; p < PORT + 40; p++) if ((await probe(p)) !== 'other') { PORT_NOW = p; break; }
  if (PORT_NOW === PORT) { console.error(`\n  Ports ${PORT}-${PORT + 39} are all in use. Close some programs and start Studio 64 again.\n`); process.exit(1); }
  if ((await probe(PORT_NOW)) === 'ours') { say(`Studio 64 is already running: ${urlOf(PORT_NOW)}`); openBrowser(urlOf(PORT_NOW)); process.exit(0); }
  say(`(Port ${PORT} is used by another program: Studio 64 uses ${PORT_NOW}.)`);
}

// 2. + 3. the server, started again when it exits with 75
let child = null;
let opened = false;
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopping = true; child?.kill(sig === 'SIGHUP' ? 'SIGTERM' : sig); });

function startServer(restart = false) {
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, PORT: String(PORT_NOW), STUDIO_SUPERVISED: '1', ...(restart ? { STUDIO_RESTART_WAIT: '1' } : {}) },
  });
  child.on('exit', (code, signal) => {
    if (code === 75 && !stopping) { say('Restarting the server after the setup...'); startServer(true); return; }
    process.exit(code ?? (signal ? 0 : 1));
  });
  if (!opened) {
    opened = true;
    (async () => {
      for (let i = 0; i < 150; i++) {
        if (await alive()) {
          if (process.env.STUDIO_LAUNCHER) {
            say(`Studio 64 opens in your web browser. If it does not, open this address: ${urlOf(PORT_NOW)}`);
            say('Keep this window open while you use Studio 64. Close it to stop Studio 64.\n');
          }
          openBrowser(urlOf(PORT_NOW));
          return;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    })();
  }
}
startServer();
