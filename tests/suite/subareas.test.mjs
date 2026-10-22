// Sub-areas of custom levels (keys c:<id>:<n>) work everywhere main areas do: stars count for the
// level (star screen, castle pause pages, level cards, collecting), the validator, the edit list,
// the scene panel, custom objects and imported models in them, duplicating a level, the project
// file and the standalone player's data.
// @tags world
// @timeout 900
import fs from 'node:fs';
import path from 'node:path';
import { suite, api, URL_BASE, ROOT } from '../lib/harness.mjs';

await suite('sub-areas everywhere', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  const id = await s.newLevel('flat', 'Sub Test');
  t.log('level', id);

  // a star in the main area
  const main = await s.eval(() => {
    const f = studio64.worldFlow, m = studio64.engine.state().mario;
    const rec = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), entry: 'star', star: { name: 'Main Star' }, name: 'Main Star', bparams: 0, x: Math.round(m.x + 600), y: Math.round(m.y + 150), z: Math.round(m.z), yaw: 0, pitch: 0, roll: 0, scale: 1 };
    f.addRecord(rec, 'Placed a star');
    return rec.uid;
  });

  // ---- a sub-area ----
  const made = await s.eval(async (lid) => studio64.worldFlow.createArea(lid, { name: 'Cellar', template: 'room' }), id);
  t.must('the server made area 2', made?.index === 2, made);
  await s.until((lid) => studio64.levels.find((l) => l.id === lid)?.areas?.some((a) => a.name === 'Cellar'), id);
  await s.eval((lid) => studio64.worldFlow.goArea({ custom: lid, area: 2 }), id);
  await s.until((k) => studio64.engine.areaKey() === k && !studio64.engine.inIntro && !!studio64.engine.state().mario, `c:${id}:2`, 40000);
  await s.wait(800);
  const key2 = await s.eval(() => studio64.engine.areaKey());
  t.eq('in the sub-area', key2, `c:${id}:2`);

  // content: a star, a block, a death zone, a custom object
  const sub = await s.eval(() => {
    const f = studio64.worldFlow, e = studio64.engine, m = e.state().mario;
    const uid = () => 1 + Math.floor(Math.random() * 0x7efffffe);
    const star = { uid: uid(), entry: 'star', star: { name: 'Cellar Star' }, name: 'Cellar Star', bparams: 0, x: Math.round(m.x), y: Math.round(m.y + 260), z: Math.round(m.z - 500), yaw: 0, pitch: 0, roll: 0, scale: 1 };
    f.addRecord(star, 'Placed a star');
    const block = { uid: uid(), block: { shape: 0, sx: 200, sy: 100, sz: 200, top: 3, side: 3, surface: 0, flags: 0, color: 0xffffff, steps: 0 }, name: 'Crate block', x: Math.round(m.x + 500), y: Math.round(m.y), z: Math.round(m.z), yaw: 0, pitch: 0, roll: 0 };
    f.addRecord(block, 'Placed a block');
    const zone = f.makeWarpRecord('death', { x: m.x, y: m.y - 2000, z: m.z, size: [800, 200, 800] });
    f.addRecord(zone, 'Placed a death zone');
    // a custom object (definition in @game, copy here)
    const st = studio64.objects.store;
    const did = 'dsub' + Math.random().toString(36).slice(2, 6);
    st.setGame('objdefs', [...studio64.objects.defs(), { id: did, name: 'Cellar guard', model: 'goomba', move: 'stand', health: 1, damage: 1, stomp: true, defeat: 'squish' }], 'Made Cellar guard');
    const actor = { uid: uid(), bhv: 'bhvStudioActor', model: 'goomba', def: did, x: Math.round(m.x - 500), y: Math.round(m.y), z: Math.round(m.z), yaw: 0, pitch: 0, roll: 0, bparams: 0, scale: 1, name: 'Cellar guard' };
    st.records().push(actor);
    e.spawn(actor);
    st.commit({ type: 'add', summary: 'Placed Cellar guard', records: [actor] });
    return { star: star.uid, block: block.uid, zone: zone.uid, actor: actor.uid };
  });
  await s.wait(1500);

  // an imported model placed in the sub-area
  const FIX = path.join(ROOT, 'tests', 'fixtures');
  const files = await page.evaluateHandle((list) => list.map((f) => new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name)), [{ name: 'crate.glb', b64: fs.readFileSync(path.join(FIX, 'crate.glb')).toString('base64') }]);
  await page.evaluate((f) => studio64.assetsUI.openImport(f), files);
  await page.waitForSelector('.as-import [data-a=save]:not([disabled])', { timeout: 90000 });
  await page.click('.as-import [data-a=save]');
  await page.waitForFunction(() => studio64.assets.meta.models.length === 1, null, { timeout: 60000 });
  const model = await s.eval(async () => {
    const m = studio64.assets.meta.models[0];
    const mario = studio64.engine.state().mario;
    const r = await studio64.studio.handle('asset_place', { model: m.id, where: { mode: 'at', x: mario.x + 300, z: mario.z + 300, y: mario.y + 200 } });
    for (const rec of r.records) studio64.ws.send(JSON.stringify({ type: 'edit', op: { type: 'add', key: studio64.engine.areaKey(), summary: 'Placed a crate', records: [rec] } }));
    return { uid: r.records[0]?.uid, key: r.key };
  });
  t.eq('the model went into the sub-area', model.key, `c:${id}:2`);
  await s.wait(1500);

  // ---- consumers ----
  const proj = await s.export();
  const a2 = proj.areas[`c:${id}:2`];
  t.check('the server keeps the sub-area content', a2 && [sub.star, sub.block, sub.zone, sub.actor, model.uid].every((u) => a2.objects.some((r) => r.uid === u)), a2?.objects?.map((r) => r.name));

  const info = await s.eval(() => {
    const L = studio64.levelsUI;
    const intro = L.introInfo(37);
    const pause = L.pauseLevels();
    return { intro: intro.stars.map((x) => x.name), pause, card: L.starCount(`c:${studio64.engine.customLevel}`) };
  });
  t.check('star select lists both areas\' stars', info.intro.includes('Main Star') && info.intro.includes('Cellar Star'), info.intro);
  t.check('castle pause page counts both stars', info.pause.some((p) => p.name === 'Sub Test' && p.stars.length === 2), info.pause);
  t.eq('level card counts both stars', info.card, '★ 0/2');

  // scene panel: the sub-area's things
  const scene = await s.eval(() => studio64.studio.handle('objects_scene', {}));
  const names = scene.objects.map((o) => o.name);
  t.check('scene panel lists the sub-area content', ['Cellar Star', 'Crate block', 'Cellar guard'].every((n) => names.includes(n)), names);
  t.check('the custom object runs in the sub-area', await s.eval((u) => studio64.engine.objects().some((o) => o.uid === u && o.bhv === 'bhvStudioActor'), sub.actor));

  // the edit list names the area
  const where = await s.eval(() => [...document.querySelectorAll('#edits-list .emeta')].map((x) => x.textContent));
  t.check('edit list says "Sub Test · Cellar"', where.some((w) => w.startsWith('Sub Test · Cellar')), where.slice(0, 5));
  t.check('no edit is called "Custom level"', !where.some((w) => w.startsWith('Custom level')), where.slice(0, 8));

  // validator: no false "deleted level" for the sub-area, names it, stars counted for the level
  const val = await s.eval(() => studio64.testing.validator.run());
  const bad = val.problems.filter((p) => p.key === `c:${id}:2` && /deleted level/i.test(p.title));
  t.check('validator: no "deleted level" for the sub-area', bad.length === 0, bad);
  t.check('validator names the sub-area', val.problems.filter((p) => p.key.endsWith(':2')).every((p) => p.level === 'Sub Test · Cellar'), val.problems.map((p) => `${p.key} ${p.level}: ${p.title}`));
  t.check('validator: the level has stars (no "No stars" because the sub-area has them)', !val.problems.some((p) => /No stars/.test(p.title)), val.problems.map((p) => p.title));

  // collecting the cellar star counts for the level
  t.log('build mode before collecting:', await s.eval(() => !!studio64.editor?.active), 'modal:', await s.eval(() => !!document.querySelector('.as-import')));
  await s.play();
  await s.eval((u) => { const r = studio64.engine.objects().find((o) => o.uid === u); studio64.engine.teleport(r.x, r.y - 60, r.z, 0); }, sub.star);
  const got = await s.until((k) => !!studio64.world.progress()[k], `c:${id}:2|${sub.star}`, 30000);
  t.check('the cellar star is collected', got, await s.eval((u) => ({ m: studio64.engine.state().mario, star: studio64.engine.objects().find((o) => o.uid === u), key: studio64.engine.areaKey() }), sub.star));
  await s.wait(1500);
  t.eq('level card: 1 of 2', await s.eval((lid) => studio64.levelsUI.starCount(`c:${lid}`), id), '★ 1/2');
  t.check('pause page: one star of two', await s.eval((lid) => studio64.levelsUI.pauseLevels().find((p) => p.name === 'Sub Test')?.stars === (studio64.levelsUI.introInfo(37).stars[0]?.name === 'Main Star' ? '01' : '10'), id));

  // ---- duplicate the level: the copy has its own sub-area, doors lead inside the copy ----
  // (a door pair between the areas first)
  await s.eval(async (lid) => {
    const f = studio64.worldFlow;
    const d2 = f.makeWarpRecord('door', { x: 0, y: 0, z: 0, to: { custom: lid, area: 1 } });
    f.addRecordIn(`c:${lid}:2`, d2, 'Door to main');
    const d1 = f.makeWarpRecord('door', { x: 400, y: 0, z: 0, to: { custom: lid, area: 2, uid: d2.uid } });
    f.addRecordIn(`c:${lid}`, d1, 'Door to cellar');
  }, id);
  await s.wait(1200);
  const before = (await s.export()).areas;
  await s.eval((lid) => studio64.ws.send(JSON.stringify({ type: 'level_duplicate', id: lid })), id);
  await s.until((n) => studio64.levels.length === n, 2, 15000);
  const dup = await s.eval(() => studio64.levels[1]);
  const after = (await s.export()).areas;
  const dupDoor = (after[`c:${dup.id}`]?.objects || []).find((r) => r.warp?.kind === 'door' && r.warp.to?.area === 2);
  t.check('the copy has the sub-area', !!after[`c:${dup.id}:2`] && after[`c:${dup.id}:2`].objects.length === before[`c:${id}:2`].objects.length, Object.keys(after));
  t.check('the copy has the area list', dup.areas?.some((a) => a.name === 'Cellar'), dup.areas);
  t.check('the copy\'s door leads into the copy\'s cellar', dupDoor?.warp?.to?.custom === dup.id && after[`c:${dup.id}:2`].objects.some((r) => r.uid === dupDoor.warp.to.uid), dupDoor?.warp);

  // ---- project file and the standalone player's data ----
  const buf = Buffer.from(await (await fetch(`${URL_BASE}/api/projects/${s.projectId}/export.s64hack`)).arrayBuffer());
  const imp = await (await fetch(`${URL_BASE}/api/hub/import`, { method: 'POST', body: buf })).json();
  t.must('the project file imports', !!imp.id, imp);
  const play = await api(`/api/projects/${imp.id}/play.json`);
  const pa = play.patch?.areas || play.areas || {};
  t.check('imported project: sub-area content', (pa[`c:${id}:2`]?.objects || []).some((r) => r.name === 'Cellar Star'), Object.keys(pa));
  t.check('imported project: the area list', play.levels?.find((l) => l.id === id)?.areas?.some((a) => a.name === 'Cellar'), play.levels);
  t.check('imported project: the custom object definition', (pa['@game']?.objdefs || []).some((d) => d.name === 'Cellar guard'));
  t.check('imported project: the model file', Object.keys(play.assets?.files || {}).length >= 1 && (play.assets?.models || []).length === 1);
  await s.shot('cellar');
});
