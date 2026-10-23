// The katana beat: Tokyo (the Shoggoth World template) at night, Mario with the katana against Goombas.
//   node tokyo_cap.mjs OUTDIR [scout|fight]
import { openStudio, sleep, saveDataUrl } from '../scripts/lib.mjs';
import fs from 'node:fs';
import { setup, shot, hunt } from './rec.mjs';
const [OUT, mode = 'fight'] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const { browser, page, id } = await openStudio({ level: 9, project: process.env.PROJECT, name: 'Tokyo katana', viewport: { width: 1280, height: 720 } });
const ev = (fn, a) => page.evaluate(fn, a);
if (!process.env.PROJECT) {
  await ev(async () => { const m = await import('/js/tokyo_template.js'); await m.createTokyoLevel(studio64.levelsUI, 'Tokyo'); });
  console.log('project', id);
}
for (let i = 0; i < 240; i++) { await sleep(500); const ok = await ev(() => { const e = studio64.engine; try { return e.level === 37 && !e.inIntro && !!e.state().mario; } catch { return false; } }); if (ok) break; }
await ev(() => { if (studio64.editor?.active) studio64.editor.exit(); });
await sleep(6000);
await setup(page);
const start = JSON.parse(process.env.START || 'null');
if (start) { await ev((s) => studio64.engine.teleport(s[0], studio64.engine.floor(s[0], s[1] + 400, s[2]) + 5, s[2], s[3]), start); await sleep(2500); }
const m0 = await ev(() => P.mario());
console.log('mario', Math.round(m0.x), Math.round(m0.y), Math.round(m0.z), m0.yaw);
if (mode === 'scout') {
  await ev(() => { P.freeze(); studio64.engine.M._studio_set_paused(0, 1); P.res(1280, 720); });
  for (const [k, yawOff] of [[0, 0], [1, 16384], [2, 32768], [3, 49152]]) {
    const a = ((m0.yaw + yawOff) * Math.PI) / 32768;
    await ev(([m, a]) => P.cam(true, [m.x - Math.sin(a) * 500, m.y + 260, m.z - Math.cos(a) * 500], [m.x + Math.sin(a) * 900, m.y + 120, m.z + Math.cos(a) * 900], 60), [m0, a]);
    saveDataUrl(`${OUT}/tk_scout${k}.jpg`, await ev(() => P.stepShot(2, 'image/jpeg', 0.9)));
  }
  // what is ahead: the floor along four directions
  const probe = await ev((m) => [0, 16384, 32768, 49152].map((o) => { const a = ((m.yaw + o) * Math.PI) / 32768; return [o, [300, 600, 900, 1200].map((d) => Math.round(studio64.engine.floor(m.x + Math.sin(a) * d, m.y + 300, m.z + Math.cos(a) * d)))]; }), m0);
  console.log(JSON.stringify(probe));
}
if (mode === 'fight') {
  // Goombas spread over the crossing ahead of him
  const a0 = (m0.yaw * Math.PI) / 32768;
  const G = [[380, -0.4], [520, 0.45], [650, -0.05], [420, 1.3], [560, -1.4], [700, 0.9], [820, 0.2], [900, -0.8], [760, 1.7]].map(([d, o]) => [m0.x + Math.sin(a0 + o) * d, m0.z + Math.cos(a0 + o) * d]);
  await ev((G) => G.forEach(([x, z], i) => P.spawn({ uid: 0x7d500000 + i, entry: 'goomba', x, y: studio64.engine.floor(x, 600, z), z, yaw: 0 })), G);
  await ev(() => studio64.engine.M._studio_katana_give(1));
  await ev(() => P.step(15));
  const fires = await hunt(page, `${OUT}/tokyo_katana`, { weapon: 'katana', range: 210, frames: Number(process.env.FRAMES || 220), camMode: 'orbit', orbit: { r: 640, h: 210, speed: 0.016, a0: a0 + Math.PI * 0.75 } });
  console.log('slashes', fires.length, fires.join(','));
}
await browser.close();
