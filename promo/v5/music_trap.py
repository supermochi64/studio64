"""Trailer v5, the Mario cut: a trap remix of Super Mario 64's own songs on edit5's grid (120 BPM, 160 beats).
Melodies, bass lines and chords are read note for note from the game's sequences (seqnotes.py) and re-played
with synths over half-time trap drums (the CC0 phonk kit) and 808s; the game's own recordings (record_seqs.mjs)
open the trailer and play the puzzle and star jingles, and Mario's voice shouts on the drops.
It is Nintendo's music: the result stays local (promo/work5), never in the repo.
    uv run --with numpy --with scipy --with soxr python promo/v5/music_trap.py OUT.wav
Sections (edit5.SEGS) and their songs:
    cold     the in-game Bob-omb Battlefield intro, as if from an old TV
    title    the same intro as the remix, "Here we go!"
    bw_ui    Bowser's riff, low and filtered            bw    the riff on 808s; slow motion; the boom on the shatter
    city_ui  Dire Dire Docks, muffled (the flood)       city  the puzzle jingle on the wipe, then Bob-omb Battlefield
    sg_ui    the wing cap, filtered                     sg    the wing cap
    sub_ui   Dire Dire Docks                            sub   Dire Dire Docks, half time; under water on the dive
    kt_ui    the metal cap riff, then its intro         kt    the metal cap
    race_ui  the slide intro, "Let's-a go!"             race  the slide
    slogan   the intro on bells, then the finale on "is now possible": Bob-omb Battlefield a tone up
    end      the star jingle from the game"""
import math, os, subprocess, sys
import numpy as np, soxr
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, '..', 'scripts'))
import seqnotes
import audio as A

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SR = 48000
BEAT = 0.5
KIT = os.environ.get('PHONK_KIT', os.path.expanduser('~/Documents/slop/assets/music/phonk_kit'))
REC = f'{ROOT}/promo/work5/sm64music'
VOX = f'{ROOT}/engine/sound/samples/sfx_mario'
rng = np.random.default_rng(64)

def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).copy()
def kit(rel): return load(f'{KIT}/{rel}')
def repitch(x, semis):
    return x if abs(semis) < 1e-3 else soxr.resample(x, SR * 2 ** (semis / 12), SR).astype(np.float32)
def lp(x, hz, order=2): return sosfilt(butter(order, min(hz, SR * 0.45), 'low', fs=SR, output='sos'), x, axis=0).astype(np.float32)
def hp(x, hz, order=2): return sosfilt(butter(order, hz, 'high', fs=SR, output='sos'), x, axis=0).astype(np.float32)
def st(x, pan=0.0):
    return np.stack([x * min(1, 1 - pan), x * min(1, 1 + pan)], 1).astype(np.float32)

kick, kick_big = kit('kick/fs864378.ogg'), kit('kick/fs860394.ogg')
snare, clap = kit('snare/fs829814.ogg'), kit('clap/fs519305.ogg')[: int(0.25 * SR)]
hat, hat2 = kit('hat/fs834074.ogg'), kit('hat/fs542801.ogg')
ohat = kit('hat/fs455638.ogg')[: int(0.45 * SR)]
ohat[-int(0.15 * SR):] *= np.linspace(1, 0, int(0.15 * SR))[:, None]
rcrash = kit('fx/fs383903.ogg'); crash = rcrash[::-1].copy(); riser = kit('fx/fs685256.ogg')

SECS = [('cold', 6), ('title', 6), ('bw_ui', 10), ('bw', 17), ('city_ui', 8), ('city', 18), ('sg_ui', 6), ('sg', 8),
        ('sub_ui', 7), ('sub', 14), ('kt_ui', 7), ('kt', 7), ('race_ui', 7), ('race', 16), ('slogan', 13), ('end', 10)]
S, _b = {}, 0
for _n, _k in SECS: S[_n] = _b; _b += _k
TOTAL = _b
N = int((TOTAL * BEAT + 4) * SR)
BUSES = ['kick', 'snare', 'hat', '808', 'lead', 'bell', 'pad', 'fx', 'vox', 'orig']
B = {k: np.zeros((N, 2), np.float32) for k in BUSES}
def put(bus, x, beat, g=1.0):
    i = int(round(beat * BEAT * SR))
    if i < 0: x = x[-i:]; i = 0
    j = min(N, i + len(x))
    if j > i: B[bus][i:j] += x[:j - i] * g

# ---- the game's notes ----
BOB, BOW, DDD, WING, METAL, SLIDE = ('03_level_grass', '07_level_boss_koopa', '05_level_water', '0E_event_powerup',
                                     '0F_event_metal_cap', '09_level_slide')
_songs = {}
SUB = sorted({i / 4 for i in range(5)} | {i / 3 for i in range(4)})
def qz(b):
    """onto sixteenths or triplets: the game's songs were played in by hand"""
    f = math.floor(b)
    return f + min(SUB, key=lambda g: abs(g - (b - f)))
def part(name, voices, b0, b1, shift=0):
    """the notes of `voices` [(channel, layer)] from source beat b0 to b1: [(beat from b0, midi, beats)]"""
    if name not in _songs: _songs[name] = seqnotes.notes(name, 72)['notes']
    ns = sorted((qz(b - b0), p, l) for b, ch, p, l, v, i, ly in _songs[name] if (ch, ly) in voices)
    out = []
    for k, (b, p, l) in enumerate(ns):
        if not 0 <= b < b1 - b0: continue
        nxt = next((x[0] for x in ns[k + 1:] if x[0] > b + 1e-6), b + max(l, 0.5))
        gap = nxt - b
        out.append((b, p + shift, min(max(l, 0.55 * gap, 0.2), gap, b1 - b0 - b)))
    return out

# ---- synths ----
def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
TL = 2048
_tabs = {}
def table(kind, m):
    key = (kind, int(m // 6))
    if key not in _tabs:
        kmax = max(1, int(15000 / hz((key[1] + 1) * 6)))
        k = np.arange(1, kmax + 1)[:, None]
        ph = 2 * np.pi * np.arange(TL)[None, :] / TL
        if kind == 'saw': w = (np.sin(k * ph) / k).sum(0)
        elif kind == 'pulse25': w = (np.sin(np.pi * k * 0.25) / k * np.cos(k * ph)).sum(0)
        elif kind == 'pulse50': w = (np.sin(np.pi * k * 0.5) / k * np.cos(k * ph)).sum(0)
        elif kind == 'organ':
            w = sum(a * np.sin(h * ph[0]) for h, a in [(1, 1), (2, .8), (3, .6), (4, .45), (6, .3), (8, .25)] if h <= kmax)
            w = np.asarray(w)[None, :].sum(0)
        w = np.asarray(w, np.float64).ravel()
        _tabs[key] = (w / np.abs(w).max()).astype(np.float32)
    return _tabs[key]
def osc(kind, f, m, ph0=0.0):
    ph = (ph0 + np.cumsum(f) / SR) % 1.0 * TL
    i = ph.astype(np.int64); fr = (ph - i).astype(np.float32)
    t = table(kind, m)
    return t[i % TL] * (1 - fr) + t[(i + 1) % TL] * fr
def freqs(m, n, vib=0.0, glide=None, at=0.7):
    f = np.full(n, hz(m))
    if glide is not None:
        k = int(n * at); f[k:] = np.geomspace(hz(m), hz(glide), n - k)
    if vib:
        t = np.arange(n) / SR
        f *= 2 ** (vib / 12 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.18) / 0.25, 0, 1))
    return f
def env(hold, a=0.004, d=0.15, s=0.7, r=0.08):
    nh = max(1, int(hold * SR)); n = nh + int(r * SR)
    t = np.arange(n) / SR
    e = (s + (1 - s) * np.exp(-np.maximum(t - a, 0) / max(d, 1e-4))) * np.minimum(1, t / max(a, 1e-4))
    if n > nh: e[nh:] *= np.linspace(1, 0, n - nh) ** 2
    return e.astype(np.float32)

def lead(m, beats, g):
    """the Mario lead: a narrow square with a detuned saw on each side"""
    e = env(beats * BEAT * 0.95, 0.004, 0.18, 0.62, 0.07); n = len(e)
    f = freqs(m, n, vib=0.2)
    sq = osc('pulse25', f, m)
    l = 0.75 * sq + 0.32 * osc('saw', f * 2 ** (0.09 / 12), m, 0.3)
    r = 0.75 * sq + 0.32 * osc('saw', f * 2 ** (-0.09 / 12), m, 0.6)
    return np.stack([l * e, r * e], 1) * g
def supersaw(m, beats, g, a=0.006, r=0.15):
    e = env(beats * BEAT * 0.95, a, 0.3, 0.75, r); n = len(e)
    out = np.zeros((n, 2), np.float32)
    for k, (dt, pan) in enumerate([(-0.17, -0.8), (-0.07, -0.35), (0, 0), (0.07, 0.35), (0.17, 0.8)]):
        out += st(osc('saw', freqs(m + dt, n, vib=0.08), m, rng.random()), pan) * 0.3
    return out * e[:, None] * g
def softlead(m, beats, g):
    return lp(supersaw(m, beats, 1.0, a=0.06, r=0.4), 2600) * g
def bell(m, beats, g, ratio=2.0, idx=2.2, decay=0.55):
    n = int((beats * BEAT + decay * 2.5) * SR); t = np.arange(n) / SR
    f = hz(m)
    x = np.sin(2 * np.pi * f * t + idx * np.exp(-t / 0.18) * np.sin(2 * np.pi * f * ratio * t))
    x += 0.25 * np.sin(2 * np.pi * f * 4.01 * t) * np.exp(-t / 0.08)
    e = np.exp(-t / decay) * np.minimum(1, t / 0.002)
    return st((x * e).astype(np.float32), rng.uniform(-0.4, 0.4)) * g
def pluck(m, beats, g):
    n = int((min(beats * BEAT, 0.5) + 0.25) * SR); t = np.arange(n) / SR
    f = freqs(m, n)
    x = osc('pulse50', f, m) * np.exp(-t / 0.11) + 0.6 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.25)
    return st((x * np.minimum(1, t / 0.002)).astype(np.float32), rng.uniform(-0.5, 0.5)) * g
def organ(m, beats, g):
    e = env(beats * BEAT * 0.9, 0.01, 0.4, 0.8, 0.1); n = len(e)
    x = np.tanh(1.6 * osc('organ', freqs(m, n, vib=0.1), m)) * e
    return st(x, 0) * g
def pad(m, beats, g):
    return lp(supersaw(m, beats, 1.0, a=0.35, r=0.6), 1800) * g
def b808(m, beats, g, glide=None):
    n = int((beats * BEAT + 0.02) * SR); t = np.arange(n) / SR
    f = freqs(m, n, glide=glide, at=0.65) * (1 + 0.9 * np.exp(-t / 0.012))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR)
    e = np.exp(-t / 1.6) * np.minimum(1, t / 0.001)
    k = min(int(0.02 * SR), n); e[-k:] *= np.linspace(1, 0, k)
    x = np.tanh(2.2 * x * e) / np.tanh(2.2)
    return st(x.astype(np.float32)) * g

def play(bus, notes, at, inst, g, shift=0, **kw):
    for b, m, l in notes:
        put(bus, inst(m + shift, l, g, **kw), at + b)

# ---- drums and 808s ----
def drums(at, beats, style='full', kicks=True, fill=True):
    """half-time trap: the snare on beat 3 of each bar, syncopated kicks, hats in eighths ('half') or sixteenths
    ('full') with triplet and 32nd rolls; returns the kick beats (for the 808s)"""
    out = []
    steps = int(round(beats * 4))
    for s in range(steps):
        bar, ls = s // 16, s % 16
        t = at + s / 4
        pat = (0, 6, 10) if bar % 2 == 0 else (0, 3, 10, 14)
        if kicks and ls in pat and not (style == 'light' and ls):
            put('kick', kick, t, 1.0 if ls == 0 else 0.85); out.append(t)
        if ls == 8 and style != 'light':
            put('snare', snare, t, 0.85); put('snare', clap, t, 0.6)
        if style == 'full' and bar % 2 == 1 and ls == 15:
            put('snare', snare, t, 0.18)
        roll = bar % 4
        if roll == 3 and ls >= 12 and style == 'full':             # 32nds rising into the next bar
            for k in range(2):
                q = (ls - 12) * 2 + k
                put('hat', repitch(hat, q * 0.6), t + k / 8, 0.12 + 0.03 * q)
            continue
        if roll == 1 and ls in (12, 13) and style != 'light':      # a triplet burst
            if ls == 12:
                for k in range(6): put('hat', hat, t + k / 6 * 0.5 * 0.999, 0.16 + 0.02 * k)
            continue
        if style == 'full' or ls % 2 == 0:
            acc = 0.3 if ls % 4 == 0 else (0.22 if ls % 2 == 0 else 0.14)
            put('hat', hat if ls % 4 else hat2, t, acc)
        if style == 'full' and ls == 14 and bar % 2 == 0:
            put('hat', ohat, t, 0.22)
    if fill and style != 'light' and steps >= 16:
        for k in range(4): put('snare', snare, at + beats - 0.5 + k / 8, 0.15 + 0.07 * k)
    return out

def fold(m, lo=28):
    while m < lo: m += 12
    while m >= lo + 12: m -= 12
    return m
def follow808(kicks, at, bassnotes, end, g, shift=0):
    """808s on the kicks, on the game's bass note there; a glide into a new note at the end of every other bar"""
    pts = []
    for k in kicks:
        rel = k - at
        cand = [p for b, p, l in bassnotes if b <= rel + 0.05]
        p = cand[-1] if cand else (bassnotes[0][1] if bassnotes else 36)
        pts.append((k, fold(p + shift)))
    for i, (k, p) in enumerate(pts):
        nk = pts[i + 1][0] if i + 1 < len(pts) else end
        nxt = pts[i + 1][1] if i + 1 < len(pts) else None
        gl = nxt if nxt is not None and nxt != p and (k - at) % 8 >= 6 else None
        put('808', b808(p, (nk - k), g, glide=gl), k)
def notes808(notes, at, g, shift=0, end=None):
    """808s playing the game's bass line itself"""
    for i, (b, m, l) in enumerate(notes):
        nb = notes[i + 1][0] if i + 1 < len(notes) else (end - at if end else b + l)
        put('808', b808(m + shift, max(nb - b, 0.25), g), at + b)

def roll(end, beats=2.0, g=0.55, rise=7):
    """a snare roll speeding up into `end`"""
    t, k = end - beats, 0
    while t < end - 1e-6:
        p = (t - (end - beats)) / beats
        step = 0.5 if p < 0.25 else (0.25 if p < 0.6 else 0.125)
        put('snare', repitch(snare, rise * p), t, g * (0.25 + 0.75 * p))
        t += step
def rise(end, secs=2.0, g=0.6):
    x = riser[-int(secs * SR):]; put('fx', x, end - secs / BEAT, g)
    y = rcrash[-int(min(secs, 1.5) * SR):]; put('fx', y, end - min(secs, 1.5) / BEAT, g * 0.7)
def impact(at, big=False):
    put('kick', kick_big, at, 1.15 if big else 1.0)
    put('fx', crash[: int(2.5 * SR)], at, 0.5 if big else 0.38)
    if big: put('808', b808(24, 4, 0.7), at)

# ---- the game's recordings and Mario ----
def rec(sd, secs=None):
    x = A.GameAudio(f'{REC}/{sd}').x
    i = int(np.argmax(np.abs(x).max(1) > 0.004))
    x = x[i:] if secs is None else x[i:i + int(secs * SR)]
    return x.copy()
_vox = {}
def vox(code, at, g=1.0, cut=None):
    if code not in _vox: _vox[code] = load(f'{VOX}/{code}.aiff')
    x = _vox[code] if cut is None else _vox[code][: int(cut * SR)]
    put('vox', x, at, g)
def vox_dur(code):
    if code not in _vox: _vox[code] = load(f'{VOX}/{code}.aiff')
    return len(_vox[code]) / SR / BEAT

sweeps, gaps = [], []          # (b0, b1, hz0, hz1): the music low-passed; (b0, b1): the music held silent

# ---------------- the arrangement ----------------
b = S['cold']                   # the original intro on an old TV
x = rec('seq_03', 3.0)
x = lp(hp(x, 380), 2400, 4) * 4.0
cr = np.zeros(len(x), np.float32); cr[rng.integers(0, len(x), 300)] = rng.uniform(-0.3, 0.3, 300)
x += st(lp(cr[:, None].repeat(1, 1)[:, 0], 5000)) * 0.6
x[: int(0.25 * SR)] *= np.linspace(0, 1, int(0.25 * SR))[:, None]
x[-int(0.12 * SR):] *= np.linspace(1, 0, int(0.12 * SR))[:, None]
put('orig', x, b)
rise(S['title'], 1.6, 0.55)

b = S['title']                  # the same intro as the remix
impact(b, True)
vox('0C', b + 0.15, 0.9)                                   # "Here we go!"
intro = part(BOB, [(0, 0)], 0, 6)
play('lead', intro, b, lead, 0.42)
play('bell', intro, b, bell, 0.22, 12)
notes808(part(BOB, [(6, 0)], 0, 6), b, 0.9, -12, end=b + 6)
drums(b, 6, 'half', fill=False)
roll(b + 6, 1.0, 0.35)

b = S['bw_ui']                  # Bowser's riff, low, under the typing
riff = part(BOW, [(1, 0), (1, 1)], 9.5, 19.5)
play('lead', riff, b, organ, 0.3)
notes808(part(BOW, [(2, 0), (2, 1)], 9.5, 19.5), b, 0.55, 0, end=b + 10)
for k in (0, 4, 8): put('kick', kick, b + k, 0.75)
for k in range(8, 36): put('hat', hat, b + 1 + k / 2 - 3, 0.12 if k % 2 else 0.18)
sweeps.append((b, b + 10, 320, 3500))
roll(b + 10, 2.0, 0.55); rise(b + 10, 2.5, 0.6)
gaps.append((b + 9.75, b + 10))

b = S['bw']                     # the riff on 808s; slow motion from beat 10; the boom on the shatter (13)
impact(b, True)
riff = part(BOW, [(1, 0), (1, 1)], 9.5, 19.5)
play('lead', riff, b, supersaw, 0.26, 12)
play('lead', riff, b, organ, 0.24)
notes808(part(BOW, [(2, 0), (2, 1)], 9.5, 19.5), b, 1.0, 0, end=b + 10)
drums(b, 10, 'full', fill=False)
put('808', b808(33, 3, 0.8, glide=21), b + 10); put('kick', kick, b + 10, 0.9)
play('pad', [(0, 50, 3), (0, 53, 3), (0, 57, 3)], b + 10, pad, 0.22)
sweeps.append((b + 10, b + 13, 450, 900))
rise(b + 13, 1.5, 0.7)
impact(b + 13, True)
riff2 = part(BOW, [(1, 0), (1, 1)], 9.5, 13.5)
play('lead', riff2, b + 13, supersaw, 0.3, 12)
play('lead', riff2, b + 13, organ, 0.24)
notes808(part(BOW, [(2, 0), (2, 1)], 9.5, 13.5), b + 13, 1.0, 0, end=b + 17)
drums(b + 13, 4, 'full', fill=False)
roll(b + 17, 1.0, 0.4)

b = S['city_ui']                # the flood: Dire Dire Docks, muffled
def docks(at, b0, b1, g=1.0):
    play('bell', part(DDD, [(14, 0), (14, 1)], b0, b1), at, bell, 0.28 * g)
    play('lead', part(DDD, [(0, 0), (0, 1)], b0, b1), at, softlead, 0.2 * g)
    play('pad', part(DDD, [(15, 0), (15, 1)], b0, b1), at, pad, 0.16 * g, 12)
    notes808(part(DDD, [(15, 0)], b0, b1), at, 0.45 * g, 0, end=at + b1 - b0)
docks(b, 0.42, 8.42)
for k in (0, 4): put('kick', kick, b + k, 0.6)
sweeps.append((b, b + 8, 1100, 1400))

b = S['city']                   # the wipe at 3.33: the puzzle jingle; the city back to life at 4.5
docks(b, 8.42, 12.92, 0.8)
sweeps.append((b, b + 4.5, 900, 1800))
put('orig', rec('seq_1b', 3.0), b + 10 / 3, 0.9)
play('lead', part(BOB, [(7, 0)], 7.5, 8), b + 4.0, lead, 0.42)
rise(b + 4.5, 1.2, 0.5)
d = b + 4.5
impact(d, True)
vox('04', 51.8, 0.95)                                       # "Yahoo!" (edit5 marks it at 25.9 s)
mel = part(BOB, [(7, 0)], 8, 21.5)
play('lead', mel, d, lead, 0.46)
play('lead', mel, d, supersaw, 0.07, 12)
play('bell', part(BOB, [(7, 1)], 8, 21.5), d, bell, 0.16)
play('bell', part(BOB, [(8, 0)], 8, 21.5), d, pluck, 0.09)
k = drums(d, 13.5, 'full')
follow808(k, d, part(BOB, [(6, 0)], 8, 21.5), d + 13.5, 0.95)

b = S['sg_ui']                  # the wing cap, filtered
play('bell', part(WING, [(0, 0), (0, 1), (0, 2)], 0, 6), b, pluck, 0.13)
play('bell', part(WING, [(4, 0)], 0, 6), b, pluck, 0.12, -12)
for k in (0, 4): put('kick', kick, b + k, 0.7)
for k in range(12): put('hat', hat, b + k / 2, 0.14)
sweeps.append((b, b + 6, 600, 5000))
roll(b + 6, 2.0, 0.5); rise(b + 6, 2.0, 0.55)

b = S['sg']                     # the wing cap
impact(b, True)
play('lead', part(WING, [(0, 1)], 8, 16), b, lead, 0.42)
play('bell', part(WING, [(0, 2)], 8, 16), b, pluck, 0.16)
play('bell', part(WING, [(4, 0)], 8, 16), b, bell, 0.07, -12)
k = drums(b, 8, 'full')
notes808(part(WING, [(1, 0), (1, 1)], 8, 16), b, 0.95, 0, end=b + 8)

b = S['sub_ui']                 # Dire Dire Docks
docks(b, 24.42, 31.42)
for k in (0, 4): put('kick', kick, b + k, 0.65)
for k in range(6, 14): put('hat', hat, b + k / 2, 0.12)
sweeps.append((b, b + 7, 1200, 6000))
roll(b + 7, 1.5, 0.35); rise(b + 7, 1.5, 0.45)

b = S['sub']                    # Dire Dire Docks in half time; under water on the dive
impact(b)
play('lead', part(DDD, [(0, 0), (0, 1)], 8.42, 22.42), b, supersaw, 0.2)
play('bell', part(DDD, [(0, 0), (0, 1)], 8.42, 22.42), b, bell, 0.1, 12)
play('bell', part(DDD, [(14, 0), (14, 1)], 8.42, 22.42), b, bell, 0.3)
play('pad', part(DDD, [(15, 1)], 8.42, 22.42), b, pad, 0.15, 12)
notes808(part(DDD, [(15, 0)], 8.42, 22.42), b, 0.95, 0, end=b + 14)
drums(b, 14, 'half')
sweeps.append((b + 9.3, b + 14, 650, 1400))

b = S['kt_ui']                  # the metal cap riff, then its intro
play('lead', part(METAL, [(0, 0), (0, 1)], 4, 7), b, lead, 0.25)
sweeps.append((b, b + 3, 500, 1500))
play('lead', part(METAL, [(3, 0), (3, 1), (12, 0)], 0, 4), b + 3, lead, 0.3)
put('kick', kick, b, 0.7)
for k in range(6, 14): put('hat', hat, b + k / 2, 0.15)
roll(b + 7, 2.0, 0.55); rise(b + 7, 2.0, 0.55)
gaps.append((b + 6.75, b + 7))

b = S['kt']                     # the metal cap
impact(b, True)
vox('02', b + 0.1, 0.9)                                     # "Yah!"
play('lead', part(METAL, [(3, 0), (3, 1)], 12, 19), b, lead, 0.42)
play('lead', part(METAL, [(3, 0)], 12, 19), b, supersaw, 0.08, 12)
play('bell', part(METAL, [(0, 0), (0, 1)], 12, 19), b, pluck, 0.13)
play('bell', part(METAL, [(2, 0)], 12, 19), b, pluck, 0.07)
drums(b, 7, 'full')
notes808(part(METAL, [(1, 0)], 12, 19), b, 0.95, 0, end=b + 7)

b = S['race_ui']                # the slide intro
play('lead', part(SLIDE, [(2, 0)], 0, 7), b, lead, 0.28)
play('bell', part(SLIDE, [(2, 0)], 0, 7), b, bell, 0.12, 12)
notes808(part(SLIDE, [(6, 0)], 0, 7), b, 0.5, -12, end=b + 7)
for k in (0, 4): put('kick', kick, b + k, 0.7)
for k in range(4, 14): put('hat', hat, b + k / 2, 0.15)
sweeps.append((b, b + 7, 600, 6000))
roll(b + 7, 2.0, 0.55); rise(b + 7, 2.0, 0.55)
vox('1A', b + 7 - vox_dur('1A') + 0.1, 0.95)                 # "Let's-a go!"
gaps.append((b + 6.6, b + 7))

b = S['race']                   # the slide
impact(b, True)
play('lead', part(SLIDE, [(4, 0)], 8, 24), b, lead, 0.46)
play('lead', part(SLIDE, [(4, 0)], 8, 24), b, supersaw, 0.07, 12)
play('bell', part(SLIDE, [(2, 0)], 8, 24), b, bell, 0.18, 12)
play('bell', part(SLIDE, [(0, 0)], 8, 24), b, pluck, 0.06)
play('bell', part(SLIDE, [(5, 0)], 8, 24), b, pluck, 0.1)
k = drums(b, 16, 'full')
follow808(k, b, part(SLIDE, [(6, 0)], 8, 24), b + 16, 0.95)

b = S['slogan']                 # the promise on bells; the finale on "is now possible" (+50 frames)
play('bell', part(BOB, [(0, 0)], 0, 3.3), b, bell, 0.28, 12)
play('pad', [(0, 48, 3.3), (0, 52, 3.3), (0, 55, 3.3)], b, pad, 0.2)
put('808', b808(36, 3.3, 0.45), b)
h = b + 10 / 3
for q in range(4): vox('02', h - 0.5 + q / 8, 0.5 + 0.1 * q, cut=0.07)   # "ya-ya-ya-"
rise(h, 1.6, 0.6)
play('lead', part(BOB, [(7, 0)], 7.5, 8, 2), h - 0.5, lead, 0.45)
impact(h, True)
vox('19', h, 1.0)                                           # "Yippee!"
fin = part(BOB, [(7, 0)], 8, 17.67, 2)
play('lead', fin, h, lead, 0.5)
play('lead', fin, h, supersaw, 0.12, 12)
play('bell', fin, h, bell, 0.06, 24)
play('bell', part(BOB, [(7, 1)], 8, 17.67, 2), h, bell, 0.18)
play('bell', part(BOB, [(8, 0)], 8, 17.67, 2), h, pluck, 0.1)
k = drums(h, S['end'] - h, 'full', fill=False)
follow808(k, h, part(BOB, [(6, 0)], 8, 17.67, 2), S['end'], 1.0)
roll(S['end'], 1.0, 0.45); rise(S['end'], 1.4, 0.5)

b = S['end']                    # the star jingle from the game
impact(b, True)
put('orig', rec('seq_01', 6.0), b, 2.2)
tail = b + 5                    # under the jingle's last chord (C major) and held to the end: it stops dead
play('pad', [(0, 48, 6), (0, 55, 6), (0, 60, 6), (0, 64, 6)], tail, pad, 0.32)
play('bell', [(0.5, 72, 4), (1.0, 76, 3.5), (1.5, 79, 3), (2.0, 84, 2.5)], tail, bell, 0.12)
put('808', b808(24, 5, 0.4), tail + 0.5)

# ---- mixdown ----
def verb(x, secs=1.8, wet=0.25):
    n = int(secs * SR)
    ir = (rng.standard_normal((n, 2)) * np.exp(-np.linspace(0, 7, n))[:, None]).astype(np.float32) * 0.03
    w = np.stack([fftconvolve(hp(x, 300)[:, c], ir[:, c])[: len(x)] for c in range(2)], 1).astype(np.float32)
    return x + wet * w
def delay(x, secs=0.375, fb=0.3, wet=0.16):
    d = int(secs * SR); y = np.zeros_like(x); src = hp(x, 500)
    for k in range(1, 5):
        sh = d * k
        if sh >= len(x): break
        g = wet * fb ** (k - 1)
        c = (k % 2)          # ping-pong
        y[sh:, c] += src[:-sh, 0 if c else 1] * g
    return x + y

B['lead'] = verb(delay(lp(B['lead'], 9000)), 1.6, 0.28)
B['bell'] = verb(delay(B['bell'], wet=0.12), 2.2, 0.4)
B['pad'] = verb(hp(B['pad'], 150), 2.5, 0.5)
B['808'] = lp(B['808'], 3500)
B['vox'] = verb(hp(B['vox'], 120), 1.4, 0.22)
B['orig'] = verb(B['orig'], 1.2, 0.15)
kenv = np.abs(B['kick']).max(1)
win = int(0.14 * SR)
duck = np.convolve((kenv > 0.25).astype(np.float32), np.exp(-np.linspace(0, 4, win)), 'full')[:N]
duck = 1 - np.clip(duck / (duck.max() + 1e-9) * 3, 0, 1)
for bus, depth in (('pad', 0.5), ('lead', 0.18), ('bell', 0.25)):
    B[bus] *= (1 - depth + depth * duck)[:, None]

GAIN = {'kick': 1.0, 'snare': 1.3, 'hat': 3.0, '808': 0.4, 'lead': 1.9, 'bell': 1.3, 'pad': 0.8, 'fx': 0.7,
        'vox': 1.4, 'orig': 1.0}
music = sum(B[k] * GAIN[k] for k in BUSES if k not in ('vox', 'orig', 'fx'))
for b0, b1, h0, h1 in sweeps:  # filtered stretches, opening up at the end of each
    a, z = int(b0 * BEAT * SR), int(b1 * BEAT * SR)
    seg, out = music[a:z], np.empty_like(music[a:z])
    zi = np.zeros((2, 2, 2)); blk = 256
    for s in range(0, len(seg), blk):
        f = h0 * (h1 / h0) ** (s / max(1, len(seg)))
        sos = butter(4, f, 'low', fs=SR, output='sos')
        out[s:s + blk], zi = sosfilt(sos, seg[s:s + blk], axis=0, zi=zi)
    music[a:z] = out
for b0, b1 in gaps:
    a, z = int(b0 * BEAT * SR), int(b1 * BEAT * SR); f = int(0.008 * SR)
    g = np.ones(N, np.float32); g[a:z] = 0
    g[a - f:a] = np.linspace(1, 0, f); g[z:z + f] = np.linspace(0, 1, f)
    music *= g[:, None]
mix = music + B['fx'] * GAIN['fx'] + B['vox'] * GAIN['vox'] + B['orig'] * GAIN['orig']
scale = 1 / (np.abs(mix).max() + 1e-9)
mix = np.tanh(mix * scale * 1.6) / np.tanh(1.6)
mix *= 0.89 / (np.abs(mix).max() + 1e-9)
end = int((TOTAL * BEAT + 2.0) * SR)
mix = mix[:end]
mix[-int(2.0 * SR):] *= np.linspace(1, 0, int(2.0 * SR))[:, None] ** 1.5
out = sys.argv[1] if len(sys.argv) > 1 else 'music_trap.wav'
wavfile.write(out, SR, (mix * 32767).astype(np.int16))
if os.environ.get('STEMS'):
    for k in BUSES:
        y = np.clip(B[k][:end] * GAIN[k] * scale, -1, 1)   # as loud as in the mix (before the soft clip)
        wavfile.write(out.replace('.wav', f'_{k}.wav'), SR, (y * 32767).astype(np.int16))
print('wrote', round(len(mix) / SR, 2), 's; sections at', {k: v * BEAT for k, v in S.items()})
