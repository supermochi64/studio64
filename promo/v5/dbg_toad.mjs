import { openStudio, sleep } from '../scripts/lib.mjs';
import path from 'node:path';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const { browser, page } = await openStudio({ level: 11, project: process.env.PROJECT, viewport: { width: 1280, height: 720 } });
await page.evaluate(() => studio64.engine.teleport(352, -1250, -3327, 16384));
for (let i = 0; i < 60; i++) { await sleep(500); if (await page.evaluate(() => studio64.engine.area === 2)) break; }
await sleep(2500);
await page.addScriptTag({ path: `${HERE}/city.js` });
console.log(await page.evaluate(async () => {
  CITY.drain();
  const s = CITY.toads([[-1250, 650, 80, 6]]);
  const b = CITY.butterflies([[-740, 520, 110]]);
  const g = P.spawn({ uid: 0x7d200001, entry: 'goomba', x: -1100, y: -2560, z: 650, yaw: 0 });
  await new Promise((r) => setTimeout(r, 1500));
  return JSON.stringify({ toad: P.obj(s[0]), bf: P.obj(b[0]), goomba: P.obj(g) });
}));
await browser.close();
