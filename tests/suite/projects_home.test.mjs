// Projects: the home screen (list, search, templates), a hack from scratch, project settings,
// versions (save, compare, restore), export -> drag & drop import roundtrip with an asset file,
// duplicate, delete with in-app confirmation + undo.
// @tags projects
// @timeout 900
import fs from 'node:fs';
import { suite, api, URL_BASE } from '../lib/harness.mjs';

await suite('projects home', async (t) => {
  const NAME = `Roundtrip ${Date.now().toString(36)}`;
  const browser = await t.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // ---- home screen, "from scratch" ----
  await page.goto(`${URL_BASE}/?home`);
  await page.waitForSelector('.tpl-card', { timeout: 60000 });
  await page.waitForTimeout(800);
  t.check('home shows the start cards', (await page.locator('.tpl-card').count()) >= 2);
  await page.screenshot({ path: `${await shotDir(t)}/home.png` });
  await page.click('.tpl-card:has-text("From scratch")');
  await page.waitForSelector('#hk-name');
  await page.fill('#hk-name', NAME);
  await page.fill('#hk-author', 'Test Author');
  await page.click('.hub-tpl[data-id=snow]');
  await page.click('#hk-ok');
  await page.waitForURL(/\?p=/, { timeout: 60000 });
  const id = new URL(page.url()).searchParams.get('p');
  await page.waitForFunction(() => window.studio64?.engine?.ready && studio64.levelsUI && document.querySelector('#loading').hidden, null, { timeout: 180000 });
  await page.waitForFunction(() => studio64.engine.level === studio64.engine.studioLevel && studio64.engine.state().mario, null, { timeout: 90000 }).catch(() => {});
  const started = await page.evaluate(() => ({ level: studio64.engine.level, studio: studio64.engine.studioLevel, levels: studio64.levels.map((l) => l.name) }));
  t.check('"from scratch" starts in its own level', started.level === started.studio && started.levels.length === 1, started);

  // ---- settings ----
  await page.evaluate(() => studio64.hub.settingsModal());
  await page.waitForSelector('#ps-desc');
  await page.fill('#ps-desc', 'A snowy test hack.');
  await page.click('#ps-shot');
  await page.waitForSelector('#ps-cover img', { timeout: 15000 });
  await page.screenshot({ path: `${await shotDir(t)}/settings.png` });
  await page.click('#ps-ok');
  await page.waitForTimeout(600);
  const info = await api(`/api/projects/${id}/info`);
  t.check('settings: author, description, cover', info.author === 'Test Author' && /snowy/.test(info.description) && info.hasCover, info);

  // ---- versions ----
  const addBlock = (n) => page.evaluate(async (n) => {
    const e = studio64.engine;
    const m = e.state().mario;
    const rec = { uid: 0x2000000 + n, block: { shape: 0, sx: 300, sy: 200, sz: 300, top: 0, side: 0, surface: 0, flags: 0, color: 0xffffff, steps: 0 }, x: m.x + 400 * n, y: m.y, z: m.z + 300, yaw: 0, pitch: 0, roll: 0, name: `Test block ${n}` };
    e.spawn(rec);
    studio64.testing.send({ type: 'edit', op: { type: 'add', key: e.areaKey(), records: [rec], summary: `Added test block ${n}` } });
    await new Promise((r) => setTimeout(r, 500));
  }, n);
  await addBlock(1);
  await page.evaluate(() => studio64.hub.saveVersionModal());
  await page.fill('#sv-label', 'One block');
  await page.click('#sv-ok');
  await page.waitForTimeout(600);
  await addBlock(2);
  await addBlock(3);
  await page.evaluate(() => studio64.hub.historyModal());
  await page.click('.vh-item:has-text("One block")');
  await page.waitForSelector('.vh-line', { timeout: 15000 });
  const diff = await page.textContent('#vh-diff');
  t.check('compare lists what changed since the version', /Test block 2/.test(diff) && /Test block 3/.test(diff), diff);
  await page.screenshot({ path: `${await shotDir(t)}/versions.png` });
  await page.click('#vh-restore');
  await page.click('#hc-ok');
  await page.waitForTimeout(3000);
  await page.waitForFunction(() => window.studio64?.engine?.ready, null, { timeout: 180000 });
  const after = await api(`/api/projects/${id}/info`);
  t.eq('restore brings that version back', after.objects, info.objects + 1);
  const vlist = await api(`/api/projects/${id}/versions`);
  t.check('restoring keeps the current state as a version', vlist.some((v) => /Before restoring/.test(v.label)), vlist.map((v) => v.label));

  // ---- an asset, export, drop the file on the home screen ----
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP8z8DwnwEJMDEwMDAwAAAp9AIDxgbQ8QAAAABJRU5ErkJggg==', 'base64');
  const up = await fetch(`${URL_BASE}/api/projects/${id}/assets/files?kind=png&name=tile.png`, { method: 'POST', body: png }).then((r) => r.json()).catch(() => null);
  t.check('an asset file is uploaded', !!up?.id, up);
  const dl = page.waitForEvent('download');
  await page.evaluate((id) => studio64.hub.download(`/api/projects/${id}/export.s64hack`), id);
  const bytes = fs.readFileSync(await (await dl).path());
  t.check('export is a .s64hack zip', bytes.readUInt32LE(0) === 0x04034b50, bytes.length);
  await page.goto(`${URL_BASE}/?home`);
  await page.waitForSelector('.proj-card', { timeout: 90000 });
  const dt = await page.evaluateHandle((b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const d = new DataTransfer();
    d.items.add(new File([bin], 'Roundtrip Island.s64hack', { type: 'application/zip' }));
    return d;
  }, bytes.toString('base64'));
  await page.dispatchEvent('#home', 'dragenter', { dataTransfer: dt });
  t.check('dragging a file shows the drop target', await page.isVisible('.home-drop'));
  await page.screenshot({ path: `${await shotDir(t)}/drop.png` });
  await page.dispatchEvent('#home', 'drop', { dataTransfer: dt });
  await page.waitForURL((u) => { const q = new URL(u).searchParams.get('p'); return q && q !== id; }, { timeout: 60000 });
  const newId = new URL(page.url()).searchParams.get('p');
  const a = await api(`/api/projects/${id}/play.json`);
  const b = await api(`/api/projects/${newId}/play.json`);
  t.check('the import has the same levels, edits, settings and cover', JSON.stringify(a.areas) === JSON.stringify(b.areas) && JSON.stringify(a.levels) === JSON.stringify(b.levels) && a.meta?.description === b.meta?.description && !!b.meta?.cover);
  if (up?.id) {
    const back = await fetch(`${URL_BASE}/api/projects/${newId}/assets/files/${up.id}`).then((r) => r.arrayBuffer()).then((x) => Buffer.from(x)).catch(() => null);
    t.check('the asset file comes along', back && back.equals(png), back?.length);
  }
  await page.waitForFunction(() => window.studio64?.engine?.ready && document.querySelector('#loading').hidden, null, { timeout: 180000 });
  await page.waitForFunction(() => studio64.engine.level === studio64.engine.studioLevel && studio64.engine.state().mario, null, { timeout: 90000 }).catch(() => {});
  t.check('the imported hack opens in its level', await page.evaluate(() => studio64.engine.level === studio64.engine.studioLevel && !!studio64.engine.state().mario));

  // ---- duplicate, delete + undo, search ----
  await page.goto(`${URL_BASE}/?home`);
  await page.waitForSelector(`.proj-card[data-id="${newId}"]`, { timeout: 90000 });
  await page.hover(`.proj-card[data-id="${newId}"]`);
  await page.click(`.proj-card[data-id="${newId}"] .proj-more`);
  await page.click('.hub-menu .menu-item:has-text("Duplicate")');
  await page.waitForTimeout(1500);
  const list = await api('/api/hub/projects');
  const copy = list.find((p) => p.name === `${NAME} copy`);
  t.must('duplicate makes a copy', !!copy);
  await page.hover(`.proj-card[data-id="${copy.id}"]`);
  await page.click(`.proj-card[data-id="${copy.id}"] .proj-more`);
  await page.click('.hub-menu .menu-item:has-text("Delete")');
  t.check('delete asks inside the app', await page.isVisible('#hc-ok'));
  await page.screenshot({ path: `${await shotDir(t)}/delete.png` });
  await page.click('#hc-ok');
  await page.waitForTimeout(1000);
  const gone = !(await api('/api/hub/projects')).some((p) => p.id === copy.id);
  await page.click('.hub-toast button:has-text("Undo")');
  await page.waitForTimeout(1000);
  const back = (await api('/api/hub/projects')).some((p) => p.id === copy.id);
  t.check('deleted, then Undo brings it back', gone && back, { gone, back });
  await page.fill('#home-search', `${NAME} copy`.toLowerCase());
  await page.waitForTimeout(400);
  t.eq('search filters the cards', await page.locator('.proj-card').count(), 1);
  t.check('no page errors', errors.length === 0, errors);
});

async function shotDir(t) {
  const { OUT } = await import('../lib/harness.mjs');
  const dir = `${OUT}/${t.slug}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
