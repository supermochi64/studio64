"""The trailer's sound: the score (music.py), the game's own sound from the fight capture's audio
tap, and designed CC0 sound effects, placed from the cut's timeline.json; mastered to -14 LUFS.
    uv run --with numpy --with scipy --with soxr --with pyloudnorm python promo/scripts/mix.py <timeline.json> <music.wav> <out.wav>"""
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
dur = N / FPS + 0.5
M = A.Mix(dur)
fr = lambda f: f / FPS
rnd = random.Random(64)
S = {}
def s(name):
    if name not in S:
        p = name if name.startswith('/') else f'{SFX}/{name}'
        S[name] = A.load(p)
    return S[name]

# ---- the game's own sound (Mario, Bowser, the mines) from the main pass's tap ----
game = A.GameAudio(f'{ROOT}/promo/work/cap/fight/main')
for (o0, o1, pas, s0, speed) in TL['game']:
    n_out = o1 - o0
    src_n = max(1, round(n_out * speed))
    x = game.span(int(round(s0)), int(round(s0)) + src_n)
    if len(x) == 0:
        continue
    want = int(n_out / FPS * SR)
    if abs(speed - 1) > 0.02:
        if speed < 1:          # slow motion: the sound slows down with the picture (deep voice)
            x = A.repitch(x, rate=len(x) / max(1, want))
        else:                  # sped-up picture: keep the sound at its own pitch, just trim
            x = game.span(int(round(s0)), int(round(s0)) + n_out)
    x = x[:want]
    M.add('game', x, fr(o0), gain_db=0, fade_in=0.006, fade_out=0.02)
# Bowser's arrival in the studio's stage (UI shot): the puff and the roar, a little smaller
M.add('game', game.span(0, 24), fr(TL['bowser_ui']), gain_db=-7)

# ---- designed sound ----
boom = s('cine_hit_fs754421_00.wav'); expl = s('war_explosion_fs741173_00.wav'); sub = s('sonicboom_fs816376_00.wav')
deb = s('rubble_fs550342_04.wav'); spawnw = s('teleport_fs422730_00.wav'); magic = s('teleport_fs715784_00.wav')
fire = s('flyby_fs683179_00.wav'); pop = s('click_fs788052_00.wav'); pop2 = s('click_fs237343_00.wav')
logo_hit = s('cine_hit_fs255111_00.wav')
wh_fast = s(f'{ROOT}/promo/work/sfx_dl/fs400372.ogg'); wh_light = s(f'{ROOT}/promo/work/sfx_dl/fs701104.ogg')
wh_low = s(f'{ROOT}/promo/work/sfx_dl/fs398638.ogg')
rewind = A.load(f'{KIT}/fx/fs842582.ogg')
keys = [A.load(f'{ROOT}/promo/work/audio/key_{k:02d}.wav') for k in range(40)]

# the hook: the flight, the blast, the rewind
M.add('sfx', fire, fr(14) - 0.05, gain_db=-6)
M.add('sfx', A.repitch(wh_low, -3), fr(16), gain_db=-8)
for x, g in ((sub, -2), (boom, -1), (expl, -3)):
    M.add('sfx', x[:int(1.0 * SR)], fr(30), gain_db=g, fade_out=0.45)   # the hook's blast must not rumble on under the studio
M.add('sfx', deb[:int(0.6 * SR)], fr(32), gain_db=-12, fade_out=0.3)
M.add('sfx', rewind, fr(38), gain_db=-3)
M.add('sfx', A.repitch(rewind, -5), fr(42), gain_db=-6)
# into the studio
M.add('sfx', wh_light, fr(48) - 0.25, gain_db=-10)
# typing: one real keystroke each, never the same one twice in a row, a little variation
last = -1
for t in TL['keys']:
    k = rnd.randrange(40)
    while k == last:
        k = rnd.randrange(40)
    last = k
    M.add('ui', A.repitch(keys[k], rnd.uniform(-0.6, 0.6)), fr(t), gain_db=rnd.uniform(-9, -5))
M.add('ui', A.repitch(keys[3], -2.5), fr(TL['enter']), gain_db=-2)
M.add('ui', wh_light, fr(TL['enter']) + 0.02, gain_db=-12)
for t in TL['cards']:
    M.add('ui', pop, fr(t), gain_db=-8)
M.add('sfx', spawnw, fr(TL['toast']) - 0.1, gain_db=-7)
# the drop: his arrival, full screen
M.add('sfx', sub, fr(TL['drop']), gain_db=-3)
M.add('sfx', A.repitch(magic, -4), fr(TL['drop']) - 0.05, gain_db=-8)
# the grab
M.add('sfx', A.repitch(wh_fast, -2), fr(384), gain_db=-10)
# release and flight: Mario's own "So long-a Bowser!" (the game's voice sample), then the flight in slow motion
solong = A.load(f'{ROOT}/promo/work/audio/so_longa_bowser.aiff')
M.add('game', solong, fr(TL['release_out']), gain_db=-1)
M.add('sfx', A.repitch(solong, -9)[int(0.5 * SR):], fr(468), gain_db=-12, fade_in=0.2)   # a deep echo under the slow motion
M.add('sfx', fire, fr(464), gain_db=-4)
M.add('sfx', A.repitch(wh_low, -5), fr(466), gain_db=-6)
# BOOM
b = TL['boom']
for x, g in ((sub, 0), (boom, 0), (expl, -1)):
    M.add('sfx', x, fr(b), gain_db=g)
M.add('sfx', A.repitch(expl, -4), fr(b) + 0.05, gain_db=-6)
M.add('sfx', deb, fr(b) + 0.15, gain_db=-9)
# the montage: a quick whoosh into every picture
for j in range(6):
    M.add('sfx', A.repitch(wh_fast, rnd.uniform(-1, 2)), fr(TL['montage'] + 16 * j) - 0.06, gain_db=-14)
# the end card: the logo lands
M.add('sfx', logo_hit, fr(TL['end']), gain_db=-4)

# ---- the music, ducked under the big moments ----
mus = np.zeros((M.n, 2), np.float32)
mus[:min(len(music), M.n)] = music[:M.n]
duck = np.ones(M.n, np.float32)
def dip(t0, t1, db):
    a, b2 = int(t0 * SR), int(t1 * SR)
    g = 10 ** (db / 20)
    ramp = int(0.08 * SR)
    duck[a:b2] = np.minimum(duck[a:b2], g)
    duck[max(0, a - ramp):a] = np.minimum(duck[max(0, a - ramp):a], np.linspace(1, g, min(ramp, a)))
    duck[b2:b2 + ramp] = np.minimum(duck[b2:b2 + ramp], np.linspace(g, 1, len(duck[b2:b2 + ramp])))
dip(fr(240), fr(262), -4)           # the roar
dip(fr(462), fr(480), -3)           # "so long-a Bowser"
dip(fr(480), fr(492), -5)           # the blast
M.bus['music'] = mus * duck[:, None]

GAINS = {'music': -1.5, 'game': -2.0, 'sfx': -3.0, 'ui': 0.0}
if os.environ.get('STEMS'):
    for k, b in M.bus.items():
        wavfile.write(f'{os.path.dirname(OUT)}/stem_{k}.wav', SR, (np.clip(b * 10 ** (GAINS[k] / 20), -1, 1) * 32767).astype(np.int16))
mix = M.render(gains=GAINS)
mix = mix[:int(N / FPS * SR) + int(0.2 * SR)]
fade = int(1.2 * SR)
mix[-fade:] *= np.linspace(1, 0, fade)[:, None] ** 2
mix, lufs = A.master(mix, -14.0, -1.2)
wavfile.write(OUT, SR, (np.clip(mix, -1, 1) * 32767).astype(np.int16))
print('wrote', OUT, f'{len(mix) / SR:.2f}s', f'{lufs:.2f} LUFS', 'peak', f'{20 * np.log10(np.abs(mix).max()):.2f} dBFS')
