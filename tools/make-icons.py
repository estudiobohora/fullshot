# -*- coding: utf-8 -*-
"""Generates the FullShot icons. Run with: python tools/make-icons.py

The idea: framing brackets (the visual language of "capture") around a page with
content. There are three levels of detail because scaling a single drawing down
to 16 px turns it to mush: the brackets smudge and the page disappears.
"""
import os
from PIL import Image, ImageDraw

# ToolTank palette. Swap these four values to re-skin the whole icon set.
NAVY  = (13, 27, 42, 255)       # #0D1B2A  primary background
PAPER = (240, 237, 232, 255)    # #F0EDE8  Warm Off-White, the page
BRASS = (201, 171, 76, 255)     # #C9AB4C  Architectural Brass, the signature accent
LINE  = (156, 168, 178, 255)    # page text, blue-grey on the off-white

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")


def _bg(S, radius_at_512):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(radius_at_512 * S / 512.0), fill=NAVY)
    return img, d


def _brackets(d, S, t, L, m):
    """Framing brackets, in brass: the only accent element."""
    for cx, sx in ((m, 1), (S - m, -1)):
        for cy, sy in ((m, 1), (S - m, -1)):
            d.rounded_rectangle((min(cx, cx + sx * L), min(cy, cy + sy * t),
                                 max(cx, cx + sx * L), max(cy, cy + sy * t)),
                                radius=t / 2, fill=BRASS)
            d.rounded_rectangle((min(cx, cx + sx * t), min(cy, cy + sy * L),
                                 max(cx, cx + sx * t), max(cy, cy + sy * L)),
                                radius=t / 2, fill=BRASS)


def detailed(S=512):
    """128 and 48 px: page with five lines and thin brackets."""
    img, d = _bg(S, 112)
    u = S / 512.0
    d.rounded_rectangle((150 * u, 74 * u, 362 * u, S - 74 * u), radius=int(16 * u), fill=PAPER)
    for i in range(5):
        y = (116 + i * 60) * u
        w = 338 if i % 3 != 2 else 292          # one short line, like a paragraph ending
        d.rounded_rectangle((174 * u, y, w * u, y + 20 * u), radius=int(10 * u), fill=LINE)
    _brackets(d, S, 30 * u, 96 * u, 46 * u)
    return img


def medium(S=256):
    """32 px: thicker brackets and only three lines."""
    img, d = _bg(S, 56)
    u = S / 256.0
    d.rounded_rectangle((84 * u, 34 * u, 172 * u, S - 34 * u), radius=int(9 * u), fill=PAPER)
    for i in range(3):
        y = (62 + i * 46) * u
        d.rounded_rectangle((98 * u, y, 158 * u, y + 14 * u), radius=int(7 * u), fill=LINE)
    _brackets(d, S, 18 * u, 52 * u, 22 * u)
    return img


def tiny(S=256):
    """16 px: no brackets. At that size they turn into grey smudges in the
    corners and dirty the whole thing, so the page grows to fill the space."""
    img, d = _bg(S, 56)
    u = S / 256.0
    d.rounded_rectangle((68 * u, 20 * u, 188 * u, S - 20 * u), radius=int(12 * u), fill=PAPER)
    for i in range(4):
        y = (52 + i * 46) * u
        w = 166 if i % 2 == 0 else 142
        col = BRASS if i == 0 else LINE      # with no brackets, the accent comes in here
        d.rounded_rectangle((88 * u, y, w * u, y + 20 * u), radius=int(10 * u), fill=col)
    return img


if __name__ == "__main__":
    big_d, big_m, big_t = detailed(), medium(), tiny()
    for size, src in ((128, big_d), (48, big_d), (32, big_m), (16, big_t)):
        path = os.path.normpath(os.path.join(OUT, "icon%d.png" % size))
        src.resize((size, size), Image.LANCZOS).save(path)
        print("escrito", path)
