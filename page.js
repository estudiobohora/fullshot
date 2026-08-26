// FullShot — content script injected on demand.
// Controls page scrolling and prepares the DOM so the slices stitch together
// without scrollbars or repeated fixed headers.

(() => {
  // Unmount the previous install instead of surrendering to a flag.
  //
  // A boolean looks like enough, but when the extension updates (a Web Store
  // update, or the reload button while developing) the old script DIES with its
  // context while the flag stays on the page. The new injection saw the flag,
  // bailed out, and nobody was left listening: the extension went silent on
  // every already-open tab until the user reloaded it by hand, which they have
  // no reason to think of.
  //
  // __fullshotCleanup belongs to the old context: if it is still alive it
  // removes its listener cleanly, and if it died calling it throws and we carry
  // on. Both paths end with exactly one listener, this context's.
  if (typeof window.__fullshotCleanup === "function") {
    try { window.__fullshotCleanup(); } catch (_) { /* context invalidated */ }
  }

  const state = {
    originalScrollX: 0,
    originalScrollY: 0,
    styleEl: null,
    hiddenFixed: [],
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const scroller = () => document.scrollingElement || document.documentElement;

  function docHeight() {
    const b = document.body;
    const d = document.documentElement;
    return Math.max(
      b ? b.scrollHeight : 0,
      b ? b.offsetHeight : 0,
      d.clientHeight,
      d.scrollHeight,
      d.offsetHeight
    );
  }

  function docWidth() {
    const b = document.body;
    const d = document.documentElement;
    return Math.max(
      b ? b.scrollWidth : 0,
      b ? b.offsetWidth : 0,
      d.clientWidth,
      d.scrollWidth,
      d.offsetWidth
    );
  }

  function injectStyle() {
    if (state.styleEl) return;
    // The script now re-runs on every capture, so state starts empty. If an
    // earlier capture died halfway its <style> is still in the DOM: reuse it by
    // id instead of stacking an identical one on top.
    const previous = document.getElementById("__fullshot_style__");
    if (previous) { state.styleEl = previous; return; }
    const el = document.createElement("style");
    el.id = "__fullshot_style__";
    el.textContent = `
      html, body { scroll-behavior: auto !important; }
      ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
      html { scrollbar-width: none !important; }
      * { animation-play-state: paused !important; transition: none !important; }
    `;
    (document.head || document.documentElement).appendChild(el);
    state.styleEl = el;
  }

  function removeStyle() {
    if (state.styleEl && state.styleEl.parentNode) {
      state.styleEl.parentNode.removeChild(state.styleEl);
    }
    state.styleEl = null;
  }

  function hideFixed() {
    if (state.hiddenFixed.length) return;
    const nodes = document.body ? document.body.querySelectorAll("*") : [];
    for (const el of nodes) {
      if (el === state.styleEl) continue;
      let pos;
      try {
        pos = getComputedStyle(el).position;
      } catch (_) {
        continue;
      }
      if (pos !== "fixed" && pos !== "sticky") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      state.hiddenFixed.push([el, el.style.getPropertyValue("visibility"), el.style.getPropertyPriority("visibility")]);
      el.style.setProperty("visibility", "hidden", "important");
    }
  }

  function restoreFixed() {
    for (const [el, value, priority] of state.hiddenFixed) {
      if (value) el.style.setProperty("visibility", value, priority);
      else el.style.removeProperty("visibility");
    }
    state.hiddenFixed = [];
  }

  // Walks the page once to trigger lazy-loaded images before measuring.
  //
  // The budget is time and growth, not a step count. A fixed cap of 60 viewports
  // gave up around 54,000 px, which is exactly where lazy loading hurts most:
  // the images below never fired and the capture came out with white gaps.
  // Two guards replace it, both aimed at infinite scroll rather than long pages:
  // a wall-clock budget, and a growth ratio that says "this page is not going
  // to end".
  const WARM_BUDGET_MS = 12000;
  const WARM_MAX_GROWTH = 5;

  async function warmLazyContent() {
    const vh = window.innerHeight;
    const startedAt = Date.now();
    const initialHeight = Math.max(1, docHeight());
    let h = initialHeight;
    let y = 0;
    while (y < h) {
      if (Date.now() - startedAt > WARM_BUDGET_MS) break;
      if (h > initialHeight * WARM_MAX_GROWTH) break;   // infinite scroll
      window.scrollTo(0, y);
      await sleep(60);
      y += vh;
      h = docHeight();
    }
    window.scrollTo(0, h);
    await sleep(150);
    window.scrollTo(0, 0);
    await sleep(150);
  }

  // Selección de una región visible. No mueve el scroll: lo que se ve es lo que
  // hay, así que basta una captura y un recorte. Ese es el caso común de un
  // recorte, y recorrer la página entera para quedarse con un botón no tiene
  // sentido.
  function pickRegion() {
    return new Promise((resolve) => {
      const box = document.createElement("div");
      box.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;cursor:crosshair;" +
        "background:rgba(13,27,42,.35)";
      const rect = document.createElement("div");
      rect.style.cssText =
        "position:fixed;border:2px solid #C9AB4C;box-shadow:0 0 0 9999px rgba(13,27,42,.45);" +
        "display:none;pointer-events:none";
      const tip = document.createElement("div");
      tip.textContent = "Arrastra sobre el área. Esc para cancelar.";
      tip.style.cssText =
        "position:fixed;top:18px;left:50%;transform:translateX(-50%);" +
        "background:#1C1F2A;color:#F0EDE8;border:1px solid #2A3442;border-radius:8px;" +
        "padding:9px 15px;font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        "pointer-events:none";
      const layer = document.createElement("div");
      layer.appendChild(box);
      layer.appendChild(rect);
      layer.appendChild(tip);
      document.documentElement.appendChild(layer);

      let start = null;
      const at = (e) => ({ x: e.clientX, y: e.clientY });
      const paint = (a, b) => {
        const l = Math.min(a.x, b.x), t = Math.min(a.y, b.y);
        const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
        Object.assign(rect.style, { display: "block", left: l + "px", top: t + "px",
                                    width: w + "px", height: h + "px" });
        return { x: l, y: t, width: w, height: h };
      };

      let current = null;
      const done = (value) => {
        window.removeEventListener("keydown", onKey, true);
        layer.remove();
        resolve(value);
      };
      const onKey = (e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(null); }
      };

      box.addEventListener("mousedown", (e) => { e.preventDefault(); start = at(e); });
      box.addEventListener("mousemove", (e) => { if (start) current = paint(start, at(e)); });
      box.addEventListener("mouseup", (e) => {
        if (!start) return;
        const r = paint(start, at(e));
        // Un clic suelto no es una selección.
        done(r.width < 8 || r.height < 8 ? null : r);
      });
      window.addEventListener("keydown", onKey, true);
    });
  }

  const onMessage = (msg, _sender, sendResponse) => {
    (async () => {
      switch (msg.type) {
        case "FS_PREPARE": {
          state.originalScrollX = window.scrollX;
          state.originalScrollY = window.scrollY;
          injectStyle();
          await warmLazyContent();
          sendResponse({
            ok: true,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            totalWidth: docWidth(),
            totalHeight: docHeight(),
            devicePixelRatio: window.devicePixelRatio || 1,
            originalScrollY: state.originalScrollY,
          });
          break;
        }
        case "FS_SCROLL": {
          window.scrollTo(0, msg.y);
          await sleep(40);
          sendResponse({
            ok: true,
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            totalHeight: docHeight(),
          });
          break;
        }
        case "FS_PICK_REGION": {
          injectStyle();                       // hides scrollbars while selecting
          const r = await pickRegion();
          removeStyle();
          // Un frame para que la capa desaparezca antes de que se capture.
          await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
          sendResponse({
            ok: !!r,
            rect: r,
            viewportWidth: window.innerWidth,     // to map CSS px to captured px
            devicePixelRatio: window.devicePixelRatio || 1,
          });
          break;
        }
        case "FS_HIDE_FIXED": {
          hideFixed();
          sendResponse({ ok: true, hidden: state.hiddenFixed.length });
          break;
        }
        case "FS_RESTORE": {
          restoreFixed();
          removeStyle();
          window.scrollTo(
            state.originalScrollX,
            typeof msg.y === "number" ? msg.y : state.originalScrollY
          );
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false });
      }
    })();
    return true; // async response
  };

  chrome.runtime.onMessage.addListener(onMessage);
  window.__fullshotCleanup = () => chrome.runtime.onMessage.removeListener(onMessage);
})();
