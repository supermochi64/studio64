// The new moves (engine/src/studio/moves.c, Game rules -> Moves -> New moves): each one is off in
// the classic game (the same input does what it always did), and switched on it happens: wall
// slide, spin jump (stick spin and L + A, spin pound), spinning triple jump, instant ground pound,
// ground pound jump and dive, ground pound out of a long jump, underwater ground pound, dive hop,
// ledge vault; and "Walking" switched off makes a light stick tilt run. Played frame by frame with
// the recording bot's controller (studio/debug.c), Mario's action and speed read after each step.
// @tags gameplay rules
// @timeout 900
import { suite } from '../lib/harness.mjs';

const A = 0x8000, B = 0x4000, Z = 0x2000, L = 0x0020;
const ACT = {
  JUMP: 0x03000880, JUMP_LAND: 0x04000470, DOUBLE_JUMP: 0x03000881, DOUBLE_JUMP_LAND: 0x04000472, TRIPLE_JUMP: 0x01000882,
  LONG_JUMP: 0x03000888, GROUND_POUND: 0x008008A9, GROUND_POUND_LAND: 0x0080023C, DIVE: 0x0188088A, DIVE_SLIDE: 0x00880456,
  FORWARD_ROLLOUT: 0x010008A6, LEDGE_GRAB: 0x0800034B, AIR_HIT_WALL: 0x000008A7, SOFT_BONK: 0x010208B6,
  WALL_KICK_AIR: 0x03000886, WATER_IDLE: 0x380022C0,
  SPIN_JUMP: 0x0180089E, WALL_SLIDE: 0x0000089D, WATER_POUND: 0x308022C9, // Studio 64's own (objects.h)
};
const NEW = ['wallSlide', 'spinJump', 'tripleSpin', 'instantPound', 'poundJump', 'poundDive', 'poundCancel', 'waterPound', 'diveHop', 'ledgeVault'];
const hex = (a) => (a >>> 0).toString(16);

await suite('moveset', async (t) => {
  const s = await t.open({ level: 9, viewport: { width: 1200, height: 720 } });
  await s.newLevel('flat', 'Moveset');
  await s.play();
  const M = (fn, ...a) => s.eval(([fn, a]) => studio64.engine.M['_' + fn](...a), [fn, a]);
  const dbg = () => s.eval(() => JSON.parse(studio64.engine.M.UTF8ToString(studio64.engine.M._studio_debug_mario_json())));
  const rules = () => s.eval(() => studio64.engine.json('studio_rules_json'));
  const step = async (n = 1) => {
    const f0 = await M('studio_debug_frames');
    await M('studio_debug_step', n);
    await s.page.waitForFunction(([a, b]) => studio64.engine.M._studio_debug_frames() >= a + b, [f0, n], { polling: 20, timeout: 120000 });
  };
  // the controller for the next frames: buttons held, the stick as a world yaw and a tilt (0..64)
  const bot = (buttons = 0, yaw = 0, mag = 0) => M('studio_bot', 1, buttons, yaw & 0xffff, mag);
  const press = async (buttons, yaw = 0, mag = 0, n = 1) => { await bot(buttons, yaw, mag); await step(n); };
  const until = async (pred, max, buttons = 0, yaw = 0, mag = 0) => {
    await bot(buttons, yaw, mag);
    let d = await dbg();
    for (let i = 0; i < max && !pred(d); i++) { await step(1); d = await dbg(); }
    return d;
  };
  const moves = (m) => s.eval((m) => studio64.objects.rules.set({ moves: m }, 'moves', 'game'), m);
  const only = (k) => moves(Object.fromEntries(NEW.map((x) => [x, x === k])));
  const block = (rec) => s.eval(async (r) => {
    const g = await import('/js/generators.js');
    const rec = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), pitch: 0, roll: 0, yaw: 0, ...r, block: g.blockDefaults(r.block), name: r.name || 'test block' };
    studio64.editor.records().push(rec);
    studio64.objects.store.commit({ type: 'add', summary: `Built ${rec.name}`, records: [rec] });
    return { uid: rec.uid, slot: studio64.engine.spawn(rec) };
  }, rec);
  const ground = await s.eval(() => studio64.engine.floor(0, 2000, 0));
  const tp = async (x, y, z, yaw = 0, settle = 12) => { await s.eval(([x, y, z, yaw]) => studio64.engine.teleport(x, y, z, yaw), [x, y, z, yaw]); await press(0, 0, 0, settle); };

  await M('studio_debug_speed', 1, 1);
  await step(2);

  // ---- off by default: the classic game ----
  const r0 = await rules();
  t.eq('no new move is on in a new project', r0.newMoves, 0);
  t.check('the rules have every new move, off', await s.eval((keys) => keys.every((k) => studio64.objects.rules.current?.moves?.[k] === false), NEW));

  // ---- instant ground pound: Z in the air drops at once ----
  const pound = async () => {
    await tp(0, ground + 900, 0);
    await press(Z);
    let n = 0, d = await dbg();
    for (; n < 30 && !(d.action === ACT.GROUND_POUND && d.vy <= -40 && d.actionState === 1); n++) { await press(0); d = await dbg(); }
    await until((x) => !(x.action & 0x800), 90); // down
    return n;
  };
  const slowPound = await pound();
  await only('instantPound');
  const fastPound = await pound();
  t.check('classic: the ground pound flips first (10+ frames before the drop)', slowPound >= 10, { slowPound });
  t.check('instant ground pound: drops within 2 frames', fastPound <= 2, { fastPound });

  // ---- ground pound jump: A right on landing ----
  const poundJump = async () => {
    await tp(0, ground + 500, 0);
    await press(Z);
    const d = await until((x) => x.action === ACT.GROUND_POUND_LAND, 80);
    if (d.action !== ACT.GROUND_POUND_LAND) return { landed: false, d };
    await press(A, 0, 0, 3);
    const j = await dbg();
    await press(0, 0, 0, 1);
    await until((x) => !(x.action & 0x800), 120);
    return { landed: true, j };
  };
  await only(null);
  const pj0 = await poundJump();
  await only('poundJump');
  const pj1 = await poundJump();
  t.check('classic: A on a ground pound landing does not jump', pj0.landed && pj0.j.vy < 5, pj0);
  t.check('ground pound jump: high and straight up', pj1.landed && pj1.j.action === ACT.DOUBLE_JUMP && pj1.j.vy > 50 && Math.abs(pj1.j.fvel) < 1, pj1);

  // ---- ground pound dive: B during the ground pound ----
  const poundDive = async () => {
    await tp(0, ground + 900, 0);
    await press(Z, 0, 0, 3);
    await press(B, 0, 64);
    const d = await dbg();
    await press(0, 0, 0, 1);
    await until((x) => !(x.action & 0x800), 120);
    return d;
  };
  await only(null);
  const pd0 = await poundDive();
  await only('poundDive');
  const pd1 = await poundDive();
  t.check('classic: B in a ground pound does nothing', pd0.action === ACT.GROUND_POUND, { action: hex(pd0.action) });
  t.check('ground pound dive: a dive forward with some height', pd1.action === ACT.DIVE && pd1.fvel > 20 && pd1.vy > 15, { action: hex(pd1.action), fvel: pd1.fvel, vy: pd1.vy });

  // ---- ground pound out of a long jump ----
  const longJumpPound = async () => {
    await tp(0, ground + 10, -2000, 0);
    await press(0, 0, 64, 25);                 // run
    await press(Z, 0, 64, 1);                  // crouch slide
    await press(Z | A, 0, 64, 1);              // long jump
    await press(0, 0, 64, 6);
    const lj = await dbg();
    await press(Z, 0, 64, 1);
    await press(0, 0, 0, 1);
    const d = await dbg();
    await until((x) => !(x.action & 0x800), 120);
    return { lj: lj.action, d };
  };
  await only(null);
  const lj0 = await longJumpPound();
  await only('poundCancel');
  const lj1 = await longJumpPound();
  t.check('classic: Z in a long jump does nothing', lj0.lj === ACT.LONG_JUMP && lj0.d.action === ACT.LONG_JUMP, { lj: hex(lj0.lj), after: hex(lj0.d.action) });
  t.check('ground pound anytime: Z in a long jump pounds', lj1.lj === ACT.LONG_JUMP && lj1.d.action === ACT.GROUND_POUND, { lj: hex(lj1.lj), after: hex(lj1.d.action) });

  // ---- spin jump: spin the stick and press A; L + A; Z in it: spin pound ----
  const spinJump = async (useL) => {
    await tp(0, ground + 10, 0);
    let yaw = 0;
    if (!useL) for (let i = 0; i < 9; i++) { yaw += 0x1800; await press(0, yaw, 64, 1); }
    await press(A | (useL ? L : 0), yaw, useL ? 0 : 64, 1);
    await press(A, yaw, 0, 2);
    const d = await dbg();
    let peak = d.y, fall = 0;
    for (let i = 0; i < 18; i++) { await press(0); const x = await dbg(); peak = Math.max(peak, x.y); if (x.action === ACT.SPIN_JUMP && x.vy < fall) fall = x.vy; }
    await press(Z);
    const p = await dbg();
    await until((x) => !(x.action & 0x800), 150);
    return { action: d.action, vy: d.vy, peak: peak - ground, fall, pound: p };
  };
  await only(null);
  const sp0 = await spinJump(false);
  await only('spinJump');
  const sp1 = await spinJump(false);
  const sp2 = await spinJump(true);
  t.check('classic: spinning the stick and jumping is a normal jump', sp0.action !== ACT.SPIN_JUMP, { action: hex(sp0.action) });
  t.check('spin jump: stick spin + A twirls up', sp1.action === ACT.SPIN_JUMP && sp1.vy > 45, { action: hex(sp1.action), vy: sp1.vy });
  t.check('spin jump: it falls slowly', sp1.fall < 0 && sp1.fall >= -37, { fall: sp1.fall });
  t.check('spin jump: L + A twirls too', sp2.action === ACT.SPIN_JUMP, { action: hex(sp2.action) });
  t.check('spin pound: Z in a spin jump drops at once', sp1.pound.action === ACT.GROUND_POUND && sp1.pound.vy <= -40, { action: hex(sp1.pound.action), vy: sp1.pound.vy });

  // ---- spinning triple jump: the third jump in a row ----
  const triple = async () => {
    await tp(0, ground + 10, -2500, 0);
    await press(0, 0, 64, 20);
    const seen = new Set();
    await press(A, 0, 64, 1);
    for (let i = 0; i < 160; i++) {
      const d = await dbg();
      seen.add(d.action);
      if (d.action === ACT.TRIPLE_JUMP || d.action === ACT.SPIN_JUMP) break;
      const landing = d.action === ACT.JUMP_LAND || d.action === ACT.DOUBLE_JUMP_LAND;
      await press(landing ? A : 0, 0, 64, 1);
    }
    await until((x) => !(x.action & 0x800), 150);
    return seen;
  };
  await only(null);
  const tr0 = await triple();
  await only('tripleSpin');
  const tr1 = await triple();
  t.check('classic: three jumps in a row end in a triple jump', tr0.has(ACT.TRIPLE_JUMP), [...tr0].map(hex));
  t.check('spinning triple jump: the third jump spins', tr1.has(ACT.SPIN_JUMP) && !tr1.has(ACT.TRIPLE_JUMP) && tr1.has(ACT.DOUBLE_JUMP), [...tr1].map(hex));

  // ---- wall slide: a jump against a wall slides down it, A kicks off ----
  await block({ name: 'wall', x: -2500, y: ground, z: 0, block: { shape: 0, sx: 1600, sy: 2500, sz: 200 } });
  await step(2);
  const wall = async () => {
    await tp(-2500, ground + 10, -900, 0, 20);
    let d = await dbg(), jumped = false;
    for (let i = 0; i < 90 && d.action !== ACT.AIR_HIT_WALL && d.action !== ACT.WALL_SLIDE && d.action !== ACT.SOFT_BONK; i++) {
      if (!jumped && d.z > -520) { await press(A, 0, 64, 2); jumped = true; } else await press(jumped ? A : 0, 0, 64, 1);
      d = await dbg();
    }
    const acts = new Set([d.action]);
    let minVy = 0;
    for (let i = 0; i < 6; i++) { await press(0); const x = await dbg(); acts.add(x.action); minVy = Math.min(minVy, x.vy); }
    const sliding = await dbg();
    await press(A);
    const kick = await dbg();
    await press(0, 0, 0, 1);
    await until((x) => !(x.action & 0x800), 150);
    return { acts: [...acts], minVy, sliding, kick };
  };
  await only(null);
  const w0 = await wall();
  await only('wallSlide');
  const w1 = await wall();
  t.check('classic: a jump against a wall bonks off it', w0.acts.includes(ACT.SOFT_BONK) && !w0.acts.includes(ACT.WALL_SLIDE), w0.acts.map(hex));
  t.check('wall slide: he slides down the wall, slower than a fall', w1.sliding.action === ACT.WALL_SLIDE && w1.minVy >= -20 && w1.sliding.vy < 0, { acts: w1.acts.map(hex), minVy: w1.minVy, vy: w1.sliding.vy });
  t.check('wall slide: A kicks off the wall', w1.kick.action === ACT.WALL_KICK_AIR && w1.kick.vy > 40, { action: hex(w1.kick.action), vy: w1.kick.vy });

  // ---- ledge vault: B right after grabbing a ledge at speed ----
  await block({ name: 'ledge', x: 2500, y: ground, z: 0, block: { shape: 0, sx: 1600, sy: 290, sz: 600 } });
  await step(2);
  const ledge = async (vault) => {
    const tries = [];
    // the jump distance that ends in a ledge grab
    for (let jumpZ = -1150; jumpZ <= -450; jumpZ += 25) {
      await tp(2500, ground + 10, -2600, 0, 15);
      let d = await dbg(), jumped = false;
      for (let i = 0; i < 200 && d.action !== ACT.LEDGE_GRAB && (!jumped || (d.action & 0x800)); i++) {
        if (!jumped && d.z > jumpZ) { await press(A, 0, 64, 2); jumped = true; } else await press(jumped ? A : 0, 0, 64, 1);
        d = await dbg();
      }
      tries.push({ jumpZ, a: hex(d.action), y: Math.round(d.y - ground), z: Math.round(d.z), fv: Math.round(d.fvel) });
      if (d.action !== ACT.LEDGE_GRAB) continue;
      await press(vault ? B : 0, 0, 0, 1);
      const after = await dbg();
      await press(0, 0, 0, 30);
      const end = await dbg();
      return { grabbed: true, after, end };
    }
    return { grabbed: false, tries };
  };
  await only(null);
  const lg0 = await ledge(true);
  await only('ledgeVault');
  const lg1 = await ledge(true);
  t.check('classic: B on a ledge does not vault', lg0.grabbed && lg0.after.action !== ACT.FORWARD_ROLLOUT, lg0.grabbed ? { action: hex(lg0.after.action) } : lg0);
  t.check('ledge vault: a flip over the ledge, keeping speed', lg1.grabbed && lg1.after.action === ACT.FORWARD_ROLLOUT && lg1.after.fvel > 20 && lg1.end.y > ground + 250,
    lg1.grabbed ? { action: hex(lg1.after.action), fvel: lg1.after.fvel, endY: lg1.end.y - ground } : lg1);

  // ---- dive hop: B in the belly slide after a dive ----
  const diveHop = async () => {
    await tp(0, ground + 10, -2500, 0);
    await press(0, 0, 64, 60);
    await press(B, 0, 64, 1);
    const d = await until((x) => x.action === ACT.DIVE_SLIDE, 60, 0, 0, 64);
    await press(B, 0, 64, 1);
    const h = await dbg();
    await press(0, 0, 0, 1);
    await until((x) => !(x.action & 0x800) && x.action !== ACT.DIVE_SLIDE, 150);
    await press(0, 0, 0, 30);
    return { slid: d.action === ACT.DIVE_SLIDE, h };
  };
  await only(null);
  const dh0 = await diveHop();
  await only('diveHop');
  const dh1 = await diveHop();
  t.check('classic: B in a dive slide rolls out', dh0.slid && dh0.h.action === ACT.FORWARD_ROLLOUT, { slid: dh0.slid, action: hex(dh0.h.action) });
  t.check('dive hop: B in a dive slide dives again', dh1.slid && dh1.h.action === ACT.DIVE && dh1.h.vy > 10, { slid: dh1.slid, action: hex(dh1.h.action), vy: dh1.h.vy });

  // ---- walking off: a light tilt runs ----
  const tilt = async () => { await tp(0, ground + 10, -2500, 0); await press(0, 0, 18, 40); return (await dbg()).fvel; };
  await only(null);
  const slow = await tilt();
  await s.eval(() => studio64.objects.rules.set({ moves: { walk: false } }, 'no walking', 'game'));
  const fast = await tilt();
  await s.eval(() => studio64.objects.rules.set({ moves: { walk: true } }, 'walking', 'game'));
  t.check('a light stick tilt walks slowly', slow < 12, { slow });
  t.check('walking off: the same tilt runs', fast > 25, { fast });

  // ---- the underwater ground pound ----
  await s.eval(([y]) => studio64.engine.setWater(true, y), [ground + 1400]);
  await step(4);
  const waterPound = async () => {
    await tp(0, ground + 700, 1500, 0, 60);
    const before = await dbg();
    await press(Z, 0, 0, 2);
    const p = await dbg();
    const floor = await until((x) => x.action !== ACT.WATER_POUND || x.actionState >= 2, 80);
    await press(A, 0, 0, 3);
    const j = await dbg();
    await press(0, 0, 0, 60);
    return { before, p, floor, j };
  };
  await only(null);
  const wp0 = await waterPound();
  await only('waterPound');
  const wp1 = await waterPound();
  t.check('Mario swims in the water', (wp0.before.action & 0x1c0) === 0xc0, { action: hex(wp0.before.action) });
  t.check('classic: Z under water does not pound', wp0.p.action !== ACT.WATER_POUND, { action: hex(wp0.p.action) });
  t.check('underwater ground pound: Z pounds to the floor', wp1.p.action === ACT.WATER_POUND && wp1.floor.action === ACT.WATER_POUND && wp1.floor.actionState === 2 && wp1.floor.y < ground + 20,
    { action: hex(wp1.p.action), floor: { a: hex(wp1.floor.action), st: wp1.floor.actionState, y: wp1.floor.y - ground } });
  t.check('underwater ground pound: A jumps up from the floor', wp1.j.action === ACT.WATER_POUND && wp1.j.actionState === 3 && wp1.j.vy > 25, { action: hex(wp1.j.action), st: wp1.j.actionState, vy: wp1.j.vy });
  await s.eval(() => studio64.engine.setWater(false, 0));

  // ---- the panel: a second group, the Modern preset turns them all on, per level ----
  await bot(0); await M('studio_bot', 0, 0, 0, 0);
  await M('studio_debug_speed', 0, 1);
  await moves(Object.fromEntries(NEW.map((k) => [k, false])));
  await s.page.click('#game-btn');
  await s.page.waitForSelector('.om-dialog.gr');
  await s.page.click('.gr-tab[data-s=moves]');
  const groups = await s.page.locator('.gr-group').allTextContents();
  t.check('the Moves section has a second group for the new moves', groups.length === 2 && /new moves/i.test(groups[1]), groups);
  const newButtons = await s.page.locator('.gr-new-moves .gr-toggle').count();
  t.eq('every new move has a switch', newButtons, NEW.length);
  t.check('each new move says how to do it', (await s.page.locator('.gr-new-moves .gr-toggle small').allTextContents()).every((x) => x.length > 15));
  await s.page.click('.gr-new-moves .gr-toggle[data-move=wallSlide]');
  await s.wait(200);
  t.eq('a click switches a new move on', (await rules()).newMoves & 1, 1);
  await s.shot('moves_panel');
  await s.page.click('.gr-tab[data-s=presets]');
  await s.page.locator('.gr-preset', { hasText: 'Modern moveset' }).click();
  await s.wait(300);
  t.eq('the Modern moveset preset switches on every new move', (await rules()).newMoves, 1023);
  await s.page.click('.om-dialog.gr [data-a=close]');
  await s.eval(() => studio64.objects.rules.set({ moves: { spinJump: false } }, 'no spin jump here', 'level'));
  await s.wait(200);
  t.eq('a level can switch a new move off again', (await rules()).newMoves, 1023 & ~2);
  await s.eval(() => studio64.objects.rules.resetLevel());
  await s.wait(200);
  t.eq('...and the game rules come back', (await rules()).newMoves, 1023);
});
