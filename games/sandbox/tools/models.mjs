// The game's models, made from boxes: people, cars and bikes, weapons, pickups, effects, sky, water.
//
// People and vehicles are skinned on a few bones (every vertex follows one bone), so the game poses
// them by code (walk cycles, steering, spinning wheels) without animation data. Their parts have
// materials with a "prim" tint (shirt, pants, paint...): the game sets the colour per character or
// car, so one model makes every look. To replace a model, put a .glb with the same bone and material
// names in assets/ (made in Blender with fast64): see docs/sandbox.md.
import { Gltf, MeshBuilder, box, cylinder, ellipsoid, tube } from './lib/gltf.mjs';

const W = [255, 255, 255, 255];
const gray = (v) => [v, v, v, 255];

// ---- people ----
// A cartoon body in the proportions of a 3D platformer's hero: a big head, a round middle, short
// legs, big hands and shoes. 15 bones (the game's actor.c knows the indices). One material: an 8x4
// palette texture the game gives each person (skin, clothes, hair...), so one model makes every look;
// a part whose palette texel is transparent is not drawn (a cap, a beard, a hair style).
export const HUMAN_BONES = [
  { name: 'hips', parent: -1, head: [0, 0.78, 0] },
  { name: 'torso', parent: 0, head: [0, 0.84, 0] },
  { name: 'head', parent: 1, head: [0, 1.2, 0] },
  { name: 'arm_l', parent: 1, head: [0.27, 1.12, 0] },
  { name: 'fore_l', parent: 3, head: [0.31, 0.92, 0] },
  { name: 'hand_l', parent: 4, head: [0.32, 0.74, 0] },
  { name: 'arm_r', parent: 1, head: [-0.27, 1.12, 0] },
  { name: 'fore_r', parent: 6, head: [-0.31, 0.92, 0] },
  { name: 'hand_r', parent: 7, head: [-0.32, 0.74, 0] },
  { name: 'leg_l', parent: 0, head: [0.125, 0.74, 0] },
  { name: 'shin_l', parent: 9, head: [0.13, 0.43, 0] },
  { name: 'foot_l', parent: 10, head: [0.13, 0.13, 0] },
  { name: 'leg_r', parent: 0, head: [-0.125, 0.74, 0] },
  { name: 'shin_r', parent: 12, head: [-0.13, 0.43, 0] },
  { name: 'foot_r', parent: 13, head: [-0.13, 0.13, 0] },
];
// the palette's texels (src/actor.c fills them)
export const PAL = { SKIN: 0, SKIN2: 1, SHIRT: 2, SHIRT2: 3, PANTS: 4, SHOES: 5, SOLE: 6, HAIR: 7, HAT: 8, BRIM: 9, EYE: 10, PUPIL: 11, MOUTH: 12, BAND: 13, BELT: 14, BEARD: 15, AFRO: 16, LONG: 17, GLASSES: 18, BALD: 19 };
const texel = (k) => [((k % 8) + 0.5) / 8, (Math.floor(k / 8) + 0.5) / 4];
// baked light: a little darker underneath
const ao = (n) => { const v = Math.round(255 * (0.78 + 0.22 * n[1])); return [v, v, v, 255]; };

function buildCharacter(b, mat, o) {
  const E = (k, c, r, joint, x = {}) => ellipsoid(b, mat, c, r, { uv: texel(k), colorFn: ao, joint, segs: x.segs ?? o.segs, rings: x.rings ?? o.rings, from: x.from, to: x.to, rot: x.rot });
  const T = (k, a, c, r0, r1, joint, x = {}) => tube(b, mat, a, c, r0, r1, { uv: texel(k), colorFn: ao, joint, segs: x.segs ?? Math.max(5, o.segs - 2), capA: x.capA, capB: x.capB });
  const hs = o.head;          // head size
  const hy = 1.42;            // head centre
  // hips, belly, chest (a tank top / shirt over a round middle)
  E(PAL.PANTS, [0, 0.8, 0], [0.26, 0.15, 0.21], 0);
  if (!o.lite) E(PAL.BELT, [0, 0.885, 0.005], [0.255, 0.04, 0.205], 1, { segs: o.segs, rings: 2 });
  E(PAL.SHIRT, [0, 1.0, 0], [0.28 * o.body, 0.25, 0.23 * o.body], 1);
  if (!o.lite) E(PAL.SHIRT, [0, 0.95, 0.05], [0.24 * o.body, 0.18, 0.21 * o.body], 1, { rings: 4 });
  if (o.stripe) E(PAL.SHIRT2, [0, 1.1, 0.165], [0.11, 0.11, 0.05], 1, { segs: 6, rings: 3 }); // the number on the chest
  // shoulders (bare in a tank top, else sleeves)
  for (const sx of [1, -1]) E(o.tank ? PAL.SKIN : PAL.SHIRT, [sx * 0.245, 1.11, 0], [0.105, 0.095, 0.1], 1, { segs: 6, rings: 4 });
  // the head: skull, jaw, nose, ears, eyes, brows, mouth
  E(PAL.SKIN, [0, hy, 0.02], [0.245 * hs, 0.245 * hs, 0.235 * hs], 2);
  E(PAL.SKIN, [0, hy - 0.1 * hs, 0.08], [0.205 * hs, 0.13 * hs, 0.17 * hs], 2, { rings: 4 });
  E(PAL.SKIN2, [0, hy - 0.035, 0.235 * hs + 0.03], [0.072 * o.nose, 0.062 * o.nose, 0.07 * o.nose], 2, { segs: 7, rings: 4 });
  for (const sx of [1, -1]) {
    E(PAL.SKIN2, [sx * 0.24 * hs, hy, 0.0], [0.04, 0.064, 0.05], 2, { segs: 5, rings: o.lite ? 2 : 3 });
    E(PAL.EYE, [sx * 0.085, hy + 0.06, 0.2 * hs + 0.012], [0.058, 0.074, 0.035], 2, { segs: 6, rings: o.lite ? 3 : 4 });
    E(PAL.PUPIL, [sx * 0.078, hy + 0.055, 0.2 * hs + 0.044], [0.027, 0.038, 0.012], 2, { segs: 5, rings: 2 });
    T(PAL.HAIR, [sx * 0.13, hy + 0.155, 0.19 * hs], [sx * 0.04, hy + 0.165, 0.215 * hs], 0.018, 0.016, 2, { segs: 4 });
    if (o.glasses && !o.lite) E(PAL.GLASSES, [sx * 0.085, hy + 0.06, 0.2 * hs + 0.05], [0.07, 0.05, 0.012], 2, { segs: 6, rings: 3 });
  }
  E(PAL.MOUTH, [0, hy - 0.16 * hs, 0.2 * hs + 0.005], [0.06, 0.022, 0.025], 2, { segs: 6, rings: 3 });
  // facial hair: a moustache and a goatee (hidden by a clear BEARD texel)
  for (const sx of [1, -1]) E(PAL.BEARD, [sx * 0.058, hy - 0.105, 0.225 * hs + 0.025], [0.078, 0.032, 0.035], 2, { segs: o.lite ? 5 : 6, rings: o.lite ? 2 : 3, rot: sx * 0.35 });
  E(PAL.BEARD, [0, hy - 0.215 * hs, 0.16 * hs], [0.06, 0.05, 0.045], 2, { segs: 6, rings: 3 });
  // hair styles: short (round the back and sides), an afro, long (down the back); a cap over them
  E(PAL.HAIR, [0, hy + 0.03, -0.02], [0.255 * hs, 0.235 * hs, 0.245 * hs], 2, { from: 0.42 });
  if (o.styles) {
    E(PAL.AFRO, [0, hy + 0.1, -0.02], [0.32 * hs, 0.28 * hs, 0.31 * hs], 2, { from: 0.35 });
    E(PAL.LONG, [0, hy - 0.1, -0.12], [0.24 * hs, 0.3 * hs, 0.14 * hs], 2, { rings: 4 });
  }
  E(PAL.HAT, [0, hy + 0.1, 0.0], [0.265 * hs, 0.205 * hs, 0.26 * hs], 2, { from: 0.5 });
  E(PAL.BRIM, [0, hy + 0.115, 0.2 * hs + 0.04], [0.19, 0.028, 0.14], 2, { segs: 7, rings: 3 });
  if (o.emblem) E(PAL.SHIRT2, [0, hy + 0.19, 0.22 * hs], [0.075, 0.075, 0.025], 2, { segs: 6, rings: 3 }); // the crew's palm on the cap
  // arms: upper, fore (a band at the wrist), a big hand
  for (const [sx, up, fore, hand] of [[1, 3, 4, 5], [-1, 6, 7, 8]]) {
    T(o.tank ? PAL.SKIN : PAL.SHIRT, [sx * 0.27, 1.12, 0], [sx * 0.31, 0.92, 0], 0.07, 0.064, up, { capB: true });
    T(PAL.SKIN, [sx * 0.31, 0.92, 0], [sx * 0.32, 0.77, 0], 0.064, 0.058, fore);
    if (o.bands) T(PAL.BAND, [sx * 0.318, 0.8, 0], [sx * 0.32, 0.745, 0], 0.074, 0.074, fore, { segs: 6 });
    E(PAL.SKIN, [sx * 0.325, 0.69, 0.012], [0.088 * o.hands, 0.094 * o.hands, 0.098 * o.hands], hand, { segs: o.lite ? 6 : 7, rings: o.lite ? 3 : 5 });
    if (!o.lite) E(PAL.SKIN2, [sx * 0.29, 0.71, 0.075], [0.035, 0.05, 0.035], hand, { segs: 5, rings: 3 }); // the thumb
  }
  // legs: baggy trousers, big shoes with a sole
  for (const [sx, up, low, foot] of [[1, 9, 10, 11], [-1, 12, 13, 14]]) {
    T(PAL.PANTS, [sx * 0.125, 0.78, 0], [sx * 0.13, 0.43, 0], 0.115, 0.1, up);
    T(PAL.PANTS, [sx * 0.13, 0.45, 0], [sx * 0.13, 0.17, 0], 0.1, 0.108 * o.flare, low, { capA: true });
    E(PAL.SHOES, [sx * 0.13, 0.095, 0.06], [0.112 * o.feet, 0.088, 0.19 * o.feet], foot, { segs: o.lite ? 6 : 7, rings: o.lite ? 3 : 4 });
    if (!o.lite) E(PAL.SOLE, [sx * 0.13, 0.032, 0.06], [0.118 * o.feet, 0.034, 0.2 * o.feet], foot, { segs: 7, rings: 2 });
  }
}

function human(out) {
  const make = (name, o) => {
    const g = new Gltf();
    const mat = g.material('body', { texRef: true, texSize: [8, 4], layer: 'cutout', fog: true, prim: true });
    const b = new MeshBuilder();
    buildCharacter(b, mat, o);
    g.skinned(name, b, HUMAN_BONES);
    g.save(`${out}/${name}.glb`);
    return b.triangleCount;
  };
  // the hero: the biggest head, hands and shoes, a moustache, the crew's cap with its palm, a tank top
  const t0 = make('hero', { segs: 8, rings: 5, head: 1.08, body: 1.04, nose: 1.15, hands: 1.15, feet: 1.12, flare: 1.08, tank: true, bands: true, emblem: true, stripe: true, styles: false });
  // everyone else: the same body, simpler, with the hair styles and glasses
  const t1 = make('person', { lite: true, segs: 6, rings: 3, head: 1.0, body: 1.0, nose: 1.0, hands: 1.0, feet: 1.0, flare: 1.0, tank: false, bands: false, emblem: false, stripe: true, styles: true, glasses: true });
  // far away: a handful of boxes on the same bones and palette
  const g = new Gltf();
  const mat = g.material('body', { texRef: true, texSize: [8, 4], layer: 'cutout', fog: true, prim: true });
  const b = new MeshBuilder();
  const B = (k, min, max, joint) => { const uv = texel(k); const before = b.group(mat).uv.length; box(b, mat, min, max, { joint, color: [235, 235, 235, 255] }); const g2 = b.group(mat); for (let i = before; i < g2.uv.length; i += 2) { g2.uv[i] = uv[0]; g2.uv[i + 1] = uv[1]; } };
  B(PAL.PANTS, [-0.24, 0.68, -0.18], [0.24, 0.88, 0.18], 0);
  B(PAL.SHIRT, [-0.26, 0.86, -0.2], [0.26, 1.2, 0.2], 1);
  B(PAL.SKIN, [-0.22, 1.2, -0.2], [0.22, 1.64, 0.22], 2);
  B(PAL.HAIR, [-0.23, 1.5, -0.22], [0.23, 1.68, 0.2], 2);
  B(PAL.HAT, [-0.24, 1.58, -0.23], [0.24, 1.7, 0.33], 2);
  for (const [sx, up, fore, leg, shin] of [[1, 3, 4, 9, 10], [-1, 6, 7, 12, 13]]) {
    const x0 = sx > 0 ? 0.24 : -0.36, x1 = sx > 0 ? 0.36 : -0.24;
    B(PAL.SHIRT, [x0, 0.9, -0.06], [x1, 1.14, 0.06], up);
    B(PAL.SKIN, [x0, 0.62, -0.08], [x1, 0.92, 0.08], fore);
    const l0 = sx > 0 ? 0.03 : -0.23, l1 = sx > 0 ? 0.23 : -0.03;
    B(PAL.PANTS, [l0, 0.4, -0.1], [l1, 0.78, 0.1], leg);
    B(PAL.SHOES, [l0, 0.0, -0.1], [l1, 0.42, 0.22], shin);
  }
  g.skinned('person_lod', b, HUMAN_BONES);
  g.save(`${out}/person_lod.glb`);
  console.log(`people: hero ${t0}, person ${t1}, far ${b.triangleCount} triangles`);
  return 'human';
}

// ---- cars ----
export const CAR_BONES = [
  { name: 'body', parent: -1, head: [0, 0, 0] },
  { name: 'wheel_fl', parent: 0, head: [0.82, 0.34, 1.35] },
  { name: 'wheel_fr', parent: 0, head: [-0.82, 0.34, 1.35] },
  { name: 'wheel_rl', parent: 0, head: [0.82, 0.34, -1.35] },
  { name: 'wheel_rr', parent: 0, head: [-0.82, 0.34, -1.35] },
];

/**
 * A car body. s: { len, wid, h (roof), bed (pickup), cab (z range of the cabin), low (ride height),
 * wheelR, axle, lightbar, taxi, boxy (van) }
 */
function car(out, name, s) {
  const g = new Gltf();
  const paint = g.material('paint', { prim: true });
  const paint2 = g.material('paint2', { prim: true });
  const glass = g.material('glass', {});
  const dark = g.material('trim', {});
  const tire = g.material('tire', {});
  const lights = g.material('lights', {});
  const b = new MeshBuilder();
  const L = s.len / 2, Wd = s.wid / 2, low = s.low ?? 0.32, belt = low + (s.belt ?? 0.55), roof = s.h;
  const R = s.wheelR ?? 0.34, ax = s.axle ?? 1.35;
  const bones = CAR_BONES.map((bn, i) => (i === 0 ? bn : { ...bn, head: [Math.sign(bn.head[0]) * (Wd - 0.12), R, Math.sign(bn.head[2]) * ax] }));
  // the lower body: nose, middle, tail (a little lower at the ends), wheel arches as darker bands
  box(b, paint, [-Wd, low, -L], [Wd, belt, L], { color: gray(235) });
  box(b, paint, [-Wd + 0.05, belt, -L + 0.05], [Wd - 0.05, belt + 0.06, L - 0.05], { color: gray(250), faces: ['top', 'n', 's', 'e', 'w'] });
  // the cabin
  const [c0, c1] = s.cab || [-1.1, 0.6];
  if (s.boxy) {
    box(b, paint, [-Wd + 0.04, belt, c0], [Wd - 0.04, roof, c1], { color: gray(235) });
    box(b, glass, [-Wd + 0.02, belt + 0.12, c1 - 0.02], [Wd - 0.02, roof - 0.12, c1 + 0.01], { color: [80, 100, 120, 255], faces: ['s'] });
    for (const sx of [-1, 1]) box(b, glass, [sx * (Wd - 0.01) - 0.01, belt + 0.12, c1 - 1.2], [sx * (Wd - 0.01) + 0.01, roof - 0.15, c1 - 0.15], { color: [70, 90, 110, 255], faces: [sx > 0 ? 'e' : 'w'] });
  } else {
    const inset = 0.12;
    const yb = belt + 0.06, yt = roof;
    const P = [
      [-Wd + inset, yb, c0], [Wd - inset, yb, c0], [Wd - inset, yb, c1], [-Wd + inset, yb, c1], // base
      [-Wd + inset + 0.1, yt, c0 + 0.45], [Wd - inset - 0.1, yt, c0 + 0.45], [Wd - inset - 0.1, yt, c1 - 0.55], [-Wd + inset + 0.1, yt, c1 - 0.55], // roof
    ];
    const q = (a, bb, c, d, mat, col) => b.quad(mat, [P[a], P[bb], P[c], P[d]], { color: col });
    q(4, 7, 6, 5, paint, gray(245));                      // roof
    q(3, 2, 6, 7, glass, [90, 115, 140, 255]);            // windscreen (front, +z)
    q(1, 0, 4, 5, glass, [70, 90, 110, 255]);             // rear window
    q(2, 1, 5, 6, glass, [80, 100, 125, 255]);            // right side (-x)... (+x side)
    q(0, 3, 7, 4, glass, [80, 100, 125, 255]);
    // pillars between the side windows
    box(b, paint, [Wd - inset - 0.06, yb, (c0 + c1) / 2 - 0.05], [Wd - inset - 0.0, yt - 0.04, (c0 + c1) / 2 + 0.05], { color: gray(220) });
    box(b, paint, [-Wd + inset, yb, (c0 + c1) / 2 - 0.05], [-Wd + inset + 0.06, yt - 0.04, (c0 + c1) / 2 + 0.05], { color: gray(220) });
  }
  if (s.bed) {
    // a pickup's bed: walls round an open box behind the cabin
    box(b, dark, [-Wd + 0.1, belt - 0.2, -L + 0.1], [Wd - 0.1, belt - 0.19, c0], { color: [50, 50, 50, 255], faces: ['top'] });
  }
  if (s.two) box(b, paint2, [-Wd - 0.005, low + 0.12, c0], [Wd + 0.005, belt - 0.02, c1], { color: gray(240), faces: ['e', 'w'] });
  // bumpers, grille, lights
  box(b, dark, [-Wd + 0.02, low - 0.04, L - 0.02], [Wd - 0.02, low + 0.18, L + 0.08], { color: [60, 60, 64, 255] });
  box(b, dark, [-Wd + 0.02, low - 0.04, -L - 0.08], [Wd - 0.02, low + 0.18, -L + 0.02], { color: [60, 60, 64, 255] });
  box(b, dark, [-0.45, low + 0.22, L], [0.45, belt - 0.1, L + 0.01], { color: [40, 40, 44, 255], faces: ['s'] });
  for (const sx of [-1, 1]) {
    box(b, lights, [sx * (Wd - 0.38) - 0.17, belt - 0.24, L], [sx * (Wd - 0.38) + 0.17, belt - 0.08, L + 0.02], { color: [255, 250, 210, 255], faces: ['s'] });
    box(b, lights, [sx * (Wd - 0.3) - 0.15, belt - 0.22, -L - 0.02], [sx * (Wd - 0.3) + 0.15, belt - 0.08, -L], { color: [210, 30, 30, 255], faces: ['n'] });
  }
  // the underside, dark, so the car is not see-through from low angles
  box(b, dark, [-Wd + 0.1, low - 0.06, -L + 0.3], [Wd - 0.1, low, L - 0.3], { color: [30, 30, 30, 255], faces: ['bottom'] });
  if (s.lightbar) {
    box(b, dark, [-0.55, roof, -0.15 + (c0 + c1) / 2], [0.55, roof + 0.06, 0.15 + (c0 + c1) / 2], { color: [40, 40, 40, 255] });
    box(b, lights, [-0.55, roof + 0.06, -0.12 + (c0 + c1) / 2], [-0.02, roof + 0.16, 0.12 + (c0 + c1) / 2], { color: [230, 30, 30, 255] });
    box(b, lights, [0.02, roof + 0.06, -0.12 + (c0 + c1) / 2], [0.55, roof + 0.16, 0.12 + (c0 + c1) / 2], { color: [30, 60, 230, 255] });
  }
  if (s.taxi) box(b, lights, [-0.3, roof, -0.1 + (c0 + c1) / 2], [0.3, roof + 0.18, 0.1 + (c0 + c1) / 2], { color: [255, 220, 80, 255] });
  // wheels: octagonal cylinders across x, one bone each (they roll and steer)
  for (let k = 1; k <= 4; k++) {
    const [hx, hy, hz] = bones[k].head;
    const sx = Math.sign(hx);
    const n = 8, w = 0.24;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p = (a, x) => [hx + x, hy + Math.sin(a) * R, hz + Math.cos(a) * R];
      const xo = sx * w / 2, xi = -sx * w / 2;
      b.quad(tire, sx > 0 ? [p(a0, xo), p(a1, xo), p(a1, xi), p(a0, xi)] : [p(a0, xi), p(a1, xi), p(a1, xo), p(a0, xo)], { color: [40, 40, 40, 255], joint: k });
      // the hub (outer face)
      b.triangle(tire, sx > 0 ? [[hx + xo, hy, hz], p(a1, xo), p(a0, xo)] : [[hx + xo, hy, hz], p(a0, xo), p(a1, xo)], { color: (i % 2) ? [170, 170, 175, 255] : [120, 120, 125, 255], joint: k });
    }
  }
  g.skinned(name, b, bones);
  g.save(`${out}/${name}.glb`);
  return { name, len: s.len, wid: s.wid, h: s.h, axle: ax, wheelR: R };
}

// ---- bikes ----
export const BIKE_BONES = [
  { name: 'body', parent: -1, head: [0, 0, 0] },
  { name: 'fork', parent: 0, head: [0, 0.35, 0.62] },
  { name: 'wheel_f', parent: 1, head: [0, 0.35, 0.62] },
  { name: 'wheel_r', parent: 0, head: [0, 0.35, -0.55] },
];
function bike(out, name, motor) {
  const g = new Gltf();
  const paint = g.material('paint', { prim: true });
  const dark = g.material('trim', {});
  const tire = g.material('tire', {});
  const b = new MeshBuilder();
  const R = motor ? 0.33 : 0.3, fz = motor ? 0.72 : 0.55, rz = motor ? -0.68 : -0.5;
  const bones = [BIKE_BONES[0], { ...BIKE_BONES[1], head: [0, R, fz] }, { ...BIKE_BONES[2], head: [0, R, fz] }, { ...BIKE_BONES[3], head: [0, R, rz] }];
  if (motor) {
    box(b, paint, [-0.18, 0.45, -0.3], [0.18, 0.78, 0.45], { color: gray(235) });     // tank and body
    box(b, dark, [-0.16, 0.25, -0.25], [0.16, 0.5, 0.3], { color: [70, 70, 75, 255] }); // engine
    box(b, dark, [-0.14, 0.78, -0.55], [0.14, 0.86, 0.05], { color: [40, 40, 40, 255] }); // seat
    box(b, paint, [-0.12, 0.6, -0.8], [0.12, 0.72, -0.4], { color: gray(225) });       // tail
    box(b, dark, [0.12, 0.3, -0.75], [0.2, 0.4, -0.1], { color: [150, 150, 155, 255] }); // exhaust
    box(b, dark, [-0.04, R, fz - 0.06], [0.04, 0.95, fz + 0.02], { color: [150, 150, 155, 255], joint: 1 }); // fork
    box(b, dark, [-0.38, 0.95, fz - 0.12], [0.38, 0.99, fz - 0.08], { color: [50, 50, 50, 255], joint: 1 });  // bars
    box(b, paint, [-0.12, 0.8, fz - 0.05], [0.12, 1.0, fz + 0.08], { color: gray(240), joint: 1 });        // headlight cowl
  } else {
    box(b, paint, [-0.03, 0.4, -0.45], [0.03, 0.46, 0.5], { color: gray(235) });        // top tube
    box(b, paint, [-0.03, R, -0.1], [0.03, 0.45, -0.04], { color: gray(235) });          // seat tube
    box(b, paint, [-0.03, R - 0.02, -0.5], [0.03, R + 0.04, 0.0], { color: gray(225) }); // chain stay
    box(b, dark, [-0.08, 0.62, -0.25], [0.08, 0.66, -0.05], { color: [30, 30, 30, 255] }); // seat
    box(b, dark, [-0.02, 0.45, -0.18], [0.02, 0.62, -0.12], { color: [120, 120, 120, 255] });
    box(b, dark, [-0.03, R, fz - 0.03], [0.03, 0.78, fz + 0.03], { color: [150, 150, 155, 255], joint: 1 });
    box(b, dark, [-0.3, 0.78, fz - 0.06], [0.3, 0.82, fz - 0.02], { color: [50, 50, 50, 255], joint: 1 });
  }
  for (const [k, z] of [[2, fz], [3, rz]]) {
    const n = 10, w = motor ? 0.14 : 0.06;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const p = (a, x) => [x, R + Math.sin(a) * R, z + Math.cos(a) * R];
      b.quad(tire, [p(a0, w / 2), p(a1, w / 2), p(a1, -w / 2), p(a0, -w / 2)], { color: [40, 40, 40, 255], joint: k });
      b.triangle(tire, [[w / 2, R, z], p(a1, w / 2), p(a0, w / 2)], { color: [150, 150, 150, 255], joint: k });
      b.triangle(tire, [[-w / 2, R, z], p(a0, -w / 2), p(a1, -w / 2)], { color: [150, 150, 150, 255], joint: k });
    }
  }
  g.skinned(name, b, bones);
  g.save(`${out}/${name}.glb`);
  return name;
}

// ---- weapons (held in the right hand: the grip at the origin, the barrel along +z) ----
function weapons(out) {
  const names = [];
  const mk = (name, fn) => { const g = new Gltf(); const b = new MeshBuilder(); fn(b, (n, o = {}) => g.material(n, o)); g.mesh(name, b); g.save(`${out}/${name}.glb`); names.push(name); };
  const metal = [70, 72, 78, 255], wood = [130, 90, 55, 255];
  mk('w_pistol', (b, m) => { box(b, m('gun'), [-0.02, 0.0, -0.02], [0.02, 0.1, 0.03], { color: metal }); box(b, m('gun'), [-0.022, 0.08, -0.04], [0.022, 0.12, 0.17], { color: metal }); });
  mk('w_smg', (b, m) => { box(b, m('gun'), [-0.025, 0.0, -0.02], [0.025, 0.12, 0.03], { color: metal }); box(b, m('gun'), [-0.03, 0.08, -0.12], [0.03, 0.14, 0.26], { color: metal }); box(b, m('gun'), [-0.015, -0.12, 0.06], [0.015, 0.08, 0.1], { color: [40, 40, 44, 255] }); });
  mk('w_shotgun', (b, m) => { box(b, m('gun'), [-0.03, 0.04, -0.35], [0.03, 0.11, 0.0], { color: wood }); box(b, m('gun'), [-0.025, 0.08, -0.02], [0.025, 0.13, 0.6], { color: metal }); box(b, m('gun'), [-0.03, 0.03, 0.15], [0.03, 0.08, 0.38], { color: wood }); });
  mk('w_rifle', (b, m) => { box(b, m('gun'), [-0.03, 0.03, -0.32], [0.03, 0.12, 0.0], { color: wood }); box(b, m('gun'), [-0.03, 0.07, -0.02], [0.03, 0.14, 0.42], { color: metal }); box(b, m('gun'), [-0.02, 0.09, 0.4], [0.02, 0.12, 0.62], { color: metal }); box(b, m('gun'), [-0.02, -0.1, 0.06], [0.02, 0.07, 0.13], { color: metal }); });
  mk('w_bat', (b, m) => { cylinder(b, m('gun'), 0, 0, -0.05, 0.85, 0.022, 6, { color: wood, rTop: 0.04 }); });
  mk('w_launcher', (b, m) => { cylinder(b, m('gun'), 0, 0, -0.5, 0.7, 0.07, 8, { color: [70, 90, 60, 255] }); box(b, m('gun'), [-0.02, -0.12, 0.0], [0.02, 0.0, 0.05], { color: metal }); });
  // (cylinders above stand along y: the game turns the bat and the launcher into the hand)
  return names;
}

// ---- pickups and effects ----
function misc(out) {
  const names = [];
  const mk = (name, fn) => { const g = new Gltf(); const b = new MeshBuilder(); fn(b, (n, o = {}) => g.material(n, o)); g.mesh(name, b); g.save(`${out}/${name}.glb`); names.push(name); };
  mk('p_health', (b, m) => { box(b, m('pk'), [-0.3, 0, -0.3], [0.3, 0.6, 0.3], { color: [240, 240, 240, 255] }); box(b, m('pk'), [-0.31, 0.24, -0.08], [0.31, 0.36, 0.08], { color: [220, 30, 30, 255] }); box(b, m('pk'), [-0.08, 0.24, -0.31], [0.08, 0.36, 0.31], { color: [220, 30, 30, 255] }); box(b, m('pk'), [-0.08, 0.12, -0.08], [0.08, 0.61, 0.08], { color: [220, 30, 30, 255] }); });
  mk('p_armor', (b, m) => { box(b, m('pk'), [-0.3, 0, -0.12], [0.3, 0.6, 0.12], { color: [50, 80, 160, 255] }); box(b, m('pk'), [-0.12, 0.6, -0.1], [0.12, 0.66, 0.1], { color: [40, 60, 130, 255] }); });
  mk('p_cash', (b, m) => { box(b, m('pk'), [-0.25, 0, -0.12], [0.25, 0.16, 0.12], { color: [80, 170, 80, 255] }); box(b, m('pk'), [-0.05, 0.0, -0.125], [0.05, 0.161, 0.125], { color: [230, 230, 200, 255] }); });
  // a ring that marks places (missions, the save house): a hollow cylinder, transparent
  mk('marker', (b, m) => { cylinder(b, m('mk', { layer: 'blend', cull: false, prim: true }), 0, 0, 0, 0.7, 0.9, 12, { color: [255, 255, 255, 120], cap: false }); });
  // the blob shadow under people and cars: a dark disc (alpha blended)
  mk('shadow', (b, m) => { const mm = m('shadow', { layer: 'blend', fog: false }); const n = 12; for (let i = 0; i < n; i++) { const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2; b.triangle(mm, [[0, 0, 0], [Math.sin(a0), 0, Math.cos(a0)], [Math.sin(a1), 0, Math.cos(a1)]], { colors: [[0, 0, 0, 150], [0, 0, 0, 0], [0, 0, 0, 0]] }); } });
  // particles: a unit cube (tinted by prim colour: smoke, fire, sparks, blood, debris)
  mk('fx_cube', (b, m) => box(b, m('fx', { prim: true }), [-0.5, -0.5, -0.5], [0.5, 0.5, 0.5], { color: W }));
  mk('fx_flash', (b, m) => { const mm = m('flash', { prim: true, cull: false, fog: false }); for (const a of [0, Math.PI / 3, -Math.PI / 3]) b.quad(mm, [[0, -0.06, 0], [Math.sin(a) * 0.15, 0.08 * Math.cos(a), 0.3], [0, 0.06, 0.4], [-Math.sin(a) * 0.15, -0.08 * Math.cos(a), 0.3]], { color: W }); });
  // a tracer: a thin box along +z, length 1 (scaled)
  mk('fx_tracer', (b, m) => box(b, m('tracer', { prim: true, fog: false }), [-0.015, -0.015, 0], [0.015, 0.015, 1], { color: W, shadeSides: false }));
  // the sea: one 64 m tile, drawn round the camera
  mk('water', (b, m) => { const mm = m('water', { tex: 'water.png', layer: 'blend' }); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const x = -32 + i * 16, z = -32 + j * 16; b.quad(mm, [[x, 0, z], [x, 0, z + 16], [x + 16, 0, z + 16], [x + 16, 0, z]], { color: [255, 255, 255, 200], uv: [[0, 0], [0, 4], [4, 4], [4, 0]] }); } });
  // the sky: a dome of colour bands (drawn first, around the camera, without fog)
  mk('sky', (b, m) => {
    const mm = m('sky', { fog: false, cull: false });
    const R = 430, rings = [[0, [196, 220, 238]], [0.12, [160, 200, 232]], [0.35, [110, 162, 220]], [0.7, [70, 120, 200]], [1.0, [52, 96, 180]]];
    const n = 16;
    for (let k = 0; k < rings.length - 1; k++) {
      const [e0, c0] = rings[k], [e1, c1] = rings[k + 1];
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
        const P = (a, e) => [Math.sin(a) * Math.cos(e * Math.PI / 2) * R, Math.sin(e * Math.PI / 2) * R * 0.5 - 20, Math.cos(a) * Math.cos(e * Math.PI / 2) * R];
        b.quad(mm, [P(a0, e0), P(a1, e0), P(a1, e1), P(a0, e1)], { colors: [[...c0, 255], [...c0, 255], [...c1, 255], [...c1, 255]] });
      }
    }
    // below the horizon: the haze colour, so the sea's far edge melts in
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      b.quad(mm, [[Math.sin(a0) * R, -120, Math.cos(a0) * R], [Math.sin(a1) * R, -120, Math.cos(a1) * R], [Math.sin(a1) * R, -20, Math.cos(a1) * R], [Math.sin(a0) * R, -20, Math.cos(a0) * R]], { color: [196, 220, 238, 255] });
    }
  });
  return names;
}

export function writeModels(out) {
  const list = [human(out)];
  // car bodies (the game's vehicle table picks one, with its paint and handling)
  list.push(car(out, 'car_sedan', { len: 4.5, wid: 1.85, h: 1.42, cab: [-1.2, 0.75] }).name);
  list.push(car(out, 'car_lowrider', { len: 5.2, wid: 1.95, h: 1.3, low: 0.22, belt: 0.5, cab: [-1.5, 0.5], axle: 1.6 }).name);
  list.push(car(out, 'car_pickup', { len: 5.0, wid: 1.95, h: 1.75, low: 0.42, belt: 0.62, cab: [-0.4, 1.0], bed: true, axle: 1.55, wheelR: 0.38 }).name);
  list.push(car(out, 'car_van', { len: 4.8, wid: 1.95, h: 2.1, low: 0.38, cab: [-2.3, 1.7], boxy: true, axle: 1.55, wheelR: 0.36 }).name);
  list.push(car(out, 'car_sports', { len: 4.3, wid: 1.9, h: 1.18, low: 0.24, belt: 0.45, cab: [-1.0, 0.45], axle: 1.35, wheelR: 0.33 }).name);
  list.push(car(out, 'car_police', { len: 4.6, wid: 1.85, h: 1.45, cab: [-1.2, 0.75], lightbar: true, two: true }).name);
  list.push(car(out, 'car_taxi', { len: 4.5, wid: 1.85, h: 1.42, cab: [-1.2, 0.75], taxi: true }).name);
  list.push(bike(out, 'bike_bmx', false), bike(out, 'bike_motor', true));
  list.push(...weapons(out), ...misc(out));
  return list;
}
