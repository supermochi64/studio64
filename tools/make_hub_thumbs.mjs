// Pictures for the home screen's start cards (web/thumbs/hub/), rendered in the game.
//   STUDIO_URL=http://127.0.0.1:8064 node tools/make_hub_thumbs.mjs
import { launchBrowser } from './lib/browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.STUDIO_URL || 'http://127.0.0.1:8064';
const OUT = path.join(ROOT, 'web/thumbs/hub');
fs.mkdirSync(OUT, { recursive: true });
const SHOTS = [
  { file: 'castle.jpg', level: 16, pos: [-1450, 760, 5300], focus: [-200, 1150, -400], fov: 52 },
];
const { id } = await fetch(`${BASE}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 16, name: 'hub thumbs' }) }).then((r) => r.json());
const browser = await launchBrowser({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${BASE}/?p=${id}`);
await page.waitForFunction(() => window.studio64?.engine?.ready && studio64.editor && document.querySelector('#loading').hidden, null, { timeout: 300000 });
for (const s of SHOTS) {
  await page.evaluate(async (s) => {
    const e = studio64.engine;
    if (e.level !== s.level) { e.warpFast(s.level, 0, null, false); await e.waitArrival(s.level); }
    studio64.editor.enter();
    await new Promise((r) => setTimeout(r, 400));
    studio64.editor.active = false; // keep the camera where we put it
    e.setCamera(true, s.pos, s.focus, s.fov);
  }, s);
  await page.waitForTimeout(2500);
  const url = await page.evaluate(async () => {
    const c = await studio64.engine.captureFrame(2);
    const o = document.createElement('canvas');
    o.width = 640; o.height = 360;
    const k = Math.max(640 / c.width, 360 / c.height);
    o.getContext('2d').drawImage(c, (640 - c.width * k) / 2, (360 - c.height * k) / 2, c.width * k, c.height * k);
    return o.toDataURL('image/jpeg', 0.85);
  });
  fs.writeFileSync(path.join(OUT, s.file), Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', s.file);
}
await browser.close();
await fetch(`${BASE}/api/projects/${id}`, { method: 'DELETE' });
