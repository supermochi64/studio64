// Replacing the game's songs everywhere (issue #11): a song of the project plays instead of
// Bob-omb Battlefield in the level that has it, a one-bar jingle instead of the star fanfare
// plays once and ends, both stay after a reload, and the game's own come back (the chip's x,
// deleting the song).
// @tags sound
import { suite } from '../lib/harness.mjs';

await suite('replace game songs', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  const seqLen = (seq) => s.eval((q) => studio64.engine.M._studio_seq_len(q), seq);
  const now = () => s.eval(() => { const v = studio64.engine.M._studio_music_now(0); return { on: !!(v >> 16), seq: (v >> 8) & 255, channels: v & 255 }; });
  const bobLen = await seqLen(0x03), starLen = await seqLen(0x01);
  await s.build();
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => studio64.soundUI.banks?.length, null, { timeout: 15000 });

  // a song in place of Bob-omb Battlefield, from the game music list
  await page.locator('.starter').first().click();
  await s.wait(500);
  const song = await s.eval(() => studio64.soundUI.song());
  const row = page.locator('#ss-side .ss-row.game', { hasText: 'Bob-omb Battlefield' });
  await row.hover();
  await row.locator('.ss-replace').click();
  await page.locator('#ss-menu .menu-item', { hasText: song.name }).click();
  await s.wait(600);
  t.eq('the replacement is saved', await s.eval(() => studio64.audio.replace), [{ seq: 0x03, song: song.id }]);
  const enc = await s.eval(async () => (await import('/js/music.js')).encodeSong(studio64.soundUI.song()).length);
  t.eq('the game song slot holds the song', await seqLen(0x03), enc);
  t.check('the list shows it', /→/.test(await row.textContent()), await row.textContent());
  t.check('the composer shows it', /Bob-omb Battlefield/.test(await page.textContent('.cmp-replaces')));
  await row.hover();
  await s.shot('replaced');

  // the level plays it (its music is Bob-omb Battlefield)
  await page.keyboard.press('Escape');
  await s.play();
  await s.wait(1500);
  const m = await now();
  t.check('the level\'s music player runs the song in the slot', m.on && m.seq === 0x03 && m.channels === song.tracks.length, { m, tracks: song.tracks.length });

  // a one-bar jingle for the star fanfare: plays once and ends
  const jingle = await s.eval(async () => {
    const mu = await import('/js/music.js');
    const j = mu.newSong({ name: 'Star Jingle', bank: 0x22, tempo: 160, bars: 1 });
    const tr = mu.newTrack('inst', 0, 'Lead');
    tr.notes = [0, 2, 4, 6, 8, 12].map((x, i) => ({ t: x, d: 2, p: 72 + i * 2, v: 110 }));
    j.tracks.push(tr);
    studio64.audio.songs.push(j);
    studio64.soundUI.saveSong(j, true);
    return { id: j.id, once: mu.encodeSong(j, { once: true }).length, loop: mu.encodeSong(j).length };
  });
  await s.eval(() => studio64.soundUI.open('music')); // (the studio enters build mode itself)
  await page.locator('#ss-side .ss-row:not(.game)', { hasText: 'Star Jingle' }).click();
  await page.click('.cmp-bar .btn.icon.ghost');
  await page.click('#ss-menu .menu-item:has-text("Play instead of a game song")');
  await page.locator('#ss-menu .menu-item', { hasText: 'Star collect' }).click();
  await s.wait(600);
  t.eq('the jingle replaces the star fanfare', (await s.eval(() => studio64.audio.replace)).find((r) => r.seq === 0x01)?.song, jingle.id);
  t.eq('a jingle is encoded to play once', await seqLen(0x01), jingle.once);
  t.check('(and not as a loop)', jingle.once !== jingle.loop, jingle);
  await s.eval(() => studio64.engine.previewMusic(0x01));
  await s.wait(500);
  t.check('the fanfare plays the jingle', (await now()).seq === 0x01 && (await now()).on, await now());
  await s.wait(2500); // a bar at 160 bpm and a beat to ring out
  t.check('and ends by itself', !(await now()).on || (await now()).seq !== 0x01, await now());
  await page.keyboard.press('Escape');

  // after a reload the engine gets them again
  await s.wait(800);
  await page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => studio64.engine?.ready && studio64.soundUI, null, { timeout: 120000 });
  await s.wait(1500);
  t.eq('both replacements kept', (await s.eval(() => studio64.audio.replace)).length, 2);
  t.eq('the slots hold them again', [await seqLen(0x03), await seqLen(0x01)], [enc, jingle.once]);

  // the game's own back: the chip's x, and deleting the jingle
  await page.waitForFunction(() => studio64.soundUI.banks?.length, null, { timeout: 15000 });
  await s.eval(() => studio64.soundUI.open('music'));
  await page.locator('#ss-side .ss-row', { hasText: song.name }).first().click();
  await page.click('.cmp-replaces .cmp-chip-x');
  await s.wait(500);
  t.eq('the x brings Bob-omb Battlefield back', await seqLen(0x03), bobLen);
  await page.locator('#ss-side .ss-row:not(.game)', { hasText: 'Star Jingle' }).click();
  await page.click('.cmp-bar .btn.icon.ghost');
  await page.click('#ss-menu .menu-item:has-text("Delete")');
  await s.wait(800);
  t.eq('deleting the jingle brings the fanfare back', await seqLen(0x01), starLen);
  t.eq('no replacements left', await s.eval(() => studio64.audio.replace), []);
  await page.keyboard.press('Escape');
  t.check('engine alive', await s.framesAdvance());
});
