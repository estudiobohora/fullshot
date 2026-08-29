// FullShot — content script injected on demand.
// Controls page scrolling and prepares the DOM so the slices stitch together
// without scrollbars or repeated fixed headers.

(() => {
  // Desmontar la instalacion anterior en vez de rendirse ante una bandera.
  //
  // Una bandera booleana parece bastar, pero al recargar la extension (el boton
  // ⟳ de chrome://extensions, o publicar una version nueva) el script viejo
  // MUERE con su contexto mientras la bandera sigue puesta en la pagina. La
  // inyeccion nueva la veia, se iba, y no quedaba nadie escuchando: la
  // extension quedaba muda en toda pestana ya abierta hasta recargarla a mano.
  //
  // __fullshotCleanup pertenece al contexto viejo: si sigue vivo, quita su
  // listener limpiamente; si murio, llamarlo lanza y no pasa nada. Los dos
  // casos terminan con exactamente un listener, el de este contexto.
  if (typeof window.__fullshotCleanup === "function") {
    try { window.__fullshotCleanup(); } catch (_) { /* contexto invalidado */ }
  }

  const state = {
    originalScrollX: 0,
    originalScrollY: 0,
    styleEl: null,
    hiddenFixed: [],
    hiddenOver: [],       // tapado por encima del panel, escondido antes del 1er tramo
    hiddenPinned: [],     // clavado DENTRO del panel: no se mueve al bajarlo
    pane: null,            // panel con scroll interno, si la pagina usa uno
    paneOriginalTop: 0,
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

  // --- Panel con scroll interno ----------------------------------------
  //
  // Gmail, Notion, Slack y casi cualquier app web no desplazan el documento:
  // mueven el contenido dentro de un panel, y el documento mide exactamente una
  // pantalla. docHeight() devuelve la altura de la ventana, el orquestador
  // calcula un solo tramo, y sale una captura de lo visible y nada mas.
  //
  // Esto SOLO se activa cuando el documento no scrollea. Si la pagina se
  // desplaza normal no se toca nada: ese camino ya funciona y no merece una
  // heuristica delante.
  const PANE_MIN_EXTRA = 200;      // px ocultos minimos para que valga la pena
  const PANE_SCORE_CAP = 20000;    // techo del desempate por contenido oculto

  function findScrollPane() {
    if (docHeight() > window.innerHeight + 4) return null;   // el documento si scrollea

    const vw = window.innerWidth, vh = window.innerHeight;

    // Primera pasada barata: solo propiedades de layout, sin calcular estilos.
    // En una app grande esto recorre miles de nodos, asi que el filtro caro va
    // despues y sobre los pocos que sobrevivan.
    const todos = document.body ? document.body.getElementsByTagName("*") : [];
    const candidatos = [];
    for (let i = 0; i < todos.length; i++) {
      const el = todos[i];
      if (el.clientHeight < vh * 0.3) continue;
      if (el.scrollHeight - el.clientHeight < PANE_MIN_EXTRA) continue;
      candidatos.push(el);
    }
    if (!candidatos.length) return null;

    let mejor = null, mejorPuntaje = 0;
    for (const el of candidatos) {
      const oy = getComputedStyle(el).overflowY;
      if (oy !== "auto" && oy !== "scroll" && oy !== "overlay") continue;

      const r = el.getBoundingClientRect();
      const w = Math.min(r.right, vw) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
      if (w < vw * 0.25 || h < vh * 0.25) continue;      // no es el area principal

      // Gana el que mas pantalla ocupa. Lo oculto desempata, pero con techo: sin
      // el, un panel diminuto con 100.000 px dentro le ganaria al principal.
      const puntaje = w * h * Math.min(el.scrollHeight - el.clientHeight, PANE_SCORE_CAP);
      if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = el; }
    }
    return mejor;
  }

  // El rectangulo visible del panel, en pixeles CSS. Es lo que el visor recorta
  // de cada captura: fuera queda la barra lateral y el encabezado de la app,
  // que si no se repetirian en cada tramo.
  function paneRect(el) {
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(r.left)),
      y: Math.max(0, Math.round(r.top)),
      width:  Math.round(Math.min(r.right,  window.innerWidth)  - Math.max(r.left, 0)),
      height: Math.round(Math.min(r.bottom, window.innerHeight) - Math.max(r.top,  0)),
    };
  }

  // Alto y desplazamiento del objetivo, sea el documento o el panel.
  const targetHeight = () => (state.pane ? state.pane.scrollHeight : docHeight());
  const targetView   = () => (state.pane ? state.pane.clientHeight : window.innerHeight);
  const targetGoTo   = (y) => {
    if (state.pane) state.pane.scrollTop = y;
    else window.scrollTo(0, y);
  };
  const targetTop    = () => (state.pane ? state.pane.scrollTop : window.scrollY);

  function injectStyle() {
    if (state.styleEl) return;
    // Ahora que cada captura reinyecta el script, el estado nace vacio. Si una
    // captura anterior murio a medias, su <style> sigue en el DOM: se reusa por
    // id en vez de apilar otro igual encima.
    const previo = document.getElementById("__fullshot_style__");
    if (previo) { state.styleEl = previo; return; }
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
    for (const [el, value, priority] of state.hiddenOver) {
      if (value) el.style.setProperty("visibility", value, priority);
      else el.style.removeProperty("visibility");
    }
    state.hiddenOver = [];
    for (const [el, value, priority] of state.hiddenPinned) {
      if (value) el.style.setProperty("visibility", value, priority);
      else el.style.removeProperty("visibility");
    }
    state.hiddenPinned = [];
  }

  // Mobiliario de la aplicacion encima del panel.
  //
  // Cuando el scroll es interno no existe el "encabezado que queremos una sola
  // vez arriba": el recorte empieza en el borde del panel, y todo lo que flote
  // sobre ese recorte sin ser parte del panel se cuela en cada tramo. En Gmail
  // eso son la ventanita de chat, que sale repetida una vez por tramo, y la
  // barra de Responder, que queda estampada a media imagen porque estaba en el
  // primer tramo. Por eso en modo panel esto se llama ANTES del primer tramo,
  // no despues.
  //
  // El filtro por `position` no basta y por eso aqui la regla es geometrica: el
  // chat de Gmail cuelga de un contenedor fijo de tamano cero, asi que el padre
  // se descarta por medir 0x0 y el hijo no llega a ser "fixed". Nada de eso lo
  // ve hideFixed(). Superponerse al recorte sin ser pariente del panel si lo ve.
  function hideOverPane() {
    if (!state.pane || state.hiddenOver.length) return;
    const p = paneRect(state.pane);
    const right = p.x + p.width, bottom = p.y + p.height;

    // Se baja por el arbol en vez de recorrer todos los nodos: al llegar a algo
    // que NO es pariente del panel se esconde entero y no se entra, asi que se
    // tocan decenas de elementos y no miles.
    const walk = (parent) => {
      for (const el of parent.children) {
        if (el === state.styleEl || el === state.pane) continue;
        // Un ancestro del panel jamas se esconde: el panel vive dentro.
        if (el.contains(state.pane)) { walk(el); continue; }
        if (state.pane.contains(el)) continue;      // contenido real del panel
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right <= p.x || r.left >= right) continue;
        if (r.bottom <= p.y || r.top >= bottom) continue;
        state.hiddenOver.push([el, el.style.getPropertyValue("visibility"), el.style.getPropertyPriority("visibility")]);
        el.style.setProperty("visibility", "hidden", "important");
      }
    };
    if (document.body) walk(document.body);
  }

  // Lo que esta clavado DENTRO del panel.
  //
  // La barra de Responder de Gmail no es "fixed" ni "sticky": es `relative`,
  // cuelga del propio panel, y aun asi se queda quieta cuando el panel baja.
  // Ni hideFixed() ni hideOverPane() la ven, y acaba estampada a media imagen.
  //
  // Preguntar por el estilo no sirve, asi que se pregunta por el comportamiento:
  // se baja el panel un poco y se mira quien NO se movio. Eso es exactamente lo
  // que define al mobiliario, y no depende de como cada aplicacion lo consiga.
  const PIN_PROBE_PX = 200;
  const PIN_TOLERANCE_PX = 2;

  async function hidePinnedInPane() {
    if (!state.pane || state.hiddenPinned.length) return;
    const pane = state.pane;
    const maxScroll = pane.scrollHeight - pane.clientHeight;
    if (maxScroll < 40) return;                  // no hay donde bajar: no hay prueba

    const p = paneRect(pane);
    const right = p.x + p.width, bottom = p.y + p.height;

    const antes = [];
    for (const el of pane.getElementsByTagName("*")) {
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 12) continue;
      // Un bloque grande es contenido, no mobiliario. Este tope es lo que hace
      // que la regla no pueda tragarse media captura por un falso positivo.
      if (r.height > p.height * 0.6) continue;
      if (r.right <= p.x || r.left >= right) continue;
      if (r.bottom <= p.y || r.top >= bottom) continue;
      antes.push([el, r.top]);
    }
    if (!antes.length) return;

    const origen = pane.scrollTop;
    const probe = Math.min(PIN_PROBE_PX, maxScroll);
    pane.scrollTop = origen + probe;
    await sleep(80);

    // Si el panel no se movio de verdad, la prueba no dice nada y todo saldria
    // "clavado". En ese caso no se esconde nada.
    if (Math.abs(pane.scrollTop - origen) >= probe - 4) {
      for (const [el, top0] of antes) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (Math.abs(top0 - r.top) > PIN_TOLERANCE_PX) continue;   // se movio: es contenido
        state.hiddenPinned.push([el, el.style.getPropertyValue("visibility"), el.style.getPropertyPriority("visibility")]);
        el.style.setProperty("visibility", "hidden", "important");
      }
    }

    pane.scrollTop = origen;
    await sleep(80);
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
    const vh = Math.max(1, targetView());
    const startedAt = Date.now();
    const initialHeight = Math.max(1, targetHeight());
    let h = initialHeight;
    let y = 0;
    while (y < h) {
      if (Date.now() - startedAt > WARM_BUDGET_MS) break;
      if (h > initialHeight * WARM_MAX_GROWTH) break;   // infinite scroll
      targetGoTo(y);
      await sleep(60);
      y += vh;
      h = targetHeight();
    }
    targetGoTo(h);
    await sleep(150);
    targetGoTo(0);
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
          state.pane = findScrollPane();
          state.paneOriginalTop = state.pane ? state.pane.scrollTop : 0;
          await warmLazyContent();
          // El rectangulo se mide DESPUES del warm-up y con el panel arriba,
          // que es el estado en el que se toma cada captura.
          sendResponse({
            ok: true,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            totalWidth: docWidth(),
            totalHeight: targetHeight(),
            devicePixelRatio: window.devicePixelRatio || 1,
            originalScrollY: state.originalScrollY,
            pane: state.pane ? paneRect(state.pane) : null,
          });
          break;
        }
        case "FS_SCROLL": {
          targetGoTo(msg.y);
          await sleep(40);
          sendResponse({
            ok: true,
            scrollX: state.pane ? 0 : window.scrollX,
            scrollY: targetTop(),
            totalHeight: targetHeight(),
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
          hideOverPane();          // no hace nada si el scroll no es interno
          await hidePinnedInPane();
          sendResponse({ ok: true, hidden: state.hiddenFixed.length + state.hiddenOver.length + state.hiddenPinned.length });
          break;
        }
        case "FS_RESTORE": {
          restoreFixed();
          removeStyle();
          if (state.pane) {
            try { state.pane.scrollTop = state.paneOriginalTop; } catch (_) {}
            state.pane = null;
          }
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
