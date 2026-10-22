// A long session: many level jumps, build mode round trips and edits. Memory (JS heap, wasm
// heap, DOM nodes, engine listeners) must stay bounded and nothing may error or crash.
// @tags stability
// @timeout 900
import { suite } from '../lib/harness.mjs';

const probe = (s) => s.eval(() => ({
  js: performance.memory?.usedJSHeapSize || 0,
  wasm: window.Module?.HEAPU8?.length || 0,
  dom: document.getElementsByTagName('*').length,
  listeners: Object.values(studio64.engine.listeners).reduce((n, l) => n + l.length, 0),
  objects: studio64.engine.objects().length,
}));

await suite('session', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  const lvl = await s.newLevel('meadow', 'Session level');
  await s.play();
  const route = [9, 24, 'c', 12, 9, 'c', 5, 24, 'c', 9];
  // warm-up round, then the measured rounds
  const samples = [];
  for (let round = 0; round < 3; round++) {
    for (const r of route) {
      if (r === 'c') await s.goCustom(lvl); else await s.goLevel(r);
      // build mode round trip with an edit and its undo
      await s.build();
      await s.eval(() => {
        const ed = studio64.editor, m = studio64.engine.state().mario;
        const rec = { uid: ed.newUid(), block: { shape: 0, sx: 200, sy: 100, sz: 200, steps: 8, top: 3, side: 3, surface: 0, flags: 0, color: 0xffffff }, x: m.x + 300, y: m.y, z: m.z, yaw: 0, pitch: 0, roll: 0, name: 'Test box' };
        studio64.engine.spawn(rec);
        ed.records().push(rec);
        ed.commit({ type: 'add', summary: 'Placed Test box', records: [rec] });
      });
      await s.wait(400);
      await page.keyboard.press('Control+z');
      await s.wait(400);
      await s.play();
      t.check(`round ${round} level ${r}: running`, !(await s.crashed()) && await s.framesAdvance(400));
    }
    await s.eval(() => window.gc?.());
    samples.push(await probe(s));
    t.log(`round ${round}`, JSON.stringify(samples[samples.length - 1]));
  }
  const [a, , c] = samples;
  t.check('JS heap stays bounded (< +40 MB over 2 rounds)', c.js - a.js < 40e6, { a: a.js, c: c.js });
  t.check('wasm memory stays bounded (< +64 MB over 2 rounds)', c.wasm - a.wasm < 64e6, { a: a.wasm, c: c.wasm });
  t.check('DOM does not keep growing', c.dom - a.dom < 400, { a: a.dom, c: c.dom });
  t.check('engine listeners do not pile up', c.listeners - a.listeners <= 2, { a: a.listeners, c: c.listeners });
  t.eq('every test edit was undone', (await s.changes()).filter((x) => /Test box/.test(x)).length, 0);
});
