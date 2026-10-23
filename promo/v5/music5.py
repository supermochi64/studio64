"""Score for trailer v5 (edit5.py), built on the v3/v4 score (edit3.py): 120 BPM, 60.5 s, a real arc instead of one looped phrase.
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


SECS = [('cold', 6), ('title', 6), ('bw_ui', 10), ('bw', 17), ('city_ui', 8), ('city', 18), ('sg_ui', 6), ('sg', 8),
        ('sub_ui', 7), ('sub', 14), ('kt_ui', 7), ('kt', 7), ('race_ui', 7), ('race', 16), ('slogan', 13), ('end', 10)]
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

# major-key themes for the reborn city and the finale
MAJ = [(0, 72, 2), (2, 76, 2), (4, 79, 4), (8, 81, 2), (10, 79, 2), (12, 76, 4), (16, 74, 2), (18, 76, 2), (20, 79, 3), (24, 84, 6)]
MROOTS = [36, 41, 43, 36]
SPARK = [84, 88, 91, 96, 91, 88, 84, 79]

def lowpass(x, hz, order=4):
    return sosfilt(butter(order, hz, 'low', fs=SR, output='sos'), x, axis=0).astype(np.float32)
def highpass(x, hz, order=2):
    return sosfilt(butter(order, hz, 'high', fs=SR, output='sos'), x, axis=0).astype(np.float32)

t = 0.0
marks = {}
filt = []          # (t0, t1, hz): music low-passed there (slow motion, under water, the flood)
for name, beats in SECS:
    n = beats * 4
    dur = beats * BEAT
    marks[name] = t
    if name == 'cold':
        put('pad', env(pad[int(2 * SR):int((2 + dur + 1.5) * SR)], attack=1.0, hold=dur - 0.2, release=0.8), t, 0.65)
        for st, m, ln in A[:3]:
            put('lead', note(m, ln, 0.16), t + 0.8 + st * STEP)
        put('fx', rcrash[-int(1.5 * SR):], t + dur - 1.5, 0.4)
    if name == 'title':
        put('kick', kick_big, t, 1.0)
        put('bass', bass(36, 16, 0.5), t)
        for st in range(0, n, 8): put('kick', kick, t + st * STEP, 0.6)
        for st in range(2, n, 4): put('hat', hat, t + st * STEP, 0.18)
        theme(t, n, A[:4], 0.3)
    if name.endswith('_ui'):
        for st in range(0, n - 2, 8): put('kick', kick, t + st * STEP, 0.55)
        for st in range(2, n - 2, 4): put('hat', hat, t + st * STEP, 0.16)
        motif = {'bw_ui': A, 'city_ui': Bm, 'sg_ui': Cm, 'sub_ui': A, 'kt_ui': Cm, 'race_ui': D}[name]
        theme(t, min(n - 4, 16), motif, 0.2)
        put('pad', env(pad2[int(1 * SR):int((1 + dur) * SR)], attack=0.3, hold=dur - 0.5, release=0.4), t, 0.25)
        put('bass', bass(36, 8, 0.3), t)
        put('fx', riser[-int(min(2.5, dur - 0.5) * SR):], t + dur - 0.25 - min(2.5, dur - 0.5), 0.6)
    if name == 'bw':                 # the fight; half time under the flight; the boom on the shatter
        slow0, boom = 10 * 4, 13 * 4
        put('kick', kick_big, t, 1.05)
        drums(t, slow0, 2)
        theme(t, slow0, D, 0.5, 0, octl=True)
        bassline(t, slow0, ROOTS['D'], 0.85)
        ts = t + slow0 * STEP
        put('bass', bass(36, boom - slow0, 0.6, glide=29), ts)
        put('kick', kick, ts, 0.8); put('kick', kick, ts + 5 * STEP, 0.6)
        put('lead', note(84, boom - slow0, 0.3), ts)
        put('fx', rcrash[-int(1.2 * SR):], t + boom * STEP - 1.2, 0.6)
        tb = t + boom * STEP
        put('kick', kick_big, tb, 1.25)
        drums(tb, n - boom, 3, fill_end=True)
        theme(tb, n - boom, D[3:] + D[:3], 0.55, 0, octl=True)
        bassline(tb, n - boom, ROOTS['D'], 0.9)
        filt.append((ts, tb, 600))
        marks['bw_boom'] = tb
    if name == 'city':               # the flood: dark and muffled; the wipe: sparkles; then the city in a major key
        w0, w1 = int(3.33 * 4), int(4.67 * 4)
        put('pad', env(pad[int(6 * SR):int((6 + w1 * STEP + 1) * SR)], attack=0.2, hold=w1 * STEP, release=0.4), t, 0.6)
        put('bass', bass(32, w1, 0.4, glide=36), t)
        for st, m, ln in Bm[:4]: put('lead', note(m - 12, ln * 2, 0.2), t + st * STEP)
        filt.append((t, t + w0 * STEP, 900))
        for q, m in enumerate(SPARK * 2):
            put('lead', note(m, 1, 0.22, True), t + (w0 + q * 0.5) * STEP)
        put('fx', riser[-int(1.0 * SR):], t + w1 * STEP - 1.0, 0.7)
        tb = t + w1 * STEP
        put('kick', kick_big, tb, 1.1)
        drums(tb, n - w1, 2)
        theme(tb, n - w1, MAJ, 0.5, 0, octl=True)
        bassline(tb, n - w1, MROOTS, 0.85)
    if name in ('sg', 'kt', 'race', 'sub'):
        k = {'sg': 3, 'kt': 3, 'race': 3, 'sub': 2}[name]
        sh = {'sg': 0, 'kt': 0, 'race': 2, 'sub': -2}[name]
        motif = {'sg': Cm, 'kt': Cm, 'race': D, 'sub': A}[name]
        put('kick', kick_big, t, 1.05)
        drums(t, n, k, fill_end=name != 'race')
        theme(t, n, motif, 0.5, sh, octl=name in ('race', 'kt'))
        bassline(t, n, ROOTS['ABCD'[['sub', 'sg', 'kt', 'race'].index(name)]], 0.88, sh)
        if name == 'sub':
            filt.append((t + 9.3 * BEAT, t + dur, 700))
    if name == 'slogan':             # the promise: the theme held, the hit on "is now possible", a build to the logo
        put('pad', env(pad[int(4 * SR):int((4 + dur + 1) * SR)], attack=0.05, hold=dur - 0.3, release=0.6), t, 0.6)
        put('bass', bass(38, 10, 0.45, glide=36), t)
        th = t + 3.33 * BEAT
        put('kick', kick_big, th, 1.2)
        drums(th, int((dur - 3.33 * BEAT) / STEP), 2, fill_end=True)
        theme(th, int((dur - 3.33 * BEAT) / STEP), MAJ, 0.45, 2, octl=True)
        bassline(th, int((dur - 3.33 * BEAT) / STEP), MROOTS, 0.8, 2)
        put('fx', riser[-int(2.0 * SR):], t + dur - 2.05, 0.6)
        put('fx', rcrash[-int(1.5 * SR):], t + dur - 1.5, 0.45)
    if name == 'end':
        put('kick', kick_big, t, 1.15)
        put('bass', bass(36, 24, 0.7, glide=24), t)
        put('pad', env(pad[int(14 * SR):int((14 + dur + 1) * SR)], attack=0.02, hold=dur - 1.2, release=1.2), t, 0.55)
        for st, m, ln in [(0, 72, 6), (8, 76, 6), (16, 79, 10), (28, 77, 4), (32, 74, 6), (40, 72, 18)]:
            if st < n: put('lead', note(m, ln, 0.34 * (1 - 0.4 * st / n)), t + st * STEP)
    t += dur

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
for t0, t1, hz in filt:        # slow motion, the flood, under water: low-passed, opening up at the end
    a, b = int(t0 * SR), int(t1 * SR)
    seg = mix[a:b].copy(); sw = np.linspace(0, 1, b - a) ** 4
    mix[a:b] = lowpass(seg, hz) * (1 - sw[:, None]) + seg * sw[:, None]
mix /= np.abs(mix).max() + 1e-9
mix *= 0.89
end = int((TOTAL * BEAT + 2.0) * SR)
mix = mix[:end]
mix[-int(2.5 * SR):] *= np.linspace(1, 0, int(2.5 * SR))[:, None] ** 1.5
wavfile.write(sys.argv[1] if len(sys.argv) > 1 else 'music5.wav', SR, (mix * 32767).astype(np.int16))
print('wrote', len(mix) / SR, 's; sections at', {k: round(v, 2) for k, v in marks.items()})
