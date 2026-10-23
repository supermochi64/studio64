"""contact sheet: sheet.py OUT.jpg DIR [DIR...] (every Nth frame, env STEP)"""
import os, sys, glob
from PIL import Image
out, dirs = sys.argv[1], sys.argv[2:]
step = int(os.environ.get('STEP', 20)); w = int(os.environ.get('TW', 320)); h = w * 9 // 16
rows = []
for d in dirs:
    fs = sorted(glob.glob(d + '/*.jpg'))[::step]
    rows.append([Image.open(f).resize((w, h)) for f in fs])
cols = max(len(r) for r in rows)
g = Image.new('RGB', (cols * w, len(rows) * h))
for j, r in enumerate(rows):
    for i, im in enumerate(r): g.paste(im, (i * w, j * h))
g.save(out, quality=85)
