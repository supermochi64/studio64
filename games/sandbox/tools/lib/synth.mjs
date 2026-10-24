// A small offline synthesiser: oscillators, drums, instruments, a reverb, a sequencer that renders seamless
// loops, and a formant voice. Everything the game hears is made here from maths (no samples, no recordings).

export const SR = 22050;
const TAU = Math.PI * 2;

// ---- notes ----
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export function midi(s) {
  if (typeof s === 'number') return s;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(s);
  if (!m) throw new Error('bad note ' + s);
  return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

const QUALITY = {
  '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9],
  9: [0, 4, 10, 14], m9: [0, 3, 10, 14], maj9: [0, 4, 11, 14], 13: [0, 4, 10, 21], sus4: [0, 5, 7], '7sus4': [0, 5, 7, 10],
  dim: [0, 3, 6], m7b5: [0, 3, 6, 10], add9: [0, 4, 7, 14], '7#9': [0, 4, 10, 15],
};
// "Fmaj7" -> { root: midi of F2.., tones: semitones }
export function chord(name) {
  const m = /^([A-G][#b]?)(.*)$/.exec(name);
  const q = QUALITY[m[2]];
  if (!q) throw new Error('bad chord ' + name);
  return { root: midi(m[1] + '2'), tones: q, name };
}
// chord tones placed near a centre note (close voicing)
export function voicing(ch, centre = 62, count = 4) {
  const out = [];
  for (const t of ch.tones.slice(0, count)) {
    let n = ch.root + (t % 12);
    while (n < centre - 6) n += 12;
    while (n > centre + 6) n -= 12;
    out.push(n);
  }
  return out.sort((a, b) => a - b);
}

// ---- noise and helpers ----
let seed = 22222;
export function srand(s) { seed = s >>> 0 || 1; }
export function noise() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2147483648 - 1; }
export const rnd = () => (noise() + 1) / 2;
function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
function buf(sec) { return new Float32Array(Math.max(1, Math.ceil(sec * SR))); }
// attack / decay to sustain / release after the gate
function adsr(t, gate, a, d, s, r) {
  let v;
  if (t < a) v = t / a;
  else if (t < a + d) v = 1 - (1 - s) * ((t - a) / d);
  else v = s;
  if (t > gate) {
    const g = gate < a ? gate / a : gate < a + d ? 1 - (1 - s) * ((gate - a) / d) : s;
    v = g * Math.max(0, 1 - (t - gate) / r);
  }
  return v;
}
// Chamberlin state-variable low-pass (stable while fc < SR/6)
class SVF {
  constructor() { this.low = 0; this.band = 0; }
  lp(x, fc, q) {
    const f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6.5) / SR);
    this.low += f * this.band;
    const high = x - this.low - q * this.band;
    this.band += f * high;
    return this.low;
  }
  bp() { return this.band; }
}
class OnePole { constructor() { this.y = 0; } lp(x, k) { this.y += (x - this.y) * k; return this.y; } hp(x, k) { return x - this.lp(x, k); } }

// ---- drums ----
export const drums = {
  kick(v = 1, tone = 1) {
    const b = buf(0.42); let ph = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR; const f = 44 * tone + 120 * Math.exp(-t * 32);
      ph += f / SR;
      b[i] = (Math.sin(ph * TAU) * Math.exp(-t * 6.5) + (t < 0.004 ? noise() * 0.5 : 0)) * v;
    }
    return b;
  },
  snare(v = 1, tone = 1) {
    const b = buf(0.3); let ph = 0; const hp = new OnePole(), lp = new OnePole();
    for (let i = 0; i < b.length; i++) {
      const t = i / SR; ph += (180 * tone + 60 * Math.exp(-t * 40)) / SR;
      const n = lp.lp(hp.hp(noise(), 0.12), 0.6);
      b[i] = (Math.sin(ph * TAU) * 0.55 * Math.exp(-t * 22) + n * 0.9 * Math.exp(-t * 13)) * v;
    }
    return b;
  },
  clap(v = 1) {
    const b = buf(0.3); const f = new SVF();
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      let e = Math.exp(-Math.max(0, t - 0.02) * 16);
      for (const o of [0, 0.009, 0.018]) if (t >= o && t < o + 0.008) e = Math.max(e, 1 - (t - o) / 0.008);
      f.lp(noise(), 1300, 0.5);
      b[i] = f.bp() * e * 1.8 * v;
    }
    return b;
  },
  hat(v = 1, open = false) {
    const b = buf(open ? 0.35 : 0.06); const hp = new OnePole(), hp2 = new OnePole();
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      b[i] = hp2.hp(hp.hp(noise(), 0.5), 0.4) * Math.exp(-t * (open ? 9 : 55)) * v;
    }
    return b;
  },
  shaker(v = 1) {
    const b = buf(0.09); const hp = new OnePole();
    for (let i = 0; i < b.length; i++) { const t = i / SR; b[i] = hp.hp(noise(), 0.35) * Math.min(1, t * 120) * Math.exp(-t * 40) * v * 0.7; }
    return b;
  },
  rim(v = 1) {
    const b = buf(0.08); let p1 = 0, p2 = 0;
    for (let i = 0; i < b.length; i++) { const t = i / SR; p1 += 1700 / SR; p2 += 830 / SR; b[i] = (Math.sin(p1 * TAU) * 0.5 + Math.sin(p2 * TAU) * 0.5 + noise() * 0.3) * Math.exp(-t * 60) * v; }
    return b;
  },
  cowbell(v = 1) {
    const b = buf(0.3); const f = new SVF(); let p1 = 0, p2 = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR; p1 += 545 / SR; p2 += 815 / SR;
      const x = (p1 % 1 < 0.5 ? 1 : -1) + (p2 % 1 < 0.5 ? 1 : -1);
      f.lp(x, 900, 0.4);
      b[i] = f.bp() * Math.exp(-t * 14) * v * 0.6;
    }
    return b;
  },
  tom(f0 = 110, v = 1, len = 0.4) {
    const b = buf(len); let ph = 0;
    for (let i = 0; i < b.length; i++) { const t = i / SR; ph += (f0 * (1 + 0.5 * Math.exp(-t * 20))) / SR; b[i] = (Math.sin(ph * TAU) + noise() * 0.15 * Math.exp(-t * 40)) * Math.exp(-t * (3 / len)) * v; }
    return b;
  },
  conga(f0 = 220, v = 1) {
    const b = buf(0.25); let ph = 0;
    for (let i = 0; i < b.length; i++) { const t = i / SR; ph += (f0 * (1 + 0.15 * Math.exp(-t * 50))) / SR; b[i] = (Math.sin(ph * TAU) + 0.3 * Math.sin(ph * 2.7 * TAU) * Math.exp(-t * 30)) * Math.exp(-t * 14) * v; }
    return b;
  },
  crash(v = 1, len = 1.8) {
    const b = buf(len); const hp = new OnePole(); const f = new SVF();
    for (let i = 0; i < b.length; i++) { const t = i / SR; const n = hp.hp(noise(), 0.3); f.lp(n, 5000, 0.8); b[i] = (n * 0.6 + f.bp() * 0.5) * Math.exp(-t * (3 / len)) * Math.min(1, t * 400) * v; }
    return b;
  },
};

// ---- melodic instruments: (freq, seconds held, velocity, opts) -> mono buffer ----
export const inst = {
  // a round synth bass with a filter that opens on each note (glides from opts.from)
  bass(f, dur, v = 1, o = {}) {
    const rel = 0.05; const b = buf(dur + rel); const fl = new SVF(); let ph = 0, sub = 0;
    const from = o.from || f;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR; const fr = from + (f - from) * Math.min(1, t / 0.05);
      const dt = fr / SR; ph = (ph + dt) % 1; sub = (sub + dt / 2) % 1;
      const saw = 2 * ph - 1 - polyblep(ph, dt);
      const x = saw * 0.6 + Math.sin(sub * TAU) * 0.2 + Math.sin(ph * TAU) * 0.6;
      const cut = (o.cut || 380) + (o.env || 1600) * Math.exp(-t * (o.decay || 11)) * v;
      b[i] = fl.lp(x, cut, o.q || 0.35) * adsr(t, dur, 0.004, 0.25, 0.75, rel) * v;
    }
    return b;
  },
  // a low sine/triangle sub bass (night)
  subbass(f, dur, v = 1) {
    const rel = 0.12; const b = buf(dur + rel); let ph = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR; ph = (ph + f / SR) % 1;
      const tri = 4 * Math.abs(ph - 0.5) - 1;
      b[i] = (Math.sin(ph * TAU) * 0.8 + tri * 0.25) * adsr(t, dur, 0.012, 0.4, 0.7, rel) * v;
    }
    return b;
  },
  // an electric piano: two-operator FM with a bell tine at the attack
  rhodes(f, dur, v = 1, o = {}) {
    const rel = 0.25; const b = buf(Math.min(dur, 3) + rel); let pc = 0, pm = 0, pt = 0;
    const trem = o.trem || 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      pm += f / SR; pt += (f * 14) / SR;
      const idx = (1.6 * Math.exp(-t * 3) + 0.25) * (0.6 + v * 0.6);
      pc += f / SR;
      const x = Math.sin(pc * TAU + idx * Math.sin(pm * TAU)) + 0.25 * Math.sin(pt * TAU) * Math.exp(-t * 40);
      const env = Math.exp(-t * 0.9) * Math.min(1, t * 400) * (t > dur ? Math.max(0, 1 - (t - dur) / rel) : 1);
      b[i] = x * env * v * (1 - trem * 0.5 * (1 + Math.sin(t * TAU * 4.5)));
    }
    return b;
  },
  // the high, sliding sine "whistle" lead (slides from opts.from, vibrato grows on long notes)
  whistle(f, dur, v = 1, o = {}) {
    const rel = 0.08; const b = buf(dur + rel); let ph = 0;
    const from = o.from || f;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      const vib = 1 + 0.012 * Math.min(1, Math.max(0, t - 0.12) * 4) * Math.sin(t * TAU * 5.6);
      const fr = (from + (f - from) * Math.min(1, t / 0.06)) * vib;
      ph = (ph + fr / SR) % 1;
      const x = Math.sin(ph * TAU) + 0.12 * Math.sin(ph * 2 * TAU) + 0.04 * Math.sin(ph * 3 * TAU);
      b[i] = x * adsr(t, dur, 0.025, 0.2, 0.85, rel) * v;
    }
    return b;
  },
  // a bright, round square lead (the platformer-y voice)
  pulse(f, dur, v = 1, o = {}) {
    const rel = 0.07; const b = buf(dur + rel); const fl = new SVF(); let ph = 0;
    const w = o.width || 0.3;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      const vib = 1 + 0.008 * Math.min(1, Math.max(0, t - 0.15) * 3) * Math.sin(t * TAU * 5.8);
      const dt = (f * vib) / SR; ph = (ph + dt) % 1;
      let x = (ph < w ? 1 : -1) + polyblep(ph, dt) - polyblep((ph - w + 1) % 1, dt);
      x = fl.lp(x, 2600 + 1500 * Math.exp(-t * 8), 0.5);
      b[i] = x * adsr(t, dur, 0.006, 0.15, 0.7, rel) * v * 0.6;
    }
    return b;
  },
  marimba(f, dur, v = 1) {
    const b = buf(0.9); let p1 = 0, p2 = 0, p3 = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR; p1 += f / SR; p2 += (f * 3.93) / SR; p3 += (f * 9.2) / SR;
      b[i] = (Math.sin(p1 * TAU) * Math.exp(-t * 5.5) + 0.35 * Math.sin(p2 * TAU) * Math.exp(-t * 28) + 0.08 * Math.sin(p3 * TAU) * Math.exp(-t * 70)) * Math.min(1, t * 1500) * v;
    }
    return b;
  },
  glock(f, dur, v = 1) {
    const b = buf(1.4); let pc = 0, pm = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR; pm += (f * 3.5) / SR; pc += f / SR;
      b[i] = Math.sin(pc * TAU + 1.2 * Math.exp(-t * 6) * Math.sin(pm * TAU)) * Math.exp(-t * 3.5) * Math.min(1, t * 2000) * v;
    }
    return b;
  },
  steelpan(f, dur, v = 1) {
    const b = buf(1.1); let p1 = 0, p2 = 0, p3 = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR; const bend = 1 - 0.01 * Math.exp(-t * 30);
      p1 += (f * bend) / SR; p2 += (f * 2.0 * bend) / SR; p3 += (f * 3.01 * bend) / SR;
      b[i] = (Math.sin(p1 * TAU) * Math.exp(-t * 3) + 0.55 * Math.sin(p2 * TAU) * Math.exp(-t * 4.5) + 0.3 * Math.sin(p3 * TAU) * Math.exp(-t * 9)) * Math.min(1, t * 800) * v * 0.8;
    }
    return b;
  },
  // stacked detuned saws through a filter that swells: horns
  brass(f, dur, v = 1, o = {}) {
    const rel = 0.1; const b = buf(dur + rel); const fl = new SVF(); const ph = [0, 0.33, 0.66];
    const det = [1, 1.004, 0.996];
    for (let i = 0; i < b.length; i++) {
      const t = i / SR; let x = 0;
      const vib = 1 + 0.006 * Math.min(1, Math.max(0, t - 0.2) * 3) * Math.sin(t * TAU * 5.2);
      for (let k = 0; k < 3; k++) { const dt = (f * det[k] * vib) / SR; ph[k] = (ph[k] + dt) % 1; x += 2 * ph[k] - 1 - polyblep(ph[k], dt); }
      const swell = Math.min(1, t / 0.04);
      x = fl.lp(x / 3, 500 + (o.bright || 2600) * swell * (0.75 + 0.25 * Math.exp(-t * 4)), 0.3);
      b[i] = x * adsr(t, dur, 0.02, 0.2, 0.8, rel) * v;
    }
    return b;
  },
  // a soft string pad (slow attack)
  pad(f, dur, v = 1) {
    const rel = 0.5; const b = buf(dur + rel); const fl = new SVF(); const ph = [0, 0.2, 0.5, 0.8];
    const det = [1, 1.006, 0.994, 2.003];
    for (let i = 0; i < b.length; i++) {
      const t = i / SR; let x = 0;
      for (let k = 0; k < 4; k++) { const dt = (f * det[k]) / SR; ph[k] = (ph[k] + dt) % 1; x += (2 * ph[k] - 1 - polyblep(ph[k], dt)) * (k === 3 ? 0.4 : 1); }
      x = fl.lp(x / 3.4, 1700, 0.6);
      b[i] = x * adsr(t, dur, 0.28, 0.3, 0.85, rel) * v;
    }
    return b;
  },
  organ(f, dur, v = 1) {
    const rel = 0.04; const b = buf(dur + rel); let ph = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR; ph = (ph + f / SR) % 1;
      const p = ph * TAU;
      const x = Math.sin(p) + 0.6 * Math.sin(2 * p) + 0.35 * Math.sin(3 * p) + 0.2 * Math.sin(4 * p) + 0.1 * Math.sin(6 * p);
      b[i] = x * 0.4 * (1 + 0.08 * Math.sin(t * TAU * 6.5)) * adsr(t, dur, 0.004, 0.05, 0.9, rel) * v;
    }
    return b;
  },
  // a muted, plucked guitar string (Karplus-Strong)
  pluck(f, dur, v = 1, o = {}) {
    const len = Math.max(2, Math.round(SR / f)); const line = new Float32Array(len);
    for (let i = 0; i < len; i++) line[i] = noise();
    const total = Math.min(dur, 1.5) + 0.05; const b = buf(total); let p = 0;
    const damp = o.damp || 0.49; const hp = new OnePole();
    for (let i = 0; i < b.length; i++) {
      const t = i / SR; const n = (p + 1) % len;
      const y = (line[p] + line[n]) * damp;
      line[p] = y; p = n;
      b[i] = hp.hp(y, 0.05) * v * (t > dur ? Math.max(0, 1 - (t - dur) / 0.05) : 1);
    }
    return b;
  },
};

// ---- the reverb (Freeverb-like), run twice round the buffer so a loop's tail wraps into its start ----
function comb(len, fb, damp) { return { b: new Float32Array(len), i: 0, s: 0, fb, damp }; }
function reverb(inL, inR, size = 0.84, damp = 0.25, loop = true) {
  const C = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => Math.round(n / 2));
  const A = [556, 441, 341, 225].map((n) => Math.round(n / 2));
  const mk = (spread) => ({ c: C.map((n) => comb(n + spread, size, damp)), a: A.map((n) => ({ b: new Float32Array(n + spread), i: 0 })) });
  const chans = [mk(0), mk(11)];
  const outs = [new Float32Array(inL.length), new Float32Array(inL.length)];
  const ins = [inL, inR];
  for (let pass = loop ? 0 : 1; pass < 2; pass++) {
    for (let ch = 0; ch < 2; ch++) {
      const st = chans[ch], inp = ins[ch], out = outs[ch];
      for (let i = 0; i < inp.length; i++) {
        const x = inp[i] * 0.015; let y = 0;
        for (const c of st.c) {
          const o = c.b[c.i]; c.s = o * (1 - c.damp) + c.s * c.damp;
          c.b[c.i] = x + c.s * c.fb; c.i = (c.i + 1) % c.b.length; y += o;
        }
        for (const a of st.a) { const o = a.b[a.i]; a.b[a.i] = y + o * 0.5; y = o - y * 0.5; a.i = (a.i + 1) % a.b.length; }
        if (pass === 1) out[i] = y;
      }
    }
  }
  return outs;
}

// ---- a song: notes and hits placed on a beat grid, rendered into a stereo loop ----
export class Song {
  constructor({ bpm, bars, swing = 0, loop = true, beats = 4, tail = 0 }) {
    this.bpm = bpm; this.beat = 60 / bpm; this.swing = swing; this.loop = loop; this.beatsPerBar = beats;
    this.len = Math.round((bars * beats * this.beat + (loop ? 0 : tail)) * SR);
    this.L = new Float32Array(this.len); this.R = new Float32Array(this.len);
    this.sL = new Float32Array(this.len); this.sR = new Float32Array(this.len);
  }
  // the time of a beat (swing pushes the off sixteenths late)
  at(beat) {
    const s16 = beat * 4; const k = Math.round(s16);
    let b = beat;
    if (Math.abs(s16 - k) < 1e-6 && k % 2 === 1) b += this.swing * 0.0833;
    return b * this.beat;
  }
  secs(beats) { return beats * this.beat; }
  add(mono, beat, { pan = 0, gain = 1, send = 0.2, offset = 0 } = {}) {
    const start = Math.round((this.at(beat) + offset) * SR);
    const gl = gain * Math.cos((pan + 1) * Math.PI / 4) * 1.414, gr = gain * Math.sin((pan + 1) * Math.PI / 4) * 1.414;
    for (let i = 0; i < mono.length; i++) {
      let j = start + i;
      if (j >= this.len) { if (!this.loop) break; j %= this.len; }
      if (j < 0) continue;
      const x = mono[i];
      this.L[j] += x * gl; this.R[j] += x * gr;
      this.sL[j] += x * gl * send; this.sR[j] += x * gr * send;
    }
  }
  // play a melody: [[note, beats], ...] ('r' rests) from a start beat
  melody(instrument, notes, startBeat, o = {}) {
    let b = startBeat, prev = null;
    for (const [n, d, vel] of notes) {
      if (n !== 'r') {
        const m = midi(n) + (o.transpose || 0);
        const f = mtof(m);
        const opts = { ...(o.opts || {}) };
        if (o.glide && prev && Math.abs(prev - m) <= 7) opts.from = mtof(prev);
        const held = this.secs(d) * (o.legato || 0.92);
        const human = o.human ? (rnd() - 0.5) * o.human : 0;
        this.add(instrument(f, held, (vel || 1) * (o.vel || 1), opts), b, { pan: o.pan || 0, gain: o.gain || 1, send: o.send ?? 0.25, offset: human });
        prev = m;
      }
      b += d;
    }
    return b;
  }
  render({ reverbSize = 0.84, wet = 1, master = 1 } = {}) {
    const [wl, wr] = reverb(this.sL, this.sR, reverbSize, 0.25, this.loop);
    const L = new Float32Array(this.len), R = new Float32Array(this.len);
    let peak = 1e-6;
    for (let i = 0; i < this.len; i++) {
      L[i] = this.L[i] + wl[i] * wet; R[i] = this.R[i] + wr[i] * wet;
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    }
    // normalise, then a gentle soft clip so the loudest hits are rounded, not cut
    const g = (1.15 / peak) * master;
    for (let i = 0; i < this.len; i++) { L[i] = Math.tanh(L[i] * g) * 0.89; R[i] = Math.tanh(R[i] * g) * 0.89; }
    if (!this.loop) { // fade the very end
      const f = Math.min(this.len, Math.round(0.3 * SR));
      for (let i = 0; i < f; i++) { const k = i / f; L[this.len - 1 - i] *= k; R[this.len - 1 - i] *= k; }
    }
    return [L, R];
  }
}

// ---- WAV files ----
export function wav(channels, rate = SR) {
  const n = channels[0].length, nc = channels.length;
  const out = Buffer.alloc(44 + n * nc * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * nc * 2, 4); out.write('WAVE', 8);
  out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(nc, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * nc * 2, 28); out.writeUInt16LE(nc * 2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(n * nc * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(channels[c][i] * 32767))), 44 + (i * nc + c) * 2);
  return out;
}

// ======================================================================================================
// The voice: a glottal pulse through a cascade of formant resonators (a Klatt-style synthesiser), plus
// noise for h, s, f and the bursts of p, t, k. A clip is a list of phonemes with lengths and a pitch line.
// ======================================================================================================
const VSR = SR * 2; // synthesised at twice the rate, then halved
//          F1    F2    F3   B1  B2  B3  voiced  aspir  fric  fricF  amp
const PH = {
  a: [760, 1150, 2500, 90, 110, 160, 1, 0, 0, 0, 1],
  A: [700, 1220, 2600, 90, 110, 160, 1, 0, 0, 0, 1], // "ah" a little brighter
  ae: [680, 1700, 2450, 80, 110, 160, 1, 0, 0, 0, 1],
  e: [540, 1850, 2500, 70, 100, 150, 1, 0, 0, 0, 0.95],
  i: [290, 2250, 3000, 60, 100, 150, 1, 0, 0, 0, 0.8],
  I: [400, 1950, 2550, 70, 100, 150, 1, 0, 0, 0, 0.85],
  o: [520, 860, 2450, 80, 90, 150, 1, 0, 0, 0, 1],
  u: [320, 820, 2250, 60, 80, 150, 1, 0, 0, 0, 0.85],
  U: [440, 1050, 2300, 70, 90, 150, 1, 0, 0, 0, 0.9],
  uh: [640, 1200, 2400, 80, 100, 150, 1, 0, 0, 0, 1],
  er: [480, 1350, 1700, 70, 100, 120, 1, 0, 0, 0, 0.9],
  y: [280, 2300, 3000, 60, 100, 150, 1, 0, 0, 0, 0.6],
  w: [300, 700, 2200, 60, 80, 150, 1, 0, 0, 0, 0.55],
  l: [380, 1100, 2700, 70, 120, 150, 1, 0, 0, 0, 0.6],
  r: [420, 1250, 1600, 70, 100, 120, 1, 0, 0, 0, 0.65],
  m: [260, 1100, 2300, 120, 300, 300, 1, 0, 0, 0, 0.35],
  n: [260, 1500, 2600, 120, 300, 300, 1, 0, 0, 0, 0.35],
  ng: [260, 2000, 2700, 120, 300, 300, 1, 0, 0, 0, 0.3],
  h: [null, null, null, 200, 200, 200, 0, 0.9, 0, 0, 0.9],   // takes the next vowel's formants
  f: [400, 1300, 2500, 200, 200, 200, 0, 0.1, 0.35, 5000, 0.6],
  s: [400, 1600, 2600, 200, 200, 200, 0, 0, 0.7, 6800, 0.6],
  sh: [400, 1800, 2400, 200, 200, 200, 0, 0, 0.75, 3200, 0.7],
  z: [300, 1600, 2600, 100, 150, 200, 0.5, 0, 0.5, 6000, 0.6],
  _: [null, null, null, 200, 200, 200, 0, 0, 0, 0, 0],      // silence (a closure)
  // stops: a silent closure is written as '_' before them; these are the release bursts
  p: [400, 900, 2300, 200, 200, 200, 0, 0.6, 0.5, 900, 0.8],
  b: [300, 900, 2300, 100, 150, 200, 0.6, 0, 0.3, 900, 0.6],
  t: [400, 1700, 2600, 200, 200, 200, 0, 0.6, 0.7, 4500, 0.8],
  d: [300, 1700, 2600, 100, 150, 200, 0.6, 0, 0.4, 3500, 0.6],
  k: [400, 1900, 2500, 200, 200, 200, 0, 0.6, 0.6, 2200, 0.8],
  g: [300, 1900, 2500, 100, 150, 200, 0.6, 0, 0.4, 2000, 0.6],
};

class Reso {
  constructor() { this.y1 = 0; this.y2 = 0; }
  run(x, f, bw) {
    const T = 1 / VSR;
    const C = -Math.exp(-2 * Math.PI * bw * T), B = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * f * T), A = 1 - B - C;
    const y = A * x + B * this.y1 + C * this.y2;
    this.y2 = this.y1; this.y1 = y; return y;
  }
}

// segs: [phoneme, seconds, pitch (Hz) or [Hz, Hz, ...] across the segment, loudness]
// o: { formant: formant scale, breath, rasp, vibrato, rate (pitch multiplier) }
export function speak(segs, o = {}) {
  const fs = o.formant || 1, breath = o.breath ?? 0.05, rasp = o.rasp ?? 0, vibD = o.vibrato ?? 0.015;
  // resolve 'h' and '_' formants from the next voiced phoneme
  const list = segs.map(([p, d, f0, amp]) => ({ p, d, f0, amp: amp ?? 1, def: PH[p] }));
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].def[0] === null) {
      let j = i + 1; while (j < list.length && list[j].def[0] === null) j++;
      const src = j < list.length ? list[j].def : PH.uh;
      list[i].def = [src[0], src[1], src[2], ...list[i].def.slice(3)];
    }
  }
  const total = list.reduce((s, x) => s + x.d, 0) + 0.08;
  const n = Math.ceil(total * VSR);
  const out = new Float32Array(n);
  // per-sample targets
  const tg = new Float32Array(n * 9); // F1 F2 F3 B1 B2 B3 voice aspir fric ; fricF + amp + f0 kept separately
  const fricF = new Float32Array(n), ampT = new Float32Array(n), f0T = new Float32Array(n);
  let idx = 0, lastF0 = 180;
  for (const s of list) {
    const len = Math.round(s.d * VSR);
    const pts = s.f0 == null ? [lastF0] : Array.isArray(s.f0) ? s.f0 : [s.f0];
    for (let k = 0; k < len && idx < n; k++, idx++) {
      const u = len > 1 ? k / (len - 1) : 0;
      const pos = u * (pts.length - 1); const a = Math.floor(pos), bb = Math.min(pts.length - 1, a + 1);
      // smooth (cosine) interpolation between pitch points
      const w = (1 - Math.cos((pos - a) * Math.PI)) / 2;
      f0T[idx] = pts[a] + (pts[bb] - pts[a]) * w;
      for (let q = 0; q < 9; q++) tg[idx * 9 + q] = s.def[q];
      fricF[idx] = s.def[9] || 3000; ampT[idx] = s.def[10] * s.amp;
    }
    lastF0 = pts[pts.length - 1];
  }
  for (; idx < n; idx++) { for (let q = 0; q < 9; q++) tg[idx * 9 + q] = tg[(idx - 1) * 9 + q]; fricF[idx] = fricF[idx - 1]; ampT[idx] = 0; f0T[idx] = f0T[idx - 1]; }
  // smoothing: formants glide (coarticulation), loudness a bit faster
  const sm = new Float32Array(9); for (let q = 0; q < 9; q++) sm[q] = tg[q];
  let smA = 0, smF0 = f0T[0], smFr = fricF[0];
  const kF = 1 - Math.exp(-1 / (0.018 * VSR)), kA = 1 - Math.exp(-1 / (0.006 * VSR)), kP = 1 - Math.exp(-1 / (0.012 * VSR));
  const R = [new Reso(), new Reso(), new Reso(), new Reso(), new Reso()];
  const fr = new Reso(); const hpN = new OnePole();
  let ph = 0, jit = 1, shim = 1, prevG = 0;
  const rate = o.rate || 1;
  for (let i = 0; i < n; i++) {
    for (let q = 0; q < 9; q++) sm[q] += (tg[i * 9 + q] - sm[q]) * kF;
    smA += (ampT[i] - smA) * kA; smF0 += (f0T[i] - smF0) * kP; smFr += (fricF[i] - smFr) * kF;
    const t = i / VSR;
    const f0 = smF0 * rate * jit * (1 + vibD * Math.sin(t * TAU * 5.5));
    const dph = f0 / VSR;
    ph += dph;
    if (ph >= 1) { ph -= 1; jit = 1 + (rnd() - 0.5) * 0.02; shim = 1 + (rnd() - 0.5) * 0.08 * (1 + rasp * 3); }
    // Rosenberg pulse, differentiated (the lips' radiation)
    const OQ = 0.62, tp = OQ * 0.62;
    let g;
    if (ph < tp) g = 0.5 * (1 - Math.cos(Math.PI * ph / tp));
    else if (ph < OQ) g = Math.cos((Math.PI / 2) * (ph - tp) / (OQ - tp));
    else g = 0;
    const dg = (g - prevG) * VSR / Math.max(80, f0) * 0.15; prevG = g;
    const nz = noise();
    const voiced = dg * shim * sm[6] * (1 + rasp * 0.6 * nz * (g > 0 ? 1 : 0));
    const asp = hpN.hp(nz, 0.15) * (sm[7] + breath * sm[6] * (0.4 + g));
    let x = voiced + asp * 0.5;
    const F = [sm[0] * fs, sm[1] * fs, sm[2] * fs, 3300 * fs, 3850 * fs], Bw = [sm[3], sm[4], sm[5], 250, 300];
    for (let k = 0; k < 5; k++) x = R[k].run(x, Math.min(F[k], VSR * 0.45), Bw[k]);
    const fric = fr.run(nz, Math.min(Math.max(smFr, 1500) * fs, VSR * 0.45), Math.max(300, smFr * 0.35)) * sm[8] * 0.9;
    out[i] = (x + fric) * smA;
  }
  // halve the rate (a two-tap average is a good enough low-pass here), remove DC, normalise
  const m = Math.floor(n / 2); const res = new Float32Array(m);
  const hp = new OnePole();
  let peak = 1e-6;
  for (let i = 0; i < m; i++) { res[i] = hp.hp((out[2 * i] + out[2 * i + 1]) * 0.5, 0.02); peak = Math.max(peak, Math.abs(res[i])); }
  const gain = (o.level || 0.92) / peak;
  for (let i = 0; i < m; i++) res[i] = Math.tanh(res[i] * gain * 1.2) / Math.tanh(1.2);
  return res;
}
