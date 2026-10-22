// The Story panel's tabs, the build-mode Logic tab and inspector, and the game's own texts
// changed per project (a course and star name on the star select screen, Peach's letter).
import { chromium } from 'playwright';
const URL = process.env.STUDIO_URL || 'http://127.0.0.1:8064';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const proj = await (await fetch(URL + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 9 }) })).json();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('pageerror:', e.message); });
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) process.exitCode = 1; };
await page.goto(URL + '/?p=' + proj.id);
await page.waitForSelector('#loading', { state: 'hidden', timeout: 300000 });
await page.click('#start');
await page.waitForTimeout(1500);
await page.evaluate(() => studio64.levelsUI.createLevel('meadow', null, 'UI test'));
await page.waitForFunction(() => studio64.engine.inIntro, null, { timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => !studio64.engine.inIntro && studio64.engine.state().mario, null, { timeout: 60000 });
await page.waitForTimeout(2000);

// some content
await page.evaluate(() => {
  const ui = studio64.storyUI;
  studio64.engine.teleport(0, studio64.engine.state().mario.y + 20, 0, 0);
  const toad = ui.placeCharacter({ id: 'toad', label: 'Toad', model: 'toad_message', anim: [1, 6] });
  const flag = ui.newVar('flag', 'met the mayor');
  ui.newVar('counter', 'keys found');
  const q = ui.newDialog({ name: 'Mayor: question', text: 'Will you help our village find the three lost keys?', question: true, yes: 'Sure!', no: 'Later' });
  ui.newEvent({ name: 'Mayor asks', trigger: { type: 'talk', uid: toad.uid, answer: 'yes' }, conditions: [{ type: 'flag', var: flag.id, value: false }],
    actions: [{ type: 'set_flag', var: flag.id, value: 'true' }, { type: 'if', conditions: [{ type: 'stars', op: '>=', value: 1 }], then: [{ type: 'coins', amount: 5 }], else: [{ type: 'caption', text: 'Find a star first', seconds: 3 }] }, { type: 'dialog', dialog: q.id }] });
  ui.newCutscene({ name: 'Village fly-over', steps: [{ type: 'shot', pos: [800, 900, 800], focus: [0, 200, 0], seconds: 0, ease: 'cut' }, { type: 'shot', pos: [-800, 700, 900], focus: [0, 200, 0], seconds: 3, ease: 'smooth' }, { type: 'dialog', dialog: q.id }, { type: 'fade', to: 'out', seconds: 0.6, color: '#000000' }] });
  ui.flush();
});
await page.waitForTimeout(800);
for (const tab of ['dialogs', 'characters', 'logic', 'cutscenes', 'texts', 'start']) {
  await page.evaluate((t) => {
    const ui = studio64.storyUI;
    ui.open(t);
    if (t === 'dialogs') ui.sel.dialogs = ui.story.dialogs.find((d) => d.question)?.id;
    if (t === 'characters') ui.sel.characters = Number(Object.keys(ui.story.npcs)[0]);
    if (t === 'logic') ui.sel.logic = ui.story.events[0]?.id;
    if (t === 'cutscenes') ui.sel.cutscenes = ui.story.cutscenes[0]?.id;
    if (t === 'texts') { ui.textTab = 'dialogs'; ui.sel.gameDialog = 20; }
    ui.render();
  }, tab);
  await page.waitForTimeout(700);
  await page.screenshot({ path: `tests/out/story_tab_${tab}.png` });
  ok(await page.evaluate(() => document.querySelector('.st-main').children.length > 0), `tab ${tab} renders`);
}
// game texts: Peach's letter and a course + star name
await page.evaluate(() => {
  const ui = studio64.storyUI;
  ui.op({ op: 'text', kind: 'dialogs', key: 20, value: { text: 'Dear Mario:\nPlease come to the\nmushroom village.\nThe keys are lost!\n--Mayor Toad' } });
  ui.op({ op: 'text', kind: 'courses', key: 0, value: 'BOOM VALLEY' });
  ui.op({ op: 'text', kind: 'acts', key: 0, value: 'THE BIG BOOM' });
  ui.flush();
  ui.textTab = 'courses'; ui.render();
});
await page.waitForTimeout(500);
await page.screenshot({ path: 'tests/out/story_tab_courses.png' });
await page.evaluate(() => studio64.storyUI.close());
// the star select screen of Bob-omb Battlefield shows the new names
await page.evaluate(() => { const info = Object.values(studio64.catalog.levels).find((l) => l.num === 9); studio64.levelsUI.go(info); });
await page.waitForFunction(() => studio64.engine.inIntro, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.locator('#game-frame').screenshot({ path: 'tests/out/story_starselect.png' });
await page.waitForFunction(() => !studio64.engine.inIntro && studio64.engine.state().mario, null, { timeout: 60000 });
await page.waitForTimeout(1500);
// the build-mode Logic tab with a zone selected
await page.evaluate(() => { if (!studio64.editor.active) studio64.editor.enter(); document.querySelector('.lib-tab[data-lib=logic]').click(); });
await page.waitForTimeout(500);
await page.evaluate(() => studio64.logicUI.addZone('Secret garden'));
await page.waitForTimeout(1200);
await page.screenshot({ path: 'tests/out/story_logic_zone.png' });
ok(await page.evaluate(() => !!document.querySelector('.story-insp')), 'the inspector has the story section');
await page.evaluate(() => studio64.editor.select(null));
await page.waitForTimeout(500);
await page.screenshot({ path: 'tests/out/story_logic_tab.png' });
ok(await page.evaluate(() => !document.querySelector('#lib-logic').hidden && document.querySelectorAll('#lib-logic .lg-row').length >= 1), 'the Logic tab lists the zone');
ok(!errors.length, `no page errors (${errors.length})`);
await browser.close();
