// Songs for the sound composer: the song model, the encoder to the game's sequence
// format (.m64, played by the game's own sequence player with the game's instruments),
// the game's own songs and a few starter songs.

export const TICKS_PER_BEAT = 48;   // the sequence player's resolution
export const SIZE_LIMIT = 8192;     // what the game's sequence cache holds comfortably
export const MAX_TRACKS = 12;
export const MAX_VOICES = 4;        // notes a track plays at once (layers per channel)

// The game's songs by sequence id (sound/sequences.json order).
export const GAME_SONGS = [
  { seq: 0x03, name: 'Bob-omb Battlefield', group: 'Courses' }, { seq: 0x05, name: 'Dire, Dire Docks', group: 'Courses' },
  { seq: 0x06, name: 'Lethal Lava Land', group: 'Courses' }, { seq: 0x08, name: 'Cool, Cool Mountain', group: 'Courses' },
  { seq: 0x09, name: 'Slider', group: 'Courses' }, { seq: 0x0A, name: "Big Boo's Haunt", group: 'Courses' },
  { seq: 0x0C, name: 'Hazy Maze Cave', group: 'Courses' }, { seq: 0x04, name: 'Inside the castle', group: 'Courses' },
  { seq: 0x11, name: 'Bowser road', group: 'Bowser' }, { seq: 0x07, name: 'Bowser battle', group: 'Bowser' },
  { seq: 0x19, name: 'Final Bowser', group: 'Bowser' }, { seq: 0x16, name: 'Boss', group: 'Bowser' },
  { seq: 0x0E, name: 'Wing cap', group: 'Power-ups' }, { seq: 0x0F, name: 'Metal cap', group: 'Power-ups' },
  { seq: 0x18, name: 'Endless stairs', group: 'Events' }, { seq: 0x13, name: 'Merry-go-round', group: 'Events' },
  { seq: 0x0B, name: 'Piranha lullaby', group: 'Events' }, { seq: 0x14, name: 'Race fanfare', group: 'Events' },
  { seq: 0x02, name: 'Title screen', group: 'Menus' }, { seq: 0x21, name: 'File select', group: 'Menus' },
  { seq: 0x0D, name: 'Star select', group: 'Menus' }, { seq: 0x1E, name: 'Intro', group: 'Cutscenes' },
  { seq: 0x1D, name: 'Peach message', group: 'Cutscenes' }, { seq: 0x1C, name: 'Toad message', group: 'Cutscenes' },
  { seq: 0x1F, name: 'Victory', group: 'Cutscenes' }, { seq: 0x01, name: 'Star collect', group: 'Jingles' },
  { seq: 0x15, name: 'Star appears', group: 'Jingles' }, { seq: 0x1B, name: 'Puzzle solved', group: 'Jingles' },
  { seq: 0x17, name: 'Key collect', group: 'Jingles' }, { seq: 0x12, name: 'High score', group: 'Jingles' },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = (midi) => `${NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
export function parseNote(s) {
  if (typeof s === 'number') return s;
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(String(s).trim());
  if (!m) return null;
  let n = NOTE_NAMES.indexOf(m[1].toUpperCase()) + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return n + (Number(m[3]) + 1) * 12;
}

// ---- instruments ---------------------------------------------------------------

let sCatalog = null;
export async function loadInstruments() {
  if (!sCatalog) sCatalog = fetch('data/instruments.json').then((r) => r.json()).then((d) => d.banks);
  return sCatalog;
}
export const bankOf = (banks, id) => banks.find((b) => b.bank === id) || banks[0];
// A program for a role ('Bass', 'Melody', 'Chords'): the first one labelled so.
export function programFor(bank, role) {
  return (bank.programs.find((p) => p.label.startsWith(role)) || bank.programs.find((p) => !/Noise|hit/.test(p.label)) || bank.programs[0])?.program ?? 0;
}
export function drumFor(bank, name) {
  return (bank.drums.find((d) => d.label === name) || bank.drums.find((d) => d.label.startsWith(name)) || bank.drums[0])?.note ?? 0;
}

// ---- the model -----------------------------------------------------------------

const uid = () => Math.random().toString(36).slice(2, 10);

export function newSong({ name = 'New song', bank = 0x22, tempo = 120, bars = 8 } = {}) {
  return { id: uid(), name, bank, tempo, bars, beatsPerBar: 4, stepsPerBeat: 4, volume: 100, tracks: [] };
}

export function newTrack(kind = 'inst', program = 0, name) {
  return { id: uid(), name: name || (kind === 'drums' ? 'Drums' : 'Track'), kind, program, volume: 100, pan: 64, reverb: 20, mute: false, legato: false, notes: [] };
}

export const songSteps = (s) => s.bars * s.beatsPerBar * s.stepsPerBeat;

// ---- encoding ------------------------------------------------------------------

const varLen = (n) => {
  n = Math.max(0, Math.min(0x7fff, Math.round(n)));
  return n >= 0x80 ? [0x80 | (n >> 8), n & 0xff] : [n];
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Splits a track's notes into voices that never overlap (one layer each).
function voicesOf(notes) {
  const voices = [];
  for (const n of [...notes].sort((a, b) => a.t - b.t || b.p - a.p)) {
    const v = voices.find((vv) => vv.end <= n.t);
    if (v) { v.notes.push(n); v.end = n.t + n.d; } else if (voices.length < MAX_VOICES) voices.push({ notes: [n], end: n.t + n.d });
  }
  return voices.map((v) => v.notes);
}

// The song as .m64 bytes: a header that starts one channel per track and waits forever,
// channels that restart their layers every loop, layers with the notes.
export function encodeSong(song) {
  const stepTicks = TICKS_PER_BEAT / song.stepsPerBeat;
  const loop = Math.min(0x7fff, song.bars * song.beatsPerBar * TICKS_PER_BEAT);
  const tracks = song.tracks.filter((t) => !t.mute && t.notes.length).slice(0, MAX_TRACKS);
  const out = [], fix = [], at = {};
  const emit = (...b) => { for (const x of b) out.push(x & 0xff); };
  const ref = (label) => { fix.push({ pos: out.length, label }); out.push(0, 0); };

  const mask = tracks.reduce((m, _, i) => m | (1 << i), 0);
  emit(0xd3, 0x80);                    // seq_setmutebhv
  emit(0xd7, mask >> 8, mask);         // seq_initchannels
  tracks.forEach((_, i) => { emit(0x90 + i); ref(`ch${i}`); });
  emit(0xdd, clamp(Math.round(song.tempo), 20, 255)); // seq_settempo
  emit(0xdb, clamp(song.volume ?? 100, 0, 127));      // seq_setvol
  at.wait = out.length;
  emit(0xfd, ...varLen(loop)); emit(0xfb); ref('wait');

  const voiceLists = tracks.map((t) => voicesOf(t.notes));
  tracks.forEach((t, i) => {
    at[`ch${i}`] = out.length;
    emit(0xc4);                                            // chan_largenoteson
    emit(0xc1, t.kind === 'drums' ? 0x7f : t.program);     // chan_setinstr (0x7f: the drum kit)
    emit(0xdf, clamp(t.volume ?? 100, 0, 127));            // chan_setvol
    emit(0xdd, clamp(t.pan ?? 64, 0, 127));                // chan_setpan
    emit(0xd4, clamp(t.reverb ?? 20, 0, 127));             // chan_setreverb
    at[`loop${i}`] = out.length;
    voiceLists[i].forEach((_, k) => { emit(0x90 + k); ref(`ly${i}_${k}`); }); // chan_setlayer
    emit(0xfd, ...varLen(loop)); emit(0xfb); ref(`loop${i}`);
  });

  tracks.forEach((t, i) => voiceLists[i].forEach((voice, k) => {
    at[`ly${i}_${k}`] = out.length;
    let time = 0, trans = 0;
    for (const n of voice) {
      const start = n.t * stepTicks;
      if (start >= loop) break;
      const dur = Math.max(1, Math.min(n.d * stepTicks, loop - start));
      if (start > time) { emit(0xc0, ...varLen(start - time)); time = start; } // layer_delay
      // note numbers 0..63 (39 = middle C); a transpose reaches further
      const idx = t.kind === 'drums' ? clamp(n.p, 0, 63) : n.p - 21;
      let tr = trans;
      if (idx - tr < 0 || idx - tr > 63) tr = idx < 0 ? -12 * Math.ceil(-idx / 12) : idx > 63 ? 12 * Math.ceil((idx - 63) / 12) : 0;
      if (tr !== trans) { emit(0xc2, tr); trans = tr; }    // layer_transpose
      emit(clamp(idx - trans, 0, 63), ...varLen(dur), clamp(n.v ?? 100, 1, 127), t.legato ? 254 : 215); // layer_note0
      time = start + dur;
    }
    emit(0xff); // layer_end
  }));

  for (const f of fix) {
    const a = at[f.label];
    out[f.pos] = a >> 8; out[f.pos + 1] = a & 0xff;
  }
  return new Uint8Array(out);
}

// A one-bar phrase to hear an instrument (or the drum kit) on its own.
export function auditionSong(bank, program, drums = false) {
  const s = newSong({ name: 'audition', bank: bank.bank, tempo: 132, bars: 2 });
  const t = newTrack(drums ? 'drums' : 'inst', program);
  const kit = [drumFor(bank, 'Kick'), drumFor(bank, 'Hi-hat'), drumFor(bank, 'Snare'), drumFor(bank, 'Hi-hat')];
  t.notes = drums ? [0, 2, 4, 6, 8, 10, 12, 14].map((x, i) => ({ t: x, d: 2, p: kit[i % 4], v: 110 }))
    : [60, 64, 67, 72, 67, 64, 60].map((p, i) => ({ t: i * 2, d: i === 6 ? 6 : 2, p, v: 105 }));
  s.tracks.push(t);
  return s;
}

// ---- starter songs -------------------------------------------------------------

const CHORDS = { C: [0, 4, 7], Dm: [2, 5, 9], Em: [4, 7, 11], F: [5, 9, 12], G: [7, 11, 14], Am: [9, 12, 16], E: [4, 8, 11], Bb: [10, 14, 17] };

function arrange(song, bank, { key = 60, progression, melody, bass = 'roots', drums = 'pop', chordStyle = 'stabs' }) {
  const spb = song.stepsPerBeat, bar = spb * song.beatsPerBar;
  const chordsT = newTrack('inst', programFor(bank, 'Chords'), 'Chords');
  const bassT = newTrack('inst', programFor(bank, 'Bass'), 'Bass');
  const leadT = newTrack('inst', programFor(bank, 'Melody'), 'Melody');
  chordsT.volume = 78; bassT.volume = 105; leadT.volume = 100;
  for (let b = 0; b < song.bars; b++) {
    const ch = CHORDS[progression[b % progression.length]];
    const t0 = b * bar;
    if (chordStyle === 'pad') for (const c of ch) chordsT.notes.push({ t: t0, d: bar, p: key + c - 12, v: 70 });
    else for (const s of [0, 1.5, 2, 3.5].map((x) => x * spb)) for (const c of ch) chordsT.notes.push({ t: t0 + s, d: spb / 2, p: key + c - 12, v: 80 });
    const root = key + ch[0] - 24;
    if (bass === 'roots') for (const s of [0, 2]) bassT.notes.push({ t: t0 + s * spb, d: spb * 2 - 1, p: root, v: 110 });
    else for (const [s, o] of [[0, 0], [1, 7], [2, 12], [3, 7]]) bassT.notes.push({ t: t0 + s * spb, d: spb - 1, p: root + o, v: 105 });
    const phrase = melody[b % melody.length];
    for (const [beat, len, deg] of phrase) {
      if (deg === null) continue;
      leadT.notes.push({ t: t0 + beat * spb, d: len * spb, p: key + ch[0] + deg + (ch[0] > 6 ? -12 : 0) + 12, v: 104 });
    }
  }
  song.tracks.push(leadT, chordsT, bassT);
  if (drums && bank.drums.length) {
    const d = newTrack('drums', 0, 'Drums');
    const kick = drumFor(bank, 'Kick'), snare = drumFor(bank, 'Snare'), hat = drumFor(bank, 'Hi-hat');
    for (let b = 0; b < song.bars; b++) {
      const t0 = b * bar;
      const hits = drums === 'pop' ? [[0, kick], [4, snare], [8, kick], [10, kick], [12, snare]] : [[0, kick], [6, kick], [8, snare], [14, snare]];
      for (const [s, n] of hits) d.notes.push({ t: t0 + s, d: 2, p: n, v: 108 });
      for (let s = 0; s < bar; s += 2) d.notes.push({ t: t0 + s, d: 1, p: hat, v: s % 4 ? 70 : 88 });
    }
    song.tracks.push(d);
  }
  return song;
}

// Melodies as [beat, length in beats, semitones above the chord root] per bar.
const M_SUNNY = [
  [[0, 1, 12], [1, 0.5, 16], [1.5, 0.5, 19], [2, 1, 16], [3, 1, 12]],
  [[0, 1.5, 14], [1.5, 0.5, 11], [2, 2, 7]],
  [[0, 0.5, 12], [0.5, 0.5, 14], [1, 1, 16], [2, 1, 19], [3, 1, 16]],
  [[0, 2, 12], [2, 1, 9], [3, 1, 7]],
];
const M_NIGHT = [[[0, 2, 12], [2, 2, 15]], [[0, 3, 12], [3, 1, 7]], [[0, 1, 7], [1, 1, 12], [2, 2, 14]], [[0, 4, 12]]];
const M_RUSH = [
  [[0, 0.5, 12], [0.5, 0.5, 12], [1, 0.5, 15], [1.5, 0.5, 12], [2, 1, 17], [3, 1, 15]],
  [[0, 0.5, 12], [0.5, 0.5, 10], [1, 1, 7], [2, 2, 12]],
];
const M_WATER = [[[0, 1, 12], [1, 1, 16], [2, 1, 19], [3, 1, 23]], [[0, 2, 21], [2, 2, 19]], [[0, 1, 16], [1, 1, 19], [2, 2, 12]], [[0, 4, 14]]];

export const STARTERS = [
  { id: 'sunny', name: 'Sunny Fields', note: 'Bouncy course music with drums', bank: 0x22, tempo: 128,
    build: (s, b) => arrange(s, b, { progression: ['C', 'G', 'Am', 'F'], melody: M_SUNNY, bass: 'walk', drums: 'pop' }) },
  { id: 'night', name: 'Snowy Night', note: 'Slow and calm, sustained chords', bank: 0x0B, tempo: 84,
    build: (s, b) => arrange(s, b, { key: 57, progression: ['Am', 'F', 'C', 'G'], melody: M_NIGHT, chordStyle: 'pad', drums: null }) },
  { id: 'rush', name: 'Lava Rush', note: 'Fast and tense, for danger', bank: 0x19, tempo: 156,
    build: (s, b) => arrange(s, b, { key: 57, progression: ['Am', 'Am', 'F', 'E'], melody: M_RUSH, bass: 'walk', drums: 'rock' }) },
  { id: 'water', name: 'Deep Water', note: 'Floating arpeggios', bank: 0x13, tempo: 76,
    build: (s, b) => arrange(s, b, { progression: ['C', 'Em', 'F', 'G'], melody: M_WATER, chordStyle: 'pad', bass: 'roots', drums: null }) },
  { id: 'empty', name: 'Empty song', note: 'Start from nothing', bank: 0x22, tempo: 120, build: (s) => s },
];

export function starterSong(starter, banks) {
  const s = newSong({ name: starter.id === 'empty' ? 'New song' : starter.name, bank: starter.bank, tempo: starter.tempo });
  return starter.build(s, bankOf(banks, starter.bank));
}
