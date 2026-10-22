"""Original score for the Studio 64 trailer: a 150 BPM phonk/trap cue played from CC0 one-shots
(Freesound, licences in promo/CREDITS.md). Every instrument is a real recorded sample, repitched.
    uv run --with numpy --with scipy --with soxr python promo/scripts/music.py OUT.wav
Grid: 150 BPM, 16th = 0.1 s, bar = 1.6 s. Bar 0 is the cold open (no music), the cue runs bars 1-15.
Sections (bar numbers): 1 intro pad | 2-3 typing groove | 4 build + gap | 5-8 drop | 9 slow-mo
(filtered) | 10-12 drop + montage | 13-15 end card (drums out after the logo hit)."""
import os, subprocess, sys, numpy as np, soxr
from scipy.signal import butter, sosfilt

SR = 48000
K = os.environ.get('PHONK_KIT', os.path.expanduser('~/Documents/slop/assets/music/phonk_kit'))
STEP = 0.1                       # a 16th at 150 BPM
BAR = 16 * STEP
TOTAL_BARS = 16
N = int(SR * BAR * TOTAL_BARS) + SR * 3

def load(rel, mono=False):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', f'{K}/{rel}', '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, np.float32).reshape(-1, 2).copy()
    return x.mean(1, keepdims=True).repeat(2, 1) if mono else x

def pitch(x, semis):
    if abs(semis) < 1e-3:
        return x
    ratio = 2 ** (semis / 12)
    return soxr.resample(x, SR * ratio, SR).astype(np.float32)   # play faster = higher

def env(x, attack=0.002, hold=None, release=0.05):
    n = len(x); e = np.ones(n, np.float32)
    a = int(attack * SR)
    if a: e[:a] = np.linspace(0, 1, a)
    if hold is not None:
        h = int(hold * SR); r = int(release * SR)
        if h < n:
            e[h:h + r] = np.linspace(1, 0, min(r, n - h))[:len(e[h:h + r])]
            e[h + r:] = 0
    return x * e[:, None]

kick = load('kick/fs864378.ogg'); kick_big = load('kick/fs860394.ogg')
snare = load('snare/fs829814.ogg'); clap = env(load('clap/fs519305.ogg'), hold=0.22, release=0.05)
hat = load('hat/fs834074.ogg'); hat2 = load('hat/fs542801.ogg'); ohat = env(load('hat/fs455638.ogg'), hold=0.3, release=0.15)
s808 = load('s808/fs859626.ogg', mono=True)      # gritty 808, measured f0 ~ midi 36.5
sub = load('s808/fs792515.ogg', mono=True)       # clean sub, ~ midi 24.1
cow = load('cow/fs830213.ogg')                   # phonk cowbell, C5 (midi 72.0)
pad = load('pad/fs845391.ogg')                   # dark drone (C2-ish)
rcrash = load('fx/fs383903.ogg'); riser = load('fx/fs685256.ogg')

def bus():
    return np.zeros((N, 2), np.float32)
B = {k: bus() for k in ['kick', 'snare', 'hat', 'bass', 'cow', 'pad', 'fx']}

def put(b, x, t, g=1.0):
    i = int(round(t * SR))
    if i < 0:
        x = x[-i:]; i = 0
    j = min(N, i + len(x))
    B[b][i:j] += x[:j - i] * g

def t_of(bar, step):
    return bar * BAR + step * STEP

# --- cowbell riff (C minor), two bars: (step, midi, length in steps)
RIFF = [[(0, 72, 2), (2, 72, 1), (3, 75, 3), (6, 79, 2), (8, 77, 2), (10, 75, 1), (11, 74, 3), (14, 72, 2)],
        [(0, 72, 2), (2, 72, 1), (3, 75, 3), (6, 79, 2), (8, 80, 2), (10, 79, 1), (11, 77, 1), (12, 75, 2), (14, 74, 2)]]
# --- 808 line: (step, midi, length in steps, glide-to)
BASS = [[(0, 36, 6, None), (6, 36, 4, None), (10, 32, 4, None), (14, 34, 2, 36)],
        [(0, 36, 6, None), (6, 39, 4, None), (10, 32, 3, None), (13, 31, 3, 36)]]

def cow_note(midi, steps, g):
    x = pitch(cow, midi - 72.0)
    return env(x, hold=steps * STEP * 0.9, release=0.06) * g

def bass_note(midi, steps, glide=None, g=1.0):
    dur = steps * STEP
    # the 808 sample, retuned; a glide plays the note as a pitch ramp (variable-rate read)
    src = s808[:, 0]
    n = int(dur * SR)
    base = 2 ** ((midi - 36.5) / 12)
    if glide is None:
        rate = np.full(n, base)
    else:
        tgt = 2 ** ((glide - 36.5) / 12)
        k = int(n * 0.55)
        rate = np.concatenate([np.full(k, base), np.geomspace(base, tgt, n - k)])
    pos = np.cumsum(rate); pos = np.clip(pos, 0, len(src) - 2)
    y = np.interp(pos, np.arange(len(src)), src).astype(np.float32)
    s = sub[:, 0]; ps = np.clip(np.cumsum(rate * 2 ** ((36.5 - 24.1) / 12) / 2), 0, len(s) - 2)  # sub an octave down
    y = 0.75 * y + 0.35 * np.interp(ps, np.arange(len(s)), s).astype(np.float32)
    fade = min(int(0.03 * SR), n)
    y[-fade:] *= np.linspace(1, 0, fade)
    y = np.tanh(1.6 * y) / np.tanh(1.6)            # grit
    return np.stack([y, y], 1) * g

def drums(bar, kind):
    """kind: 'groove' (bars 2-3), 'full', 'full_fill', 'build'"""
    if kind == 'groove':
        for st in (0, 8):
            put('kick', kick, t_of(bar, st), 0.62)
        put('snare', clap, t_of(bar, 12), 0.45)
        for st in range(0, 16, 2):
            put('hat', hat, t_of(bar, st), 0.25 if st % 4 else 0.32)
    elif kind in ('full', 'full_fill'):
        for st in (0, 7, 10):
            put('kick', kick, t_of(bar, st), 1.0)
        for st in (4, 12):
            put('snare', snare, t_of(bar, st), 0.85); put('snare', clap, t_of(bar, st), 0.5)
        for st in range(16):
            if st % 2 == 0 or (kind == 'full_fill' and st >= 12):
                put('hat', hat if st % 4 else hat2, t_of(bar, st), 0.30 if st % 4 else 0.38)
        if kind == 'full_fill':      # 32nd roll at the bar end
            for k in range(8):
                put('hat', hat, t_of(bar, 14) + k * STEP / 4, 0.18 + 0.03 * k)
        put('hat', ohat, t_of(bar, 6), 0.22)
    elif kind == 'build':            # snare roll speeding up, stops before the drop (gap)
        times = [0, 4, 8, 10, 12, 13, 14, 15]
        for i, st in enumerate(range(0, 12)):
            put('snare', snare, t_of(bar, st), 0.25 + 0.05 * st)
        for st in (0, 4, 8):
            put('kick', kick, t_of(bar, st), 0.7)

# The arrangement in 16ths (a beat = 4 steps), section by section, following the cut (edit2.py SEGS: frames / 3 = steps).
import json as _json
SECS = [('none', 16), ('intro', 16), ('ui', 16), ('drop', 28), ('ui_short', 8), ('drop_fill', 32), ('ui_short', 8), ('drop_fill', 28),
        ('breakdown', 12), ('build', 16), ('drop_big', 16), ('drop', 16), ('drop_fill', 16), ('slowmo', 16), ('drop_big', 16),
        ('drop_fill', 16), ('end', 34)]
TOTAL_STEPS = sum(n for _, n in SECS)
N = int(SR * STEP * TOTAL_STEPS) + SR * 4
B = {k: np.zeros((N, 2), np.float32) for k in ['kick', 'snare', 'hat', 'bass', 'cow', 'pad', 'fx']}
tt = lambda step: step * STEP

def drums_at(s0, n, kind):
    for st in range(n):
        ls = st % 16
        t = tt(s0 + st)
        fill = kind == 'full_fill' and st >= n - 4
        if kind in ('full', 'full_fill'):
            if ls in (0, 7, 10):
                put('kick', kick, t, 1.0)
            if ls in (4, 12):
                put('snare', snare, t, 0.85); put('snare', clap, t, 0.5)
            if ls % 2 == 0 or fill:
                put('hat', hat if ls % 4 else hat2, t, 0.30 if ls % 4 else 0.38)
            if ls == 6:
                put('hat', ohat, t, 0.22)
    if kind == 'full_fill':
        for k in range(8):
            put('hat', hat, tt(s0 + n - 2) + k * STEP / 4, 0.18 + 0.03 * k)

def melody_at(s0, n, g, idx):
    for bar0 in range(0, n, 16):
        r = RIFF[(idx + bar0 // 16) % 2]
        for st, m, ln in r:
            if bar0 + st < n:
                put('cow', cow_note(m, min(ln, n - bar0 - st), g), tt(s0 + bar0 + st))

def bass_at(s0, n, g, idx):
    for bar0 in range(0, n, 16):
        bl = BASS[(idx + bar0 // 16) % 2]
        for st, m, ln, gl in bl:
            if bar0 + st < n:
                put('bass', bass_note(m, min(ln, n - bar0 - st), gl if bar0 + st + ln <= n else None, g), tt(s0 + bar0 + st))

pos = 0
for idx, (sec, n) in enumerate(SECS):
    prev = SECS[idx - 1][0] if idx else 'none'
    if sec == 'intro':
        put('pad', env(pad[int(2 * SR):int(2 * SR + tt(n) * 1.2 * SR)], attack=0.3), tt(pos), 0.55)
        for st in range(2, n, 4):
            put('hat', hat, tt(pos + st), 0.12)
    if sec in ('ui', 'ui_short'):
        for st in range(0, n, 8):
            put('kick', kick, tt(pos + st), 0.62)
        for st in range(0, n - 2, 2):
            put('hat', hat, tt(pos + st), 0.22 if st % 4 else 0.3)
        melody_at(pos, min(n, 8), 0.3, idx)
        put('bass', bass_note(36, min(6, n), None, 0.28), tt(pos))
        rl = min(1.3, tt(n - 2))
        put('fx', riser[-int(rl * SR):], tt(pos + n - 2) - rl, 0.75)
        put('fx', rcrash[-int(min(0.9, tt(n)) * SR):], tt(pos + n) - min(0.9, tt(n)), 0.45)
    if sec == 'breakdown':
        put('pad', env(pad[int(6 * SR):int(6 * SR + tt(n + 16) * SR)], attack=0.05), tt(pos), 0.45)
        put('kick', kick, tt(pos), 0.7)
        for st in range(0, n, 2):
            put('hat', hat, tt(pos + st), 0.18)
        melody_at(pos, n, 0.28, idx)
        put('bass', bass_note(36, n, 32, 0.3), tt(pos))
    if sec == 'build':
        for st in range(0, n - 4):
            put('snare', snare, tt(pos + st), 0.25 + 0.05 * st * 12 / n)
        for st in (0, 4, 8):
            put('kick', kick, tt(pos + st), 0.7)
        melody_at(pos, n - 6, 0.42, idx)
        put('fx', riser, tt(pos + n - 4) - len(riser) / SR, 0.9)
        put('fx', rcrash[-int(1.2 * SR):], tt(pos + n) - 1.2, 0.5)
    if sec in ('drop', 'drop_fill', 'drop_big'):
        drums_at(pos, n, 'full_fill' if sec == 'drop_fill' else 'full')
        melody_at(pos, n, 0.55, idx)
        bass_at(pos, n, 0.95, idx)
        if sec == 'drop_big' or prev in ('ui', 'ui_short', 'build', 'slowmo'):
            put('kick', kick_big, tt(pos), 1.0)
    if sec == 'slowmo':
        put('bass', bass_note(36, n, 30, 0.5), tt(pos))
        put('kick', kick, tt(pos), 0.9); put('kick', kick, tt(pos + 8), 0.7)
        put('fx', rcrash[-int(1.6 * SR):], tt(pos + n) - 1.6, 0.55)
        SLOW_A, SLOW_B = tt(pos), tt(pos + n)
    if sec == 'end':
        put('kick', kick_big, tt(pos), 1.1)
        put('bass', bass_note(36, 16, 24, 0.8), tt(pos))
        put('pad', env(pad[int(10 * SR):int(10 * SR + 4.0 * SR)], attack=0.01, hold=3.3, release=0.7), tt(pos), 0.6)
        for bar0 in range(0, n, 16):
            r = RIFF[bar0 // 16 % 2]
            for st, m, ln in r:
                if bar0 + st < n:
                    put('cow', cow_note(m, ln, 0.42 * (0.72 ** (bar0 // 16))), tt(pos + bar0 + st))
    pos += n

def lowpass(x, hz, order=4):
    sos = butter(order, hz, 'low', fs=SR, output='sos'); return sosfilt(sos, x, axis=0).astype(np.float32)
def highpass(x, hz, order=2):
    sos = butter(order, hz, 'high', fs=SR, output='sos'); return sosfilt(sos, x, axis=0).astype(np.float32)

# reverb send for the cowbell (exponential noise tail), ping-pong-ish width
rng = np.random.default_rng(7)
ir_n = int(1.4 * SR)
ir = (rng.standard_normal((ir_n, 2)) * np.exp(-np.linspace(0, 6, ir_n))[:, None]).astype(np.float32) * 0.04
from scipy.signal import fftconvolve
cow_wet = np.stack([fftconvolve(highpass(B['cow'], 400)[:, c], ir[:, c])[:N] for c in range(2)], 1).astype(np.float32)
B['cow'] = B['cow'] + 0.55 * cow_wet
B['bass'] = lowpass(B['bass'], 4000)
B['pad'] = highpass(B['pad'], 140, 4)
# sidechain: the kick ducks bass and pad
kenv = np.abs(B['kick']).max(1)
kenv = np.maximum.accumulate(kenv.reshape(-1, 240).max(1).repeat(240))[:N] if False else kenv
win = int(0.12 * SR)
duck = np.convolve((kenv > 0.2).astype(np.float32), np.exp(-np.linspace(0, 4, win)), 'full')[:N]
duck = 1 - 0.55 * np.clip(duck / (duck.max() + 1e-9) * 3, 0, 1)
B['bass'] *= duck[:, None]; B['pad'] *= (0.5 + 0.5 * duck)[:, None]

mix = (1.0 * B['kick'] + 0.9 * B['snare'] + 0.8 * B['hat'] + 0.55 * B['bass'] + 0.8 * B['cow'] + 0.8 * B['pad'] + 0.8 * B['fx'])
# slow-mo bar: the whole cue low-passed with a sweep back up at the end
a, b = int(SLOW_A * SR), int(SLOW_B * SR)
seg = mix[a:b].copy()
lp = lowpass(seg, 450)
sweep = np.linspace(0, 1, b - a) ** 3
mix[a:b] = lp * (1 - sweep[:, None]) + seg * sweep[:, None]
mix /= np.abs(mix).max() + 1e-9
mix *= 0.89
out = sys.argv[1] if len(sys.argv) > 1 else 'music.wav'
from scipy.io import wavfile
wavfile.write(out, SR, (mix * 32767).astype(np.int16))
print('wrote', out, len(mix) / SR, 's')
