#!/usr/bin/env node
// Studio 64 test runner.
//
//   npm test                    every test except the ones that need a Claude login (@tags ai)
//   npm run test:smoke          the fast subset (@tags smoke)
//   npm run test:ai             only the tests that talk to the real Claude
//   npm run test:noai           no AI connected (own server with STUDIO_AI=off): smoke + no_ai
//   node tests/run.mjs editor levels   tests whose file name contains "editor" or "levels"
//   -j 4                        run 4 tests at a time (default: TEST_JOBS or 3)
//   --list                      print the tests and their tags
//
// Unless STUDIO_URL is set, the runner starts its own server on a free port with an
// empty projects folder (tests/out/projects/run-*, removed afterwards unless KEEP_PROJECTS=1),
// so runs never touch your projects.
// Each test makes its own project, so tests run in parallel. Logs and screenshots go to
// tests/out/ (logs/<test>.log, <test>/*.png).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const SUITE = path.join(here, 'suite');
const SCRIPTS_DIR = path.join(here, 'scripts');
const OUT = path.join(here, 'out');
const LOGS = path.join(OUT, 'logs');

const args = process.argv.slice(2);
// software-rendered browsers share the CPU: on a busy machine run one test at a time (a starved
// page draws 0-2 frames a second and nothing finishes)
const busy = os.loadavg()[0] > os.cpus().length;
let jobs = Number(process.env.TEST_JOBS) || (busy ? 1 : 3);
const filters = [];
let mode = 'default';
let list = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '-j' || a === '--jobs') jobs = Number(args[++i]) || jobs;
  else if (a.startsWith('-j')) jobs = Number(a.slice(2)) || jobs;
  else if (a === '--smoke') mode = 'smoke';
  else if (a === '--ai') mode = 'ai';
  else if (a === '--all') mode = 'all';
  else if (a === '--noai') mode = 'noai';
  else if (a === '--list') list = true;
  else filters.push(a);
}

// ---- discover -------------------------------------------------------------

function meta(file) {
  const head = fs.readFileSync(file, 'utf8').split('\n').slice(0, 12).join('\n');
  const tags = (head.match(/@tags\s+([^\n]*)/) || [, ''])[1].trim().split(/[\s,]+/).filter(Boolean);
  const timeout = Number((head.match(/@timeout\s+(\d+)/) || [, 0])[1]) || 420;
  const desc = (head.match(/^\/\/\s*(.+)$/m) || [, ''])[1];
  return { file, name: path.basename(file).replace(/\.test\.mjs$/, ''), tags, timeout, desc };
}

// Older plain scripts in tests/scripts/ (exit code 1 on failure, "PASS x" / "FAIL x" lines): run
// like the suite files. `mock`: started with a scripted fake LLM on a free port (MOCK_URL).
const SCRIPTS = [
  { file: 'story_tools.mjs', tags: ['story', 'smoke'], timeout: 120, desc: 'Story tools without Claude or a browser' },
  { file: 'story_smoke.mjs', tags: ['story'], timeout: 420, desc: 'Story panel, project dialogs in the game, a Toad that talks' },
  { file: 'story_flow.mjs', tags: ['story'], timeout: 600, desc: 'A whole little story played like a player: Toad, zone, gate, cutscene, reload' },
  { file: 'story_extras.mjs', tags: ['story'], timeout: 600, desc: 'Questions, signs, the opening letter and the credits with project text' },
  { file: 'story_ui.mjs', tags: ['story'], timeout: 600, desc: 'Story panel tabs, Logic tab, inspector, course and star names' },
  { file: 'world_tools.mjs', tags: ['world'], timeout: 420, desc: "Claude's world tools against the real game (no Claude)" },
  { file: 'world_doors.mjs', tags: ['world'], timeout: 600, desc: 'Areas and doors: a room in a custom level, Mario walks through both ways' },
  { file: 'world_flow.mjs', tags: ['world'], timeout: 900, desc: 'A hack without the castle: hub, painting, star/key/event doors' },
  { file: 'world_env.mjs', tags: ['world'], timeout: 600, desc: 'Fog, light, snow/rain, water box, gas, lava, warp zones' },
  { file: 'world_ui.mjs', tags: ['world'], timeout: 600, desc: 'The World tab by hand: areas, doors, pipes, environment' },
  { file: 'world_look.mjs', tags: ['world'], timeout: 600, desc: 'World tools in build mode: zone boxes, door inspector, painting picker' },
  { file: 'sunshine_tools.mjs', tags: ['sunshine'], timeout: 120, desc: "Claude's Sunshine tools against a stub context" },
  { file: 'sunshine_library.mjs', tags: ['sunshine'], timeout: 420, desc: 'Sunshine tab of the library: thumbnails, placing, Kind control' },
  { file: 'sunshine_enemies.mjs', tags: ['sunshine'], timeout: 600, desc: 'Sunshine enemies draw, chase Mario, react to stomps' },
  { file: 'sunshine_talk.mjs', tags: ['sunshine'], timeout: 600, desc: 'Talking to Piantas and Nokis with B' },
  { file: 'sunshine_shine.mjs', tags: ['sunshine'], timeout: 600, desc: 'A Shine Sprite from the Stars tab: listed and collected like a star' },
  { file: 'no_ai.mjs', name: 'no_ai_widths', tags: ['noai'], timeout: 600, env: { EXPECT: 'off' }, desc: 'No AI: no chat, no AI element, the game fills the width, features work (several widths)' },
  { file: 'ai_loop.mjs', tags: ['ai-free', 'chat'], timeout: 300, desc: 'The agent loop against a scripted fake LLM in all three dialects' },
  { file: 'ai_providers.mjs', tags: ['ai-free', 'chat'], timeout: 600, mock: true, desc: 'Connect any LLM: AI settings, an OpenAI-compatible endpoint (fake LLM), build through the chat' },
].filter((x) => fs.existsSync(path.join(SCRIPTS_DIR, x.file))).map((x) => ({ ...x, file: path.join(SCRIPTS_DIR, x.file), name: x.name || x.file.replace(/\.mjs$/, ''), script: true }));

let tests = [...fs.readdirSync(SUITE).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => meta(path.join(SUITE, f))), ...SCRIPTS];
// a filter picks tests by name; AI and manual tests still need --ai/--all (or their exact name)
if (filters.length) tests = tests.filter((t) => filters.some((f) => t.name === f || (t.name.includes(f) && (mode !== 'default' || (!t.tags.includes('ai') && !t.tags.includes('manual'))))));
if (mode === 'smoke') tests = tests.filter((t) => t.tags.includes('smoke'));
// no AI connected: the smoke tests that do not need the chat, and the no-AI checks
else if (mode === 'noai') tests = tests.filter((t) => t.tags.includes('noai') || (t.tags.includes('smoke') && !t.tags.includes('chat')));
else if (mode === 'ai') tests = tests.filter((t) => t.tags.includes('ai'));
else if (mode === 'default' && !filters.length) tests = tests.filter((t) => !t.tags.includes('ai') && !t.tags.includes('manual') && !t.tags.includes('noai'));

if (list) {
  for (const t of tests) console.log(`${t.name.padEnd(28)} ${t.tags.join(',').padEnd(22)} ${t.desc}`);
  process.exit(0);
}
if (!tests.length) { console.log('no tests match'); process.exit(1); }

// ---- server ---------------------------------------------------------------

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

let server = null;
let projectsDir = null;
const serverLog = path.join(LOGS, `_server-${process.pid}.log`);
let base = process.env.STUDIO_URL;
async function startServer() {
  const port = await freePort();
  // a folder of its own: several runs at once must not share (or wipe) each other's projects
  const dir = path.join(OUT, 'projects', `run-${process.pid}-${Date.now().toString(36)}`);
  fs.mkdirSync(dir, { recursive: true });
  projectsDir = dir;
  fs.mkdirSync(LOGS, { recursive: true });
  const log = fs.openSync(serverLog, 'w');
  server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STUDIO_PROJECTS: dir, STUDIO_PASSWORD: '', ...(mode === 'noai' ? { STUDIO_AI: 'off' } : {}) },
    stdio: ['ignore', log, log],
  });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 400; i++) { // up to a minute: a busy machine starts node slowly
    try { const r = await fetch(base + '/api/config'); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`the test server did not start (see ${path.relative(ROOT, serverLog)})`);
}
const stopServer = () => {
  try { server?.kill(); } catch { /* gone */ }
  if (projectsDir && !process.env.KEEP_PROJECTS) try { fs.rmSync(projectsDir, { recursive: true, force: true }); } catch { /* ignore */ }
};
const children = new Set();
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { for (const c of children) try { c.kill('SIGKILL'); } catch { /* gone */ } stopServer(); process.exit(130); });

// ---- run ------------------------------------------------------------------

function runOne(t) {
  return new Promise(async (resolve) => {
    const t0 = Date.now();
    const logFile = path.join(LOGS, `${t.name}.log`);
    const out = fs.createWriteStream(logFile);
    const extraEnv = { ...(t.env || {}) };
    let mock = null;
    if (t.mock) {
      const port = await freePort();
      mock = spawn(process.execPath, [path.join(here, 'lib', 'mock_llm.mjs'), String(port)], { cwd: ROOT, stdio: 'ignore' });
      extraEnv.MOCK_URL = `http://127.0.0.1:${port}/v1`;
      await new Promise((r) => setTimeout(r, 1500));
    }
    const child = spawn(process.execPath, [t.file], {
      cwd: ROOT, env: { ...process.env, ...extraEnv, STUDIO_URL: base, TEST_TIMEOUT: String(t.timeout * 1000) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    if (mock) children.add(mock);
    let result = null;
    let tail = '';
    let all = '';
    const onData = (d) => {
      out.write(d);
      if (all.length < 2e6) all += d;
      tail = (tail + d).slice(-6000);
      const m = String(tail).match(/@@RESULT (\{.*\})/);
      if (m) try { result = JSON.parse(m[1]); } catch { /* partial */ }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    // hard kill a bit after the test's own timeout
    const killer = setTimeout(() => { child.kill('SIGKILL'); }, (t.timeout + 60) * 1000);
    child.on('close', (code) => { // after all output arrived
      children.delete(child); if (mock) children.delete(mock);
      clearTimeout(killer);
      out.end();
      const ms = Date.now() - t0;
      try { mock?.kill(); } catch { /* gone */ }
      if (!result && t.script) {
        // a plain script: its exit code, and its PASS/FAIL lines as checks
        const lines = all.split('\n');
        const failed = lines.filter((l) => /^\s*FAIL\b/.test(l)).map((l) => l.replace(/^\s*FAIL\s*/, '').slice(0, 80));
        const passed = lines.filter((l) => /^\s*(PASS|ok)\b/.test(l)).length;
        result = { name: t.name, ok: code === 0 && !failed.length, checks: passed + failed.length, failed, error: code === null ? 'killed (timeout)' : code !== 0 && !failed.length ? `exited with ${code}` : null };
      }
      if (!result) result = { name: t.name, ok: false, checks: 0, failed: [], error: code === null ? 'killed (timeout)' : `exited with ${code} without a result` };
      result.ok = result.ok && code === 0;
      result.ms = ms;
      result.file = t.name;
      result.log = path.relative(ROOT, logFile);
      if (!result.ok) {
        const lines = tail.split('\n').filter((l) => /FAIL|ERROR|pageerror|console.error/.test(l)).slice(0, 8);
        result.detail = lines.join('\n');
      }
      resolve(result);
    });
  });
}

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
async function main() {
  fs.mkdirSync(LOGS, { recursive: true });
  if (mode === 'noai' && base) { console.log('--noai starts its own server with STUDIO_AI=off: unset STUDIO_URL'); process.exit(2); }
  if (!base) await startServer();
  if (busy && !process.env.TEST_JOBS) console.log(`(the machine is busy: load ${os.loadavg()[0].toFixed(0)} on ${os.cpus().length} cores, so one test at a time; TEST_JOBS overrides)`);
  console.log(`Studio 64 tests: ${tests.length} test(s), ${jobs} at a time, server ${base}${server ? ' (own, empty projects)' : ''}\n`);
  const queue = tests.slice();
  const results = [];
  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) {
      const t = queue.shift();
      const r = await runOne(t);
      results.push(r);
      console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${pad(t.name, 28)} ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.checks - (r.failed?.length || 0)}/${r.checks} checks${r.ok ? '' : '   -> ' + r.log}`);
      if (!r.ok && r.detail) console.log(r.detail.split('\n').map((l) => '        ' + l.trim().slice(0, 160)).join('\n'));
    }
  }));
  stopServer();
  results.sort((a, b) => tests.findIndex((t) => t.name === a.file) - tests.findIndex((t) => t.name === b.file));
  const failed = results.filter((r) => !r.ok);
  console.log('\n' + pad('test', 28) + ' result   time    checks  failed checks');
  console.log('-'.repeat(96));
  for (const r of results) {
    const why = r.ok ? '' : (r.error ? r.error : (r.failed || []).join('; '));
    console.log(`${pad(r.file, 28)} ${r.ok ? 'pass' : 'FAIL'}  ${(r.ms / 1000).toFixed(0).padStart(5)}s  ${String(r.checks - (r.failed?.length || 0)).padStart(3)}/${pad(r.checks, 4)}  ${why.slice(0, 120)}`);
  }
  console.log('-'.repeat(96));
  console.log(`${results.length - failed.length}/${results.length} passed in ${((Date.now() - t0) / 1000).toFixed(0)}s${failed.length ? `, ${failed.length} failed` : ''}. Logs: tests/out/logs/`);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 1));
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); stopServer(); process.exit(2); });
