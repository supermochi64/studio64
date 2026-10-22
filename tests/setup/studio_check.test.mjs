// After a fresh setup (tests/setup/sandbox.mjs): the studio opens, the game runs, an object can
// be placed with the mouse from the library and Mario plays. Run against the setup's server:
//   STUDIO_URL=http://127.0.0.1:8093 node tests/setup/studio_check.test.mjs
// (Not part of npm test: it is the last step of the setup tests.)
// @tags manual
import { suite } from '../lib/harness.mjs';

await suite('studio after setup', async (t) => {
  const s = await t.open({ level: 9 });
  t.check('the game runs', await s.framesAdvance());
  const m0 = await s.mario();
  t.check('Mario is in Bob-omb Battlefield', !!m0 && Number.isFinite(m0.x), m0);

  // build mode: a Goomba from the object library, placed with the mouse
  await s.build();
  await s.viewMario(1400, -0.8);
  await s.page.click('.lib-tab[data-lib=objects]');
  await s.page.fill('#obj-search', 'goomba');
  await s.wait(300);
  const tile = s.page.locator('#obj-grid .obj').filter({ has: s.page.locator('.obj-name', { hasText: /^Goomba$/ }) }).first();
  t.must('the library lists the Goomba', (await tile.count()) > 0);
  // the library shows only pictures that exist (a letter otherwise): no broken image
  const broken = await s.eval(() => [...document.querySelectorAll('#obj-grid img')].filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.src));
  t.eq('no broken pictures in the library', broken, []);
  await tile.click();
  await s.wait(300);
  const gp = await s.groundPoint({ kind: null });
  t.must('a ground point to place on', !!gp);
  const before = (await s.records()).filter((r) => r.entry === 'goomba').length;
  const bx = await s.box();
  await s.page.mouse.move(bx.x + gp.x, bx.y + gp.y);   // (the ghost follows the mouse, then a click places it)
  await s.wait(300);
  await s.clickAt(gp.x, gp.y);
  await s.settle(600);
  await s.key('Escape');
  const recs = (await s.records()).filter((r) => r.entry === 'goomba');
  t.eq('the Goomba is a saved edit', recs.length, before + 1);
  const objs = await s.eval(() => studio64.engine.objects());
  t.check('the Goomba is in the game', objs.some((o) => o.uid === recs[recs.length - 1]?.uid));
  await s.shot('placed');

  // play: Mario runs and jumps
  await s.play();
  await s.wait(500);
  const a = await s.mario();
  const ran = await s.hold('w', (m) => Math.hypot(m.x - a.x, m.z - a.z) > 150);
  t.check('Mario runs (W)', ran.ok, { from: a, to: ran });
  const j = await s.hold(' ', (m) => m.y > ran.y + 60, 4000);
  t.check('Mario jumps (Space)', j.ok, { y0: ran.y, y: j.y });
  await s.shot('playing');
  t.check('no crash', !(await s.crashed()));
});
