// FullShot — options page.

const $ = (id) => document.getElementById(id);
const els = {
  quality: $("quality"),
  qval: $("qval"),
  filename: $("filename"),
  hideFixed: $("hideFixed"),
  preview: $("preview"),
  save: $("save"),
  reset: $("reset"),
  saved: $("saved"),
  close: $("close"),
};

// A realistic example, so the preview shows what the tokens actually produce.
const SAMPLE = {
  title: "Process Automation · ToolTank",
  url: "https://www.tooltank.io/process-automation",
};

function formatEl(value) {
  return document.querySelector(`input[name="format"][value="${value}"]`);
}

function readForm() {
  const picked = document.querySelector('input[name="format"]:checked');
  return fsSanitize({
    format: picked ? picked.value : FS_DEFAULTS.format,
    jpegQuality: parseFloat(els.quality.value),
    filename: els.filename.value,
    hideFixed: els.hideFixed.checked,
  });
}

function fillForm(s) {
  const radio = formatEl(s.format);
  if (radio) radio.checked = true;
  els.quality.value = s.jpegQuality;
  els.filename.value = s.filename;
  els.hideFixed.checked = s.hideFixed;
  refresh();
}

function refresh() {
  els.qval.textContent = `${Math.round(parseFloat(els.quality.value) * 100)}%`;
  const ext = (document.querySelector('input[name="format"]:checked') || {}).value || "png";
  const name = fsBuildFilename(els.filename.value, Object.assign({ date: new Date() }, SAMPLE));
  const strong = document.createElement("b");
  strong.textContent = `${name}.${ext === "jpeg" ? "jpg" : ext}`;
  els.preview.textContent = "Example: ";
  els.preview.append(strong);
}

async function save() {
  const s = readForm();
  await chrome.storage.sync.set(s);
  fillForm(s);                       // reflect anything sanitize corrected
  els.saved.classList.add("show");
  setTimeout(() => els.saved.classList.remove("show"), 1400);
}

for (const el of document.querySelectorAll('input[name="format"]')) {
  el.addEventListener("change", refresh);
}
els.quality.addEventListener("input", refresh);
els.filename.addEventListener("input", refresh);
els.save.addEventListener("click", save);
els.reset.addEventListener("click", async () => {
  await chrome.storage.sync.set(FS_DEFAULTS);
  fillForm(Object.assign({}, FS_DEFAULTS));
});

// The options page opens in its own tab, so it needs a way out. Closing it
// lands you back on whatever you were on, usually the capture.
els.close.addEventListener("click", () => window.close());

fsGetSettings().then(fillForm);
