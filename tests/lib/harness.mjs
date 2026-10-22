// Test harness for the Studio 64 suite (tests/suite/*.test.mjs).
//
// A test file is a plain node script:
//
//   import { suite } from '../lib/harness.mjs';
//   await suite('my feature', async (t) => {
//     const s = await t.open({ level: 9 });          // new project, game booted, playing
//     t.check('mario exists', !!(await s.state()).mario);
//     t.eq('materials', await s.eval(() => studio64.engine.M._studio_material_count()), 28);
//   });
//
// Checks are soft (the test goes on and every failed one is listed); a thrown error ends the
// test. Page errors, console.error lines and engine crashes fail the test unless the test
// allows them (t.allowConsole(/regex/)). Screenshots go to tests/out/<test>/.
// The runner (tests/run.mjs) reads the `@@RESULT {json}` line printed at the end.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../../tools/lib/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const OUT = path.join(ROOT, 'tests', 'out');
export const URL_BASE = (process.env.STUDIO_URL || 'http://127.0.0.1:8064').replace(/\/$/, '');
const CHROME = (await findChrome()) || '/usr/bin/google-chrome-stable'; // $CHROME, or Chrome/Chromium/Edge where installed
const HEADFUL = !!process.env.HEADFUL;

// Console noise that is not a bug of the app.
const CONSOLE_OK = [
  /fonts\.(googleapis|gstatic)\.com/i,       // offline machines
  /Failed to load resource.*(fonts|favicon)/i,
  /AudioContext was not allowed to start/i,
  /The AudioContext was not allowed/i,
  /GPU stall due to ReadPixels/i,
  /WebGL: INVALID_/i,                          // swiftshader chatter (checked separately by visual tests)
  /\[\.WebGL-/i,
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function api(p, body, method) {
  const r = await fetch(URL_BASE + p, {
    method: method || (body ? 'POST' : 'GET'),
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return text; }
}

export async function newProject({ level = 9, name = 'test project' } = {}) {
  const p = await api('/api/projects', { level, name });
  if (!p?.id) throw new Error('could not create a project: ' + JSON.stringify(p));
  return p.id;
}

export const exportProject = (id) => api(`/api/projects/${id}/export`);

class Session {
  constructor(t, page, projectId, label) {
    this.t = t; this.page = page; this.projectId = projectId; this.label = label;
    this.errors = [];   // { kind, text }
    this.console = [];  // every console line (last 400)
  }

  eval(fn, arg) { return this.page.evaluate(fn, arg); }
  // Waits for the game to boot. The engine can be rebuilt while a page loads it (other work on
  // the same tree): one more try with a fresh load before giving up.
  async booted(ms = 100000) {
    const wait = () => this.page.waitForFunction(() => window.studio64?.engine?.ready && window.studio64?.editor && document.querySelector('#loading').hidden, null, { timeout: ms, polling: 500 });
    for (let attempt = 0; ; attempt++) {
      try { await wait(); return; } catch (e) {
        const raf = await this.page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n); }; requestAnimationFrame(f); setTimeout(() => r(n), 4000); })).catch(() => -1);
        console.log('  stalled boot: animation frames in 2 s:', raf, 'visibility:', await this.page.evaluate(() => document.visibilityState).catch(() => '?'));
        const st = await this.page.evaluate(() => ({ app: !!window.studio64, engine: !!window.studio64?.engine, ready: !!window.studio64?.engine?.ready, editor: !!window.studio64?.editor, loading: !document.querySelector('#loading')?.hidden, title: document.querySelector('#loading-title')?.textContent, level: window.studio64?.engine?.level, crashed: !!window.studio64?.engine?.crashed })).catch((err) => err.message);
        if (attempt >= 2) throw new Error(`the game did not boot: ${JSON.stringify(st)}`);
        console.log('  boot did not finish, loading the page once more:', JSON.stringify(st));
        this.errors.length = 0;
        await this.page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
      }
    }
  }
  async reload() {
    await this.page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
    await this.booted();
  }
  state() { return this.page.evaluate(() => studio64.engine.state()); }
  mario() { return this.page.evaluate(() => studio64.engine.state().mario); }
  wait(ms) { return this.page.waitForTimeout(ms); }
  key(k) { return this.page.keyboard.press(k); }
  export() { return exportProject(this.projectId); }
  async shot(name) {
    const dir = path.join(OUT, this.t.slug);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${this.label ? this.label + '_' : ''}${name}.png`);
    await this.page.screenshot({ path: file });
    return file;
  }
  // The canvas box (build mode mouse coordinates are relative to #overlay).
  async box(sel = '#overlay') { return this.page.locator(sel).boundingBox(); }

  // Frames are being drawn (the engine is alive and not stuck).
  // (waits up to `ms`, at least 6 s: a busy machine draws few frames)
  async framesAdvance(ms = 600) {
    const a = await this.eval(() => studio64.engine.lastFrame);
    return this.page.waitForFunction((a0) => studio64.engine.lastFrame > a0, a, { timeout: Math.max(ms, 6000), polling: 100 }).then(() => true, () => false);
  }
  crashed() { return this.eval(() => !!studio64.engine?.crashed); }
  // Holds a key until `until(mario)` is true (or `ms` passed: busy machines run at a few fps).
  // Returns the last Mario state; `.ok` tells whether the condition was met.
  async hold(key, until, ms = 8000) {
    await this.page.keyboard.down(key);
    const t0 = Date.now();
    let m = await this.mario(), ok = false;
    while (Date.now() - t0 < ms) {
      await this.wait(100);
      m = await this.mario();
      if (until(m)) { ok = true; break; }
    }
    await this.page.keyboard.up(key);
    return Object.assign(m || {}, { ok });
  }
  // Waits until a page condition holds (a function evaluated in the page with `arg`).
  until(fn, arg, ms = 15000) {
    return this.page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false);
  }

  async build() {
    if (!(await this.eval(() => studio64.editor?.active))) await this.page.click('#mode-build');
    await this.page.waitForFunction(() => studio64.editor?.active, null, { timeout: 10000 });
    await this.wait(300);
  }
  async play() {
    if (await this.eval(() => studio64.editor?.active)) await this.page.click('#mode-play');
    await this.page.waitForFunction(() => !studio64.editor?.active, null, { timeout: 10000 });
    await this.wait(200);
  }
  // Waits until a level (null: any) is loaded and Mario stands in it (after the star screen).
  async arrive(level = null, ms = 45000) {
    await this.page.waitForFunction((lvl) => {
      const e = studio64.engine;
      if (!e?.ready || e.inIntro) return false;
      if (lvl !== null && e.level !== lvl) return false;
      try { return !!e.state().mario; } catch { return false; }
    }, level, { timeout: ms, polling: 200 });
    await this.wait(500);
  }
  // Counts area loads from now on; arriveNew() then waits for the next one (a jump between two
  // custom levels stays in level 37, so arrive(37) alone could see the old one).
  async markArea() {
    await this.eval(() => {
      window.__areaLoads = 0;
      if (!window.__areaHook) { window.__areaHook = true; studio64.engine.on('area', () => { window.__areaLoads = (window.__areaLoads || 0) + 1; }); }
    });
  }
  async arriveNew(level = null, ms = 60000) {
    await this.page.waitForFunction(() => window.__areaLoads > 0, null, { timeout: ms, polling: 200 });
    await this.arrive(level, ms);
  }
  // Jumps to an original level through the launcher logic (skips the star screen wait by pressing A).
  async goLevel(num, { skipIntro = true } = {}) {
    await this.markArea();
    await this.eval((n) => studio64.levelsUI.go({ num: n, name: Object.values(studio64.catalog.levels).find((l) => l.num === n)?.name || `level ${n}` }), num);
    if (skipIntro) await this.skipIntro();
    await this.arriveNew(num);
  }
  async goCustom(id, { skipIntro = true } = {}) {
    await this.markArea();
    await this.eval((cid) => studio64.levelsUI.go({ custom: cid, name: studio64.levels.find((l) => l.id === cid)?.name }), id);
    if (skipIntro) await this.skipIntro();
    await this.arriveNew(37);
  }
  // Presses A on the star select screen until it is gone.
  async skipIntro(ms = 20000) {
    const t0 = Date.now();
    await this.wait(400);
    while (Date.now() - t0 < ms) {
      const st = await this.eval(() => ({ intro: studio64.engine.inIntro, lvl: studio64.engine.level }));
      if (st.intro) { await this.page.keyboard.down('Space'); await this.wait(120); await this.page.keyboard.up('Space'); }
      else if (Date.now() - t0 > 2500) return;
      await this.wait(400);
    }
  }
  // Creates a custom level from a template through the server and goes there.
  async newLevel(template = 'flat', name = 'Test level') {
    const before = await this.eval(() => studio64.levels.map((l) => l.id));
    await this.markArea();
    await this.eval(([tp, nm]) => studio64.levelsUI.createLevel(tp, null, nm), [template, name]);
    await this.page.waitForFunction((b) => studio64.levels.some((l) => !b.includes(l.id)), before, { timeout: 15000 });
    await this.skipIntro();
    await this.arriveNew(37);
    return this.eval((b) => studio64.levels.find((l) => !b.includes(l.id)).id, before);
  }
  async drag(x0, y0, x1, y1, { steps = 12, button = 'left', mods = [] } = {}) {
    const ov = await this.box();
    for (const m of mods) await this.page.keyboard.down(m);
    await this.page.mouse.move(ov.x + x0, ov.y + y0);
    await this.page.mouse.down({ button });
    for (let i = 1; i <= steps; i++) {
      await this.page.mouse.move(ov.x + x0 + ((x1 - x0) * i) / steps, ov.y + y0 + ((y1 - y0) * i) / steps);
      await this.wait(30);
    }
    await this.page.mouse.up({ button });
    for (const m of mods) await this.page.keyboard.up(m);
    await this.wait(350);
  }
  async clickAt(x, y, opts) {
    const ov = await this.box();
    await this.page.mouse.move(ov.x + x - 4, ov.y + y);
    await this.wait(60);
    await this.page.mouse.move(ov.x + x, ov.y + y);
    await this.wait(120);
    await this.page.mouse.click(ov.x + x, ov.y + y, opts);
    await this.wait(250);
  }
  // A screen point (overlay coords) whose ray hits walkable level ground.
  groundPoint({ kind = 'level', minNy = 0.6, from = [0.15, 0.85], rows = [0.85, 0.3] } = {}) {
    return this.eval(({ kind, minNy, from, rows }) => {
      const ed = studio64.editor; const { w, h } = ed.size();
      for (let y = rows[0]; y > rows[1]; y -= 0.04) for (let x = 0.5, k = 0; k < 30; k++, x = 0.5 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.03) {
        if (x < from[0] || x > from[1]) continue;
        const hit = ed.pick(w * x, h * y, { objects: false });
        if (hit && hit.ny > minNy && (!kind || hit.kind === kind)) return { x: w * x, y: h * y, hit };
      }
      return null;
    }, { kind, minNy, from, rows });
  }
  // Build mode: looks down at Mario from `dist` away (pitch in radians, negative = down).
  async viewMario(dist = 1800, pitch = -0.7) {
    await this.eval(([dist, pitch]) => {
      const ed = studio64.editor, m = studio64.engine.state().mario;
      ed.anim = null;
      ed.cam.pitch = pitch;
      const d = ed.camDir();
      ed.cam.x = m.x - d[0] * dist; ed.cam.y = m.y + 60 - d[1] * dist; ed.cam.z = m.z - d[2] * dist;
      ed.focusDist = dist;
      ed.pushCamera();
    }, [dist, pitch]);
    await this.wait(400);
  }
  // Build mode: points the camera at the nearest wall around Mario; returns the wall's screen point.
  async lookAtWall() {
    await this.eval(() => {
      const ed = studio64.editor, e = studio64.engine, m = e.state().mario;
      let best = null;
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        const hit = e.raycast([m.x, m.y + 150, m.z], [Math.sin(a), 0, Math.cos(a)], -1, false, 4000);
        if (hit && Math.abs(hit.ny) < 0.3 && hit.t > 300 && (!best || hit.t < best.t)) best = hit;
      }
      if (!best) return;
      const n = [best.nx, 0, best.nz], L = Math.hypot(n[0], n[2]);
      const pos = [best.x + (n[0] / L) * 900, best.y + 250, best.z + (n[2] / L) * 900];
      ed.cam.x = pos[0]; ed.cam.y = pos[1]; ed.cam.z = pos[2];
      ed.cam.yaw = Math.atan2(-n[0], -n[2]); ed.cam.pitch = -0.2;
      ed.anim = null;
      ed.pushCamera();
    });
    await this.wait(500);
    return this.eval(() => {
      const ed = studio64.editor; const { w, h } = ed.size();
      for (let y = 0.3; y < 0.8; y += 0.03) for (let x = 0.3; x < 0.7; x += 0.03) {
        const hit = ed.pick(w * x, h * y, { objects: false });
        if (hit && Math.abs(hit.ny) < 0.3) return { x: w * x, y: h * y, hit };
      }
      return null;
    });
  }
  // Records of the current area in the project patch.
  records() { return this.eval(() => studio64.editor.records()); }
  changes() { return this.eval(() => studio64.changes.map((c) => c.summary)); }
  // Waits until the server acknowledged everything (patch broadcast arrived).
  async settle(ms = 600) { await this.wait(ms); }

  // Fails the test on errors collected so far (called automatically at the end).
  errorReport() { return this.errors.filter((e) => !this.t.allowed.some((re) => re.test(e.text))); }
}

class Test {
  constructor(name) {
    this.name = name;
    this.slug = name.replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
    this.checks = [];
    this.sessions = [];
    this.allowed = [];
    this.browser = null;
    this.t0 = Date.now();
  }
  log(...a) { console.log(`  [${((Date.now() - this.t0) / 1000).toFixed(1)}s]`, ...a); }
  allowConsole(re) { this.allowed.push(re); }

  check(name, ok, detail) {
    this.checks.push({ name, ok: !!ok, detail: ok ? undefined : detail });
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${!ok && detail !== undefined ? ' -- ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
    return !!ok;
  }
  eq(name, got, want) { return this.check(name, JSON.stringify(got) === JSON.stringify(want), { got, want }); }
  near(name, got, want, tol) { return this.check(name, typeof got === 'number' && Math.abs(got - want) <= tol, { got, want, tol }); }
  // Hard check: ends the test when it fails.
  must(name, ok, detail) { if (!this.check(name, ok, detail)) throw new Error(`required check failed: ${name}`); }

  async launch() {
    if (this.browser) return this.browser;
    this.browser = await chromium.launch({
      executablePath: CHROME,
      headless: !HEADFUL,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    });
    return this.browser;
  }

  // A page on a project (a new one unless `project` is given). start: click "Click to play".
  async open({ level = 9, project, viewport = { width: 1440, height: 900 }, start = true, label = '', context, query = '', mobile = false } = {}) {
    const browser = await this.launch();
    const id = project || (await newProject({ level, name: `${this.name}` }));
    const ctx = context || (await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) }));
    const page = await ctx.newPage();
    const s = new Session(this, page, id, label || (this.sessions.length ? `p${this.sessions.length}` : ''));
    this.sessions.push(s);
    page.on('pageerror', (e) => { s.errors.push({ kind: 'pageerror', text: `${e.message} ${(e.stack || '').split('\n').slice(1, 3).join(' ')}` }); console.log('  pageerror:', e.message); });
    page.on('console', (m) => {
      const text = m.text();
      s.console.push(`${m.type()}: ${text}`);
      if (s.console.length > 400) s.console.shift();
      if (m.type() === 'error' && !CONSOLE_OK.some((re) => re.test(text))) {
        s.errors.push({ kind: 'console.error', text: text.slice(0, 400) });
        console.log('  console.error:', text.slice(0, 200));
      }
    });
    page.on('response', (r) => {
      if (r.status() >= 400 && !CONSOLE_OK.some((re) => re.test(r.url()))) s.console.push(`http ${r.status()}: ${r.url()}`);
      if (r.status() === 404) console.log('  404:', r.url());
    });
    page.on('dialog', (d) => d.accept());
    await page.goto(`${URL_BASE}/?p=${id}${query}`, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await s.booted();
    if (start) {
      await page.click('#start');
      await page.waitForTimeout(800);
    }
    return s;
  }

  async finish(err) {
    for (const s of this.sessions) {
      let crashed = false;
      try { crashed = await s.crashed(); } catch { /* page gone */ }
      if (crashed) this.check(`${s.label || 'page'}: engine did not crash`, false, 'engine crashed');
      const errs = s.errorReport();
      this.check(`${s.label || 'page'}: no page errors or console errors`, errs.length === 0, errs.slice(0, 6).map((e) => `${e.kind}: ${e.text}`));
      if (err || errs.length || crashed || this.checks.some((c) => !c.ok)) {
        try { await s.shot('final'); } catch { /* ignore */ }
        const dir = path.join(OUT, this.slug);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${s.label || 'page'}_console.log`), s.console.join('\n'));
      }
    }
    try { await this.browser?.close(); } catch { /* ignore */ }
  }
}

// Runs one test. Prints the result line and exits with 0 (pass) or 1 (fail).
export async function suite(name, fn, { timeout = Number(process.env.TEST_TIMEOUT) || 420000 } = {}) {
  const t = new Test(name);
  console.log(`# ${name}`);
  let error = null;
  const timer = setTimeout(() => { error = new Error(`timed out after ${timeout / 1000}s`); }, timeout);
  try {
    await Promise.race([
      fn(t),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${timeout / 1000}s`)), timeout)),
    ]);
  } catch (e) {
    error = e;
    console.log('  ERROR', e.stack || e.message);
  }
  clearTimeout(timer);
  await t.finish(error);
  const failed = t.checks.filter((c) => !c.ok);
  const ok = !error && failed.length === 0;
  const result = {
    name, ok, ms: Date.now() - t.t0,
    checks: t.checks.length, failed: failed.map((c) => c.name),
    error: error ? String(error.message || error).slice(0, 300) : null,
  };
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (${t.checks.length - failed.length}/${t.checks.length} checks, ${(result.ms / 1000).toFixed(1)}s)`);
  console.log('@@RESULT ' + JSON.stringify(result));
  process.exit(ok ? 0 : 1);
}
