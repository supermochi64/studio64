"""Score for trailer v3 (edit3.py): 120 BPM, 60.5 s, a real arc instead of one looped phrase.
Every sound is a recorded CC0 one-shot (Freesound, promo/CREDITS.md), repitched.
    uv run --with numpy --with scipy --with soxr python promo/scripts/music3.py OUT.wav
Sections (beats, matching edit3.SEGS): intro 7 | prompt 12 | drop A 10 | prompt 11 | drop B 10 | prompt 11 | drop C 10 |
bridge 16 (drums out, tension, riser, snare roll) | finale 24 (+2 semitones, the big riff; half-time under the slow
motion; the biggest hit on the blast) | outro 10 (drums stop on the logo, the theme slowed, resolves on C)."""
import os, subprocess, sys, numpy as np, soxr
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR = 48000
K = os.environ.get('PHONK_KIT', os.path.expanduser('~/Documents/slop/assets/music/phonk_kit'))
BEAT = 0.5
STEP = BEAT / 4

def load(rel, mono=False):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', f'{K}/{rel}', '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32).reshape(-1, 2).copy()
    return x.mean(1, keepdims=True).repeat(2, 1) if mono else x

def pitch(x, semis):
    return x if abs(semis) < 1e-3 else soxr.resample(x, SR * 2 ** (semis / 12), SR).astype(np.float32)

def env(x, attack=0.002, hold=None, release=0.05):
    n = len(x); e = np.ones(n, np.float32)
    a = int(attack * SR)
    if a: e[:a] = np.linspace(0, 1, a)
    if hold is not None:
        h = int(hold * SR); r = int(release * SR)
        if h < n:
            seg = e[h:h + r]; e[h:h + r] = np.linspace(1, 0, len(seg)); e[h + r:] = 0
    return x * e[:, None]

kick = load('kick/fs864378.ogg'); kick_big = load('kick/fs860394.ogg')
snare = load('snare/fs829814.ogg'); clap = env(load('clap/fs519305.ogg'), hold=0.22, release=0.05)
hat = load('hat/fs834074.ogg'); hat2 = load('hat/fs542801.ogg'); ohat = env(load('hat/fs455638.ogg'), hold=0.3, release=0.15)
s808 = load('s808/fs859626.ogg', mono=True)[:, 0]
sub = load('s808/fs792515.ogg', mono=True)[:, 0]
cow = load('cow/fs830213.ogg')            # C5
pad = load('pad/fs845391.ogg')
pad2 = load('pad/fs394121.ogg')
rcrash = load('fx/fs383903.ogg'); riser = load('fx/fs685256.ogg')

SECS = [('intro', 7), ('prompt', 12), ('dropA', 10), ('prompt', 11), ('dropB', 10), ('prompt', 11), ('dropC', 8),
        ('bridge', 16), ('finale', 24), ('title', 9), ('outro', 10)]
TOTAL = sum(b for _, b in SECS)
N = int((TOTAL * BEAT + 4) * SR)
B = {k: np.zeros((N, 2), np.float32) for k in ['kick', 'snare', 'hat', 'bass', 'lead', 'pad', 'fx']}

def put(b, x, t, g=1.0):
    i = int(round(t * SR))
    if i < 0: x = x[-i:]; i = 0
    j = min(N, i + len(x))
    if j > i: B[b][i:j] += x[:j - i] * g

def note(midi, steps, g, oct_layer=False):
    x = env(pitch(cow, midi - 72.0), hold=steps * STEP * 0.92, release=0.07) * g
    if oct_layer:
        y = env(pitch(cow, midi - 60.0), hold=steps * STEP * 0.92, release=0.07) * g * 0.35
        n = min(len(x), len(y)); x = x[:n] + y[:n]
    return x

def bass(midi, steps, g, glide=None):
    n = int(steps * STEP * SR)
    base = 2 ** ((midi - 36.5) / 12)
    if glide is None:
        rate = np.full(n, base)
    else:
        k = int(n * 0.6); rate = np.concatenate([np.full(k, base), np.geomspace(base, 2 ** ((glide - 36.5) / 12), n - k)])
    pos = np.clip(np.cumsum(rate), 0, len(s808) - 2)
    y = np.interp(pos, np.arange(len(s808)), s808).astype(np.float32)
    ps = np.clip(np.cumsum(rate * 2 ** ((36.5 - 24.1) / 12) / 2), 0, len(sub) - 2)
    y = 0.75 * y + 0.35 * np.interp(ps, np.arange(len(sub)), sub).astype(np.float32)
    f = min(int(0.03 * SR), n); y[-f:] *= np.linspace(1, 0, f)
    y = np.tanh(1.5 * y) / np.tanh(1.5)
    return np.stack([y, y], 1) * g

# the themes: (step, midi, steps) over two bars (32 steps), C minor
A = [(0, 72, 4), (6, 75, 2), (8, 79, 6), (16, 77, 3), (20, 75, 2), (24, 74, 3), (28, 72, 4)]
Bm = [(0, 67, 2), (2, 67, 2), (6, 70, 2), (8, 72, 6), (16, 75, 3), (20, 74, 2), (22, 72, 2), (24, 70, 3), (28, 67, 4)]
Cm = [(0, 72, 1), (2, 75, 1), (4, 79, 1), (6, 84, 2), (8, 79, 1), (10, 75, 1), (12, 72, 2), (16, 80, 1), (18, 79, 1),
      (20, 77, 1), (22, 75, 2), (24, 74, 1), (26, 75, 1), (28, 79, 3)]
D = [(0, 72, 3), (4, 75, 3), (8, 79, 7), (16, 77, 3), (20, 79, 3), (24, 84, 7)]
ROOTS = {'A': [36, 32, 34, 36], 'B': [36, 39, 41, 43], 'C': [32, 34, 36, 36], 'D': [36, 32, 34, 36]}

def theme(t0, nsteps, motif, g, shift=0, octl=False):
    for s0 in range(0, nsteps, 32):
        for st, m, ln in motif:
            if s0 + st < nsteps:
                put('lead', note(m + shift, min(ln, nsteps - s0 - st), g, octl), t0 + (s0 + st) * STEP)

def bassline(t0, nsteps, roots, g, shift=0):
    for s in range(0, nsteps, 8):     # a root every half bar, a glide into the next
        r = roots[(s // 8) % len(roots)] + shift
        nxt = roots[(s // 8 + 1) % len(roots)] + shift
        put('bass', bass(r, min(8, nsteps - s), g, glide=nxt if (s // 8) % 4 == 3 else None), t0 + s * STEP)

def drums(t0, nsteps, intensity, fill_end=True):
    for st in range(nsteps):
        t = t0 + st * STEP; ls = st % 16
        if ls in (0, 10) or (intensity > 1 and ls == 7):
            put('kick', kick, t, 1.0)
        if ls in (4, 12):
            put('snare', snare, t, 0.8); put('snare', clap, t, 0.45)
        if ls % 2 == 0 or (intensity > 2 and ls % 4 == 3):
            put('hat', hat if ls % 4 else hat2, t, 0.26 if ls % 4 else 0.34)
        if ls == 14 and intensity > 1:
            put('hat', ohat, t, 0.2)
    if fill_end:
        for k in range(8):
            put('snare', snare, t0 + (nsteps - 2) * STEP + k * STEP / 4, 0.12 + 0.04 * k)

t = 0.0
marks = {}
for name, beats in SECS:
    n = beats * 4
    dur = beats * BEAT
    marks.setdefault(name, []).append(t)
    if name == 'intro':          # a swell: the pad and the theme's first notes, filtered later
        put('pad', env(pad[int(2 * SR):int((2 + dur + 1.5) * SR)], attack=1.2, hold=dur + 0.5, release=1.0), t, 0.6)
        for st, m, ln in A[:3]:
            put('lead', note(m, ln, 0.18), t + 1.0 + st * STEP)
        put('fx', rcrash[-int(1.5 * SR):], t + dur - 1.5, 0.35)
    if name == 'prompt':         # the typing: soft groove, the next theme hinted, a riser, a silent last half beat
        idx = len(marks['prompt'])
        motif = [A, Bm, Cm][idx - 1]
        for st in range(0, n - 2, 8):
            put('kick', kick, t + st * STEP, 0.55)
        for st in range(2, n - 2, 4):
            put('hat', hat, t + st * STEP, 0.16)
        theme(t, min(n - 4, 16), motif, 0.22)
        put('pad', env(pad2[int(1 * SR):int((1 + dur) * SR)], attack=0.4, hold=dur - 0.6, release=0.5), t, 0.25)
        put('bass', bass(ROOTS['ABC'[idx - 1]][0], 8, 0.3), t)
        put('fx', riser[-int(min(2.5, dur - 0.5) * SR):], t + dur - 0.25 - min(2.5, dur - 0.5), 0.6)
    if name in ('dropA', 'dropB', 'dropC'):
        k = 'ABC'.index(name[-1])
        put('kick', kick_big, t, 1.0)
        drums(t, n, 1 + k)
        theme(t, n, [A, Bm, Cm][k], 0.5)
        bassline(t, n, ROOTS['ABC'[k]], 0.85)
    if name == 'bridge':         # the boss prompt: drums out, the dark pad, the theme slowed, a long build
        put('pad', env(pad[int(8 * SR):int((8 + dur + 1) * SR)], attack=0.8, hold=dur - 0.8, release=0.6), t, 0.55)
        for st, m, ln in A:
            put('lead', note(m - 12, ln * 2, 0.25), t + st * 2 * STEP)
        put('bass', bass(36, 32, 0.35, glide=32), t)
        put('bass', bass(32, 24, 0.35, glide=34), t + 32 * STEP)
        for st in range(n - 16, n - 2):
            put('snare', snare, t + st * STEP, 0.15 + 0.5 * (st - (n - 16)) / 14)
        put('fx', riser, t + dur - 0.25 - len(riser) / SR, 0.9)
        put('fx', rcrash[-int(2.0 * SR):], t + dur - 2.0, 0.5)
    if name == 'finale':         # D minor (+2): the reveal, the fight, half time under the slow motion, the blast
        sh = 2
        slow0, boom = 16 * 4, 19 * 4          # (steps from the start of the finale; edit3 puts the blast on beat 19)
        put('kick', kick_big, t, 1.1)
        drums(t, slow0, 3, fill_end=True)
        theme(t, slow0, D, 0.55, sh, octl=True)
        bassline(t, slow0, ROOTS['D'], 0.9, sh)
        # slow motion: one long bass note bending down, a heartbeat kick, the lead held
        ts = t + slow0 * STEP
        put('bass', bass(38, boom - slow0, 0.6, glide=31), ts)
        put('kick', kick, ts, 0.8); put('kick', kick, ts + 6 * STEP, 0.6)
        put('lead', note(86, boom - slow0, 0.3), ts)
        put('fx', rcrash[-int(1.4 * SR):], t + boom * STEP - 1.4, 0.6)
        tb = t + boom * STEP
        put('kick', kick_big, tb, 1.2)
        drums(tb, n - boom, 3, fill_end=False)
        theme(tb, n - boom, D[3:] + [(16 + s, m, l) for s, m, l in D[:3]], 0.55, sh, octl=True)
        bassline(tb, n - boom, ROOTS['D'], 0.9, sh)
        marks['slow'] = (ts, tb)
    if name == 'title':          # the promise: the climax rings out, the theme held over a pad, no drums
        put('pad', env(pad[int(4 * SR):int((4 + dur + 1) * SR)], attack=0.05, hold=dur - 0.3, release=0.6), t, 0.6)
        put('bass', bass(38, 16, 0.45, glide=36), t)
        for st, m, ln in [(0, 86, 10), (12, 84, 6), (20, 81, 14)]:
            put('lead', note(m, ln, 0.3), t + st * STEP)
        put('fx', riser[-int(2.0 * SR):], t + dur - 2.05, 0.5)
        put('fx', rcrash[-int(1.5 * SR):], t + dur - 1.5, 0.4)
    if name == 'outro':          # the logo hit, then the theme slowed down and resolved on C
        put('kick', kick_big, t, 1.1)
        put('bass', bass(36, 24, 0.7, glide=24), t)
        put('pad', env(pad[int(14 * SR):int((14 + dur + 1) * SR)], attack=0.02, hold=dur - 1.2, release=1.2), t, 0.55)
        for st, m, ln in [(0, 72, 6), (8, 75, 6), (16, 79, 10), (28, 77, 4), (32, 74, 6), (40, 72, 18)]:
            if st < n:
                put('lead', note(m, ln, 0.34 * (1 - 0.4 * st / n)), t + st * STEP)
    t += dur

def lowpass(x, hz, order=4):
    return sosfilt(butter(order, hz, 'low', fs=SR, output='sos'), x, axis=0).astype(np.float32)
def highpass(x, hz, order=2):
    return sosfilt(butter(order, hz, 'high', fs=SR, output='sos'), x, axis=0).astype(np.float32)

rng = np.random.default_rng(7)
irn = int(1.6 * SR)
ir = (rng.standard_normal((irn, 2)) * np.exp(-np.linspace(0, 6, irn))[:, None]).astype(np.float32) * 0.04
wet = np.stack([fftconvolve(highpass(B['lead'], 400)[:, c], ir[:, c])[:N] for c in range(2)], 1).astype(np.float32)
B['lead'] = B['lead'] + 0.6 * wet
B['bass'] = lowpass(B['bass'], 4000)
B['pad'] = highpass(B['pad'], 140, 4)
kenv = np.abs(B['kick']).max(1)
win = int(0.12 * SR)
duck = np.convolve((kenv > 0.2).astype(np.float32), np.exp(-np.linspace(0, 4, win)), 'full')[:N]
duck = 1 - 0.5 * np.clip(duck / (duck.max() + 1e-9) * 3, 0, 1)
B['bass'] *= duck[:, None]; B['pad'] *= (0.5 + 0.5 * duck)[:, None]
mix = (1.0 * B['kick'] + 0.85 * B['snare'] + 0.75 * B['hat'] + 0.55 * B['bass'] + 0.8 * B['lead'] + 0.8 * B['pad'] + 0.8 * B['fx'])
a, b = (int(x * SR) for x in marks['slow'])          # the slow motion: everything low-passed, opening up into the blast
seg = mix[a:b].copy(); sw = np.linspace(0, 1, b - a) ** 3
mix[a:b] = lowpass(seg, 500) * (1 - sw[:, None]) + seg * sw[:, None]
mix /= np.abs(mix).max() + 1e-9
mix *= 0.89
end = int((TOTAL * BEAT + 2.0) * SR)
mix = mix[:end]
mix[-int(2.5 * SR):] *= np.linspace(1, 0, int(2.5 * SR))[:, None] ** 1.5
wavfile.write(sys.argv[1] if len(sys.argv) > 1 else 'music3.wav', SR, (mix * 32767).astype(np.int16))
print('wrote', len(mix) / SR, 's; sections at', {k: [round(x, 2) for x in v] if isinstance(v, list) else v for k, v in marks.items()})
