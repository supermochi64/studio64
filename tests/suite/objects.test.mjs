// Object library: places a broad sample of the catalog with the editor (as a user would) in
// a custom level and in an original level, plays a few seconds, and checks for crashes, objects
// that do not appear, and objects that fall through the floor.
// @tags editor objects
// @timeout 600
import { suite } from '../lib/harness.mjs';
import fs from 'node:fs';

const cat = JSON.parse(fs.readFileSync(new URL('../../server/data/catalog.json', import.meta.url), 'utf8'));
// every 9th entry + the popular ones + the Sunshine ones: ~90 objects, a different slice per run day
const day = Math.floor(Date.now() / 86400000);
const POP = ['bobomb', 'goomba', 'koopa', 'boo', 'chain_chomp', 'small_whomp', 'thwomp', 'small_bully', 'piranha_plant', 'yellow_coin', 'red_coin', 'star', '1_up', 'exclamation_box', 'breakable_box', 'warp_pipe', 'tree:bubbly_tree', 'wooden_post', 'king_bobomb', 'yoshi'];
const sample = [...new Set([
  ...POP.filter((id) => cat.entries.some((e) => e.id === id)),
  ...cat.entries.filter((e) => e.id.startsWith('sms:')).map((e) => e.id),
  ...cat.entries.filter((e, i) => (i + day) % 9 === 0).map((e) => e.id),
])];

// water creatures swim at the water level, which is far below a level without water
const SWIMMERS = /shark|unagi|manta|fish|bub\b|bubba|cheep|clam|skeeter/;

async function placeAll(t, s, label) {
  const page = s.page;
  // a grid of ground points on screen, looking down at Mario
  const groundGrid = async () => {
    await s.build();
    for (let tries = 0; ; tries++) {
      await s.viewMario(2200 - tries * 300, -0.75 - tries * 0.1);
      await s.framesAdvance(); // the editor picks with the camera of the last drawn frame
      const pts = await grid();
      if (pts.length >= 4 || tries >= 4) return pts;
      await s.wait(800);
    }
  };
  const grid = () => {
    return s.eval(() => {
      const ed = studio64.editor; const { w, h } = ed.size(); const out = [];
      for (let y = 0.45; y < 0.9; y += 0.07) for (let x = 0.12; x < 0.9; x += 0.07) {
        const hit = ed.pick(w * x, h * y, { objects: false });
        if (hit && hit.ny > 0.7) out.push({ x: w * x, y: h * y });
      }
      return out;
    });
  };
  t.must(`${label}: ground points on screen`, (await groundGrid()).length >= 10);
  const failed = [], invisible = [], fell = [];
  for (let i = 0; i < sample.length; i += 12) {
    const batch = sample.slice(i, i + 12);
    const pts = await groundGrid();
    if (!pts.length) { t.check(`${label}: ground on screen for batch ${i / 12 + 1}`, false); continue; }
    const placed = await s.eval(async ({ batch, pts }) => {
      const ed = studio64.editor, out = [];
      for (let k = 0; k < batch.length; k++) {
        const p = pts[k % pts.length];
        ed.startPlacing({ entry: batch[k] });
        ed.updateGhost(p.x, p.y);
        const slot = ed.commitPlacement();
        const rec = ed.records()[ed.records().length - 1];
        out.push({ id: batch[k], slot, uid: rec?.entry === batch[k] ? rec.uid : 0, y: rec?.y, x: rec?.x, z: rec?.z, n: studio64.engine.objects().length });
      }
      ed.cancelPlacing();
      return out;
    }, { batch, pts });
    await s.wait(300);
    const objs = await s.eval(() => studio64.engine.objects());
    for (const p of placed) {
      const o = objs.find((x) => x.uid === p.uid);
      if (p.slot < 0 || !p.uid || !o) failed.push(`${p.id} (${p.slot < 0 ? 'spawn failed' : !p.uid ? 'no record' : 'gone after 0.3s'}${p.n ? ', ' + p.n + ' objects' : ''})`);
    }
    // play a moment: behaviors run
    await s.play();
    await s.wait(2200);
    if (await s.crashed()) { t.check(`${label}: no crash after placing ${batch.join(', ')}`, false); return; }
    const after = await s.eval(() => studio64.engine.objects());
    for (const p of placed) {
      const o = after.find((x) => x.uid === p.uid);
      if (o && !o.visible) invisible.push(p.id);
      if (o && p.y !== undefined && o.y < p.y - 2000 && !SWIMMERS.test(p.id)) fell.push(`${p.id} (${p.x},${Math.round(p.y)},${p.z} -> ${Math.round(o.x)},${Math.round(o.y)},${Math.round(o.z)})`);
    }
    // clean up so the pool does not fill
    await s.build();
    // Mario back to the start, in case an enemy pushed him somewhere
    await s.eval((uids) => { for (const u of uids) studio64.engine.deleteUid(u); }, placed.map((p) => p.uid));
  }
  t.check(`${label}: every sampled object spawns (${sample.length})`, failed.length === 0, failed);
  t.check(`${label}: no object falls through the level`, fell.length === 0, fell);
  if (invisible.length) t.log(`${label}: invisible after 2s (may be by design):`, invisible.join(', '));
  t.check(`${label}: engine still running`, await s.framesAdvance());
}

await suite('objects', async (t) => {
  t.log(`${sample.length} objects in the sample`);
  const s = await t.open({ level: 9 });
  await placeAll(t, s, 'BoB');
  await s.play();
  await s.newLevel('flat', 'Objects test');
  await placeAll(t, s, 'custom level');
  await s.shot('custom');
});
