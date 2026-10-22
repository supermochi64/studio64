// The "Castle Remix" sample hack (server/samples/castle-remix.s64hack): built in the real
// castle grounds with the studio's own tools, checked with the level validator, exported.
//   STUDIO_URL=http://127.0.0.1:8064 node tools/make_castle_sample.mjs
import { launchBrowser } from './lib/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:8064';
const J = (r) => r.json();
const { id } = await fetch(`${BASE}/api/hub/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
  name: 'Castle Remix', author: 'Studio 64', template: 'empty', level: 16,
  description: 'The castle grounds with a new tower to climb, floating platforms, a warp pipe and eight red coins. Three new stars to find.',
}) }).then(J);
const browser = await launchBrowser({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${BASE}/?p=${id}`);
await page.waitForFunction(() => window.studio64?.engine?.ready && studio64.testing && studio64.engine.level === 16 && studio64.engine.state().mario, null, { timeout: 300000 });
await page.waitForTimeout(1500);

const report = await page.evaluate(async () => {
  const e = studio64.engine, st = studio64.studio, send = studio64.testing.send;
  const key = e.areaKey();
  const commit = (r, summary) => send({ type: 'edit', op: { type: 'add', key, records: r.records || [], rules: r.rules || [], warps: r.warps || [], summary } });
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const m0 = e.state().mario;
  // open, flat lawn spots away from walls and water
  const flat = (x, z, r = 260) => {
    const y = e.floor(x, 5000, z);
    if (y < 100 || y > 1500) return null;
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r]]) if (Math.abs(e.floor(x + dx, 5000, z + dz) - y) > 25) return null;
    if (e.water(x, z) > y - 50) return null;
    const M = e.M;
    const ptr = M._studio_debug_walls(x, y + 100, z, r + 300, 0);
    if (new Float32Array(M.HEAPU8.buffer, ptr, 1)[0] > 0) return null;
    return { x, y, z };
  };
  const spots = [];
  for (let z = -1200; z <= 6200; z += 300) for (let x = -6200; x <= 6200; x += 300) { const s = flat(x, z, 420); if (s) spots.push(s); }
  const far = (s, list, d) => list.every((o) => Math.hypot(o.x - s.x, o.z - s.z) > d);
  const fromSpawn = (s) => Math.hypot(s.x - m0.x, s.z - m0.z);
  const pick = (pred) => spots.find(pred);
  // on the lawns beside the path to the castle, not in front of it
  const towerAt = pick((s) => s.z > 2600 && Math.abs(s.x - m0.x) > 1500 && fromSpawn(s) > 1500 && fromSpawn(s) < 4200);
  const pathAt = towerAt && [...spots].filter((s) => s.z > 3000 && fromSpawn(s) > 700 && fromSpawn(s) < 2200).sort((a, b) => Math.hypot(b.x - towerAt.x, b.z - towerAt.z) - Math.hypot(a.x - towerAt.x, a.z - towerAt.z))[0];
  const out = { spots: spots.length, towerAt, pathAt };
  if (!towerAt || !pathAt) return { ...out, failed: true, m0, list: spots.map((s) => [Math.round(s.x), Math.round(s.y), Math.round(s.z)]) };
  // a tower with a star on top
  const tower = st.build({ kind: 'tower', where: { mode: 'at', x: towerAt.x, z: towerAt.z }, yaw_deg: Math.round((Math.atan2(m0.x - towerAt.x, m0.z - towerAt.z) * 180) / Math.PI), params: { floors: 4, size: 760 } });
  commit(tower, 'Built a tower');
  await wait(300);
  const topY = Math.max(...tower.records.map((r) => r.y + r.block.sy));
  const slab = tower.records.filter((r) => r.block.sy === 40).sort((a, b) => b.y - a.y)[0];
  const s1 = st.addStar({ name: 'Top of the New Tower', where: { mode: 'at', x: slab.x, y: topY + 20, z: slab.z, snap: false } });
  commit(s1, 'Added star “Top of the New Tower”');
  // floating platforms rising away from the lawn, a star over the last one
  const plat = st.build({ kind: 'path', where: { mode: 'at', x: pathAt.x, z: pathAt.z }, yaw_deg: Math.round((Math.atan2(pathAt.x - m0.x, pathAt.z - m0.z) * 180) / Math.PI), params: { count: 7, rise: 140, gap: 360 } });
  commit(plat, 'Built floating platforms');
  await wait(300);
  const last = plat.records[plat.records.length - 1];
  const s2 = st.addStar({ name: 'Platform Peak', where: { mode: 'at', x: last.x, y: last.y + 60 + 20, z: last.z, snap: false } });
  commit(s2, 'Added star “Platform Peak”');
  // eight red coins on open lawn spots, their star near the start
  const used = [towerAt, pathAt];
  const reds = [];
  for (const s of spots) { if (reds.length >= 8) break; if (far(s, [...used, ...reds], 900) && fromSpawn(s) < 5000) reds.push(s); }
  const near = pick((s) => fromSpawn(s) > 500 && fromSpawn(s) < 1300 && far(s, [...used, ...reds], 500)) || { x: m0.x + 400, z: m0.z };
  const s3 = st.addStar({ name: 'Red Coins on the Lawn', kind: 'red_coins', where: { mode: 'at', x: near.x, z: near.z }, coins: reds.map((r) => ({ mode: 'at', x: r.x, z: r.z })) });
  commit(s3, 'Added red coin star “Red Coins on the Lawn”');
  // a ring of coins around the start and a pipe from the start to the tower door
  const ring = st.place({ items: [{ id: 'yellow_coin', count: 10, where: { mode: 'around', x: m0.x, z: m0.z, radius: 450, y_offset: 40 } }] });
  commit({ records: ring.placed.map((p) => p.record) }, 'Added 10 coins');
  const pipeFrom = pick((s) => fromSpawn(s) > 350 && fromSpawn(s) < 900 && far(s, [...used, ...reds, near], 400)) || { x: m0.x - 500, z: m0.z };
  const towerFront = { x: towerAt.x + (m0.x - towerAt.x) / fromSpawn(towerAt) * 900, z: towerAt.z + (m0.z - towerAt.z) / fromSpawn(towerAt) * 900 };
  const pipe = st.pipe({ from: { mode: 'at', x: pipeFrom.x, z: pipeFrom.z }, to: { mode: 'at', x: towerFront.x, z: towerFront.z } });
  commit(pipe, 'Added a warp pipe to the tower');
  await wait(1500);
  const check = studio64.testing.runCheck();
  out.problems = check.problems.filter((p) => p.key === key).map((p) => `${p.severity}: ${p.title}`);
  out.records = (e.patch.areas[key]?.objects || []).length;
  return out;
});
console.log(JSON.stringify(report));
if (report.failed) { await browser.close(); process.exit(1); }
// a cover: the tower from the lawn
await page.evaluate(async (t) => {
  const e = studio64.engine;
  const m = e.state().mario;
  studio64.editor.enter();
  await new Promise((r) => setTimeout(r, 400));
  studio64.editor.active = false;
  const dx = t.x - m.x, dz = t.z - m.z, l = Math.hypot(dx, dz);
  e.setCamera(true, [t.x - (dx / l) * 3800 + (dz / l) * 1200, t.y + 1300, t.z - (dz / l) * 3800 - (dx / l) * 1200], [t.x, t.y + 800, t.z], 52);
}, report.towerAt);
await page.waitForTimeout(3000);
const shot = await page.evaluate(async () => {
  const c = await studio64.engine.captureFrame(2);
  const o = document.createElement('canvas');
  o.width = 960; o.height = 540;
  const k = Math.max(960 / c.width, 540 / c.height);
  o.getContext('2d').drawImage(c, (960 - c.width * k) / 2, (540 - c.height * k) / 2, c.width * k, c.height * k);
  return o.toDataURL('image/jpeg', 0.84);
});
await fetch(`${BASE}/api/projects/${id}/meta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cover: shot }) });
await browser.close();
await new Promise((r) => setTimeout(r, 800));
const buf = Buffer.from(await (await fetch(`${BASE}/api/projects/${id}/export.s64hack?chat=0`)).arrayBuffer());
fs.writeFileSync(path.join(ROOT, 'server/samples/castle-remix.s64hack'), buf);
console.log('wrote server/samples/castle-remix.s64hack', buf.length, 'bytes; errors:', report.problems.filter((p) => p.startsWith('error')).length);
await fetch(`${BASE}/api/projects/${id}`, { method: 'DELETE' });
