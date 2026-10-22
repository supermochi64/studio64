// Two tabs on the same project: edits, deletes, undo, renames and level changes reach the
// other tab live, and the viewer count shows both.
// @tags sync
import { suite, sleep } from '../lib/harness.mjs';

await suite('multi tab', async (t) => {
  const a = await t.open({ level: 9, label: 'A' });
  const ctx = await t.browser.newContext({ viewport: { width: 1280, height: 800 } });
  const b = await t.open({ project: a.projectId, label: 'B', context: ctx });
  await a.wait(800);
  t.check('A shows 2 viewers', /2/.test(await a.page.textContent('#viewers')) && await a.page.isVisible('#viewers'), await a.page.textContent('#viewers'));

  // A places a block
  await a.build();
  await a.page.click('.preset:has-text("Pillar")');
  const gp = await a.groundPoint();
  await a.clickAt(gp.x, gp.y);
  await a.page.keyboard.press('Escape');
  await a.wait(800);
  const rec = (await a.records()).filter((r) => r.block).pop();
  t.must('A placed a pillar', !!rec);
  const inB = () => b.eval((uid) => studio64.engine.objects().some((o) => o.uid === uid), rec.uid);
  t.check('B sees the pillar', await inB());
  t.check('B lists the edit', (await b.changes()).some((c) => /Placed/.test(c)), await b.changes());

  // B moves it with the inspector
  await b.build();
  await b.eval((uid) => { const o = studio64.engine.objects().find((x) => x.uid === uid); studio64.editor.select(o.slot); }, rec.uid);
  await b.page.fill('#inspector input[data-f=z]', String(rec.z + 400));
  await b.page.press('#inspector input[data-f=z]', 'Enter');
  await b.wait(900);
  const zA = await a.eval((uid) => studio64.engine.objects().find((o) => o.uid === uid)?.z, rec.uid);
  t.near('A sees the move', zA, rec.z + 400, 2);
  // B deletes, A undoes
  await b.page.keyboard.press('Delete');
  await b.wait(900);
  t.check('A sees the delete', !(await a.eval((uid) => studio64.engine.objects().some((o) => o.uid === uid), rec.uid)));
  await a.page.keyboard.press('Control+z');
  await a.wait(1200);
  t.check('undo in A brings it back in B', await inB());
  t.check('undo in A brings it back in A', await a.eval((uid) => studio64.engine.objects().some((o) => o.uid === uid), rec.uid));

  // rename the project
  await a.page.fill('#project-name', 'Shared hack');
  await a.page.press('#project-name', 'Enter');
  await a.wait(800);
  t.eq('B sees the new project name', await b.page.inputValue('#project-name'), 'Shared hack');

  // a level made in A shows up in B's launcher
  await a.play();
  await a.newLevel('meadow', 'From A');
  await b.wait(800);
  t.check('B knows the new level', await b.eval(() => studio64.levels.some((l) => l.name === 'From A')));
  // B is not pulled into A's level
  t.eq('B stays in its level', await b.eval(() => studio64.engine.level), 9);

  // closing B: count goes back to 1
  await ctx.close();
  t.sessions = t.sessions.filter((x) => x !== b);
  await sleep(1000);
  t.check('viewer count drops when B leaves', await a.page.isHidden('#viewers'));
});
