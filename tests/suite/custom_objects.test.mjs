// Custom objects without code: make one in the builder (UI), place it, get hurt by a chaser,
// defeat a stompable one by jumping on it (coins + "defeated" event), a punch-only one hurts
// when stomped, a turret shoots, a patroller walks its path, edits change every copy,
// everything is still there after a reload.
// @tags objects editor
// @timeout 600
import { suite } from '../lib/harness.mjs';

await suite('custom objects', async (t) => {
  const s = await t.open({ level: 9 });
  const levelId = await s.newLevel('flat', 'Enemy test');
  await s.eval(() => { window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; }); window.__ev = []; window.addEventListener('studio:object', (e) => window.__ev.push(e.detail.event)); });
  const frames = async (n) => {
    const f0 = await s.eval(() => window.__fc);
    await s.page.waitForFunction(([a, b]) => window.__fc >= a + b, [f0, n], { timeout: 180000, polling: 40 });
  };

  // ---- the builder, as a user would use it ----
  await s.build();
  await s.viewMario(1600, -0.75);
  await s.page.click('.lib-tab[data-lib=objects]');
  await s.page.click('.mine-chip');
  await s.wait(200);
  await s.page.click('.mine-new');
  await s.page.waitForSelector('.om-dialog.ab');
  await s.page.click('.ab-tpl[data-tpl=chaser]');
  await s.page.fill('.ab-name', 'Angry goomba');
  await s.shot('builder');
  await s.page.click('[data-a=saveplace]');
  await s.wait(400);
  t.check('placing starts after saving', await s.eval(() => studio64.editor.tool === 'objects-place'));
  const gp = await s.groundPoint({ kind: null });
  t.must('a ground point to place on', !!gp);
  await s.page.mouse.move((await s.box()).x + gp.x, (await s.box()).y + gp.y);
  await s.wait(300);
  await s.clickAt(gp.x, gp.y);
  await s.settle(700);
  const defs = await s.eval(() => studio64.objects.defs());
  t.eq('the custom object is in My objects', defs.map((d) => d.name), ['Angry goomba']);
  const placed = (await s.records()).filter((r) => r.bhv === 'bhvStudioActor');
  t.eq('one copy is placed in the level', placed.length, 1);
  t.check('it is listed in the library', await s.eval(() => [...document.querySelectorAll('#obj-grid .obj.mine.def .obj-name')].some((n) => n.textContent === 'Angry goomba')));
  await s.shot('placed');

  // ---- play: the chaser runs at Mario and hurts him ----
  await s.play();
  const chaser = placed[0];
  const m0 = await s.mario();
  await s.eval(([x, y, z]) => studio64.engine.teleport(x + 500, y + 50, z, 0), [chaser.x, chaser.y, chaser.z]);
  let hurt = false, moved = 0;
  for (let i = 0; i < 40 && !hurt; i++) {
    await frames(5);
    const st = await s.eval((u) => { const o = studio64.engine.objects().find((x) => x.uid === u); return { m: studio64.engine.state().mario, o, a: o && studio64.engine.json('studio_actor_state_json', o.slot) }; }, chaser.uid);
    moved = Math.max(moved, Math.hypot(st.o.x - chaser.x, st.o.z - chaser.z));
    if (st.m.health < 8) hurt = true;
  }
  t.check('the chaser runs toward Mario', moved > 150, { moved });
  t.check('it hurts Mario when it reaches him', hurt);
  t.check('the "spotted" event fired', (await s.eval(() => window.__ev)).includes('spotted'));
  await s.eval(() => studio64.engine.heal());

  // ---- programmatic: a stompable one, a punch-only one, a turret, a patroller ----
  const make = (def, at, extra = {}) => s.eval(([d, p, ex]) => {
    const st = studio64.objects.store;
    const id = 'd' + Math.random().toString(36).slice(2, 8);
    st.setGame('objdefs', [...studio64.objects.defs(), { id, ...d }], `Made ${d.name}`);
    const rec = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), bhv: 'bhvStudioActor', model: d.model, def: id, x: p[0], y: p[1], z: p[2], yaw: 0, pitch: 0, roll: 0, bparams: 0, scale: d.scale || 1, name: d.name, ...ex };
    st.records().push(rec);
    st.commit({ type: 'add', summary: `Placed ${d.name}`, records: [rec] });
    return { uid: rec.uid, slot: studio64.engine.spawn(rec), id };
  }, [def, at, extra]);
  const g = await s.eval(() => studio64.engine.floor(0, 3000, -2500));
  const coins0 = (await s.mario()).coins;
  const walker = await make({ name: 'Stompy', model: 'goomba', move: 'stand', health: 1, damage: 1, stomp: true, punch: true, defeat: 'squish', coins: 3 }, [0, g, -2500]);
  await frames(10);
  await s.eval(() => studio64.engine.teleport(0, studio64.engine.floor(0, 3000, -2500) + 600, -2500, 0));
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) { await frames(4); gone = !(await s.eval((u) => studio64.engine.objects().some((o) => o.uid === u), walker.uid)); }
  t.check('stomping a stompable custom enemy defeats it', gone);
  await frames(30);
  const coins = await s.eval(() => studio64.engine.objects().filter((o) => /Coin/.test(o.bhv)).length);
  const got = (await s.mario()).coins - coins0;
  t.check('it drops its coins (Mario lands on them or they lie there)', coins + got >= 3, { coins, got });
  t.check('the "defeated" event fired', (await s.eval(() => window.__ev)).includes('defeated'));

  await s.eval(() => studio64.engine.heal());
  const spiky = await make({ name: 'Spiky', model: 'spiny', move: 'stand', health: 1, damage: 2, stomp: false, punch: true, defeat: 'poof', coins: 1 }, [1500, g, -2500]);
  await frames(10);
  await s.eval(() => studio64.engine.teleport(1500, studio64.engine.floor(1500, 3000, -2500) + 500, -2500, 0));
  let spHurt = false;
  for (let i = 0; i < 30 && !spHurt; i++) { await frames(4); spHurt = (await s.mario()).health < 8; }
  t.check('jumping on a punch-only enemy hurts Mario', spHurt);
  t.check('and it survives', await s.eval((u) => studio64.engine.objects().some((o) => o.uid === u), spiky.uid));

  await s.eval(() => studio64.engine.heal());
  await s.eval(() => studio64.engine.teleport(-1500, 200, 1500, 0));
  const turret = await make({ name: 'Turret', model: 'bobomb', move: 'turret', shoot: true, fireEvery: 1, projectile: 'flame:red_flame', burns: false, sight: 3000 }, [-1500, g, 500]);
  let shots = 0;
  for (let i = 0; i < 25 && !shots; i++) { await frames(4); shots = await s.eval(() => studio64.engine.objects().filter((o) => o.bhv === 'bhvStudioProjectile').length); }
  t.check('a turret shoots at Mario', shots > 0, { shots });
  void turret;

  const pat = await make({ name: 'Guard', model: 'koopa', move: 'patrol', speed: 8, health: 2 }, [2500, g, 1500], { motion: { path: { points: [[0, 0, 0], [0, 0, 1200]], speed: 8, mode: 'pingpong', wait: 0 } } });
  await frames(60);
  const po = await s.eval((u) => studio64.engine.objects().find((o) => o.uid === u), pat.uid);
  t.check('a patroller walks along its path', po.z - 1500 > 150 && Math.abs(po.x - 2500) < 80, { x: po.x, z: po.z });

  // ---- editing the definition changes every copy ----
  const before = await s.eval((u) => { const o = studio64.engine.objects().find((x) => x.uid === u); return o.scale; }, pat.uid);
  await s.eval((id) => { const st = studio64.objects.store; st.setGame('objdefs', studio64.objects.defs().map((d) => (d.id === id ? { ...d, scale: 2 } : d)), 'Bigger guard'); }, pat.id);
  await s.settle(900);
  const after = await s.eval((u) => { const o = studio64.engine.objects().find((x) => x.uid === u); return o?.scale; }, pat.uid);
  t.check('changing the definition updates its copies', after > before * 1.8, { before, after });

  // ---- reload: definitions and copies come back with their behaviour ----
  await s.settle(800);
  await s.reload();
  await s.arrive(37, 150000).catch(() => {}); // the app reopens the level it was in
  if ((await s.eval(() => studio64.engine.level)) !== 37) await s.goCustom(levelId);
  t.eq('after a reload the project reopens in the custom level', await s.eval(() => studio64.engine.customLevel), levelId);
  await s.wait(2500);
  t.eq('after a reload My objects has all 5 definitions', (await s.eval(() => studio64.objects.defs().length)), 5);
  const back = await s.eval((u) => { const o = studio64.engine.objects().find((x) => x.uid === u); return o ? studio64.engine.json('studio_actor_state_json', o.slot) : null; }, pat.uid);
  t.check('the guard is back with its behaviour', back && back.health === 2, back);
});
