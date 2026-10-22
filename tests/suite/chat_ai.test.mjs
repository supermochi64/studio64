// One short real chat message: Claude answers, places an object, the edit is saved and shows
// in the Edits tab, the project gets named after the request. Needs a Claude login.
// @tags ai
// @timeout 400
import { suite } from '../lib/harness.mjs';

await suite('chat ai', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  await page.click('#input');
  await page.keyboard.type('Add one goomba in front of me. Keep the answer to one sentence.');
  await page.keyboard.press('Enter');
  t.check('message shown', await page.locator('.msg.user').count() === 1);
  t.check('send turns into stop while busy', await s.eval(() => studio64.busy));
  await page.waitForFunction(() => !studio64.busy, null, { timeout: 300000 });
  const err = await page.locator('.msg-error').allTextContents();
  t.check('no error in the answer', err.length === 0, err);
  t.check('assistant answered', (await page.locator('.msg.assistant .md').count()) > 0);
  const recs = await s.records();
  t.check('a goomba was placed', recs.some((r) => /goomba/.test(r.entry || '')), recs.map((r) => r.entry));
  t.check('it is in the game', await s.eval(() => studio64.engine.objects().some((o) => o.uid && /Goomba/.test(o.bhv))));
  t.check('edit listed', (await s.changes()).length >= 1);
  t.check('project named after the request', /goomba/i.test(await page.inputValue('#project-name')), await page.inputValue('#project-name'));
  await s.shot('answer');
});
