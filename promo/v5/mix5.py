"""Sound for trailer v5: the score, the cues of edit5's timeline (CC0 one-shots from promo/work/audio/sfx, the
keyboard, and effects synthesised here: glass, shotgun, swishes, the pipe, water), Bowser's arrival from the old
fight's audio tap; mastered to -14 LUFS.
    uv run --with numpy --with scipy --with soxr --with pyloudnorm python promo/v5/mix5.py TIMELINE MUSIC OUT"""
import json, os, sys, random
import numpy as np
from scipy.signal import butter, sosfilt
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
import audio as A
from audio import SR, FPS

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SFX = f'{ROOT}/promo/work/audio/sfx'
AUD = f'{ROOT}/promo/work/audio'
TL = json.load(open(sys.argv[1]))
music = A.load(sys.argv[2])
N = TL['N']
M = A.Mix(N / FPS + 2.5)
rnd = random.Random(5)
np_r = np.random.default_rng(5)
fr = lambda f: f / FPS
_S = {}
def s(name):
    if name not in _S: _S[name] = A.load(name if name.startswith('/') else f'{SFX}/{name}')
    return _S[name]
def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], 'band', fs=SR, output='sos'), x, axis=0).astype(np.float32)
def lp(x, hz, order=2):
    return sosfilt(butter(order, hz, 'low', fs=SR, output='sos'), x, axis=0).astype(np.float32)
def hp(x, hz, order=2):
    return sosfilt(butter(order, hz, 'high', fs=SR, output='sos'), x, axis=0).astype(np.float32)
def st(x):
    return np.stack([x, x], 1).astype(np.float32) if x.ndim == 1 else x
def decay(n, tau):
    return np.exp(-np.arange(n) / (tau * SR)).astype(np.float32)

# ---- synthesised effects ----
def glass(big=1.0):
    n = int(1.8 * SR)
    out = np.zeros((n, 2), np.float32)
    nz = np_r.standard_normal((n, 2)).astype(np.float32)
    out += hp(nz, 2500) * decay(n, 0.08)[:, None] * 0.6 * big                       # the crack
    out += lp(nz, 180) * decay(n, 0.12)[:, None] * 1.2 * big                        # the thump
    for k in range(int(70 * big)):                                                  # shards: bright little rings
        t0 = abs(np_r.normal(0, 0.25)); i = int(t0 * SR)
        f = np_r.uniform(2400, 7500); m = int(np_r.uniform(0.04, 0.22) * SR)
        if i + m >= n: continue
        tt = np.arange(m) / SR
        ring = np.sin(2 * np.pi * f * tt) * np.exp(-tt / np_r.uniform(0.015, 0.06)) * np_r.uniform(0.08, 0.22)
        pan = np_r.uniform(0.2, 0.8)
        out[i:i + m, 0] += ring * (1 - pan); out[i:i + m, 1] += ring * pan
    return out
def shotgun():
    n = int(0.9 * SR)
    nz = np_r.standard_normal((n, 2)).astype(np.float32)
    x = lp(nz, 3200) * decay(n, 0.05)[:, None] * 0.9
    tt = np.arange(n) / SR
    boom = np.sin(2 * np.pi * (55 + 40 * np.exp(-tt * 30)) * tt) * decay(n, 0.18)
    x += st(boom) * 0.9
    return x + s('war_explosion_fs741173_00.wav')[:n] * 0.35 * decay(n, 0.15)[:, None]
def swish(up=True):
    n = int(0.28 * SR)
    nz = np_r.standard_normal((n, 2)).astype(np.float32)
    tt = np.arange(n) / n
    env = np.sin(np.pi * tt) ** 2
    out = np.zeros_like(nz)
    for k in range(6):   # a sweeping band
        a, b = k * n // 6, (k + 1) * n // 6
        f = (1200 + 4000 * (k / 5 if up else 1 - k / 5))
        out[a:b] = bp(nz[a:b], f * 0.7, f * 1.3)
    return out * env[:, None] * 1.4
def pipe():
    """three falling square notes, the way a pipe sounds"""
    out = []
    for f, d in [(392, 0.09), (311, 0.09), (233, 0.09), (196, 0.16)]:
        tt = np.arange(int(d * SR)) / SR
        out.append(np.sign(np.sin(2 * np.pi * f * tt)) * 0.18 * np.exp(-tt / 0.2))
    return st(lp(np.concatenate(out), 3000))
def splash(n_s=1.2):
    n = int(n_s * SR)
    nz = np_r.standard_normal((n, 2)).astype(np.float32)
    x = lp(nz, 1600) * decay(n, 0.3)[:, None] * 0.8
    for k in range(25):
        i = int(abs(np_r.normal(0.2, 0.25)) * SR); m = int(0.06 * SR)
        if i + m >= n: continue
        tt = np.arange(m) / SR; f0 = np_r.uniform(300, 900)
        b = np.sin(2 * np.pi * (f0 + 3000 * tt) * tt) * np.exp(-tt / 0.02) * 0.15
        x[i:i + m] += st(b)
    return x
def bells():
    out = np.zeros((int(2.2 * SR), 2), np.float32)
    for q, m in enumerate([84, 88, 91, 96, 91, 96, 100, 103]):
        f = 440 * 2 ** ((m - 69) / 12); i = int(q * 0.085 * SR); n = int(1.1 * SR)
        tt = np.arange(n) / SR
        b = (np.sin(2 * np.pi * f * tt) + 0.4 * np.sin(2 * np.pi * f * 2.01 * tt)) * np.exp(-tt / 0.35) * 0.12
        out[i:i + n] += st(b)[: len(out) - i]
    return out

GLASS, GLASS2 = glass(1.0), glass(1.3)
keys = sorted(x for x in os.listdir(AUD) if x.startswith('key_') and x.endswith('.wav'))
for f, kind, _ in TL['events']:
    t = fr(f)
    if kind == 'key': M.add('ui', s(f'{AUD}/{rnd.choice(keys)}'), t, gain_db=-9)
    elif kind == 'send': M.add('ui', s('click_fs788052_00.wav'), t, gain_db=-6)
    elif kind == 'card': M.add('ui', A.repitch(s('click_fs237343_00.wav'), 5), t, gain_db=-10)
    elif kind == 'punch': M.add('sfx', s('teleport_fs422730_00.wav')[: int(0.7 * SR)], t - 0.18, gain_db=-7, fade_out=0.1)
    elif kind == 'whip': M.add('sfx', A.repitch(s('flyby_fs683179_00.wav'), 4)[: int(0.5 * SR)], t, gain_db=-10, fade_in=0.05, fade_out=0.1)
    elif kind == 'solonga': M.add('game', s(f'{AUD}/so_longa_bowser.aiff'), t, gain_db=-2)
    elif kind in ('shatter', 'shatter2'):
        M.add('sfx', GLASS if kind == 'shatter' else GLASS2, t, gain_db=-1)
        M.add('sfx', s('cine_hit_fs754421_00.wav'), t, gain_db=-3)
        if kind == 'shatter': M.add('sfx', s('sonicboom_fs816376_00.wav'), t, gain_db=-6)
        M.add('sfx', s('rubble_fs550342_04.wav'), t + 0.15, gain_db=-12, fade_out=0.6)
    elif kind == 'wipe':
        M.add('sfx', bells(), t, gain_db=-3)
        M.add('sfx', s('teleport_fs715784_00.wav'), t, gain_db=-6)
        M.add('sfx', s('cine_hit_fs255111_00.wav'), t + 0.62, gain_db=-8)
    elif kind == 'shotgun': M.add('sfx', shotgun(), t, gain_db=-3)
    elif kind == 'slash': M.add('sfx', swish(rnd.random() < 0.5), t, gain_db=-4)
    elif kind == 'pipe': M.add('sfx', pipe(), t, gain_db=-4)
    elif kind == 'splash': M.add('sfx', splash(1.4), t, gain_db=-6)
    elif kind == 'dive': M.add('sfx', lp(splash(2.5), 700), t, gain_db=-4)
    elif kind == 'road': M.add('sfx', A.repitch(s('flyby_fs683179_00.wav'), -5), t, gain_db=-8, fade_out=0.3)
    elif kind == 'carstart': M.add('sfx', s('carrev_fs113187_00.wav'), t, gain_db=-6, fade_out=0.4)
    elif kind == 'carpass': M.add('sfx', s('carpass_fs465397_00.wav'), t - 0.5, gain_db=-7, fade_in=0.1, fade_out=0.4)
    elif kind == 'hit': M.add('sfx', s('cine_hit_fs754421_00.wav'), t, gain_db=-4)
    elif kind == 'logo': M.add('sfx', s('cine_hit_fs255111_00.wav'), t, gain_db=-5)

# Bowser's arrival from the old fight's own sound
for o0, o1, s0 in TL.get('game', []):
    g = A.GameAudio(f'{ROOT}/promo/work/cap/fight/main')
    x = g.span(s0, s0 + (o1 - o0))
    M.add('game', x, fr(o0), gain_db=-1, fade_in=0.01, fade_out=0.05)

M.add('music', music[: int((N / FPS + 2) * SR)], 0.0)
mix = M.render(gains={'music': -3.5, 'sfx': 0, 'ui': -2, 'game': 0})
mix = mix[: int((N / FPS + 1.5) * SR)]
mix[-int(1.5 * SR):] *= np.linspace(1, 0, int(1.5 * SR))[:, None]
out, l = A.master(mix)
from scipy.io import wavfile
wavfile.write(sys.argv[3], SR, (np.clip(out, -1, 1) * 32767).astype(np.int16))
print('mix', round(len(out) / SR, 2), 's, LUFS', round(l, 2))
