// Render a launcher thumbnail for every original level: web/thumbs/levels/<num>.jpg.
// Needs the server running (npm start). Usage: node tools/make_level_thumbs.mjs [nums...]
import { launchBrowser } from './lib/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || (process.env.STUDIO_URL || 'http://127.0.0.1:8064');
const OUT = path.resolve('web/thumbs/levels');
fs.mkdirSync(OUT, { recursive: true });
const cat = JSON.parse(fs.readFileSync('server/data/catalog.json', 'utf8'));
const only = process.argv.slice(2).map(Number);
const nums = Object.values(cat.levels).filter((l) => l.num && (!only.length || only.includes(l.num))).map((l) => l.num);

const browser = await launchBrowser({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const proj = await (await fetch(BASE + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 9 }) })).json();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${BASE}/?p=${proj.id}`);
await page.waitForSelector('#loading', { state: 'hidden', timeout: 300000 }); // (a slow or busy machine boots the game slowly)
await page.click('#start');
await page.waitForTimeout(1500);
for (const num of nums) {
  await page.evaluate((n) => studio64.engine.warpFast(n, 1, null, false), num);
  try {
    await page.waitForFunction((n) => studio64.engine.level === n, num, { timeout: 15000 });
  } catch { console.log(num, 'did not arrive'); continue; }
  await page.waitForTimeout(3500);
  const data = await page.evaluate(async () => {
    const url = await studio64.engine.screenshot(3000);
    if (!url) return null;
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = url; });
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180;
    const s = Math.max(320 / img.width, 180 / img.height);
    c.getContext('2d').drawImage(img, (320 - img.width * s) / 2, (180 - img.height * s) / 2, img.width * s, img.height * s);
    return c.toDataURL('image/jpeg', 0.8);
  });
  if (!data) { console.log(num, 'no frame'); continue; }
  fs.writeFileSync(path.join(OUT, `${num}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
  console.log(num, 'ok');
}
await fetch(`${BASE}/api/projects/${proj.id}`, { method: 'DELETE' }).catch(() => {});
await browser.close();
