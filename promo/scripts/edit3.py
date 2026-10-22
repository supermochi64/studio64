"""Trailer v3: told straight, trailer pace (60.5 s at 120 BPM, a beat = 15 frames). The studio opens, three
"type it -> play it" beats in Bob-omb Battlefield (car, shotgun, katana), then the Bowser fight as the climax, shown once,
and the end card (held, faded out). Every caption stays up 1.5 s + 0.25 s per word or longer; prompts are typed at the
real capture's rhythm (0.8x for the short ones); no footage is used twice.
    ~/.local/venvs/m64/bin/python promo/scripts/edit3.py frames <dir> [half] [a:b]"""
import json, os, sys
from PIL import Image, ImageFilter
sys.path.insert(0, os.path.dirname(__file__))
import gfx, edit
from gfx import W, H, caption, ease_out, ease_back, band
from edit import view, flash, shake, smooth, UISrc, PassSrc, FPS, WORK
from edit2 import ui_marks

CAP = f'{WORK}/cap'
BEAT = 15

class Cut3:
    SEGS = [('studio', 7), ('car_ui', 12), ('car', 10), ('sg_ui', 11), ('sg', 10), ('kt_ui', 11), ('kt', 10),
            ('bw_ui', 16), ('finale', 24), ('title', 9), ('end', 10)]
    # prompt beats: lead (empty box), typing, hold, thinking, cards, zoom out, result; typing speed
    PROMPTS = {'car_ui': ('car', (24, 42, 18, 12, 36, 15, 33), 0.8), 'sg_ui': ('shotgun', (12, 54, 12, 9, 48, 15, 15), 0.8),
               'kt_ui': ('katana', (12, 63, 12, 9, 39, 15, 15), 0.65), 'bw_ui': ('castle', (24, 93, 15, 12, 54, 15, 27), 1.0)}

    def __init__(self):
        self.ui = {k: UISrc(f'{CAP}/{d}') for k, d in (('castle', 'ui'), ('car', 'ui_car'), ('shotgun', 'ui_shotgun'), ('katana', 'ui_katana'))}
        self.mk = {k: ui_marks(u) for k, u in self.ui.items()}
        self.fight = {n: PassSrc(n, f'{CAP}/fight') for n in ('main', 'alt', 'bullet')}
        self.car = PassSrc('main', f'{CAP}/car')
        self.sg = PassSrc('main', f'{CAP}/shotgun')
        self.kt = PassSrc('main', f'{CAP}/katana')
        E = json.load(open(f'{CAP}/fight/rehearsal.json'))['E']
        self.G, self.R, self.Hh, self.C = E['grab'], E['release'], E['hit'], E['circle']
        self.sgE = json.load(open(f'{CAP}/shotgun/rehearsal.json'))['E']
        self.ktE = json.load(open(f'{CAP}/katana/rehearsal.json'))['E']
        self.N = sum(b for _, b in self.SEGS) * BEAT
        self._endbg = None

    def start(self, name):
        o = 0
        for n_, b in self.SEGS:
            if n_ == name:
                return o
            o += b * BEAT

    def seg(self, i):
        o = 0
        for name, b in self.SEGS:
            if i < o + b * BEAT:
                return name, i - o
            o += b * BEAT
        return 'end', i - (o - self.SEGS[-1][1] * BEAT)

    def g(self, src, s, zoom=1.0, cx=0.5, cy=0.5, shk=0.0, i=0, blend=True, prefix=''):
        img = src.blend(s, prefix) if blend else src.get(round(s), prefix)
        dx, dy = shake(i, shk * img.width / W) if shk else (0, 0)
        return view(img, img.width * cx + dx, img.height * cy + dy, img.width / zoom).convert('RGBA')

    def prompt(self, segname, k):
        key, (L, T, Hd, Th, Cd, Z, Rs), speed = self.PROMPTS[segname]
        u, m = self.ui[key], self.mk[key]
        typed = m['k1'] - m['k0'] + 1
        if k < L:                                     # the empty box, zooming in
            t = smooth(k / L)
            return view(u.full(m['k0'] - 1), 3410 - 210 * (1 - t), 1960 - 260 * (1 - t), 870 + 410 * (1 - t)).convert('RGBA')
        k -= L
        if k < T:                                     # typed at the capture's own rhythm (speed < 1: a bit slower)
            n = m['k0'] + min(typed - 1, int(k * speed))
            return view(u.full(n), 3410, 1960, 870).convert('RGBA')
        k -= T
        if k < Hd:
            return view(u.full(m['k1'] + 1), 3410, 1960, 870).convert('RGBA')
        k -= Hd
        if k < Th:                                    # sent: thinking (the real wait, shortened)
            n = m['enter'] + 1 + round(k * (m['tools'] - m['enter'] - 2) / max(1, Th))
            return view(u.full(n), 3385, 400, 900).convert('RGBA')
        k -= Th
        if k < Cd:                                    # Claude's tool cards, long enough to read
            n = min(m['spawn'], m['tools'] + 1 + int(k * (m['spawn'] - m['tools']) / Cd))   # (+1: a capture shows the card a frame later)
            return view(u.full(n), 3385, 400, 900).convert('RGBA')
        k -= Cd
        n = m['spawn'] + k                            # zoom out: the result in the game beside the chat
        t = smooth(k / Z)
        return view(u.full(n), 3385 - 1465 * t, 400 + 680 * t, 900 + 2940 * t).convert('RGBA')

    def capt(self, img, k, k0, k1, lines, y=110, size=86, bandy=None, color=None):
        """a caption from k0 to k1 (local frames), fading in and out over 4 frames"""
        if not (k0 <= k < k1):
            return
        a = min(ease_out((k - k0) / 4), ease_out((k1 - k) / 4))
        b0, b1 = bandy or (y - 20, y + size + 34)
        band(img, b0, b1, 0.6 * a)
        caption(img, [(l, color) if color else l for l in lines], y, size=size, alpha=a)

    def frame(self, i):
        G, R, Hh, C = self.G, self.R, self.Hh, self.C
        F = self.fight
        name, k = self.seg(i)
        if name == 'studio':
            s_ = min(44.0, k * 0.45)                 # Mario idling, in half speed, under a slow push-in
            a_, b_ = int(s_), min(44, int(s_) + 1)
            u = Image.blend(self.ui['castle'].full(a_), self.ui['castle'].full(b_), s_ - a_)
            t = smooth(k / 105)
            img = view(u, 1920 + 160 * t, 1080 - 30 * t, 3840 - 760 * t).convert('RGBA')
            if k < 15:
                img = Image.blend(Image.new('RGB', img.size, (0, 0, 0)), img.convert('RGB'), k / 15).convert('RGBA')
            a = ease_out((k - 8) / 8)
            band(img, 70, 330, 0.62 * a)
            caption(img, ['STUDIO 64'], 100 + int(20 * (1 - a)), size=136, alpha=a)
            caption(img, [('Super Mario 64, in your browser', (255, 228, 160))], 262, size=60, weight='Bold', alpha=ease_out((k - 12) / 8))
            return img
        if name in self.PROMPTS:
            img = self.prompt(name, k)
            if name == 'car_ui':
                self.capt(img, k, 0, 84, ['Just type what you want.'])
                self.capt(img, k, 108, 186, ['Claude builds it. Live.'], y=868, size=88, bandy=(850, 990))
            if name == 'bw_ui':
                self.capt(img, k, 0, 117, ['Now, the boss fight.'])
            return img
        if name == 'car':
            if k < 128:
                img = self.g(self.car, k, zoom=1.06)
                if k < 6:
                    self.capt(img, k + 180, 108, 186, ['Claude builds it. Live.'], y=868, size=88, bandy=(850, 990))
                return img
            return self.g(self.car, 128 + (k - 128) / 2, zoom=1.06 + 0.002 * (k - 128))     # a breath: he drives off in half speed
        if name == 'sg':
            f1 = self.sgE['fires'][0]
            if k < f1:
                return self.g(self.sg, k, zoom=1.15, cy=0.47)
            if k < f1 + 24:                           # the first blast in half speed
                img = self.g(self.sg, f1 + (k - f1) / 2, zoom=1.15 + 0.01 * (k - f1), cy=0.47, shk=10 * max(0, 1 - (k - f1) / 6), i=i, blend=False)
                return flash(img, 0.5 * (1 - (k - f1) / 3)) if k - f1 < 3 else img
            if k < 120:
                return self.g(self.sg, f1 + 12 + (k - f1 - 24), zoom=1.3)
            return self.g(self.sg, 99 + (k - 120) * 0.27, zoom=1.3 + 0.002 * (k - 120))   # the last Goomba flies, slowly (a breath)
        if name == 'kt':
            f1 = self.ktE['fires'][0]
            if k < f1:
                return self.g(self.kt, k, zoom=1.2)
            if k < f1 + 24:                           # the first cut in half speed
                return self.g(self.kt, f1 + (k - f1) / 2, zoom=1.25, shk=8 * max(0, 1 - (k - f1) / 6), i=i, blend=False)
            if k < 126:
                return self.g(self.kt, f1 + 12 + (k - f1 - 24), zoom=1.25)
            return self.g(self.kt, f1 + 12 + (126 - f1 - 24) + (k - 126) / 2, zoom=1.25 + 0.002 * (k - 126))   # a breath
        if name == 'finale':
            if k < 72:                                # he arrives in front of the castle
                img = self.g(F['main'], k, zoom=1.0 + 0.1 * (1 - ease_out(k / 8)), shk=12 * max(0, 1 - k / 10), i=i)
                img = flash(img, 0.9 * (1 - k / 4))
                self.capt(img, k, 4, 78, ['The real game.'], y=80, size=96, bandy=(60, 200))
                return img
            if k < 126:
                img = self.g(F['main'], 80 + (k - 72), zoom=1.06)
                self.capt(img, k, 4, 78, ['The real game.'], y=80, size=96, bandy=(60, 200))
                return img
            if k < 166:
                return self.g(F['main'], (C - 2) + (k - 126) * 1.5, zoom=1.7, blend=False)
            if k < 186:
                img = self.g(F['main'], G - 6 + (k - 166), zoom=1.4, cx=0.55, cy=0.55)
                return flash(img, 0.5 * (1 - (k - 166) / 3)) if k < 169 else img
            if k < 218:
                img = self.g(F['main'], G + 14 + (k - 186), zoom=1.35, cy=0.55)
            elif k < 238:
                img = self.g(F['alt'], G + 46 + (k - 218), zoom=1.08, cy=0.46)
            elif k < 248:
                img = self.g(F['main'], R - 9 + (k - 238), zoom=1.06)
            elif k < 285:                             # the flight, slow motion
                t = (k - 248) / 37
                img = self.g(F['alt'], R + t * (Hh + 1 - R), zoom=1.0 + 0.15 * t, blend=False)
            elif k < 297:                             # the blast
                img = self.g(F['alt'], Hh + 2 + (k - 285) * 0.8, zoom=1.0, shk=24 * max(0, 1 - (k - 285) / 8), i=i)
                img = flash(img, 1 - (k - 285) / 4)
            else:                                     # frozen time
                img = self.g(F['bullet'], (k - 297) * 69 / 63, prefix='b', zoom=1.0 + 0.002 * (k - 297), blend=False)
                if k < 299:
                    img = flash(img, 0.6 * (1 - (k - 297) / 2))
            self.capt(img, k, 218, 292, ['SO LONG-A BOWSER!'], y=110, size=104, bandy=(90, 240), color=(255, 220, 90))
            self.capt(img, k, 292, 360, ['Free. Open source.'], y=870, size=96, bandy=(850, 1000), color=(255, 220, 90))
            return img
        if name == 'title':                           # the promise, before the logo
            if getattr(self, '_titlebg', None) is None:
                b = self.fight['bullet'].get(50, 'b').convert('RGB').resize((W // 8, H // 8)).filter(ImageFilter.GaussianBlur(3)).resize((W, H), Image.BICUBIC)
                self._titlebg = Image.blend(Image.new('RGB', (W, H), (10, 11, 15)), b, 0.35)
            z = 1 + 0.03 * k / 135
            img = view(self._titlebg, W / 2, H / 2, W / z).convert('RGBA')
            if k < 6:
                img = flash(img, 0.35 * (1 - k / 6))
            a1 = min(ease_out((k - 4) / 8), ease_out((135 - k) / 6))
            caption(img, ['Create anything you ever wanted', 'in Super Mario 64.'], 330 + int(16 * (1 - ease_out((k - 4) / 8))), size=104, alpha=a1)
            a2 = min(ease_out((k - 46) / 6), ease_out((135 - k) / 6))
            if a2 > 0.01:
                caption(img, [('– in real time.', gfx.ACCENT)], 640, size=120, scale=0.9 + 0.1 * ease_back((k - 46) / 6), alpha=a2)
            return img
        # the end card: held 4 s, then a fade to black
        if self._endbg is None:
            self._endbg = F['bullet'].get(50, 'b')
        img = gfx.end_card(k / FPS, bg=self._endbg)
        if k >= 120:
            img = Image.blend(img.convert('RGB'), Image.new('RGB', img.size, (0, 0, 0)), min(1, (k - 120) / 28)).convert('RGBA')
        return img

    def timeline(self):
        G, R, Hh, C = self.G, self.R, self.Hh, self.C
        st = self.start
        f = f'{CAP}/fight/main'
        car, sg, kt = f'{CAP}/car/main', f'{CAP}/shotgun/main', f'{CAP}/katana/main'
        s1, k1 = self.sgE['fires'][0], self.ktE['fires'][0]
        keys, enters, cards, results = [], [], [], []
        for segname, (key, (L, T, Hd, Th, Cd, Z, Rs), speed) in self.PROMPTS.items():
            o, m = st(segname), self.mk[key]
            for kt_ in m['keyTimes']:
                n = m['first_key'] + kt_
                keys.append(o + L + (n - m['k0']) / speed)
            enters.append(o + L + T + Hd)
            cards.append(o + L + T + Hd + Th)
            results.append(o + L + T + Hd + Th + Cd)
        c0, s0, q0, f0 = st('car'), st('sg'), st('kt'), st('finale')
        game = [(c0, c0 + 128, car, 0, 1.0), (c0 + 128, c0 + 150, car, 128, 0.5),
                (s0, s0 + s1, sg, 0, 1.0), (s0 + s1, s0 + s1 + 24, sg, s1, 0.5), (s0 + s1 + 24, s0 + 120, sg, s1 + 12, 1.0), (s0 + 120, s0 + 150, sg, 99, 0.27),
                (q0, q0 + k1, kt, 0, 1.0), (q0 + k1, q0 + k1 + 24, kt, k1, 0.5), (q0 + k1 + 24, q0 + 126, kt, k1 + 12, 1.0), (q0 + 126, q0 + 150, kt, 114, 0.5),
                (f0, f0 + 72, f, 0, 1.0), (f0 + 72, f0 + 126, f, 80, 1.0), (f0 + 126, f0 + 166, f, C - 2, 1.5),
                (f0 + 166, f0 + 186, f, G - 6, 1.0), (f0 + 186, f0 + 218, f, G + 14, 1.0), (f0 + 218, f0 + 238, f, G + 46, 1.0),
                (f0 + 238, f0 + 247, f, R - 9, 1.0), (f0 + 285, f0 + 297, f, Hh, 1.0)]
        sgf = [s0 + s1] + [s0 + s1 + 24 + (x - s1 - 12) for x in self.sgE['fires'][1:]]
        ktf = [q0 + k1] + [q0 + k1 + 24 + (x - k1 - 12) for x in self.ktE['fires'][1:]]
        return dict(N=self.N, keys=keys, enters=enters, cards=cards, results=results, game=game,
                    drops=[c0, s0, q0, f0], title=st('title'), car=dict(launch=c0 + 48, drift=c0 + 86, away=c0 + 128),
                    shots=sgf, slashes=ktf, release_out=f0 + 247, boom=f0 + 285, end=st('end'))

def render(out_dir, half=False, only=None):
    os.makedirs(out_dir, exist_ok=True)
    c = Cut3()
    json.dump(c.timeline(), open(f'{out_dir}/timeline.json', 'w'))
    for i in (only if only is not None else range(c.N)):
        img = c.frame(i).convert('RGB')
        if half:
            img = img.resize((W // 2, H // 2), Image.BILINEAR)
        img.save(f'{out_dir}/{i:04d}.jpg', quality=92)
        if i % 200 == 0:
            print('frame', i, flush=True)

if __name__ == '__main__':
    if sys.argv[1] == 'frames':
        only = None
        if len(sys.argv) > 4:
            a, b = map(int, sys.argv[4].split(':')); only = range(a, b)
        render(sys.argv[2], half=len(sys.argv) > 3 and sys.argv[3] == 'half', only=only)
