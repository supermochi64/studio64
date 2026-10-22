// Tokyo from Shoggoth World as a level template: the New level card, the city
// (geometry, collision, water, sky, music, scenery, traffic, yokai), its stars, walking its streets,
// riding a lift, editing it and getting it back after a reload. Skipped (passes with a note) when the
// Tokyo data was not imported (no Shoggoth World checkout: tools/import_shoggoth_tokyo.mjs).
// @tags levels tokyo
// @timeout 900
import fs from 'node:fs';
import path from 'node:path';
import { suite, ROOT } from '../lib/harness.mjs';

const DATA = path.join(ROOT, 'web', 'data', 'shoggoth', 'tokyo.json');

await suite('tokyo template', async (t) => {
  if (!fs.existsSync(DATA)) {
    t.check('Tokyo not imported: nothing to test (run node tools/import_shoggoth_tokyo.mjs)', true);
    return;
  }
  const tpl = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const s = await t.open({ level: 9 });
  const page = s.page;
  const music = [];
  page.on('console', (m) => { if (/^music:/.test(m.text())) music.push(m.text()); });

  // play mode, whatever the level launcher left on (it brings build mode back after a jump)
  const playMode = async () => {
    for (let i = 0, calm = 0; i < 80 && calm < 3; i++) {
      const act = await s.eval(() => { const a = !!studio64.editor?.active; if (a) studio64.editor.exit(); return a; });
      calm = act ? 0 : calm + 1;
      await s.wait(500);
    }
  };
  const mario = () => s.mario();
  const yawTo = (m, x, z) => Math.round((Math.atan2(x - m.x, z - m.z) / (2 * Math.PI)) * 65536) & 0xffff;
  // Walks to (x, z) with the autopilot, steering every few frames. Returns the closest it got and the
  // lowest floor on the way.
  // Like a player, it steps back and waits when a car that stopped for it stands in the way (the
  // traffic waits for Mario, and moves on once he is not in front of it any more).
  async function walkTo(x, z, { timeout = 60000 } = {}) {
    const t0 = Date.now();
    let best = Infinity, low = Infinity, m = await mario(), lastBest = Infinity, stuckSince = Date.now();
    while (Date.now() - t0 < timeout) {
      m = await mario();
      const d = Math.hypot(x - m.x, z - m.z);
      best = Math.min(best, d);
      low = Math.min(low, m.y);
      if (d < 120) break;
      if (best < lastBest - 40) { lastBest = best; stuckSince = Date.now(); }
      if (Date.now() - stuckSince > 2500) {
        await s.eval(([yaw]) => studio64.engine.M._studio_walk(yaw, 25), [(yawTo(m, x, z) + 0x8000) & 0xffff]);
        await s.wait(3500);
        stuckSince = Date.now();
        lastBest = Infinity;
        continue;
      }
      await s.eval(([yaw]) => studio64.engine.M._studio_walk(yaw, 12), [yawTo(m, x, z)]);
      await s.wait(220);
    }
    await s.eval(() => studio64.engine.M._studio_walk(0, 0));
    return { best: Math.round(best), low: Math.round(low), at: [Math.round(m.x), Math.round(m.y), Math.round(m.z)] };
  }

  // ---- the template card ----------------------------------------------------------------------
  t.must('the engine has the city', await s.eval(() => studio64.engine.entryIndex.has('tokyo:city')));
  await page.focus('#canvas');
  await page.keyboard.press('Control+k');
  await page.click('#launcher-body .lvl-card.new');
  await page.waitForSelector('#launcher-body .tpl-tokyo', { timeout: 10000 });
  await page.fill('#nl-name', 'Neo Tokyo');
  const before = await s.eval(() => studio64.levels.length);
  await s.markArea();
  await page.click('#launcher-body .tpl-tokyo');
  await page.waitForFunction((n) => studio64.levels.length > n, before, { timeout: 15000 });
  await s.skipIntro();
  await s.arriveNew(37, 120000);
  const id = await s.eval(() => studio64.engine.customLevel);
  t.check('a new level "Neo Tokyo" from the Tokyo card', await s.eval((i) => studio64.levels.find((l) => l.id === i)?.name, id) === 'Neo Tokyo');
  await playMode();
  await s.wait(1500);

  // ---- what came with it -------------------------------------------------------------------------
  const info = await s.eval(() => {
    const e = studio64.engine;
    const recs = studio64.world.area().objects || [];
    return {
      surfaces: e.json('studio_debug_counts').surfaces,
      mario: e.state().mario,
      records: recs.length,
      entries: [...new Set(recs.map((r) => r.entry || r.model).filter(Boolean))],
      sky: e.M._studio_sky_active(),
      settings: studio64.world.settings(),
      npcs: Object.keys(studio64.storyUI?.story?.npcs || {}).length,
      stars: studio64.world.stars().map((x) => x.name),
    };
  });
  t.log(JSON.stringify({ surfaces: info.surfaces, records: info.records, mario: info.mario }));
  t.check('the city\'s collision is loaded (>10000 triangles)', info.surfaces > 10000, info.surfaces);
  t.near('Mario starts at Tokyo\'s own spawn (Hachiko Plaza)', Math.hypot(info.mario.x - tpl.spawn.x, info.mario.z - tpl.spawn.z), 0, 150);
  t.check('Mario stands on the ground', Math.abs(info.mario.y - info.mario.floorY) < 5 && info.mario.floorY > -100, info.mario);
  for (const e of ['tokyo:city', 'tokyo:traffic_light', 'tokyo:screen_big', 'tokyo:taxi', 'tokyo:train', 'tokyo:lift', 'tokyo:crane_jib', 'tokyo:oni_red', 'tokyo:chochin', 'tokyo:kappa', 'tokyo:tanuki', 'red_coin', 'coin_formation', 'warp_pipe']) {
    t.check(`the level has ${e}`, info.entries.includes(e));
  }
  t.check('Tokyo\'s night sky is on', info.sky === 1);
  t.check('Tokyo\'s music is the level song', !!info.settings.m64Song?.data);
  t.check('the Toads and the sign say Tokyo\'s texts', info.npcs >= 10, info.npcs);
  t.check('two stars of Shoggoth\'s Tokyo plus the 100 coin star', info.stars.includes('Construction Crane Climb') && info.stars.includes('Red Coins All Over Tokyo') && info.stars.includes('100 coins'), info.stars);
  await s.wait(2000);
  await s.eval(() => studio64.engine.M._studio_music_debug());
  await s.wait(400);
  t.check('the music plays in the level slot', music.some((m) => /enabled 1 seq 26 tempo 118/.test(m)), music);
  t.check('nothing went wrong in the engine', !(await s.crashed()));

  const warps = await s.eval(() => studio64.engine.warps());
  t.check('its two warp pipes lead to each other', JSON.stringify(warps).includes('128') && JSON.stringify(warps).includes('129'), warps);
  const problems = await s.eval(() => studio64.testing.runCheck().problems.filter((p) => p.severity === 'error').map((p) => p.title));
  t.eq('the level check finds no errors', problems, []);

  // ---- the look ------------------------------------------------------------------------------------
  // a few views around the city (play camera behind Mario); the frame must show a lit scene
  const views = [['plaza', tpl.spawn.x, 20, tpl.spawn.z, 0x6000], ['crossing', 900, 20, 900, 0xa000], ['shrine', -8400, 20, 5000, 0x8000],
    ['station', -7000, 20, -7800, 0x8000], ['site', 7800, 20, -1800, 0x8000], ['canal', -2000, 20, 6500, 0x4000]];
  for (const [name, x, y, z, yaw] of views) {
    await s.eval(([x, y, z, yaw]) => studio64.engine.teleport(x, y, z, yaw), [x, y, z, yaw]);
    await s.wait(2200);
    const stat = await s.eval(() => new Promise((res) => (studio64.engine.frameWaiters ||= []).push((c) => {
      const g = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0, sum = 0, sum2 = 0;
      for (let i = 0; i < g.length; i += 4 * 97) { const v = (g[i] + g[i + 1] + g[i + 2]) / 3; n++; sum += v; sum2 += v * v; }
      const mean = sum / n;
      res({ mean: Math.round(mean), sd: Math.round(Math.sqrt(sum2 / n - mean * mean)) });
    })));
    const m = await mario();
    t.check(`${name}: Mario stands on Tokyo's ground`, m.floorY > -200 && Math.abs(m.y - m.floorY) < 10, m);
    t.check(`${name}: a lit, detailed picture`, stat.mean > 25 && stat.sd > 18, stat);
    await s.shot(`look_${name}`);
  }

  // ---- walking the streets -------------------------------------------------------------------------
  // from the plaza to the scramble crossing, then along the sidewalks of the four boulevards (the
  // main routes; no hole, no invisible wall on the way: Mario gets there and never drops below the
  // street). The roads are |x| or |z| < 1150, the sidewalks beside them.
  await s.eval(([x, z]) => studio64.engine.teleport(x, 20, z, 0x6000), [tpl.spawn.x, tpl.spawn.z]);
  await s.wait(1500);
  const legs = [['plaza to the crossing', -1500, 1500], ['west boulevard', -7600, 1500], ['back to the crossing', -1500, 1500],
    ['over the crosswalk', -1500, -1500], ['north boulevard', -1500, -7600], ['back', -1500, -1500], ['east boulevard', 7000, -1500],
    ['back', 1500, -1500], ['over the crosswalk', 1500, 1500], ['south towards the canal', 1500, 6200]];
  for (const [name, x, z] of legs) {
    const r = await walkTo(x, z);
    t.check(`walk: ${name}`, r.best < 300 && r.low > -150, r);
  }
  await s.shot('walked');

  // ---- the station's glass lift --------------------------------------------------------------------
  const lift = tpl.objects.find((o) => o.bhv === 'bhvShLift' && o.x < 0);
  if (lift) {
    const rise = ((lift.bparams >>> 16) & 255) * 20;
    await s.eval(([x, y, z]) => studio64.engine.teleport(x, y + 120, z, 0), [lift.x, lift.y, lift.z]);
    let top = 0;
    for (let i = 0; i < 40 && top < lift.y + rise - 40; i++) { await s.wait(500); top = Math.max(top, (await mario()).y); }
    t.near('the glass lift carries Mario up to the platform', top, lift.y + rise, 60);
    await s.shot('lift_top');
  }

  // ---- the crane carries its star -------------------------------------------------------------------
  const starAt = () => s.eval(() => studio64.engine.objects().filter((o) => o.bhv === 'bhvStar').map((o) => [Math.round(o.x), Math.round(o.z)]));
  // (it swings 220 frames, rests 300: watch up to 40 s, a busy machine runs fewer frames)
  const s0 = await starAt();
  let s1 = s0, moved = 0;
  for (let i = 0; i < 20 && moved < 400; i++) {
    await s.wait(2000);
    s1 = await starAt();
    moved = Math.max(moved, ...s0.map((p, k) => Math.hypot(p[0] - (s1[k]?.[0] ?? p[0]), p[1] - (s1[k]?.[1] ?? p[1]))));
  }
  t.check('the crane\'s jib swings its star round', s0.length >= 1 && moved >= 400, { s0, s1, moved });

  // ---- editing: the city is an object like any other -----------------------------------------------
  const cityUid = await s.eval(() => studio64.world.area().objects.find((r) => r.entry === 'tokyo:city').uid);
  await s.eval((u) => studio64.engine.deleteUid(u), cityUid);
  await s.wait(1200);
  const gone = await s.eval(() => studio64.engine.json('studio_debug_counts').surfaces);
  t.check('deleting the city takes its collision away', gone < 2000, gone);
  await s.eval((u) => studio64.engine.spawn(studio64.world.area().objects.find((r) => r.uid === u)), cityUid);
  await s.wait(1200);
  t.check('putting it back brings the collision back', (await s.eval(() => studio64.engine.json('studio_debug_counts').surfaces)) > 10000);

  // ---- persistence ----------------------------------------------------------------------------------------
  const count = info.records;
  await s.reload();
  await s.goCustom(id);
  await playMode();
  await s.wait(1500);
  const after = await s.eval(() => ({ records: (studio64.world.area().objects || []).length, surfaces: studio64.engine.json('studio_debug_counts').surfaces, sky: studio64.engine.M._studio_sky_active(), song: !!studio64.world.settings().m64Song, npcs: Object.keys(studio64.storyUI?.story?.npcs || {}).length }));
  t.check('after a reload: every record is there', after.records === count, { after, count });
  t.check('after a reload: the city stands (collision)', after.surfaces > 10000, after);
  t.check('after a reload: sky, music and texts', after.sky === 1 && after.song && after.npcs >= 10, after);
  await s.shot('after_reload');
});
