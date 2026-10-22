// Things a curious user does: click Mario in build mode and press Delete, Tab during the star
// screen, jump levels twice in a row, jump from build mode (comes back in build mode), place
// objects at the edge of the world, delete everything original around Mario.
// @tags editor stability
// @timeout 600
import { suite } from '../lib/harness.mjs';

await suite('edge cases', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;

  // Mario cannot be selected/deleted
  await s.build();
  await s.viewMario(700, -0.4);
  const mp = await s.eval(() => { const m = studio64.engine.state().mario; return studio64.editor.project([m.x, m.y + 80, m.z]); });
  await s.clickAt(mp.x, mp.y);
  const sel = await s.eval(() => studio64.editor.sel && { name: studio64.editor.sel.name, bhv: studio64.editor.sel.obj?.bhv });
  t.check('clicking Mario does not select him', !sel || !/Mario/i.test(sel.bhv || ''), sel);
  if (sel) await page.keyboard.press('Delete');
  await s.play();
  t.check('Mario still there', !!(await s.mario()));
  t.check('game runs', await s.framesAdvance());

  // Tab during the star select screen
  await s.eval(() => studio64.levelsUI.go({ num: 24, name: "Whomp's Fortress" }));
  await s.until(() => studio64.engine.inIntro, null, 20000);
  await page.focus('#canvas');
  await page.keyboard.press('Tab');
  await s.wait(500);
  const during = await s.eval(() => ({ intro: studio64.engine.inIntro, building: studio64.editor.active }));
  t.log('Tab during the star screen ->', JSON.stringify(during));
  await s.skipIntro();
  await s.until(() => !studio64.engine.inIntro && studio64.engine.level === 24, null, 90000);
  await s.wait(1500);
  t.check('no crash after Tab on the star screen', !(await s.crashed()) && await s.framesAdvance());
  if (await s.eval(() => studio64.editor.active)) {
    const cam = await s.eval(() => studio64.editor.cam);
    const m = await s.mario();
    t.check('build camera is near Mario in the new level', Math.hypot(cam.x - m.x, cam.z - m.z) < 8000, { cam, m });
    await s.play();
  }
  t.eq('in Whomp\'s Fortress', await s.eval(() => studio64.engine.level), 24);

  // two jumps right after each other: we end in the second one
  await s.eval(() => { studio64.levelsUI.go({ num: 9, name: 'BoB' }); setTimeout(() => studio64.levelsUI.go({ num: 12, name: 'JRB' }), 300); });
  await s.skipIntro();
  await s.until(() => !studio64.engine.inIntro && studio64.engine.level === 12, null, 60000);
  await s.skipIntro();
  await s.wait(1000);
  t.eq('double jump ends in the second level', await s.eval(() => studio64.engine.level), 12);
  t.check('game runs after the double jump', await s.framesAdvance());

  // jumping from build mode comes back in build mode
  await s.build();
  await page.keyboard.press('Control+k');
  await page.fill('#launcher-search', 'bob-omb');
  await page.keyboard.press('Enter');
  await s.skipIntro();
  await s.arrive(9);
  await s.until(() => studio64.editor.active, null, 8000);
  t.check('jump from build mode lands in build mode', await s.eval(() => studio64.editor.active));

  // objects at the edge of the world stay inside it
  const placed = await s.eval(() => {
    const ed = studio64.editor;
    ed.startPlacing({ entry: 'goomba' });
    const pose = ed.placementPose({ x: 18000, y: 0, z: -19500, nx: 0, ny: 1, nz: 0 }, ed.placing, 0);
    ed.cancelPlacing();
    return pose.p;
  });
  t.check('placement is kept inside the world (±16384: the engine\'s level boundary)', Math.abs(placed[0]) < 16384 && Math.abs(placed[2]) < 16384, placed);

  // delete every original object near Mario, then play
  const n = await s.eval(() => {
    const ed = studio64.editor, m = studio64.engine.state().mario;
    const near = studio64.engine.objects().filter((o) => !o.uid && o.cat >= 0 && Math.hypot(o.x - m.x, o.z - m.z) < 3000);
    for (const o of near) { ed.select(o.slot); ed.deleteSelected(); }
    return near.length;
  });
  t.check('deleted original objects', n > 0, n);
  await s.wait(800);
  await s.play();
  t.check('game runs after deleting them', !(await s.crashed()) && await s.framesAdvance());
  await s.build();
  for (let i = 0; i < n; i++) { await page.keyboard.press('Control+z'); await s.wait(150); }
  await s.wait(1200);
  t.eq('undo restored them all', (await s.changes()).length, 0);
});
