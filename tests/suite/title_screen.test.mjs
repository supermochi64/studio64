// The launch screen: the Title screen editor (logo maker, upload, backgrounds, splash screens,
// file select, live preview), saved in the project with undo, played by "Play from start" (also
// over the game's own title screen with Mario's face and over a level fly-over), the cover on
// the home card, the .s64hack round trip and the standalone player showing the same screen.
// @tags story projects
// @timeout 900
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { suite, api, URL_BASE, OUT } from '../lib/harness.mjs';
import { zipRead } from '../../server/zip.js';

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAhUlEQVR4nO2WwQ3AIAzEMg77D9U12hGqIqgT4pP4ny1IiDDGrM41xr3rtANOK4SERmXQkJgIGgoTQUOgIujimAS6LCqCLohLaC2ALoZLoEspwBvgE3AGOARdheA/oMsqbP0dfoU/VcQn8NMkTMNXF7EEvKKILeAVRPwCnk1GZEw7YBN18wA+EkDTgIE2AAAAAABJRU5ErkJggg==', 'base64');

await suite('title screen', async (t) => {
  t.allowConsole(/fonts\.g/);
  const s = await t.open({ level: 16 });
  const odir = path.join(OUT, t.slug);
  fs.mkdirSync(odir, { recursive: true });
  const shot = (name, page = s.page) => page.screenshot({ path: path.join(odir, `${name}.png`) });
  // the editor saved everything (logo render, cover, the edit)
  const settle = async () => { await s.wait(200); await s.page.waitForFunction(() => { const u = window.studio64TitleUI; return u && !u.dirty && !u.busy; }, null, { timeout: 90000 }); };

  // ---- the editor, from the Story panel's Start & end page ----------------------------------
  await s.page.keyboard.press('Escape');
  await s.eval(() => studio64.storyUI.open('start'));
  await s.page.waitForSelector('.ttl-startcard', { timeout: 10000 });
  t.check('Start & end has the launch screen card', await s.page.isVisible('.ttl-startcard'));
  await shot('story-start-card');
  await s.page.click('.ttl-startcard button');
  await s.page.waitForSelector('#title-studio:not([hidden])', { timeout: 15000 });
  t.check('the Story panel closed for the editor (or stays under it)', await s.page.isVisible('#title-studio'));
  await s.wait(1500);
  await shot('editor-logo');
  // turn it on with the switch, type a logo text, pick a style
  await s.page.click('.ttl-switch');
  const main = s.page.locator('.ttl-side input[type=text]').first();
  await main.fill('MOCHI WORLD');
  await s.page.locator('.ttl-preset', { hasText: 'Gold' }).click();
  await settle();
  let title = await api(`/api/projects/${s.projectId}/title`);
  t.check('the title is on and saved', title.on === true, title);
  t.eq('the logo text is saved', title.logo.maker.text, 'MOCHI WORLD');
  t.check('the logo maker picture was rendered and stored', /\.png$/.test(title.logo.file || ''), title.logo);
  t.check('the gold style applied', title.logo.maker.fill === 'gradient' && title.logo.maker.emblem === 'star', title.logo.maker);
  const logoRes = await fetch(`${URL_BASE}/api/projects/${s.projectId}/assets/title/${title.logo.file}`);
  t.check('the logo picture is served', logoRes.ok && /png/.test(logoRes.headers.get('content-type')));
  t.check('the logo is hi-res', title.logo.w >= 1000, { w: title.logo.w, h: title.logo.h });
  t.check('a cover still was made', /\.jpg$/.test(title.cover || ''), title.cover);
  await shot('editor-logo-gold');

  // animation and a drag in the preview move the logo
  await s.page.locator('.ttl-seg-btn', { hasText: 'Float' }).click();
  const box = await s.page.locator('.ttl-preview canvas').boundingBox();
  await s.page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await s.page.mouse.down();
  await s.page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.28, { steps: 5 });
  await s.page.mouse.up();
  await settle();
  title = await api(`/api/projects/${s.projectId}/title`);
  t.eq('the animation is saved', title.logo.anim, 'float');
  t.near('dragging moved the logo', title.logo.y, 0.28, 0.03);

  // the Title tab: gradient background, Press Start text, music
  await s.page.click('.ttl-tab[data-tab=title]');
  await s.page.locator('.ttl-bgcard.k-gradient').click();
  const press = s.page.locator('.ttl-side input[type=text]').first();
  await press.fill('PRESS START TO PLAY');
  await settle();
  await shot('editor-title');
  // splash screens
  await s.page.click('.ttl-tab[data-tab=splash]');
  await s.page.locator('.ttl-btns button', { hasText: 'Made with Studio 64' }).click();
  await s.page.locator('.ttl-btns button', { hasText: 'Text' }).click();
  await s.wait(400);
  await s.page.locator('.ttl-card').nth(1).locator('input[type=text]').first().fill('MOCHI GAMES');
  await settle();
  await shot('editor-splash');
  // the file select
  await s.page.click('.ttl-tab[data-tab=files]');
  await s.page.locator('.ttl-side input[type=text]').first().fill('PICK A SAVE');
  await settle();
  await shot('editor-files');
  title = await api(`/api/projects/${s.projectId}/title`);
  t.eq('splash screens saved', title.splashes.map((x) => x.kind), ['studio', 'text']);
  t.eq('splash text saved', title.splashes[1].text, 'MOCHI GAMES');
  t.eq('file select heading saved', title.files.heading, 'PICK A SAVE');
  t.eq('press start text saved', title.press.text, 'PRESS START TO PLAY');
  t.eq('gradient background saved', title.bg.kind, 'gradient');

  // an uploaded logo (a see-through PNG)
  await s.page.click('.ttl-tab[data-tab=logo]');
  await s.page.locator('.ttl-seg-btn', { hasText: 'Upload' }).click();
  await s.page.setInputFiles('.ttl-drop input[type=file]', { name: 'logo.png', mimeType: 'image/png', buffer: PNG_1x1 });
  await settle();
  title = await api(`/api/projects/${s.projectId}/title`);
  t.check('an uploaded logo is stored', title.logo.kind === 'image' && /\.png$/.test(title.logo.file || ''), title.logo);

  // undo brings the logo maker back
  await s.page.locator('.ttl-tab[data-tab=logo]').click();
  await s.page.keyboard.press('Control+z');
  await settle();
  title = await api(`/api/projects/${s.projectId}/title`);
  t.eq('Ctrl+Z undid the upload', title.logo.kind, 'maker');
  t.check('the editor shows the undone state', await s.eval(() => window.studio64TitleUI.t.logo.kind === 'maker'));

  // ---- Play from start: splash, title, file select, then the game ----------------------------
  await s.page.click('#title-studio [data-act=close]');
  await s.eval(() => { studio64.storyRuntime.playFromStart(); });
  await s.page.waitForSelector('.ttl-screen', { timeout: 10000 });
  await s.wait(700);
  const st0 = await s.eval(() => window.studio64Title.current?.state());
  t.eq('the first splash plays', st0?.stage, 'splash');
  await shot('play-splash');
  await s.page.keyboard.press('Enter'); // skip
  const st1 = await s.eval(() => window.studio64Title.current?.state());
  t.check('Enter skips a splash screen', st1.index >= 1, st1);
  await shot('play-splash2');
  // the next one goes by itself
  await s.page.waitForFunction(() => window.studio64Title.current?.state().stage === 'title', null, { timeout: 30000 });
  await s.wait(2600);
  await shot('play-title');
  await s.page.keyboard.press('Enter');
  await s.wait(700);
  t.eq('Press Start opens the file select', await s.eval(() => window.studio64Title.current?.state().stage), 'files');
  await shot('play-files');
  await s.page.keyboard.press('ArrowRight');
  await s.page.keyboard.press('Enter'); // New game
  await s.page.waitForFunction(() => !document.querySelector('.ttl-screen') && studio64.engine.state().mario, null, { timeout: 40000 });
  t.check('the game starts in the castle grounds', (await s.state()).level === 16);
  await shot('play-game');

  // ---- the game's own title screen: Mario's face (and without it) --------------------------------
  await api(`/api/projects/${s.projectId}/title`, { title: { ...title, splashes: [], bg: { ...title.bg, kind: 'game', head: true }, files: { ...title.files, on: false } } }, 'PUT');
  await s.wait(600);
  await s.eval(() => { studio64.storyRuntime.playFromStart(); });
  await s.page.waitForFunction(() => studio64.engine.M._studio_title_state() === 2, null, { timeout: 30000 });
  await s.wait(3500);
  await shot('play-face');
  const face = await s.eval(() => ({ state: studio64.engine.M._studio_title_state(), mario: !!studio64.engine.state().mario && !studio64.engine.inIntro }));
  t.eq('the engine shows its title screen', face.state, 2);
  await s.eval(() => studio64.engine.M._studio_title_head(0));
  await s.wait(1200);
  await shot('play-face-off');
  await s.page.keyboard.press('Enter');
  await s.page.waitForFunction(() => !document.querySelector('.ttl-screen') && studio64.engine.M._studio_title_state() === 0 && studio64.engine.state().mario, null, { timeout: 60000 });
  t.check('after the face title the game is back in a level', (await s.state()).level === 16);
  t.check('no crash after the engine title', !(await s.crashed()));

  // ---- a level fly-over -----------------------------------------------------------------------------
  await api(`/api/projects/${s.projectId}/title`, { title: { ...title, splashes: [], bg: { ...title.bg, kind: 'level', level: '9:1' }, files: { ...title.files, on: false } } }, 'PUT');
  await s.wait(600);
  await s.eval(() => { studio64.storyRuntime.playFromStart(); });
  await s.page.waitForFunction(() => studio64.engine.level === 9 && studio64.engine.M._studio_title_scene_on() === 1, null, { timeout: 60000 });
  await s.wait(3000);
  await shot('play-flyover');
  t.check('Mario is hidden in the fly-over', await s.eval(() => (studio64.engine.state().mario?.action || '') === '0x00001300'));
  await s.page.keyboard.press('Enter');
  await s.page.waitForFunction(() => !document.querySelector('.ttl-screen') && studio64.engine.level === 16 && studio64.engine.state().mario, null, { timeout: 60000 });
  t.check('after the fly-over the hack starts at its start', (await s.state()).level === 16);

  // ---- persistence and the home card ----------------------------------------------------------------
  await api(`/api/projects/${s.projectId}/title`, { title }, 'PUT');
  await s.reload();
  const again = await s.eval(() => window.studio64Title.title);
  t.eq('the title survives a reload', again.logo.maker.text, 'MOCHI WORLD');
  const thumb = await fetch(`${URL_BASE}/api/projects/${s.projectId}/thumb`);
  t.check('the home card uses the title still as cover', thumb.ok && /jpeg/.test(thumb.headers.get('content-type') || ''));
  const list = await api('/api/hub/projects');
  t.check('the home list knows it has a picture', list.find((p) => p.id === s.projectId)?.hasThumb === true);

  // ---- the .s64hack round trip ---------------------------------------------------------------------
  const buf = Buffer.from(await (await fetch(`${URL_BASE}/api/projects/${s.projectId}/export.s64hack`)).arrayBuffer());
  const files = zipRead(buf);
  t.check('the project file has the logo picture', [...files.keys()].some((k) => k.endsWith(`title/${title.logo.file}`)), [...files.keys()].filter((k) => k.includes('title')));
  const imp = await fetch(`${URL_BASE}/api/hub/import`, { method: 'POST', body: buf });
  const { id: id2 } = await imp.json();
  const t2 = await api(`/api/projects/${id2}/title`);
  t.eq('the imported project has the same title', [t2.on, t2.logo.maker.text, t2.logo.file, t2.splashes.length], [true, 'MOCHI WORLD', title.logo.file, 2]);
  const logo2 = await fetch(`${URL_BASE}/api/projects/${id2}/assets/title/${t2.logo.file}`);
  t.check('the imported project serves the logo', logo2.ok);

  // ---- the standalone player -------------------------------------------------------------------------
  const zbuf = Buffer.from(await (await fetch(`${URL_BASE}/api/projects/${s.projectId}/standalone.zip`)).arrayBuffer());
  const zfiles = zipRead(zbuf);
  t.check('the playable zip has the title code and the logo', zfiles.has('js/title/player.js') && zfiles.has('js/title/title_screen.js') && zfiles.has(`assets/project/title/${title.logo.file}`));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's64title-'));
  for (const [n, d] of zfiles) { fs.mkdirSync(path.dirname(path.join(dir, n)), { recursive: true }); fs.writeFileSync(path.join(dir, n), d); }
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(dir, p);
    if (!f.startsWith(dir) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  }).listen(0);
  const page = await (await t.launch()).newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400 && !/fonts\.g/.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  await page.waitForSelector('.ttl-screen', { timeout: 20000 });
  t.check('the player shows the launch screen instead of its card', await page.isHidden('#title'));
  await page.waitForTimeout(600);
  // (the page may be busy compiling the game: a picture only when it can)
  await page.screenshot({ path: path.join(odir, 'player-splash.png'), timeout: 8000 }).catch(() => t.log('player busy: no splash picture'));
  // the splash screens play while the game loads; the title waits for it
  await page.waitForFunction(() => window.studioPlayer.engine?.ready && window.studioPlayer.titleScreen?.state?.().stage === 'title', null, { timeout: 180000 });
  await page.waitForTimeout(2600);
  await shot('player-title', page);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  t.eq('the player has the file select', await page.evaluate(() => window.studioPlayer.titleScreen.state().stage), 'files');
  await shot('player-files', page);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.ttl-screen') && window.studioPlayer.playing && window.studioPlayer.engine.state().mario, null, { timeout: 60000 });
  t.check('the game starts after the launch screen', await page.isVisible('#hud'));
  await shot('player-game', page);
  t.check('no errors or missing files in the player', errors.length === 0, errors);
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
