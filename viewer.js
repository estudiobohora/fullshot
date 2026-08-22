// FullShot — viewer: stitches the slices, shows the preview and exports.

const MAX_DIM = 32000;      // practical canvas dimension limit in Chrome
const MAX_AREA = 250e6;     // practical area limit
const PDF_MAX_PT = 14400;   // 200 inches: maximum PDF page size

const $ = (id) => document.getElementById(id);
const els = {
  meta: $("meta"),
  note: $("note"),
  status: $("status"),
  preview: $("preview"),
  png: $("png"),
  jpg: $("jpg"),
  pdf: $("pdf"),
  copy: $("copy"),
  opts: $("opts"),
};

let canvas = null;
let baseName = "screenshot";
let settings = Object.assign({}, FS_DEFAULTS);

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
}

async function build() {
  settings = await fsGetSettings();
  const preferred = { png: els.png, jpeg: els.jpg, pdf: els.pdf }[settings.format];
  if (preferred) preferred.classList.add("primary");

  const key = new URLSearchParams(location.search).get("key");
  if (!key) return fail("There is no capture to show.");

  const stored = (await chrome.storage.local.get(key))[key];
  if (!stored || !stored.shots || !stored.shots.length) {
    return fail("The capture expired or was not found. Try again.");
  }
  await chrome.storage.local.remove(key);

  baseName = fsBuildFilename(settings.filename, {
    title: stored.title,
    url: stored.url,
    date: new Date(stored.createdAt || Date.now()),
  });

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

  els.preview.src = canvas.toDataURL("image/png");
  els.preview.classList.remove("hidden");
  els.status.classList.add("hidden");
  els.meta.innerHTML =
    `<b>${canvas.width}×${canvas.height} px</b> · ${images.length} slices · ${stored.url.replace(/^https?:\/\//, "").slice(0, 70)}`;
}

function toBlob(type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
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

els.png.addEventListener("click", async () => {
  els.png.disabled = true;
  try {
    await download(await toBlob("image/png"), `${baseName}.png`);
  } finally {
    els.png.disabled = false;
  }
});

els.jpg.addEventListener("click", async () => {
  els.jpg.disabled = true;
  try {
    await download(await toBlob("image/jpeg", settings.jpegQuality), `${baseName}.jpg`);
  } finally {
    els.jpg.disabled = false;
  }
});

els.opts.addEventListener("click", () => chrome.runtime.openOptionsPage());

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
  els.pdf.disabled = true;
  els.pdf.textContent = "Generating…";
  try {
    const { jsPDF } = window.jspdf;
    const wPt = canvas.width * 0.75;   // 1 CSS px = 0.75 pt
    const hPt = canvas.height * 0.75;

    if (hPt <= PDF_MAX_PT) {
      // A single long page, exactly the size of the capture.
      const doc = new jsPDF({ orientation: wPt > hPt ? "l" : "p", unit: "pt", format: [wPt, hPt] });
      doc.addImage(canvas.toDataURL("image/jpeg", settings.jpegQuality), "JPEG", 0, 0, wPt, hPt);
      await download(doc.output("blob"), `${baseName}.pdf`);
    } else {
      // Too tall for one page: split into pages of the same width.
      const pageHpx = Math.floor(PDF_MAX_PT / 0.75);
      const pages = Math.ceil(canvas.height / pageHpx);
      const doc = new jsPDF({ orientation: "p", unit: "pt", format: [wPt, PDF_MAX_PT] });
      const slice = document.createElement("canvas");
      const sctx = slice.getContext("2d", { alpha: false });

      for (let i = 0; i < pages; i++) {
        const sy = i * pageHpx;
        const sh = Math.min(pageHpx, canvas.height - sy);
        slice.width = canvas.width;
        slice.height = sh;
        sctx.fillStyle = "#ffffff";
        sctx.fillRect(0, 0, slice.width, slice.height);
        sctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);
        if (i > 0) doc.addPage([wPt, sh * 0.75], "p");
        doc.addImage(slice.toDataURL("image/jpeg", settings.jpegQuality), "JPEG", 0, 0, wPt, sh * 0.75);
      }
      await download(doc.output("blob"), `${baseName}.pdf`);
      showNote(`The capture does not fit on a single PDF page, so it was split across ${pages} pages.`);
    }
  } catch (err) {
    console.error(err);
    els.pdf.textContent = "Error";
    setTimeout(() => (els.pdf.textContent = "Download PDF"), 2000);
    els.pdf.disabled = false;
    return;
  }
  els.pdf.textContent = "Download PDF";
  els.pdf.disabled = false;
});

build().catch((err) => {
  console.error(err);
  fail("Something went wrong stitching the capture: " + err.message);
});
