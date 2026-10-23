// Review stills of the city: before (flooded) and after (revived), from the planned cameras.
import { openStudio, sleep, saveDataUrl } from '../scripts/lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import * as L from './city_layout.mjs';
const OUT = process.argv[2], HERE = path.dirname(new URL(import.meta.url).pathname);
const ONLY = process.env.ONLY || 'before,after';
fs.mkdirSync(OUT, { recursive: true });
const { browser, page, id } = await openStudio({ level: 11, project: process.env.PROJECT, name: 'City reborn', viewport: { width: 1280, height: 720 } });
console.log('project', id);
await page.evaluate(() => studio64.engine.teleport(352, -1250, -3327, 16384));
for (let i = 0; i < 60; i++) { await sleep(500); if (await page.evaluate(() => studio64.engine.area === 2)) break; }
await sleep(2500);
await page.addScriptTag({ path: `${HERE}/city.js` });
const ev = (fn, a) => page.evaluate(fn, a);
await ev(() => { const e = studio64.engine; e.resize = () => {}; P.res = (w, h) => e.M._studio_resize(w, h); });
await ev(() => CITY.clear());
await ev((m) => studio64.engine.teleport(...m.slice(0, 3), m[3]), JSON.parse(process.env.MARIO || 'null') || L.MARIO_RIM);
await sleep(2000);
await ev(() => { P.freeze(); studio64.engine.M._studio_set_paused(0, 1); P.res(1280, 720); });
const CAMS = process.env.CAMS ? JSON.parse(process.env.CAMS) : Object.entries(L.CAMS).map(([n, [p, f]]) => [n, p, f, 52]);
async function shots(tag) {
  for (const [name, pos, focus, fov = 52] of CAMS) {
    await ev(([p, f, v]) => P.cam(true, p, f, v), [pos, focus, fov]);
    await ev(() => P.step(4));
    saveDataUrl(`${OUT}/${tag}_${name}.jpg`, await ev(() => P.stepShot(1, 'image/jpeg', 0.9)));
  }
  await ev(() => P.cam(false));
}
if (ONLY.includes('before')) { await ev(() => P.run()); await ev(() => CITY.flood()); await sleep(1500); await ev(() => P.freeze()); await shots('before'); }
if (ONLY.includes('after')) {
  await ev(() => P.run());
  await ev(() => CITY.drain());
  const dir = `${HERE}/art/city`, man = JSON.parse(fs.readFileSync(`${dir}/manifest.json`, 'utf8'));
  const files = Object.fromEntries(Object.entries(man).map(([p, f]) => [p, 'data:image/png;base64,' + fs.readFileSync(`${dir}/${f}`).toString('base64')]));
  console.log('textures', await ev((f) => CITY.textures(f), files));
  await ev((L) => { CITY.plant(L.PLANTS); for (const pts of L.LAMPS) CITY.lamps(pts); }, { PLANTS: L.PLANTS, LAMPS: L.LAMPS });
  for (const [i, [a, b]] of L.BUNTING.entries()) await ev(([i, a, b]) => CITY.bunting('b' + i, a, b), [i, a, b]);
  console.log('toads', await ev((t) => CITY.toads(t), L.TOADS));
  console.log('butterflies', await ev((b) => CITY.butterflies(b), L.BUTTERFLIES));
  await sleep(4000);
  await ev(() => P.freeze());
  await ev(() => P.step(30));
  await shots('after');
}
await browser.close();
