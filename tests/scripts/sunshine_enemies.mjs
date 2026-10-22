// The Super Mario Sunshine enemies: they draw (close-ups from a free camera), chase Mario, and
// react to stomps the SM64 way. Usage: node tests/scripts/sunshine_enemies.mjs [looks|play|all]
import { chromium } from 'playwright';
const URL = process.env.STUDIO_URL || 'http://127.0.0.1:8064';
const mode = process.argv[2] || 'all';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const proj = await (await fetch(URL + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 9 }) })).json();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('pageerror:', e.message); });
page.on('console', (m) => { if (/error|abort/i.test(m.text())) console.log('console:', m.text()); });
await page.goto(URL + '/?p=' + proj.id);
await page.waitForSelector('#loading', { state: 'hidden', timeout: 120000 });
await page.click('#start', { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.evaluate(() => studio64.levelsUI.createLevel('flat', null, 'Sunshine enemies'));
await page.waitForFunction(() => studio64.engine.inIntro, null, { timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => !studio64.engine.inIntro, null, { timeout: 15000 });
await page.waitForTimeout(2500);
if (await page.evaluate(() => studio64.editor.active)) { await page.evaluate(() => document.querySelector('#mode-play').click()); await page.waitForTimeout(500); }

// game frames, not wall time: the tests run on busy machines
const frames = (n) => page.evaluate((n) => new Promise((resolve) => {
  const e = studio64.engine; let k = 0;
  const fn = () => { if (++k >= n) { e.off('frame', fn); resolve(); } };
  e.on('frame', fn);
}), n);
const shot = (n) => page.locator('canvas').first().screenshot({ path: `tests/out/${n}.png` });
const ENEMIES = [
  ['sms:strollin_stu', 0, 'stu'], ['sms:swoopin_stu', 0x0101, 'swoop'], ['sms:electrokoopa', 1, 'ekoopa'],
  ['sms:pokey', 0, 'pokey'], ['sms:cataquack', 1, 'quack'], ['sms:blooper', 1, 'blooper'],
];
let uid = 0x7c000000;
const spawn = (entry, x, z, bparams, yaw = 0x8000) => page.evaluate((r) => studio64.engine.spawn(r),
  { uid: uid++, entry, x, y: 0, z, yaw, pitch: 0, roll: 0, bparams, scale: 1 });
const objs = () => page.evaluate(() => studio64.engine.objects().filter((o) => /^bhvSms/.test(o.bhv)));
const clear = async () => { for (const o of await objs()) await page.evaluate((s) => studio64.engine.deleteSlot(s), o.slot); };
const state = () => page.evaluate(() => studio64.engine.state().mario);
const results = [];
const check = (name, ok, info = '') => { results.push([name, ok]); console.log(ok ? 'PASS' : 'FAIL', name, info); };

if (mode === 'looks' || mode === 'all') {
  // all in a row, standing guard (byte 4 = 1), Mario far away so they stay calm
  await page.evaluate(() => studio64.engine.teleport(0, 30, -3000, 0));
  await page.waitForTimeout(500);
  for (const [i, [entry, bp]] of ENEMIES.entries()) await spawn(entry, (i - 2.5) * 420, 0, bp | 1);
  await page.waitForTimeout(1500);
  await page.evaluate(() => studio64.engine.setCamera(true, [0, 650, -2300], [0, 100, 0], 45));
  await page.waitForTimeout(600);
  await shot('sms_enemies_row');
  for (const [i, [, , n]] of ENEMIES.entries()) {
    const x = (i - 2.5) * 420;
    for (const [view, dx, dz] of [['front', 140, -330], ['back', -120, 330]]) {
      await page.evaluate(([p, f]) => studio64.engine.setCamera(true, p, f, 45), [[x + dx, 200, dz], [x, 90, 0]]);
      await page.waitForTimeout(450);
      await shot(`sms_${n}_${view}`);
    }
  }
  await page.evaluate(() => studio64.engine.setCamera(false));
  await clear();
}

if (mode === 'play' || mode === 'all') {
  // each enemy alone: it notices Mario and comes closer (or attacks), then a stomp from above
  for (const [entry, bp, n] of ENEMIES) {
    await clear();
    await page.evaluate(() => studio64.engine.teleport(0, 30, -900, 0));
    await page.waitForTimeout(400);
    await spawn(entry, 0, 0, bp & ~0xff);
    await page.waitForTimeout(300);
    const before = (await objs()).find((o) => o.bhv !== 'bhvSmsHurtbox');
    // (a Pokey only lunges at close range)
    await page.evaluate((z) => studio64.engine.teleport(0, 30, z, 0), n === 'pokey' ? -300 : -520);
    await frames(75);
    const thrown = (await objs()).some((o) => o.bhv === 'bhvSmsElectroShell');
    const after = (await objs()).find((o) => o.bhv === before.bhv);
    const m = await state();
    const moved = after ? Math.hypot(after.x - before.x, after.z - before.z) : -1;
    const turned = after ? Math.abs(((after.yaw - before.yaw) << 16) >> 16) : 0;
    check(`${n} notices Mario`, moved > 40 || turned > 0x1000 || m.health < 8 || m.y > 200 || thrown, `moved ${moved | 0} turned ${turned} health ${m.health} y ${m.y | 0} shell ${thrown}`);
    await shot(`sms_${n}_play`);
    // stomp: a fresh one that stands still (Mario far away), then drop Mario onto it
    await clear();
    await page.evaluate(() => { studio64.engine.teleport(0, 30, -2500, 0); studio64.engine.heal(); });
    await frames(5);
    await spawn(entry, 0, 0, n === 'pokey' ? 0 : (bp & ~0xff) | 1);
    await frames(10);
    const o = (await objs()).find((x) => x.bhv === before.bhv);
    if (!o) { check(`${n} spawned for the stomp`, false); continue; }
    const coins0 = (await state()).coins;
    if (n === 'blooper') {
      // one stomp only, frame by frame (the game frozen and stepped): as soon as Mario bounces off,
      // take him away; a second stomp on the numb Blooper would finish it
      await page.evaluate(() => studio64.engine.M._studio_debug_speed(1, 1));
      await page.evaluate((o) => studio64.engine.teleport(o.x, o.y + o.h + 260, o.z, 0), o);
      let prevY = (await state()).y;
      for (let i = 0; i < 60; i++) {
        await page.evaluate(() => new Promise((r) => { const e = studio64.engine; const fn = () => { e.off('frame', fn); r(); }; e.on('frame', fn); e.M._studio_debug_step(1); }));
        const m = await state();
        if (m.y > prevY + 4) { await page.evaluate(() => studio64.engine.teleport(0, 30, -2500, 0)); console.log(`  blooper: bounced off it on frame ${i}`); break; }
        prevY = m.y;
      }
      await page.evaluate(() => studio64.engine.M._studio_debug_speed(0, 1));
      await shot(`sms_${n}_stomp`);
      await frames(10);
    } else {
      await page.evaluate((o) => studio64.engine.teleport(o.x, o.y + o.h + 260, o.z, 0), o);
      await frames(6);
      await shot(`sms_${n}_stomp`);
      await frames(n === 'pokey' ? 24 : 90);  // (a bouncing Mario stomps again and again)
    }  // (a bouncing Mario stomps again and again)
    const left = (await objs()).filter((x) => x.bhv === before.bhv);
    const s = await state();
    console.log(`  ${n}: after the stomp ${left.length} left, coins ${coins0} -> ${s.coins}, health ${s.health}`, before.bhv, JSON.stringify((await objs()).filter((x) => /Sms/.test(x.bhv)).map((x) => x.bhv)));
    // an Electrokoopa that has thrown its shell is defenceless; with its shell it shocks Mario
    if (n === 'ekoopa') check(`${n} shell shocks a stomping Mario`, s.health < 8 && left.length === 1);
    else if (n === 'pokey') check(`${n} loses a segment`, left.length === 1 && left[0].h < o.h, `height ${o.h} -> ${left[0]?.h}`);
    else if (n === 'blooper') check(`${n} goes numb (alive)`, left.length === 1);
    else check(`${n} defeated by a stomp`, left.length === 0);
  }
}
check('no page errors', errors.length === 0, errors.join(' | '));
console.log(`${results.filter((r) => r[1]).length}/${results.length} passed`);
await browser.close();
process.exit(results.every((r) => r[1]) ? 0 : 1);
