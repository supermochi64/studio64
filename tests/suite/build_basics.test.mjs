// Build mode with the mouse: place a block, select, inspector fields, rotate, duplicate,
// delete, undo, redo, drop to ground, persistence after a reload.
// @tags smoke editor
import { suite } from '../lib/harness.mjs';

await suite('build basics', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  await s.build();
  t.check('library shown in build mode', await page.isVisible('#library'));
  t.check('build bar shown', await page.isVisible('#build-bar'));
  t.check('world paused', await s.eval(() => studio64.editor.active));

  // place a box by clicking on the ground
  await page.click('.lib-tab[data-lib=blocks]');
  await page.click('.preset:has-text("Box")');
  t.eq('tool is place', await s.eval(() => studio64.editor.tool), 'place');
  const gp = await s.groundPoint();
  t.must('found ground on screen', !!gp);
  await s.clickAt(gp.x, gp.y);
  await page.keyboard.press('Escape');
  await s.settle();
  let recs = await s.records();
  const box = recs.filter((r) => r.block).pop();
  t.must('box record created', !!box, recs);
  t.eq('box shape', box.block.shape, 0);
  const ex1 = await s.export();
  t.check('server stored the box', JSON.stringify(ex1.areas).includes(String(box.uid)));
  t.check('placed box is in the engine', await s.eval((uid) => studio64.engine.objects().some((o) => o.uid === uid), box.uid));

  // select it by clicking on it
  const sp = await s.eval((uid) => {
    const r = studio64.editor.records().find((x) => x.uid === uid);
    return studio64.editor.project([r.x, r.y + r.block.sy / 2, r.z]);
  }, box.uid);
  await s.clickAt(sp.x, sp.y);
  const sel = await s.eval(() => studio64.editor.sel && { uid: studio64.editor.sel.uid, kind: studio64.editor.sel.kind });
  t.eq('clicking the box selects it', sel, { uid: box.uid, kind: 'block' });
  t.check('inspector visible', await page.isVisible('#inspector'));

  // inspector: change X position and width
  const x0 = box.x;
  await page.fill('#inspector input[data-f=x]', String(x0 + 300));
  await page.press('#inspector input[data-f=x]', 'Enter');
  await s.settle();
  recs = await s.records();
  t.eq('inspector X moved the box', recs.find((r) => r.uid === box.uid)?.x, x0 + 300);
  await page.fill('#inspector input[data-b=sx]', '500');
  await page.press('#inspector input[data-b=sx]', 'Enter');
  await s.settle();
  recs = await s.records();
  t.eq('inspector W resized the box', recs.find((r) => r.uid === box.uid)?.block.sx, 500);
  t.check('box still selected after resize', await s.eval((uid) => studio64.editor.sel?.uid === uid, box.uid));
  // shape buttons
  await page.click('#inspector [data-shape="1"]');
  await s.settle();
  t.eq('shape -> ramp', (await s.records()).find((r) => r.uid === box.uid)?.block.shape, 1);
  await page.click('#inspector [data-shape="0"]');
  await s.settle();
  // material pick
  await page.click('#inspector [data-matpick=top]');
  await page.click('#inspector .mat-pop .mat >> nth=7');
  await s.settle();
  t.eq('top material -> red brick', (await s.records()).find((r) => r.uid === box.uid)?.block.top, 7);

  // rotate with R
  await page.keyboard.press('KeyR');
  await s.settle();
  t.eq('R rotates 45 degrees', (await s.records()).find((r) => r.uid === box.uid)?.yaw, 8192);

  // duplicate
  const before = (await s.records()).length;
  await page.keyboard.press('Control+d');
  await s.settle();
  recs = await s.records();
  t.eq('Ctrl+D duplicates', recs.length, before + 1);
  const dup = recs[recs.length - 1];
  t.check('duplicate selected', await s.eval((uid) => studio64.editor.sel?.uid === uid, dup.uid));
  t.check('duplicate is offset', Math.hypot(dup.x - box.x - 300, dup.z - box.z) > 100, { dup, box });

  // delete the duplicate
  await page.keyboard.press('Delete');
  await s.settle();
  recs = await s.records();
  t.check('Delete removes it', !recs.some((r) => r.uid === dup.uid));
  t.check('deleted object gone from the engine', !(await s.eval((uid) => studio64.engine.objects().some((o) => o.uid === uid), dup.uid)));
  t.check('nothing selected after delete', !(await s.eval(() => studio64.editor.sel)));

  // undo brings it back
  await page.keyboard.press('Control+z');
  await s.wait(900);
  recs = await s.records();
  t.check('Ctrl+Z restores the deleted block', recs.some((r) => r.uid === dup.uid));
  t.check('restored block is in the engine', await s.eval((uid) => studio64.engine.objects().some((o) => o.uid === uid), dup.uid));
  const changesAfterUndo = await s.changes();
  t.check('undo removed the "Removed" change', !changesAfterUndo.some((c) => /^Removed/.test(c)), changesAfterUndo);
  // redo deletes it again (and keeps the duplicate's own change)
  await page.keyboard.press('Control+Shift+z');
  await s.wait(900);
  recs = await s.records();
  const changesAfterRedo = await s.changes();
  t.check('Ctrl+Shift+Z redoes the delete', !recs.some((r) => r.uid === dup.uid));
  t.check('redo brings the change back', /^Removed/.test(changesAfterRedo[changesAfterRedo.length - 1]), changesAfterRedo);
  t.check('redo keeps the duplicate change', changesAfterRedo.some((c) => /^Duplicated/.test(c)), changesAfterRedo);
  t.check('redo removed it from the engine', !(await s.eval((uid) => studio64.engine.objects().some((o) => o.uid === uid), dup.uid)));
  // undo + Ctrl+Y redo of a move
  await page.keyboard.press('Control+z');
  await s.wait(700);
  t.check('undo again restores', (await s.records()).some((r) => r.uid === dup.uid));
  await page.keyboard.press('Control+y');
  await s.wait(700);
  t.check('Ctrl+Y redoes too', !(await s.records()).some((r) => r.uid === dup.uid));
  await page.keyboard.press('Control+y');
  await s.wait(500);
  t.eq('Ctrl+Y with nothing to redo changes nothing', (await s.changes()).length, changesAfterRedo.length);
  // the toolbar buttons
  await page.click('#build-undo');
  await s.wait(700);
  t.check('undo button works', (await s.records()).some((r) => r.uid === dup.uid));
  await page.click('#build-redo');
  await s.wait(700);
  t.check('redo button works', !(await s.records()).some((r) => r.uid === dup.uid));

  // raise the box with the inspector, then G drops it
  await s.eval((uid) => { const o = studio64.engine.objects().find((x) => x.uid === uid); studio64.editor.select(o.slot); }, box.uid);
  const y0 = (await s.records()).find((r) => r.uid === box.uid).y;
  await page.fill('#inspector input[data-f=y]', String(y0 + 800));
  await page.press('#inspector input[data-f=y]', 'Enter');
  await s.settle();
  await page.click('#canvas', { position: { x: 5, y: 5 }, trial: true }).catch(() => {});
  await s.eval(() => document.activeElement?.blur());
  await page.keyboard.press('KeyG');
  await s.settle();
  const yG = (await s.records()).find((r) => r.uid === box.uid).y;
  t.check('G drops the box back to the ground', Math.abs(yG - y0) < 60, { y0, yG });

  // Esc deselects
  await page.keyboard.press('Escape');
  t.check('Esc deselects', !(await s.eval(() => studio64.editor.sel)));
  t.check('library back after deselect', await page.isVisible('#lib-blocks'));

  // play mode: the box has collision (Mario stands on it)
  const top = await s.eval((uid) => { const r = studio64.editor.records().find((x) => x.uid === uid); return { x: r.x, y: r.y + r.block.sy, z: r.z }; }, box.uid);
  await s.play();
  await s.eval((p) => studio64.engine.teleport(p.x, p.y + 300, p.z, 0), top);
  await s.until((y) => Math.abs(studio64.engine.state().mario.y - y) < 30 && studio64.engine.state().mario.forwardVel === 0, top.y, 20000);
  const m = await s.mario();
  t.near('mario lands on top of the box', m.y, top.y, 30);

  // reload: still there
  await page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 120000 });
  await page.waitForFunction(() => studio64.engine?.ready, null, { timeout: 60000 });
  await s.wait(1500);
  t.check('box persists after reload', await s.eval((uid) => studio64.engine.objects().some((o) => o.uid === uid), box.uid));
  await s.shot('after_reload');
});
