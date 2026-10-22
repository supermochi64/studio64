// Motion: blocks that move along paths, elevators, spinning, falling, conveyor, trampoline and
// blinking platforms; Mario rides them (platform displacement), collision moves along; build
// mode puts them back home; motions survive a reload.
// @tags objects motion
// @timeout 600
import { suite } from '../lib/harness.mjs';

await suite('motion platforms', async (t) => {
  const s = await t.open({ level: 9 });
  const levelId = await s.newLevel('flat', 'Motion test');
  await s.play();
  // the game runs slower than real time under swiftshader: wait for game frames, not milliseconds
  await s.eval(() => { window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; }); });
  const frames = async (n) => {
    const f0 = await s.eval(() => window.__fc);
    await s.page.waitForFunction(([a, b]) => window.__fc >= a + b, [f0, n], { timeout: 180000, polling: 40 });
  };
  const spawnBlock = (rec) => s.eval(async (r) => {
    const g = await import('/js/generators.js');
    const rec = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), pitch: 0, roll: 0, yaw: 0, ...r, block: g.blockDefaults(r.block), name: r.name || 'test block' };
    studio64.editor.records().push(rec);
    studio64.objects.store.commit({ type: 'add', summary: `Built ${rec.name}`, records: [rec] });
    return { uid: rec.uid, slot: studio64.engine.spawn(rec) };
  }, rec);
  const objOf = (uid) => s.eval((u) => studio64.engine.objects().find((o) => o.uid === u), uid);
  const tp = (x, y, z) => s.eval(([a, b, c]) => studio64.engine.teleport(a, b, c, 0), [x, y, z]);
  const ground = await s.eval(() => studio64.engine.floor(0, 2000, 0));

  // 1. a moving platform (path, back and forth along x)
  const mover = await spawnBlock({ name: 'mover', x: 0, y: ground + 300, z: 0, block: { shape: 0, sx: 500, sy: 60, sz: 500, top: 'wood planks' },
    motion: { path: { points: [[0, 0, 0], [1200, 0, 0]], speed: 10, mode: 'pingpong', wait: 0 } } });
  await frames(3);
  // position and frame count read together: frames keep running between two page calls
  const objAt = (uid) => s.eval((u) => ({ ...studio64.engine.objects().find((o) => o.uid === u), fc: window.__fc }), uid);
  const a0 = await objAt(mover.uid);
  await frames(30);
  const a1 = await objAt(mover.uid);
  t.near('moving platform moves 10 units a frame along its path', a1.x - a0.x, 10 * (a1.fc - a0.fc), 25);
  t.near('it stays on its line', a1.z, 0, 2);
  await tp(a1.x, ground + 560, 0);
  await frames(25);
  const m0 = await s.mario(), p0 = await objOf(mover.uid);
  await frames(30);
  const m1 = await s.mario(), p1 = await objOf(mover.uid);
  t.near('Mario stands on the moving platform', m1.y, ground + 360, 4);
  t.check('Mario is carried with the platform', Math.abs((m1.x - m0.x) - (p1.x - p0.x)) < 25 && Math.abs(p1.x - p0.x) > 100, { mario: m1.x - m0.x, platform: p1.x - p0.x });
  // ping-pong: it comes back
  await frames(120);
  const a2 = await objOf(mover.uid);
  t.check('it turns around at the end and comes back', a2.x < 1150 && a2.x >= 0, { x: a2.x });

  // 2. an elevator (rises only while Mario stands on it, goes back down when he leaves)
  const elev = await spawnBlock({ name: 'elevator', x: -2000, y: ground, z: 1500, block: { shape: 0, sx: 400, sy: 40, sz: 400, top: 'metal' },
    motion: { path: { points: [[0, 0, 0], [0, 900, 0]], speed: 8, mode: 'pingpong', trigger: 'while_standing', wait: 0 } } });
  await frames(20);
  t.near('elevator waits at the bottom', (await objOf(elev.uid)).y, ground, 2);
  await tp(-2000, ground + 160, 1500);
  await frames(80);
  const { e1, me } = await s.eval((u) => ({ e1: studio64.engine.objects().find((o) => o.uid === u), me: studio64.engine.state().mario }), elev.uid);
  t.check('elevator rises with Mario on it', e1.y > ground + 400, { y: e1.y });
  t.near('Mario rises with the elevator', me.y, e1.y + 40, 4);
  await tp(-2600, ground + 100, 1500);
  await frames(60);
  t.check('elevator goes back down when Mario leaves', (await objOf(elev.uid)).y < e1.y - 200, (await objOf(elev.uid)).y);

  // 3. a spinning disc turns Mario with it
  await spawnBlock({ name: 'spinner', x: 2500, y: ground + 100, z: -1500, block: { shape: 3, sx: 1000, sy: 60, sz: 1000, top: 'checker' }, motion: { rotate: { yaw: 90 } } });
  await frames(3);
  await tp(2500 + 350, ground + 300, -1500);
  await frames(20);
  const r0 = await s.eval(() => ({ ...studio64.engine.state().mario, fc: window.__fc }));
  await frames(30);
  const r1 = await s.eval(() => ({ ...studio64.engine.state().mario, fc: window.__fc }));
  const ang = (m) => Math.atan2(m.x - 2500, m.z + 1500);
  const turned = Math.abs(((ang(r1) - ang(r0) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  t.near('a spinning platform carries Mario around (90°/s for a second)', (turned * 30) / (r1.fc - r0.fc), Math.PI / 2, 0.25);
  t.near('Mario stays on it, at the same distance from the center', Math.hypot(r1.x - 2500, r1.z + 1500), Math.hypot(r0.x - 2500, r0.z + 1500), 25);

  // 4. a falling platform falls after Mario stands on it, and comes back
  const fall = await spawnBlock({ name: 'falling', x: -2500, y: ground + 600, z: -2000, block: { shape: 0, sx: 400, sy: 60, sz: 400, top: 'red brick' }, motion: { fall: { delay: 0.3, respawn: 3 } } });
  await frames(3);
  await tp(-2500, ground + 760, -2000);
  await frames(45);
  const f1 = await objOf(fall.uid);
  t.check('a falling platform falls', f1.y < ground + 450, { y: f1.y });
  await frames(5 * 30 + 3 * 30 + 50);
  t.near('it comes back after its respawn time', (await objOf(fall.uid)).y, ground + 600, 2);

  // 5. a conveyor carries Mario sideways (90° = +x for an unturned block)
  await spawnBlock({ name: 'conveyor', x: 0, y: ground, z: 3000, block: { shape: 0, sx: 1400, sy: 40, sz: 400, top: 'metal plate' }, motion: { conveyor: { speed: 12, dir: 90 } } });
  await frames(3);
  await tp(-500, ground + 120, 3000);
  await frames(20);
  // position and frame count read together (a fast machine runs a few more frames between calls)
  const marioAt = () => s.eval(() => ({ ...studio64.engine.state().mario, fc: window.__fc }));
  const c0 = await marioAt();
  await frames(30);
  const c1 = await marioAt();
  t.near('a conveyor carries Mario 12 units a frame', (c1.x - c0.x) / (c1.fc - c0.fc), 12, 1.3);
  t.near('only along its direction', c1.z - c0.z, 0, 10);

  // 6. a trampoline throws him up (whether A is held or not)
  await spawnBlock({ name: 'trampoline', x: 3000, y: ground, z: 3000, block: { shape: 0, sx: 400, sy: 50, sz: 400, top: 'rainbow' }, motion: { bounce: { power: 100 } } });
  await frames(3);
  await tp(3000, ground + 200, 3000);
  let top = -1e9;
  for (let i = 0; i < 16; i++) { await frames(3); top = Math.max(top, (await s.mario()).y); }
  t.check('a trampoline throws Mario high', top > ground + 900, { top: top - ground });

  // 7. blinking: gone, then back
  const blink = await spawnBlock({ name: 'blinking', x: 2000, y: ground + 200, z: 1500, block: { shape: 0, sx: 300, sy: 40, sz: 300, top: 'yellow block' }, motion: { blink: { on: 1, off: 1 } } });
  const states = new Set();
  for (let i = 0; i < 12; i++) { await frames(6); states.add((await s.eval((sl) => studio64.engine.json('studio_motion_state_json', sl), blink.slot))?.hidden); }
  t.check('a blinking platform disappears and comes back', states.has(0) && states.has(1), [...states]);

  // 8. swinging and seesaw
  const swing = await spawnBlock({ name: 'swing', x: -800, y: ground + 400, z: -3000, block: { shape: 0, sx: 500, sy: 40, sz: 300 }, motion: { swing: { axis: 'roll', angle: 30, period: 2, pivot: 600 } } });
  await frames(15);
  const sw = await objOf(swing.uid);
  t.check('a swinging platform moves on its arc', Math.abs(sw.x + 800) > 50 && sw.roll !== 0, { x: sw.x, roll: sw.roll });
  const saw = await spawnBlock({ name: 'seesaw', x: 800, y: ground + 200, z: -3000, block: { shape: 0, sx: 300, sy: 40, sz: 1200 }, motion: { tilt: { angle: 20, speed: 1.5 } } });
  await frames(3);
  await tp(800, ground + 400, -3000 + 450);
  await frames(40);
  const sv = await objOf(saw.uid);
  t.check('a seesaw tilts toward where Mario stands', sv.pitch > 1500, { pitch: sv.pitch });

  // build mode: everything waits at home, the path is drawn, the inspector shows the motion
  await s.build();
  await s.wait(400);
  const home = await objOf(mover.uid);
  t.near('build mode: the moving platform is back home', home.x, 0, 2);
  await s.eval((u) => { const o = studio64.engine.objects().find((x) => x.uid === u); studio64.editor.select(o.slot); studio64.editor.frameSelection(); }, mover.uid);
  await s.wait(900);
  t.check('inspector shows the motion section with Path on', await s.eval(() => !!document.querySelector('#inspector .obj-motion .om-chip.on[data-kind=path]')));
  await s.shot('build_path');

  // persistence: reload the page, the motions are still there
  await s.settle(800);
  await s.reload();
  await s.arrive(37, 150000).catch(() => {}); // the app reopens the level it was in
  if ((await s.eval(() => studio64.engine.level)) !== 37) await s.goCustom(levelId);
  t.eq('after a reload the project reopens in the custom level', await s.eval(() => studio64.engine.customLevel), levelId);
  await s.wait(2000);
  const st = await s.eval((u) => { const o = studio64.engine.objects().find((x) => x.uid === u); return o ? studio64.engine.json('studio_motion_state_json', o.slot) : null; }, mover.uid);
  t.check('after a reload the platform still has its path', st && Math.abs(st.total - 1200) < 1, st);
  const recs = await s.records();
  t.eq('all 9 motion blocks are saved with their motion', recs.filter((r) => r.motion).length, 9);
});
