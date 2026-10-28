// Writes tests/fixtures/song.mid: a small standard MIDI file for the composer's MIDI import.
// Format 1 at 96 ticks a beat, 100 bpm in 4/4, four bars: a conductor track, a piano playing
// six-note chords (more than one channel's four voices), a bass, and drums on channel 10
// (running status and note-offs as note-ons at velocity 0, as many editors write them).
//   node tests/fixtures/make_midi.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function songMidi() {
  const varLen = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
  const track = (events) => {
    // events: [tick, ...bytes], in any order -> delta times
    const out = [];
    let t = 0;
    for (const [tick, ...bytes] of events.sort((a, b) => a[0] - b[0])) { out.push(...varLen(tick - t), ...bytes); t = tick; }
    out.push(0, 0xff, 0x2f, 0);
    return [0x4d, 0x54, 0x72, 0x6b, out.length >> 24, (out.length >> 16) & 255, (out.length >> 8) & 255, out.length & 255, ...out];
  };
  const name = (s) => [0xff, 0x03, s.length, ...[...s].map((c) => c.charCodeAt(0))];
  const B = 96 * 4;
  const conductor = track([[0, ...name('Test Song')], [0, 0xff, 0x51, 3, 0x09, 0x27, 0xc0], [0, 0xff, 0x58, 4, 4, 2, 24, 8]]);
  const piano = [[0, ...name('Piano')], [0, 0xc0, 0], [0, 0xb0, 7, 90]];
  const chords = [[48, 55, 60, 64, 67, 72], [45, 52, 57, 60, 64, 69], [41, 48, 53, 57, 60, 65], [43, 50, 55, 59, 62, 67]];
  chords.forEach((c, i) => c.forEach((p) => { piano.push([i * B, 0x90, p, 90], [i * B + B - 8, 0x80, p, 0]); }));
  const bass = [[0, ...name('Bass'), ], [0, 0xc1, 33]];
  chords.forEach((c, i) => [0, 2].forEach((h) => bass.push([i * B + h * 96, 0x91, c[0] - 12, 110], [i * B + h * 96 + 180, 0x91, c[0] - 12, 0])));
  // drums: kick, snare, hats; running status (the status byte once)
  const drums = [[0, ...name('Drums')]];
  const hits = [];
  for (let b = 0; b < 4; b++) for (let e = 0; e < 8; e++) {
    const t = b * B + e * 48;
    hits.push([t, 42, 70]);
    if (e % 4 === 0) hits.push([t, 36, 120]);
    if (e % 4 === 2) hits.push([t, 38, 110]);
  }
  const drumEvents = [];
  for (const [t, p, v] of hits) drumEvents.push([t, p, v], [t + 24, p, 0]);
  drumEvents.sort((a, b) => a[0] - b[0]);
  let first = true;
  for (const [t, p, v] of drumEvents) { drums.push(first ? [t, 0x99, p, v] : [t, p, v]); first = false; }
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 4, 0, 96];
  return Buffer.from([...head, ...conductor, ...track(piano), ...track(bass), ...track(drums)]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(new URL('./song.mid', import.meta.url), songMidi());
  console.log('wrote tests/fixtures/song.mid');
}
