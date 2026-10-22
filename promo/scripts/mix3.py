"""Sound for trailer v3 (edit3.py's timeline.json): the score, the game's own sound from every beat's
audio tap, designed CC0 effects; mastered to -14 LUFS.
    uv run --with numpy --with scipy --with soxr --with pyloudnorm python promo/scripts/mix2.py <timeline.json> <music.wav> <out.wav>"""
import json, os, sys, random
import numpy as np
from scipy.io import wavfile
sys.path.insert(0, os.path.dirname(__file__))
import audio as A
from audio import SR, FPS

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SFX = f'{ROOT}/promo/work/audio/sfx'
KIT = os.environ.get('PHONK_KIT', os.path.expanduser('~/Documents/slop/assets/music/phonk_kit'))
TL = json.load(open(sys.argv[1]))
music = A.load(sys.argv[2])
OUT = sys.argv[3]
N = TL['N']
M = A.Mix(N / FPS + 0.5)
fr = lambda f: f / FPS
rnd = random.Random(64)
S = {}
def s(name):
    if name not in S:
        S[name] = A.load(name if name.startswith('/') else f'{SFX}/{name}')
    return S[name]

# ---- the game's own sound: each beat's tap, placed under its picture ----
taps = {}
for (o0, o1, d, s0, speed) in TL['game']:
    g = taps.setdefault(d, A.GameAudio(d))
    n_out = o1 - o0
    want = int(n_out / FPS * SR)
    if abs(speed - 1) > 0.02 and speed < 1:          # slow motion: the sound slows down with the picture
        x = g.span(int(round(s0)), int(round(s0)) + max(1, round(n_out * speed)))
        x = A.repitch(x, rate=len(x) / max(1, want))
    else:                                             # 1x, or a sped-up picture with its sound at its own pitch
        x = g.span(int(round(s0)), int(round(s0)) + n_out)
    if len(x):
        M.add('game', x[:want], fr(o0), fade_in=0.006, fade_out=0.02)

boom = s('cine_hit_fs754421_00.wav'); expl = s('war_explosion_fs741173_00.wav'); sub = s('sonicboom_fs816376_00.wav')
deb = s('rubble_fs550342_04.wav'); spawnw = s('teleport_fs422730_00.wav'); magic = s('teleport_fs715784_00.wav')
fire = s('flyby_fs683179_00.wav'); pop = s('click_fs788052_00.wav'); logo_hit = s('cine_hit_fs255111_00.wav')
rev = s('carrev_fs113187_00.wav'); squeal = s('tiresqueal_fs71739_00.wav'); peel = s('tiresqueal_fs271337_00.wav'); passby = s('carpass_fs465397_00.wav')
wh_fast = s(f'{ROOT}/promo/work/sfx_dl/fs400372.ogg'); wh_light = s(f'{ROOT}/promo/work/sfx_dl/fs701104.ogg')
wh_low = s(f'{ROOT}/promo/work/sfx_dl/fs398638.ogg')
rewind = A.load(f'{KIT}/fx/fs842582.ogg')
keys = [A.load(f'{ROOT}/promo/work/audio/key_{k:02d}.wav') for k in range(40)]
solong = A.load(f'{ROOT}/promo/work/audio/so_longa_bowser.aiff')

# the prompts: a real keystroke per letter, Enter, the cards
last = -1
for t in TL['keys']:
    k = rnd.randrange(40)
    while k == last:
        k = rnd.randrange(40)
    last = k
    M.add('ui', A.repitch(keys[k], rnd.uniform(-0.6, 0.6)), fr(t), gain_db=rnd.uniform(-9, -5))
for t in TL['enters']:
    M.add('ui', A.repitch(keys[3], -2.5), fr(t), gain_db=-2)
    M.add('ui', wh_light, fr(t) + 0.02, gain_db=-13)
for t in TL['cards']:
    M.add('ui', pop, fr(t), gain_db=-8)
for t in TL['results']:
    M.add('sfx', spawnw, fr(t) - 0.08, gain_db=-8)
# every payoff lands on a drop: a sub hit + a whoosh into it
for t in TL['drops']:
    M.add('sfx', sub[:int(1.4 * SR)], fr(t), gain_db=-5, fade_out=0.5)
    M.add('sfx', A.repitch(magic, -4), fr(t) - 0.05, gain_db=-11)
# the car: the hop in, the launch with revs and wheelspin, the drift squeal, driving off
c = TL['car']
M.add('sfx', rev[:int(1.6 * SR)], fr(c['launch']) - 0.15, gain_db=-7, fade_out=0.4)
M.add('sfx', peel[:int(1.2 * SR)], fr(c['launch']), gain_db=-9, fade_out=0.3)
M.add('sfx', squeal[:int(1.3 * SR)], fr(c['drift']) + 0.1, gain_db=-8, fade_in=0.05, fade_out=0.3)
M.add('sfx', passby[:int(1.4 * SR)], fr(c['away']) - 0.4, gain_db=-12, fade_out=0.4)
# the shotgun: weight under the first blast (it plays in half speed)
for t in TL['shots'][:1]:
    M.add('sfx', sub[:int(0.9 * SR)], fr(t), gain_db=-9, fade_out=0.4)
    M.add('sfx', A.repitch(boom, 3)[:int(0.8 * SR)], fr(t), gain_db=-14, fade_out=0.3)
# the katana: a whoosh into each cut
for t in TL['slashes']:
    M.add('sfx', A.repitch(wh_fast, 3), fr(t) - 0.05, gain_db=-11)
# Bowser: the voice, the flight, the blast
M.add('game', solong, fr(TL['release_out']), gain_db=-1)
M.add('sfx', A.repitch(solong, -9)[int(0.5 * SR):], fr(TL['release_out'] + 10), gain_db=-12, fade_in=0.2)
M.add('sfx', fire, fr(TL['boom'] - 34), gain_db=-4)
M.add('sfx', A.repitch(wh_low, -5), fr(TL['boom'] - 30), gain_db=-6)
b = TL['boom']
for x, g in ((sub, 0), (boom, 0), (expl, -1)):
    M.add('sfx', x, fr(b), gain_db=g)
M.add('sfx', A.repitch(expl, -4), fr(b) + 0.05, gain_db=-6)
M.add('sfx', deb, fr(b) + 0.15, gain_db=-9)
M.add('sfx', A.repitch(wh_low, -2), fr(TL['title']) - 0.1, gain_db=-12)
M.add('sfx', logo_hit, fr(TL['end']), gain_db=-4)

# ---- the music, ducked under the big moments ----
mus = np.zeros((M.n, 2), np.float32)
mus[:min(len(music), M.n)] = music[:M.n]
duck = np.ones(M.n, np.float32)
def dip(t0, t1, db):
    a, b2 = int(t0 * SR), int(t1 * SR); g = 10 ** (db / 20); ramp = int(0.08 * SR)
    duck[a:b2] = np.minimum(duck[a:b2], g)
    duck[max(0, a - ramp):a] = np.minimum(duck[max(0, a - ramp):a], np.linspace(1, g, min(ramp, a)))
    duck[b2:b2 + ramp] = np.minimum(duck[b2:b2 + ramp], np.linspace(g, 1, len(duck[b2:b2 + ramp])))
dip(fr(TL['drops'][3]), fr(TL['drops'][3] + 22), -4)
dip(fr(TL['release_out'] - 1), fr(TL['boom']), -3)
dip(fr(TL['boom']), fr(TL['boom'] + 12), -5)
M.bus['music'] = mus * duck[:, None]
GAINS = {'music': -1.5, 'game': -2.0, 'sfx': -3.0, 'ui': 0.0}
if os.environ.get('STEMS'):
    for k, bb in M.bus.items():
        wavfile.write(f'{os.path.dirname(OUT)}/stem3_{k}.wav', SR, (np.clip(bb * 10 ** (GAINS[k] / 20), -1, 1) * 32767).astype(np.int16))
mix = M.render(gains=GAINS)
mix = mix[:int(N / FPS * SR) + int(0.3 * SR)]
fade = int(1.0 * SR)                        # (the picture fades to black over the last second too)
mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
mix, lufs = A.master(mix, -14.0, -1.2)
wavfile.write(OUT, SR, (np.clip(mix, -1, 1) * 32767).astype(np.int16))
print('wrote', OUT, f'{len(mix) / SR:.2f}s', f'{lufs:.2f} LUFS', 'peak', f'{20 * np.log10(np.abs(mix).max()):.2f} dBFS')
