// Sound studio: open/close (button, M, Esc), a starter song, notes in the piano roll, play,
// use it as level music, game music, a synth sound replacing the coin sound (and it really
// plays when Mario takes a coin), persistence, deleting the level's song.
// @tags sound
import { suite } from '../lib/harness.mjs';

await suite('sound studio', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  await page.click('#sound-btn');
  t.check('Sound button opens the studio', await page.isVisible('#sound-studio'));
  t.check('the level waits in build mode while it is open', await s.eval(() => studio64.editor.active));
  await page.keyboard.press('Escape');
  t.check('Esc closes it', await page.isHidden('#sound-studio'));
  t.check('back to playing after closing', !(await s.eval(() => studio64.editor.active)));
  // M opens it when not playing (in build mode)
  await s.build();
  await page.keyboard.press('KeyM');
  t.check('M opens it in build mode', await page.isVisible('#sound-studio'));
  await page.waitForFunction(() => studio64.soundUI.banks?.length, null, { timeout: 15000 });

  // starter song
  await page.locator('.starter').first().click();
  await s.wait(500);
  const song = await s.eval(() => studio64.soundUI.song());
  t.must('starter made a song', !!song?.tracks?.length, song);
  // notes by clicking the roll
  const notes0 = await s.eval(() => studio64.soundUI.song().tracks.find((x) => x.id === studio64.soundUI.trackId).notes.length);
  const grid = await page.locator('.roll-grid').boundingBox();
  t.must('piano roll shown', !!grid);
  for (let k = 0; k < 3; k++) await page.mouse.click(grid.x + 30 + k * 70, grid.y + 60 + k * 14);
  await s.wait(400);
  const notes1 = await s.eval(() => studio64.soundUI.song().tracks.find((x) => x.id === studio64.soundUI.trackId).notes.length);
  t.check('clicking the roll adds notes', notes1 > notes0, { notes0, notes1 });
  // play / stop
  await page.click('.cmp-play');
  await s.wait(1200);
  t.check('playing', await s.eval(() => studio64.soundUI.playing));
  t.check('frames still run while playing', await s.framesAdvance());
  await page.keyboard.press('Space');
  await s.wait(300);
  t.check('Space stops', !(await s.eval(() => studio64.soundUI.playing)));
  // tempo
  await page.fill('.cmp-bar input[type=number]', '150');
  await page.press('.cmp-bar input[type=number]', 'Tab');
  t.eq('tempo changed', await s.eval(() => studio64.soundUI.song().tempo), 150);
  // rename
  await page.fill('.cmp-name', 'Test Tune');
  await s.wait(800);
  // use in this level
  await page.locator('button', { hasText: 'Use in this level' }).click();
  await s.wait(800);
  t.eq('level plays the song', await s.eval(() => studio64.world.settings().song), song.id);
  t.check('header names it', /Test Tune/.test(await page.textContent('#ss-now')), await page.textContent('#ss-now'));

  // sound effects: replace the coin sound with a synth sound
  await page.click('.ss-tab[data-tab=sounds]');
  await s.wait(300);
  await page.waitForFunction(() => studio64.soundUI.gameSounds.length > 100, null, { timeout: 10000 });
  await page.fill('.gs-search', 'coin');
  await s.wait(300);
  const coinRow = page.locator('.gs-row', { hasText: /^Coin/ }).first();
  t.must('coin sound listed', await coinRow.count() > 0);
  await coinRow.locator('button', { hasText: /Replace/ }).click();
  await s.wait(800);
  const ov = await s.eval(() => studio64.audio.overrides);
  t.check('override created', ov.length === 1 && !!ov[0].sound, ov);
  // presets / random / vary
  await page.locator('.chip', { hasText: 'Laser' }).first().click().catch(() => {});
  await page.locator('.chip', { hasText: 'Random' }).click();
  await page.locator('.chip', { hasText: 'Vary it' }).click();
  await s.wait(700);
  await page.click('#ss-close');
  t.check('closed', await page.isHidden('#sound-studio'));
  await s.play();

  // the replaced sound plays when Mario takes a coin
  await s.eval(() => {
    const ui = studio64.soundUI;
    window.__sfxPlays = 0;
    const orig = ui.sfx.play.bind(ui.sfx);
    ui.sfx.play = (...a) => { window.__sfxPlays++; return orig(...a); };
    const m = studio64.engine.state().mario;
    studio64.engine.spawn({ uid: 0x7d000001, entry: 'yellow_coin', x: m.x, y: m.y + 40, z: m.z, yaw: 0, pitch: 0, roll: 0, bparams: 0, scale: 1 });
  });
  await s.until(() => studio64.engine.state().mario.coins >= 1, null, 20000);
  t.check('coin collected', (await s.mario()).coins >= 1);
  await s.until(() => window.__sfxPlays > 0, null, 5000);
  t.check('custom sound played for the coin', await s.eval(() => window.__sfxPlays > 0));

  // persistence
  await s.wait(800);
  await page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => studio64.engine?.ready && studio64.soundUI, null, { timeout: 120000 });
  await s.wait(1500);
  const after = await s.eval(() => ({ songs: studio64.audio.songs.map((x) => x.name), sounds: studio64.audio.sounds.length, overrides: studio64.audio.overrides.length, song: studio64.world.settings().song, tempo: studio64.audio.songs[0]?.tempo }));
  t.eq('song saved', after.songs, ['Test Tune']);
  t.eq('tempo saved', after.tempo, 150);
  t.eq('sound saved', after.sounds, 1);
  t.eq('override saved', after.overrides, 1);
  t.eq('level song saved', after.song, song.id);

  // game music for the level, then delete the song
  await page.click('#sound-btn');
  await page.waitForFunction(() => studio64.soundUI.banks?.length, null, { timeout: 15000 });
  await page.click('.ss-tab[data-tab=music]');
  await page.locator('#ss-side .ss-row', { hasText: 'Test Tune' }).click();
  await page.click('.cmp-bar .btn.icon.ghost');
  await page.click('#ss-menu .menu-item:has-text("Delete")');
  await s.wait(800);
  t.eq('deleting the song removes it', await s.eval(() => studio64.audio.songs.length), 0);
  t.check('level no longer plays the deleted song', !(await s.eval(() => studio64.world.settings().song)));
  t.check('header does not name a deleted song', !/deleted/.test(await page.textContent('#ss-now')), await page.textContent('#ss-now'));
  await page.locator('#ss-side .ss-row.game .ss-use').nth(2).click();
  await s.wait(500);
  t.check('game music picked for the level', (await s.eval(() => studio64.world.settings().music)) != null);
  await page.keyboard.press('Escape');
  t.check('engine alive', await s.framesAdvance());
});
