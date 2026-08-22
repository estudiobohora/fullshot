# -*- coding: utf-8 -*-
"""Renders the promotional tiles for the Chrome Web Store listing.

Small tile 440x280 (shown on the listing) and marquee 1400x560 (only used if
Google features the extension, but the form asks for it).

Run with: python tools/make-promo-tile.py

Georgia and Segoe UI stand in for the brand's Playfair Display and Inter, which
are web fonts and are not installed locally. Output goes to store-assets/.
"""
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'store-assets'))
ICON = os.path.normpath(os.path.join(HERE, '..', 'icons', 'icon128.png'))
os.makedirs(OUT, exist_ok=True)

NAVY = (13, 27, 42)
PAPER = (240, 237, 232)
BRASS = (201, 171, 76)
MUTED = (139, 152, 165)

def tile(W, H, k):
    """k scales every measurement, so both sizes share one layout."""
    img = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, int(6 * k), H), fill=BRASS)      # franja de acento

    serif = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", int(46 * k))
    sans = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", int(17 * k))
    sans_b = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", int(14 * k))

    side = int(72 * k)
    icon = Image.open(ICON).convert("RGBA").resize((side, side), Image.LANCZOS)
    img.paste(icon, (int(40 * k), int(44 * k)), icon)

    d.text((int(132 * k), int(52 * k)), "FullShot", font=serif, fill=PAPER)
    d.text((int(134 * k), int(106 * k)), "FULL PAGE SCREEN CAPTURE", font=sans_b, fill=BRASS)
    d.line((int(40 * k), int(168 * k), W - int(40 * k), int(168 * k)), fill=(42, 52, 66), width=1)

    for i, line in enumerate([
        "The whole page, not just the screen.",
        "PNG, JPG or PDF. Nothing leaves your computer.",
    ]):
        d.text((int(40 * k), int(190 * k) + i * int(26 * k)), line,
               font=sans, fill=MUTED if i else PAPER)
    return img


for w, h, k, name in ((440, 280, 1.0, "promo-tile-440x280"),
                      (1400, 560, 2.0, "promo-marquee-1400x560")):
    path = os.path.join(OUT, name + ".png")
    tile(w, h, k).save(path)
    print("escrito:", path, (w, h))
