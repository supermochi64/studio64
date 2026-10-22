// In-page camera rigs for the fight passes. P.rig(name, ctx) -> {pos, focus, fov}; ctx has the frame,
// the events (E: frames of grab/spin/release/hit), Mario, Bowser, the target mine, smoothing state.
(() => {
  const V = (x, y, z) => [x, y, z];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
  const norm2 = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, 0, z / l]; };
  const yawDir = (yaw) => [Math.sin((yaw * Math.PI) / 32768), 0, Math.cos((yaw * Math.PI) / 32768)];
  const rot = (d, deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [d[0] * c + d[2] * s, 0, -d[0] * s + d[2] * c]; };
  const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
  P.rigState = {};
  P.rigs = {
    // over Mario's shoulder at where Bowser appears; slow push
    reveal(c) {
      const m = c.M, home = c.home, d = norm2(home[0] - m[0], home[2] - m[2]);
      const k = c.f - c.start;
      const pos = add(add(m, mul(d, -330 + k * 1.2)), add(mul(rot(d, 90), 140), V(0, 120, 0)));
      return { pos, focus: add(home, V(0, 260, 0)), fov: 42 };
    },
    // low in front of Bowser, looking up at him as he walks in
    villain(c) {
      const b = c.B, d = norm2(c.mstart[0] - c.home[0], c.mstart[2] - c.home[2]);
      const k = c.f - c.start;
      const pos = add(add(c.home, mul(d, 900 - k * 0.8)), add(mul(rot(d, 90), -260), V(0, 40, 0)));
      return { pos, focus: add(b, V(0, 300, 0)), fov: 48 };
    },
    // wide tracking: both in frame while Mario runs around him
    track(c) {
      const m = c.M, b = c.B, mid = lerp(m, b, 0.45);
      const away = norm2(m[0] - b[0], m[2] - b[2]);
      const side = rot(away, c.opt.side ?? 65);
      return { pos: add(add(mid, mul(side, 1500)), V(0, 380, 0)), focus: add(mid, V(0, 140, 0)), fov: 45, smooth: 0.12 };
    },
    // close on the grab: low, beside Mario
    grab(c) {
      const m = c.M, d = yawDir(c.myaw);
      return { pos: add(add(m, mul(rot(d, 120), 520)), V(0, 90, 0)), focus: add(m, add(mul(d, 120), V(0, 120, 0))), fov: 46, smooth: 0.25 };
    },
    // orbit around Mario while he swings Bowser
    spin(c) {
      const m = c.M, k = c.f - c.start, a0 = c.opt.a0 ?? 0;
      const d = rot([0, 0, 1], a0 - k * (c.opt.speed ?? 1.2));
      const r = (c.opt.r ?? 1250) - k * (c.opt.push ?? 2), h = c.opt.h ?? 160;
      return { pos: add(add(m, mul(d, r)), V(0, h, 0)), focus: add(m, V(0, 170, 0)), fov: c.opt.fov ?? 50 };
    },
    // behind Mario, along the throw, the mine in the distance (telephoto)
    throwback(c) {
      const m = c.M0 || c.M, t = c.target, d = norm2(t[0] - m[0], t[2] - m[2]);
      const k = c.f - c.start;
      const pos = add(add(m, mul(d, -650 - k * 4)), add(mul(rot(d, 90), 160), V(0, 230, 0)));
      return { pos, focus: add(t, V(0, 150, 0)), fov: 38 };
    },
    // from beside the mine, Bowser flying in toward the camera side
    incoming(c) {
      const t = c.target, m = c.M0 || c.M, d = norm2(t[0] - m[0], t[2] - m[2]);
      const pos = add(add(t, mul(d, 500)), add(mul(rot(d, 90), 900), V(0, 260, 0)));
      return { pos, focus: lerp(add(c.B, V(0, 200, 0)), add(t, V(0, 150, 0)), c.opt.lean ?? 0.3), fov: 50, smooth: 0.3 };
    },
    // wide, the blast and Bowser tumbling away
    blast(c) {
      const t = c.target, m = c.M0 || c.M, d = norm2(t[0] - m[0], t[2] - m[2]);
      const pos = add(add(t, mul(d, -1700)), add(mul(rot(d, 90), 1500), V(0, 700, 0)));
      return { pos, focus: lerp(add(t, V(0, 300, 0)), add(c.B, V(0, 200, 0)), 0.5), fov: 52, smooth: 0.15 };
    },
    // bullet time: orbit the frozen moment
    bullet(c) {
      const k = c.f - c.start, ctr = c.opt.center || c.B;
      const d = rot([0, 0, 1], (c.opt.a0 ?? 0) + k * (c.opt.speed ?? 2.2));
      return { pos: add(add(ctr, mul(d, c.opt.r ?? 1100)), V(0, c.opt.h ?? 250, 0)), focus: add(ctr, V(0, 150, 0)), fov: 50 };
    },
  };
  P.rigApply = (name, c) => {
    const r = P.rigs[name](c);
    const S = P.rigState;
    if (S.name !== name || S.start !== c.start || !r.smooth) { S.name = name; S.start = c.start; S.pos = r.pos; S.focus = r.focus; }
    else { S.pos = lerp(S.pos, r.pos, r.smooth); S.focus = lerp(S.focus, r.focus, r.smooth); }
    P.cam(true, S.pos, S.focus, r.fov);
    return { pos: S.pos.map((v) => v | 0), focus: S.focus.map((v) => v | 0), fov: r.fov };
  };
})();
