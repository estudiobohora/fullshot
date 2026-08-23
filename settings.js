// FullShot — shared settings. Loaded by the service worker with importScripts()
// and by viewer.html with a plain script tag, so the defaults live in exactly
// one place.

const FS_DEFAULTS = {
  jpegQuality: 0.92,                    // also used for the image inside the PDF
  filename: "{title}-{date}-{time}",    // default name; editable per capture
  hideFixed: true,                      // hide fixed/sticky after the first slice
};

// Storage can hold anything, including values from an older version or a hand
// edited storage payload, so everything coming out of it gets checked.
function fsSanitize(raw) {
  const s = Object.assign({}, FS_DEFAULTS, raw || {});
  const q = Number(s.jpegQuality);
  s.jpegQuality = isFinite(q) ? Math.min(1, Math.max(0.4, q)) : FS_DEFAULTS.jpegQuality;
  if (typeof s.filename !== "string" || !s.filename.trim()) s.filename = FS_DEFAULTS.filename;
  s.filename = s.filename.slice(0, 120);
  s.hideFixed = s.hideFixed !== false;
  return s;
}

async function fsGetSettings() {
  try {
    return fsSanitize(await chrome.storage.local.get(FS_DEFAULTS));
  } catch (_) {
    return Object.assign({}, FS_DEFAULTS);   // storage unavailable
  }
}

// --- File names -------------------------------------------------------------
// Shared so the options preview and the actual download cannot drift apart.

function fsSlug(text, fallback) {
  const out = (text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
  return out || fallback;
}

function fsBuildFilename(template, ctx) {
  const d = ctx.date || new Date();
  const p = (n) => String(n).padStart(2, "0");
  let domain = "";
  try {
    domain = new URL(ctx.url || "").hostname.replace(/^www\./, "");
  } catch (_) {}

  const tokens = {
    "{title}": fsSlug(ctx.title, "screenshot"),
    "{domain}": fsSlug(domain, "page"),
    "{date}": `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`,
    "{time}": `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`,
  };

  let name = String(template || FS_DEFAULTS.filename);
  for (const [token, value] of Object.entries(tokens)) name = name.split(token).join(value);

  // Whatever the template had, the result has to be a filename Chrome accepts:
  // no path separators, no reserved characters, not empty.
  name = name.replace(/[\/:*?"<>|\u0000-\u001f]+/g, "-")
             .replace(/\s+/g, "-")
             .replace(/-{2,}/g, "-")
             .replace(/^[-.]+|[-.]+$/g, "")
             .slice(0, 100);
  return name || "screenshot";
}
