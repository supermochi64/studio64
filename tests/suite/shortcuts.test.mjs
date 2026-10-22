// Keyboard shortcuts in play and build mode, and that typing in text fields never triggers
// them (or moves Mario).
// @tags ui editor
import { suite } from '../lib/harness.mjs';

await suite('shortcuts', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  const active = () => s.eval(() => studio64.editor.active);
  await page.focus('#canvas');
  await page.keyboard.press('Tab');
  t.check('Tab enters build mode', await active());
  // gizmo keys
  for (const [k, g] of [['Digit2', 'rotate'], ['Digit3', 'size'], ['Digit1', 'move']]) {
    await page.keyboard.press(k);
    t.eq(`${k} picks ${g}`, await s.eval(() => studio64.editor.gizmo), g);
  }
  // camera keys
  // (camera moves animate: wait until the animation is over)
  const cam = async () => { await page.waitForFunction(() => !studio64.editor.anim, null, { timeout: 10000 }).catch(() => {}); return s.eval(() => ({ ...studio64.editor.cam })); };
  let c0 = await cam();
  await page.keyboard.press('Numpad7');
  await s.wait(600);
  let c1 = await cam();
  t.check('Numpad 7 looks from the top', c1.pitch < -1.3, c1);
  await page.keyboard.press('Shift+Home');
  await s.wait(700);
  const c2 = await cam();
  t.check('Shift+Home shows the level from above', c2.y > c0.y + 1500, { c0, c2 });
  await page.keyboard.press('Home');
  await s.wait(700);
  const c3 = await cam();
  const m = await s.mario();
  t.check('Home frames Mario', Math.hypot(c3.x - m.x, c3.z - m.z) < 3000 && c3.y < c2.y, { c3, m });
  c0 = await cam();
  await page.keyboard.press('Numpad6');
  await s.wait(300);
  c1 = await cam();
  t.check('Numpad 6 orbits', Math.abs(c1.yaw - c0.yaw) > 0.1, { c0: c0.yaw, c1: c1.yaw });
  // ? / help card
  await page.click('#build-help');
  t.check('help card opens', await page.isVisible('#help-card'));
  await page.click('#build-help');
  // Ctrl+K and L open the launcher, Esc closes
  await page.keyboard.press('Control+k');
  t.check('Ctrl+K opens the launcher', await page.isVisible('#launcher'));
  await page.keyboard.press('Escape');
  t.check('Esc closes it', await page.isHidden('#launcher'));
  await page.focus('#canvas');
  await page.keyboard.press('KeyL');
  t.check('L opens the launcher in build mode', await page.isVisible('#launcher'));
  await page.keyboard.press('Escape');
  // M opens the sound studio, Esc closes it, build mode stays
  await page.focus('#canvas');
  await page.keyboard.press('KeyM');
  t.check('M opens the sound studio', await page.isVisible('#sound-studio'));
  await page.keyboard.press('Escape');
  t.check('Esc closes the sound studio', await page.isHidden('#sound-studio'));
  t.check('still building after the sound studio', await active());
  await page.focus('#canvas');
  await page.keyboard.press('Tab');
  t.check('Tab back to play', !(await active()));

  // typing in fields: no shortcut fires, Mario stays
  const m0 = await s.mario();
  await page.click('#project-name');
  await page.keyboard.type('lmk wasd', { delay: 25 });
  await page.keyboard.press('Tab');
  t.check('typing L/M in the name opens nothing', await page.isHidden('#launcher') && await page.isHidden('#sound-studio'));
  t.check('Tab in a field does not toggle build mode', !(await active()));
  const m1 = await s.mario();
  t.check('typing in the name does not move Mario', Math.hypot(m1.x - m0.x, m1.z - m0.z) < 5);
  // build mode + inspector field: Delete/Backspace edits the text, not the selection
  await page.focus('#canvas');
  await page.keyboard.press('Tab');
  await page.click('.preset:has-text("Box")');
  const gp = await s.groundPoint();
  await s.clickAt(gp.x, gp.y);
  await page.keyboard.press('Escape');
  await s.wait(500);
  const box = (await s.records()).filter((r) => r.block).pop();
  await s.eval((uid) => { const o = studio64.engine.objects().find((x) => x.uid === uid); studio64.editor.select(o.slot); }, box.uid);
  await page.click('#inspector input[data-f=x]');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('KeyR');
  await page.keyboard.press('KeyG');
  t.check('Backspace in a field keeps the block', (await s.records()).some((r) => r.uid === box.uid));
  t.eq('R/G in a field do not rotate', (await s.records()).find((r) => r.uid === box.uid).yaw, box.yaw);
  await page.keyboard.press('Escape');
  await s.eval(() => document.activeElement?.blur());
  // Ctrl+Z only undoes the edit of this level
  await page.focus('#canvas');
  await page.keyboard.press('Control+z');
  await s.wait(800);
  t.check('Ctrl+Z undid the box', !(await s.records()).some((r) => r.uid === box.uid));
  await page.keyboard.press('Control+z');
  await s.wait(500);
  t.check('Ctrl+Z with nothing to undo is harmless', await s.framesAdvance());
});
