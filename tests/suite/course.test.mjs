// Custom levels play like courses: pause freezes the game, Exit Course leaves to the castle,
// falling to death costs a life and leads to the castle; original levels pause too.
// @tags gameplay
// @timeout 600
import { suite } from '../lib/harness.mjs';

const tap = async (s, key, ms = 300) => { await s.page.keyboard.down(key); await s.wait(ms); await s.page.keyboard.up(key); await s.wait(250); };
// Keys held for exactly n game frames (the game frozen and stepped, like F8/F9).
async function stepKeys(s, keys, n) {
  await s.eval(() => studio64.engine.M._studio_debug_speed(1, 1));
  for (const k of keys) await s.page.keyboard.down(k);
  const f0 = await s.eval(() => studio64.engine.M._studio_debug_frames());
  await s.eval((n) => studio64.engine.M._studio_debug_step(n), n);
  await s.page.waitForFunction(([a, b]) => studio64.engine.M._studio_debug_frames() >= a + b, [f0, n], { polling: 30, timeout: 60000 });
  for (const k of keys) await s.page.keyboard.up(k);
}
// Start pauses only once the level's entry transition is over: press until Mario stays put.
// (menu: only check the game's play mode, no stick: holding W moves the pause menu's cursor)
async function pause(s, { menu = false } = {}) {
  // no pause while the warp transition runs (studio_story_debug bit 2) or a dialog is open (bit 1)
  await s.until(() => !(studio64.engine.M._studio_story_debug() & 3), null, 30000);
  for (let i = 0; i < 4; i++) {
    await tap(s, 'Enter', 500);
    await s.wait(1200);
    if (menu) { if (await s.eval(() => (studio64.engine.M._studio_story_debug() & 4) !== 0)) return true; continue; }
    const a = await s.mario();
    await s.page.keyboard.down('KeyW'); await s.wait(1200); await s.page.keyboard.up('KeyW');
    const b = await s.mario();
    if (Math.hypot(b.x - a.x, b.z - a.z) < 5) return true;
    await s.wait(1500);
  }
  return false;
}

await suite('course', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  const lvl = await s.newLevel('meadow', 'Course test');
  await s.play();
  await page.focus('#canvas');

  // pause: Mario does not move while paused
  await s.wait(3000);
  t.check('Start pauses: Mario stays', await pause(s));
  const p1 = await s.mario();
  await s.shot('pause');
  // resume (Start again; a busy machine can miss a short press, so try a few times)
  let p2;
  for (let i = 0; i < 3; i++) {
    await tap(s, 'Enter', 500);
    await s.wait(1000);
    p2 = await s.hold('KeyW', (m) => Math.hypot(m.x - p1.x, m.z - p1.z) > 100, 5000);
    if (p2.ok) break;
  }
  t.check('resumed: Mario walks', p2.ok, { p1, p2 });

  // exit course: pause, down to "Exit course", A (Mario back where he stood still, not mid-slide)
  await s.eval((p) => studio64.engine.teleport(p.x, p.y + 10, p.z, 0), p1);
  await s.until(() => studio64.engine.state().mario.action === '0x0C400201', null, 10000);
  t.check('pause before Exit Course', await pause(s, { menu: true }));
  // down one line and A, frame-exact: a held key repeats in the menu (12 frames of S on a fast
  // machine went past Exit Course to the camera line)
  await stepKeys(s, ['KeyS'], 3);
  await stepKeys(s, [], 8);
  await stepKeys(s, ['Space'], 2);
  await s.eval(() => studio64.engine.M._studio_debug_speed(0, 1));
  await page.waitForFunction(() => studio64.engine.level !== 37, null, { timeout: 30000 }).catch(() => {});
  await s.arrive(null, 40000).catch(() => {});
  t.check('Exit Course leaves the level', (await s.eval(() => studio64.engine.level)) !== 37, await s.eval(() => studio64.engine.level));
  t.check('engine alive after exit', await s.framesAdvance());

  // death: fall off the world -> castle, one life less
  await s.goCustom(lvl);
  const before = await s.mario();
  await s.eval(() => { const m = studio64.engine.state().mario; studio64.engine.teleport(m.x + 7900, -6000, m.z + 7900, 0); });
  await page.waitForFunction(() => studio64.engine.level !== 37, null, { timeout: 30000 }).catch(() => {});
  await s.arrive(null, 40000).catch(() => {});
  // the life counts down and health refills once Mario is back on his feet
  await s.until((lives) => { const m = studio64.engine.state().mario; return m && m.lives < lives && m.health === 8; }, before.lives, 30000);
  const after = await s.mario();
  t.check('death leads out of the level', (await s.eval(() => studio64.engine.level)) !== 37);
  t.eq('one life less', after.lives, before.lives - 1);
  t.check('health back to full', after.health === 8, after);

  // an original level pauses too and comes back
  await s.goLevel(9);
  await page.focus('#canvas');
  await s.wait(3000);
  t.check('BoB paused', await pause(s));
  const q0 = await s.mario();
  await tap(s, 'Enter');
  await s.wait(600);
  // entering build mode while paused, then back: the game still runs
  await s.build();
  await s.play();
  await page.focus('#canvas');
  const q1 = await s.hold('KeyW', (m) => Math.hypot(m.x - q0.x, m.z - q0.z) > 100);
  t.check('after pause + build mode, Mario walks again', q1.ok, { q0, q1 });
});
