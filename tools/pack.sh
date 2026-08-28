#!/usr/bin/env bash
# Builds the ZIP that goes to the Chrome Web Store.
#
# This exists so packaging stops being a decision. Zipping the repo folder by
# hand sweeps in tools/*.py and the .md files, and tools/make-store-shots.py
# carries an https:// URL. That is exactly the shape of the second rejection:
# the Web Store rejected a bundle that CONTAINED a remote URL inside a file that
# never ran. Only the files listed here ship.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT="fullshot-$(node -p "require('./manifest.json').version" 2>/dev/null || \
                python3 -c "import json;print(json.load(open('manifest.json'))['version'])").zip"

FILES=(
  manifest.json
  background.js
  page.js
  settings.js
  viewer.js
  minipdf.js
  viewer.html
  icons
)

rm -f "$OUT"
zip -r -q "$OUT" "${FILES[@]}" -x '*.DS_Store'

# Last line of defence: refuse to hand over a ZIP with a URL in it. The two
# Chrome Web Store comparisons in isBlocked() are the only ones allowed.
found=$(unzip -p "$OUT" '*.js' '*.html' '*.json' | grep -o 'https\?://[^"'"'"' )]*' | \
        grep -v '^https://chromewebstore.google.com$' | \
        grep -v '^https://chrome.google.com/webstore$' || true)
if [ -n "$found" ]; then
  echo "ABORT: URLs no permitidas dentro del paquete:" >&2
  echo "$found" >&2
  rm -f "$OUT"
  exit 1
fi

echo "OK  $OUT  ($(unzip -l "$OUT" | tail -1 | awk '{print $2}') archivos)"
unzip -l "$OUT" | sed -n '4,$p' | head -n -2 | awk '{print "    " $4}'
