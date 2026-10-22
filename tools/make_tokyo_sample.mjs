// The "Tokyo" sample hack (server/samples/tokyo.s64hack): Tokyo from Shoggoth World
// as a Studio 64 hack, made with the Tokyo level template in the real studio, given a cover picture
// and exported (web/data/shoggoth/tokyo.json ships with Studio 64: tools/import_shoggoth_tokyo.mjs made it).
//   STUDIO_URL=http://127.0.0.1:8064 node tools/make_tokyo_sample.mjs
// (or `npm run samples`, which starts its own server and makes every sample)
import fs from 'node:fs';
import path from 'node:path';
import { suite, ROOT, URL_BASE } from '../tests/lib/harness.mjs';

if (!fs.existsSync(path.join(ROOT, 'web', 'data', 'shoggoth', 'tokyo.json'))) {
  console.log('No Tokyo data (web/data/shoggoth/tokyo.json is missing): no Tokyo sample');
  process.exit(0);
}

await suite('make the tokyo sample', async (t) => {
  const s = await t.open({ level: 9 });
  t.must('the engine has Tokyo', await s.eval(() => studio64.engine.entryIndex.has('tokyo:city')));
  await s.markArea();
  const id = await s.eval(async () => (await import('/js/tokyo_template.js')).createTokyoLevel(studio64.levelsUI, 'Tokyo'));
  await s.skipIntro();
  await s.arriveNew(37, 120000);
  await s.wait(3000);
  const check = await s.eval(() => { const c = studio64.testing.runCheck(); return c.problems.filter((p) => p.severity === 'error').map((p) => `${p.level}: ${p.title}`); });
  t.check('the level check finds no errors', check.length === 0, check);

  // the cover: from above Hachiko Plaza over the scramble crossing and its screens
  const shot = await s.eval(async () => {
    const e = studio64.engine;
    if (!studio64.editor?.active) studio64.editor?.enter(); // (the free camera is build mode's)
    await new Promise((r) => setTimeout(r, 500));
    // build mode's camera, from above Hachiko Plaza towards the crossing (it draws every frame)
    const ed = studio64.editor, from = [-4700, 1250, 4600], to = [200, 650, -300];
    const d = [to[0] - from[0], to[1] - from[1], to[2] - from[2]], l = Math.hypot(...d);
    ed.setCamPos(from);
    ed.cam.yaw = Math.atan2(d[0], d[2]);
    ed.cam.pitch = Math.asin(d[1] / l);
    ed.cam.fov = 55;
    for (let i = 0; i < 40; i++) await e.captureFrame(0);
    const c = await e.captureFrame(2);
    const o = document.createElement('canvas');
    o.width = 960; o.height = 540;
    const k = Math.max(960 / c.width, 540 / c.height);
    o.getContext('2d').drawImage(c, (960 - c.width * k) / 2, (540 - c.height * k) / 2, c.width * k, c.height * k);
    studio64.editor?.exit();
    return o.toDataURL('image/jpeg', 0.86);
  });
  await fetch(`${URL_BASE}/api/projects/${s.projectId}/meta`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Tokyo', author: 'Shoggoth World', cover: shot, boot: { level: 16, custom: id },
      description: 'Tokyo by night from Shoggoth World: the scramble crossing, neon and Japanese signs, traffic, a commuter train, the shrine, the canal, yokai, a construction crane to climb and eight red coins. Play it, or keep building on it.',
    }),
  });
  await s.wait(1500);
  const buf = Buffer.from(await (await fetch(`${URL_BASE}/api/projects/${s.projectId}/export.s64hack?chat=0`)).arrayBuffer());
  const out = path.join(ROOT, 'server', 'samples', 'tokyo.s64hack');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  t.check(`wrote ${path.relative(ROOT, out)} (${(buf.length / 1024).toFixed(0)} KB)`, buf.length > 1000);
  await fetch(`${URL_BASE}/api/projects/${s.projectId}`, { method: 'DELETE' });
}, { timeout: 1200000 });
