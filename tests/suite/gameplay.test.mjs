// Gameplay bugs found by playing, each played again: a trampoline catches
// a long fall without fall damage, a switched-off wall kick gives no boost and no turn, a full
// object pool no longer freezes the tab (the game drops new objects; placed ones leave room for
// the game's own), a save state taken in a cutscene does not leave Mario frozen, the player's
// L (levels) and Enter (play) keys stay out of the game.
// @tags gameplay
// @timeout 900
import { suite, api, URL_BASE } from '../lib/harness.mjs';

const AIR_HIT_WALL = 0x8a7;

await suite('gameplay regressions', async (t) => {
  const s = await t.open({ level: 9, viewport: { width: 1200, height: 720 } });
  await s.newLevel('flat', 'Gameplay');
  await s.play();
  const M = (fn, ...a) => s.eval(([fn, a]) => studio64.engine.M['_' + fn](...a), [fn, a]);
  const dbg = () => s.eval(() => JSON.parse(studio64.engine.M.UTF8ToString(studio64.engine.M._studio_debug_mario_json())));
  // frame-exact input: the game frozen (frame advance) and stepped n frames with keys held
  const pad = async (keys, n = 1) => {
    await M('studio_debug_speed', 1, 1);
    for (const k of keys) await s.page.keyboard.down(k);
    const f0 = await M('studio_debug_frames');
    await M('studio_debug_step', n);
    await s.page.waitForFunction(([a, b]) => studio64.engine.M._studio_debug_frames() >= a + b, [f0, n], { polling: 30, timeout: 120000 });
    for (const k of keys) await s.page.keyboard.up(k);
  };
  const run = () => M('studio_debug_speed', 0, 1);
  const block = (rec) => s.eval(async (r) => {
    const g = await import('/js/generators.js');
    const rec = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), pitch: 0, roll: 0, yaw: 0, ...r, block: g.blockDefaults(r.block), name: r.name || 'test block' };
    studio64.editor.records().push(rec);
    studio64.objects.store.commit({ type: 'add', summary: `Built ${rec.name}`, records: [rec] });
    return { uid: rec.uid, slot: studio64.engine.spawn(rec) };
  }, rec);
  const ground = await s.eval(() => studio64.engine.floor(0, 2000, 0));

  // ---- 1. a trampoline catches a long fall (no fall damage) ----
  await block({ name: 'trampoline', x: 2500, y: ground, z: 2500, block: { shape: 0, sx: 600, sy: 40, sz: 600 }, motion: { bounce: { power: 85 } } });
  await pad([], 3);
  await s.eval(([y]) => studio64.engine.teleport(2500, y, 2500, 0), [ground + 1800]);
  let hp = 8, bounced = false, top = 0;
  for (let i = 0; i < 16; i++) {
    await pad([], 8);
    const d = await dbg();
    hp = Math.min(hp, d.health);
    if (d.vy > 30 && d.y < ground + 400) bounced = true;
    top = Math.max(top, d.y);
  }
  t.check('a trampoline bounces Mario after a long fall', bounced);
  t.eq('falling 1800 units onto a trampoline does not hurt', hp, 8);

  // ---- 2. a switched-off wall kick: no boost up the wall, no turn ----
  await block({ name: 'wall', x: -2500, y: ground, z: 0, block: { shape: 0, sx: 1600, sy: 2000, sz: 200 } });
  const wallKick = async () => {
    await s.eval(([y]) => studio64.engine.teleport(-2500, y + 10, -900, 0), [ground]);
    await pad([], 20);
    await M('studio_walk', 0, 200);
    let d = await dbg(), jumped = false;
    for (let i = 0; i < 90 && d.action !== AIR_HIT_WALL; i++) {
      if (!jumped && d.z > -420) { await pad(['Space'], 2); jumped = true; } else await pad([], 1);
      d = await dbg();
    }
    const at = d;
    if (at.action !== AIR_HIT_WALL) return { hit: false, at };
    await pad(['Space'], 1);
    const after = await dbg();
    await M('studio_walk', 0, 0);
    const turn = (((after.yaw - at.yaw) % 65536) + 65536) % 65536;
    return { hit: true, at, after, turned: Math.abs(turn - 32768) < 4000 };
  };
  const on = await wallKick();
  t.check('Mario hits the wall in the air', on.hit, on.at);
  if (on.hit) t.check('wall kick on: A at the wall kicks off (up, turned)', on.after.vy > 40 && on.turned, on);
  await s.eval(() => studio64.objects.rules.set({ moves: { wallKick: false } }, 'no wall kicks', 'game'));
  await pad([], 2);
  const off = await wallKick();
  t.check('Mario hits the wall in the air (wall kick off)', off.hit, off.at);
  if (off.hit) t.check('wall kick off: no boost up the wall and no turn', off.after.vy < 45 && !off.turned && off.after.vy <= off.at.vy, off);
  await s.eval(() => studio64.objects.rules.set({ moves: { wallKick: true } }, 'wall kicks', 'game'));
  await run();

  // ---- 2b. "When a star is collected": its dialog shows after the level exit, and its cutscene
  // does not stop the star dance (Mario used to stay in the level, the dialog was dropped) ----
  for (const kind of ['dialog', 'cutscene']) {
    const lvl = await s.newLevel('flat', `Star event ${kind}`);
    await s.play();
    const key = await s.eval(() => studio64.engine.areaKey());
    await s.eval((kind) => {
      const ui = studio64.storyUI, logic = studio64.logicUI;
      logic.commitRecord({ uid: 0x515100 + (kind === 'dialog' ? 1 : 2), entry: 'star', x: 0, y: 150, z: 900, yaw: 0, pitch: 0, roll: 0, bparams: 0, star: { name: 'Event star' } }, 'Added a star');
      const d = ui.newDialog({ name: `Well done ${kind}`, text: 'Well done, Mario! You found the star.' });
      const actions = kind === 'dialog' ? [{ type: 'dialog', dialog: d.id }]
        : [{ type: 'cutscene', cutscene: ui.newCutscene({ name: 'Star cam', steps: [{ type: 'shot', pos: [900, 600, 700], focus: [0, 250, 1500], seconds: 1 }, { type: 'dialog', dialog: d.id }] }).id }];
      ui.newEvent({ name: `Star ${kind}`, repeat: 'once', trigger: { type: 'star', uid: 'any' }, actions });
      studio64.storyUI.flush();
      // which dialogs open, frame by frame
      window.__dlgSeen = new Set();
      if (!window.__dlgHook) { window.__dlgHook = true; studio64.engine.on('frame', () => { const id = ((studio64.engine.M._studio_story_debug() >> 8) & 0xffff) - 1; if (id >= 0) window.__dlgSeen.add(id); }); }
    }, kind);
    await s.wait(800);
    await s.eval(() => studio64.engine.teleport(0, 150, 900, 0));
    // the dance, the course complete screen (A), the arrival, the event's dialog (A closes it)
    let shown = false;
    for (let i = 0; i < 90 && !shown; i++) {
      await s.wait(1000);
      shown = await s.eval(() => [...window.__dlgSeen].some((id) => id >= 256));
      if (i > 6) { await s.page.keyboard.down('Space'); await s.wait(150); await s.page.keyboard.up('Space'); }
    }
    t.check(`star event (${kind}): its dialog shows`, shown);
    await s.until(() => !studio64.storyRuntime.running && !studio64.storyRuntime.cut, null, 60000);
    for (let i = 0; i < 4; i++) { await s.page.keyboard.down('Space'); await s.wait(150); await s.page.keyboard.up('Space'); await s.wait(500); }
    t.check(`star event (${kind}): the star still exits the level`, await s.eval((k) => studio64.engine.areaKey() !== k, key), await s.eval(() => studio64.engine.areaKey()));
  }
  await s.goCustom(await s.eval(() => studio64.levels[0].id));
  await s.play();

  // ---- 2c. Start skips a cutscene that moves an object for 20 s (the move ran on, Mario frozen) ----
  await block({ name: 'mover', x: 0, y: ground, z: -1500, block: { shape: 0, sx: 300, sy: 300, sz: 300 } }).then((b) => s.eval((u) => { window.__mover = u; }, b.uid));
  await s.eval(() => {
    const cs = studio64.storyUI.newCutscene({ name: 'Slow move', steps: [{ type: 'move', uid: window.__mover, x: 0, y: 600, z: -1500, seconds: 20 }] });
    studio64.storyUI.flush();
    window.__f0 = null;
    studio64.storyRuntime.playCutscene(studio64.story.cutscenes.find((c) => c.id === cs.id));
  });
  t.must('the moving cutscene plays', await s.until(() => !!studio64.storyRuntime.cut && studio64.engine.M._studio_story_locked(), null, 60000));
  await pad([], 10);
  await s.page.keyboard.down('Enter');
  const fSkip = await M('studio_debug_frames');
  await M('studio_debug_step', 40);
  await s.page.waitForFunction((a) => studio64.engine.M._studio_debug_frames() >= a + 40, fSkip, { polling: 30, timeout: 120000 });
  await s.page.keyboard.up('Enter');
  const after = await s.eval(() => ({ cut: !!studio64.storyRuntime.cut, y: studio64.engine.objects().find((o) => o.uid === window.__mover)?.y }));
  t.check('Start ends a cutscene in the middle of a long move at once', !after.cut, after);
  t.near('the skipped move puts the object at its end', after.y ?? 0, 600, 5);
  await run();

  // ---- 2d. two instant warp zones linked to each other (a portal pair): one jump, not a
  // jump back and forth every frame ----
  {
    const key = await s.eval(() => studio64.engine.areaKey());
    const cid = key.slice(2);
    const zones = await s.eval(([cid, g]) => {
      const f = studio64.worldFlow;
      const a = f.makeWarpRecord('zone', { x: -1500, y: Math.round(g), z: 1500, size: [400, 400, 400], transition: 'instant' });
      f.addRecord(a);
      const b = f.makeWarpRecord('zone', { x: 1500, y: Math.round(g), z: 1500, size: [400, 400, 400], transition: 'instant' });
      f.addRecord(b);
      f.link(f.key(), a.uid, { custom: cid, area: 1, uid: b.uid });
      f.link(f.key(), b.uid, { custom: cid, area: 1, uid: a.uid });
      return { a: a.uid, b: b.uid };
    }, [cid, ground]);
    t.check('two warp zones placed', !!zones.a && !!zones.b);
    await pad([], 60); // the zones reach the engine
    await s.eval(([y]) => studio64.engine.teleport(-1500, y + 10, 1000, 0), [ground]);
    await pad([], 10);
    await M('studio_walk', 0, 60);
    const xs = [];
    for (let i = 0; i < 60; i++) { await pad([], 1); xs.push(Math.round((await s.mario()).x)); }
    const jumps = xs.slice(1).filter((x, i) => Math.abs(x - xs[i]) > 1500).length;
    t.eq('a portal pair warps Mario once (not back and forth)', jumps, 1);
    t.check('he comes out at the other zone', Math.abs(xs[xs.length - 1] - 1500) < 500, xs.slice(-5));
    await run();
  }

  // ---- 2d'. a warp zone with the "circle" transition leads to its own target (it took the
  // area's warp-floor node: the castle, or wherever falling leads) ----
  {
    const cid = (await s.eval(() => studio64.engine.areaKey())).slice(2);
    const z = await s.eval(([cid, g]) => {
      const f = studio64.worldFlow;
      const arr = f.makeWarpRecord('arrival', { x: 2500, y: Math.round(g), z: -2500 });
      f.addRecord(arr);
      const zone = f.makeWarpRecord('zone', { x: -2500, y: Math.round(g), z: -2500, size: [400, 400, 400], transition: 'circle' });
      f.addRecord(zone);
      f.link(f.key(), zone.uid, { custom: cid, area: 1, uid: arr.uid });
      return { key: f.key() };
    }, [cid, ground]);
    await pad([], 60);
    await s.eval(([y]) => studio64.engine.teleport(-2500, y + 10, -2500, 0), [ground]);
    await run();
    const there = await s.until(() => { const e = studio64.engine; try { const m = e.state().mario; return !e.inIntro && m && Math.hypot(m.x - 2500, m.z + 2500) < 600; } catch { return false; } }, null, 60000);
    t.check('a "circle" warp zone brings Mario to its arrival point', there && (await s.eval(() => studio64.engine.areaKey())) === z.key, { key: await s.eval(() => studio64.engine.areaKey()), m: await s.mario() });
  }

  // ---- 2e. pause → R (the options menu) → its last line → A: the game goes on (the menu had
  // "Exit game", which stopped the game's main loop in the browser: a frozen picture for good) ----
  {
    await s.eval(([y]) => studio64.engine.teleport(0, y + 10, 0, 0), [ground]);
    await pad([], 40);
    await pad(['Enter'], 2); await pad([], 15);
    t.check('paused', ((await M('studio_story_debug')) & 4) !== 0);
    await pad(['KeyR'], 2); await pad([], 10);
    await pad(['KeyW'], 2); await pad([], 8); // up from the first line wraps to the last
    await pad(['Space'], 2);
    const alive = await Promise.race([pad([], 20).then(() => true), new Promise((r) => setTimeout(() => r(false), 30000))]);
    t.check('the options menu has nothing that stops the game', alive);
    // back out: B (J) leaves the menus, Start resumes
    for (let i = 0; i < 2; i++) { await pad(['KeyJ'], 2); await pad([], 8); }
    await pad(['Enter'], 2); await pad([], 30);
    if (((await M('studio_story_debug')) & 4) !== 0) { await pad(['Enter'], 2); await pad([], 30); }
    await run();
  }

  // ---- 3. a full object pool: placed objects leave room, the game goes on ----
  const placed = await s.eval(() => {
    const e = studio64.engine, m = e.state().mario;
    let n = 0;
    for (let i = 0; i < 1200; i++) {
      const slot = e.spawn({ uid: 0x7c000000 + i, entry: 'yellow_coin', x: m.x + 3000 + (i % 30) * 120, y: m.y + 100, z: m.z - 2000 + Math.floor(i / 30) * 120, yaw: 0, pitch: 0, roll: 0, bparams: 0, scale: 1 });
      if (slot < 0) break;
      n++;
    }
    return n;
  });
  const pools = await s.eval(() => JSON.parse(studio64.engine.M.UTF8ToString(studio64.engine.M._studio_debug_pools_json())));
  t.check('placing stops short of a full pool (room for the game\'s own objects)', pools.objects <= pools.object_pool - 24, { placed, pools });
  // the game fills the rest itself (particles, coins): spawn more than fits with the game's own code
  const alive = await Promise.race([
    (async () => {
      await s.eval(() => { const m = studio64.engine.state().mario; for (let i = 0; i < 60; i++) studio64.engine.M._studio_story_puff(m.x, m.y, m.z); });
      await M('studio_walk', 0, 40); await pad(['Space'], 3); await pad(['j'], 3); await pad([], 40);
      await run();
      return s.framesAdvance();
    })(),
    new Promise((r) => setTimeout(() => r(false), 240000)),
  ]);
  t.check('with the pool full the game keeps running (no frozen tab)', alive);
  t.allowConsole(/object pool is full/);
  await s.page.close();

  // ---- 4. a save state taken in a cutscene, loaded after it: Mario can move ----
  const { id } = await api('/api/hub/create', { sample: 'showcase.s64hack' });
  const p = await t.open({ project: id, viewport: { width: 1200, height: 720 }, label: 'showcase' });
  const P = (fn, arg) => p.eval(fn, arg);
  await p.until(() => studio64.engine.level === 37 && !studio64.engine.inIntro && !!studio64.engine.state().mario, null, 120000);
  await P(() => studio64.storyRuntime.playFromStart());
  t.must('the opening cutscene plays', await p.until(() => !!studio64.storyRuntime.cut && studio64.engine.M._studio_story_locked(), null, 90000));
  await P(() => studio64.testing.saveState(0));
  await p.until(() => !!studio64.testing.slots[0], null, 20000);
  for (let i = 0; i < 20 && await P(() => !!studio64.storyRuntime.cut); i++) { await p.page.keyboard.down('Enter'); await p.wait(250); await p.page.keyboard.up('Enter'); await p.wait(400); }
  t.check('Start skips the cutscene', await P(() => !studio64.storyRuntime.cut));
  await P(() => studio64.testing.loadState(0));
  await p.wait(500);
  const st = await P(() => ({ cut: !!studio64.storyRuntime.cut, locked: studio64.engine.M._studio_story_locked() }));
  t.check('after loading, the game is not left in a cutscene lock without a cutscene', !st.locked || st.cut, st);
  await P(() => studio64.engine.M._studio_story_close_dialog());
  await P(() => { const m = studio64.engine.state().mario; studio64.engine.teleport(m.x, m.y + 5, m.z, m.yaw); });
  const a = await p.mario();
  await P(() => studio64.engine.M._studio_walk(0, 45));
  await p.until((a0) => { const m = studio64.engine.state().mario; return Math.hypot(m.x - a0.x, m.z - a0.z) > 100; }, a, 60000);
  const b = await p.mario();
  t.check('Mario walks after loading a state saved in a cutscene', Math.hypot(b.x - a.x, b.z - a.z) > 100, { a, b });

  // ---- 5. the player: L opens and closes the level list without crouching Mario ----
  const page = await (await t.launch()).newPage({ viewport: { width: 1100, height: 700 } });
  await page.goto(`${URL_BASE}/play.html?p=${id}`);
  await page.waitForSelector('#play-btn:not([disabled])', { timeout: 240000 });
  await page.focus('body');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.studioPlayer?.playing, null, { timeout: 30000 });
  const startHeld = await page.evaluate(() => (studioPlayer.engine.M._studio_story_buttons() & 0x1000) !== 0);
  t.check('Enter on the title card starts without pressing Start in the game', !startHeld);
  await page.keyboard.press('Enter'); // a fresh Enter does reach the game (skips the opening)
  await page.waitForTimeout(1500);
  await page.keyboard.down('KeyL');
  await page.waitForTimeout(400);
  const open = await page.evaluate(() => ({ menu: studioPlayer.menu, z: (studioPlayer.engine.M._studio_story_buttons() & 0x2000) !== 0 }));
  await page.keyboard.up('KeyL');
  await page.keyboard.down('KeyL');
  await page.waitForTimeout(400);
  const closed = await page.evaluate(() => ({ menu: studioPlayer.menu, z: (studioPlayer.engine.M._studio_story_buttons() & 0x2000) !== 0 }));
  await page.keyboard.up('KeyL');
  t.check('L opens the level list (no Z in the game)', open.menu && !open.z, open);
  t.check('L closes it again without pressing Z (crouch / ground pound) in the game', !closed.menu && !closed.z, closed);
  await page.close();
  await p.page.close();

  // ---- 6. ground raised over BoB's start: after a reload Mario stands on it and lives ----
  // (he spawned inside the hill, fell out of the level and the death warp came after the lift)
  const bob = await t.open({ level: 9, viewport: { width: 1100, height: 700 }, label: 'bob' });
  await bob.arrive(9, 90000);
  // placing on the grid near BoB's edge (a slope at x -8190): the snap must not put the object
  // past the edge (x -8200 has no ground: it fell out of the level) nor above / inside a slope
  const snapped = await bob.eval(() => {
    const e = studio64.engine, ed = studio64.editor;
    const at = (x, z) => { const h = e.raycast([x, 4000, z], [0, -1, 0], -1, false, 9000); return h; };
    const edge = at(-8190, 7050), slope = at(-8130, 7020);
    const pe = ed.placementPose(edge, { entry: 'goomba' }, 0).p, ps = ed.placementPose(slope, { entry: 'goomba' }, 0).p;
    return { edge: pe, edgeFloor: e.floor(pe[0], pe[1] + 100, pe[2]), slope: ps, slopeFloor: e.floor(ps[0], ps[1] + 100, ps[2]) };
  });
  t.check('a grid-snapped object at the level edge stays on the ground', snapped.edgeFloor > -10000 && Math.abs(snapped.edgeFloor - snapped.edge[1]) < 3, snapped);
  t.check('a grid-snapped object on a slope stands on it', Math.abs(snapped.slopeFloor - snapped.slope[1]) < 3, snapped);
  await bob.eval(() => {
    const w = studio64.world, m = studio64.engine.state().mario;
    const st = w.beginStroke('raise', { x: m.x, y: m.y, z: m.z }, { radius: 450, strength: 4 });
    for (let i = 0; i < 90; i++) w.dab(st, m.x + (i % 3) * 10, m.z);
    w.endStroke(st);
  });
  const raised = await bob.eval(() => { const m = studio64.engine.state().mario; return studio64.engine.floor(m.x, m.y + 3000, m.z); });
  t.check('the ground over the start is raised', raised > 150, raised);
  await bob.wait(1500);
  await bob.reload();
  await bob.arrive(9, 90000);
  await bob.eval(() => { window.__bfc = 0; studio64.engine.on('frame', () => { window.__bfc++; }); });
  await bob.page.waitForFunction(() => window.__bfc > 150, null, { timeout: 180000, polling: 100 });
  const mb = await bob.mario();
  t.check('after the reload Mario is still in BoB (no death from inside the hill)', (await bob.eval(() => studio64.engine.level)) === 9 && mb.y > -500, mb);
});
