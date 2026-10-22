// Game rules: the Game panel changes Mario's jump height (measured), gravity, run speed,
// switches moves off (long jump), fall damage; per-level overrides win over the game's rules;
// the rules are saved in the project and come back after a reload.
// @tags objects rules
// @timeout 600
import { suite } from '../lib/harness.mjs';

await suite('game rules', async (t) => {
  const s = await t.open({ level: 9 });
  const levelId = await s.newLevel('flat', 'Rules test');
  await s.play();
  await s.eval(() => { window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; }); });
  const frames = async (n) => {
    const f0 = await s.eval(() => window.__fc);
    await s.page.waitForFunction(([a, b]) => window.__fc >= a + b, [f0, n], { timeout: 180000, polling: 30 });
  };
  const rules = () => s.eval(() => studio64.engine.json('studio_rules_json'));
  const home = async () => { await s.eval(() => studio64.engine.teleport(0, 80, 0, 0)); await frames(25); };
  // a full jump (A held), returns its height
  const jump = async () => {
    await home();
    await s.page.focus('#canvas');
    const y0 = (await s.mario()).y;
    await s.page.keyboard.down('Space');
    await frames(30);
    await s.page.keyboard.up('Space');
    await frames(45);
    return (await rules()).peak - y0;
  };
  // runs for 45 frames with the autopilot, returns the distance
  const run = async () => {
    await home();
    const a = await s.mario();
    await s.eval(() => studio64.engine.M._studio_walk(0, 45));
    await frames(48);
    const b = await s.mario();
    return Math.hypot(b.x - a.x, b.z - a.z);
  };

  const h1 = await jump();
  t.check('a normal full jump is about 240 units high', h1 > 180 && h1 < 300, { h1 });
  const d1 = await run();

  // the Game panel: Jumps -> Jump x2 (as a user does it)
  await s.page.click('#game-btn');
  await s.page.waitForSelector('.om-dialog.gr');
  await s.page.click('.gr-tab[data-s=jumps]');
  const num = s.page.locator('.gr-row').filter({ hasText: /^Jump/ }).first().locator('input[type=number]');
  await num.fill('2');
  await num.press('Enter');
  await s.wait(300);
  await s.shot('game_panel');
  await s.page.click('.gr-tab[data-s=physics]');
  const run15 = s.page.locator('.gr-row').filter({ hasText: 'Run speed' }).locator('input[type=number]');
  await run15.fill('1.5');
  await run15.press('Enter');
  await s.wait(300);
  await s.page.click('.om-dialog.gr [data-a=close]');
  await s.settle(500);
  const r = await rules();
  t.near('the engine has the new jump rule', r.jump, 2, 0.01);
  const h2 = await jump();
  t.near('jumps are twice as high', h2 / h1, 2, 0.35);
  const d2 = await run();
  t.near('Mario runs 1.5 times as fast', d2 / d1, 1.5, 0.2);

  // per-level override wins, resetting it brings the game rule back
  await s.eval(() => studio64.objects.rules.set({ jump: 1 }, 'normal jumps here', 'level'));
  await s.settle(400);
  const h3 = await jump();
  t.near('a level override (jump 1) wins over the game rule', h3 / h1, 1, 0.2);
  await s.eval(() => studio64.objects.rules.resetLevel());
  await s.settle(400);
  t.near('back to the game rule after resetting the level', (await rules()).jump, 2, 0.01);

  // gravity
  await s.eval(() => studio64.objects.rules.set({ jump: 1, gravity: 0.5 }, 'moon', 'game'));
  await s.settle(400);
  const h4 = await jump();
  t.check('half gravity makes jumps much higher', h4 / h1 > 1.6, { ratio: h4 / h1 });

  // fall damage off, then on
  await s.eval(() => studio64.objects.rules.set({ gravity: 1, fallDamage: 0 }, 'no fall damage', 'game'));
  await s.settle(300);
  await s.eval(() => { studio64.engine.heal(); studio64.engine.teleport(0, 2400, 0, 0); });
  await frames(90);
  t.eq('no fall damage: a big fall does not hurt', (await s.mario()).health, 8);
  await s.eval(() => studio64.objects.rules.set({ fallDamage: 1150 }, 'fall damage', 'game'));
  await s.settle(300);
  await s.eval(() => { studio64.engine.heal(); studio64.engine.teleport(0, 2400, 0, 0); });
  await frames(90);
  t.check('normal fall damage: the same fall hurts', (await s.mario()).health < 8, (await s.mario()).health);

  // long jump switched off: run + Z + A gives a normal jump
  await s.eval(() => studio64.engine.heal());
  const longJump = async () => {
    await home();
    await s.page.focus('#canvas');
    await s.eval(() => studio64.engine.M._studio_walk(0, 40));
    await frames(25);
    await s.page.keyboard.down('Shift');
    await frames(1);
    await s.page.keyboard.down('Space');
    const acts = new Set();
    for (let i = 0; i < 12; i++) { await frames(2); acts.add((await rules()).action >>> 0); }
    await s.page.keyboard.up('Space');
    await s.page.keyboard.up('Shift');
    await frames(30);
    return acts;
  };
  const ACT_LONG_JUMP = 0x03000888;
  const before = await longJump();
  t.check('a long jump works normally', before.has(ACT_LONG_JUMP), [...before].map((a) => a.toString(16)));
  await s.eval(() => studio64.objects.rules.set({ moves: { longJump: false } }, 'no long jump', 'game'));
  await s.settle(300);
  const after = await longJump();
  t.check('with the long jump switched off it does not happen', !after.has(ACT_LONG_JUMP), [...after].map((a) => a.toString(16)));

  // saved in the project: reload, the rules are back
  await s.settle(800);
  await s.reload();
  await s.arrive(37, 150000).catch(() => {}); // the app reopens the level it was in
  if ((await s.eval(() => studio64.engine.level)) !== 37) await s.goCustom(levelId);
  t.eq('after a reload the project reopens in the custom level', await s.eval(() => studio64.engine.customLevel), levelId);
  await s.wait(1500);
  const rr = await s.eval(() => studio64.engine.json('studio_rules_json'));
  t.check('after a reload: long jump still off, run speed still 1.5', (rr.disabled & 1) === 1 && Math.abs(rr.run - 1.5) < 0.01, rr);
  const saved = await s.export();
  t.check('the rules are in the exported project', !!saved.areas?.['@game']?.rules?.base?.moves, saved.areas?.['@game']?.rules);
});
