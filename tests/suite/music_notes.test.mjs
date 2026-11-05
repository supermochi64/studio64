// Composer notes last their written length (issue #8): measured in the game's sequence player
// (how long a layer's note sounds before it is released), for normal and legato tracks, and
// the encoded gate of every note. The playhead: dragging it on the ruler plays from there (the
// note sounding there starts with what is left of it), clicking the ruler jumps, Play starts at it.
// @tags sound
import { suite } from '../lib/harness.mjs';

await suite('music note lengths', async (t) => {
  const s = await t.open({ level: 9 });
  const page = s.page;
  await s.build();
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => studio64.soundUI.banks?.length, null, { timeout: 15000 });

  // the encoded gate (the note's last byte): 0 = the note sounds to its end
  const gates = await s.eval(async () => {
    const m = await import('/js/music.js');
    const song = m.newSong({ tempo: 120, bars: 1 });
    for (const legato of [false, true]) {
      const tr = m.newTrack('inst', 0); tr.legato = legato;
      tr.notes = [{ t: 0, d: 4, p: 60, v: 100 }, { t: 8, d: 8, p: 64, v: 100 }];
      song.tracks.push(tr);
    }
    const b = Array.from(m.encodeSong(song));
    // the layers' note commands: note (< 0x40), length (1-2 bytes), velocity, gate
    const out = [];
    // find "<note> <len> 100 <gate>" patterns of the four notes
    for (let i = 0; i + 3 < b.length; i++) if ((b[i] === 39 || b[i] === 43) && b[i + 2] === 100 && b[i + 1] < 0x80) out.push(b[i + 3]);
    return out;
  });
  t.check('every note is encoded to sound to its end', gates.length === 4 && gates.every((g) => g === 0), gates);

  // measured: a song of long notes, the layer's state sampled every frame
  const measure = async (legato) => s.eval(async (lg) => {
    const m = await import('/js/music.js');
    const ui = studio64.soundUI;
    const song = m.newSong({ tempo: 120, bars: 2, bank: ui.banks[0].bank });
    const tr = m.newTrack('inst', ui.banks[0].programs[0].program); tr.legato = lg;
    // two 2-beat notes, a rest, a 4-beat note
    tr.notes = [{ t: 0, d: 8, p: 60, v: 110 }, { t: 8, d: 8, p: 64, v: 110 }, { t: 20, d: 12, p: 67, v: 110 }];
    song.tracks.push(tr);
    const E = studio64.engine;
    E.previewMusic(E.installSong(m.encodeSong(song), song.bank, true));
    const notes = new Map(); // length -> { min ticks left while sounding, released seen }
    const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => {
        const v = E.M._studio_music_layer(0, 0);
        if (v >= 0) {
          const len = v & 0x7fff, left = (v >> 15) & 0x7fff, on = !!(v & (1 << 30));
          const n = notes.get(len) || { minLeft: Infinity, samples: 0 };
          n.samples++;
          if (on) n.minLeft = Math.min(n.minLeft, left);
          notes.set(len, n);
        }
        if (performance.now() - t0 < 4300) requestAnimationFrame(tick); else res();
      };
      tick();
    });
    E.stopPreview();
    return [...notes.entries()].map(([len, n]) => ({ len, sounds: n.minLeft === Infinity ? 0 : (len - n.minLeft) / len, samples: n.samples }));
  }, legato);
  for (const legato of [false, true]) {
    const r = await measure(legato);
    console.log(`legato ${legato}: ${JSON.stringify(r)}`);
    // note lengths in ticks (48 per beat): 96 (2 beats), 144 (3 beats; the rest is a delay)
    const notes = r.filter((x) => x.len === 96 || x.len === 144);
    t.check(`${legato ? 'legato' : 'normal'} notes were sampled`, notes.length >= 2, r);
    // sampled once a frame (~4 ticks at 120 bpm): a note that sounds to its end is seen sounding
    // within a few ticks of it
    for (const n of notes) t.check(`${legato ? 'legato' : 'normal'} ${n.len}-tick note sounds to its end`, n.sounds > 0.9, n);
  }

  // ---- the playhead -------------------------------------------------------------------------
  // a song of one long note (4 bars of 4/4 at 4 steps a beat: steps 0..63)
  await page.locator('.starter').first().click();
  await s.wait(400);
  await s.eval(() => {
    const ui = studio64.soundUI, song = ui.song();
    song.bars = 4;
    song.tracks = [song.tracks[0]];
    song.tracks[0].notes = [{ t: 0, d: 48, p: 60, v: 110 }, { t: 56, d: 8, p: 64, v: 110 }];
    ui.trackId = song.tracks[0].id;
    ui.saveSong(song, true);
    ui.renderComposer();
  });
  await s.wait(300);
  const ruler = await page.locator('.roll-ruler').boundingBox();
  t.must('the piano roll has a time ruler', !!ruler && ruler.width > 100, ruler);
  const cw = await s.eval(() => studio64.soundUI.roll.cw);
  // a step's x on the page (the roll scrolled so that it is in view)
  const stepX = async (step, sel = '.roll-ruler') => {
    await s.eval(([st, w]) => { const sc = studio64.soundUI.roll.scroll; sc.scrollLeft = Math.max(0, st * w - 60); }, [step, cw]);
    await s.wait(50);
    const b = await page.locator(sel).boundingBox();
    return b.x + step * cw;
  };
  // the first note sounding after playing starts: its length in ticks
  const firstNote = () => s.eval(async () => {
    const E = studio64.engine, t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      const v = E.M._studio_music_layer(0, 0);
      if (v >= 0 && (v & (1 << 30))) return { len: v & 0x7fff, left: (v >> 15) & 0x7fff };
      await new Promise((r) => requestAnimationFrame(r));
    }
    return null;
  });
  // drag the playhead along the ruler from bar 1 to beat 9 (step 32) and let go
  const y = ruler.y + ruler.height / 2;
  await page.mouse.move(ruler.x + 3, y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(ruler.x + 3 + (32 * cw * k) / 8, y);
  t.check('the line follows while dragging', await s.eval(() => studio64.soundUI.headDrag?.step), 32);
  await s.shot('playhead_drag');
  await page.mouse.up();
  const p1 = await s.eval(() => ({ from: studio64.soundUI.playing?.from, pos: studio64.soundUI.playPosition?.() }));
  t.eq('letting go plays from the dragged spot', p1.from, 32);
  const n1 = await firstNote();
  // the note that sounds there (steps 0..48) starts with what is left of it: 16 steps = 192 ticks
  t.check('the game plays from the dragged spot: the rest of the note sounding there', n1 && n1.len === 192, n1);
  await s.wait(500);
  const pos = await s.eval(() => studio64.soundUI.playPosition());
  t.check('the line moves on from there', pos > 32 && pos < 48, pos);
  await s.shot('playhead_playing');
  // a click on the ruler jumps (while playing), into the rest before the last note
  await page.mouse.click(await stepX(52) + 2, y);
  t.eq('clicking the ruler jumps there', await s.eval(() => studio64.soundUI.playing?.from), 52);
  await s.wait(300);
  await s.shot('playhead');
  const n2 = await firstNote();
  t.check('from a rest: the next note whole (8 steps = 96 ticks)', n2 && n2.len === 96, n2);
  // stop: Play starts at the playhead again
  await page.click('.cmp-play');
  t.check('stopped', !(await s.eval(() => studio64.soundUI.playing)));
  await page.click('.cmp-play');
  t.eq('Play starts at the playhead', await s.eval(() => studio64.soundUI.playing?.from), 52);
  // the line itself on the grid can be dragged too
  await page.click('.cmp-play');
  const gx = await stepX(52, '.roll-grid'), x0 = gx - 52 * cw, sb = await page.locator('.roll-scroll').boundingBox(), gy = sb.y + sb.height / 2;
  await page.mouse.move(gx + 1, gy);
  await page.mouse.down();
  await page.mouse.move(x0 + 40 * cw, gy, { steps: 4 });
  await page.mouse.move(x0 + 44 * cw, gy, { steps: 4 });
  await page.mouse.up();
  t.eq('dragging the line on the grid moves it', await s.eval(() => studio64.soundUI.playing?.from), 44);
  t.eq('...and adds no note', await s.eval(() => studio64.soundUI.song().tracks[0].notes.length), 2);
  // from the start, the encoding is the same as before (no first-pass layers)
  t.check('from 0 encodes the whole song only', await s.eval(async () => {
    const m = await import('/js/music.js'); const song = studio64.soundUI.song();
    return m.encodeSong(song).join() === m.encodeSong(song, { from: 0 }).join() && m.encodeSong(song, { from: 16 }).length > m.encodeSong(song).length;
  }));
  await page.click('.cmp-play');
});
