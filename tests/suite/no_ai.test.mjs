// No AI connected (server started with STUDIO_AI=off; `npm run test:noai`): every AI element is
// hidden and takes no space, the game uses the room, and building, levels, stars and sound
// all work without the AI.
// @tags noai
import { suite } from '../lib/harness.mjs';

await suite('no ai', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  t.must('the page knows there is no AI (body.no-ai)', await s.eval(() => document.body.classList.contains('no-ai')));
  const shown = await s.eval(() => [...document.querySelectorAll('[data-ai]')].filter((e) => {
    const b = e.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  }).map((e) => `${e.tagName.toLowerCase()}#${e.id}.${[...e.classList].join('.')}`));
  t.eq('no AI element visible', shown, []);
  // nothing that talks about Claude or chatting is on screen
  const words = await s.eval(() => {
    const out = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const n = walk.currentNode, e = n.parentElement;
      if (!e || !/\b(Claude|chat with|Ask Claude)\b/i.test(n.textContent)) continue;
      const b = e.getBoundingClientRect();
      if (b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]')) out.push(n.textContent.trim().slice(0, 60));
    }
    return out;
  });
  t.eq('no visible text mentions Claude or chatting', words, []);
  t.check('chat box not focusable', !(await s.eval(() => { const i = document.querySelector('#input'); return !!i && i.getBoundingClientRect().width > 0; })));
  // the game takes the room the chat panel had
  const L = await s.eval(() => {
    const g = document.querySelector('#game-frame').getBoundingClientRect();
    const side = document.querySelector('#side')?.getBoundingClientRect();
    return { vw: innerWidth, gw: g.width, side: side ? side.width : 0 };
  });
  t.check('game frame fills the width (no empty chat column)', L.gw > L.vw * 0.8 && L.side < 10, L);
  // "/" must not open a hidden chat box
  await page.focus('#canvas');
  await page.keyboard.press('Slash');
  t.check('/ does not focus a hidden chat', (await s.eval(() => document.activeElement?.id)) !== 'input');
  await s.shot('no_ai');

  // the editor works without AI
  await s.build();
  await page.click('.preset:has-text("Box")');
  const gp = await s.groundPoint();
  await s.clickAt(gp.x, gp.y);
  await page.keyboard.press('Escape');
  await s.wait(600);
  t.check('build: a box placed', (await s.records()).some((r) => r.block));
  const insp = await s.eval(() => { const r = studio64.editor.records().find((x) => x.block); const o = studio64.engine.objects().find((x) => x.uid === r.uid); studio64.editor.select(o.slot); return [...document.querySelectorAll('#inspector [data-act=ask]')].filter((e) => e.getBoundingClientRect().width > 0).length; });
  t.eq('inspector has no "Ask Claude" button', insp, 0);
  await page.keyboard.press('Escape');
  // levels: the new-level dialog does not offer "Let Claude build this level"
  await page.keyboard.press('Control+k');
  await page.click('#launcher-body .lvl-card.new');
  t.check('new level dialog opens', await page.isVisible('#nl-name'));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  const lvl = await s.newLevel('flat', 'No AI level');
  t.check('a level from a template works', !!lvl);
  // sound studio opens and makes a song
  await page.focus('#canvas');
  await s.build();
  await page.click('#sound-btn');
  await page.waitForFunction(() => studio64.soundUI.banks?.length, null, { timeout: 15000 });
  await page.locator('.starter').first().click();
  t.check('sound: a song from a starter', await s.eval(() => !!studio64.soundUI.song()));
  await page.keyboard.press('Escape');
  t.check('engine alive', await s.framesAdvance());
});
