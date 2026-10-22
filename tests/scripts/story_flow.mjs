// A whole little story, played like a player would: talk to a Toad (conditional lines, a reward
// after talking), walk into a zone (dialog + flag + a gate opens), a cutscene starts from the flag
// and is skipped with Start, the Toad's line changes, and the progress survives a reload and
// re-entering the level (the gate stays open, the zone event does not run twice).
import { chromium } from 'playwright';
const URL = process.env.STUDIO_URL || 'http://127.0.0.1:8064';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const proj = await (await fetch(URL + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 9 }) })).json();
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } }); // one browser profile: localStorage keeps the progress
let page = await context.newPage();
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => { errors.push(e.message); console.log('pageerror:', e.message); });
  p.on('console', (m) => { if (/error|abort/i.test(m.text()) && !/favicon/.test(m.text())) console.log('console:', m.text()); });
};
watch(page);
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) process.exitCode = 1; };
const shot = (n) => page.locator('#game-frame').screenshot({ path: `tests/out/${n}.png` });
// held long enough for a slow headless browser (a few frames per second)
const press = async (k, n = 1, gap = 450) => { for (let i = 0; i < n; i++) { await page.keyboard.down(k); await page.waitForTimeout(350); await page.keyboard.up(k); await page.waitForTimeout(gap); } };
const busy = () => page.evaluate(() => studio64.engine.M._studio_story_dialog_busy());
const waitIdle = async (ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (!(await busy())) return true; await press('Space', 1, 350); } return false; };
// walk north into the Toad and press B until the talk starts
const talk = async () => {
  await page.evaluate(() => { studio64.storyRuntime.lastTalk = null; });
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => studio64.engine.M._studio_walk(0, 14));
    await page.waitForTimeout(700);
    await page.waitForFunction(() => studio64.engine.state().mario?.action === '0x0C400201', null, { timeout: 20000, polling: 100 }).catch(() => {}); // B while walking would punch
    await press('KeyJ', 1, 1300);
    if (await busy() && await page.evaluate(() => !!studio64.storyRuntime.lastTalk)) return true;
    await waitIdle(8000);
    await page.evaluate(() => studio64.engine.teleport(0, 30, 80, 0));
    await page.waitForTimeout(700);
  }
  return false;
};
const log = () => page.evaluate(() => studio64.storyRuntime.log.map((l) => l.text));

async function boot() {
  await page.goto(URL + '/?p=' + proj.id);
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 300000 });
  await page.click('#start');
  await page.waitForTimeout(1500);
}
async function settle() {
  await page.waitForFunction(() => !studio64.engine.inIntro && studio64.engine.state().mario, null, { timeout: 30000 });
  await page.waitForTimeout(2000);
  if (await page.evaluate(() => studio64.editor.active)) { await page.click('#mode-play'); await page.waitForTimeout(400); }
  await page.evaluate(() => document.querySelector('#canvas').focus());
}

await boot();
await page.evaluate(() => studio64.levelsUI.createLevel('flat', null, 'Gate test'));
await page.waitForFunction(() => studio64.engine.inIntro, null, { timeout: 15000 }).catch(() => {});
await settle();

// ---- build the story with the editor's own functions -------------------------------------
const ids = await page.evaluate(() => {
  const ui = studio64.storyUI, logic = studio64.logicUI;
  // Mario waits far from everything while the story is built
  studio64.engine.teleport(0, 30, -900, 0);
  const zone = { uid: 0x515151, block: { shape: 0, sx: 600, sy: 400, sz: 600, steps: 8, top: 28, side: 28, surface: 0, flags: 6, color: 0x50b4ff }, x: 0, y: 0, z: 900, yaw: 0, pitch: 0, roll: 0, name: 'Gate zone', zone: { name: 'Gate zone' } };
  logic.commitRecord(zone, 'Added a zone');
  // the gate: a stone wall
  const wall = { uid: 424242, block: { shape: 0, sx: 800, sy: 500, sz: 80, steps: 8, top: 9, side: 9, surface: 0, flags: 0, color: 0xffffff }, x: 0, y: 0, z: 1500, yaw: 0, pitch: 0, roll: 0, name: 'Gate' };
  logic.commitRecord(wall, 'Added the gate');
  const flag = ui.newVar('flag', 'gate open');
  const dOpen = ui.newDialog({ name: 'Gate opens', text: 'Click! Somewhere, a gate opens...' });
  const dFind = ui.newDialog({ name: 'Toad: find it', text: 'The gate is shut. Find the magic spot ahead!' });
  const dDone = ui.newDialog({ name: 'Toad: done', text: 'You opened the gate! Well done, Mario!' });
  const toad = ui.placeCharacter({ id: 'toad', label: 'Toad', model: 'toad_message', anim: [1, 6] }, { x: 0, y: 0, z: 300, face: Math.PI });
  ui.op({ op: 'npc', uid: toad.uid, value: { name: 'Gate Toad', lines: [{ dialog: dDone.id, if: [{ type: 'flag', var: flag.id, value: true }] }, { dialog: dFind.id, if: [] }] } });
  ui.newEvent({ name: 'Toad gives coins', repeat: 'once', trigger: { type: 'talk', uid: toad.uid }, actions: [{ type: 'coins', amount: 10 }] });
  ui.newEvent({ name: 'Open the gate', repeat: 'once', trigger: { type: 'enter_zone', zone: zone.uid }, actions: [{ type: 'dialog', dialog: dOpen.id }, { type: 'set_flag', var: flag.id, value: 'true' }, { type: 'open_door', uid: 424242 }] });
  const cs = ui.newCutscene({ name: 'Gate cam', steps: [{ type: 'shot', pos: [900, 600, 700], focus: [0, 250, 1500], seconds: 1.5, ease: 'smooth' }, { type: 'caption', text: 'The gate is open!', seconds: 4 }, { type: 'wait', seconds: 6 }] });
  ui.newEvent({ name: 'Show the gate', repeat: 'once', trigger: { type: 'var', var: flag.id, op: '==', value: true }, actions: [{ type: 'cutscene', cutscene: cs.id }] });
  studio64.storyUI.flush();
  return { zone: zone.uid, toad: toad.uid, flag: flag.id };
});
console.log('built', JSON.stringify(ids));
await page.waitForTimeout(1500);
ok(await page.evaluate(() => studio64.engine.objects().some((o) => o.uid === 424242)), 'the gate stands');
ok(await page.evaluate((u) => studio64.engine.objects().some((o) => o.uid === u), ids.zone), 'the zone exists (invisible)');

// ---- talk to the Toad -------------------------------------------------------------------
const coins0 = await page.evaluate(() => studio64.engine.state().mario.coins);
await page.evaluate(() => studio64.engine.teleport(0, 30, 80, 0));
await page.waitForTimeout(900);
await talk();
await shot('story_flow_1_toad');
ok(await page.evaluate(() => studio64.storyRuntime.lastTalk?.dialog && studio64.story.dialogs.find((d) => d.id === studio64.storyRuntime.lastTalk.dialog)?.name), 'Toad says something');
ok((await page.evaluate(() => studio64.story.dialogs.find((d) => d.id === studio64.storyRuntime.lastTalk?.dialog)?.name)) === 'Toad: find it', 'before the gate: "find it" line');
await waitIdle();
// the talk ends when Mario has stepped back (slow in a headless browser)
await page.waitForFunction(() => studio64.storyRuntime.log.some((l) => /Talked to/.test(l.text)), null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1500);
const coins1 = await page.evaluate(() => studio64.engine.state().mario.coins);
ok(coins1 === coins0 + 10, `after talking: +10 coins (${coins0} -> ${coins1})`);

// ---- walk into the zone ---------------------------------------------------------------------
await page.evaluate(() => studio64.engine.teleport(0, 30, 900, 0));
await page.waitForTimeout(1800);
await shot('story_flow_2_zone');
ok(await busy() === 1, 'entering the zone shows the dialog');
await waitIdle();
await page.waitForTimeout(1200);
ok(await page.evaluate((f) => studio64.storyRuntime.getVar(f) === true, ids.flag), 'flag "gate open" is set');
ok(!(await page.evaluate(() => studio64.engine.objects().some((o) => o.uid === 424242))), 'the gate opened (removed)');
// the cutscene from the flag
await page.waitForFunction(() => !!studio64.storyRuntime.cut, null, { timeout: 8000 }).catch(() => {});
ok(await page.evaluate(() => !!studio64.storyRuntime.cut), 'the cutscene plays');
// game frames, not milliseconds: a busy machine runs the 1.5 s shot at a few frames a second
await page.waitForFunction(() => { const c = studio64.engine.camOut().pos; return Math.abs(c[0] - 900) < 40 && Math.abs(c[1] - 600) < 40; }, null, { timeout: 90000, polling: 100 }).catch(() => {});
await shot('story_flow_3_cutscene');
const camDuring = await page.evaluate(() => studio64.engine.camOut().pos.map(Math.round));
ok(Math.abs(camDuring[0] - 900) < 40 && Math.abs(camDuring[1] - 600) < 40, `the camera reached the shot (${camDuring})`);
// Start held until the game saw it (a slow machine can miss a short press between two frames)
for (let i = 0; i < 3 && await page.evaluate(() => !!studio64.storyRuntime.cut); i++) {
  await page.keyboard.down('Enter');
  await page.waitForFunction(() => !studio64.storyRuntime.cut, null, { timeout: 30000, polling: 100 }).catch(() => {});
  await page.keyboard.up('Enter');
  await page.waitForTimeout(500);
}
ok(await page.evaluate(() => !studio64.storyRuntime.cut), 'Start skipped the cutscene');
ok((await log()).includes('Cutscene skipped'), 'skip noted');
await page.waitForTimeout(800);
ok(await page.evaluate(() => (studio64.engine.state().mario.action) !== '0x0000130A'), 'Mario can move again');
await shot('story_flow_4_after');

// ---- the Toad's other line ----------------------------------------------------------------
await page.waitForFunction(() => !studio64.storyRuntime.cut && !studio64.storyRuntime.running, null, { timeout: 20000 }).catch(() => {});
await page.evaluate(() => studio64.engine.teleport(0, 30, 80, 0));
await page.waitForTimeout(900);
await talk();
ok((await page.evaluate(() => studio64.story.dialogs.find((d) => d.id === studio64.storyRuntime.lastTalk?.dialog)?.name)) === 'Toad: done', 'after the gate: "done" line');
await shot('story_flow_5_toad_again');
await waitIdle();
await page.waitForFunction(() => studio64.storyRuntime.log.filter((l) => /Talked to/.test(l.text)).length >= 2, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1500);
const coins2 = await page.evaluate(() => studio64.engine.state().mario.coins);
ok(coins2 === coins1, 'the coin reward was once only');

// ---- reload the page -------------------------------------------------------------------------
await page.close();
page = await context.newPage();
watch(page);
await boot();
await page.waitForFunction(() => studio64.engine.areaKey().startsWith('c:'), null, { timeout: 30000 }).catch(() => {});
await settle();
const key = await page.evaluate(() => studio64.engine.areaKey());
ok(key.startsWith('c:'), `back in the custom level after reload (${key})`);
ok(await page.evaluate((f) => studio64.storyRuntime.getVar(f) === true, ids.flag), 'flag survived the reload');
ok(!(await page.evaluate(() => studio64.engine.objects().some((o) => o.uid === 424242))), 'the gate stays open after the reload');
ok(await page.evaluate(() => studio64.story.events.length === 3 && studio64.story.dialogs.length >= 4), 'the story was saved on the server');
// walking into the zone again does nothing (once per save)
await page.evaluate(() => studio64.engine.teleport(0, 30, 900, 0));
await page.waitForTimeout(1800);
ok(await busy() === 0, 'the zone event does not run twice');

// ---- leave and come back (like after losing a life) ----------------------------------------
await page.evaluate(() => { const l = studio64.levels[0]; studio64.engine.warpFast(studio64.engine.studioLevel, 0, l.id, false); });
await page.waitForTimeout(1500);
await settle();
ok(!(await page.evaluate(() => studio64.engine.objects().some((o) => o.uid === 424242))), 'the gate stays open after re-entering the level');

// ---- reset brings the start back -------------------------------------------------------------
await page.evaluate(() => studio64.storyRuntime.resetProgress());
await page.evaluate(() => { const l = studio64.levels[0]; studio64.engine.warpFast(studio64.engine.studioLevel, 0, l.id, false); });
await page.waitForTimeout(1500);
await settle();
ok(await page.evaluate(() => studio64.engine.objects().some((o) => o.uid === 424242)), 'after a progress reset the gate is back');
ok(!errors.length, `no page errors (${errors.length})`);
await browser.close();
