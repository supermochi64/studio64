// The race beat (Bob-omb Battlefield): an asphalt road rolls out up the mountain along Koopa the Quick's
// race path, Mario gets in the sportscar and races him; then the climb to the summit.
//   node bob_cap.mjs OUTDIR [test|road|start|summit ...]
import { openStudio, sleep } from '../scripts/lib.mjs';
import fs from 'node:fs';
import { setup, shot } from './rec.mjs';
const [OUT, ...want] = process.argv.slice(2);
const PASSES = want.length ? want : ['road', 'start', 'summit'];
const KTQ_ROUTE = [[760, 765, 5680], [1920, 768, 5040], [2000, 768, 4360], [1240, 768, 3600], [-280, 768, 2720], [-1680, 768, 1840], [-2280, 0, 1800], [-2720, 0, 1120], [-2520, 0, 480], [-1720, 0, 120], [560, 630, -840], [2700, 1571, -1500], [4520, 1830, -2600], [6240, 1943, -3500], [6380, 2066, -6180], [4000, 2390, -7720], [-120, 2608, -5515], [-180, 2641, -4860], [580, 2769, -3380], [1670, 2867, -2580], [2216, 2900, -2126], [3167, 2965, -1870], [4069, 3050, -2487], [4880, 3037, -3416], [5020, 3181, -5760], [4660, 3354, -6300], [3940, 3514, -6800], [3200, 3619, -6850], [1290, 3768, -5793], [1150, 3900, -3670], [2980, 4046, -2930], [4334, 4186, -3680], [4180, 4242, -4220], [3660, 4242, -4380]];
// the race's start: across the meadow where the level begins (flat; Koopa's own route runs along a cliff edge)
const PLATEAU = [[-7100, 0, 6850], [-5900, 0, 6880], [-4700, 0, 6850], [-4050, 0, 6500], [-3950, 0, 5700], [-3950, 0, 4700]];
const KTQ_PATH = process.env.ROUTE === 'plateau' ? PLATEAU : KTQ_ROUTE;
const { browser, page } = await openStudio({ level: 9, name: 'Koopa race', viewport: { width: 1280, height: 720 } });
const ev = (fn, a) => page.evaluate(fn, a);
await setup(page);
const S16 = (a) => ((((a + 32768) % 65536) + 65536) % 65536) - 32768;
const yawTo = (dx, dz) => (Math.round((Math.atan2(dx, dz) * 32768) / Math.PI) + 65536) % 65536;
const add = (a, b) => a.map((v, i) => v + b[i]), mul = (a, k) => a.map((v) => v * k), lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// arc length along the path
const seg = KTQ_PATH.slice(1).map((p, i) => Math.hypot(p[0] - KTQ_PATH[i][0], p[2] - KTQ_PATH[i][2]));
const TOTAL = seg.reduce((a, b) => a + b, 0);
function prefix(L) {   // the path's first L units (points, the tip interpolated)
  const out = [KTQ_PATH[0]];
  for (let i = 0; i < seg.length; i++) {
    if (L >= seg[i]) { out.push(KTQ_PATH[i + 1]); L -= seg[i]; continue; }
    out.push(lerp(KTQ_PATH[i], KTQ_PATH[i + 1], L / seg[i]).map(Math.round));
    break;
  }
  return out;
}
// the road, drawn through the studio's own roads tool (asphalt, follows the ground)
let roadUid = null;
async function road(pts) {
  roadUid = await ev(([pts, uid]) => {
    const ops = studio64.paths.ui.ops;
    if (uid) { const rec = ops.find(uid); ops.update(rec, { pts: pts.map((p) => [p[0], p[1], p[2]]) }, 'road', { refit: true }); return uid; }
    const rec = ops.roadRecord({ style: 'asphalt', pts, smooth: true });
    ops.addRoad(rec);
    return rec.uid;
  }, [pts, roadUid]);
}
const vstate = () => ev(() => JSON.parse(studio64.engine.M.UTF8ToString(studio64.engine.M._studio_vehicle_state_json())));
async function placeCar(at, toward) {
  const yaw = (Math.atan2(toward[0] - at[0], toward[2] - at[2]) * 180) / Math.PI;
  const r = await ev(([at, yaw]) => studio64.studio.handle('vehicle_place', { look: 'sportscar', x: at[0], y: Math.round(studio64.engine.floor(at[0], at[1] + 400, at[2])), z: at[2], yaw_deg: yaw, color: '#e8202a' }), [at, yaw]);
  await sleep(1500);
  return { ...r, yaw };
}
// the path every 50 units (with arc length), for the autopilot and the Koopa puppet
const DENSE = [];
{ let acc = 0; for (let i = 0; i + 1 < KTQ_PATH.length; i++) { const n = Math.max(1, Math.round(seg[i] / 50)); for (let k = 0; k < n; k++) DENSE.push({ p: lerp(KTQ_PATH[i], KTQ_PATH[i + 1], k / n), s: acc + (seg[i] * k) / n, wp: i }); acc += seg[i]; } DENSE.push({ p: KTQ_PATH[KTQ_PATH.length - 1], s: acc, wp: KTQ_PATH.length - 1 }); }
// a point beside the path: off > 0 to the left of the way it runs (ahead - behind), < 0 to the right
const LANE = 170, KLANE = 195;   // the car right of the middle, Koopa left: clear of each other
function lane(p, ahead, behind, off) {
  const dx = ahead[0] - behind[0], dz = ahead[2] - behind[2], L = Math.hypot(dx, dz) || 1;
  return [p[0] + (dz / L) * off, p[1], p[2] - (dx / L) * off];
}
const atS = (s) => { let i = DENSE.findIndex((d) => d.s >= s); if (i < 0) i = DENSE.length - 1; return DENSE[Math.max(0, i)]; };
let near = 0;
// pure pursuit: a point `look` ahead on the path; positive stick turns right (yaw down)
function steer(v, i0) {
  const from = Math.max(near - 10, 0);
  let best = from, bd = Infinity;
  for (let i = from; i < Math.min(DENSE.length, from + 120); i++) { const d = Math.hypot(DENSE[i].p[0] - v.x, DENSE[i].p[2] - v.z); if (d < bd) { bd = d; best = i; } }
  near = best;
  const tgt = atS(DENSE[best].s + 650).p;
  const diff = S16(yawTo(tgt[0] - v.x, tgt[2] - v.z) - v.yaw);
  return { sx: Math.max(-64, Math.min(64, Math.round((-diff / 5500) * 64))), diff, best: DENSE[best].wp, gas: (v.speed || 0) < Number(process.env.VMAX || 48) && Math.abs(diff) < 9000 };
}

// nothing standing on or beside the road
await ev((path) => {
  const near = (o) => path.some((p, i) => { if (i === 0) return false; const a = path[i - 1], b = p, dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((o.x - a[0]) * dx + (o.z - a[2]) * dz) / L2)); return Math.hypot(o.x - a[0] - dx * t, o.z - a[2] - dz * t) < 650; });
  for (const o of P.objects()) if (!/Mario|Studio|Car|Vehicle/.test(o.bhv) && near(o)) studio64.engine.M._studio_delete_slot(o.slot);
}, KTQ_PATH);
for (const pass of PASSES) {
  await ev(() => P.run());
  if (pass === 'road') {
    // close: the asphalt unrolls toward the camera, which drifts back ahead of the tip
    const N = 75;
    let cam = null;
    await shot(page, `${OUT}/race_road`, { frames: N,
      each: async (f) => {
        const L = 300 + 95 * f;
        await road(prefix(L));
        const ahead = atS(L + 1100).p, behind = atS(Math.max(0, L - 200)).p;
        const want = { pos: [ahead[0] + 250, ahead[1] + 520, ahead[2] + 200], focus: [behind[0], behind[1] + 40, behind[2]] };
        cam = cam ? { pos: lerp(cam.pos, want.pos, 0.12), focus: lerp(cam.focus, want.focus, 0.2) } : want;
      }, cam: () => ({ ...cam, fov: 54 }) });
    roadUid = null;
    await ev(() => { const ops = studio64.paths.ui.ops; for (const r of ops.records().filter((r) => r.road)) ops.remove(r); });
  }
  if (pass === 'roadwide') {
    // the aerial: it rolls on up the mountain to the summit
    const N = 100;
    await shot(page, `${OUT}/race_roadwide`, { frames: N,
      each: async (f) => { if (f % 2 === 0) await road(prefix(Math.max(400, TOTAL * Math.min(1, (f + 2) / (N - 20))))); },
      cam: [[0, [-5200, 4200, 7400], [600, 1300, 300], 52], [N - 1, [-4200, 5600, 6200], [1400, 2100, -1800], 54]] });
  }
  if (pass === 'test' || pass === 'start' || pass === 'chase' || pass === 'summit') {
    console.log(pass, 'road...');
    if (!roadUid) await road(KTQ_PATH);
    console.log(pass, 'road', roadUid);
    await sleep(2000);
    const i0 = pass === 'summit' ? KTQ_PATH.findIndex((p) => p[0] === 3200 && p[2] === -6850) : 0;
    const next = KTQ_PATH[i0 + 1], at = pass === 'summit' ? KTQ_PATH[i0] : lane(KTQ_PATH[i0], next, KTQ_PATH[i0], -LANE).map(Math.round);
    const car = await placeCar(at, next);
    console.log(pass, 'car', JSON.stringify(car).slice(0, 200));
    const cyaw = (car.yaw * Math.PI) / 180, F = [Math.sin(cyaw), Math.cos(cyaw)], Rt = [-F[1], F[0]];
    const door = [at[0] - Rt[0] * 190, at[2] - Rt[1] * 190];
    await ev((p) => studio64.engine.teleport(p[0], studio64.engine.floor(p[0], 6000, p[1]) + 5, p[1], 0), [door[0] - Rt[0] * 260 - F[0] * 120, door[1] - Rt[1] * 260 - F[1] * 120]);
    if (pass === 'summit') {   // Mario straight into the seat
      const uid = car.placed?.[0]?.record?.uid;
      await ev((u) => studio64.engine.M._studio_vehicle_enter(u >>> 0), uid);
      await sleep(500);
    }
    let ktq = -1;
    near = DENSE.findIndex((d) => d.wp >= i0);
    if (pass !== 'summit') ktq = await ev((p) => studio64.engine.spawn({ uid: 0x7d600001, bhv: 'bhvStudioActor', model: 'koopa', x: p[0], y: p[1], z: p[2], yaw: 0, pitch: 0, roll: 0, bparams: 0, scale: 1.5, name: 'Koopa the Quick',
      actor: { name: 'Koopa the Quick', model: 'koopa', move: 'stand', faceMario: false, harmless: true, damage: 0, stomp: false, punch: false, invincible: true, knockback: false, coins: 0, anim: 9, sounds: { alert: '', hit: '', defeat: '', attack: '' }, scale: 1.5 } }),
      [at[0], at[1] - 3000, at[2]]);
    await sleep(2500);
    const st = { phase: pass === 'summit' ? 'enter' : 'walk', log: [] };
    let camState = null;
    const frames = pass === 'test' ? 260 : pass === 'start' || pass === 'chase' ? 200 : 150;
    let dbg = 0;
    const each = async (f) => {
      if (f % 50 === 0) console.log(pass, 'frame', f, st.phase);
      const m = await ev(() => P.mario());
      const v = await vstate();
      let b = 0, yaw = 0, mag = 0, raw = 0, sx = 0;
      if (st.phase === 'walk') {
        const d = Math.hypot(door[0] - m.x, door[1] - m.z);
        yaw = d > 30 ? yawTo(door[0] - m.x, door[1] - m.z) : yawTo(at[0] - m.x, at[2] - m.z); mag = d > 120 ? 64 : d > 30 ? 30 : 0;
        if (v.prompt === 1 && d < 70) { b = 0x4000; st.phase = 'enter'; st.B = f; }
      } else if (st.phase === 'enter') { if (v.driving) { st.phase = 'drive'; st.D = f; } }
      if (st.phase === 'drive') {
        // guided: the car along the road at a speed that builds up (its physics settles it on the ground)
        const k = f - st.D, s0 = DENSE.find((d) => d.wp >= i0).s;
        st.spd = Math.min(Number(process.env.VMAX || 58), (st.spd || 0) + 2.2);
        st.cs = (st.cs ?? s0) + st.spd;
        const a = atS(st.cs), ah = atS(st.cs + 150), bh = atS(Math.max(s0, st.cs - 150));
        const cy = yawTo(ah.p[0] - bh.p[0], ah.p[2] - bh.p[2]);
        const cp = lane(a.p, ah.p, bh.p, pass === 'summit' ? 0 : -LANE);
        await ev(([p, y, sp]) => studio64.engine.M._studio_vehicle_pose(p[0], studio64.engine.floor(p[0], p[1] + 500, p[2]) + 10, p[2], y, sp), [cp, cy, st.spd]);
        raw = 1; b = 0x8000; st.wp = a.wp;
      }
      // Koopa the Quick (a puppet): off at his race speed when Mario gets in, along the same path
      if (ktq >= 0 && st.D !== undefined) {
        // he joins the race as the car pulls away: just ahead, in his own lane
        const s0 = DENSE.find((d) => d.wp >= i0).s;
        const run = Math.min(1, (f - st.D) / 12);
        st.ks = (st.ks ?? s0 + 260) + 27 * run;
        const a = atS(st.ks), b2 = atS(st.ks + 60), b0 = atS(Math.max(0, st.ks - 60)), kyaw = yawTo(b2.p[0] - a.p[0], b2.p[2] - a.p[2]);
        const kp = lane(a.p, b2.p, b0.p, KLANE);
        await ev(([s, p, y]) => studio64.engine.M._studio_transform_slot(s, p[0], studio64.engine.floor(p[0], p[1] + 400, p[2]), p[2], 0, y, 0, 0), [ktq, kp, kyaw]);
      }
      await ev(([b, yaw, mag, raw, sx]) => { P.bot(1, b, yaw, mag); studio64.engine.M._studio_bot_stick(raw, sx, 0); }, [b, yaw, mag, raw, sx]);
      const k = ktq >= 0 ? await ev((s) => P.obj(s), ktq) : null;
      st.log.push({ f, phase: st.phase, m: [m.x, m.y, m.z], v: [v.x, v.y, v.z], vyaw: v.yaw, speed: v.speed, sx, wp: st.wp, k: k && [k.x, k.y, k.z, k.action] });
      // cameras: by the door for the hop in, then a low chase beside the car
      const C = v.driving ? [v.x, v.y, v.z] : [at[0], at[1], at[2]];
      const vy = v.driving ? (v.yaw * Math.PI) / 32768 : cyaw, fw = [Math.sin(vy), 0, Math.cos(vy)], rt = [-fw[2], 0, fw[0]];
      let w;
      if (!v.driving) w = { pos: add([door[0], m.y, door[1]], add(mul(fw, 520), add(mul(rt, -360), [0, 170, 0]))), focus: add([m.x, m.y, m.z], [0, 90, 0]) };
      else if (pass === 'chase') w = { pos: add(C, add(mul(fw, -820), [0, 420, 0])), focus: add(C, add(mul(fw, 900), [0, 260, 0])) };
      else if (pass === 'summit') {   // high, behind and outside the mountain (its middle near 2500, -4500): clear of the cliffs
        const out = [C[0] - 2500, 0, C[2] + 4500], L = Math.hypot(out[0], out[2]) || 1;
        w = { pos: add(C, add(mul(fw, -520), add(mul([out[0] / L, 0, out[2] / L], 700), [0, 850, 0]))), focus: add(C, add(mul(fw, 350), [0, 60, 0])) };
      }
      else w = { pos: add(C, add(mul(fw, -380), add(mul(rt, -520), [0, 140, 0]))), focus: add(C, add(mul(fw, 300), [0, 80, 0])) };
      camState = camState ? { pos: lerp(camState.pos, w.pos, 0.18), focus: lerp(camState.focus, w.focus, 0.25) } : w;
    };
    if (pass === 'test') {
      await ev(() => { P.freeze(); studio64.engine.M._studio_set_paused(0, 1); P.res(480, 270); });
      for (let f = 0; f < frames; f++) { await each(f); await ev(() => P.step(1)); }
    } else await shot(page, `${OUT}/race_${pass}`, { frames, each, cam: () => ({ ...camState, fov: 52 }) });
    await ev(() => { P.bot(0); studio64.engine.M._studio_bot_stick(0, 0, 0); });
    fs.writeFileSync(`${OUT}/race_${pass}.log.json`, JSON.stringify(st.log));
    const L = st.log;
    console.log(pass, 'B', st.B, 'D', st.D, 'end', JSON.stringify(L[L.length - 1]));
    for (let i = 0; i < L.length; i += 20) console.log(' ', L[i].f, L[i].phase, L[i].v.map(Math.round).join(','), 'spd', Math.round(L[i].speed || 0), 'sx', L[i].sx, 'wp', L[i].wp, 'ktq', L[i].k && L[i].k.map(Math.round).join(','));
    await ev(() => { const v = studio64.editor.records().filter((r) => /^vehicle:/.test(r.entry)); for (const r of v) studio64.engine.deleteUid(r.uid); });
    if (ktq >= 0) await ev((s) => studio64.engine.M._studio_delete_slot(s), ktq);
  }
}
await browser.close();
