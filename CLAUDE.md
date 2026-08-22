# CLAUDE.md — FullShot

Chrome MV3 extension that captures the full page, all the way down the scroll,
and exports PNG/PDF. A replacement for GoFullPage, which Google pulled from the
Web Store in August 2026.

## Architecture

- `background.js` — service worker. Orchestrates: injects `page.js`, measures the
  first slice to work out the real scroll step, captures slice by slice with
  `chrome.tabs.captureVisibleTab()`, stores everything in `chrome.storage.local`
  and opens `viewer.html`.
- `page.js` — content script injected on demand. Controls scrolling, hides
  scrollbars, disables smooth scrolling, triggers lazy-loading and hides
  `fixed`/`sticky` elements.
- `viewer.js` — stitches the slices onto a canvas, shows the preview, exports
  PNG/PDF (jsPDF).
- `settings.js` — defaults, sanitising and file name building, in
  `chrome.storage.sync`. Loaded by the service worker with `importScripts()` and
  by the viewer with a script tag, so defaults and the file name format exist in
  exactly one place. Anything read from storage goes through `fsSanitize()`:
  sync data can come from an older version or another machine.

  There is no separate options page. Four settings did not justify a second tab,
  and keeping the file name over there meant editing it far from the capture it
  applied to, which is exactly how it ended up downloading stale names.
- `tools/make-icons.py` — generates the four icon sizes. The icons are drawn by
  code, not by hand, so they can be adjusted instead of being opaque binaries.

## Invariants that must NOT be broken

1. 600 ms throttle between captures. Chrome caps `captureVisibleTab` at roughly
   2 calls per second.
2. The scroll step comes from the REAL HEIGHT of the captured image, not from
   `window.innerHeight`. Assuming they are equal leaves white bands.
3. `fixed`/`sticky` elements are hidden AFTER the first slice and always
   restored, even if the capture fails.
4. `activeTab` only. Never add broad `host_permissions`.
5. No remote scripts: the MV3 CSP blocks them. Everything is vendored in `lib/`.
   This also rules out remote web fonts.
6. The document height is re-read on every scroll hop, never measured once up
   front. Lazy content makes pages grow mid-capture; freezing the height cuts
   the capture short silently. `MAX_STEPS` is the backstop for infinite scroll.
7. The lazy-load warm-up is bounded by time and growth ratio, not by a step
   count. A step cap gives up on tall pages, which is precisely where lazy
   loading leaves white gaps.

## Two capture modes

`capture-full-page` scrolls and stitches. `capture-region` (`Alt+Shift+S`) draws
an overlay on the page, takes the selected rectangle, and captures once without
touching the scroll position.

Region mode exists because cropping after a full capture makes you wait for the
whole scroll pass just to keep a button. What a person usually wants to clip is
already on screen. The overlay is removed and two animation frames are awaited
before capturing, or the overlay itself lands in the shot.

The selection arrives in CSS pixels and the capture comes back in display
pixels, so the rectangle is multiplied by `capturedWidth / viewportWidth` before
it is stored. The viewer applies `stored.region` when building.

## Crop

Cropping happens in the viewer, after the capture, not by selecting on the page
before it. Selecting first sounds more direct but a region taller than the
viewport still needs the scroll-and-stitch machinery, so it buys nothing and
costs a whole coordinate system.

The preview is scaled down to fit the shell, so a rectangle drawn on screen is
multiplied by `canvas.width / previewBox.width` before cutting. `fullCanvas`
holds the uncropped version so the crop can be undone.

## Capture again

The viewer stores the id of the tab it came from and asks the service worker to
re-run the capture there. This only works because `activeTab` survives until the
tab navigates or closes, so the grant from the first capture is usually still
live. When it is not, `executeScript` fails, the error badge appears on the tab
and the viewer says to use the keyboard shortcut instead.

## Design

Colors follow the ToolTank palette: Navy `#0D1B2A`, ToolTank Black `#1C1F2A`,
Warm Off-White `#F0EDE8`, Architectural Brass `#C9AB4C` for the accent, and
Muted Aqua `#5F9F9A` for informational notices only. Text sitting on brass is
navy, never white: brass is light and white on top does not clear contrast.

## Testing

Load unpacked at `chrome://extensions` with Developer mode on.
After editing, click reload (⟳) on the extension card.
Service worker errors: `chrome://extensions` → "service worker" → Console.
The last error is also kept in `chrome.storage.local.fs_lastError`.

## Known gaps

- Pages that scroll inside an inner container rather than the body are not
  captured in full.
- Does not work on `chrome://`, `chrome-extension://` or the Chrome Web Store
  (Chrome restriction).

## Language

The project ships in English. Commit messages before August 2026 are in Spanish;
they are left as they are rather than rewriting published history.
