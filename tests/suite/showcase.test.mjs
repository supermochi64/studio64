// Every feature in one project, played: the Showcase hack (tests/lib/showcase.mjs: sub-area
// behind a one-star door, painting with its own picture to a second level, story with NPC
// dialog, events and cutscenes, a custom enemy on a path guarding a hidden star, an elevator,
// imported crates, a recoloured texture, a sky, Mario's colours, game rules with a level
// override, a composed song) is built in the studio, checked, exported as .s64hack, imported
// again (same project), and played in the player: opening cutscene skipped with Start, Toad
// talks and gives coins, the star door refuses, the elevator, a star, the door opens, the
// hall's cutscene, the painting, the level rules, the guard patrolling and its hidden star.
// @tags projects export story world objects
// @timeout 1500
import { suite, api, URL_BASE } from '../lib/harness.mjs';
import { zipRead } from '../../server/zip.js';
import { buildShowcase } from '../lib/showcase.mjs';

await suite('showcase', async (t) => {
  const s = await t.open({ level: 9 });
  const sc = await buildShowcase(s, { log: (...a) => t.log(...a) });
  t.check('a texture was recoloured', sc.tex.length > 0, sc.tex);
  t.check('three crates were placed', sc.crates.uids.length === 3, sc.crates);

  // ---- the level check over the whole project ----
  const check = await s.eval(() => { const c = studio64.testing.runCheck(); return { counts: c.counts, errors: c.problems.filter((p) => p.severity === 'error').map((p) => `${p.level}: ${p.title} ${p.detail || ''}`) }; });
  t.eq('the level check finds no errors', check.errors, []);

  // ---- export and import: the same project comes back ----
  await s.wait(1500);
  const orig = await s.export();
  const buf = Buffer.from(await (await fetch(`${URL_BASE}/api/projects/${s.projectId}/export.s64hack`)).arrayBuffer());
  const z = zipRead(buf);
  t.check('the .s64hack has its project and the model file', z.has('project.json') && [...z.keys()].some((k) => k.startsWith('files/assets/')));
  const imp = await fetch(`${URL_BASE}/api/hub/import`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: buf }).then((r) => r.json());
  t.must('the file imports', !!imp.id, imp);
  const back = await api(`/api/projects/${imp.id}/export`);
  const strip = (p) => JSON.stringify(p ?? null).split(s.projectId).join('@').split(imp.id).join('@');
  for (const k of ['areas', 'levels', 'story', 'world', 'assets', 'audio', 'boot']) t.check(`round trip keeps ${k}`, strip(orig[k]) === strip(back[k]), { k });
  const files = await fetch(`${URL_BASE}/api/projects/${imp.id}/assets`).then((r) => r.json());
  t.check('the imported model file is there', !!files?.models?.length);

  // ---- the standalone player's data ----
  const play = await api(`/api/projects/${imp.id}/play.json`);
  t.check('play.json has the story, world, rules, assets and songs', !!(play.story?.events?.length && play.patch?.world?.start && play.patch?.areas?.['@game'] && play.assets?.models?.length && play.audio?.songs?.length), Object.keys(play));

  // ---- play it in the player ----
  const browser = await t.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 760 } })).newPage();
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); t.log('player pageerror', e.message); });
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|fonts\./.test(m.text())) { errors.push(m.text()); t.log('player console', m.text().slice(0, 200)); } });
  await page.goto(`${URL_BASE}/play.html?p=${imp.id}`);
  await page.waitForSelector('#play-btn:not([disabled])', { timeout: 240000 });
  const P = (fn, arg) => page.evaluate(fn, arg);
  const until = (fn, arg, ms = 30000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }).then(() => true, () => false);
  await P(() => { window.__fc = 0; studioPlayer.engine.on('frame', () => { window.__fc++; }); });
  const frames = async (n) => { const f0 = await P(() => window.__fc); await page.waitForFunction(([a, b]) => window.__fc >= a + b, [f0, n], { timeout: 240000, polling: 50 }); };
  const key = () => P(() => studioPlayer.engine.areaKey());
  const at = (k, ms = 90000) => until((kk) => { const e = studioPlayer.engine; try { return e.areaKey() === kk && !e.inIntro && !!e.state().mario; } catch { return false; } }, k, ms);
  const press = async (k, hold = 300) => { await page.keyboard.down(k); await page.waitForTimeout(hold); await page.keyboard.up(k); await page.waitForTimeout(250); };
  const valley = `c:${sc.valley}`;

  await page.screenshot({ path: `${await s.shot('x').then((f) => f.replace(/x\.png$/, ''))}player_title.png` });
  await page.click('#play-btn');
  t.check('the hack starts in the valley', await at(valley), await key());
  // the opening cutscene, skipped with Start
  const cutOn = await until(() => !!studioPlayer.storyRuntime?.cut, null, 30000);
  t.check('the opening cutscene plays', cutOn);
  for (let i = 0; i < 4 && await P(() => !!studioPlayer.storyRuntime.cut); i++) await press('Enter', 350);
  t.check('Start skips it', await until(() => !studioPlayer.storyRuntime.cut, null, 20000));
  await frames(20);

  // the assets are on
  const looks = await P(() => ({ sky: Object.keys(studioPlayer.assets?.meta?.skies || {}).length, mario: studioPlayer.assets?.meta?.mario?.preset, tex: Object.keys(studioPlayer.assets?.meta?.textures || {}).length, crates: studioPlayer.engine.objects().filter((o) => o.bhv === 'bhvStudioModel').length }));
  t.check('sky, Mario colours, texture and crates are applied in the player', looks.sky > 0 && !!looks.mario && looks.tex > 0 && looks.crates >= 3, looks);
  t.eq('the game rules: 1-up every 50 coins', await P(() => window.studio64Objects?.rules?.().coinLife), 50);

  // Toad talks (walk up to him, B) and gives 10 coins
  const coins0 = await P(() => studioPlayer.engine.state().mario.coins);
  let talked = false;
  for (let i = 0; i < 6 && !talked; i++) {
    // walk up to him and press B
    await P((tp) => { const e = studioPlayer.engine; const y = e.floor(tp.x, tp.y + 600, tp.z - 300); e.teleport(tp.x, (y > -10000 ? y : tp.y) + 10, tp.z - 300, 0); }, sc.v.toadAt);
    await frames(8);
    await P(() => studioPlayer.engine.M._studio_walk(0, 14));
    await frames(16);
    // B while still walking is a punch: wait until he stands
    await until(() => studioPlayer.engine.state().mario.action === '0x0C400201', null, 15000);
    await press('KeyJ', 350);
    // (a slow machine opens the box late: teleporting him again would break the talk)
    talked = await until(() => !!studioPlayer.engine.M._studio_story_dialog_busy() || !!studioPlayer.storyRuntime.lastTalk, null, 20000);
  }
  t.check('Mario talks to Toad (B)', talked, await P(() => ({ m: studioPlayer.engine.state().mario, log: studioPlayer.storyRuntime.log.slice(-6).map((l) => l.text), cut: !!studioPlayer.storyRuntime.cut, running: studioPlayer.storyRuntime.running?.ev?.name })));
  if (!talked) await page.screenshot({ path: `${await s.shot('z').then((f) => f.replace(/z\.png$/, ''))}player_talk.png` });
  // A through both pages (a busy machine draws few frames: keep pressing while the box is open)
  for (let i = 0; i < 40; i++) {
    if (await P((c0) => studioPlayer.engine.state().mario.coins >= c0 + 10, coins0)) break;
    if (await P(() => !!studioPlayer.engine.M._studio_story_dialog_busy())) await press('Space', 300); else await frames(10);
  }
  t.check('Toad gives 10 coins after talking', await until((c0) => studioPlayer.engine.state().mario.coins >= c0 + 10, coins0, 30000), await P(() => ({ log: studioPlayer.storyRuntime.log.slice(-6).map((l) => l.text), busy: studioPlayer.engine.M._studio_story_dialog_busy(), m: studioPlayer.engine.state().mario })));
  t.check('the "met Toad" flag is set', await P((id) => studioPlayer.storyRuntime.getVar(id) === true, sc.v.met));

  // the guard patrols its path
  const g0 = await P((u) => studioPlayer.engine.objects().find((o) => o.uid === u), sc.v.guard);
  await frames(60);
  const g1 = await P((u) => studioPlayer.engine.objects().find((o) => o.uid === u), sc.v.guard);
  t.check('the custom enemy walks its patrol path', g0 && g1 && Math.hypot(g1.x - g0.x, g1.z - g0.z) > 60, { g0, g1 });
  t.check('its treasure star is hidden until it is beaten', await P((u) => !studioPlayer.engine.objects().some((o) => o.uid === u), sc.v.hidden));

  // the star door refuses without a star
  const walkInto = async (d, n = 50) => {
    const yaw = (d.yaw | 0) & 0xffff, a = (yaw / 32768) * Math.PI;
    await P(([x, y, z, yy]) => studioPlayer.engine.teleport(x, y + 20, z, yy), [d.x + Math.sin(a) * 300, d.y, d.z + Math.cos(a) * 300, (yaw + 0x8000) & 0xffff]);
    await frames(6);
    await P((yy) => studioPlayer.engine.M._studio_walk(yy, 60), (yaw + 0x8000) & 0xffff);
    await frames(n);
  };
  await walkInto(sc.doors.dinAt);
  t.check('the one-star door stays shut with no stars', (await key()) === valley, await key());
  for (let i = 0; i < 10 && await P(() => !!studioPlayer.engine.M._studio_story_dialog_busy()); i++) await press('Space', 300);
  await frames(20);

  // the elevator lifts Mario
  await P((l) => studioPlayer.engine.teleport(l.x, l.y + 120, l.z, 0), sc.v.liftAt);
  const lifted = await until((y0) => studioPlayer.engine.state().mario.y > y0 + 300, sc.v.liftAt.y, 60000);
  t.check('the elevator lifts Mario (motion "while standing")', lifted, await P(() => studioPlayer.engine.state().mario));
  // the ledge star (exits the level and comes back to the hub)
  const ledge = await P((u) => studioPlayer.engine.patch.areas[`c:${studioPlayer.engine.customLevel}`].objects.find((r) => r.uid === u), sc.v.ledgeStar);
  await P((r) => studioPlayer.engine.teleport(r.x, r.y - 100, r.z, 0), ledge);
  const got = await until(() => studioPlayer.world.collectedTotal() >= 1, null, 60000);
  t.check('the Sky Lift star is collected', got);
  // the star dance and the course complete screen: A until Mario stands in the hub again
  let home = false;
  for (let i = 0; i < 80 && !home; i++) {
    home = await P((v) => { const e = studioPlayer.engine; try { const m = e.state().mario; return e.areaKey() === v && !e.inIntro && !!m && !/^0x0000130|^0x00001909/.test(m.action || ''); } catch { return false; } }, valley);
    if (!home) await press('Space', 250);
  }
  t.check('back in the valley (the hub) after the star', home, await key());
  const counted = await until((id) => studioPlayer.storyRuntime.getVar(id) === 1, sc.v.stars, 20000);
  t.check('the story counted the star', counted, await P(() => ({ log: studioPlayer.storyRuntime.log.slice(-12).map((l) => l.text), running: studioPlayer.storyRuntime.running?.ev?.name, queue: studioPlayer.storyRuntime.queue.map((q) => q.ev.name) })));

  // now the door opens: the Star Hall with its cutscene and its song
  await frames(30);
  await walkInto(sc.doors.dinAt, 40);
  const hallKey = `${valley}:${sc.hallIndex}`;
  const inHall = await at(hallKey, 90000);
  t.check('with one star the door leads into the Star Hall (sub-area)', inHall, await key());
  if (inHall) {
    t.check('the hall\'s cutscene plays ("enters an area" trigger)', await until(() => !!studioPlayer.storyRuntime.cut, null, 30000));
    for (let i = 0; i < 4 && await P(() => !!studioPlayer.storyRuntime.cut); i++) await press('Enter', 350);
    t.check('it is skipped with Start', await until(() => !studioPlayer.storyRuntime.cut, null, 20000));
    for (let i = 0; i < 10 && await P(() => !!studioPlayer.engine.M._studio_story_dialog_busy()); i++) await press('Space', 300);
    t.eq('the hall has its own song', await P(() => studioPlayer.world.settings().song), sc.song);
    const blink = await P((u) => studioPlayer.engine.objects().some((o) => o.uid === u), sc.hall.steps[0]);
    t.check('the blinking steps are there', blink);
    // the painting: jump in
    const p = await P((u) => studioPlayer.engine.objects().find((o) => o.uid === u), sc.hall.painting);
    t.check('the painting hangs with its own picture', p && (p.bparams >>> 24) >= 0x40, p);
    await P(([x, y, z]) => studioPlayer.engine.teleport(x, y, z + 40, 0x8000), [p.x, p.y + 30, p.z]);
    const inPeaks = await at(`c:${sc.peaks}`, 90000);
    t.check('jumping into the painting leads to Painted Peaks', inPeaks, await key());
    if (inPeaks) t.eq('Painted Peaks has its own rules (low gravity)', await P(() => window.studio64Objects.rules().gravity), 0.6);
  }

  // the guard's treasure: the event gives the hidden star (fired like the engine does)
  await P((id) => studioPlayer.worldFlow.goArea({ custom: id, area: 1 }), sc.valley);
  if (await at(valley, 90000)) {
    await P((u) => studioPlayer.storyRuntime.fire('object_event', { uid: u, event: 'defeated' }), sc.v.guard);
    t.check('beating the guard shows its star', await until((u) => studioPlayer.engine.objects().some((o) => o.uid === u), sc.v.hidden, 30000));
  }
  await page.screenshot({ path: `${await s.shot('y').then((f) => f.replace(/y\.png$/, ''))}player_end.png` });
  t.eq('no errors in the player', errors, []);
});
