# -*- coding: utf-8 -*-
"""Genera los iconos de FullShot. Correr con: python tools/make-icons.py

El concepto: corchetes de encuadre (el lenguaje de "captura") alrededor de una
pagina con contenido. Hay tres niveles de detalle porque un solo dibujo escalado
a 16 px se convierte en manchas: los corchetes se ensucian y la pagina se pierde.
"""
import os
from PIL import Image, ImageDraw

BLUE  = (37, 99, 235, 255)      # #2563eb, el mismo accent del visor
WHITE = (255, 255, 255, 255)
LINE  = (167, 195, 248, 255)    # el "texto" de la pagina

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "icons")


def _bg(S, radius_at_512):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=int(radius_at_512 * S / 512.0), fill=BLUE)
    return img, d


def _brackets(d, S, t, L, m):
    """Corchetes en las cuatro esquinas. t = grosor, L = largo, m = margen."""
    for cx, sx in ((m, 1), (S - m, -1)):
        for cy, sy in ((m, 1), (S - m, -1)):
            d.rounded_rectangle((min(cx, cx + sx * L), min(cy, cy + sy * t),
                                 max(cx, cx + sx * L), max(cy, cy + sy * t)),
                                radius=t / 2, fill=WHITE)
            d.rounded_rectangle((min(cx, cx + sx * t), min(cy, cy + sy * L),
                                 max(cx, cx + sx * t), max(cy, cy + sy * L)),
                                radius=t / 2, fill=WHITE)


def detailed(S=512):
    """128 y 48 px: pagina con cinco lineas y corchetes finos."""
    img, d = _bg(S, 112)
    u = S / 512.0
    d.rounded_rectangle((150 * u, 74 * u, 362 * u, S - 74 * u), radius=int(16 * u), fill=WHITE)
    for i in range(5):
        y = (116 + i * 60) * u
        w = 338 if i % 3 != 2 else 292          # una linea corta, como parrafo que termina
        d.rounded_rectangle((174 * u, y, w * u, y + 20 * u), radius=int(10 * u), fill=LINE)
    _brackets(d, S, 30 * u, 96 * u, 46 * u)
    return img


def medium(S=256):
    """32 px: corchetes mas gruesos y solo tres lineas."""
    img, d = _bg(S, 56)
    u = S / 256.0
    d.rounded_rectangle((84 * u, 34 * u, 172 * u, S - 34 * u), radius=int(9 * u), fill=WHITE)
    for i in range(3):
        y = (62 + i * 46) * u
        d.rounded_rectangle((98 * u, y, 158 * u, y + 14 * u), radius=int(7 * u), fill=LINE)
    _brackets(d, S, 18 * u, 52 * u, 22 * u)
    return img


def tiny(S=256):
    """16 px: sin corchetes. A ese tamano se vuelven manchas grises en las
    esquinas y ensucian todo, asi que la pagina crece y ocupa el espacio."""
    img, d = _bg(S, 56)
    u = S / 256.0
    d.rounded_rectangle((68 * u, 20 * u, 188 * u, S - 20 * u), radius=int(12 * u), fill=WHITE)
    for i in range(4):
        y = (52 + i * 46) * u
        w = 166 if i % 2 == 0 else 142
        d.rounded_rectangle((88 * u, y, w * u, y + 20 * u), radius=int(10 * u), fill=LINE)
    return img


if __name__ == "__main__":
    big_d, big_m, big_t = detailed(), medium(), tiny()
    for size, src in ((128, big_d), (48, big_d), (32, big_m), (16, big_t)):
        path = os.path.normpath(os.path.join(OUT, "icon%d.png" % size))
        src.resize((size, size), Image.LANCZOS).save(path)
        print("escrito", path)
