#!/usr/bin/env node
// Runs a ROM in ares on a virtual X display, takes screenshots and collects the game's debug output
// (libdragon's debugf goes to ares's IS-Viewer log on stdout). For testing without a TV.
//
//   node tools/emu.mjs sandbox.z64 --seconds 30 --shots 10,20,30 --out shots/
//   (ARES=/path/to/ares, DISPLAY_NUM=77)
//
// The game reads a test script when built with TEST=<name> (src/testplay.c), so the emulator needs
// no input: the ROM plays itself and prints "TEST ..." lines.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const rom = path.resolve(args[0] || 'sandbox.z64');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const seconds = Number(opt('--seconds', 20));
const shots = String(opt('--shots', '')).split(',').filter(Boolean).map(Number);
const out = path.resolve(opt('--out', 'shots'));
const until = opt('--until', null); // stop early when a log line matches this regex
const ARES = process.env.ARES || path.join(os.homedir(), 'n64/ares/build/rundir/bin/ares');
const DISP = `:${process.env.DISPLAY_NUM || 77}`;
fs.mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, DISPLAY: DISP };

let xvfb = null;
try { execFileSync('xdpyinfo', ['-display', DISP], { stdio: 'ignore' }); } catch {
  xvfb = spawn('Xvfb', [DISP, '-screen', '0', '1024x768x24'], { stdio: 'ignore' });
  await sleep(800);
}

const ares = spawn(ARES, ['--system', 'Nintendo 64', '--no-file-prompt', rom], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
let started = 0;
const onData = (d) => {
  const s = d.toString();
  log += s;
  if (!started && /Loaded /.test(s)) started = Date.now();
  for (const line of s.split('\n')) {
    if (/^(TEST|FAIL|PASS|PERF|ASSERT|PANIC|SHOT)/.test(line)) console.log(line);
    const m = /^SHOT (\w+)/.exec(line);
    if (m) setTimeout(() => shot(`${m[1]}.png`), 150); // the frame after the line
  }
};
ares.stdout.on('data', onData);
ares.stderr.on('data', onData);

function shot(name) {
  const file = path.join(out, name);
  try {
    const id = execFileSync('xdotool', ['search', '--name', '^ares', ], { env }).toString().trim().split('\n').pop();
    const g = Object.fromEntries(execFileSync('xdotool', ['getwindowgeometry', '--shell', id], { env }).toString().trim().split('\n').map((l) => l.split('=')));
    execFileSync('import', ['-display', DISP, '-window', 'root', file], { env });
    // the game area: below the menu bar, above the status bar (the window's 4:3 picture)
    execFileSync('convert', [file, '-crop', `750x576+${Number(g.X) + 108}+${Number(g.Y) + 71}`, '+repage', file]);
  } catch (e) { console.error('screenshot failed', e.message); }
  return file;
}

const t0 = Date.now();
while (!started && Date.now() - t0 < 30000) await sleep(100);
const begin = started || Date.now();
const pending = [...shots].sort((a, b) => a - b);
while (Date.now() - begin < seconds * 1000) {
  if (pending.length && Date.now() - begin >= pending[0] * 1000) console.log('shot', shot(`shot_${pending.shift()}.png`));
  if (until && new RegExp(until).test(log)) break;
  if (ares.exitCode !== null) break;
  await sleep(100);
}
for (const t of pending) console.log('shot', shot(`shot_${t}.png`));
ares.kill('SIGKILL');
if (xvfb) xvfb.kill();
fs.writeFileSync(path.join(out, 'emu.log'), log);
const fails = log.split('\n').filter((l) => /^(FAIL|ASSERT|PANIC)/.test(l));
console.log(`emu: ${Math.round((Date.now() - begin) / 1000)} s, ${fails.length} failure lines, log ${path.join(out, 'emu.log')}`);
process.exit(fails.length ? 1 : 0);
