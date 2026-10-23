"""Peach's window, broken (Bowser came through): the two castle-grounds textures (levels/castle_grounds/1 = bottom,
2 = top, 64x32 each) stacked, upscaled, a jagged hole in the glass with the dark hall behind, cracks round it.
Writes window/top.png and window/bottom.png (256x128 each) and window/full.png."""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.expanduser('~/Documents/m64/studio64/engine/levels/castle_grounds')
top = Image.open(f'{SRC}/2.rgba16.png').convert('RGBA'); bot = Image.open(f'{SRC}/1.rgba16.png').convert('RGBA')
win = Image.new('RGBA', (64, 64)); win.paste(top, (0, 0)); win.paste(bot, (0, 32))
S = 512
win = win.resize((S, S), Image.BICUBIC)
rnd = random.Random(7)
cx, cy = S * 0.5, S * 0.56
# the hole: a jagged star
pts = []
for i in range(26):
    a = i / 26 * math.tau
    r = (0.30 if i % 2 else 0.20) * S * (0.8 + rnd.random() * 0.45)
    pts.append((cx + math.cos(a) * r * 0.78, cy + math.sin(a) * r))
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).polygon(pts, fill=255)
# the glass only (the stone frame stays): pixels inside the arch's inner area
inner = Image.new('L', (S, S), 0)
ImageDraw.Draw(inner).rounded_rectangle((S * 0.13, S * 0.08, S * 0.87, S * 0.97), radius=int(S * 0.36), fill=255)
mask = Image.fromarray(np.minimum(np.asarray(mask), np.asarray(inner)))
# behind: the dark hall, a warm glow low in it
yy, xx = np.mgrid[0:S, 0:S]
glow = np.exp(-(((xx - cx) / (S * 0.35)) ** 2 + ((yy - S * 0.85) / (S * 0.3)) ** 2))
hall = np.zeros((S, S, 4), np.float32)
hall[..., 0] = 18 + 90 * glow; hall[..., 1] = 12 + 50 * glow; hall[..., 2] = 22 + 20 * glow; hall[..., 3] = 255
out = np.asarray(win).astype(np.float32)
m = (np.asarray(mask) / 255.0)[..., None]
out = out * (1 - m) + hall * m
img = Image.fromarray(out.clip(0, 255).astype(np.uint8))
# cracks: lines from the hole's edge outward, glass edge highlights
d = ImageDraw.Draw(img)
for p in pts:
    a = math.atan2(p[1] - cy, p[0] - cx) + rnd.uniform(-0.25, 0.25)
    x, y = p
    for k in range(rnd.randint(2, 4)):
        L = rnd.uniform(20, 60)
        nx, ny = x + math.cos(a) * L, y + math.sin(a) * L
        if np.asarray(inner)[int(min(S - 1, max(0, ny))), int(min(S - 1, max(0, nx)))] == 0:
            break
        d.line((x, y, nx, ny), fill=(255, 255, 255, 230), width=3)
        d.line((x + 1, y + 1, nx + 1, ny + 1), fill=(40, 30, 40, 200), width=2)
        x, y = nx, ny
        a += rnd.uniform(-0.5, 0.5)
d.line(pts + [pts[0]], fill=(250, 245, 230, 255), width=4)
img.save(os.path.join(HERE, 'window', 'full.png'))
img.resize((256, 256), Image.LANCZOS).crop((0, 0, 256, 128)).save(os.path.join(HERE, 'window', 'top.png'))
img.resize((256, 256), Image.LANCZOS).crop((0, 128, 256, 256)).save(os.path.join(HERE, 'window', 'bottom.png'))
# the glass colours, for the shards
cols = np.asarray(win.resize((32, 32)))[4:30, 6:26].reshape(-1, 4)
pal = [tuple(int(v) for v in c[:3]) for c in cols if c[3] > 200 and max(c[:3]) > 80 and not (abs(int(c[0]) - int(c[1])) < 18 and abs(int(c[1]) - int(c[2])) < 18)]
import json
json.dump(pal[:: max(1, len(pal) // 40)], open(os.path.join(HERE, 'window', 'palette.json'), 'w'))
print('palette', len(pal))
