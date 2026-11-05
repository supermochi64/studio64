// Every Mario sound can be replaced (issue #8): the sound studio lists all of them under "Mario",
// grouped (voice, footsteps and landings per ground, moves, water, metal Mario); each one, replaced,
// plays the project's sound when the game plays it under any of its ids (random jump voices, the
// five ids of the triple jump, footsteps per ground), also when Mario really jumps. "Beta sounds"
// switches his voice to the clips of the game it never plays (the unused "Yah!" take, the 1996
// triple jump), is saved and comes back after a reload, and the ROM export writes its flag.
// @tags sound
// @timeout 600
import { suite, URL_BASE } from '../lib/harness.mjs';

const VOICE = 2;
const key = (bank, id) => ((bank << 28) | (id << 16)) >>> 0;

await suite('Mario sounds', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  await page.waitForFunction(() => studio64.soundUI?.gameSounds?.length > 300 && studio64.engine.M._studio_sfx_key(0x24000000) !== 0, null, { timeout: 60000 });
  const saved = () => fetch(`${URL_BASE}/api/projects/${s.projectId}/play.json`).then((r) => r.json());

  // ---- the list ------------------------------------------------------------------------------
  const mario = await s.eval(() => studio64.soundUI.gameSounds.filter((x) => x.group === 'Mario'));
  t.check('the studio lists Mario\'s sounds under "Mario" (150 or more)', mario.length >= 150, mario.length);
  const subs = [...new Set(mario.map((x) => x.sub))];
  t.eq('grouped', subs, ['Voice: jumps', 'Voice: punches & lifts', 'Voice: hurt', 'Voice: tired & sleepy', 'Voice: lines', 'Voice: never played',
    'Footsteps', 'Jumps & landings', 'Slides', 'Moves', 'Water', 'Metal Mario']);
  for (const name of ['Jump "Yah!"', 'Jump "Wah!"', 'Jump "Hoo!"', 'Triple jump "Waha!"', 'Triple jump "Yippee!"', 'Panting 2', 'Step: Grass', 'Landing: Snow', 'Sliding: Sand', '"It\'s-a me, Mario!"']) {
    t.check(`listed: ${name}`, mario.some((x) => x.name === name));
  }
  // each entry is one sound of the game (no two entries play the same sound script)
  const keys = await s.eval((list) => list.map((x) => studio64.engine.M._studio_sfx_key(x.bits >>> 0)), mario);
  t.eq('every entry is a sound of its own', new Set(keys).size, keys.length);

  // ---- every one replaceable -----------------------------------------------------------------
  // replace them all (in batches: the engine holds 96 replaced sounds), then let the game ask for each
  const missed = await s.eval(async (list) => {
    const ui = studio64.soundUI, e = studio64.engine, out = [];
    let heard = [];
    const orig = ui.onGameSound.bind(ui);
    ui.onGameSound = (id) => heard.push(id);
    for (let b = 0; b < list.length; b += 90) {
      const batch = list.slice(b, b + 90);
      e.setSoundOverrides(batch.map((x, i) => ({ bits: x.bits, id: i })));
      batch.forEach((x, i) => { heard = []; e.playGameSound(x.bits); if (!heard.includes(i)) out.push(x.name); });
    }
    ui.onGameSound = orig;
    e.setSoundOverrides([]);
    return out;
  }, mario.filter((x) => x.sub !== 'Voice: never played'));
  t.eq('every Mario sound plays the replacement when the game asks for it', missed, []);

  // the ids the game picks at random or per ground are the same sound
  const byIds = await s.eval(([yahoo, step, jumps]) => {
    const e = studio64.engine, heard = [];
    studio64.soundUI.onGameSound = (id) => heard.push(id);
    e.setSoundOverrides([{ bits: yahoo, id: 1 }, { bits: step, id: 2 }]);
    const hit = (bits) => { heard.length = 0; e.playGameSound(bits); return heard[0] ?? 0; };
    // the triple jump: SOUND_MARIO_YAHOO_WAHA_YIPPEE + 0..4 (0x2B..0x2F)
    const triple = [0, 1, 2, 3, 4].map((k) => hit((jumps + ((0x2B + k) << 16)) >>> 0));
    const steps = [0, 1, 2, 3].map((k) => hit((0x06108081 + (k << 16)) >>> 0));
    return { triple, steps };
  }, [mario.find((x) => x.name === '"Yahoo!"').bits, mario.find((x) => x.name === 'Step: Grass').bits, 0x24008081]);
  t.eq('"Yahoo!" replaced: the triple jump\'s three yahoo ids play it, waha and yippee not', byIds.triple, [1, 1, 1, 0, 0]);
  t.eq('"Step: Grass" replaced: only steps on grass', byIds.steps, [0, 2, 0, 0]);
  await s.eval(() => { studio64.engine.setSoundOverrides([]); studio64.soundUI.onGameSound = studio64.soundUI.constructor.prototype.onGameSound.bind(studio64.soundUI); });

  // ---- through the studio, then a real jump ---------------------------------------------------
  await page.click('#sound-btn');
  await page.click('.ss-tab[data-tab=sounds]');
  await page.selectOption('.gs-bar select', 'Mario');
  await s.wait(300);
  t.check('sub-group headings in the list', (await page.locator('.gs-sub').count()) >= 10);
  await s.shot('1_mario_sounds');
  const yahRow = page.locator('.gs-row', { hasText: 'Jump "Yah!"' }).first();
  await yahRow.locator('button', { hasText: /Replace/ }).click();
  await s.wait(500);
  const sound = await s.eval(() => studio64.soundUI.soundId);
  await page.click('.ss-tab[data-tab=sounds]').catch(() => {});
  // the other two jump voices with the same sound
  await s.eval((id) => {
    const ui = studio64.soundUI;
    const list = ui.gameSounds.filter((x) => /^Jump "(Wah|Hoo)!"$/.test(x.name)).map((x) => ({ bits: x.bits, sound: id, name: `Mario: ${x.name}` }));
    ui.setOverrides([...ui.audio.overrides, ...list]);
  }, sound);
  t.eq('three jump voices replaced', (await s.eval(() => studio64.audio.overrides.length)), 3);
  await page.click('#ss-close');
  await s.play();
  await s.eval(() => {
    const ui = studio64.soundUI;
    window.__plays = 0;
    const orig = ui.sfx.play.bind(ui.sfx);
    ui.sfx.play = (...a) => { window.__plays++; return orig(...a); };
  });
  await page.focus('#canvas');
  for (let k = 0; k < 3; k++) {
    const y0 = (await s.mario()).y;
    await s.hold('Space', (m) => m.y > y0 + 60, 4000);
    await s.wait(900);
  }
  t.check('Mario\'s jumps play the replaced voice (whichever of the three the game picks)', await s.eval(() => window.__plays >= 2), await s.eval(() => window.__plays));

  // ---- beta sounds ----------------------------------------------------------------------------
  await s.eval(() => studio64.soundUI.setOverrides([]));
  const script = (id) => s.eval((i) => studio64.engine.M._studio_voice_script(i) >>> 0, id);
  t.eq('the jump "Yah!" plays the punch\'s clip (bank 10, instrument 9)', (await script(0)).toString(16), 'c60ac109');
  // what the voice channel plays: wah (bank 8, instrument 1) to know bank 8's real number
  const voiceOf = async (id) => s.eval(async ([b]) => {
    const e = studio64.engine;
    e.playGameSound(b);
    let seen = 0;
    for (let k = 0; k < 40 && !seen; k++) { await new Promise((r) => setTimeout(r, 25)); const v = e.M._studio_sfx_channel(2); if (v) seen = v; }
    return seen;
  }, [(key(VOICE, id) | 0x04008081) >>> 0]);
  await s.wait(1500);
  const wah = await voiceOf(1);
  await s.wait(1500);
  const yah = await voiceOf(0);
  t.check('the voice channel plays the game\'s clips (wah: bank 8, yah: another bank)', wah && yah && (wah >> 16) !== (yah >> 16), { wah: wah.toString(16), yah: yah.toString(16) });
  await page.click('#sound-btn');
  await page.click('.ss-tab[data-tab=sounds]');
  await page.locator('#ss-side .ss-row', { hasText: 'Game sounds' }).click();
  const box = page.locator('.gs-beta input');
  t.check('the Beta sounds switch is off', !(await box.isChecked()));
  await box.check();
  await s.wait(600);
  await s.shot('2_beta_sounds_on');
  t.eq('Beta: the jump "Yah!" script plays the unused clip (bank 8, instrument 2)', (await script(0)).toString(16), 'c608c102');
  await page.click('#ss-close');
  await s.wait(1500);
  const yahBeta = await voiceOf(0);
  t.check('Beta: the voice channel plays bank 8 (the wah\'s), instrument 2 + 1', (yahBeta >> 16) === (wah >> 16) && ((yahBeta >> 8) & 255) === 3, { yahBeta: yahBeta.toString(16), wah: wah.toString(16) });
  // the triple jump: yah / wah / hoo instead of yahoo / waha / yippee
  const triple = await s.eval(() => [0, 1, 2, 3, 4].map((k) => {
    studio64.engine.playGameSound((0x24008081 + ((0x2B + k) << 16)) >>> 0);
    return (studio64.engine.M._studio_sfx_recent(0) >>> 16) & 0xff;
  }));
  t.eq('Beta: the triple jump says yah, wah, hoo (ids 0, 1, 2)', triple, [0, 1, 2, 0, 1]);
  t.eq('Beta is saved in the project', (await saved()).audio?.beta, true);

  // after a reload
  await s.reload();
  await page.waitForFunction(() => studio64.soundUI && studio64.engine.M._studio_sfx_key(0x24000000) !== 0, null, { timeout: 60000 });
  await s.wait(1000);
  await s.eval(() => studio64.engine.playGameSound(0x24008081));
  await s.wait(300);
  t.eq('after a reload: beta still on', (await script(0)).toString(16), 'c608c102');
  await page.click('#sound-btn');
  await page.click('.ss-tab[data-tab=sounds]');
  await page.locator('#ss-side .ss-row', { hasText: 'Game sounds' }).click();
  t.check('after a reload: the switch is on', await page.locator('.gs-beta input').isChecked());
  await page.locator('.gs-beta input').uncheck();
  await s.wait(500);
  t.eq('Beta off: the game\'s own "Yah!" again', (await script(0)).toString(16), 'c60ac109');
  const tripleOff = await s.eval(() => [3, 4].map((k) => { studio64.engine.playGameSound((0x24008081 + ((0x2B + k) << 16)) >>> 0); return (studio64.engine.M._studio_sfx_recent(0) >>> 16) & 0xff; }));
  t.eq('Beta off: waha and yippee again', tripleOff, [0x2E, 0x2F]);
  t.check('Beta off is saved', !(await saved()).audio?.beta);
  await page.click('#ss-close');
});
