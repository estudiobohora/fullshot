// FullShot — viewer: stitches the slices, shows the preview and exports.

const MAX_DIM = 32000;      // practical canvas dimension limit in Chrome
const MAX_AREA = 250e6;     // practical area limit
const PDF_MAX_PT = 14400;   // 200 inches: maximum PDF page width/height

const $ = (id) => document.getElementById(id);
const els = {
  note: $("note"),
  status: $("status"),
  preview: $("preview"),
  png: $("png"),
  jpg: $("jpg"),
  pdf: $("pdf"),
  copy: $("copy"),
  again: $("again"),
  gear: $("gear"),
  settingsPanel: $("settings"),
  name: $("name"),
  quality: $("quality"),
  qval: $("qval"),
  hideFixed: $("hideFixed"),
  dl: $("dl"),
  dlmenu: $("dlmenu"),
  shell: $("shell"),
  crop: $("crop"),
  uncrop: $("uncrop"),
  sel: $("sel"),
  selhint: $("selhint"),
};

let canvas = null;
let baseName = "screenshot";
let settings = Object.assign({}, FS_DEFAULTS);
let sourceTabId = null;
let source = null;              // title / url / createdAt of the capture
let fullCanvas = null;          // the uncropped capture, kept so a crop can be undone

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read one slice of the capture."));
    img.src = src;
  });
}

function showNote(text) {
  els.note.textContent = text;
  els.note.classList.remove("hidden");
}

function fail(text) {
  els.status.textContent = text;
  els.png.disabled = els.jpg.disabled = els.pdf.disabled = els.copy.disabled = true;
  els.again.disabled = true;
}

async function build() {
  settings = await fsGetSettings();
  fillSettingsPanel();

  const key = new URLSearchParams(location.search).get("key");
  if (!key) return fail("There is no capture to show.");

  const stored = (await chrome.storage.local.get(key))[key];
  if (!stored || !stored.shots || !stored.shots.length) {
    return fail("The capture expired or was not found. Try again.");
  }
  await chrome.storage.local.remove(key);

  sourceTabId = typeof stored.sourceTabId === "number" ? stored.sourceTabId : null;
  if (sourceTabId === null) els.again.disabled = true;

  source = {
    title: stored.title,
    url: stored.url,
    date: new Date(stored.createdAt || Date.now()),
  };
  refreshBaseName();

  const images = [];
  for (const shot of stored.shots) images.push({ img: await loadImage(shot.dataUrl), y: shot.y });

  const first = images[0].img;
  // Captures come scaled by the display devicePixelRatio.
  const scale = first.naturalWidth / stored.viewportWidth;

  const rawW = first.naturalWidth;
  // Real height covered by the slices. If for some reason the page would not
  // let us reach the bottom, we crop instead of leaving a white band.
  const covered = Math.max(
    ...images.map(({ img, y }) => y + img.naturalHeight / scale)
  );
  const rawH = Math.round(Math.min(stored.totalHeight, covered) * scale);

  let f = Math.min(1, MAX_DIM / rawW, MAX_DIM / rawH, Math.sqrt(MAX_AREA / (rawW * rawH)));
  if (!isFinite(f) || f <= 0) f = 1;

  canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rawW * f));
  canvas.height = Math.max(1, Math.round(rawH * f));

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (const { img, y } of images) {
    ctx.drawImage(
      img,
      0,
      y * scale * f,
      img.naturalWidth * f,
      img.naturalHeight * f
    );
  }

  if (f < 1) {
    showNote(
      `The page is taller than a Chrome canvas can hold, so it was scaled down to ${Math.round(f * 100)}% ` +
      `(${canvas.width}×${canvas.height} px). The content is all there, just at lower resolution.`
    );
  }

  // Region mode hands over a full-viewport shot plus the rectangle to keep.
  if (stored.region) {
    const rg = stored.region;
    const rx = Math.round(rg.x * f), ry = Math.round(rg.y * f);
    const cut = document.createElement("canvas");
    cut.width  = Math.max(1, Math.min(Math.round(rg.width  * f), canvas.width  - rx));
    cut.height = Math.max(1, Math.min(Math.round(rg.height * f), canvas.height - ry));
    const rctx = cut.getContext("2d", { alpha: false });
    rctx.drawImage(canvas, rx, ry, cut.width, cut.height, 0, 0, cut.width, cut.height);
    canvas = cut;
  }

  fullCanvas = canvas;          // kept so Undo crop can restore it
  els.preview.src = canvas.toDataURL("image/png");
  els.preview.classList.remove("hidden");

  // The status starts as "Stitching the slices…" written into the HTML and
  // nobody cleared it, so a finished capture still said it was working. With a
  // tall preview, which takes a moment to paint, the tab looked stuck.
  els.status.textContent = "";
  els.status.classList.add("hidden");
  els.status.classList.add("hidden");
}

// baseName is the fallback used when the box is left empty, so the box can stay
// empty and show its placeholder instead of arriving pre-filled.
function refreshBaseName() {
  if (source) baseName = fsBuildFilename(settings.filename, source);
}

// What actually gets downloaded: whatever is in the box, cleaned up. The box
// starts from the default pattern and editing it only affects this capture.
function currentName() {
  const typed = els.name.value.trim();
  return typed ? fsBuildFilename(typed, source || {}) : baseName;
}



// --- Crop -----------------------------------------------------------------
// The preview is scaled down to fit the shell, so a rectangle drawn on screen
// has to be mapped back to the real canvas before cutting anything.

let dragging = false;
let dragStart = null;

function armCrop(on) {
  els.shell.classList.toggle("selecting", on);
  els.crop.classList.toggle("armed", on);
  els.selhint.classList.toggle("hidden", !on);
  if (!on) {
    els.sel.classList.add("hidden");
    dragging = false;
    dragStart = null;
  }
}

function rectFrom(a, b) {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function pointIn(ev) {
  const r = els.preview.getBoundingClientRect();
  return {
    x: Math.min(Math.max(ev.clientX - r.left, 0), r.width),
    y: Math.min(Math.max(ev.clientY - r.top, 0), r.height),
  };
}

els.crop.addEventListener("click", () => {
  if (!canvas) return;
  armCrop(!els.shell.classList.contains("selecting"));
});

els.shell.addEventListener("mousedown", (ev) => {
  if (!els.shell.classList.contains("selecting")) return;
  ev.preventDefault();
  dragging = true;
  dragStart = pointIn(ev);
  els.sel.classList.remove("hidden");
});

window.addEventListener("mousemove", (ev) => {
  if (!dragging) return;
  const r = rectFrom(dragStart, pointIn(ev));
  const box = els.preview.getBoundingClientRect();
  const shell = els.shell.getBoundingClientRect();
  const offsetTop = box.top - shell.top;
  els.sel.style.left = r.left + "px";
  els.sel.style.top = (r.top + offsetTop) + "px";
  els.sel.style.width = r.width + "px";
  els.sel.style.height = r.height + "px";
});

window.addEventListener("mouseup", (ev) => {
  if (!dragging) return;
  dragging = false;
  const r = rectFrom(dragStart, pointIn(ev));
  // A stray click is not a selection.
  if (r.width < 12 || r.height < 12) { armCrop(false); return; }

  const box = els.preview.getBoundingClientRect();
  const scale = canvas.width / box.width;     // preview is scaled to fit
  applyCrop(
    Math.round(r.left * scale),
    Math.round(r.top * scale),
    Math.round(r.width * scale),
    Math.round(r.height * scale)
  );
  armCrop(false);
});

window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") armCrop(false);
});

function applyCrop(x, y, w, h) {
  const cut = document.createElement("canvas");
  cut.width = Math.max(1, Math.min(w, canvas.width - x));
  cut.height = Math.max(1, Math.min(h, canvas.height - y));
  const ctx = cut.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cut.width, cut.height);
  ctx.drawImage(canvas, x, y, cut.width, cut.height, 0, 0, cut.width, cut.height);
  canvas = cut;
  els.preview.src = canvas.toDataURL("image/png");
  els.uncrop.classList.remove("hidden");
}

els.uncrop.addEventListener("click", () => {
  if (!fullCanvas) return;
  canvas = fullCanvas;
  els.preview.src = canvas.toDataURL("image/png");
  els.uncrop.classList.add("hidden");
});

function toBlob(type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// minipdf necesita los bytes crudos del JPEG, no un data URL.
function canvasToJpegBytes(cv, quality) {
  return new Promise((resolve, reject) => {
    cv.toBlob(
      (b) => {
        if (!b) return reject(new Error("The image could not be encoded."));
        b.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      },
      "image/jpeg",
      quality
    );
  });
}

async function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } catch (_) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// --- Settings panel -------------------------------------------------------
// These used to live in their own tab. Four settings did not justify a second
// page, and having the file name over there meant editing it far from the
// capture it applied to.

function fillSettingsPanel() {
  els.quality.value = settings.jpegQuality;
  els.hideFixed.checked = settings.hideFixed;
  els.qval.textContent = `${Math.round(settings.jpegQuality * 100)}%`;
}

async function saveSettings(patch) {
  settings = fsSanitize(Object.assign({}, settings, patch));
  try {
    await chrome.storage.local.set(settings);
  } catch (_) {
    // Storage can fail or be full. The values still apply to this session.
  }
}

// --- Download menu ---------------------------------------------------------

function openMenu(on) {
  els.dlmenu.classList.toggle("hidden", !on);
  els.dl.setAttribute("aria-expanded", on ? "true" : "false");
}

els.dl.addEventListener("click", (ev) => {
  ev.stopPropagation();
  openMenu(els.dlmenu.classList.contains("hidden"));
});

// Clicking anywhere else, or Escape, closes it.
document.addEventListener("click", () => openMenu(false));
els.dlmenu.addEventListener("click", (ev) => ev.stopPropagation());
window.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") openMenu(false);
});

els.gear.addEventListener("click", () => {
  const hidden = els.settingsPanel.classList.toggle("hidden");
  els.gear.classList.toggle("open", !hidden);
});

els.quality.addEventListener("input", () => {
  els.qval.textContent = `${Math.round(parseFloat(els.quality.value) * 100)}%`;
});
els.quality.addEventListener("change", () => saveSettings({ jpegQuality: parseFloat(els.quality.value) }));
els.hideFixed.addEventListener("change", () => saveSettings({ hideFixed: els.hideFixed.checked }));

els.png.addEventListener("click", async () => {
  openMenu(false);
  els.png.disabled = true;
  try {
    await download(await toBlob("image/png"), `${currentName()}.png`);
  } finally {
    els.png.disabled = false;
  }
});

els.jpg.addEventListener("click", async () => {
  openMenu(false);
  els.jpg.disabled = true;
  try {
    await download(await toBlob("image/jpeg", settings.jpegQuality), `${currentName()}.jpg`);
  } finally {
    els.jpg.disabled = false;
  }
});

els.again.addEventListener("click", async () => {
  els.again.disabled = true;
  els.again.textContent = "Starting…";
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: "FS_RECAPTURE", tabId: sourceTabId });
  } catch (err) {
    res = { ok: false, error: String((err && err.message) || err) };
  }
  if (res && res.ok) {
    // The new capture opens its own viewer, so this tab would just pile up.
    window.close();
    return;
  }
  showNote(
    "Could not start a new capture on the original tab. It may have been closed " +
    "or navigated away. Go to the page and press Alt+Shift+P."
  );
  els.again.textContent = "Capture again";
  els.again.disabled = false;
});

els.copy.addEventListener("click", async () => {
  const original = els.copy.textContent;
  try {
    const blob = await toBlob("image/png");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    els.copy.textContent = "Copied";
  } catch (_) {
    els.copy.textContent = "Could not copy";
  }
  setTimeout(() => (els.copy.textContent = original), 1800);
});

els.pdf.addEventListener("click", async () => {
  openMenu(false);
  els.pdf.disabled = true;
  els.pdf.textContent = "Generating…";
  try {
    const ptPerPx = 0.75;   // 1 CSS px = 0.75 pt
    const pdfScale = Math.min(1, PDF_MAX_PT / (canvas.width * ptPerPx));
    const wPt = canvas.width * ptPerPx * pdfScale;
    const hPt = canvas.height * ptPerPx * pdfScale;

    if (hPt <= PDF_MAX_PT) {
      // Una sola página larga, del tamaño exacto de la captura.
      const jpeg = await canvasToJpegBytes(canvas, settings.jpegQuality);
      const pdf = fsBuildPdf([{ jpeg, pxW: canvas.width, pxH: canvas.height, wPt, hPt }]);
      await download(pdf, `${currentName()}.pdf`);
      if (pdfScale < 1) showNote(`The PDF was scaled to ${Math.round(pdfScale * 100)}% so its width fits the PDF limit.`);
    } else {
      // Demasiado alta para una página: se corta en páginas del mismo ancho.
      const pageHpx = Math.floor(PDF_MAX_PT / (ptPerPx * pdfScale));
      const count = Math.ceil(canvas.height / pageHpx);
      const slice = document.createElement("canvas");
      const sctx = slice.getContext("2d", { alpha: false });
      const pageList = [];

      for (let i = 0; i < count; i++) {
        const sy = i * pageHpx;
        const sh = Math.min(pageHpx, canvas.height - sy);
        slice.width = canvas.width;
        slice.height = sh;
        sctx.fillStyle = "#ffffff";
        sctx.fillRect(0, 0, slice.width, slice.height);
        sctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
        pageList.push({
          jpeg: await canvasToJpegBytes(slice, settings.jpegQuality),
          pxW: slice.width,
          pxH: slice.height,
          wPt,
          hPt: sh * ptPerPx * pdfScale,
        });
      }

      await download(fsBuildPdf(pageList), `${currentName()}.pdf`);
      const scaleNote = pdfScale < 1 ? ` and scaled to ${Math.round(pdfScale * 100)}% width` : "";
      showNote(`The capture does not fit on a single PDF page, so it was split across ${count} pages${scaleNote}.`);
    }
  } catch (err) {
    console.error(err);
    els.pdf.textContent = "Error";
    setTimeout(() => (els.pdf.textContent = "PDF"), 2000);
    els.pdf.disabled = false;
    return;
  }
  els.pdf.textContent = "PDF";
  els.pdf.disabled = false;
});

build().catch((err) => {
  console.error(err);
  fail("Something went wrong stitching the capture: " + err.message);
});
