// Custom sound effects: a small retro synthesizer (presets like coin, jump, laser),
// recorded or uploaded sounds, and the player that plays them when the game asks for
// a sound the project replaced.

export const WAVES = ['square', 'sawtooth', 'triangle', 'sine', 'noise'];

const base = { wave: 'square', duty: 0.5, freq: 440, freqEnd: 440, attack: 0, sustain: 0.08, decay: 0.2,
  vibrato: 0, vibratoSpeed: 8, jump: 1, jumpAt: 0.5, filter: 1, volume: 0.8 };

export const PRESETS = {
  coin: { ...base, freq: 988, freqEnd: 988, sustain: 0.06, decay: 0.32, jump: 1.335, jumpAt: 0.12 },
  jump: { ...base, duty: 0.3, freq: 280, freqEnd: 720, sustain: 0.04, decay: 0.2 },
  powerup: { ...base, freq: 330, freqEnd: 1320, sustain: 0.2, decay: 0.3, vibrato: 0.15, vibratoSpeed: 14 },
  laser: { ...base, wave: 'sawtooth', freq: 1400, freqEnd: 180, sustain: 0.02, decay: 0.22, filter: 0.8 },
  explosion: { ...base, wave: 'noise', freq: 900, freqEnd: 60, sustain: 0.08, decay: 0.7, filter: 0.6 },
  hit: { ...base, wave: 'noise', freq: 1600, freqEnd: 400, sustain: 0.01, decay: 0.14 },
  blip: { ...base, duty: 0.25, freq: 720, freqEnd: 720, sustain: 0.03, decay: 0.06 },
  bounce: { ...base, wave: 'triangle', freq: 180, freqEnd: 620, sustain: 0.05, decay: 0.18 },
  magic: { ...base, wave: 'triangle', freq: 700, freqEnd: 1700, sustain: 0.25, decay: 0.45, vibrato: 0.35, vibratoSpeed: 16 },
  oneup: { ...base, freq: 660, freqEnd: 660, sustain: 0.18, decay: 0.25, jump: 2, jumpAt: 0.35 },
  hurt: { ...base, wave: 'sawtooth', freq: 500, freqEnd: 120, sustain: 0.05, decay: 0.3, vibrato: 0.4, vibratoSpeed: 30 },
  wind: { ...base, wave: 'noise', freq: 300, freqEnd: 500, attack: 0.3, sustain: 0.6, decay: 0.6, filter: 0.25, volume: 0.6 },
};
export const PRESET_NAMES = { coin: 'Coin', jump: 'Jump', powerup: 'Power-up', laser: 'Laser', explosion: 'Explosion', hit: 'Hit',
  blip: 'Blip', bounce: 'Bounce', magic: 'Magic', oneup: '1-Up', hurt: 'Hurt', wind: 'Wind' };

const RATE = 44100;

// Renders a synth sound to samples (mono, 44.1 kHz).
export function renderSynth(p) {
  const dur = Math.min(4, p.attack + p.sustain + p.decay);
  const n = Math.max(1, Math.round(dur * RATE));
  const out = new Float32Array(n);
  let phase = 0, noise = 0, lp = 0;
  const ratio = p.freqEnd / p.freq;
  for (let i = 0; i < n; i++) {
    const t = i / RATE, f01 = t / dur;
    let f = p.freq * Math.pow(ratio, f01);
    if (p.jump !== 1 && f01 >= p.jumpAt) f *= p.jump;
    if (p.vibrato) f *= Math.pow(2, (p.vibrato * Math.sin(2 * Math.PI * p.vibratoSpeed * t)) / 12);
    const prev = phase;
    phase = (phase + f / RATE) % 1;
    let v;
    switch (p.wave) {
      case 'sawtooth': v = 2 * phase - 1; break;
      case 'triangle': v = 1 - 4 * Math.abs(phase - 0.5); break;
      case 'sine': v = Math.sin(2 * Math.PI * phase); break;
      case 'noise': if (phase < prev) noise = Math.random() * 2 - 1; v = noise; break;
      default: v = phase < p.duty ? 0.8 : -0.8;
    }
    const env = t < p.attack ? t / p.attack : t < p.attack + p.sustain ? 1 : Math.max(0, 1 - (t - p.attack - p.sustain) / p.decay);
    lp += (v - lp) * Math.min(1, p.filter * p.filter);
    out[i] = lp * env * p.volume * 0.6;
  }
  return out;
}

const r = (a, b) => a + Math.random() * (b - a);
export function randomSynth() {
  const wave = WAVES[Math.floor(Math.random() * WAVES.length)];
  const freq = r(120, 1500);
  return { ...base, wave, duty: r(0.15, 0.5), freq, freqEnd: freq * Math.pow(2, r(-2.5, 2.5)), attack: Math.random() < 0.8 ? 0 : r(0, 0.2),
    sustain: r(0.01, 0.25), decay: r(0.05, 0.5), vibrato: Math.random() < 0.6 ? 0 : r(0, 0.5), vibratoSpeed: r(4, 30),
    jump: Math.random() < 0.6 ? 1 : [1.25, 1.335, 1.5, 2, 0.75][Math.floor(Math.random() * 5)], jumpAt: r(0.1, 0.6), filter: r(0.4, 1), volume: 0.8 };
}
export function mutateSynth(p) {
  const m = (v, k) => v * Math.pow(2, r(-k, k));
  return { ...p, freq: m(p.freq, 0.3), freqEnd: m(p.freqEnd, 0.3), sustain: Math.max(0.005, m(p.sustain, 0.4)), decay: Math.max(0.02, m(p.decay, 0.4)),
    vibratoSpeed: m(p.vibratoSpeed, 0.4), filter: Math.min(1, Math.max(0.1, p.filter + r(-0.15, 0.15))) };
}

// Plays project sounds (synth or recorded) with Web Audio.
export class SfxPlayer {
  constructor() { this.cache = new Map(); this.ctx = null; this.lastPlay = new Map(); }

  context() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  key(sound) { return `${sound.id}|${sound.kind === 'file' ? sound.data?.length : JSON.stringify(sound.synth)}`; }

  async buffer(sound) {
    const k = this.key(sound);
    if (this.cache.has(k)) return this.cache.get(k);
    const ctx = this.context();
    let buf;
    if (sound.kind === 'file') {
      const bin = Uint8Array.from(atob(sound.data.split(',')[1]), (c) => c.charCodeAt(0));
      buf = await ctx.decodeAudioData(bin.buffer);
    } else {
      const s = renderSynth(sound.synth);
      buf = ctx.createBuffer(1, s.length, RATE);
      buf.copyToChannel(s, 0);
    }
    this.cache.set(k, buf);
    return buf;
  }

  // distance: how far from the camera the game played it (0 = here)
  async play(sound, distance = 0) {
    if (!sound) return;
    // sounds the game repeats every frame (footsteps, loops) start at most every 120 ms
    const now = performance.now();
    if (now - (this.lastPlay.get(sound.id) || 0) < 120) return;
    this.lastPlay.set(sound.id, now);
    try {
      const ctx = this.context();
      const src = ctx.createBufferSource();
      src.buffer = await this.buffer(sound);
      const gain = ctx.createGain();
      gain.gain.value = (sound.volume ?? 1) * Math.max(0.08, Math.min(1, 1 - distance / 4000));
      src.connect(gain).connect(ctx.destination);
      src.start();
    } catch (err) {
      console.warn('sound failed', err);
    }
  }

  // Samples for drawing the waveform.
  async samples(sound) { return (await this.buffer(sound)).getChannelData(0); }
}
