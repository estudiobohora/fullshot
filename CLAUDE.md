# CLAUDE.md — FullShot

Extensión Chrome MV3 que captura la página completa (todo el scroll) y exporta PNG/PDF.
Reemplazo de GoFullPage, que Google sacó de la Web Store en agosto 2026.

## Arquitectura

- `background.js` — service worker. Orquesta: inyecta `page.js`, mide el primer tramo
  para calcular el paso real de scroll, captura tramo por tramo con `chrome.tabs.captureVisibleTab()`,
  guarda todo en `chrome.storage.local` y abre `viewer.html`.
- `page.js` — content script inyectado bajo demanda. Controla scroll, esconde scrollbars,
  desactiva scroll suave, dispara lazy-load y oculta elementos `fixed`/`sticky`.
- `viewer.js` — pega los tramos en un canvas, muestra vista previa, exporta PNG/PDF (jsPDF).

## Invariantes que NO se pueden romper

1. Throttle de 600 ms entre capturas. Chrome limita `captureVisibleTab` a ~2 llamadas/seg.
2. El paso de scroll sale del ALTO REAL de la imagen capturada, no de `window.innerHeight`.
   Asumir que son iguales deja franjas blancas.
3. Los elementos `fixed`/`sticky` se ocultan DESPUÉS del primer tramo y se restauran siempre,
   incluso si la captura falla.
4. `activeTab` únicamente. Nunca agregar `host_permissions` amplios.
5. Sin scripts remotos: la CSP de MV3 los bloquea. Todo vendorizado en `lib/`.

## Probar

Cargar descomprimida en `chrome://extensions` con Modo desarrollador.
Después de editar, click en recargar (⟳) en la tarjeta de la extensión.
Errores del service worker: `chrome://extensions` → "service worker" → Console.
El último error también queda en `chrome.storage.local.fs_lastError`.

## Pendientes conocidos

- Páginas que scrollean dentro de un contenedor interno (no el body) no se capturan completas.
- No funciona en `chrome://`, `chrome-extension://` ni Chrome Web Store (restricción de Chrome).
