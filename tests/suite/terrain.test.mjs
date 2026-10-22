// Terrain: every brush in a custom level (heights change, collision follows, undo), the brush
// size keys, sculpting an original level (BoB) with replay after a reload, and undo there.
// @tags terrain editor
// @timeout 600
import { suite } from '../lib/harness.mjs';

async function stroke(s, mode, P, ms = 900, mods = []) {
  const page = s.page;
  await page.click(`.brush-tool[data-mode=${mode}]`);
  const ov = await s.box();
  await page.mouse.move(ov.x + P.x, ov.y + P.y);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.down();
  await page.mouse.move(ov.x + P.x + 10, ov.y + P.y + 4, { steps: 4 });
  await s.wait(ms);
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
  await s.wait(600);
}

await suite('terrain', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;

  // ---- custom level
  await s.newLevel('flat', 'Terrain test');
  await s.build();
  await s.viewMario(2200, -0.8);
  await page.click('.lib-tab[data-lib=terrain]');
  const ov = await s.box();
  const P = { x: ov.width * 0.5, y: ov.height * 0.55 };
  const hit = await s.eval((P) => { const h = studio64.editor.pick(P.x, P.y, { objects: false }); return h && [h.x, h.y, h.z]; }, P);
  t.must('brush point on the terrain', !!hit);
  const floorAt = () => s.eval((p) => studio64.engine.floor(p[0], p[1] + 5000, p[2]), hit);
  const y0 = await floorAt();
  const n0 = (await s.changes()).length;

  await stroke(s, 'raise', P);
  const y1 = await floorAt();
  t.check('raise lifts the ground (collision)', y1 > y0 + 40, { y0, y1 });
  t.eq('raise is one edit', (await s.changes()).length, n0 + 1);
  await stroke(s, 'raise', P, 700, ['Shift']);
  const y2 = await floorAt();
  t.check('Shift + raise lowers', y2 < y1 - 20, { y1, y2 });
  await stroke(s, 'lower', P);
  const y3 = await floorAt();
  t.check('lower digs', y3 < y2 - 20, { y2, y3 });
  await stroke(s, 'smooth', P);
  t.check('smooth runs', !(await s.crashed()));
  await stroke(s, 'flatten', P);
  t.check('flatten runs', !(await s.crashed()));
  // paint: a material from the paint grid
  await page.click('.brush-tool[data-mode=paint]');
  await page.locator('.brush-paint .mat').nth(17).click();
  t.eq('paint tool with sand', await s.eval(() => [studio64.editor.tool, studio64.editor.brush.mode, studio64.editor.brush.material]), ['sculpt', 'paint', 17]);
  await stroke(s, 'paint', P);
  const mat = await s.eval((p) => { const t = studio64.world.terrainSummary?.(); return t; }, hit);
  t.check('terrain summary available', !!mat);
  // brush size keys
  const r0 = await s.eval(() => studio64.editor.brush.radius);
  await page.keyboard.press('BracketRight');
  const r1 = await s.eval(() => studio64.editor.brush.radius);
  t.check('] grows the brush', r1 > r0, { r0, r1 });
  await page.keyboard.press('BracketLeft');
  await page.keyboard.press('BracketLeft');
  t.check('[ shrinks the brush', (await s.eval(() => studio64.editor.brush.radius)) < r1);
  // Mario walks on the new ground
  const cnt = (await s.changes()).length;
  t.eq('each stroke is one edit', cnt, n0 + 6);
  // undo all strokes: back to the start height
  for (let i = 0; i < 6; i++) {
    const n = (await s.changes()).length;
    await page.keyboard.press('Control+z');
    await s.until((k) => studio64.changes.length < k, n, 15000);
  }
  await s.wait(1500);
  t.near('undo restores the ground', await floorAt(), y0, 5);
  t.eq('undo removed the strokes', (await s.changes()).length, n0);
  await page.keyboard.press('Escape');
  t.eq('Esc stops sculpting', await s.eval(() => studio64.editor.tool), 'select');

  // terrain persists over a reload
  await stroke(s, 'raise', P, 1200);
  const yR = await floorAt();
  await page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => studio64.engine?.ready, null, { timeout: 120000 });
  // the page reopens the custom level by itself (through its star screen)
  await s.until(() => studio64.engine.inIntro || studio64.engine.level === 37, null, 90000);
  await s.skipIntro();
  await s.arrive(37, 120000);
  t.near('raised terrain after reload', await floorAt(), yR, 5);

  // ---- original level: BoB
  await s.goLevel(9);
  await s.build();
  await s.viewMario(1800, -0.7);
  await page.click('.lib-tab[data-lib=terrain]');
  const hitB = await s.eval((P) => { const h = studio64.editor.pick(P.x, P.y, { objects: false }); return h && [h.x, h.y, h.z]; }, P);
  t.must('brush point on BoB', !!hitB);
  const fB = () => s.eval((p) => studio64.engine.floor(p[0], p[1] + 3000, p[2]), hitB);
  const b0 = await fB();
  await stroke(s, 'raise', P, 1200);
  const b1 = await fB();
  t.check('sculpting BoB lifts its ground', b1 > b0 + 40, { b0, b1 });
  t.check('BoB still runs', await s.framesAdvance());
  // replay after reload: same height, exactly once
  await page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => studio64.engine?.ready, null, { timeout: 120000 });
  await s.arrive(9, 60000);
  await s.wait(1000);
  t.near('BoB sculpt replays once after reload', await fB(), b1, 6);
  // the stroke raised the ground where Mario starts: he must stand on it, not inside it
  await s.until(() => { const m = studio64.engine.state().mario; return m && studio64.engine.floor(m.x, m.y + 78, m.z) > -10000; }, null, 10000);
  const mr = await s.mario();
  t.check('Mario starts on top of raised ground, not inside it', await s.eval((m) => studio64.engine.floor(m.x, m.y + 78, m.z) > -10000, mr), mr);
  await s.wait(2000);
  t.eq('and does not fall out of the level', await s.eval(() => studio64.engine.level), 9);
  // Lifted onto the new hill next to BoB's edge, he may slide down it and off the map: a real
  // death whose warp (a 48 frame fade) could land while building and take the test to the
  // castle (the "undo" check then read the castle's floor, -32000). Let it land, come back.
  if (await s.until(() => studio64.engine.level !== 9, null, 6000)) {
    t.log('Mario slid off the hill and died: back to BoB');
    await s.arrive(null, 60000);
    await s.goLevel(9);
  }
  await s.build();
  await page.keyboard.press('Control+z');
  await s.wait(2500);
  t.near('undo restores BoB', await fB(), b0, 6);
  // Mario still walks around after undo (collision intact)
  await s.play();
  await page.keyboard.down('KeyW'); await s.wait(800); await page.keyboard.up('KeyW');
  const m = await s.mario();
  t.check('mario on the ground after undo', m.y - m.floorY < 200 && m.floorY > -10000, m);
});
