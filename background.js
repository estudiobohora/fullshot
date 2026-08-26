// FullShot — service worker (MV3)
// Orchestrates: injects the content script, scrolls and captures slice by slice,
// stores the slices and opens the viewer to stitch the final image.

importScripts("settings.js");

const CAPTURE_INTERVAL_MS = 600; // captureVisibleTab is capped at ~2 calls/sec
const SETTLE_MS = 180; // wait after scrolling so the page repaints
// Hard ceiling on slices. At 600 ms each this is about two minutes, and it is
// the backstop for pages that keep growing as you scroll them.
const MAX_STEPS = 200;

let busy = false;

chrome.action.onClicked.addListener((tab) => start(tab));

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (command === "capture-full-page") start(tab);
  else if (command === "capture-region") startRegion(tab);
});

// Chrome refuses to let any extension script or capture these, so we say so
// instead of failing halfway with a red badge. The Web Store lives at two
// hosts: the current one and the older chrome.google.com/webstore path, which
// is where the developer dashboard still sits.
function isBlocked(url) {
  return /^(chrome|edge|about|devtools|chrome-extension|view-source):/i.test(url) ||
         url.startsWith("https://chromewebstore.google.com") ||
         url.startsWith("https://chrome.google.com/webstore");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function setBadge(tabId, text, color = "#C9AB4C") { // Architectural Brass
  try {
    await chrome.action.setBadgeBackgroundColor({ color, tabId });
    await chrome.action.setBadgeText({ text, tabId });
  } catch (_) {}
}

function ask(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function captureVisible(windowId) {
  // Retry if Chrome throttles us on the captures-per-second limit.
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      return await chrome.tabs.captureVisibleTab(windowId, {
        format: "png",
      });
    } catch (err) {
      const msg = String(err && err.message);
      if (msg.includes("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND")) {
        await sleep(700 + attempt * 300);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Chrome throttled the captures. Try again.");
}

// Measures a capture (data URL) without a DOM, using createImageBitmap.
async function measure(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  const bmp = await createImageBitmap(blob);
  const dims = { width: bmp.width, height: bmp.height };
  bmp.close();
  return dims;
}

async function start(tab) {
  if (busy) return;
  if (!tab || !tab.id) return;

  if (isBlocked(tab.url || "")) {
    await notifyBlocked(tab.id);
    return;
  }

  busy = true;
  try {
    const settings = await fsGetSettings();

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["page.js"],
    });

    const info = await ask(tab.id, { type: "FS_PREPARE" });
    if (!info || !info.ok) throw new Error("Could not read the page.");

    const { viewportWidth, totalHeight, totalWidth, originalScrollY, pane } = info;
    const shots = [];

    // First slice from the top. We do not assume the captured image matches
    // the viewport exactly: we measure it, and the real step comes from that.
    await ask(tab.id, { type: "FS_SCROLL", y: 0 });
    await sleep(SETTLE_MS);
    const firstUrl = await captureVisible(tab.windowId);
    const { width: capW, height: capH } = await measure(firstUrl);

    const scale = capW / viewportWidth;          // the display pixel ratio
    // Con panel, el paso es la altura del PANEL, no la de la ventana: es lo que
    // el visor recorta de cada captura, asi que los tramos encajan exactos.
    const stepPx = pane
      ? Math.max(50, pane.height)
      : Math.max(50, Math.floor(capH / scale)); // real captured height, in CSS px

    // The page can grow while we capture it: lazy content that only loads once
    // you get near it makes the document taller mid-run. Measuring the height
    // once, up front, meant cutting the capture short and never noticing.
    // FS_SCROLL reports the current height on every hop, so we track it.
    let docHeight = totalHeight;
    let steps = Math.min(MAX_STEPS, Math.max(1, Math.ceil(docHeight / stepPx)));

    shots.push({ y: 0, x: 0, dataUrl: firstUrl });
    await setBadge(tab.id, `1/${steps}`);

    if (steps > 1 && settings.hideFixed) {
      // Fixed headers/footers would repeat in every slice: we hide them after
      // the first one and put them back at the end. Some pages keep real
      // content in a sticky panel, which is why this can be turned off.
      await ask(tab.id, { type: "FS_HIDE_FIXED" });
    }

    for (let i = 1; i < steps; i++) {
      await sleep(CAPTURE_INTERVAL_MS);
      const targetY = Math.min(i * stepPx, Math.max(0, docHeight - stepPx));
      const pos = await ask(tab.id, { type: "FS_SCROLL", y: targetY });
      await sleep(SETTLE_MS);

      const dataUrl = await captureVisible(tab.windowId);
      shots.push({ y: pos.scrollY, x: pos.scrollX, dataUrl });

      if (pos.totalHeight > docHeight) {
        docHeight = pos.totalHeight;
        steps = Math.min(MAX_STEPS, Math.ceil(docHeight / stepPx));
      }
      await setBadge(tab.id, `${i + 1}/${steps}`);
    }

    await ask(tab.id, { type: "FS_RESTORE", y: originalScrollY });
    await setBadge(tab.id, "");

    const key = `fs_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await chrome.storage.local.set({
      [key]: {
        shots,
        viewportWidth,
        stepPx,
        scale,
        totalWidth,
        totalHeight: docHeight,   // the final height, or the viewer would crop
        pane,                     // recorte por tramo cuando el scroll es interno
        title: tab.title || "screenshot",
        url: tab.url || "",
        sourceTabId: tab.id,
        createdAt: Date.now(),
      },
    });

    await chrome.tabs.create({
      url: chrome.runtime.getURL(`viewer.html?key=${encodeURIComponent(key)}`),
      index: tab.index + 1,
    });
  } catch (err) {
    console.error("[FullShot]", err);
    // Logged so it can be debugged from chrome://extensions → service worker.
    chrome.storage.local.set({ fs_lastError: String((err && err.stack) || err) });
    await setBadge(tab.id, "!", "#dc2626");
    try {
      await ask(tab.id, { type: "FS_RESTORE" });
    } catch (_) {}
    setTimeout(() => setBadge(tab.id, ""), 4000);
  } finally {
    busy = false;
  }
}

// Región visible: una sola captura y un recorte. Sin recorrer la página, porque
// lo que se selecciona ya está en pantalla. Es el complemento rápido a la
// captura completa, no un sustituto.
async function startRegion(tab) {
  if (busy) return;
  if (!tab || !tab.id) return;
  if (isBlocked(tab.url || "")) { await notifyBlocked(tab.id); return; }

  busy = true;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["page.js"] });

    const pick = await ask(tab.id, { type: "FS_PICK_REGION" });
    if (!pick || !pick.ok) return;                 // cancelado con Esc

    const dataUrl = await captureVisible(tab.windowId);
    const { width: capW, height: capH } = await measure(dataUrl);

    // La captura viene en píxeles del monitor; la selección, en píxeles CSS.
    const scale = capW / (pick.viewportWidth || tab.width || capW);
    const r = pick.rect;

    const key = `fs_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await chrome.storage.local.set({
      [key]: {
        shots: [{ y: 0, x: 0, dataUrl }],
        region: {
          x: Math.round(r.x * scale),
          y: Math.round(r.y * scale),
          width: Math.round(r.width * scale),
          height: Math.round(r.height * scale),
        },
        viewportWidth: pick.viewportWidth,
        // El viewer arma primero el viewport completo y DESPUÉS recorta con
        // `region`. Si aquí guardáramos el alto del recorte, el canvas nacería
        // más corto que la imagen y el recorte caería fuera.
        stepPx: Math.round(capH / scale),
        scale,
        totalWidth: Math.round(capW / scale),
        totalHeight: Math.round(capH / scale),
        title: tab.title || "screenshot",
        url: tab.url || "",
        sourceTabId: tab.id,
        createdAt: Date.now(),
      },
    });

    await chrome.tabs.create({
      url: chrome.runtime.getURL(`viewer.html?key=${encodeURIComponent(key)}`),
      index: tab.index + 1,
    });
  } catch (err) {
    console.error("[FullShot]", err);
    chrome.storage.local.set({ fs_lastError: String((err && err.stack) || err) });
    await setBadge(tab.id, "!", "#dc2626");
    setTimeout(() => setBadge(tab.id, ""), 4000);
  } finally {
    busy = false;
  }
}

async function notifyBlocked(tabId) {
  await setBadge(tabId, "✕", "#dc2626");
  setTimeout(() => setBadge(tabId, ""), 3000);
}

// "Capture again" from the viewer. captureVisibleTab only sees the visible tab,
// so the original one has to be focused first.
//
// activeTab is granted by a user gesture and lasts until that tab navigates or
// closes, which is why this works at all: the grant from the original capture
// is usually still live. If the tab moved on, executeScript fails and the error
// badge shows up on the tab itself.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "FS_RECAPTURE") return;
  (async () => {
    try {
      if (busy) throw new Error("A capture is already running.");
      const tab = await chrome.tabs.get(msg.tabId);
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tab.id, { active: true });
      start(tab);
      sendResponse({ ok: true });
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();
  return true;   // async response
});

// Cleanup: drops stored captures older than 1 hour on startup.
chrome.runtime.onStartup.addListener(cleanup);
chrome.runtime.onInstalled.addListener(cleanup);

async function cleanup() {
  const all = await chrome.storage.local.get(null);
  const stale = Object.entries(all)
    .filter(([k, v]) => k.startsWith("fs_") && v && v.createdAt && Date.now() - v.createdAt > 3600e3)
    .map(([k]) => k);
  if (stale.length) await chrome.storage.local.remove(stale);
}
