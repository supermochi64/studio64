// The "Showcase" sample hack (server/samples/showcase.s64hack): every feature in one project,
// built in the real studio with its own functions (tests/lib/showcase.mjs), checked with the
// level validator, given a cover picture and exported.
//   STUDIO_URL=http://127.0.0.1:8064 node tools/make_showcase_sample.mjs
// (or `npm run samples`, which starts its own server and makes every sample)
import fs from 'node:fs';
import path from 'node:path';
import { suite, ROOT, URL_BASE } from '../tests/lib/harness.mjs';
import { buildShowcase } from '../tests/lib/showcase.mjs';

await suite('make the showcase sample', async (t) => {
  const s = await t.open({ level: 9 });
  const sc = await buildShowcase(s, { log: (...a) => t.log(...a) });
  const check = await s.eval(() => { const c = studio64.testing.runCheck(); return c.problems.filter((p) => p.severity === 'error').map((p) => `${p.level}: ${p.title}`); });
  t.must('the level check finds no errors', check.length === 0, check);

  // the cover: the valley with the lift, the ledge and the star door
  const shot = await s.eval(async (sc) => {
    const e = studio64.engine, l = sc.v.liftAt, d = sc.doors.dinAt;
    const fx = (l.x + d.x) / 2, fz = (l.z + d.z) / 2;
    e.setCamera(true, [fx - 1500, l.y + 900, fz - 2300], [fx + 200, l.y + 350, fz + 200], 55);
    for (let i = 0; i < 40; i++) await e.captureFrame(0);
    const c = await e.captureFrame(2);
    const o = document.createElement('canvas');
    o.width = 960; o.height = 540;
    const k = Math.max(960 / c.width, 540 / c.height);
    o.getContext('2d').drawImage(c, (960 - c.width * k) / 2, (540 - c.height * k) / 2, c.width * k, c.height * k);
    e.setCamera(false);
    return o.toDataURL('image/jpeg', 0.86);
  }, sc);
  await fetch(`${URL_BASE}/api/projects/${s.projectId}/meta`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cover: shot }) });
  await s.wait(1500);
  const buf = Buffer.from(await (await fetch(`${URL_BASE}/api/projects/${s.projectId}/export.s64hack?chat=0`)).arrayBuffer());
  const out = path.join(ROOT, 'server', 'samples', 'showcase.s64hack');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  t.check(`wrote ${path.relative(ROOT, out)} (${(buf.length / 1024).toFixed(0)} KB)`, buf.length > 1000);
  await fetch(`${URL_BASE}/api/projects/${s.projectId}`, { method: 'DELETE' });
}, { timeout: 1200000 });
