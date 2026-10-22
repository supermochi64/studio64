"""The Studio 64 trailer cut: sources (UI capture, fight passes, doc stills), a timeline on the
music's 150 BPM grid (bar = 48 frames at 30 fps), captions, flashes, shakes, the end card.
    ~/.local/venvs/m64/bin/python promo/scripts/edit.py frames  <dir> [half]   # render frames (jpg)
    ~/.local/venvs/m64/bin/python promo/scripts/edit.py sheet   <dir>          # contact sheets for the review
The audio is made by mix.py from the same timeline (timeline.json written here)."""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter
sys.path.insert(0, os.path.dirname(__file__))
import gfx
from gfx import W, H, caption, pill, ease_out, ease_back, band

ROOT = gfx.ROOT
WORK = f'{ROOT}/promo/work'
UI = f'{WORK}/cap/ui'
FIGHT = f'{WORK}/cap/fight'
FPS = 30
BAR = 48
BEAT = 12

def smooth(t):
    t = min(max(t, 0.0), 1.0); return t * t * (3 - 2 * t)

# ---------------------------------------------------------------------------------------------
# sources

class UISrc:
    """The studio capture: full frames (3840x2160) and chat-column clips (CSS x 1280-1920)."""
    def __init__(self, d=None):
        self.d = d or UI
        self.meta = json.load(open(f'{self.d}/frames.json'))
        self.frames = self.meta['frames']
        self.base_cache = {}
    def _full_index(self, n):
        for k in range(n, -1, -1):
            if not self.frames[k].get('clip'):
                return k
        for k in range(n, len(self.frames)):
            if not self.frames[k].get('clip'):
                return k
    def full(self, n):
        n = max(0, min(n, len(self.frames) - 1))
        if n in self.base_cache:
            return self.base_cache[n]
        fi = self._full_index(n)
        img = Image.open(f'{self.d}/{fi:05d}.jpg').convert('RGB')
        if self.frames[n].get('clip'):
            img = img.copy()
            img.paste(Image.open(f'{self.d}/{n:05d}c.jpg').convert('RGB'), (2560, 0))
        if len(self.base_cache) > 6:
            self.base_cache.clear()
        self.base_cache[n] = img
        return img

class PassSrc:
    def __init__(self, name, base=None):
        self.dir = f'{base or FIGHT}/{name}'
        self.meta = json.load(open(f'{self.dir}/meta.json')) if os.path.exists(f'{self.dir}/meta.json') else {}
        self.cache = {}
    def get(self, f, prefix=''):
        k = (prefix, int(f))
        if k not in self.cache:
            p = f'{self.dir}/{prefix}{int(f):04d}.jpg'
            if not os.path.exists(p):   # nearest filmed frame
                cands = sorted(int(x[len(prefix):-4]) for x in os.listdir(self.dir) if x.endswith('.jpg') and x.startswith(prefix) and x[len(prefix):-4].isdigit())
                near = min(cands, key=lambda c: abs(c - f))
                p = f'{self.dir}/{prefix}{near:04d}.jpg'
            if len(self.cache) > 12:
                self.cache.clear()
            self.cache[k] = Image.open(p).convert('RGB')
        return self.cache[k]
    def blend(self, s, prefix=''):
        a = math.floor(s); t = s - a
        if t < 0.05:
            return self.get(a, prefix)
        if t > 0.95:
            return self.get(a + 1, prefix)
        return Image.blend(self.get(a, prefix), self.get(a + 1, prefix), t)

def view(img, cx, cy, cw, out=(W, H), rot=0.0):
    """crop a 16:9 window of width cw centred at (cx, cy) (source pixels) and scale it to out"""
    ch = cw * 9 / 16
    cx = min(max(cx, cw / 2), img.width - cw / 2); cy = min(max(cy, ch / 2), img.height - ch / 2)
    box = (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2)
    return img.transform(out, Image.EXTENT, box, Image.BICUBIC)

def shake(i, amp, seed=1):
    r = np.random.default_rng(seed + i)
    return r.uniform(-amp, amp), r.uniform(-amp, amp)

def flash(img, a, color=(255, 255, 255)):
    if a <= 0:
        return img
    return Image.blend(img.convert('RGB'), Image.new('RGB', img.size, color), min(1, a)).convert('RGBA')

def grade(img, sat=1.0, con=1.0, bright=1.0):
    im = img.convert('RGB')
    if sat != 1: im = ImageEnhance.Color(im).enhance(sat)
    if con != 1: im = ImageEnhance.Contrast(im).enhance(con)
    if bright != 1: im = ImageEnhance.Brightness(im).enhance(bright)
    return im.convert('RGBA')

def vhs(img, k, strength=1.0):
    """rewind look: RGB split, scanlines, a rolling bright band"""
    im = img.convert('RGB')
    r, g, b = im.split()
    dx = int(10 * strength)
    r = ImageChops.offset(r, dx, 0); b = ImageChops.offset(b, -dx, 0)
    im = Image.merge('RGB', (r, g, b))
    a = np.array(im).astype(np.float32)
    a[::3] *= 0.78
    band = int((k * 97) % H)
    a[band:band + 40] = a[band:band + 40] * 0.6 + 100
    a = np.clip(a * 0.95 + 8, 0, 255)
    return Image.fromarray(a.astype(np.uint8)).convert('RGBA')

# ---------------------------------------------------------------------------------------------
# the cut

MONTAGE = [('terrain.png', 'Sculpt any level', (0.6, 0.45, 0.55)), ('build.png', 'Build by hand', (0.42, 0.42, 0.6)),
           ('roads.png', 'Roads & nature', (0.6, 0.47, 0.55)), ('story.png', 'Write the story', (0.46, 0.4, 0.5)),
           ('sound.png', 'Compose the music', (0.6, 0.42, 0.4)), ('title-screen.png', 'Your own title screen', (0.32, 0.36, 0.48))]

class Cut:
    def __init__(self):
        self.ui = UISrc()
        self.main = PassSrc('main'); self.alt = PassSrc('alt'); self.hook = PassSrc('hook'); self.bul = PassSrc('bullet')
        try:
            E = json.load(open(f'{FIGHT}/rehearsal.json'))['E']
        except FileNotFoundError:          # (testing the studio part before the fight is filmed)
            E = {'grab': 267, 'release': 344, 'hit': 350, 'circle': 198}
        self.G, self.R, self.Hh, self.C = E['grab'], E['release'], E['hit'], E['circle']
        self.stills = {}
        self.events = []    # (frame, name) for the audio
        self.N = 624 + 105  # 729 frames = 24.3 s

    def still(self, name):
        if name not in self.stills:
            self.stills[name] = Image.open(f'{ROOT}/docs/img/{name}').convert('RGB')
        return self.stills[name]

    # ---- shots -------------------------------------------------------------------------------
    def game(self, src, s, zoom=1.0, cx=0.5, cy=0.5, shk=0.0, i=0, blend=True, prefix=''):
        img = src.blend(s, prefix) if blend else src.get(round(s), prefix)
        cw = img.width / zoom
        dx, dy = shake(i, shk * img.width / W) if shk else (0, 0)
        return view(img, img.width * cx + dx, img.height * cy + dy, cw).convert('RGBA')

    def frame(self, i):
        G, R, Hh, C = self.G, self.R, self.Hh, self.C
        b = i // BAR
        # ---- bar 0: the hook ----
        if i < 48:
            if i < 16:
                img = self.game(self.alt, G + 52 + i * 0.9, zoom=1.3 - i * 0.004, cx=0.52, cy=0.42, blend=False)
            elif i < 30:
                k = (i - 16) / 14
                img = self.game(self.hook, R + k * (Hh + 1 - R), zoom=1.7 + k * 0.3, cx=0.56, cy=0.48, blend=False)
            elif i < 38:
                img = self.game(self.alt, Hh + 4 + (i - 30), zoom=1.15, shk=26 * (1 - (i - 30) / 8), i=i)
                img = flash(img, 1 - (i - 30) / 3)
            else:                   # rewind to the start
                k = (i - 38) / 9
                s = (Hh + 1) * (1 - k) ** 1.6
                img = vhs(self.game(self.main, s, blend=False), i, 1.0 - 0.5 * k)
            if 30 <= i < 38:
                band(img, 380, 600, 0.82)
                caption(img, ['ONE SENTENCE.'], 420, size=170, scale=ease_back((i - 29) / 3))
            return img
        # ---- bar 1: the studio ----
        if i < 96:
            k = i - 48
            u = self.ui.full(min(44, k))
            t = smooth(k / 20)
            img = view(u, 1920 + 140 * t, 1080 - 40 * t, 3840 - 900 * t).convert('RGBA')
            if k < 5:
                img = flash(img, 0.6 * (1 - k / 5))
            band(img, 70, 330, 0.62)
            a = ease_out((k - 2) / 7)
            caption(img, ['STUDIO 64'], 100 + int(20 * (1 - a)), size=136, alpha=a)
            a2 = ease_out((k - 8) / 7)
            caption(img, [('Super Mario 64 hacking, right in your browser', (255, 228, 160))], 262, size=56, weight='Bold', alpha=a2)
            return img
        # ---- bars 2-3: typing (the real keystrokes, 1.5x), the finished sentence held ----
        if i < 180:
            k = i - 96
            if k < 8:
                n = 45 + int(k * 6 / 8)
            elif k < 72:
                n = 53 + int((k - 8) * 93 / 64)
            else:
                n = 147 + min(9, k - 72)
            u = self.ui.full(n)
            t = smooth(k / 10)
            img = view(u, 3200 + 212 * t, 1500 + 470 * t, 2300 - 1430 * t).convert('RGBA')
            a = ease_out((k - 10) / 6)
            if a > 0.01:
                band(img, 90, 230, 0.5 * a)
                caption(img, ['Just type what you want.'], 110, size=86, alpha=a)
            return img
        # ---- bar 4: sent, Claude does it, Bowser appears in the studio ----
        if i < 240:
            k = i - 180
            if k < 18:
                n = 161 + int(k * 35 / 18)          # sent, thinking... (40 s of real time, compressed)
            elif k < 26:
                n = 197                              # "Searching bowser" (running)
            elif k < 32:
                n = 202                              # "Adding Bowser, 5 x Bowser Bomb"
            elif k < 42:
                n = 203                              # done (and Bowser's puff at the stage's edge)
            else:
                n = 203 + (k - 42)                   # Bowser arrives in the stage
            u = self.ui.full(n)
            if k < 42:
                t = smooth((k - 26) / 12) if k >= 26 else 0.0
                img = view(u, 3240 + 150 * t, 520 - 120 * t, 1300 - 420 * t).convert('RGBA')
            else:
                t = smooth((k - 42) / 7)
                img = view(u, 3390 - 1470 * t, 400 + 680 * t, 880 + 2960 * t).convert('RGBA')
            a = ease_out((k - 8) / 6)
            if a > 0.01:
                band(img, 850, 990, 0.6 * a)
                caption(img, ['Claude builds it. Live.'], 868, size=88, alpha=a)
            return img
        # ---- bar 5: the drop, his arrival ----
        if i < 288:
            k = i - 240
            img = self.game(self.main, k, zoom=1.0 + 0.1 * (1 - ease_out(k / 6)), shk=12 * max(0, 1 - k / 10), i=i)
            img = flash(img, 0.9 * (1 - k / 4))
            a = ease_out((k - 12) / 6)
            if a > 0.01:
                band(img, 60, 200, 0.45 * a)
                caption(img, ['The real game.'], 80, size=96, alpha=a)
            return img
        # ---- bar 6: he walks in ----
        if i < 336:
            k = i - 288
            return self.game(self.main, 80 + k, zoom=1.05 + 0.002 * k, shk=3 if k % 12 < 2 else 0, i=i)
        # ---- bar 7: Mario runs around him (fire breath) ----
        if i < 384:
            k = i - 336
            s = (C - 2) + k * ((G - 6) - (C - 2)) / 48
            m = self.main.meta['meta'][int(s)]['st'] if self.main.meta else None
            return self.game(self.main, s, zoom=1.5)
        # ---- bar 8: grab, spin ----
        if i < 432:
            k = i - 384
            if k < 20:
                img = self.game(self.main, G - 6 + k, zoom=1.08)
                return flash(img, 0.5 * (1 - k / 3)) if k < 3 else img
            return self.game(self.main, G + 14 + (k - 20), zoom=1.35, cy=0.55)
        # ---- bar 9: the swing gets faster, release, slow motion ----
        if i < 480:
            k = i - 432
            if k < 20:
                img = self.game(self.alt, G + 42 + k, zoom=1.08, cy=0.46)
            elif k < 32:
                img = self.game(self.main, R - 9 + (k - 20), zoom=1.06)
            else:
                t = (k - 32) / 16
                img = self.game(self.alt, R + t * (Hh + 1 - R), zoom=1.0 + 0.15 * t, blend=False)
            if 28 <= k < 47:
                caption(img, [('SO LONG-A BOWSER!', (255, 220, 90))], 120, size=104, scale=ease_back((k - 28) / 4))
            return img
        # ---- bar 10: BOOM ----
        if i < 528:
            k = i - 480
            if k < 12:
                img = self.game(self.alt, Hh + 2 + k * 0.8, zoom=1.0, shk=24 * max(0, 1 - k / 10), i=i)
                img = flash(img, 1 - k / 4)
            else:
                img = self.game(self.bul, (k - 12) * 1.9, prefix='b', zoom=1.0 + 0.002 * (k - 12), blend=False)
                if k < 14:
                    img = flash(img, 0.6 * (1 - (k - 12) / 2))
                a = ease_out((k - 24) / 4)
                if a > 0.01:
                    band(img, 850, 1000, 0.55 * a)
                    caption(img, [('Free. Open source.', (255, 220, 90))], 870, size=96, alpha=a)
            return img
        # ---- bars 11-12: and everything else ----
        if i < 624:
            k = i - 528
            j, kk = divmod(k, 16)
            name, label, (cx, cy, cw) = MONTAGE[j]
            im = self.still(name)
            z = 1 + 0.06 * kk / 16
            img = view(im, im.width * cx, im.height * cy, im.width * cw / z).convert('RGBA')
            if kk < 2:
                img = flash(img, 0.45 * (1 - kk / 2))
            band(img, 890, 1030, 0.5)
            pill(img, label, W // 2, 960, size=84, alpha=1.0, icon=gfx.logo(92))
            if k < 32:
                band(img, 60, 200, 0.62)
                caption(img, ['And so much more.'], 92, size=84, alpha=ease_out(k / 4))
            return img
        # ---- bars 13-15: the end card ----
        k = i - 624
        bg = self.bul.get(60, 'b')
        return gfx.end_card(k / FPS, bg=bg)

    def timeline(self):
        """the audio's cue list: output frame -> what happens (mix.py)"""
        G, R, Hh, C = self.G, self.R, self.Hh, self.C
        keys = self.ui.meta['keyTimes']
        # typing: ui index n = 45 + k*(112/96)  ->  output frame = 96 + (n-45)*96/112; keys are at n = 51 + keyTime
        key_out = [104 + t * 64 / 95 for t in keys]
        return dict(G=G, R=R, Hh=Hh, C=C, keys=[k for k in key_out if k < 172], enter=180, cards=[198, 206],
                    toast=222, bowser_ui=222, drop=240, release_out=461, boom=480, montage=528, end=624, N=self.N,
                    game=[  # output range -> (pass, source start, speed); every pass replays the same take
                        (0, 16, 'alt', G + 52, 0.9), (16, 30, 'hook', R, (Hh + 1 - R) / 14), (30, 38, 'alt', Hh + 4, 1.0),
                        (240, 288, 'main', 0, 1.0), (288, 336, 'main', 80, 1.0), (336, 384, 'main', C - 2, ((G - 6) - (C - 2)) / 48),
                        (384, 404, 'main', G - 6, 1.0), (404, 432, 'main', G + 14, 1.0), (432, 452, 'alt', G + 42, 1.0),
                        (452, 461, 'main', R - 9, 1.0), (480, 492, 'main', Hh, 1.0),
                        ])

def render(out_dir, half=False, only=None):
    os.makedirs(out_dir, exist_ok=True)
    c = Cut()
    json.dump(c.timeline(), open(f'{out_dir}/timeline.json', 'w'))
    rng = only if only is not None else range(c.N)
    for i in rng:
        img = c.frame(i).convert('RGB')
        if half:
            img = img.resize((W // 2, H // 2), Image.BILINEAR)
        img.save(f'{out_dir}/{i:04d}.jpg', quality=92)
        if i % 50 == 0:
            print('frame', i, flush=True)

if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'frames':
        only = None
        if len(sys.argv) > 4:
            a, b2 = map(int, sys.argv[4].split(':')); only = range(a, b2)
        render(sys.argv[2], half=len(sys.argv) > 3 and sys.argv[3] == 'half', only=only)
