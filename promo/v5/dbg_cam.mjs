import { openStudio, sleep } from '../scripts/lib.mjs';
const { browser, page } = await openStudio({ level: 9, project: process.env.PROJECT, viewport: { width: 1280, height: 720 } });
const ev = (fn, a) => page.evaluate(fn, a);
await sleep(3000);
await ev(() => { const l = studio64.levels.find((x) => x.template === 'tokyo'); studio64.worldFlow.goArea({ custom: l.id, area: 1 }); });
for (let i = 0; i < 240; i++) { await sleep(500); const ok = await ev(() => { const e = studio64.engine; try { return e.level === 37 && !e.inIntro && !!e.state().mario; } catch { return false; } }); if (ok) break; }
await sleep(5000);
console.log(await ev(async () => {
  const e = studio64.engine, out = [];
  out.push(['level', e.level, e.areaKey(), 'editor', !!studio64.editor?.active, 'cut', !!studio64.story?.cut]);
  P.cam(true, [-3000, 800, 3000], [-3900, 100, 3500], 50);
  await P.step(3);
  out.push(['camOut', e.camOut().pos.map(Math.round)]);
  P.freeze(); await P.step(3);
  out.push(['camOut frozen', e.camOut().pos.map(Math.round)]);
  return JSON.stringify(out);
}));
await browser.close();
