// The city beat: flooded (before) and reborn (after) on the same camera move, then the plaza and a crane.
//   node city_cap.mjs OUTDIR [pass ...]   passes: before after plaza crane
import { openStudio, sleep } from '../scripts/lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import * as L from './city_layout.mjs';
import { setup, shot } from './rec.mjs';
const [OUT, ...want] = process.argv.slice(2), HERE = path.dirname(new URL(import.meta.url).pathname);
const PASSES = want.length ? want : ['before', 'after', 'plaza', 'crane'];
const { browser, page, id } = await openStudio({ level: 11, project: process.env.PROJECT, name: 'City reborn', viewport: { width: 1280, height: 720 } });
console.log('project', id);
const ev = (fn, a) => page.evaluate(fn, a);
await ev(() => studio64.engine.teleport(352, -1250, -3327, 16384));
for (let i = 0; i < 60; i++) { await sleep(500); if (await ev(() => studio64.engine.area === 2)) break; }
await sleep(2500);
await page.addScriptTag({ path: `${HERE}/city.js` });
await setup(page);
await ev(() => CITY.clear());
const ROOF = [100, -1700, -950, 0];
const put = async (m) => { await ev(() => P.run()); await ev((m) => studio64.engine.teleport(m[0], m[1], m[2], m[3]), m); await sleep(2500); };
const SUNK = [[0, [760, -1330, -1980], [-900, -2200, 1200], 50], [119, [520, -1440, -1640], [-900, -2260, 1260], 48]];
let revived = false;
async function revive() {
  if (revived) return;
  await ev(() => P.run());
  await ev(() => CITY.drain());
  const dir = `${HERE}/art/city`, man = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, 'utf8'));
  const files = Object.fromEntries(Object.entries(man).map(([p, f]) => [p, 'data:image/png;base64,' + fs.readFileSync(`${dir}/${f}`).toString('base64')]));
  await ev((f) => CITY.textures(f), files);
  await ev((L) => { CITY.plant(L.PLANTS); for (const pts of L.LAMPS) CITY.lamps(pts); }, { PLANTS: L.PLANTS, LAMPS: L.LAMPS });
  for (const [i, [a, b]] of L.BUNTING.entries()) await ev(([i, a, b]) => CITY.bunting('b' + i, a, b), [i, a, b]);
  await ev((t) => CITY.toads(t), L.TOADS);
  await sleep(3000);
  revived = true;
}
for (const pass of PASSES) {
  if (pass === 'before') {
    await ev(() => P.run()); await ev(() => CITY.flood()); await put(ROOF);
    await shot(page, `${OUT}/city_before`, { frames: 120, cam: SUNK });
  }
  if (pass === 'after') {
    await revive(); await put(ROOF);
    await shot(page, `${OUT}/city_after`, { frames: 120, cam: SUNK,
      each: async (f) => ev((f) => P.bot(1, f >= 66 && f < 76 ? 0x8000 : 0, 0, 0), f) });
    await ev(() => P.bot(0));
  }
  if (pass === 'plaza') {
    await revive(); await put([-960, -2400, 470, 43500]);
    await ev((b) => CITY.butterflies(b), [[-1000, 700, 60], [-850, 450, 40], [-1150, 500, 50], [-800, 800, 70], [-1250, 850, 40]]);
    await ev(() => P.step(30));
    await shot(page, `${OUT}/city_plaza`, { frames: 100, cam: [[0, [-1560, -2445, 260], [-980, -2420, 760], 46], [99, [-1470, -2443, 170], [-970, -2420, 750], 46]] });
  }
  if (pass === 'crane') {
    await revive(); await put([-960, -2400, 470, 43500]);
    await shot(page, `${OUT}/city_crane`, { frames: 110, cam: [[0, [-700, -2450, 1560], [-700, -2280, 700], 52], [109, [-700, -1150, 2250], [-650, -2450, 0], 56]] });
  }
  if (pass === 'shotgun') {
    await revive(); await put([150, -1700, -1900, 0]);
    const G = [[-250, -1250], [600, -1350], [80, -950], [-500, -1700], [700, -1900]];
    await ev((G) => G.forEach(([x, z], i) => P.spawn({ uid: 0x7d300000 + i, entry: 'goomba', x, y: studio64.engine.floor(x, -1500, z), z, yaw: 16384 })), G);
    await ev(() => studio64.engine.M._studio_shotgun_give(1));
    await ev(() => P.step(20));
    await hunt(`${OUT}/city_shotgun`, 'shotgun', 560, 170);
  }
}
await browser.close();

// Mario goes for the nearest Goomba and fires (the old capture's autopilot), filmed over his shoulder
// and from the side, the camera following smoothly.
async function hunt(dir, weapon, range, frames) {
  const S16 = (a) => ((((a + 32768) % 65536) + 65536) % 65536) - 32768;
  const yawTo = (dx, dz) => (Math.round((Math.atan2(dx, dz) * 32768) / Math.PI) + 65536) % 65536;
  const st = { cool: 0, cam: null, fires: [] };
  const add = (a, b) => a.map((v, i) => v + b[i]), mul = (a, k) => a.map((v) => v * k), lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  let last = null;
  await shot(page, dir, { frames, each: async (f) => {
    const m = await ev(() => P.mario());
    const alive = await ev(() => P.objects().filter((o) => o.bhv === 'bhvGoomba').map((o) => ({ slot: o.slot, x: o.x, y: o.y, z: o.z }))
      .filter((o) => { const s = P.obj(o.slot); return s.active && s.action < 100; }));
    const near = alive.sort((a, c) => Math.hypot(a.x - m.x, a.z - m.z) - Math.hypot(c.x - m.x, c.z - m.z))[0];
    let b = 0, yaw = m.yaw, mag = 0;
    st.cool--;
    if (near) {
      const d = Math.hypot(near.x - m.x, near.z - m.z), want = yawTo(near.x - m.x, near.z - m.z);
      yaw = want;
      if (d > range) mag = 48; else if (Math.abs(S16(want - m.yaw)) > 0x700) mag = 14;
      else if (st.cool <= 0) { b = 0x4000; st.cool = weapon === 'shotgun' ? 30 : 9; st.fires.push(f); }
    }
    await ev(([b, y, mg]) => P.bot(1, b, y, mg), [b, yaw, mag]);
    const M = [m.x, m.y, m.z], T = near ? [near.x, near.y, near.z] : add(M, [Math.sin(m.yaw * Math.PI / 32768) * 500, 0, Math.cos(m.yaw * Math.PI / 32768) * 500]);
    const fw = [Math.sin(m.yaw * Math.PI / 32768), 0, Math.cos(m.yaw * Math.PI / 32768)], rt = [-fw[2], 0, fw[0]];
    // over the shoulder for the first part, then from the side
    let want;
    if (f < frames * 0.55) want = { pos: add(add(M, mul(fw, -430)), add(mul(rt, -170), [0, 200, 0])), focus: add(lerp(M, T, 0.7), [0, 70, 0]) };
    else { const mid = lerp(M, T, 0.5), d = [T[0] - M[0], 0, T[2] - M[2]], L = Math.hypot(d[0], d[2]) || 1;
      let side = [-d[2] / L, 0, d[0] / L];
      if (side[2] > 0) side = mul(side, -1);   // from the north: the town behind them
      want = { pos: add(mid, add(mul(side, Math.max(650, L * 1.1)), [0, 170, 0])), focus: add(mid, [0, 60, 0]) }; }
    if (!st.cam || (f > 0 && Math.abs(f - frames * 0.55) < 0.5)) st.cam = want;
    st.cam = { pos: lerp(st.cam.pos, want.pos, 0.25), focus: lerp(st.cam.focus, want.focus, 0.25) };
    last = st.cam;
  }, cam: () => ({ ...last, fov: 50 }) });
  await ev(() => P.bot(0));
  fs.writeFileSync(`${dir}/events.json`, JSON.stringify({ fires: st.fires }));
}
