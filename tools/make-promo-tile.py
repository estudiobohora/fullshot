# -*- coding: utf-8 -*-
"""Renders the 440x280 promotional tile for the Chrome Web Store listing.

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

W, H = 440, 280
img = Image.new("RGB", (W, H), NAVY)
d = ImageDraw.Draw(img)

# Franja de acento a la izquierda, como en las tarjetas del feed.
d.rectangle((0, 0, 6, H), fill=BRASS)

serif = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", 46)
sans = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 17)
sans_b = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 14)

icon = Image.open(ICON).convert("RGBA").resize((72, 72), Image.LANCZOS)
img.paste(icon, (40, 44), icon)

d.text((132, 52), "FullShot", font=serif, fill=PAPER)
d.text((134, 106), "FULL PAGE SCREEN CAPTURE", font=sans_b, fill=BRASS)

d.line((40, 168, W - 40, 168), fill=(42, 52, 66), width=1)

for i, line in enumerate([
    "The whole page, not just the screen.",
    "PNG, JPG or PDF. Nothing leaves your computer.",
]):
    d.text((40, 190 + i * 26), line, font=sans, fill=MUTED if i else PAPER)

path = os.path.join(OUT, "promo-tile-440x280.png")
img.save(path)
print("escrito:", path, img.size)
