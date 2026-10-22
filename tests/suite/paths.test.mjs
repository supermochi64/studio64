// Roads & nature: draw a road with the mouse (Roads tab), Mario walks along it and up the steps of a
// walk over a hill, a fence blocks him, a junction, editing points and width, painting and erasing
// plants (Nature tab), undo, reload, the standalone player and the AI's rpc methods.
// @tags editor
// @timeout 720
import { suite, URL_BASE, OUT } from '../lib/harness.mjs';

await suite('roads and nature', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  const levelId = await s.newLevel('flat', 'Roads');
  await s.build();
  // a hill for the steps
  await s.eval(() => studio64.world.runOps([{ op: 'hill', x: 1800, z: 2400, radius: 1500, height: 650 }]));

  const cam = async (target, dist, yaw, pitch) => {
    await s.eval(([tg, d, yw, p]) => {
      const ed = studio64.editor; ed.anim = null; ed.cam.yaw = yw; ed.cam.pitch = p;
      const dir = ed.camDir(); ed.cam.x = tg[0] - dir[0] * d; ed.cam.y = tg[1] - dir[1] * d; ed.cam.z = tg[2] - dir[2] * d; ed.pushCamera();
    }, [target, dist, yaw, pitch]);
    await s.wait(600);
  };
  const screen = async (p) => {
    const r = await s.eval((q) => { const s2 = studio64.editor.project(q), sz = studio64.editor.size(); return s2 && { ...s2, inside: s2.x > 0 && s2.y > 0 && s2.x < sz.w && s2.y < sz.h }; }, p);
    t.must(`point ${p} is in view`, r?.inside, r);
    return r;
  };
  const paths = () => s.eval(() => studio64.editor.records().filter((r) => r.road || r.line || r.nature));
  const groundY = (x, z) => s.eval(([x, z]) => studio64Paths.groundAt(x, z, 20000), [x, z]);

  // ---- the Roads tab ----
  await page.click('.lib-tab[data-lib=roads]');
  const styles = await s.eval(() => [...document.querySelectorAll('#lib-roads .pn-style[data-style]')].map((b) => b.dataset.style));
  t.check('road styles listed', ['asphalt', 'street', 'sidewalk', 'dirt', 'cobble', 'gravel', 'boardwalk', 'stone'].every((x) => styles.includes(x)), styles);
  const lineStyles = await s.eval(() => [...document.querySelectorAll('#lib-roads .pn-style[data-line]')].map((b) => b.dataset.line));
  t.check('fence, wall and lamp styles listed', lineStyles.length >= 13, lineStyles);

  // draw an asphalt road with three clicks and Enter
  await cam([0, 0, 0], 3600, 0, -1.2);
  await page.click('#lib-roads .pn-style[data-style=asphalt]');
  t.eq('drawing tool on', await s.eval(() => [studio64.editor.tool, studio64Paths.ui.mode]), ['paths', 'draw']);
  for (const [x, z] of [[-900, -300], [0, 200], [900, -300]]) {
    const p = await screen([x, 0, z]);
    await s.clickAt(p.x, p.y);
  }
  await page.keyboard.press('Enter');
  await s.settle(800);
  let recs = await paths();
  const road = recs.find((r) => r.road?.style === 'asphalt');
  t.must('a road record was saved', !!road, recs);
  t.eq('the road has its 3 points', road.road.pts.length, 3);
  t.check('its ground profile is stored', road.road.prof?.length > 20, road.road.prof?.length);
  t.check('one undoable edit', (await s.changes()).some((c) => /asphalt road/i.test(c)), await s.changes());
  const built = await s.eval((uid) => { const o = studio64Paths.objs.get(`r:${uid}`); return o ? { slot: o.slot, tris: o.tris, col: o.hasCol } : null; }, road.uid);
  t.check('the road is in the game with collision', built && built.slot >= 0 && built.tris > 50 && built.col, built);
  t.check('road objects are hidden from the object lists', await s.eval(() => !studio64.engine.objects().some((o) => o.uid >= 0x7e400000 && o.uid < 0x7e500000)));
  await page.keyboard.press('Escape');
  await s.shot('road_drawn');
  await s.eval((uid) => studio64Paths.ui.select(uid), road.uid);
  await s.wait(300);
  await s.shot('road_panel');
  await page.keyboard.press('Escape');

  // the floor on the road is the road (a few units over the ground), not the terrain
  const mid = await s.eval((uid) => { const R = studio64Paths.net.find((x) => x.rec.uid === uid); const i = R.n >> 1; return { x: R.S[i].x, z: R.S[i].z, y: R.Y[i] }; }, road.uid);
  const floorType = await s.eval((m) => studio64.engine.M._studio_floor_type(m.x, m.y + 200, m.z), mid);
  t.eq('the road surface is grippy (not slippery)', floorType, 0x15);

  // ---- a junction: a dirt path that ends on the road ----
  await page.click('#lib-roads .pn-style[data-style=dirt]');
  for (const [x, z] of [[0, 1400], [0, 200]]) {
    const p = await screen([x, 0, z]);
    await s.clickAt(p.x, p.y);
  }
  await page.keyboard.press('Enter');
  await s.settle(800);
  await page.keyboard.press('Escape');
  const junction = await s.eval(() => studio64Paths.net.map((R) => ({ style: R.road.style, ends: [!!R.ends.start, !!R.ends.end], gaps: R.gaps.mark.length })));
  t.check('the path joins the road (junction)', junction.some((j) => j.style === 'dirt' && (j.ends[0] || j.ends[1])), junction);
  t.check('the road opens for the path (gap in its markings)', junction.some((j) => j.style === 'asphalt' && j.gaps > 0), junction);
  await cam([0, 0, 200], 1300, 0.6, -0.55);
  await s.shot('junction');

  // ---- edit: select the road by clicking it, drag its middle point, change the width, undo ----
  await cam([0, 0, 0], 3600, 0, -1.2);
  const onRoad = await screen([-500, mid.y, -90]);
  await page.click('.lib-tab[data-lib=blocks]');
  await s.clickAt(onRoad.x, onRoad.y);
  t.eq('clicking a road selects it (Roads tab opens)', await s.eval((uid) => [studio64Paths.ui.tab, studio64Paths.ui.sel?.uid === uid], road.uid), ['roads', true]);
  t.check('the road panel shows', await page.isVisible('#lib-roads .pn-insp'));
  const p1 = await screen([0, (await s.eval((uid) => studio64Paths.ui.heightAt(studio64.editor.records().find((r) => r.uid === uid), 1), road.uid)), 200]);
  const to = await screen([0, 0, 500]);
  await s.drag(p1.x, p1.y, to.x, to.y, { steps: 10 });
  await s.settle(700);
  const moved = (await paths()).find((r) => r.uid === road.uid);
  t.check('dragging a point moves it', Math.abs(moved.road.pts[1][2] - 500) < 60, moved.road.pts[1]);
  const wInput = page.locator('#lib-roads .pn-insp .pn-slider input').first();
  await wInput.evaluate((e) => { e.value = 700; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
  await s.settle(600);
  t.eq('width changed', (await paths()).find((r) => r.uid === road.uid).road.width, 700);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await s.settle(900);
  t.eq('undo puts the width back', (await paths()).find((r) => r.uid === road.uid).road.width, 440);

  // ---- a walk over the hill: steps on the steep parts, Mario walks up them ----
  const walk = await s.eval(() => studio64.studio.handle('paths_draw_road', { style: 'sidewalk', points: [{ x: 300, z: 2400 }, { x: 1800, z: 2400 }, { x: 3300, z: 2500 }] }));
  t.check('steep walk got steps', walk.steps >= 1, walk);
  await cam([1200, 300, 2400], 1500, -1.4, -0.35);
  await s.shot('steps');

  // ---- a fence across a line Mario walks (UI) ----
  await page.click('#lib-roads .pn-style[data-line=picket]');
  await cam([-1600, 0, 1400], 3000, 0, -1.2);
  for (const [x, z] of [[-1600, 900], [-1600, 1900]]) {
    const p = await screen([x, 0, z]);
    await s.clickAt(p.x, p.y);
  }
  await page.keyboard.press('Enter');
  await s.settle(800);
  await page.keyboard.press('Escape');
  const fence = (await paths()).find((r) => r.line?.style === 'picket');
  t.must('a fence record was saved', !!fence);

  // ---- play: Mario on the road, up the steps, into the fence ----
  await s.play();
  const walkTo = async (from, yawDeg, frames) => {
    await s.eval(([f, y]) => studio64.engine.teleport(f[0], f[1] + 40, f[2], y), [from, Math.round((yawDeg / 360) * 65536)]);
    await s.wait(500);
    await s.eval(([y, n]) => studio64.engine.M._studio_walk(Math.round((y / 360) * 65536), n), [yawDeg, frames]);
    await s.wait(Math.max(1500, frames * 40));
    return s.mario();
  };
  // along the first road: start on it, run along it for a moment
  const r0 = await s.eval((uid) => { const R = studio64Paths.net.find((x) => x.rec.uid === uid); const i = 3; return { a: [R.S[i].x, R.Y[i], R.S[i].z], yaw: (Math.atan2(R.S[i].tx, R.S[i].tz) * 180) / Math.PI }; }, road.uid);
  const m1 = await walkTo(r0.a, r0.yaw, 12);
  const onIt = await s.eval(([m, uid]) => { const hit = studio64Paths.roadNear(m.x, m.z, 0); return { on: hit?.R.rec.uid === uid, type: studio64.engine.M._studio_floor_type(m.x, m.y + 50, m.z) }; }, [m1, road.uid]);
  t.check('Mario walks along the road and stays on it', onIt.on && Math.hypot(m1.x - r0.a[0], m1.z - r0.a[2]) > 150, { m1, onIt });
  t.eq('he stands on the road surface (grippy)', onIt.type, 0x15);
  // up the steps of the walk: the highest point he reaches
  const ws = await s.eval((uid) => { const R = studio64Paths.net.find((x) => x.rec.uid === uid); return { a: [R.S[1].x, R.Y[1], R.S[1].z], top: Math.max(...R.Y) }; }, walk.uid);
  await s.eval(([f]) => studio64.engine.teleport(f[0], f[1] + 40, f[2], 16384), [ws.a]);
  await s.wait(500);
  await s.eval(() => studio64.engine.M._studio_walk(16384, 100));
  let topY = -1e9;
  for (let i = 0; i < 50 && topY < ws.a[1] + 450; i++) { await s.wait(200); topY = Math.max(topY, (await s.mario()).y); }
  t.check('Mario climbs the steps up the hill', topY > ws.a[1] + 400, { start: ws.a, reached: topY, top: ws.top });
  // into the fence (from the east, walking west)
  const fy = await groundY(-1300, 1400);
  const m3 = await walkTo([-1300, fy, 1400], -90, 90);
  t.check('the fence blocks Mario', m3.x > -1600 + 10, m3);
  await s.build();

  // ---- the Nature tab: a preset, a stroke, the eraser, undo ----
  await page.click('.lib-tab[data-lib=nature]');
  t.check('kinds in the palette', (await page.locator('#lib-nature .pn-kind').count()) >= 30);
  await page.click('#lib-nature .chip[data-preset=forest]');
  await cam([-1000, 0, -1600], 3000, 0, -1.0);
  const a = await screen([-1500, 0, -1600]), b = await screen([-500, 0, -1600]);
  await s.drag(a.x, a.y, b.x, b.y, { steps: 14 });
  await s.settle(900);
  let plants = (await paths()).filter((r) => r.nature);
  const planted = plants.reduce((n, r) => n + r.nature.items.length, 0);
  t.check('a stroke plants a forest (one record)', plants.length === 1 && planted > 8, { records: plants.length, planted });
  const nat = await s.eval(() => studio64Paths.stats);
  t.check('plants are in the game', nat.tris > 500, nat);
  await cam([-1000, 100, -1600], 1500, 0.3, -0.4);
  await s.shot('forest');
  // erase the middle with Shift
  await cam([-1000, 0, -1600], 3000, 0, -1.0);
  const c = await screen([-1000, 0, -1600]);
  await s.drag(c.x - 20, c.y, c.x + 20, c.y, { steps: 4, mods: ['Shift'] });
  await s.settle(800);
  plants = (await paths()).filter((r) => r.nature);
  const left = plants.reduce((n, r) => n + r.nature.items.length, 0);
  t.check('Shift erases plants', left < planted, { planted, left });
  await page.keyboard.press('Control+z');
  await s.settle(900);
  const back = (await paths()).filter((r) => r.nature).reduce((n, r) => n + r.nature.items.length, 0);
  t.eq('undo brings the erased plants back', back, planted);

  // ---- the AI's methods: trees, flowers, fences along a road ----
  const ai = await s.eval(async (uid) => {
    const h = (n, a) => studio64.studio.handle(n, a);
    return {
      flowers: await h('paths_paint_nature', { preset: 'flowerbed', center: { x: 1000, z: -1600 }, radius: 400 }),
      trees: await h('paths_paint_nature', { kinds: ['oak', 'sm64_bubbly', 'cherry'], center: { x: 1000, z: -2600 }, radius: 700, density: 100 }),
      side: await h('paths_add_line', { style: 'lamps', along_road: uid, side: 'left' }),
      list: await h('paths_list', {}),
    };
  }, road.uid);
  t.check('AI: flowers planted', ai.flowers.planted > 20, ai.flowers);
  t.check('AI: trees planted', ai.trees.planted > 2, ai.trees);
  await s.settle(900);
  t.eq('AI: lamps along the road', (await paths()).find((r) => r.uid === road.uid).road.left, 'lamps');
  t.check('AI: list sees roads, lines and plants', ai.list.roads.length >= 3 && ai.list.lines.length >= 1 && ai.list.plants.count > 50, ai.list.plants);
  await cam([0, 200, -1400], 2600, 0.2, -0.5);
  await s.shot('overview');

  // ---- reload: everything comes back ----
  const before = await s.eval(() => ({ objs: studio64Paths.objs.size, stats: studio64Paths.stats }));
  await s.reload();
  if (!(await s.eval((id) => studio64.engine.level === studio64.engine.studioLevel && studio64.engine.customLevel === id, levelId))) await s.goCustom(levelId);
  await s.until(() => studio64Paths?.objs.size > 0, null, 30000);
  await s.wait(1500);
  const after = await s.eval(() => ({ objs: studio64Paths.objs.size, stats: studio64Paths.stats }));
  t.eq('after a reload: the same roads, lines and plants', [after.stats.roads, after.stats.lines, after.stats.plants], [before.stats.roads, before.stats.lines, before.stats.plants]);
  t.check('after a reload: built again', after.objs >= before.objs - 1, { before, after });

  // ---- the player shows them ----
  const pp = await s.page.context().newPage();
  await pp.goto(`${URL_BASE}/play.html?p=${s.projectId}`);
  await pp.waitForFunction(() => window.studioPlayer?.engine?.ready, null, { timeout: 120000 });
  if (await pp.isVisible('#play-btn').catch(() => false)) await pp.click('#play-btn').catch(() => {});
  await pp.waitForTimeout(1500);
  await pp.evaluate((id) => window.studioPlayer.engine.warpFast(window.studioPlayer.engine.studioLevel, 0, id, false), levelId);
  await pp.waitForTimeout(6000);
  const pst = await pp.evaluate(() => {
    const e = window.studioPlayer.engine;
    const objs = e.M ? JSON.parse(e.M.UTF8ToString(e.M._studio_objects_json())) : [];
    return { level: e.level, ours: objs.filter((o) => o.uid >= 0x7e400000 && o.uid < 0x7e500000).length };
  });
  t.check('the player builds the roads and plants', pst.ours >= 4, pst);
  await pp.screenshot({ path: `${OUT}/${t.slug}/player.png` }).catch(() => {});
  await pp.close();

  // the playable export carries the roads code
  const zip = await (await fetch(`${URL_BASE}/api/projects/${s.projectId}/standalone.zip`)).arrayBuffer();
  const { zipRead } = await import('../../server/zip.js');
  const files = zipRead(Buffer.from(zip));
  t.check('the standalone game has the roads & nature code', files.has('js/paths/runtime.js') && files.has('js/paths/nature.js'));

  // ---- delete a road ----
  await s.build();
  await s.eval((uid) => { studio64Paths.ui.openTab('roads'); studio64Paths.ui.select(uid); }, fence.uid);
  await s.wait(300);
  await page.keyboard.press('Delete');
  await s.settle(700);
  t.check('Delete removes the selected fence', !(await paths()).some((r) => r.uid === fence.uid));
  t.check('engine alive', await s.framesAdvance());
});
