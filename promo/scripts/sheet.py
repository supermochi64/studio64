"""Contact sheets with burned-in timestamps (for the dramaturgy review and my own checks).
    python sheet.py <frames dir> <out prefix> [every=6] [cols=6]"""
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont
d, out = sys.argv[1], sys.argv[2]
every = int(sys.argv[3]) if len(sys.argv) > 3 else 6
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 6
fs = sorted(glob.glob(f'{d}/[0-9][0-9][0-9][0-9].jpg'))
fs = [f for f in fs if int(os.path.basename(f)[:4]) % every == 0]
tw, th = 480, 270
f = ImageFont.truetype(os.path.join(os.path.dirname(__file__), '..', 'work', 'fonts', 'Inter.ttf'), 22)
per = cols * 6
for p in range(0, len(fs), per):
    chunk = fs[p:p + per]
    rows = (len(chunk) + cols - 1) // cols
    s = Image.new('RGB', (cols * tw, rows * th), (0, 0, 0))
    for i, fp in enumerate(chunk):
        im = Image.open(fp).convert('RGB').resize((tw, th))
        n = int(os.path.basename(fp)[:4])
        dr = ImageDraw.Draw(im)
        dr.rectangle((0, 0, 150, 28), fill=(0, 0, 0))
        dr.text((5, 2), f'{n / 30:5.2f}s  f{n}', font=f, fill=(255, 255, 0))
        s.paste(im, ((i % cols) * tw, (i // cols) * th))
    s.save(f'{out}_{p // per:02d}.jpg', quality=85)
    print(f'{out}_{p // per:02d}.jpg')
