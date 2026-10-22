// Build mode UI for objects: the Motion section and the path tool (click to add points,
// drag them), the scene panel (list, shift-click multi-select, box-select, align as one undo
// step, hide/lock, rename), prefabs (save, place), copy & paste, group delete + undo.
// @tags objects editor
// @timeout 600
import { suite } from '../lib/harness.mjs';

await suite('objects ui', async (t) => {
  const s = await t.open({ level: 9 });
  await s.newLevel('flat', 'UI test');
  await s.build();
  await s.viewMario(2400, -1.2);
  const add = (r) => s.eval(async (r) => {
    const g = await import('/js/generators.js');
    const rec = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), pitch: 0, roll: 0, yaw: 0, ...r, block: g.blockDefaults(r.block), name: r.name };
    studio64.editor.records().push(rec);
    studio64.objects.store.commit({ type: 'add', summary: `Built ${rec.name}`, records: [rec] });
    return { uid: rec.uid, slot: studio64.engine.spawn(rec) };
  }, r);
  const m = await s.mario();
  const b1 = await add({ name: 'Platform A', x: m.x - 400, y: m.y + 200, z: m.z, block: { shape: 0, sx: 300, sy: 60, sz: 300, top: 'wood planks' } });
  await s.settle(500);
  await s.eval((u) => { const o = studio64.engine.objects().find((x) => x.uid === u); studio64.editor.select(o.slot); }, b1.uid);
  await s.wait(400);

  // ---- motion: the Path chip starts the path tool ----
  await s.page.click('#inspector .om-chip[data-kind=path]');
  await s.wait(700);
  t.check('the path tool is on', await s.eval(() => !!studio64.objects.motion.edit));
  t.check('its hint is shown', /Path: /.test(await s.page.locator('#tool-hint').innerText()));
  // click two more points on the screen
  const pts = await s.eval(() => {
    const ed = studio64.editor; const { w, h } = ed.size();
    return [[w * 0.62, h * 0.5], [w * 0.62, h * 0.3]];
  });
  for (const [x, y] of pts) await s.clickAt(x, y);
  await s.settle(500);
  let rec = (await s.records()).find((r) => r.uid === b1.uid);
  t.eq('two clicks added two points (plus the default one)', rec.motion?.path?.points?.length, 4);
  // drag the last point
  const last = await s.eval(() => { const e = studio64.objects.motion.edit; const q = studio64.editor.project(e.points[e.points.length - 1]); return [q.x, q.y]; });
  await s.drag(last[0], last[1], last[0] - 120, last[1] + 40, { steps: 8 });
  await s.settle(400);
  const rec2 = (await s.records()).find((r) => r.uid === b1.uid);
  t.check('dragging a point moves it', JSON.stringify(rec2.motion.path.points.at(-1)) !== JSON.stringify(rec.motion.path.points.at(-1)), { before: rec.motion.path.points.at(-1), after: rec2.motion.path.points.at(-1) });
  await s.shot('path_tool');
  // right-click deletes a point
  const third = await s.eval(() => { const e = studio64.objects.motion.edit; const q = studio64.editor.project(e.points[2]); return [q.x, q.y]; });
  await s.clickAt(third[0], third[1], { button: 'right' });
  await s.settle(400);
  rec = (await s.records()).find((r) => r.uid === b1.uid);
  t.eq('right-click deleted a point', rec.motion.path.points.length, 3);
  await s.key('Enter');
  await s.wait(300);
  t.check('Enter ends the path tool', !(await s.eval(() => studio64.objects.motion.edit)));
  // speed slider in the path card
  await s.eval(() => { const r = document.querySelector('#inspector .om-card input[type=range]'); r.value = 20; r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); });
  await s.settle(400);
  rec = (await s.records()).find((r) => r.uid === b1.uid);
  t.eq('the speed slider saves the speed', rec.motion.path.speed, 20);
  await s.shot('motion_inspector');

  // ---- scene panel ----
  const b2 = await add({ name: 'Platform B', x: m.x + 100, y: m.y + 100, z: m.z + 300, block: { shape: 0, sx: 200, sy: 60, sz: 200 } });
  const b3 = await add({ name: 'Platform C', x: m.x + 500, y: m.y + 50, z: m.z - 300, block: { shape: 0, sx: 200, sy: 60, sz: 200 } });
  await s.settle(500);
  await s.key('KeyO');
  await s.wait(600);
  t.check('O opens the scene panel', await s.eval(() => !document.querySelector('#scene-panel').hidden));
  const names = await s.page.locator('#scene-panel .sp-row .sp-name').allInnerTexts();
  t.check('it lists the blocks', ['Platform A', 'Platform B', 'Platform C'].every((n) => names.some((x) => x.toLowerCase() === n.toLowerCase())), names.slice(0, 10));
  const row = (n) => s.page.locator('#scene-panel .sp-row', { hasText: n }).first();
  await row('Platform A').click();
  await s.wait(200);
  t.log('multi after A', await s.eval(() => studio64.objects.scene.multi.size));
  await row('Platform B').click({ modifiers: ['Shift'] });
  await s.wait(200);
  t.log('multi after B', await s.eval(() => studio64.objects.scene.multi.size));
  await row('Platform C').click({ modifiers: ['Shift'] });
  await s.wait(300);
  t.log('multi after C', await s.eval(() => studio64.objects.scene.multi.size));
  t.eq('shift-click selects several', await s.eval(() => studio64.objects.scene.multi.size), 3);
  t.check('the group tools show', /3 selected/i.test(await s.page.locator('#scene-panel .sp-multi').innerText()));
  await s.shot('scene_multi');
  const changes0 = (await s.changes()).length;
  await s.page.click('#scene-panel [data-al="0:min"]');
  await s.settle(600);
  const recs = await s.records();
  const xs = [b1, b2, b3].map((b) => { const r = recs.find((x) => x.uid === b.uid); return r.x - r.block.sx / 2; });
  t.check('align left lines them up', Math.max(...xs) - Math.min(...xs) < 2, xs);
  t.eq('aligning is one undo step', (await s.changes()).length, changes0 + 1);
  // group move with the gizmo: the others follow (move the primary through the inspector)
  const before = await s.eval((u) => studio64.objects.store.recordOf(u).z, b2.uid);
  await s.eval(() => { const ed = studio64.editor; const p = ed.selPose(); p.p[2] += 500; ed.applyPose(p); ed.commitPose(p, 'Moved'); });
  await s.settle(600);
  const afterZ = await s.eval((u) => studio64.objects.store.recordOf(u).z, b2.uid);
  t.near('moving one moves the whole group', afterZ - before, 500, 2);

  // ---- prefab: save the three, place them again ----
  await s.page.click('#scene-panel [data-g=prefab]');
  await s.page.fill('#scene-panel .sp-prefab input', 'Three platforms');
  await s.page.click('#scene-panel .sp-prefab button');
  await s.settle(500);
  t.eq('the prefab is saved', await s.eval(() => studio64.objects.store.game('prefabs', []).map((p) => [p.name, p.items.length])), [['Three platforms', 3]]);
  await s.page.click('.lib-tab[data-lib=objects]');
  await s.page.click('.mine-chip');
  await s.wait(300);
  await s.page.locator('#obj-grid .obj.mine.prefab').first().click();
  await s.wait(300);
  const gp = await s.groundPoint({ kind: null, rows: [0.85, 0.55] });
  await s.page.mouse.move((await s.box()).x + gp.x, (await s.box()).y + gp.y);
  await s.wait(300);
  await s.clickAt(gp.x, gp.y);
  await s.settle(700);
  t.eq('placing the prefab adds its three blocks', (await s.records()).filter((r) => r.block).length, 6);
  await s.shot('prefab_placed');

  // ---- copy & paste, box select, group delete + undo ----
  await s.eval((u) => { const o = studio64.engine.objects().find((x) => x.uid === u); studio64.objects.scene.multi.clear(); studio64.editor.select(o.slot); }, b3.uid);
  await s.page.keyboard.press('Control+KeyC');
  await s.page.keyboard.press('Control+KeyV');
  await s.wait(300);
  const gp2 = await s.groundPoint({ kind: null, rows: [0.4, 0.2] });
  await s.page.mouse.move((await s.box()).x + gp2.x, (await s.box()).y + gp2.y);
  await s.wait(300);
  await s.clickAt(gp2.x, gp2.y);
  await s.settle(600);
  t.eq('copy & paste adds a copy', (await s.records()).filter((r) => r.block).length, 7);
  await s.eval(() => { studio64.editor.select(null); studio64.objects.scene.toggle(false); });
  await s.viewMario(2600, -1.2);
  const { w, h } = await s.eval(() => studio64.editor.size());
  await s.drag(w * 0.06, h * 0.22, w * 0.8, h * 0.97, { steps: 10 });
  await s.wait(300);
  const n = await s.eval(() => studio64.objects.scene.multi.size);
  const nBlocks = await s.eval(() => studio64.objects.scene.selectedItems().filter((x) => x.rec?.block).length);
  t.check('a box drag selects everything inside it', nBlocks >= 5, { n, nBlocks });
  await s.key('Delete');
  await s.settle(700);
  const left = (await s.records()).filter((r) => r.block).length;
  t.eq('Delete removes the whole selection', left, 7 - nBlocks);
  await s.page.click('#build-undo');
  await s.settle(900);
  t.eq('one undo brings them all back', (await s.records()).filter((r) => r.block).length, 7);

  // ---- hide, lock, rename ----
  await s.eval(() => studio64.objects.scene.toggle(true));
  await s.wait(500);
  const rA = row('Platform A');
  await rA.hover();
  await rA.locator('[data-t=hide]').click();
  await s.settle(400);
  t.eq('hide makes it invisible while building', await s.eval((u) => studio64.engine.objects().find((o) => o.uid === u)?.visible, b1.uid), 0);
  await row('Platform A').locator('[data-t=hide]').click();
  await s.settle(300);
  await row('Platform A').locator('[data-t=lock]').click();
  await s.settle(300);
  t.check('lock is saved', await s.eval((u) => studio64.objects.store.recordOf(u).editor?.locked === true, b1.uid));
  await s.eval((u) => { const o = studio64.engine.objects().find((x) => x.uid === u); studio64.editor.frameSelection?.(); return o; }, b1.uid);
  await row('Platform B').dblclick({ position: { x: 60, y: 12 } });
  await s.wait(200);
  const inp = s.page.locator('#scene-panel .sp-rename');
  if (await inp.count()) { await inp.fill('Bridge piece'); await inp.press('Enter'); }
  await s.settle(400);
  t.eq('double-click renames', await s.eval((u) => studio64.objects.store.recordOf(u).name, b2.uid), 'Bridge piece');
  await s.shot('scene_panel');
});
