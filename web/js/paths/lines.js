// Roads & nature: things along a line. Fences, railings, walls, hedges, bollards, lamps and kerbs,
// built from runs of ground points (a freestanding line, or the side of a road). Every style has
// collision: fences are two-sided walls, walls/hedges/kerbs are solid (Mario can stand on them),
// bollards and lamp posts are small posts.

import { Mesh, V, MAT, box, prism, segBox, SURF } from './mesh.js';
import * as T from './textures.js';
import { clamp, lerp, hash2 } from './geom.js';

// The styles, in the order of the panel.
export const LINE_STYLES = {
  picket:    { label: 'Picket fence', group: 'Fences', h: 110, spacing: 128, icon: '#f2f0ea' },
  rustic:    { label: 'Rustic fence', group: 'Fences', h: 105, spacing: 180, icon: '#8a5a32' },
  iron:      { label: 'Castle iron fence', group: 'Fences', h: 150, spacing: 256, icon: '#2c2c34' },
  chain:     { label: 'Chain-link fence', group: 'Fences', h: 150, spacing: 220, icon: '#b8bcc4' },
  bamboo:    { label: 'Bamboo fence', group: 'Fences', h: 125, spacing: 170, icon: '#c8c060' },
  railing:   { label: 'Railing', group: 'Rails & walls', h: 100, spacing: 170, icon: '#9aa0a8' },
  guardrail: { label: 'Guard rail', group: 'Rails & walls', h: 78, spacing: 220, icon: '#c8ccd2' },
  wall:      { label: 'Low stone wall', group: 'Rails & walls', h: 90, solid: true, icon: '#9a948a' },
  hedge:     { label: 'Hedge', group: 'Rails & walls', h: 120, solid: true, icon: '#3d7a34' },
  kerb:      { label: 'Kerb', group: 'Rails & walls', h: 22, solid: true, icon: '#d0ccc4' },
  bollards:  { label: 'Bollards', group: 'Posts', h: 75, spacing: 170, icon: '#40424a' },
  lamps:     { label: 'Street lamps', group: 'Posts', h: 330, spacing: 640, icon: '#f6d36b' },
  posts:     { label: 'Wooden posts', group: 'Posts', h: 105, spacing: 240, icon: '#9a6a3a' },
};
export const LINE_IDS = Object.keys(LINE_STYLES);

const shadeC = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// A polyline run -> points every `spacing` (evenly), with their tangent.
function postsAlong(pts, spacing) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
  const total = cum[cum.length - 1];
  if (total < 1) return [];
  const n = Math.max(1, Math.round(total / spacing));
  const out = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = (total * k) / n;
    while (j < pts.length - 2 && cum[j + 1] < s) j++;
    const a = pts[j], b = pts[j + 1];
    const f = cum[j + 1] > cum[j] ? (s - cum[j]) / (cum[j + 1] - cum[j]) : 0;
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    out.push({ p: [lerp(a[0], b[0], f), lerp(a[1], b[1], f), lerp(a[2], b[2], f)], t: [(b[0] - a[0]) / L, (b[2] - a[2]) / L], s });
  }
  return out;
}

// Extrude a cross-section along a run. profile: [[across, up], ...] from one bottom edge over the
// top to the other. Returns nothing; adds drawing and (optionally) solid collision.
export function extrude(mesh, key, pts, profile, { col = [255, 255, 255], uvScale = 64, collision = true, caps = true, surface = 0, shadeBottom = 0.72, closedLoop = false } = {}) {
  if (pts.length < 2) return;
  // frames with mitred corners
  const fr = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[2] - a[2];
    const L = Math.hypot(tx, tz) || 1;
    tx /= L; tz /= L;
    let k = 1;
    if (i > 0 && i < pts.length - 1) {
      const d0 = [p[0] - a[0], p[2] - a[2]], l0 = Math.hypot(...d0) || 1;
      const cosHalf = (d0[0] / l0) * tx + (d0[1] / l0) * tz;
      k = 1 / clamp(cosHalf, 0.5, 1);
    }
    return { p, r: [-tz * k, tx * k], t: [tx, tz] };
  });
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
  const at = (f, q) => [f.p[0] + f.r[0] * q[0], f.p[1] + q[1], f.p[2] + f.r[1] * q[0]];
  const hMax = Math.max(...profile.map((q) => q[1])) || 1;
  const vcol = (q) => shadeC(col, shadeBottom + (1 - shadeBottom) * clamp(q[1] / hMax, 0, 1));
  // perimeter distance along the profile for v
  const per = [0];
  for (let k = 1; k < profile.length; k++) per.push(per[k - 1] + Math.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]));
  for (let i = 0; i + 1 < fr.length; i++) {
    const A = fr[i], B = fr[i + 1];
    for (let k = 0; k + 1 < profile.length; k++) {
      const q0 = profile[k], q1 = profile[k + 1];
      const a = at(A, q0), b = at(B, q0), c = at(B, q1), d = at(A, q1);
      // outward: perpendicular to the profile edge, in the cross-section plane
      const ex = q1[0] - q0[0], ey = q1[1] - q0[1];
      const no = [-ey, ex]; // the profile runs up the left side, over the top, down the right: outward is to its left
      const fa = [(A.r[0] + B.r[0]) / 2, (A.r[1] + B.r[1]) / 2];
      const face = [fa[0] * no[0], no[1], fa[1] * no[0]];
      const u0 = cum[i] / uvScale, u1 = cum[i + 1] / uvScale, v0 = per[k] / uvScale, v1 = per[k + 1] / uvScale;
      mesh.quad(key, V(a, [u0, v0], vcol(q0)), V(b, [u1, v0], vcol(q0)), V(c, [u1, v1], vcol(q1)), V(d, [u0, v1], vcol(q1)), face);
      if (collision) mesh.colQuad(a, b, c, d, Math.abs(no[1]) > Math.abs(no[0]) ? surface : 0, face);
    }
  }
  if (caps && !closedLoop) {
    for (const [f, dir] of [[fr[0], -1], [fr[fr.length - 1], 1]]) {
      const face = [f.t[0] * dir, 0, f.t[1] * dir];
      const c0 = at(f, profile[0]);
      for (let k = 1; k + 1 < profile.length; k++) {
        const b = at(f, profile[k]), c = at(f, profile[k + 1]);
        mesh.tri(key, V(c0, [profile[0][0] / uvScale, profile[0][1] / uvScale], vcol(profile[0])), V(b, [profile[k][0] / uvScale, profile[k][1] / uvScale], vcol(profile[k])), V(c, [profile[k + 1][0] / uvScale, profile[k + 1][1] / uvScale], vcol(profile[k + 1])), face);
        if (collision) mesh.colTri(c0, b, c, 0, face);
      }
      if (collision) {
        // the bottom edge of the cap reaches down to the ground
      }
    }
  }
}

// A flat panel (fence infill) between two posts: a cut-out texture, both sides.
function panel(mesh, key, a, b, y0, h, texLen) {
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const u = L / texLen;
  const p = [[a[0], a[1] + y0, a[2]], [b[0], b[1] + y0, b[2]], [b[0], b[1] + y0 + h, b[2]], [a[0], a[1] + y0 + h, a[2]]];
  const nrm = [-(b[2] - a[2]), 0, b[0] - a[0]];
  mesh.quad(key, V(p[0], [0, 1], [235, 235, 235]), V(p[1], [u, 1], [235, 235, 235]), V(p[2], [u, 0]), V(p[3], [0, 0]), nrm);
}

// Two-sided wall collision between two ground points.
function fenceWall(mesh, a, b, h) {
  mesh.colWall([a[0], a[1] - 30, a[2]], [b[0], b[1] - 30, b[2]], [b[0], b[1] + h, b[2]], [a[0], a[1] + h, a[2]]);
}

// A small solid post collision (box walls) around p.
function postCollision(mesh, p, r, h) {
  const c = [[-r, -r], [r, -r], [r, r], [-r, r]].map(([x, z]) => [p[0] + x, p[1], p[2] + z]);
  for (let i = 0; i < 4; i++) {
    const a = c[i], b = c[(i + 1) % 4];
    const out = [(a[0] + b[0]) / 2 - p[0], 0, (a[2] + b[2]) / 2 - p[2]];
    mesh.colQuad([a[0], a[1] - 30, a[2]], [b[0], b[1] - 30, b[2]], [b[0], b[1] + h, b[2]], [a[0], a[1] + h, a[2]], 0, out);
  }
  mesh.colQuad([c[0][0], p[1] + h, c[0][2]], [c[1][0], p[1] + h, c[1][2]], [c[2][0], p[1] + h, c[2][2]], [c[3][0], p[1] + h, c[3][2]], 0, [0, 1, 0]);
}

function materials(mesh, style) {
  mesh.mat('wood', T.planks(), 0);
  mesh.mat('white', null, 0);
  mesh.mat('bark', T.bark(), 0);
  mesh.mat('metal', T.metal(), 0);
  mesh.mat('stone', T.stoneWall(), 0);
  mesh.mat('curb', T.curbStone(), 0);
  mesh.mat('leaf', T.leaves(), 0);
  mesh.mat('glow', null, MAT.UNLIT);
  if (style === 'picket') mesh.mat('picket', T.picket(), MAT.CUTOUT | MAT.DOUBLE);
  if (style === 'iron') mesh.mat('iron', T.ironBars(), MAT.CUTOUT | MAT.DOUBLE);
  if (style === 'chain') mesh.mat('chain', T.chainLink(), MAT.CUTOUT | MAT.DOUBLE);
  if (style === 'bamboo') mesh.mat('bamboo', T.bamboo(), MAT.CUTOUT | MAT.DOUBLE);
}

// A gate in a gap: two leaves standing open (decoration, Mario walks through).
function gate(mesh, style, a, b, h) {
  const tex = { picket: 'picket', iron: 'iron', chain: 'chain', bamboo: 'bamboo' }[style];
  const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1;
  const half = L / 2;
  for (const [p, sgn] of [[a, 1], [b, -1]]) {
    // hinge at p, opened 65 degrees outward (to the right of the line)
    const ang = Math.atan2(dz * sgn, dx * sgn) + 1.13 * sgn;
    const q = [p[0] + Math.cos(ang) * half, p[1], p[2] + Math.sin(ang) * half];
    if (tex) panel(mesh, tex, p, q, 4, h - 10, 64);
    else { box(mesh, 'wood', segBox(p, q, 4, h - 20, h - 20, 20, 20), { col: [190, 140, 90], uvScale: 48 }); }
    // the gate post is a bit taller
    prism(mesh, style === 'iron' ? 'stone' : 'wood', p, { n: 4, r0: 13, r1: 13, h: h + 24, col: style === 'iron' ? [210, 205, 196] : [200, 150, 100], rot: Math.PI / 4, uvScale: 40 });
    postCollision(mesh, p, 12, h + 24);
  }
}

// Build a line style along runs: [{ pts: [[x, y, z], ...], gates: [[a, b], ...] }].
// `scale` multiplies the height. Adds to `mesh`.
export function buildLine(mesh, style, runs, { scale = 1, color = null } = {}) {
  const S = LINE_STYLES[style];
  if (!S) return;
  materials(mesh, style);
  const h = S.h * scale;
  for (const run of runs) {
    const pts = run.pts;
    if (pts.length < 2) { if (run.gates) for (const g of run.gates) gate(mesh, style, g[0], g[1], h); continue; }
    if (S.solid) { solid(mesh, style, pts, h, color, run.closed); }
    else {
      const posts = postsAlong(pts, S.spacing * (style === 'lamps' ? 1 : Math.min(1.2, Math.max(0.8, scale))));
      fence(mesh, style, posts, h, color, pts);
    }
    for (const g of run.gates || []) gate(mesh, style, g[0], g[1], h);
  }
}

function solid(mesh, style, pts, h, color, closedLoop) {
  if (style === 'wall') {
    const w = 26;
    extrude(mesh, 'stone', pts, [[-w, -24], [-w, h - 10], [w, h - 10], [w, -24]], { col: color || [228, 224, 214], uvScale: 64, shadeBottom: 0.66, closedLoop });
    extrude(mesh, 'stone', pts, [[-w - 5, h - 12], [-w - 5, h], [w + 5, h], [w + 5, h - 12]], { col: [250, 246, 236], uvScale: 40, collision: true, closedLoop });
  } else if (style === 'hedge') {
    const w = 44;
    extrude(mesh, 'leaf', pts, [[-w + 4, -20], [-w, h * 0.55], [-w + 8, h - 10], [-w + 22, h], [w - 22, h], [w - 8, h - 10], [w, h * 0.55], [w - 4, -20]],
      { col: color || [74, 140, 58], uvScale: 56, shadeBottom: 0.55, closedLoop });
  } else if (style === 'kerb') {
    const w = 13;
    extrude(mesh, 'curb', pts, [[-w, -16], [-w, h - 3], [-w + 3, h], [w - 3, h], [w, h - 3], [w, -16]], { col: color || [240, 238, 232], uvScale: 48, shadeBottom: 0.7, closedLoop });
  }
}

function fence(mesh, style, posts, h, color, pts) {
  const P = posts.map((x) => x.p);
  const wood = color || [214, 160, 104];
  const postCol = (c) => c;
  const bottomDark = (c) => shadeC(c, 0.8);
  for (let i = 0; i < posts.length; i++) {
    const p = P[i];
    const rot = Math.atan2(posts[i].t[1], posts[i].t[0]);
    switch (style) {
      case 'picket':
        prism(mesh, 'white', p, { n: 4, r0: 10, r1: 10, h: h + 8, col: color || [244, 244, 238], rot: rot + Math.PI / 4, uvScale: 64 });
        break;
      case 'rustic':
        prism(mesh, 'bark', [p[0], p[1] - 10, p[2]], { n: 6, r0: 11, r1: 9, h: h + 12, col: [150, 104, 64], rot, uvScale: 48, topCol: [200, 160, 110] });
        break;
      case 'iron':
        box(mesh, 'stone', segBox([p[0] - posts[i].t[0] * 18, p[1] - 20, p[2] - posts[i].t[1] * 18], [p[0] + posts[i].t[0] * 18, p[1] - 20, p[2] + posts[i].t[1] * 18], 18, h + 40, h + 40), { col: [226, 220, 210], uvScale: 48 });
        box(mesh, 'stone', segBox([p[0] - posts[i].t[0] * 22, p[1] + h + 20, p[2] - posts[i].t[1] * 22], [p[0] + posts[i].t[0] * 22, p[1] + h + 20, p[2] + posts[i].t[1] * 22], 22, 10, 10), { col: [246, 240, 230], uvScale: 48 });
        postCollision(mesh, p, 20, h + 30);
        break;
      case 'chain':
        prism(mesh, 'metal', p, { n: 6, r0: 5, r1: 5, h: h + 6, col: [200, 204, 212], rot, uvScale: 64 });
        break;
      case 'bamboo':
        prism(mesh, 'bark', [p[0], p[1] - 10, p[2]], { n: 6, r0: 8, r1: 7, h: h + 18, col: [190, 190, 96], rot, uvScale: 32 });
        break;
      case 'railing':
        prism(mesh, 'metal', p, { n: 6, r0: 4.5, r1: 4.5, h, col: color || [196, 200, 210], rot, uvScale: 64 });
        break;
      case 'guardrail':
        box(mesh, 'metal', segBox([p[0] - posts[i].t[0] * 6, p[1] - 20, p[2] - posts[i].t[1] * 6], [p[0] + posts[i].t[0] * 6, p[1] - 20, p[2] + posts[i].t[1] * 6], 6, h + 15, h + 15), { col: [130, 132, 140], uvScale: 64 });
        break;
      case 'bollards':
        prism(mesh, 'metal', [p[0], p[1] - 10, p[2]], { n: 8, r0: 11, r1: 10, h: h + 10, col: color || [70, 72, 80], rot, uvScale: 64, topCol: [90, 92, 100] });
        prism(mesh, 'white', [p[0], p[1] + h - 22, p[2]], { n: 8, r0: 10.6, r1: 10.6, h: 9, col: [240, 236, 220], rot, cap: false });
        postCollision(mesh, p, 11, h);
        break;
      case 'posts':
        prism(mesh, 'wood', [p[0], p[1] - 10, p[2]], { n: 8, r0: 15, r1: 14, h: h + 10, col: color || [206, 150, 96], rot, uvScale: 48, topCol: [230, 190, 140] });
        postCollision(mesh, p, 14, h);
        break;
      case 'lamps': lamp(mesh, p, posts[i].t, h, color); break;
      default: break;
    }
  }
  // between the posts
  for (let i = 0; i + 1 < posts.length; i++) {
    const a = P[i], b = P[i + 1];
    switch (style) {
      case 'picket':
        panel(mesh, 'picket', a, b, 2, h - 6, 64);
        fenceWall(mesh, a, b, h);
        break;
      case 'rustic':
        for (const y of [h * 0.42, h * 0.86]) box(mesh, 'bark', segBox([a[0], a[1] + y - 7, a[2]], [b[0], b[1] + y - 7, b[2]], 7, 14, 14), { col: [170, 120, 74], uvScale: 48 });
        fenceWall(mesh, a, b, h);
        break;
      case 'iron':
        panel(mesh, 'iron', a, b, 4, h - 4, 64);
        fenceWall(mesh, a, b, h + 20);
        break;
      case 'chain':
        panel(mesh, 'chain', a, b, 0, h - 8, 48);
        box(mesh, 'metal', segBox([a[0], a[1] + h - 8, a[2]], [b[0], b[1] + h - 8, b[2]], 3.5, 7, 7), { col: [200, 204, 212], uvScale: 64 });
        fenceWall(mesh, a, b, h);
        break;
      case 'bamboo':
        panel(mesh, 'bamboo', a, b, 0, h, 48);
        fenceWall(mesh, a, b, h);
        break;
      case 'railing':
        box(mesh, 'metal', segBox([a[0], a[1] + h - 6, a[2]], [b[0], b[1] + h - 6, b[2]], 4.5, 9, 9), { col: color || [206, 210, 220], uvScale: 64 });
        box(mesh, 'metal', segBox([a[0], a[1] + h * 0.5, a[2]], [b[0], b[1] + h * 0.5, b[2]], 3, 6, 6), { col: color || [196, 200, 210], uvScale: 64 });
        fenceWall(mesh, a, b, h);
        break;
      case 'guardrail': {
        // a W-beam: a bent band, light metal
        const off = 9;
        for (const [y0, y1, k] of [[h * 0.52, h * 0.66, 0.9], [h * 0.66, h * 0.8, 1.05], [h * 0.8, h * 0.94, 0.9]]) {
          const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz) || 1, rx = (-dz / L) * off, rz = (dx / L) * off;
          const q = [[a[0] + rx, a[1] + y0, a[2] + rz], [b[0] + rx, b[1] + y0, b[2] + rz], [b[0] + rx, b[1] + y1, b[2] + rz], [a[0] + rx, a[1] + y1, a[2] + rz]];
          const c = shadeC([235, 238, 244], k);
          mesh.quad('metal', V(q[0], [0, 1], c), V(q[1], [L / 128, 1], c), V(q[2], [L / 128, 0], c), V(q[3], [0, 0], c), [rx, 0, rz]);
          mesh.quad('metal', V(q[0], [0, 1], shadeC(c, 0.8)), V(q[1], [L / 128, 1], shadeC(c, 0.8)), V(q[2], [L / 128, 0], shadeC(c, 0.8)), V(q[3], [0, 0], shadeC(c, 0.8)), [-rx, 0, -rz]);
        }
        fenceWall(mesh, a, b, h);
        break;
      }
      default: break;
    }
  }
  void postCol; void bottomDark; void pts;
}

function lamp(mesh, p, t, h, color) {
  const pole = color || [64, 82, 72];
  prism(mesh, 'metal', [p[0], p[1] - 10, p[2]], { n: 8, r0: 15, r1: 12, h: 34, col: shadeC(pole, 0.9), uvScale: 64 });
  prism(mesh, 'metal', p, { n: 8, r0: 7, r1: 5.5, h, col: pole, uvScale: 96, cap: false });
  // arm reaching over the road (to the line's right side) and the lamp head
  const rx = -t[1], rz = t[0];
  const top = [p[0], p[1] + h, p[2]];
  const end = [p[0] + rx * 70, p[1] + h + 6, p[2] + rz * 70];
  box(mesh, 'metal', segBox(top, end, 4, 8, 8, -4, -4), { col: pole, uvScale: 64 });
  const hx = end[0], hz = end[2], hy = end[1] - 18;
  const c = [[-20, -14], [20, -14], [20, 14], [-20, 14]].map(([a, b]) => [hx + rx * a + t[0] * b, hy, hz + rz * a + t[1] * b]);
  const up = c.map((q) => [q[0], q[1] + 16, q[2]]);
  box(mesh, 'metal', [...c, ...up], { col: shadeC(pole, 1.1), uvScale: 32 });
  // the glowing glass underneath (flat colours, not shaded by the sun)
  const g = c.map((q) => [q[0], q[1] - 0.5, q[2]]);
  mesh.quad('glow', V(g[0], [0, 0], [255, 236, 160]), V(g[1], [0, 0], [255, 236, 160]), V(g[2], [0, 0], [255, 236, 160]), V(g[3], [0, 0], [255, 236, 160]), [0, -1, 0], false);
  postCollision(mesh, p, 10, h);
}

void hash2; void SURF; void Mesh;
