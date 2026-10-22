// Imported models free their memory when they are rebuilt or deleted (no growth on re-import),
// and the area's light (World tab → Light) shades blocks and imported models, not only terrain.
// @tags assets world
// @timeout 900
import fs from 'node:fs';
import path from 'node:path';
import { suite, ROOT } from '../lib/harness.mjs';

const FIX = path.join(ROOT, 'tests', 'fixtures');

await suite('gaps: model memory and light', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  await page.waitForFunction(() => window.studio64?.assets?.loaded && studio64.engine.state().mario, null, { timeout: 60000 });
  await s.newLevel('flat', 'Light test');
  await s.play();
  await s.eval(() => { window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; }); });
  const frames = async (n) => {
    const f0 = await s.eval(() => window.__fc);
    await page.waitForFunction(([a, b]) => window.__fc >= a + b, [f0, n], { timeout: 180000, polling: 50 });
  };
  const M = (fn, ...a) => s.eval(([fn, a]) => studio64.engine.M[`_${fn}`](...a), [fn, a]);

  // ---- 1. import the crate and place two copies ---------------------------------------------
  const data = [{ name: 'crate.glb', b64: fs.readFileSync(path.join(FIX, 'crate.glb')).toString('base64') }];
  const files = await page.evaluateHandle((list) => list.map((f) => new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name)), data);
  await page.evaluate((f) => studio64.assetsUI.openImport(f), files);
  await page.waitForSelector('.as-import [data-a=save]:not([disabled])', { timeout: 60000 });
  await page.click('.as-import [data-a=save]');
  await page.waitForFunction(() => studio64.assets.meta.models.length === 1, null, { timeout: 60000 });
  const modelId = await s.eval(() => studio64.assets.meta.models[0].id);
  const ground = await s.eval(() => studio64.engine.floor(0, 3000, 0));
  const uids = await s.eval(async ({ id, ground }) => {
    const A = studio64.assets;
    await A.ensureModel(id);
    const out = [];
    for (const [x, z] of [[0, -900], [600, -900]]) {
      const rec = A.makeRecord(id, { x, y: ground, z, yaw: 0 });
      rec.uid = 1 + Math.floor(Math.random() * 0x7efffffe);
      studio64.engine.patch.areas[studio64.engine.areaKey()].objects.push(rec);
      studio64.ws.send(JSON.stringify({ type: 'edit', op: { type: 'add', key: studio64.engine.areaKey(), summary: 'Placed a crate', records: [rec] } }));
      studio64.engine.spawn(rec);
      out.push(rec.uid);
    }
    return out;
  }, { id: modelId, ground });
  await frames(10);
  const mem0 = await M('studio_assets_mem');
  t.check('the engine counts the model memory', mem0 > 1000, mem0);

  // ---- 2. rebuild it 8 times (settings change = re-import): memory stays the same --------------
  for (let i = 0; i < 8; i++) {
    await s.eval(async ({ id, i }) => {
      const A = studio64.assets;
      const m = A.model(id);
      await A.updateModel(id, { materials: m.materials.map((x) => ({ ...x, double: i % 2 === 0 })) });
      await new Promise((r) => setTimeout(r, 50));
      await A.models.get(id).ready;
    }, { id: modelId, i });
    await frames(4);
  }
  await page.waitForFunction(() => studio64.engine.M._studio_assets_retired() === 0, null, { timeout: 20000, polling: 200 }).catch(() => {});
  const memN = await M('studio_assets_mem');
  const retired = await M('studio_assets_retired');
  t.check('no memory growth after 8 rebuilds', memN <= mem0 * 1.05, { mem0, memN });
  t.eq('no rebuilt model left waiting', retired, 0);
  const live = await s.eval((u) => u.filter((x) => studio64.engine.objects().some((o) => o.uid === x)).length, uids);
  t.eq('both copies are still in the level', live, 2);

  // ---- 3. the area's light shades blocks and models -------------------------------------------
  // a white block high up and the camera looking down at its top; then at a crate's +z side
  await s.eval(async (y) => {
    const g = await import('/js/generators.js');
    const rec = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), x: -1500, y, z: -1500, yaw: 0, pitch: 0, roll: 0, name: 'light block', block: g.blockDefaults({ shape: 0, sx: 900, sy: 100, sz: 900, top: 'marble', side: 'marble' }) };
    studio64.editor.records().push(rec);
    studio64.objects.store.commit({ type: 'add', summary: 'Built a block', records: [rec] });
    studio64.engine.spawn(rec);
  }, ground + 1200);
  await frames(6);
  const lum = async (pos, focus) => {
    await s.eval(([p, f]) => studio64.engine.setCamera(true, p, f, 30), [pos, focus]);
    await frames(6);
    // the median of 3 frames (a busy machine can drop a frame), repeated until two readings agree
    // (a re-shade or a texture upload can land a few frames late)
    const once = () => s.eval(async () => {
      const out = [];
      for (let k = 0; k < 3; k++) {
        const c = await studio64.engine.captureFrame(2);
        const g = c.getContext('2d');
        const w = c.width, h = c.height;
        const d = g.getImageData(Math.round(w * 0.42), Math.round(h * 0.42), Math.round(w * 0.16), Math.round(h * 0.16)).data;
        let sum = 0;
        for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
        out.push(sum / (d.length / 4));
      }
      return out.sort((a, b) => a - b)[1];
    });
    let prev = await once();
    for (let i = 0; i < 8; i++) {
      await frames(4);
      const v = await once();
      if (Math.abs(v - prev) <= prev * 0.03) return v;
      prev = v;
    }
    return prev;
  };
  const blockView = [[-1500, ground + 2400, -1350], [-1500, ground + 1300, -1500]];
  const crateView = [[0, ground + 100, -400], [0, ground + 100, -900]];
  const b0 = await lum(...blockView);
  const c0 = await lum(...crateView);
  await s.shot('light_default');
  // the sun low in the south-west, little ambient light: tops and +z sides go dark
  await s.eval(() => studio64.worldFlow.setEnv({ light: { yaw: 225, pitch: 8, ambient: 0.12 } }));
  await frames(4);
  const b1 = await lum(...blockView);
  const c1 = await lum(...crateView);
  await s.shot('light_dark');
  t.check('a block top is darker under a low sun', b1 < b0 * 0.75, { b0, b1 });
  t.check('an imported model is darker under a low sun', c1 < c0 * 0.8, { c0, c1 });
  // a warm light colour tints them
  await s.eval(() => studio64.worldFlow.setEnv({ light: { yaw: 45, pitch: 57, ambient: 0.42, color: '#ff8040' } }));
  await frames(4);
  const tint = await s.eval(async () => {
    const c = await studio64.engine.captureFrame(1);
    const d = c.getContext('2d').getImageData(Math.round(c.width * 0.45), Math.round(c.height * 0.45), 20, 20).data;
    let r = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; b += d[i + 2]; }
    return { r, b };
  });
  t.check('the light colour tints the model', tint.r > tint.b * 1.15, tint);
  // back to the default light: as before
  await s.eval(() => studio64.worldFlow.setEnv({ light: null }));
  await frames(4);
  const b2 = await lum(...blockView);
  const c2 = await lum(...crateView);
  t.near('default light: the block looks as before', b2, b0, b0 * 0.1);
  t.near('default light: the model looks as before', c2, c0, c0 * 0.1);
  await s.eval(() => studio64.engine.setCamera(false));

  // ---- 4. deleting the model frees it --------------------------------------------------------
  await s.eval((id) => studio64.assets.deleteModel(id), modelId);
  await frames(6);
  await page.waitForFunction(() => studio64.engine.M._studio_assets_mem() === 0, null, { timeout: 20000, polling: 200 }).catch(() => {});
  t.eq('a deleted model gives its memory back', await M('studio_assets_mem'), 0);
  t.check('and its slot is free again', await s.eval(() => studio64.assets.freeSlots.length === 256), await s.eval(() => studio64.assets.freeSlots.length));
});
