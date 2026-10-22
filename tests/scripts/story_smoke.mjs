// Story feature smoke test: the panel opens, a project dialog shows in the game, a placed Toad
// says a project dialog, the dialog editor preview renders.
import { chromium } from 'playwright';
const URL = process.env.STUDIO_URL || 'http://127.0.0.1:8064';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const proj = await (await fetch(URL + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 9 }) })).json();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('pageerror:', e.message); });
page.on('console', (m) => { if (/error|abort/i.test(m.text())) console.log('console:', m.text()); });
await page.goto(URL + '/?p=' + proj.id);
await page.waitForSelector('#loading', { state: 'hidden', timeout: 300000 });
await page.click('#start');
await page.waitForTimeout(1500);
await page.evaluate(() => studio64.levelsUI.createLevel('flat', null, 'Story test'));
await page.waitForFunction(() => studio64.engine.inIntro, null, { timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => !studio64.engine.inIntro, null, { timeout: 15000 });
await page.waitForTimeout(2500);
if (await page.evaluate(() => studio64.editor.active)) { await page.click('#mode-play'); await page.waitForTimeout(500); }
// held long enough for a slow headless browser (a few frames per second)
const press = async (k, n = 1, gap = 450) => { for (let i = 0; i < n; i++) { await page.keyboard.down(k); await page.waitForTimeout(350); await page.keyboard.up(k); await page.waitForTimeout(gap); } };
const shot = (n) => page.locator('#game-frame').screenshot({ path: `tests/out/${n}.png` });
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) process.exitCode = 1; };

ok(await page.evaluate(() => typeof studio64.engine.M._studio_text_dialog === 'function'), 'engine has the story API');
ok(await page.evaluate(() => !!studio64.storyUI && !!studio64.storyRuntime), 'story UI and runtime exist');

// a project dialog, shown by an event action
await page.evaluate(() => studio64.engine.teleport(0, 30, 0, 0));
await page.waitForTimeout(800);
const num = await page.evaluate(() => {
  const ui = studio64.storyUI;
  const d = ui.newDialog({ name: 'Hello', text: 'Welcome to the Story test! This text was written in the Story panel and wraps by itself.\n\nA second box: ★ $ [A] [B]' });
  studio64.storyRuntime.applyTexts(true);
  return d.num;
});
ok(num >= 256, `dialog number ${num}`);
await page.evaluate((n) => studio64.engine.M._studio_story_dialog(n), num);
await page.waitForTimeout(1500);
await shot('story_dialog_1');
ok(await page.evaluate(() => studio64.engine.M._studio_story_dialog_busy() === 1), 'dialog is open');
await press('Space', 6);
await page.waitForTimeout(800);
ok(await page.evaluate(() => studio64.engine.M._studio_story_dialog_busy() === 0), 'dialog closed with A');

// a Toad that says a project dialog
const uid = await page.evaluate(() => {
  const ch = { id: 'toad', label: 'Toad', model: 'toad_message', anim: [1, 6] };
  const rec = studio64.storyUI.placeCharacter(ch, { x: 0, y: 0, z: 400, face: Math.PI });
  return rec?.uid;
});
ok(!!uid, `Toad placed (${uid})`);
await page.waitForTimeout(500);
const toadText = await page.evaluate((u) => {
  const s = studio64.story;
  const d = s.dialogs.find((x) => x.id === s.npcs[u].lines[0].dialog);
  d.text = 'I am a Story Toad! Nice to meet you.';
  studio64.storyUI.upsert('dialogs', d);
  return d.text;
}, uid);
await page.evaluate(() => studio64.storyUI.close());
await page.evaluate(() => { if (studio64.editor.active) studio64.editor.exit(); studio64.engine.teleport(0, 30, 150, 0); });
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelector('#canvas').focus());
// walk into the Toad and press B, like a player
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => studio64.engine.M._studio_walk(0, 14));
  await page.waitForTimeout(700);
  await page.waitForFunction(() => studio64.engine.state().mario?.action === '0x0C400201', null, { timeout: 20000, polling: 100 }).catch(() => {}); // B while walking would punch
  await press('KeyJ', 1, 2000);
  if (await page.evaluate(() => studio64.engine.M._studio_story_dialog_busy())) break;
  await page.evaluate(() => studio64.engine.teleport(0, 30, 150, 0));
  await page.waitForTimeout(800);
}
await shot('story_toad_talk');
const talkOpen = await page.evaluate(() => studio64.engine.M._studio_story_dialog_busy());
ok(talkOpen === 1, `talking to the Toad (${toadText})`);
for (let i = 0; i < 8 && await page.evaluate(() => studio64.engine.M._studio_story_dialog_busy()); i++) await press('Space', 1);
await page.waitForFunction(() => studio64.storyRuntime.log.some((l) => /Talked to/.test(l.text)), null, { timeout: 30000 }).catch(() => {});
const log = await page.evaluate(() => studio64.storyRuntime.log.map((l) => l.text));
ok(log.some((l) => /Talked to Toad/.test(l)), `talk event reached the page: ${JSON.stringify(log)}`);

// the panel and its preview
await page.evaluate(() => studio64.storyUI.open('dialogs'));
await page.waitForTimeout(400);
await page.evaluate(() => { const ui = studio64.storyUI; ui.sel.dialogs = ui.story.dialogs[0].id; ui.render(); });
await page.waitForTimeout(800);
await page.screenshot({ path: 'tests/out/story_panel_dialogs.png' });
await page.evaluate(() => { studio64.storyUI.open('characters'); });
await page.waitForTimeout(500);
await page.screenshot({ path: 'tests/out/story_panel_characters.png' });
ok(!errors.length, `no page errors (${errors.length})`);
await browser.close();
