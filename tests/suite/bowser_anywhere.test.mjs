// Bowser outside his arenas (engine/src/game/behaviors/bowser.inc.c, "bowser_outside_arena"):
// placed in the castle grounds the way Claude places him (one spawn: Bowser + a ring of mines),
// he roars, walks in and fights (no intro cutscene to wait for), has 3 health, Mario grabs his
// tail, spins him and throws him into a mine: the mine explodes and Bowser loses one health.
// The ring of mines leaves Mario's side free. In his own arena (Bowser in the Dark World)
// everything stays the original: he waits for the intro cutscene with 1 health.
// @tags objects gameplay
// @timeout 900
import { suite } from '../lib/harness.mjs';

const ACT_PICKING_UP_BOWSER = 0x390, ACT_HOLDING_BOWSER = 0x391, ACT_RELEASING_BOWSER = 0x392;
const B_BUTTON = 0x4000;

await suite('bowser anywhere', async (t) => {
  const s = await t.open({ level: 16, viewport: { width: 1200, height: 720 } });
  const M = (fn, ...a) => s.eval(([fn, a]) => studio64.engine.M['_' + fn](...a), [fn, a]);
  const json = (fn, ...a) => s.eval(([fn, a]) => JSON.parse(studio64.engine.M.UTF8ToString(studio64.engine.M['_' + fn](...a))), [fn, a]);
  const step = async (n = 1) => {
    const f0 = await M('studio_debug_frames');
    await M('studio_debug_step', n);
    await s.page.waitForFunction(([a, b]) => studio64.engine.M._studio_debug_frames() >= a + b, [f0, n], { polling: 30, timeout: 180000 });
  };
  const mario = () => json('studio_debug_mario_json');
  const obj = (slot) => json('studio_debug_obj_json', slot);
  const find = (bhv) => s.eval((b) => studio64.engine.objects().filter((o) => o.bhv === b), bhv);
  const yawTo = (dx, dz) => (Math.round((Math.atan2(dx, dz) * 32768) / Math.PI) + 65536) % 65536;

  await M('studio_debug_speed', 1, 1);
  await step(2);
  const m0 = await mario();
  // ---- placed like Claude does: one spawn call, Bowser 1000 ahead, 5 mines around him ----
  const bx = m0.x + Math.sin((m0.yaw * Math.PI) / 32768) * 1000, bz = m0.z + Math.cos((m0.yaw * Math.PI) / 32768) * 1000;
  const placed = await s.eval((p) => studio64.studio.handle('place', p), {
    items: [
      { id: 'bowser', where: { mode: 'at', x: bx, z: bz } },
      { id: 'bowser_bomb', count: 5, where: { mode: 'around', x: bx, z: bz, radius: 1300 } },
    ],
  });
  t.eq('Bowser and 5 mines placed', placed.placed?.length, 6);
  const mines = await find('bhvBowserBomb');
  const nearest = Math.min(...mines.map((o) => Math.hypot(o.x - m0.x, o.z - m0.z)));
  t.check('the ring of mines leaves Mario\'s side free', nearest > 600, { nearest: Math.round(nearest) });

  const [bow] = await find('bhvBowser');
  t.must('Bowser is in the level', !!bow);
  await step(1);
  let b = await obj(bow.slot);
  t.eq('3 health outside his arenas', b.health, 3);
  const seen = new Set();
  for (let i = 0; i < 20; i++) { await step(10); b = await obj(bow.slot); seen.add(b.action); }
  t.check('he walks in by himself and fights (no intro cutscene to wait for)', [...seen].some((a) => [0, 3, 7, 13, 14, 15].includes(a)) && b.action !== 5, [...seen]);
  t.check('he stays near the spot he was placed', Math.hypot(b.x - bx, b.z - bz) < 1500, { b, bx, bz });

  // ---- grab the tail, spin, throw him into a mine ----
  await M('studio_debug_obj_action', bow.slot, 15); // breathing fire: he stands still and does not turn
  await step(2);
  b = await obj(bow.slot);
  const fx = Math.sin((b.yaw * Math.PI) / 32768), fz = Math.cos((b.yaw * Math.PI) / 32768);
  const [tail] = (await find('bhvBowserTailAnchor')).filter((o) => o.parent === bow.slot);
  t.must('his tail anchor exists', !!tail);
  await s.eval(([x, y, z, yaw]) => studio64.engine.teleport(x, y, z, yaw), [tail.x - fx * 80, b.y, tail.z - fz * 80, b.yaw]);
  let grabbed = false;
  for (let i = 0; i < 120 && !grabbed; i++) {
    const tl = await obj(tail.slot), m = await mario();
    const press = tl.y - m.y < 100 && Math.hypot(tl.x - m.x, tl.z - m.z) < 130;
    await M('studio_bot', 1, press ? B_BUTTON : 0, b.yaw, 0);
    await step(1);
    const a = (await mario()).action;
    if (a === ACT_PICKING_UP_BOWSER || a === ACT_HOLDING_BOWSER) grabbed = true;
    else if (press) { await M('studio_bot', 1, 0, b.yaw, 0); await step(12); } // the punch missed: try again
  }
  t.must('Mario grabs Bowser by the tail', grabbed);
  // the target: the mine most nearly in line, 900-2000 away
  const m1 = await mario();
  const target = mines.map((o) => ({ o, d: Math.hypot(o.x - m1.x, o.z - m1.z) })).filter((x) => x.d > 900 && x.d < 2200).sort((a, c) => a.d - c.d)[0]?.o || mines[0];
  const want = yawTo(target.x - m1.x, target.z - m1.z);
  let stick = m1.yaw, spins = 0, thrown = false;
  for (let i = 0; i < 400 && !thrown; i++) {
    const m = await mario();
    if (m.action === ACT_HOLDING_BOWSER) {
      spins++;
      stick = (stick + 0x4000) % 65536;
      const d = ((((want - m.yaw) % 65536) + 98304) % 65536) - 32768;
      const go = spins > 45 && Math.abs(d) < 0x0C00;
      await M('studio_bot', 1, go ? B_BUTTON : 0, stick, 64);
      if (go) thrown = true;
    } else await M('studio_bot', 1, 0, stick, 0);
    await step(1);
  }
  t.must('Mario spins Bowser and lets go', thrown);
  await M('studio_bot', 1, 0, 0, 0);
  await step(1);
  t.eq('Mario throws (releasing Bowser)', (await mario()).action, ACT_RELEASING_BOWSER);
  let hit = false, exploded = false;
  for (let i = 0; i < 40 && !hit; i++) {
    await step(1);
    b = await obj(bow.slot);
    if (b.health === 2) hit = true;
    if ((await find('bhvBowserBombExplosion')).length) exploded = true;
  }
  t.check('the mine explodes', exploded || (await find('bhvBowserBomb')).length === mines.length - 1);
  t.check('Bowser loses one health', hit, b);
  await step(10);
  t.eq('he is hit (thrown back by the blast)', (await obj(bow.slot)).action, 12);
  await M('studio_bot', 0, 0, 0, 0);
  await M('studio_debug_speed', 0, 1);
  await s.shot('castle_fight');

  // ---- his own arena is untouched ----
  await s.goLevel(30); // Bowser in the Dark World's arena
  const [arena] = await find('bhvBowser');
  t.must('Bowser in his arena', !!arena);
  const a = await obj(arena.slot);
  t.eq('arena Bowser keeps his single health', a.health, 1);
  t.check('arena Bowser waits for his intro cutscene (text wait / intro walk)', a.action === 5 || a.action === 6, a);
  t.check('arena Bowser stays at the arena centre logic (home in the middle)', Math.hypot(a.x, a.z) < 2500, a);
});
