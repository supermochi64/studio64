// Boot: the app loads, the game runs, Mario walks, the main UI is there.
// @tags smoke
import { suite } from '../lib/harness.mjs';

await suite('boot', async (t) => {
  const s = await t.open({ level: 9 });
  const st = await s.state();
  t.must('mario is in the level', !!st.mario, st);
  t.eq('boot level is BoB', await s.eval(() => studio64.engine.level), 9);
  t.check('frames are drawn', await s.framesAdvance());
  t.check('level chip names the level', /bob|battlefield/i.test(await s.page.textContent('#level-name')), await s.page.textContent('#level-name'));
  t.check('project name shown', (await s.page.inputValue('#project-name')).length > 0);
  t.check('start overlay gone after click', await s.page.isHidden('#start'));
  t.check('crash overlay hidden', await s.page.isHidden('#crash'));
  // walking: hold W and Mario moves
  const a = await s.mario();
  await s.page.focus('#canvas');
  const b = await s.hold('KeyW', (m) => Math.hypot(m.x - a.x, m.z - a.z) > 150);
  t.check('mario walks with W', b.ok, { a, b });
  await s.wait(300);
  // jumping
  const y0 = (await s.mario()).y;
  const j = await s.hold('Space', (m) => m.y > y0 + 60, 4000);
  t.check('mario jumps with Space', j.ok, { y0, y: j.y });
  // catalog and thumbnails
  const cat = await s.eval(() => ({ n: studio64.catalog.entries.length, levels: Object.keys(studio64.catalog.levels).length }));
  t.check('catalog has the objects', cat.n >= 550, cat);
  const thumb = await fetch(s.page.url().split('/?')[0] + '/favicon.svg');
  t.check('static files served', thumb.ok);
  // what the AI sees of the level (get_terrain): the whole level inside the ±16384 world
  const tv = await s.eval(() => { const x = studio64.studio.terrain({ resolution: 64 }); return { b: x.bounds, top: x.highest_points[0]?.y }; });
  t.check('terrain view covers BoB', tv.b.maxX - tv.b.minX > 8000 && tv.b.maxX - tv.b.minX < 20000, tv);
  t.check('terrain view finds the summit', tv.top > 3000, tv);
  await s.shot('boot');
});
