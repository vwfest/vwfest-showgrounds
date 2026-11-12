#!/usr/bin/env python3
"""Add a rarity tag overlay to a 1:1 NFT render. No VW model names."""
import sys
from PIL import Image, ImageDraw, ImageFont

TIER = {
    'common': ('COMMON', (184, 192, 204)),
    'rare': ('RARE', (78, 168, 255)),
    'epic': ('EPIC', (180, 107, 255)),
}

def font(size, bold=False):
    for path in (
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
        '/workspace/tools/blender-4.5.16-linux-x64/4.5/datafiles/fonts/Inter.woff2',
    ):
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()

def overlay(src, dst, rarity, serial):
    im = Image.open(src).convert('RGBA')
    w, h = im.size
    tag, color = TIER[rarity]
    draw = ImageDraw.Draw(im)
    bar_h = int(h * 0.11)
    # bottom bar
    for i in range(bar_h):
        a = int(210 * (i / bar_h) ** 0.6)
        draw.line([(0, h - bar_h + i), (w, h - bar_h + i)], fill=(8, 9, 12, a))
    f_tag = font(int(h * 0.042), bold=True)
    f_name = font(int(h * 0.034), bold=True)
    f_sub = font(int(h * 0.022), bold=False)
    y = h - bar_h + int(bar_h * 0.22)
    draw.text((int(w * 0.05), y), tag, fill=color + (255,), font=f_tag)
    tw = draw.textlength(tag, font=f_tag)
    draw.text((int(w * 0.05) + tw + 16, y + 2), 'BUBBLE', fill=(244, 241, 234, 255), font=f_name)
    draw.text((int(w * 0.05), y + int(h * 0.046)), f'VWFEST  ·  SHOW GROUNDS  ·  #{serial:04d}', fill=(200, 205, 214, 255), font=f_sub)
    # top-right diamond cue on epic only
    if rarity == 'epic':
        f_s = font(int(h * 0.02), bold=True)
        draw.text((int(w * 0.62), int(h * 0.04)), 'GOLD  ·  DIAMOND PLATE', fill=(201, 162, 39, 230), font=f_s)
    im.convert('RGB').save(dst, 'PNG', optimize=True)
    print('wrote', dst, im.size)

if __name__ == '__main__':
    # args: src dst rarity serial
    overlay(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]))
