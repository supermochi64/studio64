// MIDI files for the sound composer: a reader for standard MIDI files (.mid), and the
// conversion of their parts to a song that the game plays with its own instruments
// (each part gets one of the sound set's instruments, the drums its kit).

import { newSong, newTrack, bankOf } from './music.js';

// ---- reading ---------------------------------------------------------------------

// -> { format, division, tempo (bpm), tempos, timeSig: [num, den], length (ticks), parts }
// A part is one channel of one track: { key, track, channel, name, program, drums, notes,
// volume, pan } with notes as { tick, dur, p, v }.
export function parseMidi(buf) {
  const d = new Uint8Array(buf);
  let pos = 0;
  const u32 = () => { const v = (d[pos] << 24 | d[pos + 1] << 16 | d[pos + 2] << 8 | d[pos + 3]) >>> 0; pos += 4; return v; };
  const u16 = () => { const v = d[pos] << 8 | d[pos + 1]; pos += 2; return v; };
  const tag = () => String.fromCharCode(d[pos], d[pos + 1], d[pos + 2], d[pos + 3]);
  // (a RIFF-wrapped MIDI file, .rmi: the SMF is in its "data" chunk)
  if (tag() === 'RIFF') {
    pos = 12;
    while (pos + 8 <= d.length && tag() !== 'data') { pos += 4; pos += u32le(d, pos) + 4; }
    if (pos + 8 > d.length) throw new Error('Not a MIDI file');
    pos += 8;
  }
  if (tag() !== 'MThd') throw new Error('Not a MIDI file');
  pos += 4;
  const hlen = u32(), hstart = pos;
  const format = u16(), ntracks = u16(), division = u16();
  pos = hstart + hlen;
  if (division & 0x8000) throw new Error('This MIDI file counts time in SMPTE frames: save it with beats (PPQ) instead');

  const tempos = [], sigs = [], partMap = new Map(), names = [];
  let length = 0;
  const part = (track, channel) => {
    const key = `${track}:${channel}`;
    if (!partMap.has(key)) partMap.set(key, { key, track, channel, name: '', program: null, drums: channel === 9, notes: [], volume: null, pan: null });
    return partMap.get(key);
  };
  for (let ti = 0; ti < ntracks && pos + 8 <= d.length; ti++) {
    if (tag() !== 'MTrk') { pos += 4; const l = u32(); pos += l; ti--; continue; } // (unknown chunks are skipped)
    pos += 4;
    const len = u32(), end = Math.min(d.length, pos + len);
    let tick = 0, status = 0;
    const on = new Map(); // channel*128+pitch -> [{ tick, v }] (a stack: the same key struck again)
    const varLen = () => { let v = 0, b; do { b = d[pos++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80 && pos < end); return v; };
    while (pos < end) {
      tick += varLen();
      let s = d[pos];
      if (s & 0x80) { pos++; if (s < 0xf0) status = s; } else s = status; // running status
      if (s === 0xff) {
        const type = d[pos++], l = varLen(), data = d.subarray(pos, pos + l);
        pos += l;
        if (type === 0x51 && l >= 3) tempos.push({ tick, uspq: data[0] << 16 | data[1] << 8 | data[2] });
        else if (type === 0x58 && l >= 2) sigs.push({ tick, num: data[0], den: 1 << data[1] });
        else if (type === 0x03 || (type === 0x04 && !names[ti])) names[ti] = text(data);
        else if (type === 0x2f) break;
        continue;
      }
      if (s === 0xf0 || s === 0xf7) { const l = varLen(); pos += l; continue; }
      if (s < 0x80) { pos++; continue; } // (data with no status: broken, skip it)
      const kind = s & 0xf0, ch = s & 0x0f;
      const a = d[pos++], b = kind === 0xc0 || kind === 0xd0 ? 0 : d[pos++];
      if (kind === 0x90 && b > 0) {
        const k = ch * 128 + a;
        if (!on.has(k)) on.set(k, []);
        on.get(k).push({ tick, v: b });
        part(ti, ch);
      } else if (kind === 0x80 || kind === 0x90) {
        const st = on.get(ch * 128 + a);
        const n = st?.shift();
        if (n) part(ti, ch).notes.push({ tick: n.tick, dur: tick - n.tick, p: a, v: n.v });
      } else if (kind === 0xc0) { const p = part(ti, ch); if (p.program === null) p.program = a; }
      else if (kind === 0xb0) {
        const p = part(ti, ch);
        if (a === 7 && p.volume === null) p.volume = b;
        if (a === 10 && p.pan === null) p.pan = b;
      }
    }
    // notes still held at the end of the track end there
    for (const [k, st] of on) for (const n of st) part(ti, k >> 7).notes.push({ tick: n.tick, dur: Math.max(1, tick - n.tick), p: k & 127, v: n.v });
    length = Math.max(length, tick);
    pos = end;
  }

  const parts = [...partMap.values()].filter((p) => p.notes.length);
  const perTrack = new Map();
  for (const p of parts) perTrack.set(p.track, (perTrack.get(p.track) || 0) + 1);
  for (const p of parts) {
    p.notes.sort((a, b) => a.tick - b.tick || a.p - b.p);
    const tn = names[p.track]?.trim();
    const inst = p.drums ? 'Drums' : GM_NAMES[p.program ?? 0];
    // a track's name, or the instrument's (several channels in one track: both)
    p.name = (tn && perTrack.get(p.track) === 1 ? tn : tn ? `${tn} · ${inst}` : inst).slice(0, 40);
    p.gmName = inst;
  }
  tempos.sort((a, b) => a.tick - b.tick);
  const first = tempos.find((t) => t.tick === 0) || tempos[0];
  const sig = sigs.sort((a, b) => a.tick - b.tick)[0];
  return {
    format, division, length, parts,
    tempo: first ? 60000000 / first.uspq : 120,
    tempoChanges: new Set(tempos.map((t) => t.uspq)).size > 1,
    timeSig: sig ? [sig.num, sig.den] : [4, 4],
  };
}

const u32le = (d, p) => (d[p] | d[p + 1] << 8 | d[p + 2] << 16 | d[p + 3] << 24) >>> 0;
const text = (b) => { let s = ''; for (const c of b) s += c >= 32 && c < 127 ? String.fromCharCode(c) : c >= 160 ? String.fromCharCode(c) : ''; return s; };

// ---- General MIDI -----------------------------------------------------------------

export const GM_NAMES = [
  'Acoustic Grand Piano', 'Bright Piano', 'Electric Grand Piano', 'Honky-tonk Piano', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavinet',
  'Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer',
  'Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion',
  'Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Guitar', 'Muted Guitar', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics',
  'Acoustic Bass', 'Finger Bass', 'Pick Bass', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2',
  'Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani',
  'String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit',
  'Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2',
  'Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet',
  'Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Blown Bottle', 'Shakuhachi', 'Whistle', 'Ocarina',
  'Square Lead', 'Saw Lead', 'Calliope Lead', 'Chiff Lead', 'Charang Lead', 'Voice Lead', 'Fifths Lead', 'Bass + Lead',
  'New Age Pad', 'Warm Pad', 'Polysynth Pad', 'Choir Pad', 'Bowed Pad', 'Metallic Pad', 'Halo Pad', 'Sweep Pad',
  'Rain FX', 'Soundtrack FX', 'Crystal FX', 'Atmosphere FX', 'Brightness FX', 'Goblins FX', 'Echoes FX', 'Sci-fi FX',
  'Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai',
  'Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal',
  'Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot',
];

// What a General MIDI instrument is closest to among the game's: the sound set's labels
// ('Bass', 'Melody', 'Lead', 'Chords (plucked)', 'Soft pad', 'Percussive hit', 'Noise') in order.
const ROLES = [
  ['Chords (plucked)', 'Chords', 'Melody'],   // pianos
  ['Percussive hit', 'Chords (plucked)', 'Melody'], // chromatic percussion
  ['Chords (sustained)', 'Soft pad', 'Chords'], // organs
  ['Chords (plucked)', 'Bass (plucked)', 'Chords'], // guitars
  ['Bass'],                                    // basses
  ['Melody', 'Lead', 'Chords (sustained)'],    // strings
  ['Chords (sustained)', 'Soft pad', 'Chords'], // ensembles, choirs
  ['Lead', 'Melody'],                          // brass
  ['Lead', 'Melody'],                          // reeds
  ['Melody', 'Lead'],                          // pipes, flutes
  ['Lead', 'Melody'],                          // synth leads
  ['Soft pad', 'Chords (sustained)', 'Chords'], // synth pads
  ['Soft pad', 'Noise', 'Chords'],             // synth effects
  ['Chords (plucked)', 'Melody'],              // ethnic
  ['Percussive hit', 'Noise'],                 // percussive
  ['Noise', 'Percussive hit'],                 // sound effects
];

// The sound set's instrument for a part: by its General MIDI family, a low part a bass,
// trying not to give two parts the same one.
export function programForPart(bank, part, used = new Set()) {
  const progs = bank.programs || [];
  if (!progs.length) return 0;
  const avg = part.notes.reduce((a, n) => a + n.p, 0) / Math.max(1, part.notes.length);
  const roles = [...(ROLES[(part.program ?? 0) >> 3] || ROLES[0])];
  if (avg < 48 && roles[0] !== 'Bass') roles.unshift('Bass');
  if (avg >= 52 && roles[0] === 'Bass') roles.push('Melody');
  for (const pass of [0, 1]) {
    for (const r of roles) {
      const p = progs.find((x) => x.label.startsWith(r) && (pass || !used.has(x.program)));
      if (p) return p.program;
    }
  }
  return (progs.find((x) => !/Noise|hit/.test(x.label) && !used.has(x.program)) || progs[0]).program;
}

// General MIDI drum notes -> the kit's kinds; toms and the rest spread over the kit's variants.
const GM_DRUMS = {
  35: 'Kick', 36: 'Kick', 38: 'Snare', 40: 'Snare',
  41: 'Tom', 43: 'Tom', 45: 'Tom', 47: 'Tom', 48: 'Tom', 50: 'Tom',
  42: 'Hi-hat', 44: 'Hi-hat', 46: 'Hi-hat', 49: 'Hi-hat', 51: 'Hi-hat', 52: 'Hi-hat', 53: 'Hi-hat', 55: 'Hi-hat', 57: 'Hi-hat', 59: 'Hi-hat',
};
export function drumMap(bank, notes) {
  const kit = bank.drums || [];
  const map = new Map();
  if (!kit.length) return map;
  const byKind = (k) => kit.filter((x) => x.label.replace(/ \d+$/, '') === k);
  const used = [...new Set(notes.map((n) => n.p))].sort((a, b) => a - b);
  const count = {};
  for (const p of used) {
    const kind = GM_DRUMS[p] || 'Percussion';
    const list = byKind(kind).length ? byKind(kind) : byKind('Percussion').length ? byKind('Percussion') : kit;
    // (in the kind's own order: a second tom gets "Tom 2", the low toms first)
    const i = count[kind] = (count[kind] ?? -1) + 1;
    map.set(p, list[Math.min(i, list.length - 1)].note);
  }
  return map;
}

// A sound set for a MIDI file: with a drum kit when it has drums, and many instruments.
export function bankForMidi(banks, midi) {
  const drums = midi.parts.some((p) => p.drums);
  const pool = drums ? banks.filter((b) => b.drums.length) : banks;
  return [...(pool.length ? pool : banks)].sort((a, b) => b.programs.length - a.programs.length)[0];
}

// ---- conversion -------------------------------------------------------------------

// The import settings for a file: every part on, an instrument each, the whole length.
export function importPlan(midi, banks, bankId) {
  const bank = bankId != null ? bankOf(banks, bankId) : bankForMidi(banks, midi);
  const used = new Set();
  const parts = midi.parts.map((p) => {
    const kit = p.drums && bank.drums.length;
    const program = kit ? 0 : programForPart(bank, p, used);
    if (!kit) used.add(program);
    return { key: p.key, on: true, kind: kit ? 'drums' : 'inst', program };
  });
  // the game's tempos run 40-240 bpm: a faster song counts in half time (a beat is two of the
  // file's), a slower one in double time
  let tempo = midi.tempo, beatScale = 1;
  while (tempo > 240) { tempo /= 2; beatScale *= 2; }
  while (tempo < 40) { tempo *= 2; beatScale /= 2; }
  const [num, den] = midi.timeSig, perBar = (num * 4) / den / beatScale;
  const beatsPerBar = Number.isInteger(perBar) && perBar >= 1 && perBar <= 12 ? perBar : 4;
  const bars = Math.max(1, Math.ceil(midi.length / (midi.division * beatScale * beatsPerBar)));
  return { bank: bank.bank, stepsPerBeat: 4, beatsPerBar, beatScale, from: 0, bars, tempo: Math.round(tempo), parts };
}

// The song a plan makes: notes on the grid (stepsPerBeat steps a beat), from bar `from` on.
export function midiToSong(midi, plan, banks, name = 'Imported song') {
  const bank = bankOf(banks, plan.bank);
  const song = newSong({ name, bank: bank.bank, tempo: Math.round(Math.max(40, Math.min(240, plan.tempo))), bars: plan.bars });
  song.beatsPerBar = plan.beatsPerBar;
  song.stepsPerBeat = plan.stepsPerBeat;
  const tps = (midi.division * (plan.beatScale || 1)) / plan.stepsPerBeat; // MIDI ticks a step
  const first = plan.from * plan.beatsPerBar * plan.stepsPerBeat, total = plan.bars * plan.beatsPerBar * plan.stepsPerBeat;
  for (const pp of plan.parts) {
    if (!pp.on) continue;
    const part = midi.parts.find((x) => x.key === pp.key);
    if (!part) continue;
    const kit = pp.kind === 'drums' && bank.drums.length;
    const map = kit ? drumMap(bank, part.notes) : null;
    const t = newTrack(kit ? 'drums' : 'inst', kit ? 0 : pp.program, part.name);
    if (part.volume !== null) t.volume = Math.round(Math.max(20, part.volume));
    if (part.pan !== null) t.pan = part.pan;
    const seen = new Set();
    for (const n of part.notes) {
      const s = Math.round(n.tick / tps) - first;
      if (s < 0 || s >= total) continue;
      const e = Math.min(total, Math.round((n.tick + n.dur) / tps) - first);
      const p = kit ? map.get(n.p) : n.p;
      if (p === undefined) continue;
      const k = `${s}:${p}`;
      if (seen.has(k)) continue; // (two notes on the same key at once on the grid: one)
      seen.add(k);
      t.notes.push({ t: s, d: kit ? Math.max(1, Math.min(e - s, plan.stepsPerBeat)) : Math.max(1, e - s), p, v: n.v });
    }
    if (t.notes.length) song.tracks.push(t);
  }
  return song;
}
