// Katana Mario and the katana fighters (from the Shoggoth World hack's maid cafe): the Shoggoth library
// tab, the Legendary Blade (B at it: the pull, the how-to card), the three-cut combo, the spin, the dash
// (its cuts land at the click), the lunge, frame-exact with the game frozen and stepped; a Goomba cut down,
// a fighter defeated (look from the inspector), a duel lost and a duel won (its star, the story event),
// the game rule (one weapon at a time), reload, the project file and the standalone player.
// @tags objects gameplay
// @timeout 1200
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { suite, URL_BASE, OUT } from '../lib/harness.mjs';
import { zipRead } from '../../server/zip.js';

await suite('katana', async (t) => {
  const s = await t.open({ level: 9 });
  const levelId = await s.newLevel('flat', 'Katana dojo');
  await s.eval(() => {
    window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; });
    window.__ev = []; window.addEventListener('studio:katana', (e) => window.__ev.push({ name: e.detail.name, kind: e.detail.kind, result: e.detail.result, uid: e.detail.uid }));
    window.__obj = []; window.addEventListener('studio:object', (e) => window.__obj.push({ uid: e.detail.uid, event: e.detail.event }));
  });
  const frames = async (n) => {
    const f0 = await s.eval(() => window.__fc);
    await s.page.waitForFunction(([a, b]) => window.__fc >= a + b, [f0, n], { timeout: 180000, polling: 30 });
  };
  const kt = () => s.eval(() => studio64.engine.json('studio_katana_state_json'));
  const objs = () => s.eval(() => studio64.engine.objects());
  const alive = async (uid) => (await objs()).some((o) => o.uid === uid);
  // frame-exact: the game frozen (frame advance), stepped n frames at a time
  const freeze = (on) => s.eval((v) => studio64.engine.M._studio_debug_speed(v ? 1 : 0, 1), on);
  const step = async (n) => { const f0 = await s.eval(() => window.__fc); await s.eval((k) => studio64.engine.M._studio_debug_step(k), n); await s.page.waitForFunction(([a, b]) => window.__fc >= a + b, [f0, n], { timeout: 60000, polling: 30 }); };
  const press = async (key, held = 2) => { await s.page.keyboard.down(key); await step(held); await s.page.keyboard.up(key); await step(1); };
  const place = (entry, x, y, z, bparams = 0, yaw = 0, extra = {}) => s.eval(([e, p, bp, yw, ex]) => {
    const st = studio64.objects.store;
    const rec = { uid: 1 + Math.floor(Math.random() * 0x7efffffe), entry: e, x: p[0], y: p[1], z: p[2], yaw: yw, pitch: 0, roll: 0, bparams: bp, ...ex };
    st.records().push(rec);
    st.commit({ type: 'add', summary: `Placed ${e}`, records: [rec] });
    return { uid: rec.uid, slot: studio64.engine.spawn(rec) };
  }, [entry, [x, y, z], bparams, yaw, extra]);
  const floorAt = (x, z) => s.eval(([a, b]) => studio64.engine.floor(a, 3000, b), [x, z]);
  const marioAction = async () => (await kt()).action;

  // ---- the library: the Shoggoth tab has the blade, the fighter and the duel ----
  await s.build();
  await s.viewMario(1400, -0.8);
  await s.page.click('.lib-tab[data-lib=objects]');
  await s.wait(200);
  const chip = s.page.locator('#obj-cats .chip, .chip', { hasText: 'Shoggoth' }).first();
  t.must('the library has a Shoggoth category', (await chip.count()) > 0);
  await chip.click();
  await s.wait(200);
  const names = await s.eval(() => [...document.querySelectorAll('#obj-grid .obj .obj-name')].map((n) => n.textContent));
  for (const n of ['Legendary Blade', 'Katana fighter', 'Katana duel']) t.check(`it lists "${n}"`, names.includes(n), names);
  await s.shot('library');

  // the blade, placed with the mouse
  await s.page.locator('#obj-grid .obj', { hasText: 'Legendary Blade' }).first().click();
  await s.wait(300);
  const gp = await s.groundPoint({ kind: null });
  t.must('a ground point to place on', !!gp);
  const bx = await s.box();
  await s.page.mouse.move(bx.x + gp.x, bx.y + gp.y);
  await s.wait(300);
  await s.clickAt(gp.x, gp.y);
  await s.settle(600);
  await s.key('Escape');
  const blade = (await s.records()).find((r) => r.entry === 'kt:blade');
  t.must('the blade is a saved record', !!blade);

  // ---- play: B at the blade pulls it out ----
  await s.play();
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y, z - 120, 0), [blade.x, blade.y, blade.z]);
  await frames(12);
  let st = await kt();
  t.eq('no katana before the pull', st.has, 0);
  t.eq('the prompt "B  Pull the legendary blade" shows', st.prompt, 1);
  await frames(4);
  t.check('the page shows the prompt', await s.eval(() => !!document.querySelector('.kt-prompt:not([hidden])')));
  await s.shot('prompt');
  await freeze(true);
  await press('j');
  st = await kt();
  t.eq('B at the blade: the pull starts', st.action, 'pull');
  t.eq('the pull camera', st.camMode, 1);
  await step(30);
  const gap = (await kt()).pullGap;
  t.check('his right fist grips the hilt', gap >= 0 && gap < 60, { gap });
  await s.shot('pulling');
  await step(60);
  st = await kt();
  t.eq('out it comes: Mario has the katana', st.has, 1);
  t.eq('the pull is over', st.pullDone, 1);
  await freeze(false);
  await frames(6);
  t.check('the how-to card shows the keys', await s.eval(() => !!document.querySelector('.kt-howto')));
  t.eq('the blade is drawn in his right fist', (await kt()).drawn, 1);
  await s.shot('pulled');

  // ---- the combo: B, B, B (frame-exact) ----
  const m0 = await s.mario();
  const ground = { x: m0.x, y: m0.y, z: m0.z };
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y, z, 0), [ground.x, ground.y, ground.z + 600]);
  await frames(15);
  await freeze(true);
  const sw0 = (await kt()).swings;
  const cuts = new Set();
  let trails = 0;
  await s.page.keyboard.down('j'); await step(1); await s.page.keyboard.up('j');
  for (let i = 0; i < 70; i++) {
    const k = await kt();
    if (k.action === 'slash') cuts.add(k.cut);
    trails = Math.max(trails, k.trails);
    if (i === 4 || i === 16) { await s.page.keyboard.down('j'); await step(1); await s.page.keyboard.up('j'); } else await step(1);
    if (i === 6) await s.shot('cut-1');
  }
  st = await kt();
  t.check('the three cuts follow each other (B during a cut chains the next)', cuts.has(0) && cuts.has(1) && cuts.has(2), [...cuts]);
  t.eq('three swings', st.swings - sw0, 3);
  t.check('each cut leaves a crescent', trails >= 1, { trails });
  t.check('his arms are posed (the weight is on)', st.weight > 0.5, st.weight);

  // ---- the spin: B in the air ----
  await s.page.keyboard.down(' '); await step(3); await s.page.keyboard.up(' ');
  await step(6);
  await press('j', 1);
  t.eq('B in the air: the spin slash', await marioAction(), 'spin');
  const spinSw = (await kt()).swings;
  await step(40);
  await s.page.keyboard.down(' '); await step(3); await s.page.keyboard.up(' ');
  await step(4);
  // (once per jump: a second B in the same jump does nothing)
  await press('j', 1);
  const again = await marioAction();
  await step(6);
  await press('j', 1);
  t.check('one spin per jump', (await kt()).swings - spinSw <= 1 && again === 'spin', { again });
  await step(60);

  // ---- the dash: Z + B; the cuts land at the click ----
  const d0 = await s.mario();
  await s.page.keyboard.down('Shift');
  await step(2);
  await press('j', 1);
  await s.page.keyboard.up('Shift');
  t.eq('Z + B: the dash slash', await marioAction(), 'dash');
  await step(14);
  const d1 = await s.mario();
  t.check('he is through in six frames (~650 units)', Math.hypot(d1.x - d0.x, d1.z - d0.z) > 400, { moved: Math.hypot(d1.x - d0.x, d1.z - d0.z) });
  await step(30);

  // ---- the lunge: running B ----
  await freeze(false);
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y, z, 0), [ground.x, ground.y, ground.z - 600]);
  await frames(10);
  await s.page.keyboard.down('w');
  await frames(25);
  await freeze(true);
  await press('j', 1);
  await s.page.keyboard.up('w');
  st = await kt();
  t.check('running B: the lunge (cut 4)', st.action === 'slash' && st.cut === 3, st);
  await step(30);
  await freeze(false);

  // ---- a Goomba: one cut ----
  const gz = ground.z + 1600;
  const gy = await floorAt(ground.x, gz);
  const goomba = await place('goomba', ground.x, gy + 5, gz, 0, 0x8000);
  await frames(10);
  const g = (await objs()).find((o) => o.uid === goomba.uid);
  t.must('the goomba spawned', !!g);
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y, z, 0), [g.x, gy, g.z - 160]);
  await frames(2);
  await freeze(true);
  const hits0 = (await kt()).objHits;
  await press('j', 1);
  await step(12);
  st = await kt();
  t.check('the cut hits the goomba', st.objHits > hits0 && st.lastKinds.includes('attack'), st);
  await freeze(false);
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) { await frames(4); gone = !(await alive(goomba.uid)); }
  t.check('the goomba is defeated', gone);
  t.check('the cut reports "is hit" to the story', await s.eval((u) => window.__obj.some((e) => e.uid === u && e.event === 'hit'), goomba.uid));
  await s.shot('goomba');

  // ---- a katana fighter: Luigi (look from the inspector), defeated ----
  const fz = ground.z + 2400;
  const fy = await floorAt(ground.x, fz);
  const fighter = await place('kt:fighter', ground.x, fy + 5, fz, 0x00010000, 0x8000);
  await s.build();
  await s.eval((slot) => studio64.editor.select(slot), fighter.slot);
  await s.wait(300);
  const looks = await s.eval(() => [...document.querySelectorAll('#inspector select option')].map((o) => o.textContent));
  t.check('the inspector picks the look', ['Luigi', 'Peach', 'Yoshi', 'Wario', 'Waluigi'].every((l) => looks.includes(l)), looks);
  await s.shot('fighter-inspector');
  await s.play();
  await s.eval(() => studio64.engine.M._studio_katana_debug(5));   // (no parries: every cut lands)
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y, z, 0), [ground.x, fy, fz - 700]);
  let fs0 = null;
  for (let i = 0; i < 40; i++) {
    await frames(5);
    fs0 = (await kt()).duel.fighters.find((f) => f.uid === fighter.uid);
    if (fs0?.drawn) break;
  }
  t.check('Luigi notices Mario and draws his katana', !!fs0?.drawn, fs0);
  await s.shot('fighter-drawn');
  let hurt = false;
  let down = false;
  for (let round = 0; round < 30 && !down; round++) {
    const f = (await kt()).duel.fighters.find((x) => x.uid === fighter.uid);
    if (!f || f.health <= 0) { down = true; break; }
    hurt = hurt || (await s.mario()).health < 8;
    await s.eval(() => studio64.engine.heal());
    const yaw = await s.eval(([fx2, fz2, mx, mz]) => Math.round(Math.atan2(fx2 - mx, fz2 - mz) / (2 * Math.PI) * 65536) & 0xffff, [f.x, f.z, f.x, f.z - 170]);
    await s.eval(([x, y, z, yw]) => studio64.engine.teleport(x, y, z, yw), [f.x, f.y, f.z - 170, yaw]);
    await frames(1);
    await s.page.keyboard.down('j'); await frames(2); await s.page.keyboard.up('j');
    await frames(20);
  }
  for (let i = 0; i < 30 && !down; i++) { await frames(4); down = !(await kt()).duel.fighters.some((x) => x.uid === fighter.uid && x.health > 0); }
  t.check('the fighter is defeated by cuts', down);
  let fgone = false;
  for (let i = 0; i < 40 && !fgone; i++) { await frames(4); fgone = !(await alive(fighter.uid)); }
  t.check('he goes "NANI?!" and poofs', fgone && (await kt()).words[0] >= 1, (await kt()).words);
  t.check('the fighter report: fighter_down', await s.eval((u) => window.__ev.some((e) => e.name === 'fighter_down' && e.uid === u), fighter.uid));
  await s.eval(() => studio64.engine.M._studio_katana_debug(6));
  await s.shot('fighter-down');

  // ---- the duel: lost ----
  await s.eval(() => studio64.engine.heal());
  const dz = Math.max(ground.z - 1900, -2400);   // (well inside the flat level: the fight spreads 1100 round it)
  const dy = await floorAt(ground.x, dz);
  const duel = await place('kt:duel', ground.x, dy, dz, 0, 0, { star: { name: 'Katana champion' }, name: 'Katana duel' });
  await frames(10);
  st = await kt();
  t.eq('the duel stands with its six fighters', st.duel.fighters.filter((f) => f.duel).length, 6);
  t.eq('they party', st.duel.phase, 'party');
  await s.shot('duel-party');
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y, z, 0x8000), [ground.x, dy, dz + 500]);
  let phase = '';
  for (let i = 0; i < 120 && !['blade', 'fight_start', 'fight'].includes(phase); i++) {
    await frames(4);
    phase = (await kt()).duel.phase;
    // (the Mario cosplayer's speech: A turns the pages)
    if (phase === 'challenge' && i % 3 === 0) { await s.page.keyboard.down(' '); await frames(2); await s.page.keyboard.up(' '); }
    if (i === 20) await s.shot('duel-challenge');
  }
  t.check('Mario comes near: the challenge, then the fight (he has a katana already)', ['fight_start', 'fight'].includes(phase), phase);
  t.check('the duel reports "start" to the story', await s.eval((u) => window.__ev.some((e) => e.kind === 'katana_duel' && e.result === 'start' && e.uid === u), duel.uid));
  for (let i = 0; i < 60 && phase !== 'fight'; i++) { await frames(4); phase = (await kt()).duel.phase; }
  t.eq('the battle theme starts', (await kt()).duel.music, 1);
  t.check('the cosplayers-left counter shows', await s.eval(() => !!document.querySelector('.kt-count:not([hidden])')));
  t.check('they say their lines (bubbles)', (await kt()).duel.lines >= 2);
  await s.shot('duel-fight');
  await s.eval(() => studio64.engine.M._studio_katana_debug(2));     // (Mario nearly out of health: the next cut ends it)
  for (let i = 0; i < 150 && phase !== 'lost'; i++) { await frames(4); phase = (await kt()).duel.phase; if (i % 30 === 29 && phase === 'fight') await s.eval(() => studio64.engine.M._studio_katana_debug(2)); }
  t.eq('his health runs out: the duel is lost', phase, 'lost');
  t.check('Mario does not die (he gets up for a rematch)', (await s.mario()).health >= 6 && !(await s.crashed()));
  t.check('the story hears "lost"', await s.eval((u) => window.__ev.some((e) => e.result === 'lost' && e.uid === u), duel.uid));
  await s.shot('duel-lost');

  // ---- the rematch: won ----
  await frames(100);
  const boss = (await kt()).duel.fighters.find((f) => f.duel && f.look === 0);
  t.must('the Mario cosplayer is there for the rematch', !!boss);
  await s.eval(([x, y, z]) => studio64.engine.teleport(x, y, z, 0x8000), [boss.x, boss.y, boss.z + 300]);
  let seen = '';
  for (let i = 0; i < 160 && phase !== 'fight'; i++) {
    await frames(4);
    const k2 = await kt();
    phase = k2.duel.phase;
    const line = `${phase} running=${k2.duel.running} level=${(await s.state()).level} health=${(await s.mario())?.health}`;
    if (line !== seen) { t.log(line); seen = line; }
    if (phase === 'challenge' && i % 3 === 0) { await s.page.keyboard.down(' '); await frames(2); await s.page.keyboard.up(' '); }
  }
  t.eq('round two', phase, 'fight');
  await s.eval(() => { studio64.engine.M._studio_katana_debug(1); studio64.engine.M._studio_katana_debug(3); studio64.engine.M._studio_katana_debug(5); });
  const waves = new Set();
  for (let round = 0; round < 120 && !['finale', 'won'].includes(phase); round++) {
    st = await kt();
    phase = st.duel.phase;
    waves.add(st.duel.wave);
    const waveOf = { 1: 0, 5: 0, 4: 0, 2: 1, 3: 1, 0: 2 };       // (Luigi, Yoshi, Peach; Wario, Waluigi; the Mario cosplayer)
    const target = st.duel.fighters.find((f) => f.duel && f.health > 0 && waveOf[f.look] === st.duel.wave);
    if (!target) { await frames(6); continue; }
    await s.eval(() => { studio64.engine.heal(); studio64.engine.M._studio_katana_debug(1); });
    await s.eval(([x, y, z]) => studio64.engine.teleport(x, y, z, 0), [target.x, target.y, target.z - 170]);
    await frames(1);
    await s.page.keyboard.down('j'); await frames(2); await s.page.keyboard.up('j');
    await frames(18);
  }
  t.check('three waves', waves.has(0) && waves.has(1) && waves.has(2), [...waves]);
  for (let i = 0; i < 200 && phase !== 'won'; i++) {
    await frames(4);
    st = await kt();
    phase = st.duel.phase;
    if (i === 3) { t.check('the finale: slow motion', st.slowmo > 0 || st.duel.phase === 'finale', st.slowmo); await s.shot('duel-finale'); }
    // (his last words: A turns the pages)
    if (phase === 'finale' && i % 3 === 0) { await s.page.keyboard.down(' '); await frames(2); await s.page.keyboard.up(' '); }
  }
  t.eq('the duel is won', phase, 'won');
  t.eq('the star comes out of the Mario cosplayer', (await kt()).duel.starGiven, 1);
  t.check('the story hears "won"', await s.eval((u) => window.__ev.some((e) => e.result === 'won' && e.uid === u), duel.uid));
  t.check('story condition "a katana duel is won"', await s.eval((u) => studio64.storyRuntime.check([{ type: 'katana_duel_won', uid: u, value: true }]), duel.uid));
  t.check('the duel\'s star is a star of the level', await s.eval(() => studio64.world.stars().some((x) => x.name === 'Katana champion')));
  await s.eval(() => studio64.engine.M._studio_katana_debug(4));
  await s.eval(() => studio64.engine.M._studio_katana_debug(6));
  await s.shot('duel-won');

  // ---- the story: take / give, the condition ----
  await s.eval(() => studio64.storyRuntime.runAction({ type: 'katana', on: 'take' }, null));
  await frames(3);
  t.eq('story: "take the katana"', (await kt()).has, 0);
  t.check('story condition "Mario has the katana" is false', await s.eval(() => studio64.storyRuntime.check([{ type: 'katana', value: true }])) === false);
  await s.eval(() => studio64.storyRuntime.runAction({ type: 'katana', on: 'give' }, null));
  await frames(3);
  t.eq('story: "give the katana"', (await kt()).has, 1);
  await s.eval(() => studio64.storyRuntime.runAction({ type: 'shotgun', on: 'give' }, null));
  await frames(3);
  t.eq('one weapon at a time: the shotgun takes the katana\'s place', (await kt()).has, 0);
  await s.eval(() => studio64.storyRuntime.runAction({ type: 'katana', on: 'give' }, null));
  await frames(3);
  t.eq('... and the katana the shotgun\'s', await s.eval(() => studio64.engine.json('studio_shotgun_state_json').has), 0);
  await s.eval(() => studio64.storyRuntime.runAction({ type: 'katana', on: 'take' }, null));

  // ---- the game rule: Game rules → Items → "Mario starts with the katana" ----
  await s.key('p');
  await s.page.waitForSelector('.om-dialog.gr', { timeout: 5000 }).catch(() => {});
  if (!(await s.eval(() => !!document.querySelector('.om-dialog.gr')))) await s.eval(() => studio64.objects.rules.open());
  await s.page.click('.gr-tab[data-s=items]');
  await s.wait(200);
  await s.page.locator('.gr-check', { hasText: 'shotgun' }).locator('input').check();
  await s.wait(200);
  await s.page.locator('.gr-check', { hasText: 'katana' }).locator('input').check();
  await s.wait(200);
  await s.shot('rules-items');
  const base = await s.eval(() => studio64.objects.rules.rules().base);
  t.eq('the katana rule is saved', base.katana, true);
  t.check('and it turned the shotgun rule off (one weapon)', !base.shotgun, base);
  await frames(5);
  t.eq('switching the rule on gives him the katana now', (await kt()).has, 1);
  await s.page.keyboard.press('Escape');
  await s.goLevel(9);
  await s.arrive(9);
  await frames(20);
  st = await kt();
  t.eq('with the rule he starts every level with it', st.has, 1);
  t.eq('(by the rule)', st.byRule, 1);
  let bobSwings = 0;
  for (let i = 0; i < 8 && !bobSwings; i++) {
    await s.page.keyboard.down('j'); await frames(2); await s.page.keyboard.up('j');
    await frames(20);
    bobSwings = (await kt()).swings;
  }
  t.check('cutting in Bob-omb Battlefield works', bobSwings >= 1);
  await s.shot('bob-katana');

  // ---- reload: the rule, the blade, the duel and its star are in the project ----
  await s.reload();
  await s.eval(() => { window.__fc = 0; studio64.engine.on('frame', () => { window.__fc++; }); });
  await s.goCustom(levelId);
  await s.arrive();
  await frames(20);
  t.eq('after a reload the rule still gives him the katana', (await kt()).has, 1);
  const recs = await s.records();
  t.check('the blade survived the reload', recs.some((r) => r.entry === 'kt:blade'));
  t.check('the duel and its star survived the reload', recs.some((r) => r.entry === 'kt:duel' && r.star?.name === 'Katana champion'));
  const ex = await s.export();
  t.eq('the project file has the rule', ex.areas['@game'].rules.base.katana, true);
  t.check('no crash', !(await s.crashed()));

  // ---- the standalone player: the katana is in the game ----
  const buf = Buffer.from(await (await fetch(`${URL_BASE}/api/projects/${s.projectId}/standalone.zip`)).arrayBuffer());
  const files = zipRead(buf);
  for (const need of ['js/katana.js', 'css/katana.css', 'data/katana.json']) t.check(`the playable zip has ${need}`, files.has(need));
  const dir = path.join(OUT, t.slug, 'player');
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [n, d] of files) { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), d); }
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p);
    if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  }).listen(0);
  const page = await s.page.context().newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  await page.waitForSelector('#play-btn:not([disabled])', { timeout: 180000 });
  await page.click('#play-btn');
  await page.waitForFunction(() => { try { return window.studioPlayer.engine.state().mario && window.studioPlayer.engine.json('studio_katana_state_json').has === 1; } catch { return false; } }, null, { timeout: 90000 }).catch(() => {});
  const pst = await page.evaluate(() => { try { return window.studioPlayer.engine.json('studio_katana_state_json'); } catch { return null; } });
  t.eq('in the player Mario starts with the katana', pst?.has, 1);
  for (let i = 0; i < 8; i++) {
    await page.keyboard.down('KeyJ');
    await page.waitForTimeout(150);
    await page.keyboard.up('KeyJ');
    if (await page.waitForFunction(() => window.studioPlayer.engine.json('studio_katana_state_json').swings >= 1, null, { timeout: 4000 }).then(() => true).catch(() => false)) break;
  }
  t.check('and cuts with it', (await page.evaluate(() => window.studioPlayer.engine.json('studio_katana_state_json').swings)) >= 1);
  await page.screenshot({ path: path.join(OUT, t.slug, 'player.png') });
  t.check('no errors in the player', errors.length === 0, errors);
  await page.close();
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
