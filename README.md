# FullShot — captura de página completa

Reemplazo casero de GoFullPage. Captura toda la página (todo el scroll) y la exporta en PNG o PDF. Todo pasa dentro de tu navegador: no sube nada a ningún servidor.

## Instalar (2 minutos)

1. Descomprime la carpeta `fullshot` donde la vayas a dejar permanentemente (si la borras o la mueves, la extensión se desactiva).
2. Abre `chrome://extensions`.
3. Activa **Modo de desarrollador** (arriba a la derecha).
4. Click en **Cargar descomprimida** y selecciona la carpeta `fullshot`.
5. Fija el ícono a la barra con el pin de extensiones.

## Usar

Click en el ícono, o `Alt+Shift+P`. El badge muestra el progreso (`3/7`). Al terminar se abre una pestaña con la vista previa y tres botones: **Copiar**, **Descargar PDF**, **Descargar PNG**.

Para cambiar el atajo: `chrome://extensions/shortcuts`.

## Cómo funciona

Chrome no deja capturar fuera de la pantalla, así que la extensión hace lo mismo que hacía GoFullPage:

1. Inyecta un script en la página, esconde las barras de scroll y desactiva el scroll suave.
2. Recorre la página completa una vez para disparar las imágenes lazy-load.
3. Hace scroll tramo por tramo y llama a `chrome.tabs.captureVisibleTab()` en cada parada (throttle de 600 ms porque Chrome limita a ~2 capturas por segundo).
4. Después del primer tramo esconde los elementos `position: fixed` y `sticky`, para que el header no se repita en cada pantalla.
5. Guarda los tramos, los pega en un `<canvas>` y devuelve la página a como estaba.

## Límites conocidos

- No funciona en `chrome://`, `chrome-extension://` ni en la Chrome Web Store. Es una restricción de Chrome, no un bug.
- Páginas que hacen scroll dentro de un contenedor interno (no en el `body`) no se capturan completas.
- Un canvas de Chrome tope alrededor de 250 megapíxeles. En páginas gigantes la captura se reduce automáticamente y te avisa en la vista previa.
- El PDF sale en una sola página larga; si pasa de 200 pulgadas de alto, se divide en varias.

## Permisos y por qué

- `activeTab` — solo la pestaña donde tú hiciste click. No hay acceso permanente a ningún sitio.
- `scripting` — inyectar el script de scroll bajo demanda.
- `downloads` — guardar el PNG/PDF.
- `storage` + `unlimitedStorage` — guardar los tramos entre la captura y la vista previa. Se borran al abrir el visor.

## Archivos

```
manifest.json   configuración MV3
background.js   orquesta scroll + captura
page.js         script inyectado en la página
viewer.html/js  vista previa y exportación
lib/            jsPDF 2.5.2 (MIT)
icons/
```
