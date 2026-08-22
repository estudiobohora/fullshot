# FullShot

A homemade replacement for GoFullPage. Captures the entire page, all the way down the scroll, and exports it as PNG or PDF. Everything happens inside your browser: nothing is uploaded anywhere.

## Install (2 minutes)

1. Unzip the `fullshot` folder wherever you plan to keep it. If you delete or move it, the extension stops working.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**, top right.
4. Click **Load unpacked** and pick the `fullshot` folder.
5. Pin the icon to the toolbar.

## Use

Click the icon, or press `Alt+Shift+P`. The badge shows progress (`3/7`). When it finishes, a tab opens with the preview and buttons to **Copy**, **Download PDF**, **Download JPG** or **Download PNG**. The file name box next to the logo is editable before you download.

**Capture again** re-runs the capture on the same page without leaving the viewer. It works as long as that tab is still open on the same page.

To change the shortcut: `chrome://extensions/shortcuts`.

## Settings

Everything lives in the viewer. The file name sits in the toolbar and is editable per capture; the gear opens the rest.

- **Default file name**: the template used for the next capture, with `{title}`, `{domain}`, `{date}` and `{time}` tokens. Editing the name in the toolbar only affects the capture in front of you.
- **JPEG quality**: also applies to the image embedded in the PDF. Below roughly 80% text starts to smear.
- **Hide fixed and sticky elements**: on by default so headers do not repeat. It applies to the *next* capture, so turn it off and press Capture again when a page keeps real content in a sticky panel.

Settings live in `chrome.storage.sync`, so they follow your Chrome profile.

## How it works

Chrome will not let an extension capture anything outside the visible viewport, so FullShot does what GoFullPage did:

1. Injects a script into the page, hides the scrollbars and turns off smooth scrolling.
2. Scrolls through the whole page once to trigger lazy-loaded images.
3. Scrolls one viewport at a time and calls `chrome.tabs.captureVisibleTab()` at each stop, throttled to 600 ms because Chrome caps this at roughly two captures per second.
4. Hides `position: fixed` and `sticky` elements after the first slice, so the header does not repeat down the whole screenshot.
5. Stores the slices, stitches them onto a `<canvas>`, and puts the page back the way it was.

## Known limits

- Does not work on `chrome://`, `chrome-extension://` or the Chrome Web Store. That is a Chrome restriction, not a bug.
- Pages that scroll inside an inner container instead of the document body are not captured in full.
- A Chrome canvas tops out around 250 megapixels. On very tall pages the capture is scaled down automatically and the preview tells you so.
- The PDF comes out as a single long page. Past 200 inches tall it is split across several.

## Permissions, and why

- `activeTab`: only the tab you clicked on. No standing access to any site.
- `scripting`: to inject the scrolling script on demand.
- `downloads`: to save the PNG or PDF.
- `storage` + `unlimitedStorage`: to hold the slices between capture and preview. They are deleted as soon as the viewer opens.

## Files

```
manifest.json      MV3 configuration
background.js      orchestrates scrolling and capture
page.js            script injected into the page
viewer.html/js     preview, export and settings
settings.js        defaults and file name building
lib/               jsPDF 2.5.2 (MIT)
icons/
tools/             icon generator
```

## Icons

The icons are generated, not hand-drawn. To change the color, weight or shape, edit `tools/make-icons.py` and run it:

```
python tools/make-icons.py
```

It writes all four sizes. There are three levels of detail on purpose: scaling a single drawing down to 16 px turns the framing brackets into grey smudges, so that size is drawn without them.

## License

FullShot is released under the MIT license, in the `LICENSE` file.

It bundles jsPDF 2.5.2, also MIT. Its copyright notice travels inside `lib/jspdf.umd.min.js`, so redistributing this folder satisfies its license.
