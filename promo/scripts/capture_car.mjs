// The car beat: Mario walks to the door of the car Claude placed, hops in, launches, drifts and
// drives off. One session: save state -> low-res rehearsal (events) -> filmed passes with rigs.
//   node capture_car.mjs <project> <outDir>
import { openStudio, saveDataUrl } from './lib.mjs';
import fs from 'node:fs';
const PROJECT = process.argv[2], OUT = process.argv[3];
const W = Number(process.env.CAP_W || 2880), H = Math.round((W * 9) / 16);
const ONLY = (process.env.PASSES || '').split(',').filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });
const LEVEL = Number(process.env.LEVEL || 9);
const SPAWN = JSON.parse(process.env.SPAWN || '[-6558, 6464, 24576]');   // [x, z, yaw]
const DSX = Number(process.env.DRIFT_SX || 64), LSIDE = Number(process.env.LAUNCH_SIDE || 1);
const { browser, page } = await openStudio({ level: LEVEL, project: PROJECT, viewport: { width: 1280, height: 720 } });
const ev = (fn, a) => page.evaluate(fn, a);
await ev(() => { const e = studio64.engine; e.resize = () => {}; P.res = (w, h) => e.M._studio_resize(w, h); P.freeze(); e.M._studio_set_paused(0, 1); });
await ev(() => P.step(2));
const car = await ev(() => studio64.editor.records().find((r) => /^vehicle:/.test(r.entry)));
await ev((s) => { const e = studio64.engine; e.teleport(s[0], e.floor(s[0], 8000, s[1]) + 5, s[1], s[2]); }, SPAWN);
for (let i = 0; i < 40; i++) await ev(() => P.step(1));   // he lands and stands
await ev(() => P.step(1));
await ev(() => studio64.testing.saveState(0));
const S16 = (a) => ((((a + 32768) % 65536) + 65536) % 65536) - 32768;
const yawTo = (dx, dz) => (Math.round((Math.atan2(dx, dz) * 32768) / Math.PI) + 65536) % 65536;
const cy = car.yaw || 0, F = [Math.sin((cy * Math.PI) / 32768), Math.cos((cy * Math.PI) / 32768)], Rt = [-F[1], F[0]];
const m00 = await ev(() => P.mario());
const doors = [[car.x + Rt[0] * 190, car.z + Rt[1] * 190], [car.x - Rt[0] * 190, car.z - Rt[1] * 190]];
const door = doors.sort((a, b) => Math.hypot(a[0] - m00.x, a[1] - m00.z) - Math.hypot(b[0] - m00.x, b[1] - m00.z))[0];
const DRIFT0 = Number(process.env.DRIFT0 || 52), DRIFT1 = Number(process.env.DRIFT1 || 80), END = Number(process.env.END || 140);

// one frame of the bot; st = { phase, D }
async function tick(st, f) {
  const m = await ev(() => P.mario());
  const v = await ev(() => JSON.parse(studio64.engine.M.UTF8ToString(studio64.engine.M._studio_vehicle_state_json())));
  let b = 0, yaw = 0, mag = 0, raw = 0, sx = 0;
  if (st.phase === 'walk') {
    const d = Math.hypot(door[0] - m.x, door[1] - m.z);
    yaw = d > 30 ? yawTo(door[0] - m.x, door[1] - m.z) : yawTo(car.x - m.x, car.z - m.z); mag = d > 120 ? 64 : d > 30 ? 30 : 0;
    if (v.prompt === 1 && d < 60) { b = 0x4000; st.phase = 'enter'; st.B = f; }
  } else if (st.phase === 'enter') {
    if (v.driving) { st.phase = 'drive'; st.D = f; }
  }
  if (st.phase === 'drive') {
    const k = f - st.D;
    raw = 1; b = 0x8000;
    if (k >= DRIFT0 && k < DRIFT1) { sx = DSX; b |= 0x0010; }
    else if (k >= DRIFT1 && k < DRIFT1 + 6) sx = -DSX * 0.3;
    if (process.env.COAST && k >= Number(process.env.COAST)) b &= ~0x8000;
  }
  await ev(([b, yaw, mag, raw, sx]) => { P.bot(1, b, yaw, mag); studio64.engine.M._studio_bot_stick(raw, sx, 0); }, [b, yaw, mag, raw, sx]);
  return { f, phase: st.phase, m: [m.x, m.y, m.z], myaw: m.yaw, v: [v.x, v.y, v.z], vyaw: v.yaw, speed: v.speed, drifting: v.drifting, driving: v.driving };
}

// ---- rehearsal ----
await ev(() => P.res(480, 270));
const st0 = { phase: 'walk' };
const log = [];
for (let f = 0; f < END; f++) { log.push(await tick(st0, f)); await ev(() => P.step(1)); }
const E = { B: st0.B, D: st0.D, drift0: (st0.D ?? 0) + DRIFT0, drift1: (st0.D ?? 0) + DRIFT1 };
console.log('events', JSON.stringify(E));
fs.writeFileSync(`${OUT}/rehearsal.json`, JSON.stringify({ E, car, door, log }));
if (!E.D) { console.log('NO DRIVE'); await browser.close(); process.exit(2); }

// ---- rigs ----
const at = (f) => log[Math.min(log.length - 1, Math.max(0, f))];
const carP = (f) => { const l = at(f); return l.driving ? l.v : [car.x, car.y, car.z]; };
const D = E.D;
const launchCam = [car.x + F[0] * 700 - LSIDE * Rt[0] * 1300, car.y + 160, car.z + F[1] * 700 - LSIDE * Rt[1] * 1300]; // beside the run-up
const dmid = carP(Math.round((E.drift0 + E.drift1) / 2));
const PASSES = {
  main: { tap: true, end: END, shots: [
    [0, D + 10, 'hop'], [D + 10, D + 36, 'launch'], [D + 36, E.drift0 - 4, 'chase'], [E.drift0 - 4, E.drift1 + 10, 'drift'], [E.drift1 + 10, END, 'away']] },
  alt: { end: E.drift1 + 20, shots: [[D + 4, D + 40, 'chaselow'], [E.drift0 - 8, E.drift1 + 20, 'drifttop']] },
};
await page.addScriptTag({ content: `
P.carRig = (name, c) => {
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const lerp = (a, b, t) => add(a, mul([b[0] - a[0], b[1] - a[1], b[2] - a[2]], t));
  const B = c.B, y = c.yaw * Math.PI / 32768, f = [Math.sin(y), 0, Math.cos(y)], r = [-f[2], 0, f[0]];
  let pos, focus, fov = 50, sm = 0;
  if (name === 'hop') { pos = add(add(c.spawn, mul(c.F3, -520)), add(mul(c.Rt3, -170), [0, 240, 0])); focus = add(lerp(c.car, c.M, 0.3), [0, 70, 0]); fov = 42; }
  if (name === 'launch') { pos = c.launch; focus = add(B, [0, 90, 0]); fov = 38; sm = 0.45; }
  if (name === 'chase') { pos = add(add(B, mul(f, -620)), [0, 200, 0]); focus = add(add(B, mul(f, 500)), [0, 60, 0]); fov = 58; sm = 0.18; }
  if (name === 'chaselow') { pos = add(add(B, mul(f, -380)), add(mul(r, 120), [0, 70, 0])); focus = add(add(B, mul(f, 600)), [0, 80, 0]); fov = 62; sm = 0.25; }
  if (name === 'drift') { pos = add(c.dmid, add(mul(c.out, 1300), [0, 420, 0])); focus = add(B, [0, 60, 0]); fov = 48; sm = 0.25; }
  if (name === 'drifttop') { pos = add(B, add(mul(c.out, 520), [0, 900, 0])); focus = add(B, [0, 0, 0]); fov = 55; sm = 0.15; }
  if (name === 'away') { pos = add(add(c.awayFrom, [0, 160, 0]), [0, 0, 0]); focus = add(B, [0, 60, 0]); fov = 40; sm = 0.3; }
  const S = P.rigState;
  if (S.name !== name || !sm) { S.name = name; S.pos = pos; S.focus = focus; }
  else { S.pos = lerp(S.pos, pos, sm); S.focus = lerp(S.focus, focus, sm); }
  P.cam(true, S.pos, S.focus, fov);
};` });
// the outside of the drift (away from the turn centre): the car turns right -> outside is its left
const dyaw = at(E.drift0).vyaw * Math.PI / 32768;
const out = [Math.sign(DSX) * Math.cos(dyaw), 0, -Math.sign(DSX) * Math.sin(dyaw)];
const aP = carP(E.drift1 + 10), ay = at(E.drift1 + 12).vyaw * Math.PI / 32768;
const awayFrom = [aP[0] - Math.sin(ay) * 520 + Math.cos(ay) * 160, aP[1] + 30, aP[2] - Math.cos(ay) * 520 - Math.sin(ay) * 160];

for (const [name, p] of Object.entries(PASSES)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const dir = `${OUT}/${name}`;
  fs.mkdirSync(dir, { recursive: true });
  await ev(() => studio64.testing.loadState(0));
  await ev(() => { P.freeze(); studio64.engine.M._studio_set_paused(0, 1); P.rigState = {}; });
  if (p.tap) await ev(() => P.tap(true, 0));
  const audio = [], meta = [];
  const st = { phase: 'walk' };
  let curRes = 0;
  const t0 = Date.now();
  for (let f = 0; f < p.end; f++) {
    const info = await tick(st, f);
    const s = p.shots.find((x) => f >= x[0] && f < x[1]);
    const want = s ? 1 : 0;
    if (want !== curRes) { await ev(([w, h]) => P.res(w, h), want ? [W, H] : [480, 270]); curRes = want; }
    if (s) {
      const B = info.driving ? info.v : [car.x, car.y, car.z];
      await ev(([n, c]) => P.carRig(n, c), [s[2], { B, yaw: info.driving ? info.vyaw : cy, car: [car.x, car.y, car.z], M: info.m, Rt3: [Rt[0], 0, Rt[1]], F3: [F[0], 0, F[1]],
        launch: launchCam, dmid, out, awayFrom, spawn: [SPAWN[0], car.y, SPAWN[1]] }]);
      saveDataUrl(`${dir}/${String(f).padStart(4, '0')}.jpg`, await ev(() => P.stepShot(1, 'image/jpeg', 0.93)));
    } else { await ev(() => P.cam(false)); await ev(() => P.step(1)); }
    if (p.tap) audio.push(Buffer.from(await ev(() => P.tapRead()), 'base64'));
    meta.push({ f, shot: s ? s[2] : null, info });
    if (f % 25 === 0) console.log(name, f, s ? s[2] : '-', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  if (p.tap) {
    fs.writeFileSync(`${dir}/audio.s16le`, Buffer.concat(audio));
    fs.writeFileSync(`${dir}/audio_frames.json`, JSON.stringify(audio.map((a) => a.length / 4)));
    await ev(() => P.tap(false));
  }
  fs.writeFileSync(`${dir}/meta.json`, JSON.stringify({ E, shots: p.shots, meta }));
  console.log('pass', name, 'done', ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
await browser.close();
