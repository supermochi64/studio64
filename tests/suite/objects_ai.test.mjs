// Claude's object tools (server/tools/objects.js) end to end: the real tool handlers of a
// real Agent, their rpc calls answered by a real game in the browser, their changes stored
// in a real project. Covers attach_motion, create/edit/place custom objects, set_game_rules,
// make_prefab + place, arrange_objects, set_object_path, trigger_motion, list_scene.
// @tags objects ai-free
// @timeout 600
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { suite } from '../lib/harness.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'studio64-objects-ai-'));
process.env.STUDIO_PROJECTS = path.join(tmp, 'projects');
process.env.STUDIO_AI_CONFIG = path.join(tmp, 'ai.json');
const { Agent } = await import('../../server/agent.js');
const projects = await import('../../server/projects.js');

await suite('objects ai tools', async (t) => {
  const s = await t.open({ level: 9 });
  await s.newLevel('flat', 'AI objects');
  await s.play();
  await s.eval(() => { window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; }); });
  const frames = async (n) => {
    const f0 = await s.eval(() => window.__fc);
    await s.page.waitForFunction(([a, b]) => window.__fc >= a + b, [f0, n], { timeout: 180000, polling: 40 });
  };

  // the agent's world: this project, the browser answers its rpc calls
  const project = projects.createProject({ name: 'objects ai' });
  const hub = {
    broadcast() {}, idle() {},
    patchChanged(p) { s.eval((patch) => { studio64.patch = patch; studio64.engine.setPatch(patch); }, JSON.parse(JSON.stringify(projects.patchOf(p)))); },
    rpc: (_c, method, params) => s.eval(([m, p]) => studio64.studio.handle(m, p), [method, params]),
  };
  const agent = new Agent(hub, project);
  agent.turn = { id: 'test', parts: [], client: { id: 'test' } };
  const call = async (name, args) => {
    const tl = agent.toolDefs.find((x) => x.name === name);
    if (!tl) throw new Error(`no tool ${name}`);
    const r = await tl.handler(args);
    const txt = r.content?.find((c) => c.type === 'text')?.text || '';
    if (r.isError) throw new Error(`${name}: ${txt}`);
    try { return JSON.parse(txt); } catch { return txt; }
  };
  const recs = () => Object.values(project.areas).flatMap((a) => a.objects || []);
  const m = await s.mario();

  // a block, then a motion for it (path in level coordinates)
  const b = await call('build', { kind: 'block', where: { mode: 'at', x: m.x + 400, z: m.z, y_offset: 200 }, block: { shape: 'box', sx: 400, sy: 60, sz: 400, material: 'wood planks' } });
  const uid = b.uids[0];
  const mo = await call('attach_motion', { uid, motion: { path: { absolute: [{ x: m.x + 1400, y: m.y + 200, z: m.z }], speed: 12, mode: 'pingpong' } } });
  t.check('attach_motion stores a path motion', recs().find((r) => r.uid === uid)?.motion?.path?.points?.length === 2, mo);
  await frames(30);
  const ms = await s.eval((u) => { const o = studio64.engine.objects().find((x) => x.uid === u); return studio64.engine.json('studio_motion_state_json', o.slot); }, uid);
  t.check('the block moves in the game', ms && ms.dist > 100, ms);
  await call('attach_motion', { uid, motion: { rotate: { yaw: 45 } } });
  t.check('a second motion is merged in', !!recs().find((r) => r.uid === uid)?.motion?.rotate && !!recs().find((r) => r.uid === uid)?.motion?.path);
  await call('attach_motion', { uid, none: true });
  t.check('none removes all motion', !recs().find((r) => r.uid === uid)?.motion);

  // an elevator waiting for an event, started by trigger_motion
  const e = await call('build', { kind: 'block', where: { mode: 'at', x: m.x - 600, z: m.z + 600 }, block: { shape: 'box', sx: 300, sy: 40, sz: 300 } });
  await call('attach_motion', { uid: e.uids[0], motion: { path: { points: [[0, 0, 0], [0, 600, 0]], speed: 10, trigger: 'event' } } });
  await frames(20);
  const y0 = await s.eval((u) => studio64.engine.objects().find((x) => x.uid === u).y, e.uids[0]);
  await call('trigger_motion', { uid: e.uids[0] });
  await frames(30);
  const y1 = await s.eval((u) => studio64.engine.objects().find((x) => x.uid === u).y, e.uids[0]);
  t.check('trigger_motion starts a motion that waits for an event', y1 - y0 > 150, { y0, y1 });

  // a custom enemy, made and placed by the tool
  const c = await call('create_custom_object', { name: 'Tough koopa', model: 'koopa', move: 'chase', health: 3, damage: 2, defeat: 'launch', coins: 5, sounds: { alert: 'Goomba alert' }, where: { distance: 900 } });
  const def = project.areas['@game'].objdefs.find((d) => d.id === c.id);
  t.check('create_custom_object saves the definition', def && def.health === 3 && def.sounds.alert === 'SOUND_OBJ_GOOMBA_ALERT', def);
  const inst = recs().find((r) => r.def === c.id);
  t.check('and places a copy', !!inst && inst.bhv === 'bhvStudioActor');
  await frames(5);
  const st = await s.eval((u) => { const o = studio64.engine.objects().find((x) => x.uid === u); return o && studio64.engine.json('studio_actor_state_json', o.slot); }, inst.uid);
  t.check('the copy runs with its building blocks (3 hits)', st && st.health === 3, st);
  await call('edit_custom_object', { id: 'Tough koopa', health: 5, scale: 1.5 });
  await s.wait(600);
  const st2 = await s.eval((u) => { const o = studio64.engine.objects().find((x) => x.uid === u); return o && { a: studio64.engine.json('studio_actor_state_json', o.slot), scale: o.scale }; }, inst.uid);
  t.check('edit_custom_object changes the copies', st2?.a?.health === 5 && st2.scale > 1.4, st2);
  const p2 = await call('place_custom_object', { id: 'tough', count: 2, where: { mode: 'around', radius: 600 } });
  t.eq('place_custom_object places more copies', p2.placed?.length, 2);
  const lib = await call('list_custom_objects', {});
  t.eq('list_custom_objects lists it', lib.custom_objects.map((d) => d.name), ['Tough koopa']);

  // game rules
  await call('set_game_rules', { rules: { jump: 2, moves: { longJump: false } } });
  await s.wait(500);
  let rj = await s.eval(() => studio64.engine.json('studio_rules_json'));
  t.check('set_game_rules reaches the engine', rj.jump === 2 && (rj.disabled & 1) === 1, rj);
  await call('set_game_rules', { scope: 'level', preset: 'moon' });
  await s.wait(500);
  rj = await s.eval(() => studio64.engine.json('studio_rules_json'));
  t.check('a level preset overrides the game rules here', Math.abs(rj.gravity - 0.45) < 0.01 && rj.jump === 2, rj);
  const gr = await call('get_game_rules', {});
  t.check('get_game_rules shows both', gr.base.jump === 2 && Object.values(gr.levels)[0]?.gravity === 0.45, gr);

  // prefabs and arranging
  const blocks = await call('build', { kind: 'path', params: { count: 4 } });
  const pf = await call('make_prefab', { name: 'Stepping stones', uids: blocks.uids });
  t.eq('make_prefab saves the blocks', pf.items, 4);
  const before = recs().filter((r) => r.block).length;
  await call('place_custom_object', { id: 'Stepping stones', where: { distance: 1500 } });
  t.eq('the prefab can be placed again', recs().filter((r) => r.block).length, before + 4);
  await call('arrange_objects', { uids: blocks.uids, op: 'align', axis: 'y', where: 'min' });
  const ys = recs().filter((r) => blocks.uids.includes(r.uid)).map((r) => r.y);
  t.check('arrange_objects aligns them', Math.max(...ys) - Math.min(...ys) < 1, ys);
  await call('arrange_objects', { uids: blocks.uids, op: 'move', dy: 300 });
  t.check('and moves them as a group', recs().filter((r) => blocks.uids.includes(r.uid)).every((r, i) => Math.abs(r.y - ys[i] - 300) < 1));

  // a platform on a track gets a new track
  const sp = await call('spawn', { items: [{ id: 'platform_on_track:rr_000848', where: { mode: 'at', x: m.x - 1500, z: m.z - 1500 } }] });
  const tuid = sp.placed[0].uid;
  await s.wait(500);
  const info = await call('get_object_path', { uid: tuid });
  t.check('get_object_path reads a track', info.info?.kind === 'track' && info.info.points.length > 2, info);
  await call('set_object_path', { uid: tuid, points: [{ x: m.x - 1500, y: m.y + 300, z: m.z - 1500 }, { x: m.x, y: m.y + 300, z: m.z - 1500 }, { x: m.x, y: m.y + 300, z: m.z }] });
  const key = await s.eval(() => studio64.engine.areaKey());
  t.check('set_object_path saves the track in the area', project.areas[key]?.paths?.length === 1 && project.areas[key].paths[0].points.length === 3, project.areas[key]?.paths);
  await frames(10);
  const tp = await s.eval((u) => studio64.engine.objects().find((x) => x.uid === u), tuid);
  t.check('the platform starts over on its new track (at its first point)', tp && Math.hypot(tp.x - (m.x - 1500), tp.z - (m.z - 1500)) < 5 && Math.abs(tp.y - (m.y + 300)) < 5, tp && { x: tp.x, y: tp.y, z: tp.z, want: [m.x - 1500, m.y + 300, m.z - 1500] });

  const scene = await call('list_scene', { kind: 'block' });
  t.check('list_scene lists blocks with their motions', scene.objects.some((o) => o.uid === e.uids[0] && o.motion?.includes('path')), scene.objects.slice(0, 3));
});
