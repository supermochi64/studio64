// The game's models, made from boxes: people, cars and bikes, weapons, pickups, effects, sky, water.
//
// People and vehicles are skinned on a few bones (every vertex follows one bone), so the game poses
// them by code (walk cycles, steering, spinning wheels) without animation data. Their parts have
// materials with a "prim" tint (shirt, pants, paint...): the game sets the colour per character or
// car, so one model makes every look. To replace a model, put a .glb with the same bone and material
// names in assets/ (made in Blender with fast64): see docs/sandbox.md.
import { Gltf, MeshBuilder, box, cylinder } from './lib/gltf.mjs';

const W = [255, 255, 255, 255];
const gray = (v) => [v, v, v, 255];

// ---- people ----
// bones (the game's actor.c knows these indices)
export const HUMAN_BONES = [
  { name: 'hips', parent: -1, head: [0, 0.95, 0] },
  { name: 'torso', parent: 0, head: [0, 1.02, 0] },
  { name: 'head', parent: 1, head: [0, 1.52, 0] },
  { name: 'arm_l', parent: 1, head: [0.23, 1.44, 0] },
  { name: 'fore_l', parent: 3, head: [0.23, 1.16, 0] },
  { name: 'arm_r', parent: 1, head: [-0.23, 1.44, 0] },
  { name: 'fore_r', parent: 5, head: [-0.23, 1.16, 0] },
  { name: 'leg_l', parent: 0, head: [0.1, 0.92, 0] },
  { name: 'shin_l', parent: 7, head: [0.1, 0.5, 0] },
  { name: 'leg_r', parent: 0, head: [-0.1, 0.92, 0] },
  { name: 'shin_r', parent: 9, head: [-0.1, 0.5, 0] },
];

function human(out) {
  const g = new Gltf();
  const tint = (name) => g.material(name, { prim: true, fog: true });
  const skin = tint('skin'), shirt = tint('shirt'), pants = tint('pants'), shoes = tint('shoes'), hair = tint('hair'), hat = tint('hat');
  const eyes = g.material('eyes', {});
  const b = new MeshBuilder();
  const bx = (mat, min, max, joint, shade = 1) => box(b, mat, min, max, { joint, color: gray(Math.round(235 * shade)) });
  // hips and torso (shirt), a belt line of pants
  bx(pants, [-0.17, 0.86, -0.11], [0.17, 1.02, 0.11], 0);
  bx(shirt, [-0.19, 1.0, -0.12], [0.19, 1.46, 0.12], 1);
  bx(shirt, [-0.21, 1.36, -0.13], [0.21, 1.48, 0.13], 1, 1.05); // shoulders
  // head, hair, face
  bx(skin, [-0.05, 1.46, -0.05], [0.05, 1.53, 0.05], 2, 0.9); // neck
  bx(skin, [-0.12, 1.52, -0.12], [0.12, 1.8, 0.13], 2);
  bx(hair, [-0.13, 1.72, -0.13], [0.13, 1.83, 0.12], 2);
  bx(hair, [-0.13, 1.56, -0.135], [0.13, 1.76, -0.08], 2, 0.9);
  box(b, eyes, [0.04, 1.66, 0.13], [0.08, 1.69, 0.135], { joint: 2, color: [30, 30, 30, 255], faces: ['s'] });
  box(b, eyes, [-0.08, 1.66, 0.13], [-0.04, 1.69, 0.135], { joint: 2, color: [30, 30, 30, 255], faces: ['s'] });
  bx(skin, [-0.03, 1.6, 0.13], [0.03, 1.66, 0.165], 2, 0.85); // nose
  // a cap (drawn only for looks with one: the game skips this material)
  bx(hat, [-0.135, 1.78, -0.135], [0.135, 1.88, 0.135], 2);
  bx(hat, [-0.12, 1.78, 0.12], [0.12, 1.8, 0.27], 2, 0.9);
  // arms: sleeve, skin, hand
  for (const [s, up, fore] of [[1, 3, 4], [-1, 5, 6]]) {
    const x0 = s > 0 ? 0.19 : -0.27, x1 = s > 0 ? 0.27 : -0.19;
    bx(shirt, [x0, 1.18, -0.06], [x1, 1.47, 0.06], up);
    bx(skin, [x0 + 0.005, 0.9, -0.05], [x1 - 0.005, 1.18, 0.05], fore);
    bx(skin, [x0, 0.82, -0.05], [x1, 0.91, 0.06], fore, 0.92);
  }
  // legs: pants, shoes
  for (const [s, up, low] of [[1, 7, 8], [-1, 9, 10]]) {
    const x0 = s > 0 ? 0.015 : -0.185, x1 = s > 0 ? 0.185 : -0.015;
    bx(pants, [x0, 0.5, -0.09], [x1, 0.92, 0.09], up);
    bx(pants, [x0 + 0.01, 0.1, -0.08], [x1 - 0.01, 0.52, 0.08], low, 0.95);
    bx(shoes, [x0 - 0.005, 0.0, -0.09], [x1 + 0.005, 0.11, 0.16], low);
  }
  g.skinned('human', b, HUMAN_BONES);
  g.save(`${out}/human.glb`);
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
