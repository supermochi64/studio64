// Standalone export: the playable .zip of a hack (a sample with its own level) unpacked and served
// by a plain static file server plays in the browser: title card, game, level list, no errors.
// @tags projects export
// @timeout 600
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { suite, api, URL_BASE, OUT } from '../lib/harness.mjs';
import { zipRead } from '../../server/zip.js';

await suite('standalone export', async (t) => {
  const samples = await api('/api/hub/samples');
  t.must('samples exist', samples.length > 0);
  const { id } = await api('/api/hub/create', { sample: samples.find((s) => /isles/i.test(s.file))?.file || samples[0].file });
  const buf = Buffer.from(await (await fetch(`${URL_BASE}/api/projects/${id}/standalone.zip`)).arrayBuffer());
  const files = zipRead(buf);
  t.log(`zip ${(buf.length / 1e6).toFixed(1)} MB, ${files.size} files`);
  for (const need of ['index.html', 'js/player.js', 'js/engine.js', 'engine/sm64.us.f3dex2e.wasm', 'data/hack.json', 'data/catalog.json', 'README.txt']) t.check(`zip has ${need}`, files.has(need));
  t.check('README warns about Nintendo\'s assets', /Nintendo/.test(files.get('README.txt').toString()));
  t.check('no editor or chat code in the zip', !files.has('js/editor.js') && !files.has('js/app.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's64play-'));
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
  const browser = await t.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  await page.waitForSelector('#play-btn:not([disabled])', { timeout: 180000 });
  const odir = path.join(OUT, t.slug);
  fs.mkdirSync(odir, { recursive: true });
  await page.screenshot({ path: path.join(odir, 'title.png') });
  t.check('title card shows the hack', /Star Isles|\w/.test(await page.textContent('#hack-name')) && /Nintendo/.test(await page.textContent('#legal')));
  await page.click('#play-btn');
  await page.waitForFunction(() => window.studioPlayer.engine.level === window.studioPlayer.engine.studioLevel && window.studioPlayer.engine.state().mario, null, { timeout: 90000 }).catch(() => {});
  const st = await page.evaluate(() => ({ level: window.studioPlayer.engine.level, studio: window.studioPlayer.engine.studioLevel, mario: window.studioPlayer.engine.state().mario }));
  t.check('the hack starts in its own level', st.level === st.studio && !!st.mario, st);
  await page.keyboard.down('KeyW');
  await page.waitForFunction((p) => { const m = window.studioPlayer.engine.state().mario; return m && Math.hypot(m.x - p.x, m.z - p.z) > 100; }, st.mario, { timeout: 20000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  const moved = await page.evaluate(() => window.studioPlayer.engine.state().mario);
  t.check('Mario runs', Math.hypot(moved.x - st.mario.x, moved.z - st.mario.z) > 100, { from: st.mario, to: moved });
  await page.screenshot({ path: path.join(odir, 'game.png') });
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(400);
  t.check('L opens the level list', await page.isVisible('#levels') && (await page.locator('.pl-level').count()) >= 2);
  await page.screenshot({ path: path.join(odir, 'levels.png') });
  t.check('no errors or missing files', errors.length === 0, errors);
  srv.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
