"""review sheet: review.py OUT.jpg pass:f,f,f ... (640 px wide frames, 2 per row)"""
import sys
from PIL import Image
out, specs = sys.argv[1], sys.argv[2:]
ims = []
for sp in specs:
    d, fs = sp.split(':')
    for f in fs.split(','):
        ims.append(Image.open(f'{d}/{int(f):04d}.jpg').resize((640, 360)))
g = Image.new('RGB', (1280, 360 * ((len(ims) + 1) // 2)))
for i, im in enumerate(ims): g.paste(im, ((i % 2) * 640, (i // 2) * 360))
g.save(out, quality=85)
