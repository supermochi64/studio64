// The town drained and cleared: a floor-height map (where streets, squares and roofs are).
import { openStudio, sleep, saveDataUrl } from '../scripts/lib.mjs';
import fs from 'node:fs';
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const { browser, page } = await openStudio({ level: 11, name: 'City scout', viewport: { width: 1280, height: 720 } });
await page.evaluate(() => studio64.engine.teleport(352, -1250, -3327, 16384));
for (let i = 0; i < 60; i++) { await sleep(500); if (await page.evaluate(() => studio64.engine.area === 2)) break; }
await sleep(2500);
const grid = await page.evaluate(() => {
  const e = studio64.engine; e.M._studio_set_water(1, -6000);
  const out = [];
  for (let z = -3800; z <= 3840; z += 40) { const row = []; for (let x = -3840; x <= 4560; x += 40) row.push(Math.round(e.floor(x, 3000, z))); out.push(row); }
  return out;
});
fs.writeFileSync(`${OUT}/floor.json`, JSON.stringify(grid));
await browser.close();
