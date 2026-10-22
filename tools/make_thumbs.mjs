// Render a thumbnail for every catalog object: web/thumbs/<id>.webp + index.json.
// Needs the server running (npm start). Usage: node tools/make_thumbs.mjs [ids...]
import { launchBrowser } from './lib/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || (process.env.STUDIO_URL || 'http://127.0.0.1:8064');
const OUT = path.resolve('web/thumbs');
fs.mkdirSync(OUT, { recursive: true });
const cat = JSON.parse(fs.readFileSync('server/data/catalog.json', 'utf8'));
const only = process.argv.slice(2);
// Tokyo's objects (tools/import_shoggoth_tokyo.mjs) carry their models by geo layout; the city itself is too big for a picture
const TOKYO_PIC = (e) => e.id.startsWith('tokyo:') && e.gfx && e.id !== 'tokyo:city';
const ids = cat.entries
  // (the ported characters, the cars and the Shotgun draw their own geo layout too: MODEL_NONE, but a picture)
  .filter((e) => only.length ? only.includes(e.id) : ((e.model !== 'MODEL_NONE' || TOKYO_PIC(e) || /^(sms|sg|kt|vehicle):/.test(e.id)) && !e.id.startsWith('static_object')))
  .map((e) => e.id);
const file = (id) => path.join(OUT, id.replace(/:/g, '__') + '.webp');

const browser = await launchBrowser({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const proj = await (await fetch(BASE + '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 9 }) })).json();
let page;
async function openPage() {
  if (page) await page.close().catch(() => {});
page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${BASE}/?p=${proj.id}`);
await page.waitForSelector('#loading', { state: 'hidden', timeout: 300000 }); // (a slow or busy machine boots the game slowly)
await page.waitForTimeout(1500);

await page.evaluate(() => {
  const E = studio64.engine;
  E.setPaused(true, true);
  E.resize(512, 512);
  window.__thumb = async (id, dist, inside) => {
    // outside the level there is no ground (so no shadows); some objects delete
    // themselves without ground, so they get a second try above the level
    const P = inside ? [0, 9000, 0] : [26000, 6000, 26000];
    const cam = (d) => E.setCamera(true, [P[0], P[1] + 80 + d * 0.25, P[2] + d], [P[0], P[1] + 70, P[2]], 40);
    const shot = async () => {
      const c = await E.captureFrame(2);
      return c.getContext('2d').getImageData(0, 0, c.width, c.height);
    };
    for (const d of [dist, dist * 2.4, dist * 6]) {
      cam(d);
      const bg = await shot();
      const slot = E.spawn({ uid: 999, entry: id, x: P[0], y: P[1], z: P[2], yaw: 0x1600, pitch: 0, roll: 0, bparams: studio64.studio.parseParams(studio64.studio.entries.get(id)?.params?.[0]) || 0, scale: 1 });
      if (slot < 0) return null;
      // let the behavior run its init and a couple of animation frames, then freeze again
      E.setPaused(false, true);
      await E.captureFrame(2);
      E.setPaused(true, true);
      const o = E.objects().find((x) => x.uid === 999);
      if (o) E.transform(o.slot, P[0], P[1], P[2], 0, 0x1600, 0, 0);
      const img = await shot();
      E.deleteUid(999);
      const W = img.width, H = img.height;
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      const mask = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) {
        const k = i * 4;
        const diff = Math.abs(img.data[k] - bg.data[k]) + Math.abs(img.data[k + 1] - bg.data[k + 1]) + Math.abs(img.data[k + 2] - bg.data[k + 2]);
        if (diff > 24) {
          mask[i] = Math.min(255, diff * 3);
          const x = i % W, y = (i / W) | 0;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
      if (x1 < 0) return null; // nothing visible
      // trimmed bounds: ignore stray specks such as a shadow far below
      {
        const cols = new Float64Array(W), rows = new Float64Array(H);
        let total = 0;
        for (let i = 0; i < W * H; i++) if (mask[i]) { cols[i % W]++; rows[(i / W) | 0]++; total++; }
        const cut = (arr) => { let a = 0, b = arr.length - 1, s = 0; while (a < b && (s += arr[a]) < total * 0.005) a++; s = 0; while (b > a && (s += arr[b]) < total * 0.005) b--; return [a, b]; };
        [x0, x1] = cut(cols); [y0, y1] = cut(rows);
      }
      const touches = x0 <= 1 || y0 <= 1 || x1 >= W - 2 || y1 >= H - 2;
      if (touches && d !== dist * 6) continue;
      // transparent background, square crop with padding
      const out = new ImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        const k = i * 4;
        out.data[k] = img.data[k]; out.data[k + 1] = img.data[k + 1]; out.data[k + 2] = img.data[k + 2];
        out.data[k + 3] = mask[i];
      }
      const full = document.createElement('canvas'); full.width = W; full.height = H;
      full.getContext('2d').putImageData(out, 0, 0);
      const size = Math.max(x1 - x0, y1 - y0) * 1.15 + 8;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const t = document.createElement('canvas'); t.width = t.height = 160;
      const g = t.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(full, cx - size / 2, cy - size / 2, size, size, 0, 0, 160, 160);
      return t.toDataURL('image/webp', 0.86);
    }
    return null;
  };
});

}
await openPage();

const made = [];
let n = 0;
const healthy = () => page.evaluate(() => !studio64.engine.crashed && studio64.engine.level === 9).catch(() => false);
for (const id of ids) {
  n++;
  if (!only.length && fs.existsSync(file(id))) { made.push(id); continue; }
  if (!(await healthy())) { console.log('reloading before', id); await openPage(); }
  let url = null;
  try {
    url = await Promise.race([page.evaluate(([id]) => __thumb(id, 650, false), [id]), new Promise((ok) => setTimeout(() => ok('TIMEOUT'), Number(process.env.THUMB_TIMEOUT || 8000)))]);
    if (!url) url = await Promise.race([page.evaluate(([id]) => __thumb(id, 650, true), [id]), new Promise((ok) => setTimeout(() => ok('TIMEOUT'), Number(process.env.THUMB_TIMEOUT || 8000)))]);
  } catch (e) { url = null; }
  if (url === 'TIMEOUT') { console.log('timeout', id); if (process.env.THUMB_PROGRESS) console.log(`${n}/${ids.length}`); await openPage(); continue; }
  if (url) {
    fs.writeFileSync(file(id), Buffer.from(url.split(',')[1], 'base64'));
    made.push(id);
  }
  if (n % 50 === 0 || process.env.THUMB_PROGRESS) console.log(`${n}/${ids.length}`); // THUMB_PROGRESS: every object (the setup's progress bar)
}
const indexFile = path.join(OUT, 'index.json');
const prev = only.length && fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : [];
fs.writeFileSync(indexFile, JSON.stringify([...new Set([...prev, ...made])].sort()));
console.log(`thumbnails: ${made.length}/${ids.length}`);
await browser.close();
