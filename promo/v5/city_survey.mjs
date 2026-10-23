// Camera survey of the revived town (project already dressed): CAMS='[[name,[pos],[focus],fov],...]'
import { openStudio, sleep, saveDataUrl } from '../scripts/lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import * as L from './city_layout.mjs';
const OUT = process.argv[2], HERE = path.dirname(new URL(import.meta.url).pathname);
fs.mkdirSync(OUT, { recursive: true });
const { browser, page } = await openStudio({ level: 11, project: process.env.PROJECT, viewport: { width: 1280, height: 720 } });
await page.evaluate(() => studio64.engine.teleport(352, -1250, -3327, 16384));
for (let i = 0; i < 60; i++) { await sleep(500); if (await page.evaluate(() => studio64.engine.area === 2)) break; }
await sleep(2500);
await page.addScriptTag({ path: `${HERE}/city.js` });
const ev = (fn, a) => page.evaluate(fn, a);
await ev(() => { const e = studio64.engine; e.resize = () => {}; P.res = (w, h) => e.M._studio_resize(w, h); });
await ev(() => CITY.clear());
await ev(() => CITY.drain());
for (const [i, [a, b]] of L.BUNTING.entries()) await ev(([i, a, b]) => CITY.bunting('b' + i, a, b), [i, a, b]);
await ev((t) => CITY.toads(t), L.TOADS);
await ev((b) => CITY.butterflies(b), L.BUTTERFLIES);
const m = JSON.parse(process.env.MARIO || 'null');
if (m) await ev((m) => studio64.engine.teleport(m[0], m[1], m[2], m[3]), m);
await sleep(3000);
await ev(() => { P.freeze(); studio64.engine.M._studio_set_paused(0, 1); P.res(1280, 720); });
for (const [name, pos, focus, fov = 50] of JSON.parse(process.env.CAMS)) {
  await ev(([p, f, v]) => P.cam(true, p, f, v), [pos, focus, fov]);
  await ev(() => P.step(3));
  saveDataUrl(`${OUT}/${name}.jpg`, await ev(() => P.stepShot(1, 'image/jpeg', 0.9)));
}
await browser.close();
