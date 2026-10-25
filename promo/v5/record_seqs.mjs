// Records the game's own songs from the engine (the audio tap, one game frame at a time) for the
// trailer's Mario-soundtrack version. Local only: the recordings are Nintendo's music (promo/work5, gitignored).
//   node record_seqs.mjs OUTDIR "seq:seconds,seq:seconds,..."
import { openStudio, sleep } from '../scripts/lib.mjs';
import fs from 'node:fs';
const [OUT, LIST] = process.argv.slice(2);
const { browser, page } = await openStudio({ level: 6, name: 'Music', viewport: { width: 640, height: 360 } });
const ev = (fn, a) => page.evaluate(fn, a);
await ev(() => { const e = studio64.engine; e.resize = () => {}; e.M._studio_resize(320, 180); P.freeze(); e.M._studio_set_paused(0, 1); });
for (const item of LIST.split(',')) {
  const [seq, secs] = item.split(':').map(Number);
  const dir = `${OUT}/seq_${seq.toString(16).padStart(2, '0')}`;
  fs.mkdirSync(dir, { recursive: true });
  await ev(() => { studio64.engine.M._studio_music_preview(-1); });
  await ev(() => P.step(40));                       // the last song faded out
  await ev(() => P.tap(true, 127));
  await ev(() => P.tapRead());                      // (drop what was in it)
  await ev((s) => studio64.engine.M._studio_music_preview(s), seq);
  const audio = [];
  for (let f = 0; f < secs * 30; f++) {
    await ev(() => P.step(1));
    audio.push(Buffer.from(await ev(() => P.tapRead()), 'base64'));
  }
  await ev(() => P.tap(false));
  fs.writeFileSync(`${dir}/audio.s16le`, Buffer.concat(audio));
  fs.writeFileSync(`${dir}/audio_frames.json`, JSON.stringify(audio.map((a) => a.length / 4)));
  console.log('seq', seq, secs + 's', Buffer.concat(audio).length, 'bytes');
}
await browser.close();
