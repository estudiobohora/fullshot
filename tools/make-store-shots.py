# -*- coding: utf-8 -*-
"""Renders the Chrome Web Store screenshots at 1280x800.

Run with: python tools/make-store-shots.py

It loads the real viewer.html / viewer.js against a stubbed chrome.* API and a
generated page, then opens a different part of the UI in each scene. Output goes
to store-assets/, which is gitignored: regenerate rather than commit.

Rendering to PNG needs Chrome headless, same command as tools/make-icons.py
users. See store-listing.md for the rest of the submission.
"""
import io, os, base64
from PIL import Image, ImageDraw

REPO = r'C:/Users/angel/Projects/fullshot'
OUT = r'C:/Users/angel/Projects/fullshot/store-assets'
os.makedirs(OUT, exist_ok=True)

# Una "pagina web" larga y creible para que la captura no se vea vacia.
W, H = 1000, 2600
m = Image.new("RGB", (W, H), (255, 255, 255))
d = ImageDraw.Draw(m)
d.rectangle((0, 0, W, 88), fill=(247, 247, 250))
d.rounded_rectangle((44, 30, 210, 58), 7, fill=(60, 60, 70))
for i, x in enumerate((560, 690, 820)):
    d.rounded_rectangle((x, 34, x + 100, 54), 6, fill=(205, 205, 212))
d.rounded_rectangle((44, 150, 720, 226), 10, fill=(40, 40, 48))
d.rounded_rectangle((44, 250, 600, 282), 7, fill=(175, 175, 184))
d.rounded_rectangle((44, 296, 520, 328), 7, fill=(196, 196, 204))
d.rounded_rectangle((44, 380, 268, 434), 12, fill=(201, 171, 76))
y = 500
for band in range(5):
    d.rounded_rectangle((44, y, W - 44, y + 300), 14, fill=(243, 243, 247))
    d.rounded_rectangle((76, y + 34, 420, y + 62), 6, fill=(150, 150, 160))
    for k in range(3):
        d.rounded_rectangle((76, y + 96 + k * 40, W - 120 - k * 60, y + 118 + k * 40), 5, fill=(206, 206, 214))
    y += 340
buf = io.BytesIO(); m.save(buf, format="PNG")
shot = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

html = io.open(os.path.join(REPO, 'viewer.html'), encoding='utf-8').read()
settings = io.open(os.path.join(REPO, 'settings.js'), encoding='utf-8').read()
viewer = io.open(os.path.join(REPO, 'viewer.js'), encoding='utf-8').read()

shim = """
const FAKE = { shots: [{ y: 0, x: 0, dataUrl: "%s" }],
  viewportWidth: 1000, stepPx: 2600, scale: 1, totalWidth: 1000, totalHeight: 2600,
  title: "Process Automation", url: "https://www.tooltank.io/process-automation",
  createdAt: Date.now(), sourceTabId: 7 };
window.chrome = {
  storage: { sync: { _d: {}, async get(d){ return Object.assign({}, d, this._d); }, async set(v){ Object.assign(this._d, v); } },
             local: { async get(k){ return { [k]: FAKE }; }, async remove(){} },
             onChanged: { addListener(){} } },
  runtime: { async sendMessage(){ return { ok:false }; }, getURL: x => x },
  downloads: { async download(){ throw new Error("no"); } },
};
window.URLSearchParams = function(){ return { get: () => "demo" }; };
""" % shot

ESCENAS = {
  '01-vista-previa': '',
  '02-menu-descarga': 'document.getElementById("dlmenu").classList.remove("hidden");'
                      'document.getElementById("dl").setAttribute("aria-expanded","true");',
  '03-ajustes': 'document.getElementById("settings").classList.remove("hidden");'
                'document.getElementById("gear").classList.add("open");',
}

for name, extra in ESCENAS.items():
    boot = '<script>setTimeout(() => { %s }, 900);</script>' % extra if extra else ''
    page = html.replace('<script src="settings.js"></script>',
                        '<script>%s</script>\n<script>%s</script>' % (shim, settings))
    page = page.replace('<script src="viewer.js"></script>',
                        '<script>%s</script>%s' % (viewer, boot))
    p = os.path.join(OUT, name + '.html')
    io.open(p, 'w', encoding='utf-8').write(page)
    print('escrito:', name + '.html')
