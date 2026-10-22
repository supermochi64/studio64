// Render the launcher picture of every level template: web/thumbs/templates/<id>.jpg.
// Needs the server running (npm start). Usage: node tools/make_template_thumbs.mjs [ids...]
import { launchBrowser } from './lib/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || (process.env.STUDIO_URL || 'http://127.0.0.1:8064');
const OUT = path.resolve('web/thumbs/templates');
fs.mkdirSync(OUT, { recursive: true });
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['island', 'meadow', 'mountain', 'desert', 'snow', 'lava', 'canyon', 'flat', 'sky'];

const browser = await launchBrowser({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const proj = await (await fetch(BASE + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 9 }) })).json();
const page = await browser.newPage({ viewport: { width: 2100, height: 900 } }); // a landscape game frame next to the build panels
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${BASE}/?p=${proj.id}`);
await page.waitForSelector('#loading', { state: 'hidden', timeout: 300000 }); // (a slow or busy machine boots the game slowly)
await page.click('#start');
await page.waitForTimeout(1500);
// only the game in the picture
await page.addStyleTag({ content: '.build-bar, .tool-hint, .nav-widget, .overlay-canvas, #nav, .coords, .fullscreen-btn, .toasts { visibility: hidden !important; }' });
for (const id of ids) {
  await page.evaluate((id) => studio64.levelsUI.createLevel(id, null, id), id);
  await page.waitForFunction(() => studio64.engine.inIntro, null, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => !studio64.engine.inIntro, null, { timeout: 15000 });
  await page.waitForTimeout(2500);
  if (!(await page.evaluate(() => studio64.editor.active))) await page.click('#mode-build');
  await page.waitForTimeout(400);
  await page.evaluate(() => { studio64.editor.cam.yaw = Math.PI * 0.85; studio64.editor.overview(); });
  await page.waitForTimeout(1600);
  const data = await page.evaluate(async () => {
    const url = await studio64.engine.screenshot(3000);
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = url; });
    const c = document.createElement('canvas');
    c.width = 400; c.height = 250;
    const s = Math.max(400 / img.width, 250 / img.height) * 1.6; // the level, not the sky around it
    c.getContext('2d').drawImage(img, (400 - img.width * s) / 2, (250 - img.height * s) / 2, img.width * s, img.height * s);
    return c.toDataURL('image/jpeg', 0.82);
  });
  fs.writeFileSync(path.join(OUT, `${id}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
  await page.click('#mode-play');
  await page.waitForTimeout(300);
  console.log(id, 'ok');
}
await fetch(`${BASE}/api/projects/${proj.id}`, { method: 'DELETE' }).catch(() => {});
await browser.close();
