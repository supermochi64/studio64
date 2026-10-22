// Phase B: the fight, filmed frame by frame with free-camera rigs, full resolution, game audio tap.
//   node promo/scripts/capture_fight.mjs <project> <outDir> [passes json]
// One browser session: Bowser and the mines Claude placed are re-spawned (so his arrival plays),
// the state is saved, a fast low-res rehearsal of the bot fight finds the moments (grab, spin,
// release, hit), then every pass replays the same take from the saved state (deterministic) and
// films its frame ranges with its rigs.
import { openStudio, saveDataUrl } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const PROJECT = process.argv[2];
const OUT = process.argv[3] || new URL('../work/cap/fight', import.meta.url).pathname;
const W = Number(process.env.CAP_W || 2880), H = Math.round((W * 9) / 16);
const ONLY = (process.env.PASSES || '').split(',').filter(Boolean);
fs.mkdirSync(OUT, { recursive: true });
const { browser, page } = await openStudio({ project: PROJECT, viewport: { width: 1280, height: 720 } });
await page.addScriptTag({ path: path.join(here, 'bot.js') });
await page.addScriptTag({ path: path.join(here, 'rigs.js') });
const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(() => {
  const e = studio64.engine;
  e.resize = () => {}; // the page layout must not change the film's resolution
  P.res = (w, h) => e.M._studio_resize(w, h);
  P.freeze();
  e.M._studio_set_paused(0, 1); // no HUD
});
await ev(() => P.step(2));
// re-spawn Bowser and the mines from the project (his arrival: puff + roar), Mario back at the start
const setup = await ev(() => {
  const recs = studio64.editor.records().filter((r) => r.entry === 'bowser' || r.entry === 'bowser_bomb');
  for (const r of recs) studio64.engine.deleteUid(r.uid);
  studio64.engine.teleport(-1328, 260, 4664, 0x8000);
  const slots = recs.map((r) => [r.entry, studio64.engine.spawn(r), r.x, r.y, r.z]);
  return { recs: recs.length, slots };
});
console.log('setup', JSON.stringify(setup));
await ev(() => P.step(1));
await ev(() => studio64.testing.saveState(0));
const bowserSlot = setup.slots.find((s) => s[0] === 'bowser')[1];
const home = setup.slots.find((s) => s[0] === 'bowser').slice(2);
const FIGHT = { bowser: bowserSlot, pickTarget: [0, -1], ...(JSON.parse(process.env.FIGHT || '{}')) };

async function runTo(maxF, perFrame) {
  await ev(([o]) => P.fightInit(o), [FIGHT]);
  for (let f = 0; f < maxF; f++) {
    const st = await ev(() => P.botTick());
    const r = await perFrame(f, st);
    if (r === 'stop') return f;
  }
  return maxF;
}

// ---- rehearsal (low res, no film): bot settings are tried until one take hits ----
const VARIANTS = [{}, { R: 470 }, { waitAfter: 12, R: 500 }, { R: 620, nearMag: 52 }, { waitAfter: 30 }];
let E = {}, log = [], events = [];
for (const [vi, v] of VARIANTS.entries()) {
  await ev(() => studio64.testing.loadState(0));
  await ev(() => { P.freeze(); studio64.engine.M._studio_set_paused(0, 1); });
  await ev(() => P.res(480, 270));
  Object.assign(FIGHT, v);
  log = [];
  await runTo(Number(process.env.REH_FRAMES || 500), async (f, st) => {
    log.push(st);
    await ev(() => P.step(1));
    const thrown = log.filter((x) => x.phase === 'thrown').length;
    if (thrown > 40 || (f > 120 && st.hp <= 3)) return 'stop';
  });
  events = await ev(() => P.F.events);
  const e1 = (n) => events.find((x) => x.name === n)?.t;
  E = { grab: e1('spin'), release: e1('thrown'), target: events.find((x) => x.name === 'target') };
  const hitIdx = log.findIndex((x, i) => i && x.bhp < log[i - 1].bhp);
  E.hit = hitIdx >= 0 ? log[hitIdx].t : null;
  E.circle = e1('circle');
  E.mhp = Math.min(...log.map((x) => x.hp));
  console.log('events', vi, JSON.stringify(v), JSON.stringify(E));
  if (E.release && E.hit && E.mhp >= 6) break;
}
E.fight = { ...FIGHT };
fs.writeFileSync(`${OUT}/rehearsal.json`, JSON.stringify({ E, events, log, home, setup }, null, 0));
if (!E.release || !E.hit) { console.log('NO HIT in the rehearsal; stop'); await browser.close(); process.exit(2); }

// ---- passes ----
const tgt = [E.target.x, 0, E.target.z];
const R = E.release, Hh = E.hit, G = E.grab, C = E.circle;
const PASSES = {
  main: { tap: true, end: Hh + 75, shots: [
    [0, 80, 'reveal'], [80, C - 2, 'villain'], [C - 2, G - 6, 'track', { side: 70 }], [G - 6, G + 14, 'grab'],
    [G + 14, R - 8, 'spin', { a0: 200, speed: 1.4, r: 1300, push: 3 }], [R - 8, Hh + 4, 'throwback'], [Hh + 4, Hh + 75, 'blast']] },
  alt: { end: Hh + 40, shots: [
    [G + 30, R - 2, 'spin', { a0: 20, speed: -2.0, r: 1050, h: 60, fov: 56, push: 1 }], [R - 2, Hh + 40, 'incoming', { lean: 0.25 }]] },
  hook: { end: Hh + 30, shots: [[R - 26, Hh + 30, 'incoming', { lean: 0.55 }]] },
  bullet: { end: Hh + 3, bullet: { frames: 70, r: 1300, h: 300, speed: 1.6, a0: 0 } },
};
for (const [name, p] of Object.entries(PASSES)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const dir = `${OUT}/${name}`;
  fs.mkdirSync(dir, { recursive: true });
  await ev(() => studio64.testing.loadState(0));
  await ev(() => { P.freeze(); studio64.engine.M._studio_set_paused(0, 1); P.rigState = {}; });
  if (p.tap) await ev(() => P.tap(true, 0));
  const audio = [];
  const meta = [];
  const shotAt = (f) => p.shots?.find((s) => f >= s[0] && f < s[1]);
  let curRes = 0;
  const t0 = Date.now();
  await runTo(p.end, async (f, st) => {
    const s = shotAt(f);
    const want = s ? 1 : 0;
    if (want !== curRes) { await ev(([w, h]) => P.res(w, h), want ? [W, H] : [480, 270]); curRes = want; }
    let cam = null;
    if (s) {
      cam = await ev(([name, c]) => {
        const m = P.mario(), b = P.obj(c.bowser);
        return P.rigApply(name, { ...c, f: c.f, M: [m.x, m.y, m.z], myaw: m.yaw, B: [b.x, b.y, b.z], byaw0: c.byaw0 });
      }, [s[2], { f, start: s[0], opt: s[3] || {}, home, target: tgt, bowser: bowserSlot, mstart: [-1328, 260, 4664] }]);
      const url = await ev(() => P.stepShot(1, 'image/jpeg', 0.93));
      saveDataUrl(`${dir}/${String(f).padStart(4, '0')}.jpg`, url);
    } else {
      await ev(() => P.cam(false));
      await ev(() => P.step(1));
    }
    if (p.tap) audio.push(Buffer.from(await ev(() => P.tapRead()), 'base64'));
    meta.push({ f, shot: s ? s[2] : null, cam, st });
    if (f % 50 === 0) console.log(name, f, s ? s[2] : '-', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  });
  if (p.bullet) {
    const b = p.bullet;
    await ev(([w, h]) => P.res(w, h), [W, H]);
    const ctr = await ev((s) => { const o = P.obj(s); return [o.x, o.y, o.z]; }, bowserSlot);
    const tc = [(ctr[0] + tgt[0]) / 2, ctr[1], (ctr[2] + tgt[2]) / 2];
    await ev(() => studio64.engine.M._studio_set_paused(1, 1));
    for (let k = 0; k < b.frames; k++) {
      await ev(([c]) => P.rigApply('bullet', c), [{ f: k, start: 0, opt: { ...b, center: tc }, B: ctr }]);
      const url = await ev(() => P.stepShot(1, 'image/jpeg', 0.93));
      saveDataUrl(`${dir}/b${String(k).padStart(4, '0')}.jpg`, url);
    }
    await ev(() => studio64.engine.M._studio_set_paused(0, 1));
  }
  if (p.tap) {
    fs.writeFileSync(`${dir}/audio.s16le`, Buffer.concat(audio));
    fs.writeFileSync(`${dir}/audio_frames.json`, JSON.stringify(audio.map((a) => a.length / 4)));
    await ev(() => P.tap(false));
  }
  fs.writeFileSync(`${dir}/meta.json`, JSON.stringify({ E, home, target: tgt, shots: p.shots, meta }));
  console.log('pass', name, 'done', ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
await browser.close();
