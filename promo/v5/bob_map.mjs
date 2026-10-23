import { openStudio } from '../scripts/lib.mjs';
import fs from 'node:fs';
const { browser, page } = await openStudio({ level: 9, name: 'Map', viewport: { width: 1280, height: 720 } });
const g = await page.evaluate(() => { const e = studio64.engine, out = [];
  for (let z = 1500; z <= 7600; z += 50) { const r = []; for (let x = -7600; x <= -1500; x += 50) r.push(Math.round(e.floor(x, 3000, z))); out.push(r); } return out; });
fs.writeFileSync(process.argv[2], JSON.stringify(g));
await browser.close();
