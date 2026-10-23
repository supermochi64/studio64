"""Trailer v5: six "type it -> play it" beats at trailer pace (120 BPM, a beat = 15 frames): Bowser through
Peach's window, the sunken city reborn, a shotgun on its rooftops, Bowser's sub, a katana in Tokyo, a road and a
race up Bob-omb Battlefield; then the promise and the end card.
    ~/.local/venvs/m64/bin/python promo/v5/edit5.py frames OUTDIR [half] [a:b] [workers]"""
import json, math, os, sys
from multiprocessing import Pool
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'scripts'))
import gfx
from gfx import W, H, caption, ease_out, ease_back, band
from edit import view, flash, shake, smooth, UISrc
from edit2 import ui_marks

WORK5 = os.path.join(HERE, '..', 'work5')
CAP = os.path.join(HERE, '..', 'work', 'cap')
BEAT = 15
SEGS = [('cold', 6), ('title', 6), ('bw_ui', 10), ('bw', 17), ('city_ui', 8), ('city', 18), ('sg_ui', 6), ('sg', 8),
        ('sub_ui', 7), ('sub', 14), ('kt_ui', 7), ('kt', 7), ('race_ui', 7), ('race', 16), ('slogan', 13), ('end', 10)]
GAME = {'bw', 'city', 'sg', 'sub', 'kt', 'race'}
UIS = {'city_ui': 'city', 'sg_ui': 'shotgun', 'sub_ui': 'sub', 'kt_ui': 'katana', 'race_ui': 'race'}

# how each source is graded: (saturation, contrast, brightness, tint)
GRADE = {
    'city_before': (0.42, 1.02, 0.74, (0.86, 0.97, 1.06)), 'city_after': (1.2, 1.06, 1.04, (1.04, 1.0, 0.93)),
    'city_plaza': (1.2, 1.06, 1.04, (1.04, 1.0, 0.93)), 'city_crane': (1.2, 1.06, 1.04, (1.04, 1.0, 0.93)),
    'city_shotgun': (1.18, 1.06, 1.03, (1.03, 1.0, 0.95)),
    'sub_pipe': (1.12, 1.08, 1.32, (1.0, 1.0, 1.04)), 'sub_depart': (1.12, 1.08, 1.32, (1.0, 1.0, 1.04)), 'sub_dive': (1.15, 1.1, 1.25, (0.95, 1.0, 1.08)),
    'tokyo_katana': (1.14, 1.08, 1.04, (1.03, 0.98, 1.04)),
    'race_road': (1.12, 1.05, 1.02, None), 'race_roadwide': (1.12, 1.05, 1.02, None), 'race_start': (1.12, 1.05, 1.02, None), 'race_chase': (1.12, 1.05, 1.02, None),
    'bw_main': (1.1, 1.05, 1.02, None), 'bw_impact': (1.12, 1.06, 1.02, None), 'bw_impact2': (1.12, 1.06, 1.02, None), 'fight_main': (1.1, 1.05, 1.02, None),
}

class Pass:
    """a filmed pass: frames 0000.jpg.. (2560x1440), graded on load"""
    def __init__(self, name, d=None, digits=4):
        self.name, self.dir, self.digits = name, d or os.path.join(WORK5, name), digits
        self.files = sorted(x for x in os.listdir(self.dir) if x.endswith('.jpg') and x[:-4].isdigit())
        self.idx = [int(x[:-4]) for x in self.files]
        self.cache = {}
    def get(self, f):
        f = int(max(self.idx[0], min(self.idx[-1], f)))
        if f not in self.cache:
            i = min(range(len(self.idx)), key=lambda k: abs(self.idx[k] - f))
            im = Image.open(os.path.join(self.dir, self.files[i])).convert('RGB')
            if im.width != W:
                im = im.resize((W, H), Image.LANCZOS)
            g = GRADE.get(self.name)
            if g:
                im = grade(im, *g)
            if len(self.cache) > 16:
                self.cache.clear()
            self.cache[f] = im
        return self.cache[f]
    def blend(self, s):
        a = math.floor(s); t = s - a
        if t < 0.05: return self.get(a)
        if t > 0.95: return self.get(a + 1)
        return Image.blend(self.get(a), self.get(a + 1), t)

def grade(im, sat, con, bright, tint=None):
    if sat != 1: im = ImageEnhance.Color(im).enhance(sat)
    if con != 1: im = ImageEnhance.Contrast(im).enhance(con)
    if bright != 1: im = ImageEnhance.Brightness(im).enhance(bright)
    if tint:
        a = np.asarray(im).astype(np.float32) * np.array(tint, np.float32)
        im = Image.fromarray(a.clip(0, 255).astype(np.uint8))
    return im

def zoom(img, z, cx=0.5, cy=0.5):
    if abs(z - 1) < 1e-3: return img
    return view(img, img.width * cx, img.height * cy, img.width / z)

def mblur(img, dx, n=7):
    """directional (horizontal) blur: dx pixels"""
    if abs(dx) < 1: return img
    a = np.asarray(img.convert('RGB')).astype(np.float32)
    acc = np.zeros_like(a)
    for k in range(n):
        acc += np.roll(a, int(dx * (k / (n - 1) - 0.5)), axis=1)
    return Image.fromarray((acc / n).astype(np.uint8))

def rblur(img, amt, cx=0.5, cy=0.5, n=6):
    """zoom blur toward (cx, cy): amt = the strongest scale step"""
    if amt < 0.004: return img
    acc = np.zeros((H, W, 3), np.float32)
    for k in range(n):
        acc += np.asarray(zoom(img.convert('RGB'), 1 + amt * k / (n - 1), cx, cy)).astype(np.float32)
    return Image.fromarray((acc / n).astype(np.uint8))

def vignette(img, s=0.32):
    yy, xx = np.mgrid[0:H, 0:W]
    r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
    m = (1 - s * np.clip(r - 0.55, 0, 1) ** 1.6)[..., None]
    return Image.fromarray((np.asarray(img.convert('RGB')).astype(np.float32) * m).astype(np.uint8))
_VIG = None
def vig(img):
    global _VIG
    if _VIG is None:
        yy, xx = np.mgrid[0:H, 0:W]
        r = np.sqrt(((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2)
        _VIG = (1 - 0.34 * np.clip(r - 0.5, 0, 1) ** 1.5)[..., None].astype(np.float32)
    return Image.fromarray((np.asarray(img.convert('RGB')).astype(np.float32) * _VIG).astype(np.uint8))

class UI5:
    """a staged chat capture (ui_cap.mjs): 3840x2160 frames with notes"""
    def __init__(self, name):
        self.dir = os.path.join(WORK5, f'ui_{name}')
        self.meta = json.load(open(f'{self.dir}/frames.json'))
        fr = self.meta['frames']
        notes = [f['note'] for f in fr]
        self.n = len(fr)
        self.k0 = next(i for i, x in enumerate(notes) if x in ('key', 'type'))
        self.k1 = max(i for i, x in enumerate(notes) if x == 'typed')
        self.enter = notes.index('enter')
        self.done = notes.index('done')
        self.cache = {}
    def full(self, i):
        i = int(max(0, min(self.n - 1, i)))
        if i not in self.cache:
            if len(self.cache) > 6: self.cache.clear()
            self.cache[i] = Image.open(f'{self.dir}/{i:04d}.jpg').convert('RGB')
        return self.cache[i]

def caption_band(img, k, k0, k1, lines, y=930, size=64, color=None):
    if not (k0 <= k < k1): return
    a = min(ease_out((k - k0) / 6), ease_out((k1 - k) / 6))
    band(img, y - 24, y + size + 30, 0.55 * a)
    caption(img, [(l, color) if color else l for l in lines], y + int(12 * (1 - a)), size=size, weight='Black', alpha=a)

class Cut5:
    def __init__(self):
        self.N = sum(b for _, b in SEGS) * BEAT
        self.p = {n: Pass(n) for n in ('bw_main', 'bw_impact', 'bw_impact2', 'city_before', 'city_after', 'city_plaza', 'city_crane',
                                        'city_shotgun', 'sub_pipe', 'sub_depart', 'sub_dive', 'tokyo_katana', 'race_road', 'race_start', 'race_chase')}
        self.p['fight_main'] = Pass('fight_main', os.path.join(CAP, 'fight', 'main'))
        self.castle = UISrc(os.path.join(CAP, 'ui'))
        self.mk = ui_marks(self.castle)
        class _Lazy(dict):
            def __missing__(d, k):
                d[k] = UI5(UIS[k]); return d[k]
        self.ui = _Lazy()
        self.sg_fires = json.load(open(os.path.join(WORK5, 'city_shotgun', 'events.json')))['fires']
        self.kt_fires = json.load(open(os.path.join(WORK5, 'tokyo_katana', 'events.json')))['fires']

    def seg(self, i):
        o = 0
        for name, b in SEGS:
            if i < o + b * BEAT:
                return name, i - o, b * BEAT
            o += b * BEAT
        return SEGS[-1][0], i - (o - SEGS[-1][1] * BEAT), SEGS[-1][1] * BEAT

    def start(self, name):
        o = 0
        for n, b in SEGS:
            if n == name: return o
            o += b * BEAT

    # ---- the chat beats ----
    def ui_frame(self, name, k, L):
        if name == 'bw_ui':
            return self.castle_frame(k, L)
        u = self.ui[name]
        lead, out = 6, 8
        T = int((L - lead - out) * 0.46)
        C = L - lead - out - T
        if k < lead:                       # the empty input box, zooming in
            t = smooth(k / lead)
            return view(u.full(u.k0 - 1), 3410 - 210 * (1 - t), 1960 - 260 * (1 - t), 870 + 520 * (1 - t))
        k -= lead
        if k < T:                          # typed (the capture's own rhythm, fitted to the beat)
            return view(u.full(u.k0 + (u.k1 - u.k0) * k / max(1, T - 1)), 3410, 1960, 870)
        k -= T
        if k < C + out:                    # sent: the turn, the cards
            n = u.enter + (u.done + 6 - u.enter) * min(1, k / max(1, C - 4))
            t = smooth(min(1, k / 6))
            return view(u.full(n), 3410 + (3385 - 3410) * t, 1960 + (430 - 1960) * t, 870 + (920 - 870) * t)

    def castle_frame(self, k, L):
        u, m = self.castle, self.mk
        lead, out = 8, 8
        T = 62; Hd = 6; Th = 10
        C = L - lead - out - T - Hd - Th
        typed = m['k1'] - m['k0'] + 1
        if k < lead:
            t = smooth(k / lead)
            return view(u.full(m['k0'] - 1), 3410 - 210 * (1 - t), 1960 - 260 * (1 - t), 870 + 520 * (1 - t))
        k -= lead
        if k < T:
            return view(u.full(m['k0'] + min(typed - 1, int(k * typed / T))), 3410, 1960, 870)
        k -= T
        if k < Hd:
            return view(u.full(m['k1'] + 1), 3410, 1960, 870)
        k -= Hd
        if k < Th:
            n = m['enter'] + 1 + round(k * (m['tools'] - m['enter'] - 2) / max(1, Th))
            return view(u.full(n), 3385, 430, 920)
        k -= Th
        n = min(m['spawn'], m['tools'] + 1 + int(k * (m['spawn'] - m['tools']) / max(1, C)))
        return view(u.full(n), 3385, 430, 920)

    # ---- the game beats: lists of (frames, source, first source frame, speed) ----
    SHOTS = {
        'bw': [(40, 'fight_main', 18, 1.0), (82, 'bw_main', 42, 1.0), (28, 'bw_main', 124, 1.0), (38, 'bw_impact2', 32, 1.0),
               (37, 'bw_impact', 58, 1.0), (30, 'bw_impact2', 78, 1.0)],
        'city': [(50, 'city_before', 0, 1.0), (20, 'wipe', 50, 1.0), (40, 'city_after', 70, 1.0), (70, 'city_plaza', 0, 1.0), (90, 'city_crane', 0, 1.0)],
        'sg': [(120, 'city_shotgun', 0, 1.0)],
        'sub': [(50, 'sub_pipe', 10, 1.0), (90, 'sub_depart', 8, 1.0), (70, 'sub_dive', 40, 1.0)],
        'kt': [(105, 'tokyo_katana', 0, 1.0)],
        'race': [(60, 'race_road', 0, 1.0), (95, 'race_start', 35, 1.0), (85, 'race_chase', 45, 1.0)],
    }
    CAPTIONS = {'city': (190, 268, ['Bring any level back to life.']), 'sg': (40, 112, ['Any weapon.']), 'sub': (110, 200, ['Drive anything.']),
                'kt': (40, 100, ['Any city. Any fight.']), 'race': (150, 232, ['Race anyone. Anywhere.'])}

    def game_frame(self, name, k):
        o = 0
        for n, src, s0, sp in self.SHOTS[name]:
            if k < o + n:
                j = k - o
                if src == 'wipe':
                    return self.wipe(s0 + j, j / n), (src, s0 + j)
                s = s0 + j * sp
                img = self.p[src].blend(s)
                return img, (src, s)
            o += n
        n, src, s0, sp = self.SHOTS[name][-1]
        return self.p[src].get(s0 + n * sp), (src, s0 + n * sp)

    def wipe(self, f, t):
        """the city comes back: a ring of light spreads from Mario over the town"""
        a, b = self.p['city_before'].get(f), self.p['city_after'].get(f)
        cx, cy = W * 0.5, H * 0.56
        r = (smooth(t) ** 0.9) * 1.25 * math.hypot(W, H) / 2 + 2
        yy, xx = np.mgrid[0:H, 0:W]
        d = np.sqrt((xx - cx) ** 2 + ((yy - cy) * 1.25) ** 2)
        m = np.clip((r - d) / 60, 0, 1)[..., None]
        out = np.asarray(a).astype(np.float32) * (1 - m) + np.asarray(b).astype(np.float32) * m
        ring = np.exp(-((d - r) / 38) ** 2)[..., None] * (1 - t * 0.5)
        out = out + ring * np.array([255, 236, 170], np.float32) * 0.95
        img = Image.fromarray(out.clip(0, 255).astype(np.uint8))
        # sparkles riding the ring
        dr = ImageDraw.Draw(img, 'RGBA')
        rnd = np.random.default_rng(int(f))
        for q in range(70):
            ang = rnd.uniform(0, math.tau); rr = r + rnd.normal(0, 30)
            x, y = cx + math.cos(ang) * rr, cy + math.sin(ang) * rr / 1.25
            s = rnd.uniform(2, 7)
            dr.ellipse((x - s, y - s, x + s, y + s), fill=(255, 250, 220, int(rnd.uniform(120, 255))))
            dr.line((x - s * 2.5, y, x + s * 2.5, y), fill=(255, 245, 200, 160), width=2)
            dr.line((x, y - s * 2.5, x, y + s * 2.5), fill=(255, 245, 200, 160), width=2)
        return img

    def frame(self, i):
        name, k, L = self.seg(i)
        img = self._frame(name, k, L)
        img = vig(img)
        # transitions: into a game beat a punch (zoom + flash); out of it a whip pan; out of a chat a push into the stage
        if name in GAME and k < 9:
            t = k / 9
            img = rblur(zoom(img, 1 + 0.22 * (1 - ease_out(t))), 0.08 * (1 - t))
            img = flash(img, 0.85 * (1 - t) ** 2).convert('RGB')
        if name in GAME and k >= L - 6 and name != 'race':
            t = (k - (L - 6)) / 6
            img = mblur(img, -260 * t ** 2)
            img = Image.blend(img, Image.new('RGB', img.size, (12, 13, 17)), 0.55 * t)
        if (name in UIS or name == 'bw_ui') and k < 6 and name != 'bw_ui':
            t = k / 6
            img = mblur(img, 240 * (1 - t) ** 2)
        if (name in UIS or name == 'bw_ui') and k >= L - 8:
            t = (k - (L - 8)) / 8
            img = rblur(zoom(img, 1 + 0.5 * t ** 2), 0.15 * t)
            img = flash(img, 0.75 * t ** 2).convert('RGB')
        return img.convert('RGB')

    def _frame(self, name, k, L):
        if name == 'cold':
            # the promise, over the reborn city drifting in the dark
            bg = self.p['city_crane'].blend(10 + k * 0.6).filter(ImageFilter.GaussianBlur(9))
            bg = Image.blend(Image.new('RGB', (W, H), (8, 9, 12)), bg, 0.28 * smooth(k / 30)).convert('RGBA')
            a1 = ease_out((k - 8) / 12)
            caption(bg, ['Everything you always wanted'], 380 + int(16 * (1 - a1)), size=86, alpha=a1)
            a2 = ease_out((k - 26) / 12)
            caption(bg, ['to do in ', ], 0, size=1, alpha=0)
            caption(bg, [('to do in Super Mario 64…', gfx.ACCENT)], 500 + int(16 * (1 - a2)), size=86, alpha=a2)
            fo = smooth((k - (L - 10)) / 10)
            if fo > 0: bg = Image.blend(bg.convert('RGB'), Image.new('RGB', (W, H), (0, 0, 0)), fo).convert('RGBA')
            return bg
        if name == 'title':
            u = self.castle
            s_ = min(44.0, k * 0.45)
            a_, b_ = int(s_), min(44, int(s_) + 1)
            img = Image.blend(u.full(a_), u.full(b_), s_ - a_)
            t = smooth(k / L)
            img = view(img, 1920 + 160 * t, 1080 - 30 * t, 3840 - 700 * t).convert('RGBA')
            if k < 8: img = Image.blend(Image.new('RGB', img.size, (0, 0, 0)), img.convert('RGB'), k / 8).convert('RGBA')
            a = ease_out((k - 4) / 8)
            band(img, 70, 330, 0.62 * a)
            caption(img, ['STUDIO 64'], 100 + int(20 * (1 - a)), size=136, alpha=a)
            caption(img, [('Just type what you want.', (255, 228, 160))], 262, size=60, weight='Bold', alpha=ease_out((k - 10) / 8))
            return img
        if name == 'bw_ui' or name in UIS:
            img = self.ui_frame(name, k, L).convert('RGBA')
            return img
        if name in GAME:
            img, (src, s) = self.game_frame(name, k)
            img = img.convert('RGBA')
            if name == 'bw':
                img = self.bw_fx(img, k, src, s)
            if name == 'sg':
                for f0 in self.sg_fires:
                    d = s - f0
                    if 0 <= d < 4: img = flash(img, 0.32 * (1 - d / 4), (255, 236, 190))
            if name == 'kt':
                for f0 in self.kt_fires:
                    d = s - f0
                    if 0 <= d < 3: img = flash(img, 0.18 * (1 - d / 3), (230, 240, 255))
            if name in self.CAPTIONS:
                a0, a1, lines = self.CAPTIONS[name]
                caption_band(img, k, a0, a1, lines)
            return img
        if name == 'slogan':
            return self.slogan(k, L)
        if name == 'end':
            if not hasattr(self, '_endbg'):
                self._endbg = self.p['city_crane'].get(100)
            img = gfx.end_card(k / 30.0, bg=self._endbg)
            if k >= L - 12:
                img = Image.blend(img.convert('RGB'), Image.new('RGB', (W, H), (0, 0, 0)), smooth((k - (L - 12)) / 12)).convert('RGBA')
            return img

    def bw_fx(self, img, k, src, s):
        # the window breaks: a white flash and a shake on the impact (bw_impact2 ~72, bw_impact ~65)
        hit = {'bw_impact2': 72, 'bw_impact': 65}.get(src)
        if hit is not None:
            d = s - hit
            if -1 <= d < 10:
                dx, dy = shake(int(s * 10), 26 * max(0, 1 - d / 10))
                img = view(img.convert('RGB'), W / 2 + dx, H / 2 + dy, W / 1.06).convert('RGBA')
            if 0 <= d < 5:
                img = flash(img, 0.9 * (1 - d / 5))
        if src == 'bw_impact' and s >= 86:   # the hold: a slow push on the broken window
            pass
        return img

    MONTAGE = [('bw_impact', 70), ('city_after', 100), ('city_plaza', 40), ('city_shotgun', 63), ('sub_depart', 60), ('sub_dive', 90),
               ('tokyo_katana', 34), ('race_start', 75), ('race_chase', 90), ('bw_impact2', 76)]
    def slogan(self, k, L):
        n = len(self.MONTAGE)
        j = min(n - 1, int(k / (L / n)))
        src, f = self.MONTAGE[j]
        local = k - j * (L / n)
        img = zoom(self.p[src].blend(f + local * 0.6), 1.04 + 0.03 * local / (L / n)).convert('RGBA')
        img = Image.blend(img.convert('RGB'), Image.new('RGB', (W, H), (10, 10, 14)), 0.38).convert('RGBA')
        a1 = ease_out((k - 2) / 8)
        caption(img, ['Everything you always wanted to do'], 330, size=78, alpha=a1)
        caption(img, ['in Super Mario 64'], 430, size=78, alpha=a1)
        a2 = ease_back((k - 50) / 10) if k >= 50 else 0
        if a2 > 0:
            caption(img, [('is now possible.', gfx.ACCENT)], 560, size=int(110 * min(1.0, 0.6 + 0.4 * a2)), alpha=min(1, a2))
        a3 = ease_out((k - 110) / 10)
        caption(img, ['Just type it.'], 730, size=64, weight='Bold', alpha=a3)
        if k >= L - 4:
            img = flash(img, (k - (L - 4)) / 4 * 0.9)
        return img

    def shot_frame(self, name, src, s):
        """the output frame where shot source `src` shows frame s (first match), or None"""
        o = self.start(name)
        for n, sr, s0, sp in self.SHOTS[name]:
            if sr == src and sp > 0 and s0 <= s < s0 + n * sp:
                return o + (s - s0) / sp
            o += n
        return None

    def events(self):
        """sound cues, in output frames: [frame, kind, extra]"""
        E = []
        for name, b in SEGS:
            o, L = self.start(name), b * BEAT
            if name == 'bw_ui':
                m = self.mk; typed = m['k1'] - m['k0'] + 1
                keys = [f['n'] for f in self.castle.frames if f['note'].startswith('key')]
                for q in keys: E.append([o + 8 + (q - m['k0']) * 62 / typed, 'key', 0])
                E.append([o + 8 + 62 + 6, 'send', 0])
                for q in range(3): E.append([o + 8 + 62 + 6 + 10 + 14 * q, 'card', 0])
            if name in UIS:
                u = self.ui[name]; lead, out = 6, 8
                T = int((L - lead - out) * 0.46); C = L - lead - out - T
                fr = u.meta['frames']
                for f in fr:
                    if f['note'] == 'key': E.append([o + lead + (f['n'] - u.k0) * (T - 1) / max(1, u.k1 - u.k0), 'key', 0])
                E.append([o + lead + T, 'send', 0])
                done = [f['n'] for f in fr if f['note'].endswith(':done')]
                firsts = [d for i, d in enumerate(done) if i == 0 or d != done[i - 1] + 1]
                for d in firsts: E.append([o + lead + T + (d - u.enter) * (C - 4) / max(1, u.done + 6 - u.enter), 'card', 0])
            if name in GAME:
                E.append([o, 'punch', 0])
                if name != 'race': E.append([o + L - 6, 'whip', 0])
        f = self.shot_frame('bw', 'bw_main', 127)
        if f is not None: E.append([f, 'solonga', 0])
        E.append([self.shot_frame('bw', 'bw_impact', 65), 'shatter', 0])
        E.append([self.start('city') + 50, 'wipe', 0])
        E.append([self.start('city') + 72, 'yahoo', 0])
        for q in self.sg_fires:
            f = self.shot_frame('sg', 'city_shotgun', q)
            if f is not None: E.append([f, 'shotgun', 0])
        for q in self.kt_fires:
            f = self.shot_frame('kt', 'tokyo_katana', q)
            if f is not None: E.append([f, 'slash', 0])
        E.append([self.shot_frame('sub', 'sub_pipe', 44), 'pipe', 0])
        E.append([self.start('sub') + 52, 'splash', 0])
        E.append([self.start('sub') + 140, 'dive', 0])
        E.append([self.start('race') + 2, 'road', 0])
        E.append([self.shot_frame('race', 'race_start', 56), 'carstart', 0])
        E.append([self.start('race') + 120, 'carpass', 0])
        E.append([self.start('race') + 165, 'carpass', 0])
        E.append([self.start('slogan') + 50, 'hit', 0])
        E.append([self.start('end'), 'logo', 0])
        return sorted([e for e in E if e[0] is not None], key=lambda e: e[0])

    def timeline(self):
        out, o = [], 0
        for name, b in SEGS:
            out.append({'name': name, 'start': o, 'frames': b * BEAT})
            o += b * BEAT
        return {'N': self.N, 'segs': out, 'shots': self.SHOTS, 'events': self.events(),
                'game': [[self.start('bw'), self.start('bw') + 40, 18]]}

_CUT = None
def _render(args):
    global _CUT
    i, out_dir, half = args
    if _CUT is None:
        _CUT = Cut5()
    p = f'{out_dir}/{i:04d}.jpg'
    img = _CUT.frame(i)
    if half: img = img.resize((W // 2, H // 2), Image.BILINEAR)
    img.save(p, quality=92)
    return i

if __name__ == '__main__':
    if sys.argv[1] == 'frames':
        out = sys.argv[2]
        half = len(sys.argv) > 3 and sys.argv[3] == 'half'
        os.makedirs(out, exist_ok=True)
        c = Cut5()
        json.dump(c.timeline(), open(f'{out}/timeline.json', 'w'))
        rng = range(c.N)
        if len(sys.argv) > 4 and sys.argv[4] != 'all':
            a, b = map(int, sys.argv[4].split(':')); rng = range(a, b)
        workers = int(sys.argv[5]) if len(sys.argv) > 5 else 4
        with Pool(workers) as pool:
            for n, i in enumerate(pool.imap_unordered(_render, [(i, out, half) for i in rng], chunksize=8)):
                if n % 100 == 0: print('frame', n, flush=True)
    elif sys.argv[1] == 'still':
        c = Cut5()
        for i in map(int, sys.argv[3].split(',')):
            c.frame(i).save(f'{sys.argv[2]}/still_{i:04d}.jpg', quality=90)
