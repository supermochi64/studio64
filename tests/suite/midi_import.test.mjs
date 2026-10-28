// Importing a MIDI file in the sound studio: the file's parts (a piano with six-note chords,
// a bass, drums on channel 10) each get one of the game's instruments, the user picks another,
// listens, imports; the song has every note (the chords take a spare channel instead of losing
// notes) and plays in the level. A file that is not MIDI says so.
// @tags sound
import { suite } from '../lib/harness.mjs';
import { songMidi } from '../fixtures/make_midi.mjs';

await suite('midi import', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  await s.build();
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => studio64.soundUI.banks?.length, null, { timeout: 15000 });

  // the starter page offers the import
  const card = page.locator('.starter', { hasText: 'Import MIDI' });
  t.must('an Import MIDI card', await card.count() === 1);
  const pick = async (file) => {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), card.click()]);
    await chooser.setFiles(file);
    await s.wait(500);
  };
  await pick({ name: 'bad.mid', mimeType: 'audio/midi', buffer: Buffer.from('not a midi file at all') });
  t.check('a broken file is refused', !(await s.eval(() => !!studio64.soundUI.midiImport)));

  await pick({ name: 'Test Song.mid', mimeType: 'audio/midi', buffer: songMidi() });
  t.must('the import screen', await page.locator('.mi-part').count() === 3, await page.locator('.mi-part').count());
  const plan = await s.eval(() => studio64.soundUI.midiImport.plan);
  t.eq('tempo from the file', plan.tempo, 100);
  t.eq('its length', plan.bars, 4);
  t.eq('the drum part plays the kit', plan.parts[2].kind, 'drums');
  t.check('the piano and the bass get different instruments', plan.parts[0].program !== plan.parts[1].program, plan.parts);
  t.check('the part names', /Piano/.test(await page.locator('.mi-part').first().textContent()));
  await s.shot('import_screen');
  t.check('every note fits', /every note fits/.test(await page.textContent('.mi-notes')), await page.textContent('.mi-notes'));

  // another instrument for the piano
  const opts = await page.locator('.mi-part').first().locator('select option').evaluateAll((o) => o.map((x) => x.value));
  const other = opts.find((v) => v !== 'drums' && Number(v) !== plan.parts[0].program && Number(v) !== plan.parts[1].program);
  await page.locator('.mi-part').first().locator('select').selectOption(other);
  await s.wait(300);
  t.eq('the chosen instrument', await s.eval(() => studio64.soundUI.midiImport.plan.parts[0].program), Number(other));

  // listen, then import
  await page.click('.mi-listen');
  await s.wait(800);
  t.check('listening', await s.eval(() => studio64.soundUI.midiPreview));
  t.check('frames still run while it plays', await s.framesAdvance());
  await page.click('.mi-import');
  await s.wait(800);
  const song = await s.eval(() => studio64.soundUI.song());
  t.must('a song', !!song);
  t.eq('its name', song.name, 'Test Song');
  t.eq('three tracks', song.tracks.map((x) => `${x.name}:${x.kind}`), ['Piano:inst', 'Bass:inst', 'Drums:drums']);
  t.eq('the piano plays the chosen instrument', song.tracks[0].program, Number(other));
  t.eq('every note', song.tracks.map((x) => x.notes.length), [24, 8, 48]);
  t.check('preview stopped', !(await s.eval(() => studio64.soundUI.midiPreview)));
  const enc = await s.eval(async () => {
    const m = await import('/js/music.js');
    const r = m.songChannels(studio64.soundUI.song());
    return { channels: r.channels.length, dropped: r.dropped, size: m.encodeSong(studio64.soundUI.song()).length };
  });
  t.eq('the six-note chords take a spare channel, no note lost', [enc.channels, enc.dropped], [4, 0]);
  t.check('small enough for the game', enc.size < 8192, enc);
  t.check('the composer shows it', await page.isVisible('.roll-grid'));

  // it plays in the level
  await page.locator('button', { hasText: 'Use in this level' }).click();
  await s.wait(800);
  t.eq('level plays the song', await s.eval(() => studio64.world.settings().song), song.id);
  await s.shot('imported');
});
