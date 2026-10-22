// The app around the game, like a demanding user with a keyboard: the home screen (keys in
// dialogs and menus, card order, clamped descriptions, initials, imports), links to missing
// projects, the password gate in the browser (asks on the home screen, pictures and downloads
// work), Esc on every dialog and menu in a project, provider-neutral AI wording, the loading
// card when the game can't load, the offline queue and auto-saves.
// @tags projects ui
// @timeout 600
import { suite, api, URL_BASE, ROOT, sleep } from '../lib/harness.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';

const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const COVER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// A page of our own (the home screen has no game: the harness' t.open boots one).
async function homePage(t, base, { storage = {}, viewport = { width: 1280, height: 800 } } = {}) {
  const ctx = await (await t.launch()).newContext({ viewport });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|fonts\./.test(m.text())) page.errors.push(m.text()); });
  await page.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, { 'studio64.tourDone': '1', ...storage });
  return page;
}
const toasts = (page) => page.evaluate(() => [...document.querySelectorAll('#toasts > *, .toast')].map((e) => e.textContent.trim()).join(' | '));

await suite('ui polish', async (t) => {
  // ---- the home screen with the keyboard ---------------------------------------------------------
  const name = `Polish ${Date.now().toString(36)}`;
  const { id } = await api('/api/hub/create', { name, template: 'empty', level: 16 });
  t.must('project made', !!id);
  const home = await homePage(t, URL_BASE);
  await home.goto(`${URL_BASE}/?home`, { waitUntil: 'domcontentloaded' });
  await home.waitForSelector(`.proj-card[data-id="${id}"]`, { timeout: 30000 });
  const order = await home.evaluate(() => [...document.querySelectorAll('#home-scroll > .home-sec')].map((s) => (s.querySelector('#home-grid') ? 'projects' : s.querySelector('#home-templates') ? 'templates' : '?')));
  t.eq('your hacks come first once there is one', order.slice(0, 2), ['projects', 'templates']);
  t.eq('sample descriptions are clamped to three lines', await home.evaluate(() => getComputedStyle(document.querySelector('.tpl-sub')).webkitLineClamp), '3');
  t.check('... with the full text as tooltip', await home.evaluate(() => [...document.querySelectorAll('.tpl-card')].every((c) => c.title)));
  const card = home.locator(`.proj-card[data-id="${id}"]`);
  t.eq('initials use letters only', await card.locator('.proj-initials').textContent(), 'P' + name.split(' ')[1][0].toUpperCase());

  // the card menu: focus, arrows, Esc
  await card.locator('.proj-more').click();
  t.check('the card menu focuses its first item', await home.evaluate(() => document.activeElement?.closest('.hub-menu') && document.activeElement.textContent.includes('Open')));
  await home.keyboard.press('ArrowDown');
  t.check('ArrowDown moves to Rename', await home.evaluate(() => document.activeElement?.textContent.includes('Rename')));
  await home.keyboard.press('Escape');
  t.eq('Esc closes the card menu', await home.locator('.hub-menu').count(), 0);
  // Rename with Enter (the home's key handler used to eat it)
  await card.locator('.proj-more').click();
  await home.keyboard.press('ArrowDown');
  await home.keyboard.press('Enter');
  await home.waitForSelector('#hr-name');
  await home.fill('#hr-name', `${name} renamed`);
  await home.keyboard.press('Enter');
  await home.waitForFunction((n) => [...document.querySelectorAll('.proj-name')].some((e) => e.textContent === n), `${name} renamed`, { timeout: 10000 }).catch(() => {});
  t.eq('Rename with Enter works', (await api(`/api/projects/${id}/info`)).name, `${name} renamed`);
  t.check('... and the dialog closed', await home.evaluate(() => document.querySelector('#modal-back').hidden));
  // Esc closes a dialog on the home screen (settings), and only the dialog
  await card.locator('.proj-more').click();
  await home.locator('.hub-menu .menu-item', { hasText: 'Settings' }).click();
  await home.waitForSelector('#ps-name');
  await home.keyboard.press('Escape');
  t.check('Esc closes the settings dialog', await home.evaluate(() => document.querySelector('#modal-back').hidden));
  t.check('... and leaves the home screen open', await home.evaluate(() => !document.querySelector('#home').hidden));
  // a picture is not a project file: say so by name
  const png = path.join(os.tmpdir(), `s64-photo-${process.pid}.png`);
  fs.writeFileSync(png, 'x');
  await home.setInputFiles('#home-file', [png]);
  await sleep(400);
  t.check('dropping a picture names it', /s64-photo-\d+\.png is not a project file/.test(await toasts(home)), await toasts(home));
  // Enter on a focused card opens it
  await card.focus();
  await Promise.all([home.waitForURL(new RegExp(`p=${id}`), { timeout: 15000 }).catch(() => {}), home.keyboard.press('Enter')]);
  t.check('Enter on a focused card opens the project', home.url().includes(`p=${id}`), home.url());
  t.eq('home page: no errors', home.errors, []);
  await home.context().close();

  // ---- a link to a project that is gone --------------------------------------------------------------
  const before = (await api('/api/hub/projects')).length;
  const gone = await homePage(t, URL_BASE);
  await gone.goto(`${URL_BASE}/?p=gone${Date.now().toString(36)}`, { waitUntil: 'domcontentloaded' });
  await gone.waitForSelector('#home:not([hidden])', { timeout: 30000 }).catch(() => {});
  t.check('a link to a missing project opens the home screen', await gone.evaluate(() => !document.querySelector('#home')?.hidden));
  t.check('... and says so', /not on this server/.test(await toasts(gone)), await toasts(gone));
  t.check('... and drops the stale id from the address', !gone.url().includes('p=gone'), gone.url());
  t.eq('... and makes no new project', (await api('/api/hub/projects')).length, before);
  await gone.context().close();
  const lostPlayer = await homePage(t, URL_BASE);
  await lostPlayer.goto(`${URL_BASE}/play.html?p=gone${Date.now().toString(36)}`, { waitUntil: 'domcontentloaded' });
  await lostPlayer.waitForFunction(() => /Could not load/.test(document.querySelector('#hack-name')?.textContent || ''), null, { timeout: 30000 }).catch(() => {});
  t.check('the player says a missing hack is not on this server (no "play.json: 404")', /not on this server/.test(await lostPlayer.textContent('#play-label')), await lostPlayer.textContent('#play-label'));
  await lostPlayer.context().close();

  // ---- the game can't load: a plain card with a way on ---------------------------------------------
  const broken = await homePage(t, URL_BASE);
  await broken.goto(`${URL_BASE}/?p=${id}&engine=missing`, { waitUntil: 'domcontentloaded' });
  await broken.waitForSelector('.loading-retry', { timeout: 60000 }).catch(() => {});
  t.check('an engine that does not load shows Try again', await broken.locator('.loading-retry').isVisible().catch(() => false));
  t.check('... with words a person understands', /could not be loaded/.test(await broken.textContent('#loading-title')), await broken.textContent('#loading-title'));
  await broken.context().close();

  // ---- in a project: Esc on menus and dialogs, wording, offline queue ----------------------------
  const s = await t.open({ project: id, start: false });
  t.allowConsole(/ScriptProcessorNode/);
  await s.page.click('#menu-btn');
  await s.page.waitForSelector('#project-menu:not([hidden]) .menu-item');
  await s.key('Escape');
  t.check('Esc closes the project menu', await s.eval(() => document.querySelector('#project-menu').hidden));
  t.check('a long menu fits the window (scrolls)', await s.eval(() => document.querySelector('#project-menu').style.overflowY === 'auto'));
  if (await s.page.locator('#model-btn').isVisible()) { // AI on: the model menu under the chat box
    await s.page.click('#model-btn');
    await s.key('Escape');
    t.check('Esc closes the model menu', await s.eval(() => document.querySelector('#model-menu').hidden));
  }
  for (const label of ['Project settings', 'Version history', 'Share', 'Export for the decomp']) {
    await s.page.click('#menu-btn');
    await s.page.locator('#project-menu .menu-item', { hasText: label }).first().click();
    await s.page.waitForFunction(() => !document.querySelector('#modal-back').hidden, null, { timeout: 10000 }).catch(() => {});
    await s.wait(400);
    await s.key('Escape');
    t.check(`Esc closes ${label}`, await s.eval(() => document.querySelector('#modal-back').hidden));
    await s.eval(() => { document.querySelector('#modal-back').hidden = true; });
  }
  const words = await s.eval(() => ({ empty: document.querySelector('#empty-sub')?.textContent || '', meta: document.querySelector('meta[name=description]')?.content || '' }));
  t.check('the chat welcome does not assume Claude (any model can be picked)', !/Claude/.test(words.empty), words.empty);
  t.check('the page description does not say the tool is a chat with Claude', !/Claude/.test(words.meta), words.meta);
  t.check('story, world and area edits wait offline too', await s.eval(() => ['story_op', 'world_set', 'area_create', 'area_rename', 'area_delete'].every((type) => { const h = studio64.hub; const keep = h.outbox.slice(); const ok = h.queue({ type, ops: [] }); h.outbox = keep; try { localStorage.removeItem(h.outboxKey()); } catch { /* ignore */ } h.showOffline(); return ok; })));

  // keyboard only: Shift+Tab into the controls, then Tab walks everything (also the side panel
  // after the game) without switching to build mode; Esc on a control goes back to the game
  await s.eval(() => document.querySelector('#canvas').focus());
  await s.key('Shift+Tab');
  const walked = new Set();
  for (let i = 0; i < 60; i++) {
    await s.key('Tab');
    walked.add(await s.eval(() => { const a = document.activeElement; return a?.closest('.side') ? 'side' : a?.closest('.rail') ? 'rail' : a?.closest('.topbar') ? 'topbar' : a?.id || a?.tagName; }));
  }
  // (without AI the history/stars panel starts closed)
  const sideShown = await s.eval(() => { const e = document.querySelector('.side'); return !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).display !== 'none'; });
  t.check('Tab walks the top bar, the rail and the side panel', [...(sideShown ? ['side'] : []), 'rail', 'topbar'].every((x) => walked.has(x)), [...walked]);
  t.check('... and never lands on the game or switches to build mode', !walked.has('canvas') && !(await s.eval(() => studio64.editor.active)), [...walked]);
  await s.eval(() => document.querySelector('.rail button')?.focus());
  await s.key('Escape');
  t.eq('Esc on a control goes back to the game', await s.eval(() => document.activeElement?.id), 'canvas');

  // contrast: hint and label text (--faint, --muted) is readable (WCAG AA 4.5:1) on the main surfaces
  const contrast = await s.eval(() => {
    const css = getComputedStyle(document.documentElement);
    const rgb = (v) => { const h = css.getPropertyValue(v).trim().replace('#', ''); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); };
    const lum = (c) => { const [r, g, b] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const out = {};
    for (const fg of ['--faint', '--muted']) for (const bg of ['--bg', '--panel', '--panel-2']) out[`${fg} on ${bg}`] = Math.round(ratio(fg, bg) * 100) / 100;
    return out;
  });
  t.check('hint and label colours reach 4.5:1 on the main surfaces', Object.values(contrast).every((r) => r >= 4.5), contrast);

  // a phone held sideways: the whole game fits the screen
  await s.page.setViewportSize({ width: 844, height: 390 });
  await s.wait(600);
  const fr = await s.eval(() => { const r = document.querySelector('#game-frame').getBoundingClientRect(); return { bottom: r.bottom, h: innerHeight, w: r.width, hh: r.height }; });
  t.check('landscape phone: the game fits the height', fr.bottom <= fr.h + 1 && fr.hh > 250, fr);
  await s.page.setViewportSize({ width: 1440, height: 900 });

  // ---- a hostile project file: names, ids and pictures carrying HTML must stay text ----------------
  {
    const X = '"><img src=x onerror="window.__xss=1">';
    const doc = {
      name: `Evil ${X}`, areas: {}, levels: [{ id: 'evl1', name: `Level ${X}`, created: 1, template: 'flat' }],
      meta: { author: X, description: X },
      audio: { songs: [{ id: 'sng1', name: `Song ${X}`, bpm: 120, tracks: [] }], sounds: [], overrides: [] },
      story: { version: 1, dialogs: [{ id: 'd1', name: `Dialog ${X}`, text: X, num: 400 }], texts: {}, npcs: {}, vars: [{ id: 'v1', name: X, kind: X }], events: [], cutscenes: [{ id: `cs${X}`, name: X, steps: [] }], hidden: [], start: {} },
      assets: { files: {}, models: [{ id: 'm1', name: X, thumb: `x${X}` }], textures: {}, materials: [], skies: {}, mario: {} },
    };
    const imp = await fetch(`${URL_BASE}/api/hub/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) }).then((r) => r.json());
    t.must('the hostile project imports', !!imp.id, imp);
    t.allowConsole(/Failed to load resource: the server responded with a status of 404/); // (the hostile thumbnail, loaded as a plain address)
    const xs = await t.open({ project: imp.id, start: false, label: 'xss' });
    for (const open of [() => studio64.storyUI?.open('start'), () => studio64.storyUI?.close(), () => studio64.soundUI?.open(), () => studio64.soundUI?.close(), () => studio64.assetsUI?.open('models'), () => studio64.assetsUI?.close?.(), () => studio64.hub?.openHome()]) {
      await xs.eval(open).catch(() => {});
      await xs.wait(500);
    }
    t.check('no HTML from a project file runs (home, story, sound, assets)', !(await xs.eval(() => window.__xss)));
    await xs.page.close();
  }

  // ---- auto-saves: none for a project nobody edited ----------------------------------------------------
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's64ver-'));
    const out = await new Promise((resolve) => {
      const code = `
        const projects = await import(${JSON.stringify(path.join(ROOT, 'server/projects.js'))});
        const versions = await import(${JSON.stringify(path.join(ROOT, 'server/versions.js'))});
        const a = projects.createProject({ name: 'untouched' });
        const b = projects.createProject({ name: 'edited' });
        const tick = versions.startAuto(() => [a, b]);
        tick();
        b.updatedAt = Date.now() + 1;
        const real = Date.now; Date.now = () => real() + 11 * 60 * 1000; // ten minutes later
        b.updatedAt = Date.now();
        tick();
        console.log(JSON.stringify({ a: versions.list(a.id).length, b: versions.list(b.id).length }));
        process.exit(0);`;
      const c = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, STUDIO_PROJECTS: dir }, stdio: ['ignore', 'pipe', 'pipe'] });
      let txt = '';
      c.stdout.on('data', (d) => { txt += d; });
      c.stderr.on('data', (d) => { txt += d; });
      c.on('close', () => resolve(txt));
    });
    let r = {};
    try { r = JSON.parse(out.trim().split('\n').pop()); } catch { /* shown below */ }
    t.eq('an untouched project gets no empty auto-save', r.a, 0);
    t.eq('an edited one does (after the interval)', r.b, 1);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---- the password gate in the browser ------------------------------------------------------------
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's64pw-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', STUDIO_PROJECTS: dir, STUDIO_SETUP: 'off', STUDIO_AI: 'off', STUDIO_PASSWORD: 'sesame' },
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  try {
    for (let i = 0; i < 200 && !/running/.test(log); i++) await sleep(100);
    t.must('the password server started', /running/.test(log), log.slice(-600));
    const L = `http://127.0.0.1:${port}`;
    const hdr = { 'content-type': 'application/json', 'x-studio-key': 'sesame' };
    const made = await (await fetch(`${L}/api/hub/create`, { method: 'POST', headers: hdr, body: JSON.stringify({ name: 'Locked hack', template: 'empty' }) })).json();
    await fetch(`${L}/api/projects/${made.id}/meta`, { method: 'POST', headers: hdr, body: JSON.stringify({ cover: COVER }) });
    const pw = await homePage(t, L);
    await pw.goto(`${L}/?home`, { waitUntil: 'domcontentloaded' });
    await pw.waitForSelector('#hpw', { timeout: 20000 }).catch(() => {});
    t.check('home screen asks for the password', await pw.locator('#hpw').isVisible().catch(() => false));
    await pw.fill('#hpw', 'wrong');
    await pw.keyboard.press('Enter');
    await pw.waitForFunction(() => /not right/.test(document.querySelector('#modal')?.textContent || ''), null, { timeout: 10000 }).catch(() => {});
    t.check('a wrong password says so', /not right/.test(await pw.textContent('#modal')));
    await pw.fill('#hpw', 'sesame');
    await pw.keyboard.press('Enter');
    await pw.waitForSelector(`.proj-card[data-id="${made.id}"]`, { timeout: 15000 }).catch(() => {});
    t.check('with the right one the hacks appear', await pw.locator(`.proj-card[data-id="${made.id}"]`).count() === 1);
    await pw.waitForFunction((pid) => { const i = document.querySelector(`.proj-card[data-id="${pid}"] img`); return i && i.complete && i.naturalWidth > 0; }, made.id, { timeout: 10000 }).catch(() => {});
    t.check('cover pictures load behind the password (cookie)', await pw.evaluate((pid) => (document.querySelector(`.proj-card[data-id="${pid}"] img`)?.naturalWidth || 0) > 0, made.id));
    const dl = await pw.evaluate(async (pid) => { const r = await fetch(`/api/projects/${pid}/export.s64hack`); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, pk: b[0] === 0x50 && b[1] === 0x4b }; }, made.id);
    t.check('a download without the header (a link) gets the real file', dl.status === 200 && dl.pk, dl);
    t.eq('password page: no errors', pw.errors.filter((e) => !/401/.test(e)), []);
    await pw.context().close();
  } finally {
    child.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(png, { force: true }); } catch { /* ignore */ }
  }
});
