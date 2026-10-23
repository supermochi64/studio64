// Shot recording for the v5 trailer: the game frozen and stepped one frame per captured frame, the
// camera set every frame from keyframes (eased), frames saved as JPEG at the capture size.
import fs from 'node:fs';
import { saveDataUrl } from '../scripts/lib.mjs';

export const CAP_W = Number(process.env.CAP_W || 2560), CAP_H = Math.round((CAP_W * 9) / 16);
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// keys: [[frame, pos, focus, fov?], ...] -> the camera at frame f (smooth between keys; ease per segment)
export function camAt(keys, f) {
  if (f <= keys[0][0]) return { pos: keys[0][1], focus: keys[0][2], fov: keys[0][3] ?? 50 };
  for (let i = 0; i + 1 < keys.length; i++) {
    const [f0, p0, c0, v0 = 50, ease = 'smooth'] = keys[i], [f1, p1, c1, v1 = 50] = keys[i + 1];
    if (f <= f1) {
      const t0 = (f - f0) / (f1 - f0), t = ease === 'linear' ? t0 : ease === 'in' ? t0 * t0 : ease === 'out' ? 1 - (1 - t0) * (1 - t0) : smooth(t0);
      return { pos: lerp(p0, p1, t), focus: lerp(c0, c1, t), fov: v0 + (v1 - v0) * t };
    }
  }
  const k = keys[keys.length - 1];
  return { pos: k[1], focus: k[2], fov: k[3] ?? 50 };
}

export async function setup(page) {
  await page.evaluate(() => { const e = studio64.engine; e.resize = () => {}; P.res = (w, h) => e.M._studio_resize(w, h); });
}

// frames: count; cam(f) -> {pos, focus, fov} (or keys); each(f) runs before the frame is stepped
export async function shot(page, dir, { frames, cam, each, res = [CAP_W, CAP_H], quality = 0.94, log = true }) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const ev = (fn, a) => page.evaluate(fn, a);
  await ev(([w, h]) => { P.freeze(); studio64.engine.M._studio_set_paused(0, 1); P.res(w, h); }, res);
  const camFn = Array.isArray(cam) ? (f) => camAt(cam, f) : cam;
  const t0 = Date.now();
  for (let f = 0; f < frames; f++) {
    if (each) await each(f);
    const c = await camFn(f);
    if (c) await ev((c) => P.cam(true, c.pos, c.focus, c.fov ?? 50), c);
    saveDataUrl(`${dir}/${String(f).padStart(4, '0')}.jpg`, await ev((q) => P.stepShot(1, 'image/jpeg', q), quality));
    if (log && f % 25 === 0) console.log(dir.split('/').slice(-1)[0], f, ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  await ev(() => P.cam(false));
}

// Mario goes for the nearest Goomba and attacks (the old captures' autopilot). cam: 'ots-side' (over the
// shoulder, then from the side) or 'orbit' (circling him). Returns the frames he attacked on.
export async function hunt(page, dir, { weapon = 'shotgun', range = 600, frames = 180, camMode = 'ots-side', orbit = { r: 620, h: 190, speed: 0.012, a0: 0 }, sideNorth = false } = {}) {
  const ev = (fn, a) => page.evaluate(fn, a);
  const S16 = (a) => ((((a + 32768) % 65536) + 65536) % 65536) - 32768;
  const yawTo = (dx, dz) => (Math.round((Math.atan2(dx, dz) * 32768) / Math.PI) + 65536) % 65536;
  const add = (a, b) => a.map((v, i) => v + b[i]), mul = (a, k) => a.map((v) => v * k), lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const st = { cool: 0, cam: null, fires: [], combo: 0 };
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
      if (d > range) mag = weapon === 'katana' ? 56 : 48; else if (Math.abs(S16(want - m.yaw)) > 0x700) mag = 14;
      else if (st.cool <= 0) {
        b = 0x4000; st.fires.push(f);
        st.cool = weapon === 'shotgun' ? 30 : 9;
        if (weapon === 'katana' && ++st.combo % 3 === 0) st.cool = 22;
      }
    }
    await ev(([b, y, mg]) => P.bot(1, b, y, mg), [b, yaw, mag]);
    const M = [m.x, m.y, m.z], fw = [Math.sin((m.yaw * Math.PI) / 32768), 0, Math.cos((m.yaw * Math.PI) / 32768)], rt = [-fw[2], 0, fw[0]];
    const T = near ? [near.x, near.y, near.z] : add(M, mul(fw, 500));
    let want;
    if (camMode === 'orbit') {
      const a = orbit.a0 + f * orbit.speed;
      want = { pos: add(M, [Math.sin(a) * orbit.r, orbit.h, Math.cos(a) * orbit.r]), focus: add(lerp(M, T, 0.3), [0, 90, 0]) };
    } else if (f < frames * 0.55) want = { pos: add(add(M, mul(fw, -430)), add(mul(rt, -170), [0, 200, 0])), focus: add(lerp(M, T, 0.7), [0, 70, 0]) };
    else {
      const mid = lerp(M, T, 0.5), d = [T[0] - M[0], 0, T[2] - M[2]], L = Math.hypot(d[0], d[2]) || 1;
      let side = [-d[2] / L, 0, d[0] / L];
      if (sideNorth && side[2] > 0) side = mul(side, -1);
      want = { pos: add(mid, add(mul(side, Math.max(650, L * 1.1)), [0, 170, 0])), focus: add(mid, [0, 60, 0]) };
    }
    if (!st.cam) st.cam = want;
    st.cam = { pos: lerp(st.cam.pos, want.pos, 0.25), focus: lerp(st.cam.focus, want.focus, 0.25) };
    // never into the ground (an orbit over uneven streets)
    const fy = await ev((p) => studio64.engine.floor(p[0], p[1] + 600, p[2]), st.cam.pos);
    if (fy > -20000 && st.cam.pos[1] < fy + 140) st.cam.pos = [st.cam.pos[0], fy + 140, st.cam.pos[2]];
    last = st.cam;
  }, cam: () => ({ ...last, fov: 50 }) });
  await ev(() => P.bot(0));
  fs.writeFileSync(`${dir}/events.json`, JSON.stringify({ fires: st.fires }));
  return st.fires;
}
