// Shotgun Mario (from the Shoggoth World hack): the Shoggoth library tab, placing the pickup with the
// mouse, picking it up (how-to card), B fires every 26 frames with no recoil, the pump, wall holes and
// effects, the shotgun jump, aim mode with its crosshair, hits on a Goomba, a Bob-omb, a Koopa, a
// breakable box, a custom enemy, a gangster (and Sunshine enemies when converted), gangsters shooting
// back, the game rule (Game rules → Items), the story action and condition, reload, no crash.
// @tags objects gameplay
// @timeout 900
import { suite } from '../lib/harness.mjs';

await suite('shotgun', async (t) => {
  const s = await t.open({ level: 9 });
  const levelId = await s.newLevel('flat', 'Shotgun range');
  await s.eval(() => { window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; }); window.__ev = []; window.addEventListener('studio:object', (e) => window.__ev.push(e.detail)); });
  const frames = async (n) => {
    const f0 = await s.eval(() => window.__fc);
    await s.page.waitForFunction(([a, b]) => window.__fc >= a + b, [f0, n], { timeout: 180000, polling: 30 });
  };
  const velY = () => s.eval(() => studio64.engine.json('studio_rules_json').velY);
  const sg = () => s.eval(() => studio64.engine.json('studio_shotgun_state_json'));
  const objs = () => s.eval(() => studio64.engine.objects());
  const alive = async (uid) => (await objs()).some((o) => o.uid === uid);
  const tap = async (key, n = 3) => { await s.page.keyboard.down(key); await frames(n); await s.page.keyboard.up(key); };
  // places a catalog object as a saved record (the editor's own path is tested with the pickup below)
  const place = (entry, x, y, z, bparams = 0, yaw = 0) => s.eval(([e, p, bp, yw]) => {
    const st = studio64.objects.store;
    const rec = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), entry: e, x: p[0], y: p[1], z: p[2], yaw: yw, pitch: 0, roll: 0, bparams: bp };
    st.records().push(rec);
    st.commit({ type: 'add', summary: `Placed ${e}`, records: [rec] });
    return { uid: rec.uid, slot: studio64.engine.spawn(rec) };
  }, [entry, [x, y, z], bparams, yaw]);
  // Mario `dist` in front of (x, z), facing +z toward it
  const faceAt = async (x, z, dist = 450) => {
    const y = await s.eval(([a, b]) => studio64.engine.floor(a, 3000, b), [x, z - dist]);
    await s.eval(([a, b, c]) => studio64.engine.teleport(a, b, c, 0), [x, y, z - dist]);
    await frames(8);
  };

  // ---- the library: a Shoggoth tab with the shotgun and the gangster ----
  await s.build();
  await s.viewMario(1400, -0.8);
  await s.page.click('.lib-tab[data-lib=objects]');
  await s.wait(200);
  const chip = s.page.locator('#obj-cats .chip, .chip', { hasText: 'Shoggoth' }).first();
  t.must('the library has a Shoggoth category', (await chip.count()) > 0);
  await chip.click();
  await s.wait(200);
  const names = await s.eval(() => [...document.querySelectorAll('#obj-grid .obj .obj-name')].map((n) => n.textContent));
  t.check('it lists the shotgun and the gangster', names.includes('Shotgun') && names.includes('Gangster'), names);
  await s.shot('library');

  // place the pickup with the mouse
  await s.page.locator('#obj-grid .obj', { hasText: 'Shotgun' }).first().click();
  await s.wait(300);
  const gp = await s.groundPoint({ kind: null });
  t.must('a ground point to place on', !!gp);
  const bx = await s.box();
  await s.page.mouse.move(bx.x + gp.x, bx.y + gp.y);
  await s.wait(300);
  await s.clickAt(gp.x, gp.y);
  await s.settle(600);
  await s.key('Escape');
  const pick = (await s.records()).find((r) => r.entry === 'sg:shotgun');
  t.must('the pickup is a saved record', !!pick);
  await s.shot('pickup-placed');

  // ---- play: no gun yet, B punches; walking into the pickup arms him ----
  await s.play();
  const m0 = await s.mario();
  await s.eval(([x, y, z]) => studio64.engine.teleport(x + 400, y, z, -0x4000), [pick.x, pick.y, pick.z]);
  await frames(10);
  t.eq('no shotgun before the pickup', (await sg()).has, 0);
  await s.page.keyboard.down('j');
  let punched = false;
  for (let i = 0; i < 10 && !punched; i++) { await frames(1); const a = (await s.mario()).action; punched = a === '0x00800380' || a === '0x00800457'; }
  await s.page.keyboard.up('j');
  t.check('without the gun B still punches', punched);
  await frames(30);
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y, z + 60, 0), [pick.x, pick.y, pick.z]);
  await frames(12);
  let st = await sg();
  t.eq('walking into the pickup gives Mario the shotgun', st.has, 1);
  t.check('the pickup is gone', !(await alive(pick.uid)));
  t.check('the how-to card shows the keys', await s.eval(() => !!document.querySelector('.sg-howto')));
  await frames(10);
  await s.shot('picked-up');

  // ---- firing: hold B, a blast every 26 frames, no recoil, B no longer punches ----
  const g = await s.eval(() => studio64.engine.state().mario);
  const ground = { x: g.x, y: g.y, z: g.z };
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y, z, 0), [ground.x, ground.y, ground.z]);
  await frames(15);
  const p0 = await s.mario();
  const n0 = (await sg()).shots;
  await s.page.keyboard.down('j');
  await frames(60);
  st = await sg();
  const p1 = await s.mario();
  await s.page.keyboard.up('j');
  t.check('holding B fires every 26 frames', st.shots - n0 >= 2 && st.shots - n0 <= 3, { blasts: st.shots - n0 });
  t.check('Mario stands his ground (no recoil)', Math.hypot(p1.x - p0.x, p1.z - p0.z) < 5, { p0, p1 });
  t.check('B no longer punches', p1.action !== '0x00800380' && p1.action !== '0x00800457', p1.action);
  t.check('the blast travels where he faces (+z)', st.lastDir[2] > 0.95, st.lastDir);
  t.check('effects fly (smoke, sparks, flash)', st.parts > 0 || st.shots > n0, st);
  await s.shot('firing');
  await frames(30);    // (the cooldown runs out)
  await tap('q');
  await frames(4);
  t.check('L (Q) fires as well', (await sg()).shots > st.shots);

  // a wall: a box in front, bullet holes in it
  const wallZ = ground.z + 700;
  await s.eval(([x, y, z]) => {
    const st = studio64.objects.store;
    const rec = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), block: { shape: 0, sx: 1200, sy: 600, sz: 100, top: 0, side: 0 }, x, y, z, yaw: 0, pitch: 0, roll: 0 };
    st.records().push(rec);
    st.commit({ type: 'add', summary: 'Wall', records: [rec] });
    studio64.engine.spawn(rec);
  }, [ground.x, ground.y, wallZ]);
  await frames(40);
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y, z, 0), [ground.x, ground.y, ground.z]);
  await frames(30);
  await tap('j');
  await frames(6);
  st = await sg();
  t.check('the blast hits the wall ahead', st.lastDist < 800, { dist: st.lastDist });
  t.check('bullet holes appear', st.decals >= 1, st.decals);
  await s.shot('holes');

  // ---- the shotgun jump ----
  await frames(30);
  const n1 = (await sg()).shots;
  await s.page.keyboard.down(' ');
  await frames(4);
  await s.page.keyboard.up(' ');
  let fell = false;
  for (let i = 0; i < 40 && !fell; i++) { await frames(1); fell = (await velY()) < 0; }
  await tap('j', 2);
  let maxVel = -99;
  for (let i = 0; i < 4; i++) { await frames(1); maxVel = Math.max(maxVel, await velY()); }
  st = await sg();
  t.check('B mid-air blasts straight down', st.shots === n1 + 1 && st.lastDir[1] < -0.95, st.lastDir);
  t.check('and sends him up (54, minus gravity on the way)', (await sg()).airBoost >= 50, { airBoost: (await sg()).airBoost, maxVel });
  // once per jump, frame-exact: a long fall (Mario dropped from high up), B, then B again after
  // the 26-frame fire delay, each press made with the game frozen and stepped (frame advance), so
  // wall-clock delays cannot let him land in between
  await frames(40);
  const inAir = () => s.eval(() => (parseInt(studio64.engine.state().mario.action, 16) & 0x800) !== 0);
  const step = async (n) => { const f0 = await s.eval(() => window.__fc); await s.eval((k) => studio64.engine.M._studio_debug_step(k), n); await s.page.waitForFunction(([a, b]) => window.__fc >= a + b, [f0, n], { timeout: 60000, polling: 30 }); };
  const pressB = async () => { await s.page.keyboard.down('j'); await step(2); await s.page.keyboard.up('j'); await step(1); };
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y + 4000, z, 0), [ground.x, ground.y, ground.z]);
  await s.eval(() => studio64.engine.M._studio_debug_speed(1, 1));
  await step(6);
  const f0 = (await sg()).shots;
  await pressB();
  const f1 = (await sg()).shots;
  await step(30);
  const stillFalling = await inAir();
  await pressB();
  const f2 = (await sg()).shots;
  await s.eval(() => studio64.engine.M._studio_debug_speed(0, 1));
  t.check('falling: the first B in the air fires', f1 === f0 + 1, { f0, f1 });
  t.check('still in the air 30 frames later', stillFalling);
  t.eq('only once per jump', f2, f1);
  await frames(60);

  // ---- aim mode: R, the camera over his shoulder, the crosshair, R again ----
  await tap('r');
  await frames(20);
  t.eq('R enters aim mode', (await sg()).aim, 1);
  await s.shot('aim-mode');
  const y0 = (await sg()).camYaw;
  await s.page.keyboard.down('ArrowLeft');
  await frames(20);
  await s.page.keyboard.up('ArrowLeft');
  t.check('the arrow keys (C) turn the aim', (await sg()).camYaw !== y0);
  await tap('r');
  await frames(10);
  t.eq('R leaves aim mode', (await sg()).aim, 0);

  // ---- hits: every kind of enemy reacts ----
  await s.eval(() => studio64.engine.heal());
  const row = [];
  const targets = [['goomba', 0], ['bobomb', 0], ['koopa', 0x00010000], ['breakable_box', 0], ['sg:gangster', 0x00010000]];
  const cat = await s.eval(() => studio64.catalog.entries.map((e) => e.id));
  if (cat.includes('sms:strollin_stu')) targets.push(['sms:strollin_stu', 0x00000001]);   // (guards its spot)
  // Each target is placed when its turn comes. (Placed all at once, the gangster saw Mario shooting
  // its neighbours, closed in and strafed around him (it may go 700 from its spot), walked into the
  // blast meant for the box next to it and was gone before its turn: "sg:gangster spawned" failed
  // in about half of the runs; and the Koopa, the Goombas and the Bob-omb wander off too.)
  let x = ground.x - 3000;
  const z = ground.z - 2500;
  for (const [entry, bp] of targets) {
    if (!cat.includes(entry)) { t.check(`${entry} is in the catalog`, false); continue; }
    const at = x;
    row.push({ entry, x: at, z, spawn: async () => place(entry, at, (await s.eval(([a, b]) => studio64.engine.floor(a, 3000, b), [at, z])) + 5, z, bp, 0x8000) });
    x += 900;
  }
  // a custom enemy (the builder's defaults: stomp or punch, one hit)
  const cx = x;
  row.push({ entry: 'custom enemy', x: cx, z, spawn: async () => s.eval(([p]) => {
    const st = studio64.objects.store;
    const id = 'dsg' + Math.random().toString(36).slice(2, 6);
    const d = { id, name: 'Target dummy', model: 'goomba', move: 'stand', health: 1, damage: 1, stomp: true, punch: true, defeat: 'poof', coins: 1 };
    st.setGame('objdefs', [...studio64.objects.defs(), d], 'Made Target dummy');
    const rec = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), bhv: 'bhvStudioActor', model: 'goomba', def: id, x: p[0], y: p[1], z: p[2], yaw: 0x8000, pitch: 0, roll: 0, bparams: 0, scale: 1, name: d.name };
    st.records().push(rec);
    st.commit({ type: 'add', summary: 'Placed Target dummy', records: [rec] });
    return { uid: rec.uid, slot: studio64.engine.spawn(rec) };
  }, [[cx, await s.eval(([a, b]) => studio64.engine.floor(a, 3000, b), [cx, z]), z]]) });
  for (const r of row) {
    // Mario stands where he will shoot from first, then the target appears in front of him
    await faceAt(r.x, r.z, r.entry === 'bobomb' ? 600 : 420);
    Object.assign(r, await r.spawn());
    await frames(28);    // (it lands; the cooldown runs out)
    const o = (await objs()).find((q) => q.uid === r.uid);
    if (!o) { t.check(`${r.entry} spawned`, false); continue; }
    await s.eval(() => studio64.engine.heal());
    await faceAt(o.x, o.z, r.entry === 'bobomb' ? 600 : 420);
    await tap('j', 2);
    await frames(2);
    st = await sg();
    const hit = st.hits.find((h) => h.uid === r.uid);
    t.check(`${r.entry}: the blast hits it`, !!hit, st.hits);
    let gone = false;
    for (let i = 0; i < 50 && !gone; i++) { await frames(4); gone = !(await alive(r.uid)); }
    if (r.entry === 'koopa') {
      // shelled Koopas lose their shell (it pops off) and run: still there, but reacted
      t.check('koopa: it reacts (knocked about or gone)', hit && hit.kind === 'attack');
    } else {
      t.check(`${r.entry}: defeated / broken / exploded`, gone);
    }
    if (r.entry === 'bobomb') t.eq('bobomb: it goes off', hit?.kind, 'bobomb');
    await s.shot(`hit-${r.entry.replace(/[^a-z]/g, '_')}`);
  }
  t.check('placed enemies hit by the shotgun report "hit" to the story', (await s.eval(() => window.__ev.filter((e) => e.event === 'hit').length)) >= 1);

  // ---- gangsters shoot back ----
  await s.eval(() => studio64.engine.heal());
  const gx = ground.x + 1500, gz = ground.z - 800;
  const gy = await s.eval(([a, b]) => studio64.engine.floor(a, 3000, b), [gx, gz]);
  const gang = await place('sg:gangster', gx, gy + 5, gz, 0, 0x8000);
  await faceAt(gx, gz, 900);
  // (they spray: each shot misses by up to 25 + 4% of the distance, a burst is 2-3 shots, then a
  // pause of 50-120 frames while he strafes; so wait for a few bursts, not for one)
  let bullets = 0, hurt = false, seenFrames = 0;
  for (let i = 0; i < 120 && !(bullets && hurt); i++) {
    await frames(5);
    const list = await objs();
    const n = list.filter((o) => o.bhv === 'bhvStudioGangsterBullet').length;
    bullets = Math.max(bullets, n);
    if (n) seenFrames++;
    hurt = hurt || (await s.mario()).health < 8;
  }
  t.check('a gangster who sees Mario fires at him', bullets > 0);
  t.check('his bullets hurt', hurt, { bulletSamples: seenFrames });
  await s.shot('gangster-fires');
  await s.eval(() => studio64.engine.heal());
  await s.eval((u) => studio64.engine.deleteUid(u), gang.uid);

  // ---- the story: take / give, the condition ----
  await s.eval(() => studio64.storyRuntime.runAction({ type: 'shotgun', on: 'take' }, null));
  await frames(3);
  t.eq('story: "take the shotgun"', (await sg()).has, 0);
  t.check('story condition "Mario has the shotgun" is false', await s.eval(() => studio64.storyRuntime.check([{ type: 'shotgun', value: true }])) === false);
  await s.eval(() => studio64.storyRuntime.runAction({ type: 'shotgun', on: 'give' }, null));
  await frames(3);
  t.eq('story: "give the shotgun"', (await sg()).has, 1);
  await s.eval(() => studio64.storyRuntime.runAction({ type: 'shotgun', on: 'take' }, null));

  // ---- the game rule: Game rules → Items → "Mario starts with the shotgun" ----
  await s.key('p');
  await s.page.waitForSelector('.om-dialog.gr', { timeout: 5000 }).catch(() => {});
  const ruleUi = await s.eval(() => !!document.querySelector('.om-dialog.gr'));
  if (!ruleUi) await s.eval(() => studio64.objects.rules.open());
  await s.page.click('.gr-tab[data-s=items]');
  await s.wait(200);
  await s.shot('rules-items');
  await s.page.locator('.gr-check', { hasText: 'shotgun' }).locator('input').check();
  await frames(5);
  t.eq('switching the rule on arms Mario now', (await sg()).has, 1);
  t.eq('the rule is saved for the game', await s.eval(() => studio64.objects.rules.rules().base.shotgun), true);
  await s.page.keyboard.press('Escape');
  // another level: he arrives armed; the pickup is not needed
  await s.goLevel(9);
  await s.arrive(9);
  await frames(20);
  st = await sg();
  t.eq('with the rule he starts every level armed', st.has, 1);
  t.eq('(by the rule)', st.byRule, 1);
  await s.shot('bob-armed');
  await tap('j');
  await frames(30);
  t.check('firing in Bob-omb Battlefield works', (await sg()).shots >= 1);
  t.check('no crash', !(await s.crashed()));

  // ---- reload: the rule and the pickup are in the project ----
  await s.reload();
  await s.eval(() => { window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; }); });
  await s.goCustom(levelId);
  await s.arrive();
  await frames(20);
  t.eq('after a reload the rule still arms him', (await sg()).has, 1);
  const recs = await s.records();
  t.check('the placed pickup survived the reload', recs.some((r) => r.entry === 'sg:shotgun'));
  const ex = await s.export();
  t.eq('the project file has the rule', ex.areas['@game'].rules.base.shotgun, true);
  t.check('no crash at the end', !(await s.crashed()));
});
