// The sample hacks of the home screen (server/samples/*.s64hack), made from the level
// templates with stars, red coins and coins placed on the generated ground.
//   node tools/make_samples.mjs
// Check them in the game afterwards: tests/suite/samples.test.mjs opens each and runs the validator.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTemplate } from '../web/js/templates.js';
import { Terrain } from '../web/js/terrain.js';
import { zipWrite } from '../server/zip.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'server', 'samples');
fs.mkdirSync(OUT, { recursive: true });

let uidSeed = 0x3000000;
const uid = () => ++uidSeed;
const id8 = (s) => s.replace(/[^\w]/g, '').slice(0, 8).padEnd(8, 'x');

// A custom level from a template, plus where things can stand.
function level(template, seed) {
  const t = makeTemplate(template, seed);
  const area = { objects: [], removals: [], warps: [], settings: { ...t.settings, spawn: t.spawn } };
  if (t.terrain) area.terrain = t.terrain.encode();
  for (const r of [...(t.blocks || []), ...(t.objects || [])]) area.objects.push({ uid: uid(), ...r });
  const T = area.terrain ? Terrain.decode(area.terrain) : null;
  const blocked = area.objects.filter((r) => r.block).map((r) => ({ x: r.x, z: r.z, r: Math.max(r.block.sx, r.block.sz) * 0.75 + 250 }));
  const free = (x, z) => blocked.every((b) => Math.hypot(b.x - x, b.z - z) > b.r);
  return { area, T, free, spawn: t.spawn, water: t.settings?.water };
}

// High spots, far apart, away from blocks, above water.
function peaks(L, n, minGap = 2200) {
  const { T, free } = L;
  const b = T.bounds();
  const cands = [];
  for (let z = b.minZ + 600; z < b.maxZ - 600; z += 160) {
    for (let x = b.minX + 600; x < b.maxX - 600; x += 160) {
      const y = T.heightAt(x, z);
      // flat enough to land on
      const s = Math.max(...[[80, 0], [-80, 0], [0, 80], [0, -80]].map(([dx, dz]) => Math.abs(T.heightAt(x + dx, z + dz) - y)));
      if (s > 60 || !free(x, z)) continue;
      if (L.water?.on && y < (L.water.height ?? 0) + 40) continue;
      cands.push({ x, z, y });
    }
  }
  cands.sort((a, c) => c.y - a.y);
  const out = [];
  for (const c of cands) {
    if (out.length >= n) break;
    if (out.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > minGap) && Math.hypot(c.x - L.spawn.x, c.z - L.spawn.z) > 1200) out.push(c);
  }
  return out;
}

// Ground spots on a ring around a point (red coins, coin trails).
function ring(L, cx, cz, radius, n) {
  const out = [];
  for (let i = 0; i < n * 4 && out.length < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.floor(i / n) * 0.37;
    const r = radius * (1 - Math.floor(i / n) * 0.18);
    const x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
    const b = L.T.bounds();
    if (x < b.minX + 300 || x > b.maxX - 300 || z < b.minZ + 300 || z > b.maxZ - 300 || !L.free(x, z)) continue;
    const y = L.T.heightAt(x, z);
    if (L.water?.on && y < (L.water.height ?? 0) + 40) continue;
    if (out.every((p) => Math.hypot(p.x - x, p.z - z) > radius * 0.5)) out.push({ x, z, y });
  }
  return out;
}

const star = (name, index, p, lift = 140) => ({ uid: uid(), entry: 'star', x: Math.round(p.x), y: Math.round(p.y + lift), z: Math.round(p.z), yaw: 0, pitch: 0, roll: 0, bparams: ((index & 0x1f) << 24) >>> 0, scale: 1, name, star: { name } });
const redStar = (name, index, p) => ({ uid: uid(), entry: 'hidden_red_coin_star', x: Math.round(p.x), y: Math.round(p.y + 20), z: Math.round(p.z), yaw: 0, pitch: 0, roll: 0, bparams: ((index & 0x1f) << 24) >>> 0, scale: 1, name, star: { name } });
const red = (p) => ({ uid: uid(), entry: 'red_coin', x: Math.round(p.x), y: Math.round(p.y + 60), z: Math.round(p.z), yaw: 0, pitch: 0, roll: 0, bparams: 0, scale: 1, name: 'Red Coin' });
const coin = (p) => ({ uid: uid(), entry: 'yellow_coin', x: Math.round(p.x), y: Math.round(p.y + 40), z: Math.round(p.z), yaw: 0, pitch: 0, roll: 0, bparams: 0, scale: 1, name: 'Yellow Coin' });

function project({ name, author, description, levels, cover }) {
  const pid = id8(name);
  const p = {
    id: pid, name, createdAt: Date.now(), updatedAt: Date.now(), boot: { level: 16, act: 1, custom: levels[0].id },
    areas: {}, changes: [], redo: [], chat: [], sessionId: null, model: null, levels: [], thumbs: {},
    audio: { songs: [], sounds: [], overrides: [] }, meta: { author, description, template: 'sample' },
  };
  for (const l of levels) {
    p.levels.push({ id: l.id, name: l.name, created: Date.now(), template: l.template });
    p.areas[`c:${l.id}`] = l.area;
  }
  const entries = [
    { name: 'manifest.json', data: JSON.stringify({ format: 'studio64-hack', version: 2, app: 'Studio 64', exportedAt: new Date().toISOString(), id: pid, name, author, description, levels: levels.length, edits: 0, files: [] }, null, 1) },
    { name: 'project.json', data: JSON.stringify(p) },
  ];
  if (cover && fs.existsSync(cover)) entries.push({ name: 'cover.jpg', data: fs.readFileSync(cover) });
  const file = path.join(OUT, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.s64hack`);
  fs.writeFileSync(file, zipWrite(entries));
  const stars = levels.reduce((n, l) => n + l.area.objects.filter((r) => r.star).length, 0);
  console.log(`${path.relative(ROOT, file)}: ${levels.length} level(s), ${stars} stars`);
}

// ---- Star Isles: floating islands (blocks), stars on the high isles, red coins on the stepping stones ----
{
  const L = level('sky', 4242);
  // the islands' grass tops (the template's first layer) and the stepping stones
  const isles = L.area.objects.filter((r) => r.block && r.name === 'Sky island' && r.block.top === 0).map((r) => ({ x: r.x, z: r.z, y: r.y + r.block.sy, size: r.block.sx }));
  const stones = L.area.objects.filter((r) => r.block && r.name === 'Stepping stone').map((r) => ({ x: r.x, z: r.z, y: r.y + r.block.sy }));
  const high = [...isles].sort((a, b) => b.y - a.y);
  const names = ['Highest Isle', 'Cloud Climber', 'Island Hopper'];
  high.slice(0, 3).forEach((p, i) => L.area.objects.push(star(names[i], i, { x: p.x, z: p.z + p.size * 0.22, y: p.y })));
  // eight red coins: on the stones and the low isles, the star waits on the start island
  const spots = [...stones, ...high.slice(3).map((p) => ({ x: p.x - p.size * 0.25, z: p.z + p.size * 0.2, y: p.y }))].slice(0, 8);
  if (spots.length === 8) {
    L.area.objects.push(redStar('Red Coins in the Clouds', 3, { x: 300, y: 0, z: -250 }));
    for (const r of spots) L.area.objects.push(red(r));
  }
  project({ name: 'Star Isles', author: 'Studio 64', description: 'Floating islands high above the clouds: three stars on the highest isles and eight red coins on the stepping stones. A small finished hack to play and take apart.', cover: path.join(ROOT, 'web/thumbs/templates/sky.jpg'),
    levels: [{ id: 'isles001', name: 'Star Isles', template: 'sky', area: L.area }] });
}

// ---- Frost Peak: a snowy mountain, stars up the slopes ----
{
  const L = level('snow', 777);
  const top = peaks(L, 3, 2600);
  ['Summit of Frost Peak', 'The Icy Ledge', 'Snow Shoulder'].forEach((n, i) => top[i] && L.area.objects.push(star(n, i, top[i])));
  for (const c of ring(L, L.spawn.x, L.spawn.z, 900, 10)) L.area.objects.push(coin(c));
  project({ name: 'Frost Peak', author: 'Studio 64', description: 'Climb a snowy mountain with an ice slide and a cabin. Three stars wait on the slopes and the summit.', cover: path.join(ROOT, 'web/thumbs/templates/snow.jpg'),
    levels: [{ id: 'frost001', name: 'Frost Peak', template: 'snow', area: L.area }] });
}

// ---- Two Worlds: an island and a lava land in one hack ----
{
  const A = level('island', 1001);
  const B = level('lava', 2002);
  peaks(A, 2, 2400).forEach((p, i) => A.area.objects.push(star(['Palm Peak', 'Lighthouse Hill'][i], i, p)));
  peaks(B, 2, 2400).forEach((p, i) => B.area.objects.push(star(['Volcano Rim', 'Ash Plateau'][i], i, p)));
  project({ name: 'Two Worlds', author: 'Studio 64', description: 'A tropical island and a land of lava in one hack, two stars each. Open the level list (Ctrl+K) to switch.', cover: path.join(ROOT, 'web/thumbs/templates/lava.jpg'),
    levels: [{ id: 'island01', name: 'Palm Island', template: 'island', area: A.area }, { id: 'lava0001', name: 'Lava Land', template: 'lava', area: B.area }] });
}
