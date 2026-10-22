"""Shared graphics for the trailer edit: fonts, captions, the end card, the logo."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont
import numpy as np, os
W, H = 1920, 1080
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONT = f'{ROOT}/promo/work/fonts/Inter.ttf'
_fc = {}
def font(size, weight='Black'):
    k = (size, weight)
    if k not in _fc:
        f = ImageFont.truetype(FONT, size)
        f.set_variation_by_name(weight)
        _fc[k] = f
    return _fc[k]

ACCENT = (255, 200, 61)      # the Studio 64 star yellow
def text_size(txt, f):
    b = f.getbbox(txt)
    return b[2] - b[0], b[3] - b[1], b[1]

def caption(img, lines, y, size=96, weight='Black', color=(255, 255, 255), accent=None, alpha=1.0, scale=1.0,
            shadow=True, align='center', x=None, tracking=0):
    """Big, phone-readable text with a soft dark shadow. lines: list of strings or (string, color)."""
    size = max(8, int(size * scale))
    f = font(size, weight)
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    yy = y
    for ln in lines:
        txt, col = (ln, color) if isinstance(ln, str) else ln
        w, h, top = text_size(txt, f)
        xx = (img.size[0] - w) // 2 if x is None else x
        if shadow:
            sh = Image.new('RGBA', img.size, (0, 0, 0, 0))
            ImageDraw.Draw(sh).text((xx, yy - top + size * 0.05), txt, font=f, fill=(0, 0, 0, 200))
            sh = sh.filter(ImageFilter.GaussianBlur(size * 0.09))
            layer = Image.alpha_composite(layer, sh)
            d = ImageDraw.Draw(layer)
        d.text((xx, yy - top), txt, font=f, fill=col + (255,), stroke_width=max(1, size // 28), stroke_fill=(20, 16, 10, 255))
        yy += int(h * 1.22)
    if alpha < 1:
        a = np.array(layer); a[..., 3] = (a[..., 3] * alpha).astype(np.uint8); layer = Image.fromarray(a)
    img.alpha_composite(layer)
    return yy

def pill(img, txt, cx, cy, size=40, bg=(18, 19, 24, 230), fg=(255, 255, 255), alpha=1.0, icon=None):
    f = font(size, 'Bold')
    w, h, top = text_size(txt, f)
    padx, pady = int(size * 0.7), int(size * 0.45)
    ix = int(size * 1.15) if icon is not None else 0
    box = (cx - (w + ix) // 2 - padx, cy - h // 2 - pady, cx + (w + ix) // 2 + padx, cy + h // 2 + pady)
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle(box, radius=(box[3] - box[1]) // 2, fill=bg)
    if icon is not None:
        ic = icon.resize((int(size * 0.95), int(size * 0.95)), Image.LANCZOS)
        layer.alpha_composite(ic, (box[0] + padx, cy - ic.size[1] // 2))
    d.text((box[0] + padx + ix, cy - h // 2 - top), txt, font=f, fill=fg + (255,))
    if alpha < 1:
        a = np.array(layer); a[..., 3] = (a[..., 3] * alpha).astype(np.uint8); layer = Image.fromarray(a)
    img.alpha_composite(layer)

_logo = None
def logo(size):
    global _logo
    if _logo is None:
        _logo = Image.open(f'{ROOT}/promo/work/logo512.png').convert('RGBA')
    return _logo.resize((size, size), Image.LANCZOS)

def vignette(img, strength=0.45):
    w, h = img.size
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    m = np.clip((r - 0.55) / 0.9, 0, 1) ** 1.6 * strength
    a = np.array(img.convert('RGB')).astype(np.float32) * (1 - m[..., None])
    return Image.fromarray(a.astype(np.uint8)).convert('RGBA')

GITHUB = os.environ.get('PROMO_GITHUB', 'github.com/supermochi64/studio64')

def ease_out(t):
    t = min(max(t, 0.0), 1.0); return 1 - (1 - t) ** 3
def ease_back(t):
    t = min(max(t, 0.0), 1.0); c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2

def end_card(t, bg=None):
    """t = seconds since the card starts. bg: an RGB image to blur behind it (the blast)."""
    img = Image.new('RGBA', (W, H), (12, 13, 17, 255))
    if bg is not None:
        z = 1 + 0.03 * t   # a slow push
        bw, bh = bg.size
        bg = bg.crop((bw * (1 - 1 / z) / 2, bh * (1 - 1 / z) / 2, bw * (1 + 1 / z) / 2, bh * (1 + 1 / z) / 2))
        b = bg.convert('RGB').resize((W // 8, H // 8)).filter(ImageFilter.GaussianBlur(3)).resize((W, H), Image.BICUBIC)
        b = Image.blend(Image.new('RGB', (W, H), (12, 13, 17)), b, 0.32)
        img = b.convert('RGBA')
    # warm glow behind the logo
    g = Image.new('L', (W, H), 0); ImageDraw.Draw(g).ellipse((W // 2 - 520, 120, W // 2 + 520, 620), fill=90)
    g = g.filter(ImageFilter.GaussianBlur(140))
    glow = Image.new('RGBA', (W, H), ACCENT + (0,)); glow.putalpha(g.point(lambda v: int(v * min(1, t * 2.5))))
    img.alpha_composite(glow)
    s = ease_back(t / 0.3)
    L = int(230 * s)
    if L > 4:
        lg = logo(L)
        img.alpha_composite(lg, (W // 2 - L // 2, 300 - L // 2))
    a1 = ease_out(t / 0.07)          # the title lands with the logo, on the hit
    caption(img, ['Studio 64'], 450 + int(30 * (1 - a1)), size=150, alpha=a1)
    a2 = ease_out((t - 0.2) / 0.25)
    caption(img, ['Build your own Super Mario 64 hacks'], 640 + int(20 * (1 - a2)), size=60, weight='Bold', color=(236, 236, 240), alpha=a2)
    a3 = ease_out((t - 0.2) / 0.2)
    caption(img, [('Free & open source  ·  runs in your browser', ACCENT)], 734 + int(20 * (1 - a3)), size=58, weight='Bold', alpha=a3)
    a4 = ease_out((t - 0.55) / 0.25)
    if a4 > 0:
        pill(img, GITHUB, W // 2, 868, size=64, alpha=a4, bg=(112, 118, 156, 255))
    a5 = ease_out((t - 0.75) / 0.3)
    caption(img, [('Works without AI too', (235, 236, 242))], 948, size=54, weight='Bold', alpha=a5, shadow=False)
    caption(img, [('Needs your own copy of Super Mario 64  ·  Not affiliated with Nintendo', (120, 122, 130))], 1030, size=22,
            weight='Medium', alpha=a5, shadow=False)
    return img

def band(img, y0, y1, alpha=0.55, feather=60):
    """a soft dark band behind captions (readable on any picture)"""
    h = img.size[1]
    a = np.zeros(h, np.float32)
    ys = np.arange(h)
    a = np.clip(np.minimum((ys - (y0 - feather)) / feather, ((y1 + feather) - ys) / feather), 0, 1) * alpha
    layer = np.zeros((h, img.size[0], 4), np.uint8)
    layer[..., 3] = (a[:, None] * 255).astype(np.uint8)
    img.alpha_composite(Image.fromarray(layer))
