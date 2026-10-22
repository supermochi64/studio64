// The shotgun / katana beats: Mario (armed the way Claude armed him: the same give call) goes for the
// Goombas Claude placed. One session: save state -> low-res rehearsal (events) -> filmed passes.
//   WEAPON=shotgun|katana node capture_weapon.mjs <project> <outDir>
import { openStudio, saveDataUrl } from './lib.mjs';
import fs from 'node:fs';
const PROJECT = process.argv[2], OUT = process.argv[3];
const WEAPON = process.env.WEAPON || 'shotgun';
const W = Number(process.env.CAP_W || 2880), H = Math.round((W * 9) / 16);
const END = Number(process.env.END || 200);
fs.mkdirSync(OUT, { recursive: true });
const { browser, page } = await openStudio({ level: Number(process.env.LEVEL || 9), project: PROJECT, viewport: { width: 1280, height: 720 } });
const ev = (fn, a) => page.evaluate(fn, a);
await ev(() => { const e = studio64.engine; e.resize = () => {}; P.res = (w, h) => e.M._studio_resize(w, h); P.freeze(); e.M._studio_set_paused(0, 1); });
const spawn = JSON.parse(process.env.SPAWN || '[-6558, 6464, 24576]');   // [x, z, yaw]
await ev((s) => { const e = studio64.engine; e.teleport(s[0], e.floor(s[0], 8000, s[1]) + 5, s[1], s[2]); }, spawn);
for (let i = 0; i < 30; i++) await ev(() => P.step(1));
await ev((w) => { const M = studio64.engine.M; if (w === 'shotgun') M._studio_shotgun_give(1); else M._studio_katana_give(1); }, WEAPON);
await ev(() => P.step(3));
await ev(() => studio64.testing.saveState(0));
const S16 = (a) => ((((a + 32768) % 65536) + 65536) % 65536) - 32768;
const yawTo = (dx, dz) => (Math.round((Math.atan2(dx, dz) * 32768) / Math.PI) + 65536) % 65536;
const RANGE = WEAPON === 'shotgun' ? 620 : 210;

async function tick(st, f) {
  const m = await ev(() => P.mario());
  const g = await ev(() => P.objects().filter((o) => o.bhv === 'bhvGoomba').map((o) => ({ slot: o.slot, x: o.x, y: o.y, z: o.z, d: o.dist })));
  const alive = await ev((gs) => gs.filter((o) => { const s = P.obj(o.slot); return s.active && s.action < 100 && Math.hypot(o.x - P.mario().x, o.z - P.mario().z) < 2500; }), g);   // (100+: knocked back, squished)
  st.alive = alive.length;
  let b = 0, yaw = 0, mag = 0;
  const near = alive.slice().sort((a, c) => Math.hypot(a.x - m.x, a.z - m.z) - Math.hypot(c.x - m.x, c.z - m.z))[0];
  st.cool = (st.cool || 0) - 1;
  if (st.phase === 'hunt' && near) {
    const d = Math.hypot(near.x - m.x, near.z - m.z), want = yawTo(near.x - m.x, near.z - m.z), diff = Math.abs(S16(want - m.yaw));
    yaw = want;
    if (d > RANGE) mag = 64;
    else if (diff > 0x700) mag = 14;            // turn on the spot (a tiptoe toward it)
    else if (st.cool <= 0) {
      b = 0x4000; st.shots = (st.shots || 0) + 1; st.fires.push(f);
      st.cool = WEAPON === 'shotgun' ? 30 : 9;
      if (WEAPON === 'katana' && st.shots % 3 === 0) st.cool = 22;
    }
    if (WEAPON === 'katana' && d <= RANGE + 60) mag = Math.max(mag, 0);
  }
  if (st.phase === 'hunt' && !near && !st.doneAt) st.doneAt = f;
  // the finisher: a jump with a blast down (shotgun jump) / a spin slash in the air
  if (st.doneAt && f - st.doneAt === 8) { b = 0x8000; st.jumpAt = f; }
  if (st.jumpAt && f - st.jumpAt >= 1 && f - st.jumpAt < 18) b = 0x8000 | (f - st.jumpAt === 6 ? 0x4000 : 0);
  await ev(([b, yaw, mag]) => P.bot(1, b, yaw, mag), [b, yaw, mag]);
  return { f, m: [m.x, m.y, m.z], myaw: m.yaw, act: (m.action >>> 0).toString(16), alive: alive.length, near: near ? [near.x, near.y, near.z] : null, others: alive.filter((o) => o !== near).map((o) => [o.x, o.z]), b };
}

await ev(() => P.res(480, 270));
const st0 = { phase: 'hunt', fires: [] };
const log = [];
for (let f = 0; f < END; f++) { log.push(await tick(st0, f)); await ev(() => P.step(1)); }
const kills = log.map((x, i) => (i && x.alive < log[i - 1].alive ? x.f : null)).filter((x) => x !== null);
const E = { fires: st0.fires, kills, done: st0.doneAt, jump: st0.jumpAt, n0: log[0].alive };
console.log('events', JSON.stringify(E));
fs.writeFileSync(`${OUT}/rehearsal.json`, JSON.stringify({ E, log }));
if (!kills.length) { console.log('NO KILL'); await browser.close(); process.exit(2); }

await page.addScriptTag({ content: `
P.wRig = (name, c) => {
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const lerp = (a, b, t) => add(a, mul([b[0] - a[0], b[1] - a[1], b[2] - a[2]], t));
  const M = c.M, y = c.myaw * Math.PI / 32768, f = [Math.sin(y), 0, Math.cos(y)], r = [-f[2], 0, f[0]];
  const T = c.T || add(M, mul(f, 500));
  let pos, focus, fov = 50, sm = 0.3;
  if (name === 'ots') { pos = add(add(M, mul(f, -430)), add(mul(r, -150), [0, 210, 0])); focus = add(lerp(M, T, 0.75), [0, 60, 0]); fov = 50; }
  if (name === 'side' || name === 'side2') { const mid = lerp(M, T, 0.5); const d = [T[0] - M[0], 0, T[2] - M[2]]; const L = Math.hypot(d[0], d[2]) || 1; const p = mul([-d[2] / L, 0, d[0] / L], c.sideSign);
    pos = add(mid, add(mul(p, Math.max(700, L * 1.15)), [0, 140, 0])); focus = add(mid, [0, 60, 0]); fov = 48; sm = 0.2; }
  if (name === 'low') { pos = add(add(M, mul(f, 380)), add(mul(r, 160), [0, 35, 0])); focus = add(M, [0, 130, 0]); fov = 52; sm = 0.35; }
  if (name === 'orbit') { const a = c.a0 + c.k * 0.025; const d = [Math.sin(a), 0, Math.cos(a)]; pos = add(add(M, mul(d, 620)), [0, 200, 0]); focus = add(M, [0, 100, 0]); fov = 52; sm = 0.25; }
  const S = P.rigState;
  if (S.name !== name) { S.name = name; S.pos = pos; S.focus = focus; }
  else { S.pos = lerp(S.pos, pos, sm); S.focus = lerp(S.focus, focus, sm); }
  P.cam(true, S.pos, S.focus, fov);
};` });
const g0 = log[0].near || [0, 0, 0];
const f1 = E.fires[0], last = Math.min(END, (E.jump ?? E.fires[E.fires.length - 1]) + 40);
const fr = (i) => E.fires[i] ?? (f1 + 30 * i);
const SHOTS = WEAPON === 'shotgun'
  ? { main: [[0, f1 + 16, 'ots'], [f1 + 16, fr(1) + 16, 'side'], [fr(1) + 16, fr(2) + 16, 'side2'], [fr(2) + 16, (E.jump ?? fr(3) + 8) - 4, 'ots'], [(E.jump ?? fr(3) + 8) - 4, last, 'low']],
      alt: [[0, fr(1) + 16, 'side2'], [fr(1) + 16, last, 'orbit']] }
  : { main: [[0, f1 - 2, 'ots'], [f1 - 2, (E.done ?? f1 + 40) + 4, 'orbit'], [(E.done ?? f1 + 40) + 4, last, 'low']],
      alt: [[Math.max(0, f1 - 10), (E.done ?? f1 + 40) + 4, 'side'], [(E.done ?? f1 + 40) + 4, last, 'orbit']] };
for (const [name, shots] of Object.entries(SHOTS)) {
  const dir = `${OUT}/${name}`;
  fs.mkdirSync(dir, { recursive: true });
  await ev(() => studio64.testing.loadState(0));
  await ev(() => { P.freeze(); studio64.engine.M._studio_set_paused(0, 1); P.rigState = {}; });
  const tap = name === 'main';
  if (tap) await ev(() => P.tap(true, 0));
  const audio = [], meta = [];
  const st = { phase: 'hunt', fires: [] };
  let curRes = 0;
  const t0 = Date.now();
  for (let f = 0; f < last; f++) {
    const info = await tick(st, f);
    const s = shots.find((x) => f >= x[0] && f < x[1]);
    const want = s ? 1 : 0;
    if (want !== curRes) { await ev(([w, h]) => P.res(w, h), want ? [W, H] : [480, 270]); curRes = want; }
    if (s) {
      if (f === s[0] || st.signFor !== s) {   // the side away from the other goombas (nothing big in the foreground)
        st.signFor = s;
        const T = info.near || [info.m[0] + 500, 0, info.m[2]];
        const mid = [(info.m[0] + T[0]) / 2, (info.m[2] + T[2]) / 2], d = [T[0] - info.m[0], T[2] - info.m[2]], L = Math.hypot(d[0], d[1]) || 1;
        const score = (sg) => { const p = [mid[0] - (d[1] / L) * sg * 800, mid[1] + (d[0] / L) * sg * 800]; return Math.min(1e9, ...info.others.map((o) => Math.hypot(o[0] - p[0], o[1] - p[1]))); };
        st.sign = score(1) >= score(-1) ? 1 : -1;
      }
      await ev(([n, c]) => P.wRig(n, c), [s[2], { M: info.m, myaw: info.myaw, T: info.near, k: f - s[0], a0: (info.myaw * Math.PI / 32768) + 2.2, sideSign: st.sign }]);
      saveDataUrl(`${dir}/${String(f).padStart(4, '0')}.jpg`, await ev(() => P.stepShot(1, 'image/jpeg', 0.93)));
    } else { await ev(() => P.cam(false)); await ev(() => P.step(1)); }
    if (tap) audio.push(Buffer.from(await ev(() => P.tapRead()), 'base64'));
    meta.push({ f, shot: s ? s[2] : null, info });
    if (f % 25 === 0) console.log(name, f, s ? s[2] : '-', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  if (tap) {
    fs.writeFileSync(`${dir}/audio.s16le`, Buffer.concat(audio));
    fs.writeFileSync(`${dir}/audio_frames.json`, JSON.stringify(audio.map((a) => a.length / 4)));
    await ev(() => P.tap(false));
  }
  fs.writeFileSync(`${dir}/meta.json`, JSON.stringify({ E, shots, meta }));
  console.log('pass', name, 'done', ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
await browser.close();
