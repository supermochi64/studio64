// Scout: an original area in the studio, a few camera views. node scout.mjs LEVEL AREA OUT "x,y,z,fx,fy,fz;..."
import { openStudio, sleep, saveDataUrl } from '../scripts/lib.mjs';
import fs from 'node:fs';
const [level, area, out, views] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const { browser, page } = await openStudio({ level: Number(level), name: 'Scout', viewport: { width: 1280, height: 720 } });
if (Number(area) > 1) {
  if (process.env.TELE) await page.evaluate((t) => studio64.engine.teleport(...t), JSON.parse(process.env.TELE));
  else await page.evaluate((a) => studio64.worldFlow.goArea({ level: studio64.engine.level, area: a }), Number(area));
  for (let i = 0; i < 60; i++) { await sleep(500); if (await page.evaluate((a) => studio64.engine.area === a && !studio64.engine.inIntro, Number(area))) break; }
  await sleep(3000);
}
console.log(await page.evaluate(() => JSON.stringify({ key: studio64.engine.areaKey(), mario: P.mario() && [P.mario().x, P.mario().y, P.mario().z].map(Math.round) })));
await page.evaluate(() => { const e = studio64.engine; e.resize = () => {}; P.res = (w, h) => e.M._studio_resize(w, h); P.freeze(); e.M._studio_set_paused(0, 1); P.res(1280, 720); });
await page.evaluate(() => P.step(30));
await page.screenshot({ path: `${out}/page.jpg` });
if (process.env.TEX) {
  const r = await page.evaluate((q) => studio64.studio.handle('texture_search', { query: q, here: !q, limit: 64 }), process.env.TEXQ || '');
  fs.writeFileSync(`${out}/textures.json`, JSON.stringify(r.textures, null, 1));
  if (r.sheet) saveDataUrl(`${out}/textures.jpg`, r.sheet);
}
if (process.env.WATER) await page.evaluate((h) => { studio64.engine.M._studio_set_water(1, h); }, Number(process.env.WATER));
await page.evaluate(() => P.step(10));
let i = 0;
for (const v of (views || '').split(';').filter(Boolean)) {
  const [x, y, z, fx, fy, fz] = v.split(',').map(Number);
  await page.evaluate(([p, f]) => P.cam(true, p, f, 55), [[x, y, z], [fx, fy, fz]]);
  await sleep(800);
  saveDataUrl(`${out}/v${i++}.jpg`, await page.evaluate(() => P.stepShot(2, 'image/jpeg', 0.9)));
}
await page.evaluate(() => P.cam(false));
saveDataUrl(`${out}/mario.jpg`, await page.evaluate(() => P.stepShot(2, 'image/jpeg', 0.9)));
const objs = await page.evaluate(() => P.objects().map((o) => [o.bhv, Math.round(o.x), Math.round(o.y), Math.round(o.z)]));
fs.writeFileSync(`${out}/objects.json`, JSON.stringify(objs));
await browser.close();
