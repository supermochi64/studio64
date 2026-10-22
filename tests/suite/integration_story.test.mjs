// Features working together, played: a story locks a door to a sub-area and a zone opens it
// again (worldFlow locks), Mario walks through it ("enters an area" trigger on c:<id>:2),
// a custom object in the sub-area spots Mario (start_motion moves a platform there) and hurts
// him (warp action back out of the main area's door), and the story progress lives in the
// project's save: per-project game save, mirrored to the server (survives clearing the
// browser's storage), reset by the F3 panel's "Reset save file" and by "Play from start".
// @tags story world objects
// @timeout 900
import { suite } from '../lib/harness.mjs';

await suite('integration story', async (t) => {
  let s = await t.open({ level: 9 });
  const levelId = await s.newLevel('flat', 'Integration');
  await s.play();
  await s.eval(() => { window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; }); });
  const frames = async (n) => {
    const f0 = await s.eval(() => window.__fc);
    await s.page.waitForFunction(([a, b]) => window.__fc >= a + b, [f0, n], { timeout: 240000, polling: 50 });
  };
  const key = () => s.eval(() => studio64.engine.areaKey());
  const waitKey = async (want, ms = 60000) => {
    const ok = await s.until((k) => { const e = studio64.engine; try { return e.areaKey() === k && !e.inIntro && !!e.state().mario; } catch { return false; } }, want, ms);
    if (ok) await frames(10);
    return ok;
  };
  const flag = (id) => s.eval((v) => studio64.storyRuntime.getVar(v), id);

  // ---- a sub-area with a door pair (World tab → New area, with a door) ----
  await s.eval(() => studio64.engine.teleport(0, 40, -600, 0));
  await frames(5);
  const made = await s.eval((id) => studio64.worldUI.createArea(id, 'Cellar', 'room', true).then((m) => ({ index: m.index })), levelId);
  t.eq('the cellar is area 2', made.index, 2);
  await frames(10);
  const doors = await s.eval((id) => {
    const p = studio64.engine.patch.areas;
    const din = (p[`c:${id}`].objects || []).find((r) => r.warp?.kind === 'door' && r.warp.to?.area === 2);
    const dout = (p[`c:${id}:2`].objects || []).find((r) => r.warp?.kind === 'door');
    return { din, dout };
  }, levelId);
  t.must('a door into the cellar and one back', !!doors.din && !!doors.dout);

  // ---- the story: lock, zone opens, enter area, custom object events ----
  const ids = await s.eval(({ levelId, din, dout }) => {
    const ui = studio64.storyUI, logic = studio64.logicUI;
    // a zone 500 units beside the door (main area)
    const zone = { uid: 0x5a0001, block: { shape: 0, sx: 300, sy: 300, sz: 300, steps: 8, top: 28, side: 28, surface: 0, flags: 6, color: 0x50b4ff }, x: din.x - 700, y: din.y, z: din.z, yaw: 0, pitch: 0, roll: 0, name: 'Key spot', zone: { name: 'Key spot' } };
    logic.commitRecord(zone, 'Added a zone');
    const seen = ui.newVar('flag', 'cellar seen');
    const hurt = ui.newVar('counter', 'hurt by guard');
    ui.newEvent({ name: 'Lock the cellar', repeat: 'once', level: `c:${levelId}:1`, trigger: { type: 'timer', seconds: 1 }, actions: [{ type: 'lock_door', uid: din.uid }] });
    ui.newEvent({ name: 'Open the cellar', repeat: 'once', trigger: { type: 'enter_zone', zone: zone.uid }, actions: [{ type: 'open_door', uid: din.uid }] });
    ui.newEvent({ name: 'In the cellar', repeat: 'once', trigger: { type: 'level_enter', level: `c:${levelId}:2` }, actions: [{ type: 'set_flag', var: seen.id, value: 'true' }] });
    studio64.storyUI.flush();
    return { zone: zone.uid, seen: seen.id, hurt: hurt.id };
  }, { levelId, din: doors.din, dout: doors.dout });

  // the timer event locks the door (only in the main area: c:<id>:1)
  const locked = await s.until((u) => studio64.worldFlow.isLocked(u) === true, doors.din.uid, 60000);
  t.check('"Lock a door" locks the door (worldFlow.setLocked)', locked);
  t.check('the lock is kept in the story progress', await s.eval((u) => studio64.storyRuntime.progress.locks?.[u] === true, doors.din.uid));

  // a locked door: walking into it does not warp
  const walkInto = async (door, n = 60) => {
    const yaw = (door.yaw | 0) & 0xffff;
    const a = (yaw / 32768) * Math.PI;
    // stand in front of the door, facing it
    await s.eval(([x, y, z, yy]) => studio64.engine.teleport(x, y + 20, z, yy), [door.x + Math.sin(a) * 300, door.y, door.z + Math.cos(a) * 300, (yaw + 0x8000) & 0xffff]);
    await frames(6);
    await s.eval((yy) => studio64.engine.M._studio_walk(yy, 60), (yaw + 0x8000) & 0xffff);
    await frames(n);
  };
  await walkInto(doors.din);
  t.check('a locked door keeps Mario out', (await key()) === `c:${levelId}`, await key());

  // the zone opens it
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y + 20, z, 0), [doors.din.x - 700, doors.din.y, doors.din.z]);
  const opened = await s.until((u) => studio64.worldFlow.isLocked(u) === false, doors.din.uid, 60000);
  t.check('entering the zone opens the door ("Open a door" on a warp door unlocks it)', opened);
  t.check('the door was not deleted', await s.eval((u) => studio64.engine.objects().some((o) => o.uid === u), doors.din.uid));

  // walk through: the "enters an area" trigger of the sub-area
  await walkInto(doors.din, 30);
  let inCellar = await waitKey(`c:${levelId}:2`, 60000);
  t.check('Mario walks through the door into the cellar', inCellar, await key());
  if (!inCellar) { await s.eval((id) => studio64.worldFlow.goArea({ custom: id, area: 2 }), levelId); inCellar = await waitKey(`c:${levelId}:2`); }
  t.must('in the cellar', inCellar);
  t.check('"Mario enters an area" (c:<id>:2) fired', await s.until((v) => studio64.storyRuntime.getVar(v) === true, ids.seen, 30000));

  // ---- story <-> objects in the sub-area ----
  const objs = await s.eval(({ ids, levelId, din }) => {
    const ctx = studio64.objects;
    const def = { id: 'guardx', name: 'Cellar guard', model: 'goomba', move: 'chase', speed: 4, chaseSpeed: 10, sight: 1200, health: 3, damage: 1, defeat: 'poof', coins: 0 };
    ctx.store.setGame('objdefs', [...ctx.defs(), def], 'Made the custom object “Cellar guard”');
    const logic = studio64.logicUI;
    const guard = { uid: 0x6a0001, bhv: 'bhvStudioActor', model: 'goomba', def: def.id, actor: { ...def }, x: 0, y: 0, z: -600, yaw: 0, pitch: 0, roll: 0, bparams: 0, scale: 1, name: 'Cellar guard' };
    logic.commitRecord(guard, 'Placed the guard');
    // a platform that moves 600 up when an event starts it
    const plat = { uid: 0x6a0002, block: { shape: 0, sx: 300, sy: 60, sz: 300, steps: 0, top: 3, side: 3, surface: 0, flags: 0, color: 0xffffff }, x: 800, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, name: 'Lift',
      motion: { path: { points: [[0, 0, 0], [0, 600, 0]], speed: 20, mode: 'once', wait: 0, smooth: false, trigger: 'event', radius: 800, phase: 0, face: false } } };
    logic.commitRecord(plat, 'Placed the lift');
    const ui = studio64.storyUI;
    ui.newEvent({ name: 'Guard alarm', repeat: 'once', trigger: { type: 'object_event', uid: guard.uid, event: 'spotted' }, actions: [{ type: 'start_motion', uid: plat.uid }] });
    ui.newEvent({ name: 'Thrown out', repeat: 'once', trigger: { type: 'object_event', uid: guard.uid, event: 'hurt_mario' }, actions: [{ type: 'set_var', var: ids.hurt, op: 'add', value: 1 }, { type: 'warp', level: `c:${levelId}`, uid: din.uid }] });
    ui.flush();
    return { guard: guard.uid, plat: plat.uid };
  }, { ids, levelId, din: doors.din });
  await frames(10);
  // the guard is in this area only after it is spawned here (commitRecord spawns it)
  t.check('the custom object is in the sub-area', await s.eval((u) => studio64.engine.objects().some((o) => o.uid === u), objs.guard));
  // Mario walks up to it
  await s.eval(() => studio64.engine.teleport(0, 40, 200, 0x8000));
  const platY0 = await s.eval((u) => studio64.engine.objects().find((o) => o.uid === u)?.y, objs.plat);
  const moved = await s.until(([u, y0]) => { const o = studio64.engine.objects().find((x) => x.uid === u); return o && o.y > y0 + 100; }, [objs.plat, platY0], 90000);
  t.check('"spots Mario" starts the platform\'s motion in the sub-area', moved, { platY0 });
  const back = await waitKey(`c:${levelId}`, 120000);
  t.check('"hurts Mario" warps him out of the main area\'s door', back, await key());
  t.eq('the counter went up', await flag(ids.hurt), 1);
  if (back) {
    const m = await s.mario();
    t.check('he comes out at the door', Math.hypot(m.x - doors.din.x, m.z - doors.din.z) < 700, { m: [m.x, m.z], door: [doors.din.x, doors.din.z] });
  }

  // ---- the save: per project, on the server, reset ----
  await s.eval(() => studio64.engine.M._studio_save_set_course(0, 1)); // a star in Bob-omb Battlefield: the game writes its save
  await frames(5);
  const keys = await s.eval((pid) => ({ own: !!localStorage.getItem(`studio64.eeprom.${pid}`), shared: localStorage.getItem('sm64_save_file') }), s.projectId);
  t.check('the game\'s save is the project\'s own', keys.own);
  // the server gets everything within a few seconds
  let onServer = null;
  for (let i = 0; i < 40 && !onServer; i++) {
    const r = await fetch(`${process.env.STUDIO_URL || 'http://127.0.0.1:8064'}/api/projects/${s.projectId}/playsave`).then((x) => x.json());
    if (r.eeprom && r.story?.['1'] && JSON.parse(r.story['1']).vars?.[ids.seen] === true) onServer = r;
    else await s.wait(500);
  }
  t.check('the save (game save + story progress) is mirrored to the server', !!onServer);

  // the browser's storage is cleared under the running page: the page puts it back
  await s.eval(() => { for (const k of Object.keys(localStorage)) if (/^studio64\.(story|stars|eeprom|savetime)\./.test(k)) localStorage.removeItem(k); });
  t.check('storage cleared under the running page: the page keeps the save', await s.until((pid) => !!localStorage.getItem(`studio64.eeprom.${pid}`) && Object.keys(localStorage).some((k) => k.startsWith(`studio64.story.${pid}.`)), s.projectId, 15000));
  // another browser (or one whose storage was cleared while closed): the server's copy comes back
  const pid = s.projectId;
  await s.page.close();
  s = await t.open({ project: pid, context: await t.browser.newContext({ viewport: { width: 1440, height: 900 } }), label: 'fresh' });
  await s.arrive(null);
  await s.eval(() => { window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; }); });
  t.check('after clearing the browser storage the story progress is back', await flag(ids.seen) === true);
  t.check('so is the opened door', await s.eval((u) => studio64.storyRuntime.progress.locks?.[u] === false, doors.din.uid));
  t.eq('and the game save', await s.eval(() => JSON.parse(studio64.engine.M.UTF8ToString(studio64.engine.M._studio_save_json())).stars[0]), 1);

  // F3 → Save file → Reset save file
  await s.page.keyboard.press('F3');
  await s.wait(500);
  await s.page.click('.tt-tab[data-tab=save]');
  await s.page.waitForSelector('#tt-reset-save');
  await s.page.click('#tt-reset-save');
  await s.wait(400);
  t.check('"Reset save file" resets the story progress', await flag(ids.seen) === false);
  t.eq('and the game save', await s.eval(() => JSON.parse(studio64.engine.M.UTF8ToString(studio64.engine.M._studio_save_json())).stars[0]), 0);
  await s.page.keyboard.press('F3');

  // Play from start (Story panel): a fresh save again, at the start
  await s.eval((v) => studio64.storyRuntime.setVar(v, true), ids.seen);
  await s.eval(() => studio64.storyUI.open());
  await s.page.click('[data-act=play-start]');
  t.check('"Play from start" resets the story progress', await s.until((v) => studio64.storyRuntime.getVar(v) === false, ids.seen, 20000));
  const atStart = await s.until(() => { const e = studio64.engine; try { return e.level === 16 && !e.inIntro && !!e.state().mario; } catch { return false; } }, null, 90000);
  t.check('and starts the hack at its start (castle grounds)', atStart, await s.eval(() => ({ level: studio64.engine.level, intro: studio64.engine.inIntro, key: studio64.engine.areaKey() })));
  t.eq('no door is opened or locked in the fresh save', await s.eval(() => Object.keys(studio64.storyRuntime.progress.locks || {}).length), 0);
  await s.shot('end');
});
