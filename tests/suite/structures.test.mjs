// Structures (Builds tab): every generator previews, takes typed parameters, builds blocks
// with collision, and undo removes the whole structure.
// @tags editor
import { suite } from '../lib/harness.mjs';

await suite('structures', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  await s.build();
  await page.click('.lib-tab[data-lib=structures]');
  const kinds = await s.eval(() => [...document.querySelectorAll('#lib-structures .gen')].map((b) => b.dataset.kind));
  t.check('six structures listed', kinds.length >= 6, kinds);

  for (const kind of kinds) {
    await s.eval(() => studio64.editor.focusOn([studio64.engine.state().mario.x, studio64.engine.state().mario.y, studio64.engine.state().mario.z], 2200));
    await s.wait(600);
    await page.click(`#lib-structures .gen[data-kind=${kind}]`);
    t.eq(`${kind}: tool is generator`, await s.eval(() => studio64.editor.tool), 'generator');
    // anchor: a wall for the wall climb, the ground otherwise
    let pt;
    if (kind === 'wall_climb') {
      pt = await s.lookAtWall();
    } else pt = await s.groundPoint();
    t.must(`${kind}: anchor point on screen`, !!pt);
    await s.clickAt(pt.x, pt.y);
    if (kind === 'bridge') {
      const pt2 = await s.groundPoint({ from: [0.6, 0.9] });
      await s.clickAt(pt2.x, pt2.y);
    }
    const ghosts = await s.eval(() => studio64.editor.gen?.ghosts.length || 0);
    t.check(`${kind}: preview shows ghost blocks`, ghosts > 0, { ghosts });
    // type a number into the first numeric parameter: focus must stay in the field
    const inp = page.locator('#lib-structures .gen-form input[type=number]').first();
    if (await inp.count()) {
      const old = await inp.inputValue();
      await inp.click();
      await inp.fill('');
      const want = Number(old) + (Number(old) < 50 ? 2 : 120);
      await page.keyboard.type(String(want), { delay: 60 });
      const focusedStill = await s.eval(() => document.activeElement?.closest?.('.gen-form') != null);
      t.check(`${kind}: typing a parameter keeps the focus`, focusedStill);
      const val = await page.locator('#lib-structures .gen-form input[type=number]').first().inputValue();
      t.eq(`${kind}: typed value kept`, val, String(want));
      const param = await s.eval(() => { const g = studio64.editor.gen; return g.params[Object.keys(g.params).find((k) => typeof g.params[k] === 'number')]; });
      t.eq(`${kind}: parameter updated`, param, want);
    }
    const before = (await s.records()).length;
    const buildBtn = page.locator('#lib-structures .gen-actions .btn.primary');
    t.check(`${kind}: Build enabled`, await buildBtn.isEnabled());
    await buildBtn.click();
    await s.settle(800);
    const recs = await s.records();
    t.check(`${kind}: built blocks`, recs.length > before, { before, after: recs.length });
    t.eq(`${kind}: ghosts cleared`, await s.eval(() => studio64.editor.gen?.ghosts.length || 0), 0);
    const ghostObjs = await s.eval(() => studio64.engine.objects().filter((o) => o.uid >= 0x7f000000).length);
    t.eq(`${kind}: no ghost objects left in the engine`, ghostObjs, 0);
    // collision on the last block
    const last = recs[recs.length - 1];
    if (!last) continue;
    const fy = await s.eval((r) => studio64.engine.floor(r.x, r.y + r.block.sy + 100, r.z), last);
    t.check(`${kind}: block has collision`, fy > last.y - 5, { fy, y: last.y, sy: last.block.sy });
    await page.keyboard.press('Escape');
    // undo removes all of it
    await page.keyboard.press('Control+z');
    await s.wait(900);
    t.eq(`${kind}: undo removes the structure`, (await s.records()).length, before);
  }
  // absurd values are clamped (a 999 floor tower would fill the object pool)
  await page.click('#lib-structures .gen[data-kind=tower]');
  const gp = await s.groundPoint();
  await s.clickAt(gp.x, gp.y);
  const floors = page.locator('#lib-structures .gen-form input[type=number]').first();
  await floors.click();
  await floors.fill('');
  await page.keyboard.type('999');
  t.eq('tower floors clamped to 12', await s.eval(() => studio64.editor.gen.params.floors), 12);
  await page.keyboard.press('Tab');
  t.eq('field shows the clamped value', await floors.inputValue(), '12');
  await s.eval(() => studio64.editor.cancelGenerator());
  t.check('engine alive', await s.framesAdvance());
});
