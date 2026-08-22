// FullShot — service worker (MV3)
// Orchestrates: injects the content script, scrolls and captures slice by slice,
// stores the slices and opens the viewer to stitch the final image.

const CAPTURE_INTERVAL_MS = 600; // captureVisibleTab is capped at ~2 calls/sec
const SETTLE_MS = 180; // wait after scrolling so the page repaints

let busy = false;

chrome.action.onClicked.addListener((tab) => start(tab));

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-full-page") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) start(tab);
});

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

  const url = tab.url || "";
  if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(url) ||
      url.startsWith("https://chromewebstore.google.com")) {
    await notifyBlocked(tab.id);
    return;
  }

  busy = true;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["page.js"],
    });

    const info = await ask(tab.id, { type: "FS_PREPARE" });
    if (!info || !info.ok) throw new Error("Could not read the page.");

    const { viewportWidth, totalHeight, totalWidth, originalScrollY } = info;
    const shots = [];

    // First slice from the top. We do not assume the captured image matches
    // the viewport exactly: we measure it, and the real step comes from that.
    await ask(tab.id, { type: "FS_SCROLL", y: 0 });
    await sleep(SETTLE_MS);
    const firstUrl = await captureVisible(tab.windowId);
    const { width: capW, height: capH } = await measure(firstUrl);

    const scale = capW / viewportWidth;          // the display pixel ratio
    const stepPx = Math.max(50, Math.floor(capH / scale)); // real captured height, in CSS px
    const steps = Math.max(1, Math.ceil(totalHeight / stepPx));

    shots.push({ y: 0, x: 0, dataUrl: firstUrl });
    await setBadge(tab.id, `1/${steps}`);

    if (steps > 1) {
      // Fixed headers/footers would repeat in every slice: we hide them after
      // the first one and put them back at the end.
      await ask(tab.id, { type: "FS_HIDE_FIXED" });
    }

    for (let i = 1; i < steps; i++) {
      await sleep(CAPTURE_INTERVAL_MS);
      const targetY = Math.min(i * stepPx, Math.max(0, totalHeight - stepPx));
      const pos = await ask(tab.id, { type: "FS_SCROLL", y: targetY });
      await sleep(SETTLE_MS);

      const dataUrl = await captureVisible(tab.windowId);
      shots.push({ y: pos.scrollY, x: pos.scrollX, dataUrl });
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
        totalHeight,
        title: tab.title || "screenshot",
        url: tab.url || "",
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

async function notifyBlocked(tabId) {
  await setBadge(tabId, "✕", "#dc2626");
  setTimeout(() => setBadge(tabId, ""), 3000);
}

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
