// Roads & nature meshes have no holes: every plant kind, and the shapes fences and posts are made
// of, drawn as closed parts whose faces all point outward (a face turned inward is culled, and the
// player looks into the tree through it). Checked on the triangles, no browser.
// @tags paths smoke
// @timeout 60
import { suite } from '../lib/harness.mjs';
import { KINDS, buildNatureMesh } from '../../web/js/paths/nature.js';
import { Mesh, prism, blob } from '../../web/js/paths/mesh.js';

// A material's triangles -> { flipped: shared edges both triangles run the same way, inward: parts
// whose signed volume is negative, parts }
function faces(d) {
  const n = d.length / 27;
  const id = (i) => `${d[i].toFixed(1)},${d[i + 1].toFixed(1)},${d[i + 2].toFixed(1)}`;
  const dir = new Map(), parent = Array.from({ length: n }, (_, i) => i), byV = new Map();
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let t = 0; t < n; t++) {
    const v = [0, 1, 2].map((k) => id(t * 27 + k * 9));
    for (let e = 0; e < 3; e++) { const k = `${v[e]}>${v[(e + 1) % 3]}`; dir.set(k, (dir.get(k) || 0) + 1); }
    for (const k of v) { if (byV.has(k)) parent[find(t)] = find(byV.get(k)); else byV.set(k, t); }
  }
  const vol = new Map();
  for (let t = 0; t < n; t++) {
    const [a, b, c] = [0, 9, 18].map((o) => [d[t * 27 + o], d[t * 27 + o + 1], d[t * 27 + o + 2]]);
    const v = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    vol.set(find(t), (vol.get(find(t)) || 0) + v);
  }
  return { flipped: [...dir.values()].filter((k) => k > 1).length, inward: [...vol.values()].filter((v) => v < 0).length, parts: vol.size };
}

await suite('plant meshes', async (t) => {
  for (const k of KINDS) {
    if (k.type === 'sm64' || k.sprite) continue; // the game's trees; cards are double-sided
    // turned and tilted like a planted one
    const m = buildNatureMesh([{ kind: k.id, x: 300, y: 50, z: -200, yaw: 1.1, s: 1.2, nx: 0.12, nz: -0.08 }]);
    const bad = [];
    for (const [key, mat] of m.mats) {
      if (!mat.data.length || (mat.flags & 4)) continue;
      const f = faces(mat.data);
      if (f.flipped || f.inward) bad.push(`${key}: ${f.flipped} flipped edges, ${f.inward} of ${f.parts} parts inside out`);
    }
    t.check(`${k.label}: no faces turned inward`, !bad.length, bad.join('; '));
  }

  // the shapes on their own: every side of a prism faces out (the last one used to face in)
  for (const n of [4, 5, 6, 8]) {
    const m = new Mesh();
    m.mat('x');
    prism(m, 'x', [10, 0, 20], { n, r0: 30, r1: n === 8 ? 0 : 20, h: 100, rot: 0.7 });
    const f = faces(m.mats.get('x').data);
    t.check(`prism of ${n} sides${n === 8 ? ' (a cone)' : ''}: every side faces out`, !f.flipped && !f.inward, f);
  }
  // a blob's poles sit on its surface (they were pulled into its centre: a crater on top)
  const m = new Mesh();
  m.mat('x');
  blob(m, 'x', [0, 100, 0], { rx: 50, ry: 40, rz: 50, seg: 6, rings: 4, jitter: 0.2, rand: () => 0.5 });
  const ys = [];
  for (let i = 1; i < m.mats.get('x').data.length; i += 9) ys.push(m.mats.get('x').data[i]);
  t.eq('blob: its top and bottom are its poles', [Math.max(...ys), Math.min(...ys)].join(), '140,60');
  const f = faces(m.mats.get('x').data);
  t.check('blob: closed and facing out', !f.flipped && !f.inward && f.parts === 1, f);
});
