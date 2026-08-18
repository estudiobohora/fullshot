// FullShot — content script inyectado bajo demanda.
// Controla el scroll de la página y prepara el DOM para que los tramos
// se peguen sin barras de scroll ni headers fijos repetidos.

(() => {
  if (window.__fullshotInstalled) return;
  window.__fullshotInstalled = true;

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

  // Recorre la página una vez para disparar imágenes lazy-load antes de medir.
  async function warmLazyContent() {
    const vh = window.innerHeight;
    let h = docHeight();
    let y = 0;
    let guard = 0;
    while (y < h && guard < 60) {
      window.scrollTo(0, y);
      await sleep(60);
      y += vh;
      h = docHeight();
      guard++;
    }
    window.scrollTo(0, h);
    await sleep(150);
    window.scrollTo(0, 0);
    await sleep(150);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
    return true; // respuesta asíncrona
  });
})();
