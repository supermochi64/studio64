// The sample hacks of the home screen: each opens in its own level and the level check
// finds no errors.
// @tags projects
// @timeout 900
import { suite, api } from '../lib/harness.mjs';

await suite('sample hacks', async (t) => {
  const samples = await api('/api/hub/samples');
  t.must('there are sample hacks', samples.length >= 2, samples);
  for (const smp of samples) {
    const { id } = await api('/api/hub/create', { sample: smp.file });
    const s = await t.open({ project: id, start: false, label: smp.file.replace('.s64hack', '') });
    const own = smp.levels > 0; // hacks with levels of their own start in the first one
    await s.page.waitForFunction((own) => studio64.testing && (!own || studio64.engine.level === studio64.engine.studioLevel) && studio64.engine.state().mario && !studio64.engine.inIntro, own, { timeout: 120000 }).catch(() => {});
    await s.wait(2000);
    const r = await s.eval(() => { const c = studio64.testing.runCheck(); return { counts: c.counts, problems: c.problems.filter((p) => p.severity !== 'info').map((p) => `${p.severity}: ${p.title}`), custom: studio64.engine.level === studio64.engine.studioLevel, stars: studio64.world.stars().length }; });
    if (own) t.check(`${smp.name}: starts in its own level`, r.custom, r);
    const stars = own ? r.stars : await s.eval(() => Object.keys(studio64.engine.patch.areas).reduce((n, k) => n + studio64.world.stars(k).filter((x) => x.kind !== 'coins100').length, 0));
    t.check(`${smp.name}: has stars`, stars >= 2, stars);
    t.check(`${smp.name}: no errors in the level check`, r.counts.error === 0, r.problems);
    await s.shot('level');
    await s.page.close();
  }
});
