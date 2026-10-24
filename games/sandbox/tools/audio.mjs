// The game's music and voices, composed and synthesised here (tools/lib/synth.mjs), written as WAV files
// for audioconv64 (music: assets/audio/mus_*.wav -> VADPCM wav64 streams) and as one voice bank
// (assets/voices.bin: raw 16-bit clips the game keeps in memory).
//
// To add a song: write a function like day() below (chords, a melody, drums), add it to SONGS, and add
// its name to the MUS_ list in src/sound.h in the same order. To add a voice line: add it to VOICES and
// to the VO_ list in src/sound.h.
import fs from 'node:fs';
import path from 'node:path';
import { SR, Song, inst, drums, chord, voicing, mtof, midi, speak, wav, srand, rnd } from './lib/synth.mjs';

// ---- shared parts ----
// one bar of chords: "Am7 D7" -> [[chord, startBeat, beats], ...]
function bars(progression) {
  return progression.map((bar) => {
    const names = bar.split(' ');
    const each = 4 / names.length;
    return names.map((n, i) => [chord(n), i * each, each]);
  });
}
// a funky bass line: root, octave pops, the fifth, a chromatic walk into the next chord
function funkBass(song, prog, start, o = {}) {
  const g = o.gain || 0.55;
  prog.forEach((bar, bi) => {
    const b0 = start + bi * 4;
    const next = prog[(bi + 1) % prog.length][0][0];
    for (const [ch, s, len] of bar) {
      const r = ch.root + 12 * (o.oct || 0);
      const fifth = r + 7, oct = r + 12;
      const third = r + ch.tones[1];
      if (len >= 4) {
        song.melody(inst.bass, [[r, 0.75], [oct, 0.25, 0.7], ['r', 0.5], [r, 0.5, 0.8], [fifth, 0.5, 0.9], [third, 0.25, 0.7], [fifth, 0.25, 0.8], [oct, 0.5, 0.8], [next.root + 12 * (o.oct || 0) - 1, 0.5, 0.7]], b0 + s, { gain: g, send: 0.03, glide: true, legato: 0.85 });
      } else {
        song.melody(inst.bass, [[r, 0.75], [oct, 0.25, 0.7], ['r', 0.25], [r, 0.25, 0.7], [fifth, 0.5, 0.85]], b0 + s, { gain: g, send: 0.03, glide: true, legato: 0.85 });
      }
    }
  });
}
// a groove: kick / snare / hats on a sixteenth grid ('x' hit, 'o' soft, 'O' open hat)
function groove(song, startBar, nBars, pat, o = {}) {
  const g = o.gain || 1;
  for (let bar = 0; bar < nBars; bar++) {
    const b0 = (startBar + bar) * 4;
    const fillBar = o.fillEvery && (startBar + bar + 1) % o.fillEvery === 0;
    for (let s = 0; s < 16; s++) {
      const beat = b0 + s / 4;
      const k = pat.kick[s], sn = pat.snare[s], h = pat.hat[s];
      if (k === 'x') song.add(drums.kick(1, o.kickTone || 1), beat, { gain: 0.95 * g, send: 0.02 });
      if (k === 'o') song.add(drums.kick(0.6, o.kickTone || 1), beat, { gain: 0.9 * g, send: 0.02 });
      if (fillBar && s >= 12) {
        song.add(drums.snare(0.5 + (s - 12) * 0.15), beat, { gain: 0.5 * g, send: 0.15, pan: (s - 13.5) * 0.2 });
        continue;
      }
      if (sn === 'x') {
        song.add(drums.snare(1), beat, { gain: 0.62 * g, send: 0.18 });
        if (o.clap) song.add(drums.clap(1), beat, { gain: 0.35 * g, send: 0.25, pan: 0.1 });
      }
      if (sn === 'o') song.add(drums.snare(0.35), beat, { gain: 0.35 * g, send: 0.1, pan: -0.1 });
      if (sn === 'r') song.add(drums.rim(1), beat, { gain: 0.45 * g, send: 0.15, pan: -0.15 });
      if (h === 'x') song.add(drums.hat(0.9), beat, { gain: 0.2 * g, send: 0.05, pan: 0.3 });
      if (h === 'o') song.add(drums.hat(0.5), beat, { gain: 0.2 * g, send: 0.05, pan: 0.3 });
      if (h === 'O') song.add(drums.hat(0.8, true), beat, { gain: 0.18 * g, send: 0.08, pan: 0.3 });
      if (h === 's') song.add(drums.shaker(1), beat, { gain: 0.32 * g, send: 0.06, pan: 0.35 });
    }
  }
}
const P = (s) => s.replace(/ /g, '').split('');
// chord stabs/comping: hits at given beats within each chord span
function comp(song, prog, start, instrument, hits, o = {}) {
  prog.forEach((bar, bi) => {
    for (const [ch, s, len] of bar) {
      const notes = voicing(ch, o.centre || 62, o.count || 4);
      for (const [hb, hl, hv] of hits) {
        if (hb >= len) continue;
        notes.forEach((m, k) => song.add(instrument(mtof(m), song.secs(Math.min(hl, len - hb)) * 0.95, (hv || 1) * (0.85 + rnd() * 0.15), o.opts || {}), start + bi * 4 + s + hb, { gain: o.gain || 0.2, send: o.send ?? 0.3, pan: (k / (notes.length - 1) - 0.5) * (o.spread ?? 0.6), offset: k * 0.006 }));
      }
    }
  });
}
function padChords(song, prog, start, o = {}) {
  prog.forEach((bar, bi) => {
    for (const [ch, s, len] of bar) voicing(ch, o.centre || 64, 4).forEach((m, k) => song.add(inst.pad(mtof(m), song.secs(len) * 0.98, 1), start + bi * 4 + s, { gain: o.gain || 0.07, send: 0.5, pan: (k - 1.5) * 0.35 }));
  });
}
function arps(song, prog, start, instrument, o = {}) {
  prog.forEach((bar, bi) => {
    for (const [ch, s, len] of bar) {
      const notes = voicing(ch, o.centre || 74, 4);
      const order = o.order || [0, 1, 2, 3, 2, 1, 2, 3];
      const step = o.step || 0.5;
      for (let b = 0, k = 0; b < len - 1e-6; b += step, k++) {
        const m = notes[order[k % order.length] % notes.length];
        song.add(instrument(mtof(m), song.secs(step), k % 2 ? 0.7 : 1), start + bi * 4 + s + b, { gain: o.gain || 0.15, send: o.send ?? 0.3, pan: o.pan ?? (k % 2 ? 0.4 : -0.4) });
      }
    }
  });
}

// ======================================================================================================
// "Sunny Block" — the city by day: a bouncy funk tune in F
// ======================================================================================================
function day() {
  srand(101);
  const song = new Song({ bpm: 100, bars: 16, swing: 0.55 });
  const prog = bars(['Fmaj7', 'Am7 D7', 'Gm7', 'C7', 'Fmaj7', 'Am7 D7', 'Gm7 C7', 'F6', 'Bbmaj7', 'Bbm6 Eb9', 'Am7', 'D7', 'Gm7', 'C7', 'Am7 D7', 'Gm7 C7']);
  const mel = [
    [['r', 0.5], ['C5', 0.5], ['F5', 0.5], ['A5', 0.5], ['G5', 0.75], ['F5', 0.25], ['E5', 0.5], ['F5', 0.5]],
    [['A5', 1.5], ['G5', 0.5], ['F#5', 0.5], ['A5', 0.5], ['C6', 1]],
    [['Bb5', 1], ['A5', 0.5], ['G5', 0.5], ['F5', 0.5], ['D5', 0.5], ['F5', 1]],
    [['E5', 1.5], ['G5', 0.5], ['Bb5', 1], ['r', 1]],
    [['r', 0.5], ['C5', 0.5], ['F5', 0.5], ['A5', 0.5], ['C6', 0.75], ['A5', 0.25], ['G5', 0.5], ['A5', 0.5]],
    [['C6', 1], ['A5', 0.5], ['E5', 0.5], ['F#5', 1], ['D5', 1]],
    [['G5', 0.5], ['Bb5', 0.5], ['A5', 0.5], ['G5', 0.5], ['E5', 0.5], ['G5', 0.5], ['Bb5', 0.5], ['A5', 0.5]],
    [['F5', 2], ['r', 0.5], ['D5', 0.25], ['F5', 0.25], ['A5', 1]],
    [['D6', 1.5], ['C6', 0.5], ['A5', 1], ['F5', 1]],
    [['Db6', 1], ['Bb5', 0.5], ['F5', 0.5], ['G5', 1], ['F5', 1]],
    [['E5', 0.5], ['G5', 0.5], ['A5', 0.5], ['C6', 1.5], ['A5', 0.5], ['G5', 0.5]],
    [['F#5', 1.5], ['A5', 0.5], ['C6', 1], ['D6', 1]],
    [['D6', 0.75], ['C6', 0.25], ['Bb5', 0.5], ['A5', 0.5], ['G5', 1], ['F5', 1]],
    [['E5', 0.5], ['F5', 0.5], ['G5', 0.5], ['Bb5', 0.5], ['C6', 1], ['Bb5', 0.5], ['G5', 0.5]],
    [['A5', 1], ['C6', 1], ['F#5', 0.5], ['A5', 0.5], ['D6', 1]],
    [['C6', 1], ['Bb5', 0.5], ['A5', 0.5], ['G5', 0.5], ['E5', 0.5], ['C5', 1]],
  ];
  const A = mel.slice(0, 8).flat(), B = mel.slice(8).flat();
  // A: the whistle sings it up high, a marimba doubles it softly; B: a bright square lead and horns
  song.melody(inst.whistle, A, 0, { transpose: 12, gain: 0.3, send: 0.35, glide: true, pan: 0.1 });
  song.melody(inst.marimba, A, 0, { gain: 0.16, send: 0.25, pan: -0.3 });
  song.melody(inst.pulse, B, 32, { gain: 0.32, send: 0.3, pan: 0.05 });
  song.melody(inst.brass, B, 32, { transpose: -12, gain: 0.12, send: 0.3, pan: -0.25 });
  funkBass(song, prog, 0);
  comp(song, prog, 0, inst.rhodes, [[0, 0.5], [1.5, 0.25, 0.7], [2.5, 0.75, 0.9]], { gain: 0.11, centre: 63, opts: { trem: 0.3 } });
  // muted guitar chicks on the off-beats
  prog.forEach((bar, bi) => { for (const [ch, s, len] of bar) for (let b = 0.5; b < len; b += 1) voicing(ch, 67, 3).forEach((m, k) => song.add(inst.pluck(mtof(m), 0.07, 1, { damp: 0.47 }), bi * 4 + s + b, { gain: 0.13, send: 0.1, pan: 0.55, offset: k * 0.004 })); });
  arps(song, prog.slice(8), 32, inst.marimba, { gain: 0.07, centre: 77, step: 0.25 });
  padChords(song, prog.slice(8), 32, { gain: 0.05 });
  const pat = { kick: P('x... ...x x.x. ....'), snare: P('.... x..o .o.. x...'), hat: P('xoxo xoxo xoxo xoOo') };
  groove(song, 0, 16, pat, { clap: true, fillEvery: 8 });
  song.add(drums.crash(0.8), 0, { gain: 0.25, send: 0.3, pan: -0.3 });
  song.add(drums.crash(0.8), 32, { gain: 0.25, send: 0.3, pan: 0.3 });
  // a cowbell answer every other bar
  for (let b = 0; b < 16; b += 2) song.add(drums.cowbell(1), b * 4 + 3.5, { gain: 0.12, send: 0.2, pan: -0.5 });
  return song;
}

// ======================================================================================================
// "Streetlights" — the city at night: slow electric piano soul in Db
// ======================================================================================================
function night() {
  srand(202);
  const song = new Song({ bpm: 80, bars: 16, swing: 0.35 });
  const prog = bars(['Dbmaj9', 'Cm7 F7', 'Bbm9', 'Ebm9 Ab13', 'Dbmaj9', 'Cm7 F7', 'Bbm9', 'Ebm9 Ab13', 'Gbmaj7', 'Fm7', 'Ebm7', 'Ab7sus4 Ab7', 'Dbmaj9', 'Cm7 F7', 'Bbm9', 'Ebm9 Ab13']);
  const mel = [
    [['r', 1], ['Ab4', 0.5], ['Bb4', 0.5], ['C5', 1.5], ['Eb5', 0.5]],
    [['G4', 0.5], ['Bb4', 0.5], ['A4', 1.5], ['C5', 0.5], ['r', 1]],
    [['Db5', 1.5], ['C5', 0.5], ['Bb4', 1], ['F4', 1]],
    [['Gb4', 1], ['Bb4', 1], ['F5', 1.5], ['Eb5', 0.5]],
    [['F5', 2], ['Eb5', 0.5], ['Db5', 0.5], ['C5', 1]],
    [['Bb4', 1], ['G4', 1], ['A4', 1], ['C5', 1]],
    [['Db5', 0.5], ['F5', 0.5], ['Ab5', 1.5], ['F5', 0.5], ['Db5', 1]],
    [['Eb5', 1], ['Gb5', 1], ['F5', 2]],
    [['Bb5', 1.5], ['F5', 0.5], ['Db5', 1], ['Bb4', 1]],
    [['Ab4', 1], ['C5', 1], ['Eb5', 1.5], ['C5', 0.5]],
    [['Db5', 1.5], ['Bb4', 0.5], ['Gb4', 1], ['Bb4', 1]],
    [['Db5', 2], ['C5', 2]],
    [['Ab5', 1.5], ['F5', 0.5], ['Eb5', 1], ['C5', 1]],
    [['Eb5', 1], ['Bb4', 1], ['A4', 1], ['C5', 1]],
    [['Db5', 2], ['r', 1], ['F4', 1]],
    [['Gb4', 1], ['Bb4', 1], ['Eb5', 1], ['r', 1]],
  ].flat();
  // a breathy horn carries the tune, the piano comps underneath
  song.melody((f, d, v) => inst.brass(f, d, v, { bright: 1300 }), mel, 0, { gain: 0.2, send: 0.45, glide: false, human: 0.02, pan: 0.1 });
  comp(song, prog, 0, inst.rhodes, [[0, 1.5, 1], [2.5, 1.5, 0.8]], { gain: 0.14, centre: 60, count: 4, opts: { trem: 0.6 }, send: 0.45 });
  prog.forEach((bar, bi) => { for (const [ch, s, len] of bar) song.melody(inst.subbass, len >= 4 ? [[ch.root, 1.5], [ch.root + 7, 0.5, 0.8], [ch.root + 12, 1, 0.7], [ch.root + 7, 1, 0.8]] : [[ch.root, 1.5], [ch.root + 7, 0.5, 0.8]], bi * 4 + s, { gain: 0.6, send: 0.03 }); });
  padChords(song, prog, 0, { gain: 0.045, centre: 66 });
  arps(song, prog.slice(8, 12), 32, inst.glock, { gain: 0.05, centre: 84, step: 1, order: [3, 2, 1, 0], send: 0.6 });
  const pat = { kick: P('x... .... ..x. ....'), snare: P('.... r... .... r..o'), hat: P('s.ss s.ss s.ss s.ss') };
  groove(song, 0, 16, pat, { gain: 0.8, kickTone: 0.9 });
  return song;
}

// ======================================================================================================
// "Turf War" — a gang war: driving horns and drums in D minor
// ======================================================================================================
function war() {
  srand(303);
  const song = new Song({ bpm: 132, bars: 16, swing: 0 });
  const prog = bars(['Dm', 'Dm', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'A7', 'Bb', 'C', 'Dm', 'Dm', 'Gm', 'Bb', 'A', 'A7']);
  const mel = [
    [['D5', 1.5], ['A4', 0.5], ['D5', 0.5], ['E5', 0.5], ['F5', 1]],
    [['E5', 0.5], ['D5', 0.5], ['C5', 0.5], ['D5', 0.5], ['A4', 2]],
    [['Bb4', 1.5], ['D5', 0.5], ['F5', 1], ['Bb5', 1]],
    [['A5', 1], ['G5', 0.5], ['F5', 0.5], ['E5', 1], ['C5', 1]],
    [['D5', 1.5], ['A4', 0.5], ['D5', 0.5], ['E5', 0.5], ['F5', 1]],
    [['G5', 1], ['F5', 0.5], ['E5', 0.5], ['F5', 2]],
    [['G5', 1.5], ['Bb5', 0.5], ['A5', 1], ['G5', 1]],
    [['E5', 1], ['C#5', 1], ['A4', 1], ['E5', 1]],
    [['F5', 2], ['D5', 1], ['F5', 1]],
    [['G5', 2], ['E5', 1], ['G5', 1]],
    [['A5', 3], ['F5', 0.5], ['G5', 0.5]],
    [['A5', 0.5], ['G5', 0.5], ['F5', 0.5], ['E5', 0.5], ['D5', 2]],
    [['Bb5', 2], ['A5', 1], ['G5', 1]],
    [['F5', 1.5], ['D5', 0.5], ['F5', 1], ['Bb5', 1]],
    [['A5', 2], ['E5', 1], ['C#5', 1]],
    [['E5', 1], ['G5', 1], ['C#6', 2]],
  ].flat();
  song.melody(inst.brass, mel, 0, { gain: 0.3, send: 0.3, pan: 0.1 });
  song.melody(inst.brass, mel, 0, { transpose: -12, gain: 0.16, send: 0.3, pan: -0.2 });
  song.melody(inst.pulse, mel.slice(0), 0, { transpose: 12, gain: 0.08, send: 0.3, opts: { width: 0.2 } });
  // a string ostinato in sixteenths and a pumping bass
  prog.forEach((bar, bi) => {
    const [ch] = bar[0];
    const v = voicing(ch, 62, 3);
    for (let s = 0; s < 16; s++) song.add(inst.pluck(mtof(v[[0, 1, 2, 1][s % 4]] + 12), song.secs(0.25), s % 4 === 0 ? 1 : 0.7, { damp: 0.495 }), bi * 4 + s / 4, { gain: 0.12, send: 0.25, pan: -0.45 });
    for (let s = 0; s < 8; s++) song.add(inst.bass(mtof(ch.root), song.secs(0.45), s % 2 ? 0.8 : 1, { cut: 300, env: 900 }), bi * 4 + s / 2, { gain: 0.45, send: 0.03 });
    // horn stabs at the top of each two bars
    if (bi % 2 === 0) voicing(ch, 58, 3).forEach((m, k) => song.add(inst.brass(mtof(m), song.secs(0.4), 1), bi * 4, { gain: 0.14, send: 0.35, pan: (k - 1) * 0.4 }));
  });
  for (let bar = 0; bar < 16; bar++) {
    // war drums: low toms on the beat, a roll every fourth bar
    song.add(drums.tom(70, 1, 0.5), bar * 4, { gain: 0.45, send: 0.25, pan: -0.2 });
    song.add(drums.tom(95, 0.8, 0.4), bar * 4 + 2.5, { gain: 0.35, send: 0.25, pan: 0.2 });
    if (bar % 4 === 3) for (let s = 0; s < 8; s++) song.add(drums.tom(110 - s * 6, 0.6 + s * 0.05, 0.3), bar * 4 + 2 + s / 4, { gain: 0.3, send: 0.2, pan: (s - 3.5) * 0.15 });
  }
  const pat = { kick: P('x..x ..x. x..x ..x.'), snare: P('.... x... .... x...'), hat: P('xxxx xxxx xxxx xxxx') };
  groove(song, 0, 16, pat, { gain: 0.9 });
  for (const b of [0, 16, 32, 48]) song.add(drums.crash(1), b, { gain: 0.25, send: 0.3 });
  return song;
}

// ======================================================================================================
// "Boardwalk" — Sunset Beach: steel pans and an island skank in C
// ======================================================================================================
function beach() {
  srand(404);
  const song = new Song({ bpm: 112, bars: 16, swing: 0.25 });
  const prog = bars(['C', 'F', 'G7', 'C', 'C', 'F', 'G7', 'C', 'F', 'C', 'G7', 'C', 'F', 'G', 'Am', 'G7']);
  const mel = [
    [['E5', 0.5], ['G5', 0.5], ['C6', 1], ['G5', 0.5], ['E5', 0.5], ['G5', 1]],
    [['A5', 1.5], ['F5', 0.5], ['A5', 0.5], ['C6', 0.5], ['A5', 1]],
    [['B5', 0.5], ['D6', 0.5], ['B5', 0.5], ['G5', 0.5], ['F5', 1], ['D5', 1]],
    [['E5', 1.5], ['D5', 0.5], ['C5', 2]],
    [['G5', 0.5], ['A5', 0.5], ['G5', 0.5], ['E5', 0.5], ['C5', 1], ['E5', 1]],
    [['F5', 0.5], ['A5', 0.5], ['C6', 1.5], ['A5', 0.5], ['F5', 1]],
    [['G5', 1], ['B5', 1], ['D6', 0.5], ['C6', 0.5], ['B5', 1]],
    [['C6', 2], ['r', 2]],
    [['A5', 0.5], ['C6', 0.5], ['A5', 0.5], ['F5', 0.5], ['A5', 2]],
    [['G5', 0.5], ['E5', 0.5], ['C5', 0.5], ['E5', 0.5], ['G5', 2]],
    [['F5', 0.5], ['G5', 0.5], ['B5', 1], ['D6', 1], ['B5', 1]],
    [['C6', 1.5], ['G5', 0.5], ['E5', 2]],
    [['F5', 1], ['A5', 1], ['C6', 1], ['A5', 1]],
    [['B5', 1], ['D6', 1], ['B5', 1], ['G5', 1]],
    [['A5', 1.5], ['G5', 0.5], ['E5', 1], ['C5', 1]],
    [['D5', 1], ['F5', 1], ['G5', 1], ['B5', 1]],
  ].flat();
  song.melody(inst.steelpan, mel, 0, { gain: 0.32, send: 0.3, pan: 0.15 });
  song.melody(inst.steelpan, mel, 0, { transpose: -12, gain: 0.12, send: 0.3, pan: -0.3, human: 0.01 });
  // the organ and guitar skank on every off-beat
  prog.forEach((bar, bi) => {
    for (const [ch] of bar) {
      for (let b = 0.5; b < 4; b += 1) {
        voicing(ch, 64, 3).forEach((m, k) => song.add(inst.organ(mtof(m), song.secs(0.3), 1), bi * 4 + b, { gain: 0.07, send: 0.15, pan: -0.4 }));
        voicing(ch, 69, 3).forEach((m, k) => song.add(inst.pluck(mtof(m), 0.09, 1, { damp: 0.48 }), bi * 4 + b, { gain: 0.12, send: 0.15, pan: 0.5, offset: k * 0.005 }));
      }
      const r = ch.root;
      song.melody(inst.bass, [[r, 0.75], ['r', 0.25], [r + 7, 0.5, 0.8], [r + 12, 0.5, 0.8], [r + 7, 0.75], [r + 4, 0.25, 0.7], [r + 7, 0.5, 0.8], [r - 1 + 12 * 0, 0.5, 0.6]], bi * 4, { gain: 0.5, send: 0.03, glide: true, opts: { cut: 300, env: 900 } });
    }
  });
  // congas and a shaker
  for (let bar = 0; bar < 16; bar++) {
    for (const [s, f, v] of [[1.5, 330, 0.8], [1.75, 330, 0.5], [3, 220, 1], [3.5, 330, 0.7]]) song.add(drums.conga(f, v), bar * 4 + s, { gain: 0.3, send: 0.2, pan: 0.35 });
  }
  const pat = { kick: P('x... .... x... ....'), snare: P('.... .... r... ....'), hat: P('s.ss s.ss s.ss s.ss') };
  groove(song, 0, 16, pat, { gain: 0.9 });
  arps(song, prog.slice(8), 32, inst.marimba, { gain: 0.06, centre: 79, step: 0.5 });
  return song;
}

// ======================================================================================================
// "Low Ride FM" — the car radio: a laid-back G-funk tune in G minor (three passes of eight bars)
// ======================================================================================================
function radio() {
  srand(505);
  const song = new Song({ bpm: 90, bars: 24, swing: 0.6 });
  const eight = ['Gm9', 'Gm9', 'Cm9', 'D7', 'Gm9', 'Gm9', 'Ebmaj7', 'D7'];
  const prog = bars([...eight, ...eight, ...eight]);
  const mel = [
    [['D6', 2], ['Bb5', 0.5], ['A5', 0.5], ['G5', 1]],
    [['Bb5', 1.5], ['A5', 0.5], ['F5', 1], ['G5', 1]],
    [['Eb6', 2], ['D6', 0.5], ['C6', 0.5], ['Bb5', 1]],
    [['A5', 1.5], ['F#5', 0.5], ['A5', 1], ['C6', 1]],
    [['D6', 1], ['Bb5', 1], ['A5', 0.5], ['G5', 0.5], ['D5', 1]],
    [['F5', 1], ['G5', 1], ['A5', 1], ['Bb5', 1]],
    [['G5', 1.5], ['Bb5', 0.5], ['D6', 2]],
    [['C6', 1], ['A5', 1], ['F#5', 1], ['D5', 1]],
  ].flat();
  song.melody(inst.whistle, mel, 32, { gain: 0.3, send: 0.4, glide: true, pan: 0.15 });
  song.melody(inst.whistle, mel, 64, { gain: 0.22, send: 0.45, glide: true, pan: -0.2, transpose: 12 });
  song.melody(inst.pulse, mel, 64, { gain: 0.16, send: 0.3, transpose: -12, opts: { width: 0.45 } });
  // a deep gliding bass
  prog.forEach((bar, bi) => { for (const [ch] of bar) { const r = ch.root; song.melody(inst.bass, [[r, 1.25], [r, 0.25, 0.6], ['r', 0.5], [r + 10, 0.5, 0.8], [r + 12, 0.75], [r + 7, 0.75, 0.8]], bi * 4, { gain: 0.6, send: 0.03, glide: true, opts: { cut: 220, env: 700, decay: 6, q: 0.25 } }); } });
  comp(song, prog, 0, inst.rhodes, [[0, 1.5, 1], [2.75, 1, 0.8]], { gain: 0.12, centre: 64, opts: { trem: 0.5 }, send: 0.4 });
  padChords(song, prog.slice(8), 32, { gain: 0.05, centre: 68 });
  const pat = { kick: P('x... ...x ..x. ....'), snare: P('.... x... .... x..o'), hat: P('x.x. x.x. x.x. x.xO') };
  groove(song, 0, 24, pat, { clap: true, fillEvery: 8 });
  return song;
}

// ======================================================================================================
// "Sandbox" — the title: the day tune's motif as a brass fanfare
// ======================================================================================================
function title() {
  srand(606);
  const song = new Song({ bpm: 104, bars: 8, swing: 0.4 });
  const prog = bars(['F', 'Bb', 'Gm7 C7', 'F', 'Dm', 'Bb', 'Gm7', 'C7']);
  const mel = [
    [['C5', 0.5], ['F5', 0.5], ['A5', 0.5], ['C6', 1.5], ['A5', 0.5], ['C6', 0.5]],
    [['D6', 1.5], ['C6', 0.5], ['Bb5', 1], ['F5', 1]],
    [['G5', 1], ['Bb5', 1], ['E5', 1], ['G5', 1]],
    [['F5', 2], ['A5', 0.5], ['C6', 0.5], ['F6', 1]],
    [['F6', 1.5], ['E6', 0.5], ['D6', 1], ['A5', 1]],
    [['Bb5', 1], ['D6', 1], ['F6', 1], ['D6', 1]],
    [['Bb5', 1.5], ['A5', 0.5], ['G5', 1], ['F5', 1]],
    [['E5', 1], ['G5', 1], ['Bb5', 1], ['C6', 1]],
  ].flat();
  song.melody(inst.brass, mel, 0, { gain: 0.3, send: 0.35 });
  song.melody(inst.brass, mel, 0, { transpose: -12, gain: 0.18, send: 0.35, pan: -0.3 });
  song.melody(inst.glock, mel, 16, { transpose: 12, gain: 0.07, send: 0.5, pan: 0.4 });
  funkBass(song, prog, 0, { gain: 0.5 });
  comp(song, prog, 0, inst.brass, [[0, 0.4], [1.5, 0.25, 0.8], [3, 0.4, 0.9]], { gain: 0.07, centre: 58, count: 3 });
  padChords(song, prog, 0, { gain: 0.05 });
  for (let bar = 0; bar < 8; bar++) song.add(drums.tom(65, 1, 0.6), bar * 4, { gain: 0.35, send: 0.3 });
  const pat = { kick: P('x... ..x. x... ....'), snare: P('.... x... .... x...'), hat: P('xoxo xoxo xoxo xoxO') };
  groove(song, 0, 8, pat, { clap: true, fillEvery: 4 });
  song.add(drums.crash(1, 2.5), 0, { gain: 0.3, send: 0.4 });
  song.add(drums.crash(1, 2.5), 16, { gain: 0.25, send: 0.4 });
  return song;
}

// ======================================================================================================
// "Passed" — the mission-passed jingle (plays once)
// ======================================================================================================
function passed() {
  srand(707);
  const song = new Song({ bpm: 132, bars: 2, loop: false, tail: 1.8 });
  const run = [['C5', 0.25], ['F5', 0.25], ['A5', 0.25], ['C6', 0.25], ['Bb5', 0.25], ['D6', 0.25], ['F6', 0.5]];
  song.melody(inst.marimba, run, 0, { gain: 0.3, send: 0.3, pan: -0.2 });
  song.melody(inst.brass, run, 0, { gain: 0.22, send: 0.3, pan: 0.2 });
  song.melody(inst.glock, [['r', 2], ['F6', 1], ['A6', 1], ['C7', 2]], 0, { gain: 0.1, send: 0.6, pan: 0.4 });
  for (const m of ['F3', 'C4', 'F4', 'A4', 'C5', 'F5']) song.add(inst.brass(mtof(midi(m)), song.secs(3.5), 1), 2, { gain: 0.1, send: 0.4 });
  song.add(inst.bass(mtof(midi('F2')), song.secs(3), 1), 2, { gain: 0.6, send: 0.05 });
  for (let s = 0; s < 8; s++) song.add(drums.snare(0.4 + s * 0.08), s * 0.25, { gain: 0.35, send: 0.2 });
  song.add(drums.kick(1), 2, { gain: 1 }); song.add(drums.crash(1, 2.5), 2, { gain: 0.35, send: 0.4 });
  song.add(drums.tom(70, 1, 0.8), 2, { gain: 0.4, send: 0.3 });
  return song;
}

// the order matches MUS_ in src/sound.h
export const SONGS = { day, night, war, title, radio, passed, beach };

// ======================================================================================================
// Voices. The hero has a warm, bright, bouncy voice; everyone else uses the same lines at other pitches
// (the game picks a pitch per person). Each line: [phoneme, seconds, pitch Hz or a pitch line, loudness]
// ======================================================================================================
const HERO = { formant: 1.0, breath: 0.06, rasp: 0.08, vibrato: 0.012 };
export const VOICES = {
  hup: [[['h', 0.035], ['uh', 0.1, [215, 245]], ['_', 0.03], ['p', 0.02, null, 0.6]], HERO],
  hoo: [[['h', 0.05], ['U', 0.04, [250, 280]], ['u', 0.2, [290, 320, 280]]], HERO],
  yahoo: [[['y', 0.05, [220, 240]], ['A', 0.15, [250, 270]], ['h', 0.05], ['u', 0.38, [330, 380, 360, 260]]], HERO],
  yah: [[['y', 0.045, [250, 270]], ['A', 0.24, [290, 330, 260]]], HERO],
  waha: [[['w', 0.05, [230]], ['A', 0.13, [250, 270]], ['h', 0.06], ['A', 0.25, [330, 360, 280, 220]]], HERO],
  ha: [[['h', 0.04], ['A', 0.13, [260, 215]]], HERO],
  hya: [[['h', 0.03], ['i', 0.035, [290]], ['A', 0.2, [320, 350, 270]]], HERO],
  oof: [[['U', 0.05, [210]], ['uh', 0.11, [200, 150]], ['f', 0.09, null, 0.7]], HERO],
  ow: [[['A', 0.11, [320, 340]], ['U', 0.08, [300, 250]], ['u', 0.08, [230, 190]]], HERO],
  whoa: [[['w', 0.07, [240]], ['o', 0.25, [280, 300, 290]], ['o', 0.4, [290, 250, 220, 190], 0.9]], { ...HERO, vibrato: 0.04 }],
  ugh: [[['uh', 0.2, [190, 150, 120]], ['_', 0.02], ['g', 0.03, null, 0.4]], { ...HERO, rasp: 0.3 }],
  yeah: [[['y', 0.05, [230]], ['e', 0.1, [250, 280]], ['ae', 0.25, [300, 310, 240]], ['uh', 0.06, [230, 210], 0.6]], HERO],
  herewego: [[['h', 0.05], ['I', 0.09, [230, 250]], ['er', 0.11, [250, 240]], ['w', 0.05, [250]], ['i', 0.11, [270, 280]], ['_', 0.03], ['g', 0.025], ['o', 0.1, [320, 360]], ['U', 0.18, [360, 330, 280]]], HERO],
  letsgo: [[['l', 0.05, [220]], ['e', 0.12, [240, 250]], ['_', 0.03], ['t', 0.02], ['s', 0.08], ['_', 0.03], ['g', 0.025], ['o', 0.12, [300, 340]], ['U', 0.2, [340, 300, 250]]], HERO],
  snore: [[['h', 0.15], ['o', 0.5, [70, 78, 72], 0.5], ['n', 0.25, [72, 65], 0.4], ['_', 0.2], ['h', 0.12], ['u', 0.55, [520, 560, 540, 500], 0.35], ['_', 0.1]], { ...HERO, rasp: 0.8, breath: 0.25 }],
  scream: [[['A', 0.75, [430, 470, 450, 420, 360], 1]], { ...HERO, vibrato: 0.05, rasp: 0.2 }],
  hey: [[['h', 0.05], ['e', 0.12, [250, 280]], ['I', 0.14, [280, 240]]], HERO],
  yo: [[['y', 0.05, [220]], ['o', 0.15, [240, 260]], ['U', 0.12, [250, 210]]], HERO],
  freeze: [[['f', 0.08], ['r', 0.06, [170]], ['i', 0.26, [180, 200, 160]], ['z', 0.14, [150], 0.8]], { ...HERO, formant: 0.95, rasp: 0.15 }],
  comeon: [[['_', 0.02], ['k', 0.03], ['uh', 0.08, [220, 230]], ['m', 0.06, [230]], ['A', 0.14, [270, 300]], ['n', 0.14, [290, 240], 0.8]], HERO],
  hmm: [[['m', 0.35, [180, 205, 175], 1.4]], HERO],
  woohoo: [[['w', 0.05, [250]], ['u', 0.15, [290, 330]], ['h', 0.05], ['u', 0.35, [380, 430, 400, 300]]], { ...HERO, vibrato: 0.02 }],
};

// ---- writing it all out ----
export function buildAudio(outDir) {
  fs.mkdirSync(path.join(outDir, 'audio'), { recursive: true });
  const t0 = Date.now();
  for (const [name, fn] of Object.entries(SONGS)) {
    const [L, R] = fn().render();
    fs.writeFileSync(path.join(outDir, 'audio', `mus_${name}.wav`), wav([L, R]));
  }
  // the voice bank: "VOX1", count, then per clip offset + length (samples), then the 16-bit samples (big-endian)
  const clips = Object.values(VOICES).map(([segs, o]) => speak(segs, o));
  for (const [i, name] of Object.keys(VOICES).entries()) fs.writeFileSync(path.join(outDir, 'audio', `vo_${name}.wav`), wav([clips[i]]));
  const total = clips.reduce((s, c) => s + c.length, 0);
  const head = 8 + clips.length * 8;
  const out = Buffer.alloc(head + total * 2);
  out.write('VOX1', 0); out.writeUInt32BE(clips.length, 4);
  let off = 0;
  clips.forEach((c, i) => {
    out.writeUInt32BE(off, 8 + i * 8); out.writeUInt32BE(c.length, 12 + i * 8);
    for (let k = 0; k < c.length; k++) out.writeInt16BE(Math.max(-32767, Math.min(32767, Math.round(c[k] * 30000))), head + (off + k) * 2);
    off += c.length;
  });
  fs.writeFileSync(path.join(outDir, 'voices.bin'), out);
  console.log(`audio: ${Object.keys(SONGS).length} songs, ${clips.length} voice lines (${(out.length / 1024) | 0} KB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (import.meta.url === `file://${process.argv[1]}`) buildAudio(process.argv[2] || 'assets');
