// Assets: OBJ/GLB/FBX import with preview, placing props and level geometry (collision, walking on it),
// the build library, the inspector, model settings, game textures (replace, pixel editor), custom
// materials on blocks, Mario's colours, skies, a level made from a model, and persistence after a reload.
// @tags assets
// @timeout 900
import fs from 'node:fs';
import path from 'node:path';
import { suite, ROOT } from '../lib/harness.mjs';

const FIX = path.join(ROOT, 'tests', 'fixtures');

await suite('assets', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  const check = (name, ok, info) => t.check(name, ok, info);
  await page.waitForFunction(() => window.studio64?.assets?.loaded && studio64.engine.state().mario, null, { timeout: 60000 });

  // File objects in the page from fixture files.
  async function filesInPage(names) {
    const data = names.map((n) => ({ name: n, b64: fs.readFileSync(path.join(FIX, n)).toString('base64') }));
    return page.evaluateHandle((list) => list.map((f) => new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name)), data);
  }


  // ---- 1. textures are found in memory -------------------------------------------------
  const tex = await page.evaluate(async () => {
    const A = studio64.assets;
    const list = await A.catalog();
    const t0 = performance.now();
    await A.locate();
    return { total: list.length, found: list.filter((t) => t.addr !== undefined).length, ms: Math.round(performance.now() - t0) };
  });
  check('game textures located in memory', tex.found > tex.total * 0.9, `${tex.found}/${tex.total} in ${tex.ms} ms`);

  // ---- 2. import the OBJ platform (as level geometry) ----------------------------------
  const objFiles = await filesInPage(['platform.obj', 'platform.mtl', 'checker.png']);
  await page.evaluate((files) => studio64.assetsUI.openImport(files), objFiles);
  await page.waitForSelector('.as-import [data-a=save]:not([disabled])', { timeout: 60000 });
  await page.waitForTimeout(800);
  await s.shot('import_obj');
  const objInfo = await page.evaluate(() => ({ info: document.querySelector('.as-pv-info')?.textContent, mats: [...document.querySelectorAll('.as-mat-name')].map((x) => x.textContent), surf: [...document.querySelectorAll('.as-mat [data-m=surface]')].map((x) => x.value) }));
  check('OBJ preview: materials and lava guess', objInfo.mats.length === 2 && objInfo.surf.includes('lava'), JSON.stringify(objInfo));
  await page.click('.as-import [data-a=save]');
  await page.waitForFunction(() => studio64.assets.meta.models.length === 1, null, { timeout: 60000 });

  // ---- 3. import the GLB crate (a prop) -------------------------------------------------
  const glbFiles = await filesInPage(['crate.glb']);
  await page.evaluate((files) => studio64.assetsUI.openImport(files), glbFiles);
  await page.waitForSelector('.as-import [data-a=save]:not([disabled])', { timeout: 60000 });
  await page.waitForTimeout(800);
  await s.shot('import_glb');
  const glbInfo = await page.evaluate(() => document.querySelector('.as-pv-info')?.textContent);
  check('GLB preview: 200 units tall crate', /\b2\d\d\b/.test(glbInfo || '') && /textures/.test(glbInfo || ''), glbInfo);
  await page.click('.as-import [data-a=save]');
  await page.waitForFunction(() => studio64.assets.meta.models.length === 2, null, { timeout: 60000 });
  const models = await page.evaluate(() => studio64.assets.meta.models.map((m) => ({ id: m.id, name: m.name, tris: m.tris, thumb: !!m.thumb, mats: m.materials.map((x) => x.surface) })));
  console.log('models', JSON.stringify(models));
  check('both models in My models with thumbnails', models.length === 2 && models.every((m) => m.thumb && m.tris > 0));

  // ---- 3b. a binary FBX (Z up, embedded texture) and a big generated mesh -----------------------
  const fbxFiles = await filesInPage(['house.fbx']);
  await page.evaluate((files) => studio64.assetsUI.openImport(files), fbxFiles);
  await page.waitForSelector('.as-import [data-a=save]:not([disabled])', { timeout: 60000 });
  await page.waitForTimeout(600);
  await s.shot('import_fbx');
  const fbxInfo = await page.evaluate(() => ({ info: document.querySelector('.as-pv-info')?.textContent, mats: [...document.querySelectorAll('.as-mat-name')].map((x) => x.textContent) }));
  check('FBX: Z-up house stands upright, 2 materials, embedded texture', /200 × 320 × 200/.test(fbxInfo.info) && fbxInfo.mats.length === 2 && /1 textures/.test(fbxInfo.info), JSON.stringify(fbxInfo));
  await page.click('.as-import [data-a=close]');
  const big = await page.evaluate(async () => {
    // a 140 x 140 quad wavy hill (39,200 triangles), 7000 units across
    const n = 140, lines = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) lines.push(`v ${(i / n - 0.5) * 70} ${Math.sin(i / 9) * Math.cos(j / 11) * 4} ${(j / n - 0.5) * 70}`);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * (n + 1) + i + 1; lines.push(`f ${a} ${a + n + 1} ${a + n + 2} ${a + 1}`); }
    const file = new File([lines.join('\n')], 'big_hill.obj');
    const t0 = performance.now();
    studio64.assetsUI.openImport([file]);
    await new Promise((ok) => { const w = () => (document.querySelector('.as-import [data-a=save]:not([disabled])') ? ok() : setTimeout(w, 100)); w(); });
    const tImport = performance.now() - t0;
    document.querySelector('.as-import [data-a=save]').click();
    await new Promise((ok) => { const w = () => (studio64.assets.meta.models.some((m) => m.name === 'big hill') ? ok() : setTimeout(w, 100)); w(); });
    const m = studio64.assets.meta.models.find((x) => x.name === 'big hill');
    const t1 = performance.now();
    await studio64.assets.ensureModel(m.id);
    return { tris: m.tris, size: m.bounds.max.map((v, i) => Math.round(v - m.bounds.min[i])), importMs: Math.round(tImport), uploadMs: Math.round(performance.now() - t1), id: m.id };
  });
  console.log('big mesh', JSON.stringify(big));
  check('a 39k-triangle mesh imports and loads', big.tris === 39200 && big.importMs < 30000, JSON.stringify(big));

  // ---- 4. place the platform as level geometry in front of Mario and walk onto it ------------
  const plat = models.find((m) => /platform/i.test(m.name));
  const crate = models.find((m) => /crate/i.test(m.name));
  const placed = await page.evaluate(async ({ plat }) => {
    const s = studio64.engine.state().mario;
    const yaw = s.yaw;
    const fx = Math.sin((yaw / 32768) * Math.PI), fz = Math.cos((yaw / 32768) * Math.PI);
    const x = Math.round(s.x + fx * 900), z = Math.round(s.z + fz * 900), y = Math.round(s.y + 800);
    const r = await studio64.studio.handle('asset_place', { model: plat, where: { mode: 'at', x, z, y, snap: false }, mode: 'level', yaw_deg: 0 });
    // save like Claude's tool does
    studio64.studio.engine.patch.areas[r.key] ||= { objects: [], removals: [], warps: [] };
    return { r, x, y, z };
  }, { plat: plat.id });
  // commit through the editor channel so it is stored
  await page.evaluate((recs) => { for (const rec of recs) studio64.ws.send(JSON.stringify({ type: 'edit', op: { type: 'add', key: studio64.engine.areaKey(), summary: 'test place', records: [rec] } })); }, placed.r.records);
  await page.waitForTimeout(800);
  const floorTop = await page.evaluate(({ x, y, z }) => studio64.engine.floor(x, y + 1000, z), placed);
  check('imported platform has collision', Math.abs(floorTop - (placed.y + 120)) < 3, `floor ${floorTop} expected ${placed.y + 120}`);
  const lavaFloor = await page.evaluate(({ x, y, z }) => ({ h: studio64.engine.floor(x + 300, y + 1000, z + 300), type: studio64.engine.M._studio_floor_type(x + 300, y + 1000, z + 300) }), placed);
  check('lava material is a burning floor', lavaFloor.type === 1, JSON.stringify(lavaFloor));
  // teleport Mario onto it and let him stand
  await page.evaluate(({ x, y, z }) => studio64.engine.teleport(x + 300, y + 400, z - 300, 0), placed);
  // wait until he has landed
  await page.waitForFunction((top) => Math.abs(studio64.engine.state().mario.y - top) < 5, placed.y + 120, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500);
  const standing = await page.evaluate(() => studio64.engine.state().mario);
  check('Mario stands on the imported platform', Math.abs(standing.y - (placed.y + 120)) < 5, `mario y ${standing.y}`);
  await page.evaluate(() => studio64.engine.M._studio_walk(0xC000, 15));
  await page.waitForTimeout(1500);
  const walked = await page.evaluate(() => studio64.engine.state().mario);
  check('Mario walks on it', Math.abs(walked.y - (placed.y + 120)) < 130 && Math.hypot(walked.x - standing.x, walked.z - standing.z) > 100, `moved to ${walked.x},${walked.y},${walked.z}`);
  await page.evaluate(({ x, y, z }) => studio64.engine.setCamera(true, [x - 1300, y + 900, z - 1300], [x, y + 100, z], 50), placed);
  await page.waitForTimeout(600);
  await s.shot('platform');

  // ---- 5. the crate as a prop, several times, with the editor -------------------------------
  await page.evaluate(() => studio64.engine.setCamera(false));
  const props = await page.evaluate(async ({ crate, placed }) => {
    const recs = [];
    for (let i = 0; i < 4; i++) {
      const r = await studio64.studio.handle('asset_place', { model: crate, where: { mode: 'at', x: placed.x - 300 + i * 220, z: placed.z + 250, y: placed.y + 400 }, animation: i === 3 ? 'spin' : 'none' });
      recs.push(...r.records);
    }
    for (const rec of recs) studio64.ws.send(JSON.stringify({ type: 'edit', op: { type: 'add', key: studio64.engine.areaKey(), summary: 'test crate', records: [rec] } }));
    await new Promise((r) => setTimeout(r, 600));
    const objs = studio64.engine.objects().filter((o) => recs.some((r) => r.uid === o.uid));
    return { n: recs.length, live: objs.length, top: studio64.engine.floor(recs[0].x, recs[0].y + 1000, recs[0].z), y: recs[0].y };
  }, { crate: crate.id, placed });
  check('crate placed 4 times', props.live === 4, JSON.stringify(props));
  check('crate is solid (its roof plate is the top)', Math.abs(props.top - (props.y + 230)) < 4, `top ${props.top} expected ${props.y + 230}`);
  await page.evaluate(({ x, y, z }) => studio64.engine.setCamera(true, [x - 900, y + 700, z + 1400], [x, y + 150, z + 200], 50), placed);
  await page.waitForTimeout(800);
  await s.shot('crates');
  await page.evaluate(() => studio64.engine.setCamera(false));

  // ---- 6. replace a game texture and see it --------------------------------------------------
  const texRes = await page.evaluate(async () => {
    const A = studio64.assets;
    const seen = A.seenPaths();
    const list = await A.catalog();
    // the level's own ground textures drawn here: a magenta checker on each
    const ts = list.filter((x) => seen.has(x.path) && x.fmt === 'rgba' && x.w >= 32 && x.h >= 32 && /Level textures|Bob-omb/.test(x.group));
    for (const t of ts) {
      const rgba = new Uint8ClampedArray(t.w * t.h * 4);
      for (let i = 0; i < t.w * t.h; i++) { const c = ((i % t.w >> 2) + ((i / t.w | 0) >> 2)) % 2; rgba.set(c ? [255, 0, 255, 255] : [20, 20, 20, 255], i * 4); }
      await A.replaceTexture(t, rgba, t.w, t.h, 'test');
    }
    return { paths: ts.map((t) => t.path), seen: seen.size };
  });
  console.log('replaced', JSON.stringify(texRes));
  await page.waitForTimeout(800);
  await s.shot('texture');
  const magenta = await page.evaluate(async () => {
    const c = await studio64.engine.captureFrame(1);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] > 180 && d[i + 1] < 90 && d[i + 2] > 180) n++;
    return n / (d.length / 16);
  });
  check('replaced texture shows on screen', magenta > 0.01, `${(magenta * 100).toFixed(1)}% magenta`);

  // ---- 7. Mario colours ------------------------------------------------------------------------
  await page.evaluate(() => studio64.studio.handle('mario_colors', { preset: 'luigi' }));
  await page.evaluate(() => { studio64.assetsUI.open('mario'); studio64.assetsUI.lookAtMario(true); });
  await page.waitForTimeout(1500);
  await s.shot('mario_luigi');
  const green = await page.evaluate(async () => {
    const c = await studio64.engine.captureFrame(1);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i + 1] > 110 && d[i] < 70 && d[i + 2] < 90) n++;
    return n / (d.length / 16);
  });
  check('Mario wears green', green > 0.004, `${(green * 100).toFixed(2)}% green`);
  await page.evaluate(() => { studio64.assetsUI.lookAtMario(false); studio64.assetsUI.close(); });

  // ---- 8. a custom sky -------------------------------------------------------------------------
  const skyB64 = fs.readFileSync(path.join(FIX, 'sky.png')).toString('base64');
  await page.evaluate(async (b64) => {
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' });
    const bmp = await createImageBitmap(blob);
    await studio64.assets.setSky(studio64.engine.areaKey(), bmp, { mode: 'panorama', quality: 'n64', name: 'Test sky' });
  }, skyB64);
  await page.evaluate(() => { const s = studio64.engine.state().mario; studio64.engine.setCamera(true, [s.x, s.y + 400, s.z], [s.x + 1000, s.y + 900, s.z + 1000], 60); });
  await page.waitForTimeout(900);
  await s.shot('sky');
  const skyOn = await page.evaluate(() => studio64.engine.M._studio_sky_active());
  check('custom sky is on', skyOn === 1);
  await page.evaluate(() => studio64.engine.setCamera(false));

  // ---- 9. a custom block material ----------------------------------------------------------------
  const matIdx = await page.evaluate(async () => {
    const rgba = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < 1024; i++) rgba.set(((i % 32 >> 3) + ((i >> 5) >> 3)) % 2 ? [0, 220, 255, 255] : [0, 60, 120, 255], i * 4);
    return studio64.assets.saveMaterial({ name: 'test tiles', rgba, w: 32, h: 32 });
  });
  check('custom material slot', matIdx === 48, `index ${matIdx}`);
  await page.waitForTimeout(800);
  const sw = await page.evaluate((i) => !!studio64.engine.materialSwatch(i) && studio64.engine.M._studio_material_texels(i, 0) !== 0, matIdx);
  check('custom material reaches the engine', sw);

  // ---- 10. reload: everything comes back ------------------------------------------------------------
  await page.waitForTimeout(1200);
  await s.reload();
    await page.click('#start').catch(() => {});
    await page.waitForTimeout(1500);
  await page.waitForTimeout(2500);
  const after = await page.evaluate(async (crateId) => {
    const A = studio64.assets;
    const recs = (studio64.engine.patch.areas[studio64.engine.areaKey()]?.objects || []).filter((r) => r.asset);
    const live = studio64.engine.objects().filter((o) => recs.some((r) => r.uid === o.uid)).length;
    const crate = recs.find((r) => r.asset.model === crateId);
    return {
      models: A.meta.models.length, recs: recs.length, live,
      crateTop: crate ? studio64.engine.floor(crate.x, crate.y + 1000, crate.z) - crate.y : null,
      sky: studio64.engine.M._studio_sky_active(), textures: Object.keys(A.meta.textures).length, applied: A.appliedTex.size,
      mario: A.meta.mario?.colors?.cap, mat: studio64.engine.M._studio_material_texels(48, 0) !== 0,
    };
  }, crate.id);
  console.log('after reload', JSON.stringify(after));
  check('after reload: models and placements', after.models === 3 && after.recs === 5 && after.live === 5, JSON.stringify(after));
  check('after reload: collision', Math.abs(after.crateTop - 230) < 4, `${after.crateTop}`);
  check('after reload: sky, texture, Mario, material', after.sky === 1 && after.applied === after.textures && after.textures > 0 && after.mario === '#00a038' && after.mat, JSON.stringify(after));
  await page.evaluate(() => { const s = studio64.engine.state().mario; studio64.engine.setCamera(true, [s.x - 700, s.y + 500, s.z - 700], [s.x, s.y + 100, s.z], 55); });
  await page.waitForTimeout(900);
  await s.shot('reload');

  // ---- 11. the build library and the asset drawer --------------------------------------------------
  await page.evaluate(() => studio64.engine.setCamera(false));
  await page.click('#mode-build');
  await page.waitForTimeout(500);
  await page.click('.lib-tab[data-lib=models]');
  await page.waitForTimeout(300);
  const libCards = await page.locator('#lib-models .as-lib-card').count();
  check('Models tab lists the models', libCards === 3);
  await page.locator('#lib-models .as-lib-main', { hasText: 'crate' }).click();
  await page.waitForTimeout(400);
  const ov = await page.locator('#overlay').boundingBox();
  await page.mouse.move(ov.x + ov.width * 0.5, ov.y + ov.height * 0.62);
  await page.waitForTimeout(400);
  await page.mouse.click(ov.x + ov.width * 0.5, ov.y + ov.height * 0.62);
  await page.waitForTimeout(700);
  const byEditor = await page.evaluate(() => (studio64.engine.patch.areas[studio64.engine.areaKey()]?.objects || []).filter((r) => r.asset).length);
  check('placed with the mouse from the library', byEditor === 6, `${byEditor} placed`);
  await page.keyboard.press('Escape');
  await s.shot('library');

  // ---- 12. click a placed crate: it is selected, the inspector shows the model section ------------
  const crateRec = await page.evaluate((id) => (studio64.engine.patch.areas[studio64.engine.areaKey()].objects || []).find((r) => r.asset?.model === id && r.asset.anim !== 'spin'), crate.id);
  await page.evaluate((r) => studio64.editor.focusOn([r.x, r.y + 100, r.z], 900), crateRec);
  await page.waitForTimeout(900);
  const sp = await page.evaluate((r) => studio64.editor.project([r.x, r.y + 120, r.z]), crateRec);
  const ov2 = await page.locator('#overlay').boundingBox();
  const hit = await page.evaluate((p) => { const h = studio64.editor.pick(p.x, p.y); return h && { slot: h.slot, kind: h.kind, uid: studio64.engine.objects().find((o) => o.slot === h.slot)?.uid }; }, sp);
  console.log('pick at the crate:', JSON.stringify(hit), 'crate uid', crateRec.uid);
  await page.mouse.click(ov2.x + sp.x, ov2.y + sp.y);
  await page.waitForTimeout(700);
  const selInfo = await page.evaluate(() => ({ uid: studio64.editor.sel?.uid, insp: !!document.querySelector('#inspector .as-insp'), name: document.querySelector('#inspector .insp-title')?.textContent }));
  check('clicking a placed prop selects it (inspector: imported model)', selInfo.uid === crateRec.uid && selInfo.insp, JSON.stringify(selInfo));
  await s.shot('inspector');
  if (selInfo.insp) {
    await page.selectOption('#inspector [data-as=anim]', 'spin_bob');
    await page.waitForTimeout(900);
    const anim = await page.evaluate((uid) => (studio64.engine.patch.areas[studio64.engine.areaKey()].objects || []).find((r) => r.uid === uid)?.asset.anim, crateRec.uid);
    check('animation set from the inspector', anim === 'spin_bob', anim);
  }
  await page.keyboard.press('Escape');

  // ---- 13. model settings, pixel editor, materials on blocks -----------------------------------------
  await page.evaluate((id) => studio64.assetsUI.openSettings(studio64.assets.model(id)), crate.id);
  await page.waitForSelector('.as-import .as-mat', { timeout: 15000 });
  await page.waitForTimeout(500);
  await s.shot('settings');
  // the roof plate (second material) becomes ice
  await page.selectOption('.as-import .as-mat >> nth=1 >> [data-m=surface]', 'ice');
  await page.click('.as-import [data-a=save]');
  await page.waitForFunction((id) => studio64.assets.model(id).materials[1].surface === 'ice', crate.id, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const iceType = await page.evaluate((r) => studio64.engine.M._studio_floor_type(r.x, r.y + 1000, r.z), crateRec);
  check('surface changed in the model settings (the crate roof is ice now)', iceType === 0x13, `floor type ${iceType}`);
  await page.click('#assets-btn');
  await page.click('.as-tab[data-tab=textures]');
  await page.waitForSelector('.as-tex', { timeout: 20000 });
  await page.locator('.as-tex').first().click();
  await page.waitForSelector('.as-td [data-a=paint]');
  await page.click('.as-td [data-a=paint]');
  await page.waitForSelector('.px-window');
  await page.waitForTimeout(300);
  await s.shot('pixel_editor');
  await page.click('.px-window [data-a=cancel]');
  await page.click('.as-tab[data-tab=materials]');
  await page.waitForTimeout(800);
  await s.shot('drawer_materials');
  await page.click('.as-drawer [data-a=close]');
  const blockSlot = await page.evaluate(() => {
    const s = studio64.engine.state().mario;
    const rec = { uid: 777001, block: { shape: 0, sx: 400, sy: 200, sz: 400, steps: 0, top: 48, side: 48, surface: 0, flags: 0, color: 0xffffff }, x: s.x + 300, y: s.y, z: s.z + 300, yaw: 0, pitch: 0, roll: 0 };
    const slot = studio64.engine.spawn(rec);
    studio64.editor.focusOn([rec.x, rec.y + 100, rec.z], 1100);
    return slot;
  });
  await page.waitForTimeout(900);
  await s.shot('custom_material_block');
  const cyan = await page.evaluate(async () => {
    const c = await studio64.engine.captureFrame(1);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] < 60 && d[i + 1] > 150 && d[i + 2] > 180) n++;
    return n / (d.length / 16);
  });
  check('a block with the custom material shows it', blockSlot >= 0 && cyan > 0.01, `${(cyan * 100).toFixed(1)}% cyan`);
  await page.click('.lib-tab[data-lib=blocks]');
  await page.waitForTimeout(300);
  const inList = await page.evaluate(() => document.querySelectorAll('#lib-blocks .mat[title="test tiles"]').length);
  check('the custom material is in the block material list', inList >= 1);
  await page.click('#assets-btn');
  await page.waitForTimeout(400);
  await s.shot('drawer_models');
  await page.click('.as-tab[data-tab=textures]');
  await page.waitForTimeout(1500);
  await s.shot('drawer_textures');
  await page.click('.as-tab[data-tab=sky]');
  await page.waitForTimeout(600);
  await s.shot('drawer_sky');

  // ---- 14. a new level made of the platform model -----------------------------------------------------
  await page.evaluate((id) => { if (studio64.editor.active) studio64.editor.exit(); studio64.assetsUI.newLevelFrom(studio64.assets.model(id)); }, plat.id);
  await page.waitForFunction(() => studio64.engine.level === studio64.engine.studioLevel && studio64.engine.state().mario && !studio64.engine.inIntro, null, { timeout: 60000 });
  // a new level opens in build mode (paused): play it
  await page.waitForTimeout(2000);
  await page.evaluate(() => { if (studio64.editor.active) studio64.editor.exit(); });
  await page.waitForFunction(() => Math.abs(studio64.engine.state().mario.y - 120) < 6, null, { timeout: 15000 }).catch(() => {});
  const lvl = await page.evaluate(() => ({ key: studio64.engine.areaKey(), mario: studio64.engine.state().mario }));
  check('new level from a model: Mario lands on it', Math.abs(lvl.mario.y - 120) < 6, JSON.stringify(lvl));
  await page.evaluate(() => { if (studio64.editor.active) studio64.editor.exit(); const m = studio64.engine.state().mario; studio64.engine.setCamera(true, [m.x + 900, m.y + 700, m.z + 900], [m.x, m.y, m.z], 55); });
  await page.waitForTimeout(900);
  await s.shot('model_level');
  await page.evaluate(() => studio64.engine.setCamera(false));


}, { timeout: 900000 });
