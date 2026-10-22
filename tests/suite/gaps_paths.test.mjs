// Objects gaps: undoing a custom object's definition keeps its copies working (also after a
// reload); a level's own platform on a track takes a redrawn track at once (and its own one
// back); Koopa the Quick runs the race path drawn for him.
// @tags objects motion
// @timeout 900
import { suite } from '../lib/harness.mjs';

await suite('gaps: custom object undo, tracks, Koopa the Quick', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  await s.newLevel('flat', 'Undo test');
  await s.play();
  await s.eval(() => { window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; }); });
  const frames = async (n) => {
    const f0 = await s.eval(() => window.__fc);
    await page.waitForFunction(([a, b]) => window.__fc >= a + b, [f0, n], { timeout: 180000, polling: 50 });
  };
  const actorState = (uid) => s.eval((u) => {
    const o = studio64.engine.objects().find((x) => x.uid === u);
    return o ? studio64.engine.json('studio_actor_state_json', o.slot) : 'missing';
  }, uid);

  // ---- 1. a custom object, a copy of it, then its definition undone -------------------------
  const g = await s.eval(() => studio64.engine.floor(0, 3000, -1500));
  const made = await s.eval(async (g) => {
    const { actorRecord } = await import('/js/objects/actors.js');
    const st = studio64.objects.store;
    const def = { id: 'dundo' + Math.random().toString(36).slice(2, 6), name: 'Undo walker', model: 'goomba', move: 'wander', speed: 6, health: 2, damage: 1, stomp: true, punch: true, defeat: 'squish' };
    st.setGame('objdefs', [...studio64.objects.defs(), def], `Made the custom object “${def.name}”`);
    const rec = actorRecord(def, [0, g, -1500], 0, 1 + Math.floor(Math.random() * 0x7efffffe));
    st.records().push(rec);
    st.commit({ type: 'add', summary: `Placed ${def.name}`, records: [rec] });
    studio64.engine.spawn(rec);
    return { uid: rec.uid, id: def.id, snapshot: !!rec.actor };
  }, g);
  t.check('a placed copy keeps a snapshot of its definition', made.snapshot);
  await frames(10);
  t.check('the copy behaves (custom object state)', (await actorState(made.uid)) !== null, await actorState(made.uid));
  // undo "Made the custom object" from the edit history
  await s.until(() => studio64.changes.some((c) => /Made the custom object/.test(c.summary)), null, 10000);
  await s.eval(() => { const c = studio64.changes.find((x) => /Made the custom object/.test(x.summary)); studio64.ws.send(JSON.stringify({ type: 'undo', changeId: c.id })); });
  const undone = await s.until((id) => !studio64.objects.defs().some((d) => d.id === id), made.id, 15000);
  t.check('the definition is undone', undone);
  await frames(15);
  const after = await actorState(made.uid);
  t.check('its copy is still there and still behaves', after !== null && after !== 'missing', after);
  await s.reload();
  await page.click('#start').catch(() => {});
  await s.arrive(37);
  await s.eval(() => { window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; }); });
  await frames(15);
  const afterReload = await actorState(made.uid);
  t.check('after a reload the copy still behaves', afterReload !== null && afterReload !== 'missing', afterReload);
  // redo brings the definition back
  await s.eval(() => studio64.ws.send(JSON.stringify({ type: 'redo' })));
  t.check('redo brings the definition back', await s.until((id) => studio64.objects.defs().some((d) => d.id === id), made.id, 15000));

  // ---- 2. a level's own platform on a track (Cool, Cool Mountain's ski lift) -------------------
  await s.goLevel(5);
  await frames(20);
  const lift = await s.eval(() => studio64.engine.objects().find((o) => o.bhv === 'bhvPlatformOnTrack'));
  t.must('the level has a platform on a track', !!lift);
  const orig = await s.eval((slot) => studio64.engine.json('studio_path_info_json', slot), lift.slot);
  t.check('its own track is known', orig?.kind === 'track' && orig.points.length > 3, orig);
  const p0 = orig.points[0];
  // a new track: starting 400 to the side, then a straight line
  const track = [[p0[0] + 400, p0[1], p0[2]], [p0[0] + 400, p0[1] + 300, p0[2] + 1200], [p0[0] + 400, p0[1] + 600, p0[2] + 2400]];
  await s.eval(([slot, pts]) => {
    const o = studio64.engine.objects().find((x) => x.slot === slot);
    studio64.objects.motion.saveOverride(o, pts);
  }, [lift.slot, track]);
  await frames(6);
  const moved = await s.eval((slot) => studio64.engine.objects().find((x) => x.slot === slot), lift.slot);
  t.check('the platform jumps to its new track at once', moved && Math.hypot(moved.x - track[0][0], moved.z - track[0][2]) < 60, { moved, start: track[0] });
  const info2 = await s.eval((slot) => studio64.engine.json('studio_path_info_json', slot), lift.slot);
  t.check('the inspector sees the drawn track', info2?.kind === 'custom', info2);
  // ride it: Mario on the platform, it moves along the new track
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y + 250, z, 0), track[0]);
  let rode = 0;
  for (let i = 0; i < 40 && rode < 200; i++) {
    await frames(5);
    const o = await s.eval((slot) => studio64.engine.objects().find((x) => x.slot === slot), lift.slot);
    rode = o ? o.z - track[0][2] : 0;
  }
  const o3 = await s.eval((slot) => studio64.engine.objects().find((x) => x.slot === slot), lift.slot);
  t.check('it carries Mario along the new track', rode > 200 && Math.abs(o3.x - track[0][0]) < 60, { rode, x: o3?.x });
  // back to its own track
  await s.eval((slot) => { const o = studio64.engine.objects().find((x) => x.slot === slot); studio64.objects.motion.saveOverride(o, null); }, lift.slot);
  await frames(6);
  const back = await s.eval((slot) => studio64.engine.objects().find((x) => x.slot === slot), lift.slot);
  t.check('"Original path" puts it back on its own track at once', back && Math.hypot(back.x - p0[0], back.z - p0[2]) < 60, { back, p0 });
  t.check('the game goes on', await s.framesAdvance());

  // ---- 3. Koopa the Quick (Bob-omb Battlefield, the race act) ---------------------------------
  await s.eval(() => studio64.engine.warpFast(9, 2, null, false));
  await s.arrive(9);
  await frames(20);
  const ktq = await s.eval(() => studio64.engine.objects().find((o) => o.bhv === 'bhvKoopa' && ((o.bparams >>> 16) & 0xff) === 2));
  t.must('Koopa the Quick is in the race act', !!ktq);
  const race = await s.eval((slot) => studio64.engine.json('studio_path_info_json', slot), ktq.slot);
  t.check('his race path is known', race?.kind === 'race', race);
  // a path at a right angle to his own first leg, over open ground
  const plan = await s.eval(({ k, race }) => {
    const e = studio64.engine;
    const a = race.points[0], b = race.points[Math.min(3, race.points.length - 1)];
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    for (const sgn of [1, -1]) {
      const dx = (-(b[2] - a[2]) / L) * sgn, dz = ((b[0] - a[0]) / L) * sgn;
      const pts = [];
      let ok = true;
      for (let i = 0; i <= 4; i++) {
        const x = k.x + dx * 400 * i, z = k.z + dz * 400 * i;
        const y = e.floor(x, k.y + 1500, z);
        if (y < k.y - 400 || y > k.y + 400) { ok = false; break; }
        pts.push([Math.round(x), Math.round(y), Math.round(z)]);
      }
      if (ok) return { pts, dir: [dx, dz] };
    }
    return null;
  }, { k: ktq, race });
  t.must('found open ground for a new race path', !!plan);
  await s.eval(([slot, pts]) => { const o = studio64.engine.objects().find((x) => x.slot === slot); studio64.objects.motion.saveOverride(o, pts); }, [ktq.slot, plan.pts]);
  await frames(4);
  t.check('his path is now the drawn one', (await s.eval((slot) => studio64.engine.json('studio_path_info_json', slot), ktq.slot))?.kind === 'custom');
  // start the race (as if Mario said yes) and watch where he runs
  await s.eval((slot) => studio64.engine.M._studio_debug_obj_action(slot, 3), ktq.slot);
  let along = 0, side = 0;
  for (let i = 0; i < 40 && along < 700; i++) {
    await frames(6);
    const k = await s.eval((slot) => studio64.engine.objects().find((x) => x.slot === slot), ktq.slot);
    if (!k) break;
    along = (k.x - ktq.x) * plan.dir[0] + (k.z - ktq.z) * plan.dir[1];
    side = Math.abs(-(k.x - ktq.x) * plan.dir[1] + (k.z - ktq.z) * plan.dir[0]);
  }
  t.check('Koopa the Quick runs along the drawn path', along > 700 && side < 250, { along: Math.round(along), side: Math.round(side) });
  await s.shot('ktq');
});
