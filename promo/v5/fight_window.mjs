// The opening beat, bigger: Mario grabs Bowser by the tail, swings him and throws him through Peach's
// stained-glass window; it shatters, Bowser vanishes into the castle.   node fight_window.mjs OUTDIR [test]
import { openStudio, sleep } from '../scripts/lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { setup, shot } from './rec.mjs';
const [OUT, mode = 'film'] = process.argv.slice(2), HERE = path.dirname(new URL(import.meta.url).pathname);
const { browser, page } = await openStudio({ level: 16, name: 'Castle window', viewport: { width: 1280, height: 720 } });
const ev = (fn, a) => page.evaluate(fn, a);
await page.addScriptTag({ path: `${HERE}/../scripts/bot.js` });
await setup(page);
const W = [0, 2600, -2037];                      // the window's middle (it faces +z)
const HOME = JSON.parse(process.env.HOME_B || '[0, 700]'), MSTART = JSON.parse(process.env.MSTART || '[350, 1900]');
const fl = await ev(([h, m]) => [studio64.engine.floor(h[0], 3000, h[1]), studio64.engine.floor(m[0], 3000, m[1])], [HOME, MSTART]);
console.log('floors', fl);
// clear the lawn, Bowser in
await ev(() => { for (const o of P.objects()) if (/Butterfly|Bird|Lakitu|Yoshi|Cannon|Tree|Coin/.test(o.bhv) && false) studio64.engine.M._studio_delete_slot(o.slot); });
const bslot = await ev(([h, y]) => P.spawn({ uid: 0x7d700001, entry: 'bowser', x: h[0], y, z: h[1], yaw: 0 }), [HOME, fl[0]]);
await ev(([m, y]) => studio64.engine.teleport(m[0], y + 5, m[1], 32768), [MSTART, fl[1]]);
await ev(() => { P.freeze(); studio64.engine.M._studio_set_paused(0, 1); });
await ev(() => P.step(2));
await ev(() => studio64.testing.saveState(0));
const FIGHT = { bowser: bslot, target: [W[0], W[2]], spinMin: 50, ...(JSON.parse(process.env.FIGHT || '{}')) };
const wTex = Object.fromEntries(['top', 'bottom'].map((k) => [k, 'data:image/png;base64,' + fs.readFileSync(`${HERE}/art/window/${k}.png`).toString('base64')]));
const PAL = JSON.parse(fs.readFileSync(`${HERE}/art/window/palette.json`, 'utf8'));
const add = (a, b) => a.map((v, i) => v + b[i]), mul = (a, k) => a.map((v) => v * k), lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// ---- rehearsal: when he lets go ----
async function rehearse() {
  await ev(() => studio64.testing.loadState(0));
  await ev(() => { P.freeze(); studio64.engine.M._studio_set_paused(0, 1); P.res(480, 270); });
  await ev((o) => P.fightInit(o), FIGHT);
  const log = [];
  for (let f = 0; f < 420; f++) {
    const st = await ev(() => P.botTick());
    log.push(st);
    await ev(() => P.step(1));
    if (st.phase === 'thrown') break;
  }
  const ev1 = await ev(() => P.F.events);
  const at = (n) => ev1.find((x) => x.name === n)?.t;
  return { log, E: { circle: at('circle'), grab: at('spin'), release: at('thrown') } };
}
const { log, E } = await rehearse();
console.log('events', JSON.stringify(E), 'last', JSON.stringify(log[log.length - 1]));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/window_rehearsal.json`, JSON.stringify({ E, log }));
if (!E.release) { console.log('NO RELEASE'); await browser.close(); process.exit(2); }
if (mode === 'test') { await browser.close(); process.exit(0); }

// ---- the flight after the release (scripted), the shatter ----
// u: flight time in frames since the release (slow motion: u advances by less than 1 per frame)
const FLIGHT = 34;
function bowserAt(P0, u) {
  const t = u / FLIGHT;
  if (t <= 1) {
    const C = add(lerp(P0, W, 0.45), [0, 1500, 0]);
    const a = lerp(P0, C, t), b = lerp(C, add(W, [0, -250, 0]), t);   // (his middle hits the glass; his feet are lower)
    return { p: lerp(a, b, t), yaw: 32768 + Math.round(t * 3 * 65536), roll: Math.round(Math.sin(t * 9) * 3000) };
  }
  const k = Math.min(1, (t - 1) * 3);
  return { p: add(add(W, [0, -250, 0]), [0, -80 * k, -700 * k]), yaw: 32768 + 3 * 65536 + Math.round(k * 9000), roll: 0, inside: k >= 1 };
}
// shards: [pos, vel, axis, size, colour, angle]
let shards = [];
function burst(seed = 3) {
  let s = seed; const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  shards = [];
  for (let i = 0; i < 180; i++) {
    const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 300;
    const p = [W[0] + Math.cos(a) * rr * 0.8, W[1] - 40 + Math.sin(a) * rr, W[2] + 6];
    const out = r() < 0.8 ? 1 : -1;
    const v = [Math.cos(a) * (8 + r() * 26), 6 + Math.sin(a) * 14 + r() * 18, out * (22 + r() * 46)];
    shards.push({ p, v, ax: [r() - 0.5, r() - 0.5, r() - 0.5], size: 26 + r() * 90, col: PAL[Math.floor(r() * PAL.length)], ang: r() * 6, spin: 0.15 + r() * 0.35 });
  }
}
function stepShards(dt) {
  for (const s of shards) { s.v[1] -= 2.2 * dt; s.p = add(s.p, mul(s.v, dt)); s.ang += s.spin * dt; if (s.p[1] < 270) { s.p[1] = 270; s.v = [s.v[0] * 0.4, -s.v[1] * 0.25, s.v[2] * 0.4]; s.spin *= 0.6; } }
}
async function drawShards() {
  await ev((list) => (async () => {
    const { Mesh, V, MAT } = await import('/js/paths/mesh.js');
    const m = new Mesh();
    m.mat('glass', null, MAT.DOUBLE);
    for (const s of list) {
      const n = Math.hypot(...s.ax) || 1, ax = s.ax.map((x) => x / n);
      // a triangle in a plane spun round its axis
      const u0 = [ax[1], -ax[0], 0.3], L = Math.hypot(...u0) || 1, u = u0.map((x) => x / L);
      const w = [ax[1] * u[2] - ax[2] * u[1], ax[2] * u[0] - ax[0] * u[2], ax[0] * u[1] - ax[1] * u[0]];
      const pt = (k) => { const a = s.ang + (k * Math.PI * 2) / 3 + (k === 1 ? 0.4 : 0); return s.p.map((c, i) => c + (u[i] * Math.cos(a) + w[i] * Math.sin(a)) * s.size * (k === 2 ? 0.7 : 1)); };
      const c = s.col, hi = c.map((x) => Math.min(255, x * 1.35 + 40));
      m.tri('glass', V(pt(0), [0, 0], hi), V(pt(1), [1, 0], c), V(pt(2), [0, 1], c), null, false);
    }
    studio64.paths.place('promo:shards', m, { kind: 'line', collision: false });
  })(), shards.map((s) => ({ p: s.p, ax: s.ax, ang: s.ang, size: s.size, col: s.col })));
}
async function windowBroken(on) {
  await ev(async ([on, tex]) => {
    const A = studio64.assets, list = await A.catalog(); await A.locate();
    const ts = { top: list.find((t) => t.path === 'levels/castle_grounds/2.rgba16'), bottom: list.find((t) => t.path === 'levels/castle_grounds/1.rgba16') };
    if (!on) { for (const t of Object.values(ts)) await A.resetTexture(t); return; }
    const batch = [];
    for (const [k, url] of Object.entries(tex)) {
      const img = new Image(); img.src = url; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; c.getContext('2d').drawImage(img, 0, 0);
      batch.push({ t: ts[k], rgba: new Uint8Array(c.getContext('2d').getImageData(0, 0, c.width, c.height).data.buffer), w: c.width, h: c.height, note: 'promo' });
    }
    await A.replaceTextures(batch);
  }, [on, wTex]);
}
const fx = [];
async function puff() {
  for (const [entry, d, sc] of [['prop:bowser_impact_smoke', [0, -100, 60], 6], ['prop:sparkles_animation', [0, 0, 80], 5], ['prop:smoke', [-150, -150, 40], 4], ['prop:smoke', [160, -60, 40], 4]]) {
    fx.push({ slot: await ev(([e, p, sc]) => P.spawn({ uid: 0x7d710000 + Math.floor(Math.random() * 60000), entry: e, x: p[0], y: p[1], z: p[2], yaw: 0, scale: sc }), [entry, add(W, d), sc]), born: 0, sc });
  }
}

// one take from the saved state: the bot fights, after the release the flight is ours.
// slow: flight-time per frame after the release (1 = real time); cams(f, ctx) -> camera
async function take(dir, { frames, slow = 1, slowFrom = 0, cams, from = 0 }) {
  await ev(() => studio64.testing.loadState(0));
  await windowBroken(false);
  await ev(() => studio64.paths.remove?.('promo:shards'));
  await ev((o) => P.fightInit(o), FIGHT);
  for (let f = 0; f < from; f++) { await ev(() => P.botTick()); await ev(() => P.step(1)); }
  let P0 = null, u = 0, broken = false, last = null, ctx = {};
  await shot(page, dir, { frames: frames - from, each: async (k) => {
    const f = k + from;
    const st = await ev(() => P.botTick());
    const m = await ev(() => P.mario()), b = await ev((s) => P.obj(s), bslot);
    if (f >= E.release) {
      if (!P0) P0 = [b.x, b.y, b.z];
      u += f >= slowFrom ? slow : 1;
      const q = bowserAt(P0, u);
      await ev(([s, q]) => studio64.engine.M._studio_transform_slot(s, q.p[0], q.inside ? -9000 : q.p[1], q.p[2], 0, q.yaw, q.roll, 0), [bslot, q]);
      if (!broken && u >= FLIGHT) { broken = true; await windowBroken(true); burst(); await puff(); ctx.hitAt = f; }
      if (broken) { stepShards(f >= slowFrom ? slow : 1); await drawShards(); }
      ctx.B = q.p;
    } else ctx.B = [b.x, b.y, b.z];
    ctx.M = [m.x, m.y, m.z]; ctx.myaw = m.yaw; ctx.f = f; ctx.u = u; ctx.phase = st.phase;
    last = cams(f, ctx, last);
  }, cam: () => last });
  return ctx;
}
const R = E.release, G = E.grab ?? R - 60;
const smoothCam = (prev, want, k) => (prev ? { pos: lerp(prev.pos, want.pos, k), focus: lerp(prev.focus, want.focus, k), fov: want.fov } : want);
// main take: wide while he circles, close on the grab, orbit in the spin, behind him for the throw
if (!process.env.ONLY || process.env.ONLY.includes('main')) await take(`${OUT}/bw_main`, { frames: R + 50, from: Math.max(0, G - 50), cams: (f, c, prev) => {
  const M = c.M, B = c.B;
  let w;
  if (f < G - 6) { const mid = lerp(M, B, 0.5); w = { pos: add(mid, [-1500, 420, 600]), focus: add(mid, [0, 150, 0]), fov: 46 }; }
  else if (f < R - 4) { const a = (f - G) * 0.05; w = { pos: add(M, [Math.sin(a) * 1150, 230, Math.cos(a) * 1150]), focus: add(M, [0, 170, 0]), fov: 50 }; }
  else { w = { pos: add(M, [260, 420, 900]), focus: lerp(add(B, [0, 150, 0]), W, 0.35), fov: 46 }; }
  return smoothCam(f === G - 6 || f === R - 4 ? null : prev, w, 0.3);
} });
// the impact in slow motion, from below the window
await take(`${OUT}/bw_impact`, { frames: R + 125, from: R - 2, slow: 0.4, slowFrom: R + 14, cams: (f, c, prev) => {
  const w = { pos: [620, 900, -700], focus: lerp(add(c.B, [0, 150, 0]), W, 0.55), fov: 44 };
  return smoothCam(prev, w, 0.35);
} });
// and from up at the window's height, a little to the side: the glass flies past the camera
await take(`${OUT}/bw_impact2`, { frames: R + 120, from: R + 6, slow: 0.4, slowFrom: R + 14, cams: (f, c, prev) => {
  const w = { pos: [-900, 2500, -350], focus: lerp(add(c.B, [0, 150, 0]), W, 0.7), fov: 50 };
  return smoothCam(prev, w, 0.3);
} });
await browser.close();
