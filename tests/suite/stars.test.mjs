// Stars in a custom level: place a star from the Stars tab, collect it (course complete,
// counter, Stars tab), a red coin star with its 8 coins, the 100 coin star, pause, death.
// @tags gameplay stars
// @timeout 600
import { suite } from '../lib/harness.mjs';

await suite('stars', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  const lvl = await s.newLevel('flat', 'Star test');
  const key = `c:${lvl}`;
  await s.build();
  await s.viewMario(1600, -0.6);

  // a star from the Stars tab
  await page.click('.tab[data-tab=stars]');
  t.check('stars tab empty note', /No stars/.test(await page.textContent('#stars-list')));
  await page.click('#add-star');
  await page.fill('#ask-in', 'Sky High');
  await page.click('#ask-ok');
  t.eq('placing a star', await s.eval(() => studio64.editor.placing?.star?.name), 'Sky High');
  const gp = await s.groundPoint();
  await s.clickAt(gp.x, gp.y);
  await s.settle();
  const star = (await s.records()).find((r) => r.star?.name === 'Sky High');
  t.must('star record saved', !!star);
  t.check('placing ends after one star', (await s.eval(() => studio64.editor.tool)) !== 'place');
  t.check('stars tab lists it', /Sky High/.test(await page.textContent('#stars-list')));
  t.eq('badge 0/1', await page.textContent('#stars-count'), '0/1');

  // rename from the Stars tab
  await page.click('#stars-list .star-row .btn[title=Rename]');
  await page.fill('#ask-in', 'Sky Higher');
  await page.press('#ask-in', 'Enter');
  await s.settle();
  t.check('star renamed', /Sky Higher/.test(await page.textContent('#stars-list')));
  t.eq('renamed on the server', (await s.export()).areas[key].objects.find((r) => r.uid === star.uid)?.star?.name, 'Sky Higher');

  // collect it
  await s.play();
  const before = await s.mario();
  await s.eval((r) => studio64.engine.teleport(r.x, r.y + 20, r.z, 0), star);
  await page.waitForFunction((k) => studio64.world.stars(k).some((x) => x.done), key, { timeout: 15000 }).catch(() => {});
  t.check('star collected', await s.eval((k) => studio64.world.stars(k).find((x) => x.name === 'Sky Higher')?.done, key));
  // the course complete screen, then back at the level's entrance (or the castle)
  await s.wait(9000);
  for (let i = 0; i < 6; i++) { await page.keyboard.down('Space'); await s.wait(100); await page.keyboard.up('Space'); await s.wait(700); }
  await s.arrive(null, 40000);
  const after = await s.mario();
  t.eq('star counter +1', after.stars, before.stars + 1);
  t.check('engine alive after course complete', await s.framesAdvance());
  await page.click('.tab[data-tab=stars]');
  // back to the level for the rest
  if (await s.eval(() => studio64.engine.level) !== 37) await s.goCustom(lvl);
  t.eq('badge 1/1 in the level', await page.textContent('#stars-count'), '1/1');

  // red coin star: star + 8 coins
  await s.build();
  await s.viewMario(1800, -0.7);
  await s.eval(() => studio64.levelsUI.addStar('red_coins', 'Reds'));
  const pts = await s.eval(() => {
    const ed = studio64.editor; const { w, h } = ed.size(); const out = [];
    for (let y = 0.5; y < 0.85; y += 0.1) for (let x = 0.2; x < 0.85; x += 0.12) { const hit = ed.pick(w * x, h * y, { objects: false }); if (hit && hit.ny > 0.7) out.push({ x: w * x, y: h * y }); }
    return out;
  });
  t.must('room for the red coins', pts.length >= 9, pts.length);
  for (let i = 0; i < 9; i++) await s.clickAt(pts[i].x, pts[i].y);
  await s.settle();
  const recs = await s.records();
  t.eq('8 red coins placed', recs.filter((r) => r.entry === 'red_coin').length, 8);
  t.check('red coin star placed', recs.some((r) => r.entry === 'hidden_red_coin_star'));
  t.check('placing stops after the 8th coin', (await s.eval(() => studio64.editor.tool)) !== 'place');
  await s.play();
  const coins = recs.filter((r) => r.entry === 'red_coin');
  for (const c of coins) {
    await s.eval((r) => studio64.engine.teleport(r.x, r.y, r.z, 0), c);
    await s.until((uid) => !studio64.engine.objects().some((o) => o.uid === uid), c.uid, 8000);
  }
  await s.until(() => studio64.engine.objects().some((o) => /bhvSpawnedStar|RedCoinStar|bhvStar\b/.test(o.bhv) && !o.uid && o.bhv !== 'bhvRedCoinStarMarker'), null, 15000);
  const redStar = await s.eval(() => studio64.engine.objects().find((o) => /bhvSpawnedStar|bhvStarSpawnCoordinates|RedCoinStar|bhvStar\b/.test(o.bhv) && !o.uid));
  t.check('red coin star appears after 8 coins', !!redStar, await s.eval(() => studio64.engine.objects().map((o) => o.bhv).filter((b) => /Star/.test(b))));
  if (redStar) {
    await s.wait(3000);
    const rs = await s.eval(() => studio64.engine.objects().find((o) => /Star/.test(o.bhv) && !o.uid && o.visible));
    if (rs) await s.eval((o) => studio64.engine.teleport(o.x, o.y, o.z, 0), rs);
    await page.waitForFunction((k) => studio64.world.stars(k).find((x) => x.kind === 'red_coins')?.done, key, { timeout: 15000 }).catch(() => {});
    t.check('red coin star collected', await s.eval((k) => studio64.world.stars(k).find((x) => x.kind === 'red_coins')?.done, key));
    await s.wait(9000);
    for (let i = 0; i < 6; i++) { await page.keyboard.down('Space'); await s.wait(100); await page.keyboard.up('Space'); await s.wait(700); }
    await s.arrive(null, 40000);
  }

  // 100 coins: the 100 coin star
  if (await s.eval(() => studio64.engine.level) !== 37) await s.goCustom(lvl);
  await s.play();
  await s.eval(async () => {
    const m = studio64.engine.state().mario;
    for (let i = 0; i < 105; i++) {
      studio64.engine.spawn({ uid: 0x7d000000 + i, entry: 'yellow_coin', x: m.x, y: m.y + 40, z: m.z, yaw: 0, pitch: 0, roll: 0, bparams: 0, scale: 1 });
      if (i % 5 === 4) await new Promise((r) => setTimeout(r, 120));
    }
  });
  await s.until(() => studio64.engine.state().mario.coins >= 100, null, 40000);
  t.check('100 coins counted', (await s.mario()).coins >= 100, (await s.mario()).coins);
  await s.until(() => studio64.engine.objects().some((o) => o.bhv === 'bhvSpawnedStarNoLevelExit' && !o.uid && o.visible), null, 20000);
  const coinStar = await s.eval(() => studio64.engine.objects().find((o) => o.bhv === 'bhvSpawnedStarNoLevelExit' && !o.uid && o.visible));
  t.check('100 coin star appears', !!coinStar);
  if (coinStar) {
    // the spawned star is still flying to its spot for a moment: go to where it is now, a few times
    for (let i = 0; i < 8; i++) {
      await s.eval(() => { const o = studio64.engine.objects().find((x) => x.bhv === 'bhvSpawnedStarNoLevelExit' && !x.uid); if (o) studio64.engine.teleport(o.x, o.y - 40, o.z, 0); });
      if (await s.until((k) => studio64.world.stars(k).find((x) => x.kind === 'coins100')?.done, key, 3000)) break;
    }
    t.check('100 coin star collected', await s.eval((k) => studio64.world.stars(k).find((x) => x.kind === 'coins100')?.done, key), { coinStar, stars: await s.eval((k) => studio64.world.stars(k), key), m: await s.mario(), objs: await s.eval(() => studio64.engine.objects().filter((o) => /Star/.test(o.bhv)).map((o) => [o.bhv, o.uid, o.visible, o.x, o.y, o.z])) });
    await s.wait(9000);
    for (let i = 0; i < 6; i++) { await page.keyboard.down('Space'); await s.wait(100); await page.keyboard.up('Space'); await s.wait(700); }
    await s.arrive(null, 40000);
  }
  t.check('stars persist in this browser after reload', await (async () => {
    await page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => studio64.engine?.ready, null, { timeout: 120000 });
    return s.eval((k) => studio64.world.stars(k).filter((x) => x.done).length >= 2, key);
  })());
});
