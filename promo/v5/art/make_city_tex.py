"""The revived city's textures: Codex's sheet (city_sheet_raw.png, 4x4) cut, made seamless, mapped onto the
Wet-Dry World town textures they replace. Writes city/<name>.png (256x256) and city/manifest.json."""
import json, math, os
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'city')
os.makedirs(OUT, exist_ok=True)
sheet = Image.open(os.path.join(HERE, 'city_sheet_raw.png')).convert('RGB')
ivy = Image.open(os.path.join(HERE, 'ivy_sheet.png')).convert('RGB')   # Codex's second sheet, 2x2: ivy, more ivy, terracotta tiles, white stucco
N = 256

def cell(i, inset=10):
    src, k = (ivy, 2) if isinstance(i, str) else (sheet, 4)
    if isinstance(i, str):
        i = int(i[1:])
    w = src.width / k
    x, y = (i % k) * w, (i // k) * w
    return src.crop((int(x + inset), int(y + inset), int(x + w - inset), int(y + w - inset))).resize((N, N), Image.LANCZOS)

def seamless(im, feather=0.22):
    """blend with its half-rolled copy near the edges (the rolled copy is continuous across them)"""
    a = np.asarray(im).astype(np.float32)
    r = np.roll(np.roll(a, N // 2, 0), N // 2, 1)
    t = np.minimum(np.arange(N), N - 1 - np.arange(N)) / (N * feather)
    w1 = np.clip(t, 0, 1)
    w = np.minimum.outer(w1, w1)[..., None]
    w = w * w * (3 - 2 * w)
    return Image.fromarray((a * w + r * (1 - w)).clip(0, 255).astype(np.uint8))

def lattice():
    """white wrought iron with curls, transparent between"""
    S = 4 * N
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    col = (250, 250, 246, 255)
    w = 18
    for k in range(0, S + 1, S // 2):
        d.line((k, 0, k, S), fill=col, width=w * 2 if k in (0, S) else w)
        d.line((0, k, S, k), fill=col, width=w * 2 if k in (0, S) else w)
    for cx in (S // 4, 3 * S // 4):
        for cy in (S // 4, 3 * S // 4):
            r = S // 4 - 30
            d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=col, width=w)
            r2 = r // 2
            d.ellipse((cx - r2, cy - r2, cx + r2, cy + r2), outline=col, width=w - 4)
            for a in range(4):
                ang = a * math.pi / 2 + math.pi / 4
                d.line((cx + math.cos(ang) * r2, cy + math.sin(ang) * r2, cx + math.cos(ang) * r, cy + math.sin(ang) * r), fill=col, width=w - 6)
    im = im.resize((N, N), Image.LANCZOS)
    # a soft shade so it reads as metal
    px = np.asarray(im).astype(np.float32)
    yy = np.linspace(1.0, 0.86, N)[:, None, None]
    px[..., :3] *= yy
    return Image.fromarray(px.clip(0, 255).astype(np.uint8))

# Wet-Dry World town texture -> (cell or 'lattice', seamless)
MAP = {
    'textures/grass/wf_textures.08000.rgba16': ('i1', True),  # the basin's walls, the rim, the plaza mound -> ivy
    'textures/grass/wf_textures.07000.rgba16': ('i3', True),  # sandstone houses (walls and flat roofs) -> white stucco
    'textures/grass/wf_textures.04000.rgba16': ('i2', True),  # grey panel houses (and their flat roofs) -> terracotta terrace tiles
    'textures/grass/wf_textures.09000.rgba16': (3, True),    # red brick roofs -> terracotta tiles
    'textures/grass/wf_textures.08800.rgba16': (4, True),    # grey brick walls -> sandstone brick
    'textures/grass/wf_textures.09800.rgba16': (1, True),    # dark stone blocks -> butter-yellow stucco
    'levels/wdw/4.rgba16': (6, False),                      # the window
    'levels/wdw/1.rgba16': (7, True),                       # planks -> mint boards
    'textures/grass/wf_textures.00800.rgba16': (8, True),    # dark brick tower -> red brick
    'textures/grass/wf_textures.00000.rgba16': ('lattice', False),
    'textures/grass/wf_textures.01000.rgba16': (10, True),   # brown brick -> salmon plaster
    'textures/grass/wf_textures.03800.rgba16': (11, True),   # rubble -> pebble mosaic
    'levels/wdw/0.rgba16': (12, False),                     # crate
    'textures/grass/wf_textures.07800.rgba16': (13, True),   # diamond tile -> azulejo
    'textures/grass/wf_textures.02000.rgba16': (14, True),   # flowers
    'textures/grass/wf_textures.05800.rgba16': (15, True),   # grass
}
manifest = {}
for path, (src, seam) in MAP.items():
    # the town's big wire cages: gone (an invisible texture), the views open up
    im = Image.new('RGBA', (32, 32), (0, 0, 0, 0)) if src == 'lattice' else cell(src)
    if seam:
        im = seamless(im)
    name = path.split('/')[-1].replace('.rgba16', '') + '.png'
    im.save(os.path.join(OUT, name))
    manifest[path] = name
json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
# a check sheet: each texture 2x2 tiled (seams show)
chk = Image.new('RGB', (8 * 260, 2 * 260), (40, 40, 40))
for i, (path, name) in enumerate(manifest.items()):
    im = Image.open(os.path.join(OUT, name)).convert('RGBA')
    t = Image.new('RGBA', (2 * N, 2 * N), (60, 60, 60, 255))
    for k in range(4): t.alpha_composite(im, ((k % 2) * N, (k // 2) * N))
    chk.paste(t.convert('RGB').resize((256, 256)), ((i % 8) * 260, (i // 8) * 260))
chk.save(os.path.join(HERE, 'city_check.jpg'), quality=88)
print(len(manifest), 'textures')
