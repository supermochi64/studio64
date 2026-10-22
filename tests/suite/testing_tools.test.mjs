// Play-testing tools: debug overlay (collision, hitboxes, Mario info, FPS, timer), frame advance,
// save states, the save file, the level validator with planted problems (Show, Fix), play from here.
// @tags testing
// @timeout 600
import { suite } from '../lib/harness.mjs';

const marioTimer = (s) => s.eval(() => JSON.parse(studio64.engine.M.UTF8ToString(studio64.engine.M._studio_debug_mario_json())).timer);

await suite('testing tools', async (t) => {
  const s = await t.open({ level: 9 });
  await s.page.waitForFunction(() => window.studio64.testing && studio64.engine.state().mario, null, { timeout: 60000 });

  // ---- debug overlay ----
  await s.page.click('#test-btn');
  for (const k of ['collision', 'hitboxes', 'info', 'fps', 'timer']) await s.page.click(`[data-opt=${k}]`);
  await s.wait(2500);
  const ov = await s.eval(() => {
    const c = document.querySelector('.tt-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4 * 16) if (d[i] > 0) n++;
    return { painted: n, info: document.querySelector('.tt-info').textContent, timer: document.querySelector('.tt-timer').textContent };
  });
  t.check('collision and hitbox overlay draws', ov.painted > 1000, ov.painted);
  t.check('Mario info shows his action by name', /ACTION\s*idle/.test(ov.info), ov.info.slice(0, 80));
  t.check('speedrun timer runs', /0:0\d\.\d\d/.test(ov.timer) && !/0:00\.00/.test(ov.timer), ov.timer);
  await s.shot('overlay');

  // ---- frame advance ----
  await s.eval(() => studio64.testing.setFrozen(true));
  const t1 = await marioTimer(s);
  await s.wait(1200);
  const t2 = await marioTimer(s);
  t.eq('pause stops the game', t2, t1);
  await s.eval(() => studio64.testing.step(5));
  // a busy machine draws few frames a second: wait for them, then make sure no more come
  await s.page.waitForFunction((t) => JSON.parse(studio64.engine.M.UTF8ToString(studio64.engine.M._studio_debug_mario_json())).timer >= t + 5, t2, { timeout: 20000 }).catch(() => {});
  await s.wait(1500);
  t.eq('frame advance runs exactly 5 frames', (await marioTimer(s)) - t2, 5);
  await s.shot('paused');
  await s.eval(() => studio64.testing.setFrozen(false));
  await s.wait(800);
  t.check('resume runs the game again', (await marioTimer(s)) > t2 + 5);
  await s.eval(() => studio64.testing.setSlow(4));
  const a0 = await marioTimer(s);
  await s.wait(2000);
  const slow = (await marioTimer(s)) - a0;
  await s.eval(() => studio64.testing.setSlow(1));
  const b0 = await marioTimer(s);
  await s.wait(2000);
  const normal = (await marioTimer(s)) - b0;
  t.check('slow motion 1/4 runs fewer frames', slow < normal * 0.6, { slow, normal });

  // ---- save states ----
  await s.page.click('#canvas');
  const saved = await s.eval(async () => { await studio64.testing.saveState(0); return studio64.engine.state().mario; });
  await s.page.keyboard.down('KeyW');
  await s.page.waitForFunction((p) => { const m = studio64.engine.state().mario; return Math.hypot(m.x - p.x, m.z - p.z) > 300; }, saved, { timeout: 20000 }).catch(() => {});
  await s.page.keyboard.up('KeyW');
  await s.wait(300);
  const walked = await s.mario();
  t.check('Mario walked away from the saved spot', Math.hypot(walked.x - saved.x, walked.z - saved.z) > 150, { saved, walked });
  await s.page.keyboard.press('F7'); // load slot 1
  await s.wait(300);
  const loaded = await s.mario();
  t.check('F7 loads the state: Mario is back', Math.hypot(loaded.x - saved.x, loaded.z - saved.z) < 40, { saved, loaded });
  await s.wait(1500);
  t.check('the game keeps running after loading', await s.framesAdvance());
  await s.shot('after_load');

  // ---- save file ----
  await s.eval(() => studio64.testing.giveStars(30));
  await s.wait(500);
  const stars = await s.eval(() => ({ file: JSON.parse(studio64.engine.M.UTF8ToString(studio64.engine.M._studio_save_json())).total, hud: studio64.engine.state().mario.stars }));
  t.check('30 stars: save file and star counter', stars.file === 30 && stars.hud >= 30, stars);
  await s.page.click('.tt-tab[data-tab=save]');
  await s.page.click('.tt-star[data-c="0"][data-k="6"]'); // BoB star 7 off (it was on)
  const bob = await s.eval(() => JSON.parse(studio64.engine.M.UTF8ToString(studio64.engine.M._studio_save_json())).stars[0]);
  t.eq('clicking a star in the panel toggles it', bob, 0x3f);
  await s.shot('savefile');
  await s.page.click('#tt-reset-save');
  t.eq('reset save file', await s.eval(() => JSON.parse(studio64.engine.M.UTF8ToString(studio64.engine.M._studio_save_json())).total), 0);

  // ---- validator with planted problems ----
  await s.eval(async () => {
    const e = studio64.engine;
    const m = e.state().mario;
    const key = e.areaKey();
    const ground = e.floor(m.x + 600, 20000, m.z);
    const recs = [
      { uid: 0x1234567, entry: 'star', x: m.x + 600, y: Math.round(ground - 1500), z: m.z, yaw: 0, pitch: 0, roll: 0, bparams: (3 << 24) >>> 0, scale: 1, name: 'Buried star', star: { name: 'Buried star' } },
      { uid: 0x1234568, entry: 'warp_pipe', x: m.x - 500, y: m.y, z: m.z, yaw: 0, bparams: (0x9a << 16) >>> 0, scale: 1, name: 'Warp Pipe' },
      { uid: 0x1234569, entry: 'star', x: m.x, y: Math.round(m.y + 4000), z: m.z + 400, yaw: 0, pitch: 0, roll: 0, bparams: (4 << 24) >>> 0, scale: 1, name: 'Sky star', star: { name: 'Sky star' } },
    ];
    for (const r of recs) e.spawn(r);
    (e.patch.areas[key] ||= { objects: [], removals: [], warps: [] }).objects.push(...recs);
    studio64.testing.send({ type: 'edit', op: { type: 'add', key, records: recs, summary: 'Planted problems' } });
    await new Promise((r) => setTimeout(r, 800));
  });
  await s.page.click('.tt-tab[data-tab=check]');
  await s.wait(600);
  const found = await s.eval(() => studio64.testing.lastCheck.problems.map((p) => `${p.severity}: ${p.title}`));
  t.check('validator: star under the ground', found.some((x) => /error: Star “Buried star” is under the ground/.test(x)), found);
  t.check('validator: pipe that leads nowhere', found.some((x) => /error: A pipe leads nowhere/.test(x)), found);
  t.check('validator: star out of reach', found.some((x) => /Sky star” (may be out of reach|floats over the void)/.test(x)), found);
  t.check('the check tab shows a count', /\d/.test(await s.page.textContent('#tt-check-count')));
  await s.shot('validator');
  await s.page.click('.tt-prob.error:has-text("Buried star") button:has-text("Fix")');
  await s.wait(1200);
  t.check('Fix lifts the star onto the ground', !(await s.eval(() => { studio64.testing.runCheck(); return studio64.testing.lastCheck.problems.some((p) => /Buried star” is under/.test(p.title)); })));
  const fixedRec = (await s.export()).areas['9:1'].objects.find((r) => r.uid === 0x1234567);
  t.check('the fix is saved', fixedRec && fixedRec.y > -500, fixedRec?.y);
  await s.page.click('.tt-prob:has-text("pipe leads nowhere") button:has-text("Show")');
  await s.wait(1500);
  const shown = await s.eval(() => ({ building: studio64.editor.active, sel: studio64.editor.sel?.name }));
  t.check('Show opens build mode with the object selected', shown.building && /Pipe/i.test(shown.sel || ''), shown);
  await s.shot('show');

  // ---- play from here ----
  const target = await s.eval(() => { const m = studio64.engine.state().mario; return [m.x + 1200, m.y, m.z + 300]; });
  await s.eval((p) => studio64.testing.playFromHere(false, p), target);
  await s.wait(1200);
  const here = await s.eval(() => ({ m: studio64.engine.state().mario, building: studio64.editor.active }));
  t.check('play from here: playing, Mario at the spot', !here.building && Math.hypot(here.m.x - target[0], here.m.z - target[2]) < 150, here);
  // P in build mode: from the spot under the mouse
  await s.build();
  const box = await s.box();
  await s.page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.7);
  await s.page.keyboard.press('KeyP');
  await s.wait(1000);
  t.check('P in build mode starts playing', !(await s.eval(() => studio64.editor.active)));
});
