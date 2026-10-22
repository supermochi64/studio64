// More of the story: a question and its answer, a sign that reads a project dialog, the hack's
// start with the game's own opening (Peach's letter with project text), and the ending's credits
// with project text.
import { chromium } from 'playwright';
const URL = process.env.STUDIO_URL || 'http://127.0.0.1:8064';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const proj = await (await fetch(URL + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 9 }) })).json();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('pageerror:', e.message); });
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) process.exitCode = 1; };
const shot = (n) => page.locator('#game-frame').screenshot({ path: `tests/out/${n}.png` });
const press = async (k, n = 1, gap = 450) => { for (let i = 0; i < n; i++) { await page.keyboard.down(k); await page.waitForTimeout(350); await page.keyboard.up(k); await page.waitForTimeout(gap); } };
const busy = () => page.evaluate(() => studio64.engine.M._studio_story_dialog_busy());
const settle = async () => {
  await page.waitForFunction(() => !studio64.engine.inIntro && studio64.engine.state().mario, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  if (await page.evaluate(() => studio64.editor.active)) await page.evaluate(() => studio64.editor.exit());
  await page.evaluate(() => document.querySelector('#canvas').focus());
};
await page.goto(URL + '/?p=' + proj.id);
await page.waitForSelector('#loading', { state: 'hidden', timeout: 300000 });
await page.click('#start');
await page.waitForTimeout(1500);
await page.evaluate(() => studio64.levelsUI.createLevel('flat', null, 'Extras'));
await page.waitForFunction(() => studio64.engine.inIntro, null, { timeout: 15000 }).catch(() => {});
await settle();

// ---- a question: the second answer is stored in a flag ------------------------------------
const q = await page.evaluate(() => {
  const ui = studio64.storyUI;
  studio64.engine.teleport(0, 30, 0, 0);
  const flag = ui.newVar('flag', 'said yes');
  const d = ui.newDialog({ name: 'Ask', text: 'Do you like the Story panel?', question: true, yes: 'Yes!', no: 'No' });
  ui.flush();
  return { flag: flag.id, num: d.num, dialog: d.id };
});
await page.evaluate((q) => studio64.storyRuntime.test({ id: 'q', name: 'Question', actions: [{ type: 'dialog', dialog: q.dialog, answer_var: q.flag }] }), q);
await page.waitForFunction(() => studio64.engine.M._studio_story_debug() >> 8 > 256, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
await shot('story_extra_question');
// first box -> the choice; move right to the second answer, confirm
for (let i = 0; i < 8 && await busy(); i++) {
  await press('KeyD', 1, 200); // right = second answer
  await press('Space', 1, 600);
}
await page.waitForTimeout(1500);
ok(await page.evaluate((f) => studio64.storyRuntime.getVar(f) === false, q.flag), 'answering the second choice leaves the flag off');
await page.evaluate((q) => studio64.storyRuntime.test({ id: 'q2', name: 'Question 2', actions: [{ type: 'dialog', dialog: q.dialog, answer_var: q.flag }] }), q);
await page.waitForFunction(() => studio64.engine.M._studio_story_debug() >> 8 > 256, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
for (let i = 0; i < 8 && await busy(); i++) { await press('KeyA', 1, 200); await press('Space', 1, 600); }
await page.waitForTimeout(1500);
ok(await page.evaluate((f) => studio64.storyRuntime.getVar(f) === true, q.flag), 'answering the first choice sets the flag');

// ---- a sign reads a project dialog ---------------------------------------------------------
const sign = await page.evaluate(() => {
  const ui = studio64.storyUI;
  const rec = ui.placeCharacter({ id: 'sign', label: 'Sign post', entry: 'message_panel', sign: true }, { x: 0, y: 0, z: 350, face: Math.PI });
  const d = ui.story.dialogs.find((x) => x.id === ui.story.npcs[rec.uid].lines[0].dialog);
  ui.upsert('dialogs', { ...d, text: 'Village of Story. Population: you!' });
  ui.close();
  return rec.uid;
});
await settle();
let read = false;
for (let i = 0; i < 5 && !read; i++) {
  // stand right in front of the sign, facing it, then press B
  await page.evaluate(() => studio64.engine.teleport(0, 30, 230, 0));
  await page.waitForTimeout(2500);
  await press('KeyJ', 1, 2500);
  read = !!(await busy());
}
await shot('story_extra_sign');
ok(read && await page.evaluate((u) => studio64.storyRuntime.lastTalk?.uid === u, sign), 'reading the sign shows its project dialog');
for (let i = 0; i < 6 && await busy(); i++) await press('Space', 1, 600);

// ---- the start: castle grounds with the game's own opening, Peach's letter rewritten ----------
await page.evaluate(() => {
  const ui = studio64.storyUI;
  ui.op({ op: 'text', kind: 'dialogs', key: 20, value: { text: 'Dear Mario:\nThe Story panel works!\nCome to the castle\nfor a test.\n--Studio 64' } });
  ui.op({ op: 'start', value: { level: 16, intro: true } });
  ui.flush();
  studio64.storyRuntime.playFromStart();
});
await page.waitForFunction(() => studio64.engine.level === 16 && studio64.engine.state().mario, null, { timeout: 90000 });
let sawLetter = false;
for (let i = 0; i < 40 && !sawLetter; i++) {
  await page.waitForTimeout(700);
  sawLetter = await page.evaluate(() => studio64.engine.M._studio_story_debug() >> 8 === 21); // dialog 20 (+1) on screen
}
await page.waitForTimeout(1500);
await shot('story_extra_letter');
ok(sawLetter, "the opening shows Peach's letter (dialog 20)");

// ---- the ending: credits with project text -----------------------------------------------------
await page.evaluate(() => {
  const ui = studio64.storyUI;
  ui.op({ op: 'text', kind: 'credits', key: 1, value: { title: ['STORY BY'], names: ['THE STUDIO 64 TEAM'] } });
  ui.flush();
  studio64.storyRuntime.applyTexts(true);
});
await page.waitForFunction(() => (studio64.engine.state().mario?.action || '') !== '0x04001301', null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(1000);
await page.evaluate(() => studio64.storyRuntime.test({ id: 'end', name: 'The end', actions: [{ type: 'ending' }] }));
let credits = false;
for (let i = 0; i < 40 && !credits; i++) {
  await page.waitForTimeout(1000);
  // Peach comes out of the castle (the ending), then the credits fly over the courses
  credits = await page.evaluate(() => (studio64.engine.state().mario?.action || '') === '0x00001918' || studio64.engine.level === 9);
}
await page.waitForTimeout(4000);
await shot('story_extra_credits');
ok(credits, 'the ending plays the credits');
ok(!errors.length, `no page errors (${errors.length})`);
await browser.close();
