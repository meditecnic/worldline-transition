#!/usr/bin/env python3
"""Contact sheet of captured frames: python3 scripts/sheet.py <dir> <out.jpg> [cols] [glob]"""
import sys, glob, os
from PIL import Image, ImageDraw

d = sys.argv[1]
out = sys.argv[2]
cols = int(sys.argv[3]) if len(sys.argv) > 3 else 4
pat = sys.argv[4] if len(sys.argv) > 4 else '*.png'
files = sorted(glob.glob(os.path.join(d, pat)), key=lambda f: (len(f), f))
tw = 480
ims = []
for f in files:
    im = Image.open(f).convert('RGB')
    im = im.resize((tw, int(im.height * tw / im.width)))
    dr = ImageDraw.Draw(im)
    label = os.path.basename(f).rsplit('.', 1)[0]
    dr.rectangle([0, 0, 8 + 7 * len(label), 16], fill=(0, 0, 0))
    dr.text((4, 2), label, fill=(255, 200, 120))
    ims.append(im)
rows = (len(ims) + cols - 1) // cols
th = ims[0].height
sheet = Image.new('RGB', (cols * tw + (cols - 1) * 4, rows * th + (rows - 1) * 4), (20, 20, 20))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * (tw + 4), (i // cols) * (th + 4)))
sheet.save(out, quality=88)
print(out, len(ims))
