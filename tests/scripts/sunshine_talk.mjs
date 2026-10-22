// Talking to the Sunshine islanders: Mario walks up to a Pianta and a Noki, presses B, and the
// game's dialog opens (Mario waits for the dialog); A closes it and they cheer.
import { chromium } from 'playwright';
const URL = process.env.STUDIO_URL || 'http://127.0.0.1:8064';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const proj = await (await fetch(URL + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 9 }) })).json();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('pageerror:', e.message); });
await page.goto(URL + '/?p=' + proj.id);
await page.waitForSelector('#loading', { state: 'hidden', timeout: 120000 });
await page.click('#start', { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.evaluate(() => studio64.levelsUI.createLevel('flat', null, 'Talk test'));
await page.waitForFunction(() => studio64.engine.inIntro, null, { timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => !studio64.engine.inIntro, null, { timeout: 20000 });
await page.waitForTimeout(2500);
if (await page.evaluate(() => studio64.editor.active)) await page.evaluate(() => document.querySelector('#mode-play').click());
await page.locator('canvas').first().click().catch(() => {});
const frames = (n) => page.evaluate((n) => new Promise((resolve) => { const e = studio64.engine; let k = 0; const fn = () => { if (++k >= n) { e.off('frame', fn); resolve(); } }; e.on('frame', fn); }), n);
const press = async (key) => { await page.keyboard.down(key); await frames(3); await page.keyboard.up(key); };
let ok = true;
const check = (name, cond, info = '') => { ok &&= !!cond; console.log(cond ? 'PASS' : 'FAIL', name, info); };
const DIALOG = [0x20001306, 0x0000130A];  // ACT_READING_NPC_DIALOG, ACT_WAITING_FOR_DIALOG
for (const [entry, bp, n] of [['sms:pianta', 0x00000101, 'pianta'], ['sms:noki', 0x00030201, 'noki']]) {
  await page.evaluate(() => { for (const o of studio64.engine.objects().filter((o) => /^bhvSms/.test(o.bhv))) studio64.engine.deleteSlot(o.slot); });
  await page.evaluate(() => studio64.engine.teleport(0, 30, -400, 0));
  await frames(10);
  await page.evaluate(([e, bp]) => studio64.engine.spawn({ uid: 0x7d100000 + bp, entry: e, x: 0, y: 0, z: 0, yaw: 0x8000, pitch: 0, roll: 0, bparams: bp, scale: 1 }), [entry, bp]);
  await frames(15);
  await page.evaluate(() => studio64.engine.teleport(0, 30, -135, 0));  // touching it, facing it
  await frames(30);
  await press('KeyJ');
  await frames(30);
  const a = await page.evaluate(() => parseInt(studio64.engine.state().mario.action, 16));
  await page.locator('canvas').first().screenshot({ path: `tests/out/sms_${n}_dialog.png` });
  check(`${n}: B opens the dialog`, DIALOG.includes(a), `action 0x${a.toString(16)}`);
  // A until the dialog is over (more A presses would start the next line: the US game talks on A too)
  const act = () => page.evaluate(() => parseInt(studio64.engine.state().mario.action, 16));
  for (let i = 0; i < 10 && (await act()) === 0x20001306; i++) { await press('Space'); await frames(10); }
  await frames(40);
  await page.locator('canvas').first().screenshot({ path: `tests/out/sms_${n}_after.png` });
  const b = await page.evaluate(() => parseInt(studio64.engine.state().mario.action, 16));
  check(`${n}: A closes it`, !DIALOG.includes(b), `action 0x${b.toString(16)}`);
  // talking again right away (while it cheers) never leaves Mario waiting forever
  await press('Space');
  await frames(45);
  const c = await act();
  check(`${n}: talking again works`, c !== 0x0000130A, `action 0x${c.toString(16)}`);
  for (let i = 0; i < 10 && (await act()) === 0x20001306; i++) { await press('Space'); await frames(10); }
}
check('no page errors', !errors.length, errors.join(' | '));
await browser.close();
process.exit(ok ? 0 : 1);
