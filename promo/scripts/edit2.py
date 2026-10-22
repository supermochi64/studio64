"""Trailer v2: three quick "type it -> play it" beats (car, shotgun, katana) and the Bowser finale.
150 BPM grid (bar = 48 frames at 30 fps), the score's arrangement in music.py (ARR).
    ~/.local/venvs/m64/bin/python promo/scripts/edit2.py frames <dir> [half] [a:b]"""
import json, os, sys
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
import gfx, edit
from gfx import W, H, caption, pill, ease_out, ease_back, band
from edit import view, flash, shake, smooth, vhs, UISrc, PassSrc, BAR, FPS, WORK

CAP = f'{WORK}/cap'

def ui_marks(u):
    fr = u.frames
    keys = [f['n'] for f in fr if f['note'].startswith('key')]
    enter = [f['n'] for f in fr if f['note'] == 'enter'][0]
    tools = [f['n'] for f in fr if f['tools']]
    spawn = [f['n'] for f in fr if f['note'] == 'spawned'][0]
    return dict(k0=keys[0], k1=keys[-1], enter=enter, tools=tools[0], spawn=spawn, keyTimes=u.meta['keyTimes'],
                first_key=keys[0] - u.meta['keyTimes'][0])

MONTAGE = [('terrain.png', 'Sculpt any level', (0.6, 0.45, 0.55)), ('build.png', 'Build by hand', (0.42, 0.42, 0.6)),
           ('title-screen.png', 'Your own title screen', (0.32, 0.36, 0.48)), ('roads.png', 'Roads & nature', (0.6, 0.47, 0.55))]

class Cut2:
    def __init__(self):
        self.ui = {k: UISrc(f'{CAP}/{d}') for k, d in (('castle', 'ui'), ('car', 'ui_car'), ('shotgun', 'ui_shotgun'), ('katana', 'ui_katana'))}
        self.mk = {k: ui_marks(u) for k, u in self.ui.items()}
        self.fight = {n: PassSrc(n, f'{CAP}/fight') for n in ('main', 'alt', 'hook', 'bullet')}
        self.car = {n: PassSrc(n, f'{CAP}/car') for n in ('main', 'alt')}
        self.sg = {n: PassSrc(n, f'{CAP}/shotgun') for n in ('main', 'alt')}
        self.kt = {n: PassSrc(n, f'{CAP}/katana') for n in ('main', 'alt')}
        E = json.load(open(f'{CAP}/fight/rehearsal.json'))['E']
        self.G, self.R, self.Hh, self.C = E['grab'], E['release'], E['hit'], E['circle']
        self.carE = json.load(open(f'{CAP}/car/rehearsal.json'))['E']
        self.sgE = json.load(open(f'{CAP}/shotgun/rehearsal.json'))['E']
        self.ktE = json.load(open(f'{CAP}/katana/rehearsal.json'))['E']
        self.stills = {}
        self.N = sum(n for _, n in self.SEGS)
        self.audio = []   # (out frame0, out frame1, tap dir, source frame0, speed)
        self.keys = []
        self.ev = {}

    def still(self, name):
        if name not in self.stills:
            self.stills[name] = Image.open(f'{gfx.ROOT}/docs/img/{name}').convert('RGB')
        return self.stills[name]

    def g(self, src, s, zoom=1.0, cx=0.5, cy=0.5, shk=0.0, i=0, blend=True, prefix=''):
        img = src.blend(s, prefix) if blend else src.get(round(s), prefix)
        dx, dy = shake(i, shk * img.width / W) if shk else (0, 0)
        return view(img, img.width * cx + dx, img.height * cy + dy, img.width / zoom).convert('RGBA')

    # ---- a short "prompt" beat in the studio: typing, Claude's cards, the result in the stage ----
    def prompt_beat(self, key, k, n_frames, typing, hold, think, cards, top_caption=None, result_caption=None, start=0.0):
        u, m = self.ui[key], self.mk[key]
        kstart = m['k0'] + round(start * (m['k1'] - m['k0']))
        t0, t1 = typing, typing + hold
        if k < t0:                                     # typing (sped up to fit)
            n = kstart + round(k * (m['k1'] - kstart) / max(1, t0 - 1))
            img = view(u.full(n), 3410, 1960, 870).convert('RGBA')
        elif k < t1:
            img = view(u.full(m['k1'] + 1), 3410, 1960, 870).convert('RGBA')
        elif k < t1 + think:                           # sent: thinking
            n = m['enter'] + 1 + round((k - t1) * (m['tools'] - m['enter'] - 2) / max(1, think))
            img = view(u.full(n), 3385, 400, 900).convert('RGBA')
        elif k < t1 + think + cards:                   # the tool cards
            n = m['tools'] + round((k - t1 - think) * (m['spawn'] - m['tools']) / max(1, cards))
            img = view(u.full(n), 3385, 400, 900).convert('RGBA')
        else:                                          # zoom out: the result in the game beside the chat
            kk = k - (t1 + think + cards)
            n = m['spawn'] + kk
            t = smooth(kk / min(7, max(3, (n_frames - (t1 + think + cards)) * 0.6)))
            img = view(u.full(n), 3385 - 1465 * t, 400 + 680 * t, 900 + 2940 * t).convert('RGBA')
            if result_caption and kk >= 2:   # (on the result)
                a = ease_out((kk - 2) / 4)
                band(img, 850, 990, 0.6 * a)
                caption(img, [result_caption], 868, size=88, alpha=a)
        if top_caption and k < t1:
            a = ease_out(k / 4)
            band(img, 90, 230, 0.5 * a)
            caption(img, [top_caption], 110, size=86, alpha=a)
        return img

    def prompt_keys(self, key, o0, typing, start=0.0):
        m = self.mk[key]
        kstart = m['k0'] + round(start * (m['k1'] - m['k0']))
        out = []
        for t in m['keyTimes']:
            n = m['first_key'] + t
            if n > kstart:
                out.append(o0 + (n - kstart) * (typing - 1) / max(1, m['k1'] - kstart))
        return out

    # The cut, as (name, frames); every boundary sits on a beat (12 frames) of the 150 BPM score.
    SEGS = [('hook', 48), ('studio', 48), ('car_ui', 48), ('car', 84), ('sg_ui', 24), ('sg', 96), ('kt_ui', 24), ('kt', 84),
            ('bw_ui', 84), ('bw_reveal', 48), ('bw_walk', 48), ('bw_grab', 48), ('bw_release', 48), ('bw_boom', 48),
            ('montage', 48), ('end', 90)]

    def seg(self, i):
        o = 0
        for name, n in self.SEGS:
            if i < o + n:
                return name, i - o, o
            o += n
        return 'end', i - (o - 90), o - 90

    def start_of(self, name):
        o = 0
        for n_, n in self.SEGS:
            if n_ == name:
                return o
            o += n

    def frame(self, i):
        G, R, Hh, C = self.G, self.R, self.Hh, self.C
        F = self.fight
        name, k, o = self.seg(i)
        if name == 'hook':
            if k < 16:
                img = self.g(F['alt'], G + 52 + k * 0.9, zoom=1.3 - k * 0.004, cx=0.52, cy=0.42, blend=False)
            elif k < 30:
                t = (k - 16) / 14
                img = self.g(F['hook'], R + t * (Hh + 1 - R), zoom=1.7 + t * 0.3, cx=0.56, cy=0.48, blend=False)
            elif k < 38:
                img = self.g(F['alt'], Hh + 4 + (k - 30), zoom=1.15, shk=26 * (1 - (k - 30) / 8), i=i)
                img = flash(img, 1 - (k - 30) / 3)
            else:
                t = (k - 38) / 9
                img = vhs(self.g(self.car['main'], 140 * (1 - t) ** 1.6, blend=False), i, 1.0 - 0.5 * t)
            if 30 <= k < 38:
                band(img, 380, 600, 0.82)
                caption(img, ['ONE SENTENCE.'], 420, size=170, scale=ease_back((k - 29) / 3))
            return img
        if name == 'studio':
            u = self.ui['castle'].full(min(44, k))
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
        if name == 'car_ui':
            return self.prompt_beat('car', k, 48, typing=18, hold=4, think=4, cards=8,
                                    top_caption='Just type what you want.', result_caption='Claude builds it. Live.')
        if name == 'car':
            cm, ca = self.car['main'], self.car['alt']
            if k < 24:
                return self.g(cm, 20 + k, zoom=1.08)
            if k < 46:
                img = self.g(cm, 48 + (k - 24), zoom=1.15, cx=0.55)
                return flash(img, 0.4 * (1 - (k - 24) / 3)) if k < 27 else img
            if k < 56:
                return self.g(ca, 66 + (k - 46), zoom=1.05)
            if k < 76:
                return self.g(cm, 86 + (k - 56), zoom=1.1)
            return self.g(cm, 128 + (k - 76), zoom=1.05)
        if name == 'sg_ui':
            return self.prompt_beat('shotgun', k, 24, typing=6, hold=2, think=2, cards=6, start=0.55)
        if name == 'sg':
            sm, f1 = self.sg['main'], self.sgE['fires'][0]
            fires = self.sgE['fires']
            if k < 6:
                img = self.g(sm, f1 - 6 + k, zoom=1.2, cy=0.47)
            elif k < 22:                               # the first blast in half speed
                img = self.g(sm, f1 + (k - 6) / 2, zoom=1.2 + 0.01 * (k - 6), cy=0.47, shk=10 * max(0, 1 - (k - 6) / 6), i=i, blend=False)
                if k - 6 < 3:
                    img = flash(img, 0.55 * (1 - (k - 6) / 3))
            elif k < 42:
                img = self.g(sm, fires[1] - 5 + (k - 22), zoom=1.4)
            elif k < 62:
                img = self.g(sm, fires[2] - 5 + (k - 42), zoom=1.4)
            elif k < 78:
                img = self.g(sm, fires[3] - 5 + (k - 62), zoom=1.4)
            else:
                img = self.g(sm, 110 + (k - 78), zoom=1.2)
            for fk in (6, 27, 47, 67):                     # a comic "BLAM!" on every blast
                if fk <= k < fk + 7:
                    caption(img, [('BLAM!', (255, 214, 70))], 150, size=150, scale=ease_back((k - fk) / 3), x=None)
            return img
        if name == 'kt_ui':
            return self.prompt_beat('katana', k, 24, typing=6, hold=2, think=2, cards=6, start=0.55)
        if name == 'kt':
            km, ka, f1 = self.kt['main'], self.kt['alt'], self.ktE['fires'][0]
            if k < 12:
                return self.g(km, f1 - 12 + k, zoom=1.2)
            if k < 28:
                return self.g(km, f1 + (k - 12) / 2, zoom=1.25, shk=8 * max(0, 1 - (k - 12) / 6), i=i, blend=False)
            if k < 40:
                return self.g(km, f1 + 8 + (k - 28), zoom=1.3)
            if k < 54:
                return self.g(ka, 58 + (k - 40), zoom=1.3)
            if k < 66:
                return self.g(km, 88 + (k - 54), zoom=1.3)
            return self.g(km, 101 + (k - 66), zoom=1.15)
        if name == 'bw_ui':
            return self.prompt_beat('castle', k, 84, typing=34, hold=4, think=8, cards=16, top_caption='And the boss fight?')
        if name == 'bw_reveal':
            img = self.g(F['main'], k, zoom=1.0 + 0.1 * (1 - ease_out(k / 6)), shk=12 * max(0, 1 - k / 10), i=i)
            img = flash(img, 0.9 * (1 - k / 4))
            a = ease_out((k - 12) / 6)
            if a > 0.01:
                band(img, 60, 200, 0.45 * a)
                caption(img, ['The real game.'], 80, size=96, alpha=a)
            return img
        if name == 'bw_walk':
            if k < 24:
                return self.g(F['main'], 80 + k, zoom=1.06)
            return self.g(F['main'], (G - 46) + (k - 24) * 40 / 24, zoom=1.8)
        if name == 'bw_grab':
            if k < 20:
                img = self.g(F['main'], G - 6 + k, zoom=1.4, cx=0.55, cy=0.55)
                return flash(img, 0.5 * (1 - k / 3)) if k < 3 else img
            return self.g(F['main'], G + 14 + (k - 20), zoom=1.35, cy=0.55)
        if name == 'bw_release':
            if k < 20:
                img = self.g(F['alt'], G + 42 + k, zoom=1.08, cy=0.46)
            elif k < 32:
                img = self.g(F['main'], R - 9 + (k - 20), zoom=1.06)
            else:
                t = (k - 32) / 16
                img = self.g(F['alt'], R + t * (Hh + 1 - R), zoom=1.0 + 0.15 * t, blend=False)
            if 28 <= k < 47:
                band(img, 90, 240, 0.6)
                caption(img, [('SO LONG-A BOWSER!', (255, 220, 90))], 110, size=104, scale=ease_back((k - 28) / 4))
            return img
        if name == 'bw_boom':
            if k < 6:
                img = self.g(F['alt'], Hh + 6 + k * 0.3, zoom=1.05, shk=24 * max(0, 1 - k / 6), i=i)
                img = flash(img, 1 - k / 4)
            else:
                img = self.g(F['bullet'], (k - 6) * 1.6, prefix='b', zoom=1.0 + 0.002 * (k - 6), blend=False)
                if k < 8:
                    img = flash(img, 0.6 * (1 - (k - 6) / 2))
                a = ease_out((k - 16) / 4)
                if a > 0.01:
                    band(img, 850, 1000, 0.72 * a)
                    caption(img, [('Free. Open source.', (255, 220, 90))], 870, size=96, alpha=a)
            return img
        if name == 'montage':
            j, kk = divmod(k, 12)
            nm, label, (cx, cy, cw) = MONTAGE[j]
            im = self.still(nm)
            img = view(im, im.width * cx, im.height * cy, im.width * cw / (1 + 0.05 * kk / 12)).convert('RGBA')
            band(img, 890, 1030, 0.5)
            pill(img, label, W // 2, 960, size=84, icon=gfx.logo(92))
            band(img, 60, 200, 0.62)
            caption(img, ['And so much more.'], 92, size=84)
            return img
        return gfx.end_card(k / FPS, bg=F['bullet'].get(60, 'b'))

    def timeline(self):
        G, R, Hh, C = self.G, self.R, self.Hh, self.C
        st = self.start_of
        f = f'{CAP}/fight/main'
        car, sg, kt = f'{CAP}/car/main', f'{CAP}/shotgun/main', f'{CAP}/katana/main'
        sf, k1 = self.sgE['fires'], self.ktE['fires'][0]
        keys = self.prompt_keys('car', st('car_ui'), 18) + self.prompt_keys('shotgun', st('sg_ui'), 6, 0.55) \
            + self.prompt_keys('katana', st('kt_ui'), 6, 0.55) + self.prompt_keys('castle', st('bw_ui'), 34)
        c0, s0, q0 = st('car'), st('sg'), st('kt')
        r0, w0, g0, l0, b0 = st('bw_reveal'), st('bw_walk'), st('bw_grab'), st('bw_release'), st('bw_boom')
        game = [
            (0, 16, f, G + 52, 0.9), (16, 30, f, R, (Hh + 1 - R) / 14), (30, 38, f, Hh + 4, 1.0),
            (c0, c0 + 24, car, 20, 1.0), (c0 + 24, c0 + 46, car, 48, 1.0), (c0 + 46, c0 + 56, car, 66, 1.0),
            (c0 + 56, c0 + 76, car, 86, 1.0), (c0 + 76, c0 + 84, car, 128, 1.0),
            (s0, s0 + 6, sg, sf[0] - 6, 1.0), (s0 + 6, s0 + 22, sg, sf[0], 0.5),
            (s0 + 22, s0 + 42, sg, sf[1] - 5, 1.0), (s0 + 42, s0 + 62, sg, sf[2] - 5, 1.0), (s0 + 62, s0 + 78, sg, sf[3] - 5, 1.0),
            (s0 + 78, s0 + 96, sg, 110, 1.0),
            (q0, q0 + 12, kt, k1 - 12, 1.0), (q0 + 12, q0 + 28, kt, k1, 0.5), (q0 + 28, q0 + 40, kt, k1 + 8, 1.0),
            (q0 + 40, q0 + 54, kt, 58, 1.0), (q0 + 54, q0 + 66, kt, 88, 1.0), (q0 + 66, q0 + 84, kt, 101, 1.0),
            (r0, r0 + 48, f, 0, 1.0), (w0, w0 + 24, f, 80, 1.0), (w0 + 24, w0 + 48, f, G - 46, 40 / 24),
            (g0, g0 + 20, f, G - 6, 1.0), (g0 + 20, g0 + 48, f, G + 14, 1.0), (l0, l0 + 20, f, G + 42, 1.0),
            (l0 + 20, l0 + 29, f, R - 9, 1.0), (b0, b0 + 6, f, Hh, 1.0)]
        def beat_ui(name, typing, hold, think, cards):
            o = st(name)
            return o + typing + hold, o + typing + hold + think, o + typing + hold + think + cards
        enters, cards, results = [], [], []
        for nm, a in (('car_ui', (18, 4, 4, 8)), ('sg_ui', (6, 2, 2, 6)), ('kt_ui', (6, 2, 2, 6)), ('bw_ui', (34, 4, 8, 16))):
            e, c_, r = beat_ui(nm, *a)
            enters.append(e); cards.append(c_); results.append(r)
        return dict(N=self.N, keys=keys, game=game, enters=enters, cards=cards, results=results,
                    drops=[c0, s0, q0, r0],
                    car=dict(launch=c0 + 24, drift=c0 + 56, away=c0 + 76),
                    shots=[s0 + 6, s0 + 27, s0 + 47, s0 + 67], slashes=[q0 + 12, q0 + 40 + (self.ktE['fires'][1] - 58) if len(self.ktE['fires']) > 1 else q0 + 46],
                    release_out=l0 + 29, boom=b0, montage=st('montage'), end=st('end'), music_sections=self.SEGS)

def render(out_dir, half=False, only=None):
    os.makedirs(out_dir, exist_ok=True)
    c = Cut2()
    json.dump(c.timeline(), open(f'{out_dir}/timeline.json', 'w'))
    for i in (only if only is not None else range(c.N)):
        img = c.frame(i).convert('RGB')
        if half:
            img = img.resize((W // 2, H // 2), Image.BILINEAR)
        img.save(f'{out_dir}/{i:04d}.jpg', quality=92)
        if i % 100 == 0:
            print('frame', i, flush=True)

if __name__ == '__main__':
    if sys.argv[1] == 'frames':
        only = None
        if len(sys.argv) > 4:
            a, b = map(int, sys.argv[4].split(':')); only = range(a, b)
        render(sys.argv[2], half=len(sys.argv) > 3 and sys.argv[3] == 'half', only=only)
