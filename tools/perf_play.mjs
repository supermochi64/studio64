#!/usr/bin/env node
// How smoothly play mode runs: opens a project in Chrome on this computer's GPU, plays it with Mario
// running in circles, and measures the game's frame rate (SM64 runs at 30), how evenly frames reach
// the screen, and how long the engine takes per browser frame.
//   node tools/perf_play.mjs [--url http://127.0.0.1:8098] [--level 9] [--project ID] [--secs 10]
//                            [--size 1920x1080] [--dpr 1] [--repeat 3] [--json] [--profile]
//   --profile   also Chrome's CPU profile of the first run: the functions that take the most time
import { chromium } from 'playwright';
import { findChrome } from './lib/browser.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const URL = opt('--url', process.env.STUDIO_URL || 'http://127.0.0.1:8064');
const [W, H] = opt('--size', '1920x1080').split('x').map(Number);
const SECS = Number(opt('--secs', 10)), REPEAT = Number(opt('--repeat', 1)), DPR = Number(opt('--dpr', 1));
const level = opt('--level', '9') === 'any' ? 'any' : Number(opt('--level', 9)); // any: a project's own start (a hack's hub)

const api = async (p, b) => (await fetch(URL + p, { method: b ? 'POST' : 'GET', headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined })).json();
const project = opt('--project', null) || (await api('/api/projects', { level: level === 'any' ? 9 : level, name: `perf ${level}` })).id;

const browser = await chromium.launch({
  executablePath: (await findChrome()) || undefined, headless: true,
  // the real GPU through ANGLE (headless Chrome otherwise renders in software)
  args: ['--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR })).newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
// time every animation-frame callback (the engine's main loop runs in one)
await page.addInitScript(() => {
  window.__perf = { on: false, cb: [], ts: [], fr: [] };
  const raf = window.requestAnimationFrame.bind(window);
  const frames = () => { try { return window.studio64.engine.M._studio_debug_frames(); } catch { return 0; } };
  window.requestAnimationFrame = (fn) => raf((ts) => {
    const t0 = performance.now(); fn(ts); const d = performance.now() - t0;
    if (window.__perf.on) { window.__perf.cb.push(d); window.__perf.ts.push(ts); window.__perf.fr.push(frames()); }
  });
});
await page.goto(`${URL}/?p=${project}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.studio64?.engine?.ready, null, { timeout: 300000, polling: 500 });
const gpu = await page.evaluate(() => { const c = document.querySelector('canvas'); const g = c.getContext('webgl2') || c.getContext('webgl'); const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : '?'; });
await page.click('#start').catch(() => {});
await page.evaluate(async (lv) => {
  const e = studio64.engine;
  for (let t0 = Date.now(); Date.now() - t0 < 60000;) {
    let st; try { st = { intro: !!e.inIntro, ok: (lv === 'any' || e.level === lv) && !e.inIntro && !!e.state().mario }; } catch { st = {}; }
    if (st.ok) return;
    if (st.intro) { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' })); await new Promise((r) => setTimeout(r, 120)); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', key: ' ' })); }
    await new Promise((r) => setTimeout(r, 500));
  }
}, level);
await page.waitForTimeout(2000);
const canvas = await page.evaluate(() => { const c = document.querySelector('canvas'); return `${c.width}x${c.height}`; });

const runs = [];
let cdp = null;
if (args.includes('--profile')) {
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
}
for (let r = 0; r < REPEAT; r++) {
  runs.push(await page.evaluate(async (secs) => {
    const M = studio64.engine.M, P = window.__perf;
    P.cb = []; P.ts = []; P.fr = []; P.on = true;
    let yaw = 0; const bot = setInterval(() => { yaw = (yaw + 700) & 0xffff; M._studio_bot(1, 0, yaw, 1); }, 100);
    const f0 = M._studio_debug_frames(), t0 = performance.now();
    await new Promise((res) => setTimeout(res, secs * 1000));
    const frames = M._studio_debug_frames() - f0, el = (performance.now() - t0) / 1000;
    clearInterval(bot); M._studio_bot(0, 0, 0, 0); P.on = false;
    const d = P.ts.slice(1).map((t, i) => t - P.ts[i]).sort((a, b) => a - b), cb = P.cb.slice().sort((a, b) => a - b);
    const q = (a, p) => +(a[Math.floor((a.length - 1) * p)] || 0).toFixed(2);
    // game frames that took two screen frames or more to show (a 30 fps game on a 60 Hz screen shows each twice)
    // pacing: the time between the screen frames that showed a new game frame (even = smooth)
    const shown = []; for (let i = 1; i < P.fr.length; i++) if (P.fr[i] !== P.fr[i - 1]) shown.push(P.ts[i]);
    const gap = shown.slice(1).map((t, i) => t - shown[i]).sort((a, b) => a - b);
    const spikes = P.cb.map((d, i) => [d, P.ts[i]]).filter(([d]) => d > 12).map(([d, t]) => `${((t - P.ts[0]) / 1000).toFixed(2)}s:${d.toFixed(0)}ms`);
    return { spikes, gameFps: +(frames / el).toFixed(1), pace: { med: q(gap, 0.5), min: q(gap, 0), max: q(gap, 1), uneven: gap.filter((g) => Math.abs(g - 33.3) > 6).length }, rafHz: +(P.ts.length / el).toFixed(1), rafMs: { med: q(d, 0.5), p95: q(d, 0.95), max: q(d, 1) }, long: d.filter((x) => x > 25).length,
      engineMs: { med: q(cb, 0.5), p95: q(cb, 0.95), max: q(cb, 1) } };
  }, SECS));
  if (cdp && r === 0) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const dt = profile.timeDeltas, total = dt.reduce((a, b) => a + b, 0);
    profile.samples.forEach((id, i) => {
      const n = byId.get(id); const name = `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop()}`;
      self.set(name, (self.get(name) || 0) + (dt[i] || 0));
    });
    console.log('CPU profile, self time:');
    for (const [name, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 30)) console.log(`  ${(100 * t / total).toFixed(1).padStart(5)}%  ${name}`);
    cdp = null;
  }
}
await browser.close();
const out = { gpu, canvas, level, project, runs };
if (args.includes('--json')) console.log(JSON.stringify(out));
else {
  console.log(`${gpu} | canvas ${canvas} | level ${level}`);
  for (const r of runs) if (r.spikes.length) console.log(`slow engine frames (>12 ms): ${r.spikes.join(' ')}`);
  for (const r of runs) console.log(`game ${r.gameFps} fps (30 = full speed), new frame every med ${r.pace.med} (${r.pace.min}..${r.pace.max}) ms, ${r.pace.uneven} uneven | screen ${r.rafHz} Hz, interval med ${r.rafMs.med} p95 ${r.rafMs.p95} max ${r.rafMs.max} ms, ${r.long} hitches | engine per frame med ${r.engineMs.med} p95 ${r.engineMs.p95} max ${r.engineMs.max} ms`);
}
