#!/usr/bin/env python3
"""Elegant gold rarity badge in the lower-right corner, matching the concept card.
No VW model names. Tier labels are COMMON / RARE / EPIC."""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

TIER = {
    'common': 'COMMON',
    'rare': 'RARE',
    'epic': 'EPIC',
}
GOLD = (212, 175, 55, 255)
GOLD_DIM = (168, 132, 42, 240)
GOLD_LIGHT = (240, 214, 120, 255)


def font(size, bold=False, serif=False):
    paths = []
    if serif:
        paths += [
            '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
        ]
    paths += [
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ]
    for path in paths:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _crown(draw, cx, cy, w, h, color):
    # Three-point crown sitting on the top frame edge.
    band = h * 0.28
    pts = [
        (cx - w / 2, cy + h / 2),
        (cx - w / 2, cy + h / 2 - band),
        (cx - w * 0.33, cy + h * 0.05),
        (cx - w * 0.16, cy + h * 0.22),
        (cx, cy - h / 2),
        (cx + w * 0.16, cy + h * 0.22),
        (cx + w * 0.33, cy + h * 0.05),
        (cx + w / 2, cy + h / 2 - band),
        (cx + w / 2, cy + h / 2),
    ]
    draw.polygon(pts, fill=color)
    # jewels
    r = max(1, int(w * 0.05))
    for x in (cx - w * 0.33, cx, cx + w * 0.33):
        draw.ellipse((x - r, cy - h * 0.15 - r, x + r, cy - h * 0.15 + r), fill=GOLD_LIGHT)


def overlay(src, dst, rarity, serial):
    im = Image.open(src).convert('RGBA')
    w, h = im.size
    tag = TIER[rarity]
    overlay_im = Image.new('RGBA', im.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay_im)

    # Badge box — lower right, elegant gold double frame like the concept.
    bw, bh = int(w * 0.22), int(h * 0.075)
    x1, y1 = w - bw - int(w * 0.045), h - bh - int(h * 0.045)
    x2, y2 = x1 + bw, y1 + bh
    # soft dark plate behind the gold so it reads on any floor
    pad = 6
    draw.rounded_rectangle((x1 - pad, y1 - pad, x2 + pad, y2 + pad), radius=4, fill=(8, 8, 10, 160))
    # outer frame
    draw.rectangle((x1, y1, x2, y2), outline=GOLD, width=2)
    # inner frame
    inset = 5
    draw.rectangle((x1 + inset, y1 + inset, x2 - inset, y2 - inset), outline=GOLD_DIM, width=1)

    # crown centered on the top edge
    cw, ch = int(bw * 0.22), int(bh * 0.42)
    _crown(draw, (x1 + x2) / 2, y1 - 1, cw, ch, GOLD)

    # tracked tier name
    f_tag = font(int(h * 0.022), bold=True, serif=True)
    spaced = '  '.join(tag)
    # measure and center
    bbox = draw.textbbox((0, 0), spaced, font=f_tag)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = x1 + (bw - tw) / 2
    ty = y1 + (bh - th) / 2 - 1
    draw.text((tx, ty), spaced, fill=GOLD, font=f_tag)

    im = Image.alpha_composite(im, overlay_im)
    im.convert('RGB').save(dst, 'PNG', optimize=True)
    print('wrote', dst, im.size)


if __name__ == '__main__':
    overlay(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]))
