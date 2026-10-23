import { openStudio, sleep } from '../scripts/lib.mjs';
import fs from 'node:fs';
const { browser, page } = await openStudio({ level: 9, name: 'Race scout', viewport: { width: 1280, height: 720 } });
const ev = (fn, a) => page.evaluate(fn, a);
await ev(() => P.spawn({ uid: 0x7d600001, entry: 'koopa', bparams: 0x01020000, x: -4004, y: 0, z: 5221, yaw: 0 }));
await sleep(2000);
const r = await ev(async () => {
  const k = P.objects().filter((o) => o.bhv === 'bhvKoopa' || /Koopa/.test(o.bhv)).map((o) => ({ slot: o.slot, bhv: o.bhv, x: o.x, y: o.y, z: o.z, uid: o.uid }));
  const infos = [];
  for (const o of k) { try { infos.push([o, await studio64.studio.handle('objects_path_info', { slot: o.slot })]); } catch (e) { infos.push([o, String(e.message)]); } }
  return { mario: P.mario(), infos };
});
fs.writeFileSync(process.argv[2], JSON.stringify(r, null, 1));
console.log(JSON.stringify(r).slice(0, 1500));
await browser.close();
