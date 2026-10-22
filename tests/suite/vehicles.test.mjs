// Vehicles (the Shoggoth World hack's car and race): place a car from the library, the inspector,
// get in with B at the door, drive (throttle, steering, a drift), hit a wall, get out; a race along
// a drawn course against the rival, won with the autopilot, its star; reload keeps everything.
// @tags gameplay vehicles
// @timeout 900
import { suite } from '../lib/harness.mjs';

await suite('vehicles', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  const lvl = await s.newLevel('flat', 'Car test');
  const key = `c:${lvl}`;
  const veh = () => s.eval(() => studio64.engine.json('studio_vehicle_state_json'));
  // a button press the game sees (it reads the keys once a frame; busy machines draw few frames)
  const tap = async (k, ms = 220) => { await page.keyboard.down(k); await s.wait(ms); await page.keyboard.up(k); };

  // ---- a car from the library ----
  await s.build();
  await s.viewMario(1500, -0.55);
  await page.click('.lib-tab[data-lib=objects]').catch(() => {});
  await page.click('#obj-cats .chip:has-text("Vehicles")');
  const names = await page.$$eval('#obj-grid .obj .obj-name', (els) => els.map((e) => e.textContent));
  t.check('Vehicles category lists the cars', ['Sportscar', 'Race car', 'Taxi', 'Race (rival car)'].every((n) => names.includes(n)), names);
  await page.click('#obj-grid .obj:has-text("Sportscar")');
  const gp = await s.groundPoint();
  t.must('ground to place on', !!gp);
  await s.clickAt(gp.x, gp.y);
  await s.key('Escape');
  await s.settle();
  const car = (await s.records()).find((r) => r.entry === 'vehicle:sportscar');
  t.must('car record saved', !!car);
  t.eq('car has its settings', car.vehicle?.look, 'sportscar');
  await s.shot('01_placed');

  // the inspector: the Car section, a new colour and top speed
  const slot = await s.eval((uid) => studio64.engine.objects().find((o) => o.uid === uid)?.slot, car.uid);
  await s.eval((sl) => studio64.editor.select(sl), slot);
  await s.wait(300);
  t.check('inspector shows the Car section', await page.isVisible('#inspector .vh-sec'));
  t.check('no size / params for a car', !(await page.textContent('#inspector')).includes('Behavior params'));
  await page.click('#inspector .vh-swatch[title="#2860e0"]');
  await s.settle();
  t.eq('painted blue', (await s.records()).find((r) => r.uid === car.uid).vehicle.color, '#2860e0');
  await s.shot('02_inspector_blue');
  await s.eval(() => studio64.editor.select(null));

  // ---- play: get in at the door ----
  await s.play();
  const c0 = (await s.records()).find((r) => r.uid === car.uid);
  const yawR = (c0.yaw / 65536) * Math.PI * 2;
  // the driver's door: +x of the car (local), 172 out
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y + 30, z, 0), [c0.x + Math.cos(yawR) * 175, c0.y, c0.z - Math.sin(yawR) * 175]);
  await s.wait(800);
  t.check('prompt shows at the door', (await veh()).prompt === 1, await veh());
  await s.shot('03_prompt');
  await tap('KeyJ');
  await s.until(() => studio64.engine.json('studio_vehicle_state_json').driving === 1, null, 5000);
  t.must('B gets Mario in', (await veh()).driving === 1, await veh());
  await s.wait(900);

  // drive: throttle (Space) and a turn (D)
  const start = await veh();
  await page.keyboard.down('Space');
  await s.until(() => studio64.engine.json('studio_vehicle_state_json').speed > 40, null, 12000);
  const fast = await veh();
  t.check('throttle: the car speeds up', fast.speed > 40, fast);
  t.check('the car moved', Math.hypot(fast.x - start.x, fast.z - start.z) > 300, { start, fast });
  t.check('speedometer shows', await page.isVisible('.vh-speedo'));
  await s.shot('04_driving');
  await page.keyboard.down('KeyD');
  await s.wait(1200);
  await page.keyboard.up('KeyD');
  const turned = await veh();
  t.check('steering turns the car', Math.abs(((turned.yaw - fast.yaw + 98304) % 65536) - 32768) > 2500, { a: fast.yaw, b: turned.yaw });
  // a drift: R through a bend
  await page.keyboard.down('KeyR');
  await page.keyboard.down('KeyA');
  let drifted = false;
  for (let i = 0; i < 20 && !drifted; i++) { await s.wait(100); drifted = (await veh()).drifting === 1; }
  await s.shot('05_drift');
  await page.keyboard.up('KeyA');
  await page.keyboard.up('KeyR');
  t.check('R drifts', drifted);
  await page.keyboard.up('Space');

  // ---- into a wall ----
  await s.build();
  const v = await veh();
  const ya = (v.yaw / 65536) * Math.PI * 2;
  const wall = { uid: 1 + Math.floor(Math.random() * 1e8), block: { shape: 0, sx: 2400, sy: 600, sz: 200, top: 4, side: 4 }, x: Math.round(v.x + Math.sin(ya) * 1600), y: Math.round(v.y), z: Math.round(v.z + Math.cos(ya) * 1600), yaw: v.yaw, pitch: 0, roll: 0, name: 'Wall' };
  await s.eval((rec) => { studio64.engine.spawn(rec); studio64.editor.records().push(rec); studio64.editor.commit({ type: 'add', summary: 'Wall', records: [rec] }); }, wall);
  await s.play();
  t.check('still at the wheel after build mode', (await veh()).driving === 1, await veh());
  const crashes0 = (await veh()).crashes;
  await page.keyboard.down('Space');
  await s.until((c) => studio64.engine.json('studio_vehicle_state_json').crashes > c, crashes0, 12000);
  await page.keyboard.up('Space');
  const hit = await veh();
  t.check('hitting the wall is a crash', hit.crashes > crashes0, hit);
  const d = (hit.x - wall.x) * Math.sin(ya) + (hit.z - wall.z) * Math.cos(ya);
  t.check('the wall stops the car', d < -100, { d });
  await s.shot('06_crash');

  // ---- get out ----
  await s.wait(1000);
  await tap('ShiftLeft');
  await s.until(() => studio64.engine.json('studio_vehicle_state_json').driving === 0, null, 6000);
  t.check('Z (Shift) gets Mario out', (await veh()).driving === 0);
  await s.wait(800);
  const m = await s.mario();
  t.check('Mario stands beside the car', Math.hypot(m.x - hit.x, m.z - hit.z) < 450, { m, hit });
  await s.shot('07_out');

  // ---- a race ----
  await s.eval((uid) => { studio64.engine.deleteUid(uid); studio64.editor.commit({ type: 'remove', summary: 'Removed the wall', uids: [uid], rules: [] }); }, wall.uid);
  await s.build();
  await s.eval(() => { const e = studio64.engine; e.teleport(-2200, 200, -1000, 0); });
  await s.wait(600);
  await s.viewMario(1700, -0.6);
  await page.click('#obj-grid .obj:has-text("Race (rival car)")');
  const gp2 = await s.groundPoint();
  t.must('ground for the race', !!gp2);
  await s.clickAt(gp2.x, gp2.y);
  await s.wait(800);
  let race = (await s.records()).find((r) => r.entry === 'vehicle:race');
  t.must('race record saved', !!race);
  t.check('a new race has a course, laps and a star', race.motion?.path?.points?.length >= 4 && race.race?.laps === 3 && !!race.star, race);
  t.check('the race is selected with its section', await page.isVisible('#inspector .vh-sec .om-card-head:has-text("Course")'));
  await s.shot('08_race_placed');
  // a course that fits: a rounded rectangle west of the start (and 2 laps, an easy rival)
  await s.eval(() => {
    const ed = studio64.editor, sel = ed.sel, rec = sel.rec;
    const pts = [[0, 0, 0], [0, 0, 2600], [-500, 0, 3300], [-1800, 0, 3300], [-2300, 0, 2600], [-2300, 0, 0], [-1800, 0, -700], [-500, 0, -700]];
    rec.x = -1200; rec.z = -1800; rec.yaw = 0;
    rec.y = studio64.engine.floor(rec.x, 1500, rec.z);
    ed.updateSelected({ x: rec.x, y: rec.y, z: rec.z, yaw: 0, race: { ...rec.race, laps: 2, difficulty: 'easy', traffic: 2 } }, 'Race setup');
    studio64.objects.motion.setMotion(ed.sel, { path: { ...rec.motion.path, points: pts.map((p) => [p[0], studio64.engine.floor(rec.x + p[0], 1500, rec.z + p[2]) - rec.y, p[2]]) } }, 'Race course', true);
  });
  await s.settle(800);
  await s.shot('09_course');
  race = (await s.records()).find((r) => r.entry === 'vehicle:race');
  t.eq('course saved', race.motion.path.points.length, 8);

  // play: walk up to the rival, B
  await s.eval(() => studio64.editor.select(null));
  await s.play();
  await s.eval((r) => studio64.engine.teleport(r.x + 300, r.y + 40, r.z, 0), race);
  await s.wait(800);
  t.check('race prompt by the rival', (await veh()).prompt === 2, await veh());
  await s.eval(() => studio64.objects.vehicles.autopilot(true));
  await tap('KeyJ');
  await s.until(() => studio64.objects.vehicles.hud()[18] >= 1, null, 8000);
  t.must('B starts the race', (await s.eval(() => studio64.objects.vehicles.hud()[18])) >= 1);
  await s.wait(1500);
  await s.shot('10_intro');
  await s.until(() => studio64.objects.vehicles.hud()[18] === 2, null, 20000);
  await s.wait(700);
  await s.shot('11_countdown');
  await s.until(() => studio64.objects.vehicles.hud()[18] === 3, null, 20000);
  t.check('mario at the wheel of the race car', (await veh()).race === 1, await veh());
  await s.wait(2500);
  await s.shot('12_racing');
  const course = await s.eval(() => studio64.engine.json('studio_race_course_json'));
  t.check('the course is a closed circuit', course.closed === 1 && course.pts.length > 10, course);
  let h = null, lapSeen = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    h = await s.eval(() => studio64.objects.vehicles.hud());
    if (h[20] >= 2) lapSeen = true;
    if (process.env.VEH_DEBUG) t.log('race', JSON.stringify(h.slice(18, 30).map((x) => Math.round(x * 10) / 10)), JSON.stringify(await veh()));
    if (h[18] >= 4) break;
    await s.wait(500);
  }
  t.check('lap 2 reached', lapSeen);
  t.must('the race finished', h[18] >= 4, h.slice(18, 30));
  t.eq('Mario won', h[29], 1);
  await s.wait(600);
  await s.shot('13_finish');
  await s.until(() => studio64.objects.vehicles.hud()[18] === 5, null, 20000);
  t.check('out of the car after the finish', (await veh()).driving === 0);
  t.check('the star comes out', !!(await s.eval(() => studio64.objects.vehicles.hud()[43])));
  await s.wait(1500);
  await s.shot('14_star');
  await s.eval(() => studio64.objects.vehicles.autopilot(false));
  // collect it: Mario to the star
  await s.until(() => studio64.engine.objects().some((o) => /Star/.test(o.bhv) && o.uid), null, 8000);
  for (let i = 0; i < 20; i++) {
    const st = await s.eval(() => studio64.engine.objects().find((o) => /bhvStarSpawnCoordinates|bhvStar/.test(o.bhv) && o.uid));
    if (!st) break;
    await s.eval((o) => studio64.engine.teleport(o.x, o.y - 40, o.z, 0), st);
    await s.wait(500);
    if (await s.eval((k) => studio64.world.stars(k).some((x) => x.done && x.name === 'Win the race'), key)) break;
  }
  await page.waitForFunction((k) => studio64.world.stars(k).some((x) => x.done && x.name === 'Win the race'), key, { timeout: 20000 }).catch(() => {});
  t.check('the race star is collected', await s.eval((k) => studio64.world.stars(k).some((x) => x.done && x.name === 'Win the race'), key));
  await s.shot('15_collected');

  // the course complete screen, then back in the level
  await s.wait(8000);
  for (let i = 0; i < 6; i++) { await tap('Space', 120); await s.wait(700); }
  await s.arrive(null, 40000);

  // ---- saved: a reload keeps the car, the race and its course ----
  await s.reload();
  if (await s.eval(() => studio64.engine.level) !== 37 || await s.eval(() => studio64.engine.customLevel) !== lvl) await s.goCustom(lvl);
  const after = await s.export();
  const recs = after.areas[key].objects;
  t.check('car saved with its paint', recs.some((r) => r.entry === 'vehicle:sportscar' && r.vehicle?.color === '#2860e0'));
  t.check('race saved with its course', recs.some((r) => r.entry === 'vehicle:race' && r.motion?.path?.points?.length === 8 && r.race?.laps === 2));
  const vs = await s.eval(() => studio64.studio.handle('vehicle_state', {}));
  t.eq('vehicle_state lists the car and the race', vs.placed.map((x) => x.kind).sort(), ['car', 'race']);
  t.check('the race star counts in the level', await s.eval((k) => studio64.world.stars(k).some((x) => x.name === 'Win the race' && x.done), key));

  // ---- an original level: a taxi in Bob-omb Battlefield ----
  await s.goLevel(9);
  const placed = await s.eval(() => studio64.studio.handle('vehicle_place', { look: 'taxi', color: '#20a050' }));
  const taxi = placed.placed[0].record;
  t.check('a taxi from the AI rpc', taxi.entry === 'vehicle:taxi' && placed.placed[0].slot >= 0, placed);
  await s.wait(500);
  await page.focus('#canvas');
  t.check('get in by uid', await s.eval((uid) => studio64.objects.vehicles.enter(uid), taxi.uid));
  await s.wait(1000);
  await page.keyboard.down('KeyW');
  await s.until(() => studio64.engine.json('studio_vehicle_state_json').speed > 30, null, 12000);
  const tv = await veh();
  await s.shot('16_bob_taxi');
  await page.keyboard.up('KeyW');
  t.check('W drives the taxi in BoB', tv.speed > 30 && tv.look === 'taxi', tv);
  await s.wait(1500);
  await page.focus('#canvas');
  await tap('ShiftLeft', 300);
  await s.until(() => studio64.engine.json('studio_vehicle_state_json').driving === 0, null, 8000);
  t.check('out of the taxi', (await veh()).driving === 0);
});
