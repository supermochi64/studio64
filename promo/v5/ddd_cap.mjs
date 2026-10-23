// The submarine beat (Dire, Dire Docks area 2): Mario hops into a pipe on Bowser's sub, the sub pulls out of
// the dock, sways, dips its nose and dives toward the channel.   node ddd_cap.mjs OUTDIR [pipe depart dive]
import { openStudio, sleep } from '../scripts/lib.mjs';
import { setup, shot } from './rec.mjs';
const [OUT, ...want] = process.argv.slice(2);
const PASSES = want.length ? want : ['pipe', 'depart', 'dive'];
const { browser, page } = await openStudio({ level: 23, name: 'Sub ride', viewport: { width: 1280, height: 720 } });
const ev = (fn, a) => page.evaluate(fn, a);
await ev(() => studio64.engine.teleport(4200, -300, 0, 16384));
for (let i = 0; i < 60; i++) { await sleep(500); if (await ev(() => studio64.engine.area === 2)) break; }
await sleep(2500);
await setup(page);
// clutter out of the shots
await ev(() => { for (const o of P.objects()) if (!/^bhv(BowsersSub|BowserSubDoor|Mario|StaticObject)$/.test(o.bhv) && !/Mario/.test(o.bhv)) studio64.engine.M._studio_delete_slot(o.slot); });
const C0 = [3917, 0, 870];              // the sub's middle in its own coordinates
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// the sub at frame f of the ride: centre, yaw/pitch/roll (degrees)
function pose(f) {
  const t = f / 30;
  const go = smooth(t / 3.2) * 2600 + Math.max(0, t - 3.2) * 900;        // pulls out, then cruises
  const dive = smooth((t - 4.0) / 3.0);                                    // then dives
  const sway = Math.sin(t * 1.3) * 4 * smooth(t / 1.5);   // (the stern swings toward the stone slab beside it: kept small)
  return { c: [C0[0] + (1 - Math.cos(t * 0.9)) * 90, -dive * 1900, C0[2] - go], yaw: sway, pitch: -14 * Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 4.0) / 3.0))), roll: -sway * 0.5 };
}
const S = (deg) => Math.round((deg / 360) * 65536);
function place(p) {   // object position so the sub's middle lands on p.c (sm64: v' = R_y R_x R_z v + T)
  const a = (d) => (S(d) * Math.PI) / 32768;
  const sx = Math.sin(a(p.pitch)), cx = Math.cos(a(p.pitch)), sy = Math.sin(a(p.yaw)), cy = Math.cos(a(p.yaw)), sz = Math.sin(a(p.roll)), cz = Math.cos(a(p.roll));
  const m = [[cy * cz + sx * sy * sz, cx * sz, -sy * cz + sx * cy * sz], [-cy * sz + sx * sy * cz, cx * cz, sy * sz + sx * cy * cz], [cx * sy, -sx, cx * cy]];
  const r = [0, 1, 2].map((k) => C0[0] * m[0][k] + C0[1] * m[1][k] + C0[2] * m[2][k]);
  return [p.c[0] - r[0], p.c[1] - r[1], p.c[2] - r[2]];
}
const slots = await ev(() => P.objects().filter((o) => o.bhv === 'bhvBowsersSub' || o.bhv === 'bhvBowserSubDoor').map((o) => o.slot));
const PIPE = [3917, 571, 1500];
let pipeSlot = -1;
function onSub(p, v) {   // a point of the sub (its coordinates at frame 0) where the sub is at pose p
  const a = (d) => (S(d) * Math.PI) / 32768;
  const sx = Math.sin(a(p.pitch)), cx = Math.cos(a(p.pitch)), sy = Math.sin(a(p.yaw)), cy = Math.cos(a(p.yaw)), sz = Math.sin(a(p.roll)), cz = Math.cos(a(p.roll));
  const m = [[cy * cz + sx * sy * sz, cx * sz, -sy * cz + sx * cy * sz], [-cy * sz + sx * sy * cz, cx * cz, sy * sz + sx * cy * cz], [cx * sy, -sx, cx * cy]];
  const t = place(p);
  return [0, 1, 2].map((k) => v[0] * m[0][k] + v[1] * m[1][k] + v[2] * m[2][k] + t[k]);
}
async function setSub(f) {
  const p = pose(f), t = place(p);
  await ev(([s, t, p]) => { for (const k of s) studio64.engine.M._studio_transform_slot(k, t[0], t[1], t[2], p[0], p[1], p[2], 0); }, [slots, t, [S(p.pitch), S(p.yaw), S(p.roll)]]);
  if (pipeSlot >= 0) { const q = onSub(p, PIPE); await ev(([s, q, r]) => studio64.engine.M._studio_transform_slot(s, q[0], q[1], q[2], r[0], r[1], r[2], 0), [pipeSlot, q, [S(p.pitch), S(p.yaw), S(p.roll)]]); }
  return p;
}
// splashes at the bow while on the surface, bubbles once under
const fx = [];
let uid = 0x7d400000;
async function effects(f, p) {
  const bow = [p.c[0] + Math.sin((p.yaw * Math.PI) / 180) * -3300, p.c[1], p.c[2] - Math.cos((p.yaw * Math.PI) / 180) * 3300];
  if (f % 3 === 0 && f > 10) {
    if (p.c[1] > -250) for (const s of [-1, 1]) fx.push({ kind: 'prop:water_splash', at: [bow[0] + s * (380 + Math.random() * 120), 0, bow[2] + 300 + Math.random() * 400], v: [s * 6, 3, 10], born: f, life: 14, scale: 2.2 });
    else for (let k = 0; k < 3; k++) fx.push({ kind: 'prop:bubble', at: [p.c[0] + (Math.random() - 0.5) * 1200, p.c[1] + 300 + Math.random() * 400, p.c[2] + 800 + Math.random() * 2600], v: [0, 14, 0], born: f, life: 40, scale: 1.5 + Math.random() * 2 });
  }
  for (const e of fx) {
    const k = f - e.born;
    if (k === 0) e.slot = await ev((e) => P.spawn({ uid: e.uid, entry: e.kind, x: e.at[0], y: e.at[1], z: e.at[2], yaw: 0, scale: e.scale }), { ...e, uid: uid++ });
    else if (k >= e.life) { await ev((s) => studio64.engine.M._studio_delete_slot(s), e.slot); e.dead = true; }
    else await ev(([s, x, y, z, sc]) => studio64.engine.M._studio_transform_slot(s, x, y, z, 0, 0, 0, sc), [e.slot, e.at[0] + e.v[0] * k, e.at[1] + e.v[1] * k, e.at[2] + e.v[2] * k, e.scale * (1 + k / e.life)]);
  }
  for (let i = fx.length - 1; i >= 0; i--) if (fx[i].dead) fx.splice(i, 1);
}
async function clearFx() { for (const e of fx) if (e.slot !== undefined) await ev((s) => studio64.engine.M._studio_delete_slot(s), e.slot); fx.length = 0; }
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

for (const pass of PASSES) {
  await ev(() => P.run());
  if (pipeSlot < 0) pipeSlot = await ev((p) => P.spawn({ uid: 0x7d3fffff, bhv: 'bhvStaticObject', model: 'warp_pipe', x: p[0], y: p[1], z: p[2], yaw: 0 }), PIPE);
  await setSub(0);
  if (pass === 'pipe') {
    await ev(() => studio64.engine.teleport(3917, 600, 2150, 32768));
    await sleep(2000);
    let gone = false, jumped = -1;
    await shot(page, `${OUT}/sub_pipe`, { frames: 95, cam: [[0, [3560, 730, 2600], [3917, 700, 1650], 40], [94, [3480, 760, 2420], [3917, 690, 1520], 38]],
      each: async (f) => {
        const m = await ev(() => P.mario());
        const d = Math.hypot(m.x - PIPE[0], m.z - PIPE[2]);
        let b = 0, mag = 0;
        if (!gone) {
          if (jumped < 0 && d > 260) mag = 40;
          if (jumped < 0 && d <= 260) jumped = f;
          if (jumped >= 0 && f - jumped < 8) { b = 0x8000; mag = 30; }
          if (jumped >= 0 && f - jumped > 6 && m.vy < 0 && m.y < PIPE[1] + 230 && d < 130) {
            gone = true;
            await ev(() => studio64.engine.teleport(3900, 200, 6200, 0));
          }
        }
        await ev(([b, mag]) => P.bot(1, b, 32768, mag), [b, mag]);
      } });
    await ev(() => P.bot(0));
    console.log('pipe: jumped at', jumped, 'gone', gone);
  }
  if (pass === 'depart' || pass === 'dive') {
    await ev(() => studio64.engine.teleport(3900, 200, 6200, 0));
    const [f0, n] = pass === 'depart' ? [0, 150] : [110, 150];
    let p = null;
    await shot(page, `${OUT}/sub_${pass}`, { frames: n,
      each: async (k) => { p = await setSub(f0 + k); await effects(f0 + k, p); },
      cam: (k) => {
        if (pass === 'depart') {   // from the dock, high behind it: the whole sub pulling out, swaying
          const pos = lerp([2700, 1500, 5900], [3100, 1250, 3900], k / (n - 1));
          return { pos, focus: [p.c[0], p.c[1] + 250, p.c[2] - 1200], fov: 50 };
        }
        // under the water, from the deep west side: it noses down and glides away
        const pos = lerp([1750, -1300, 300], [1800, -1700, -1300], k / (n - 1));
        return { pos, focus: [p.c[0], p.c[1] + 100, p.c[2] - 200], fov: 62 };
      } });
    await clearFx();
  }
}
await browser.close();
