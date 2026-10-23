import { openStudio, sleep } from '../scripts/lib.mjs';
import fs from 'node:fs';
const OUT = process.argv[2];
const { browser, page } = await openStudio({ level: 23, name: 'Sub scout', viewport: { width: 1280, height: 720 } });
await page.evaluate(() => studio64.engine.teleport(4200, -300, 0, 16384));
for (let i = 0; i < 60; i++) { await sleep(500); if (await page.evaluate(() => studio64.engine.area === 2)) break; }
await sleep(2500);
const r = await page.evaluate(() => {
  const e = studio64.engine, out = [];
  for (let z = -7000; z <= 7000; z += 100) { const row = []; for (let x = -6000; x <= 9000; x += 100) row.push(Math.round(e.floor(x, 4000, z))); out.push(row); }
  return { grid: out, deck: e.floor(3917, 3000, 870), deck2: e.floor(3917, 600, 2500), water: e.state().water ?? null, objs: P.objects().filter((o) => /Sub|Pole|Warp|Pipe/.test(o.bhv)).map((o) => [o.bhv, o.slot, o.x, o.y, o.z]) };
});
fs.writeFileSync(`${OUT}/ddd_floor.json`, JSON.stringify(r.grid));
console.log(JSON.stringify({ deck: r.deck, deck2: r.deck2, water: r.water, objs: r.objs }));
await browser.close();
