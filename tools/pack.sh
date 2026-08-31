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
  LICENSE
  icons
)

rm -f "$OUT"

# zip is not installed everywhere (it is missing from Git Bash on Windows, where
# this repo actually lives), so fall back to the tar that ships with Windows 10
# and later. Do NOT reach for PowerShell here: both Compress-Archive and
# [System.IO.Compression.ZipFile] on Windows PowerShell 5.1 write the entries as
# icons\icon16.png, with a backslash, which is not a valid zip path separator.
# Chrome then cannot find the icons the manifest points at, and the archive
# still looks fine in Explorer and passes an integrity test.
if command -v zip >/dev/null 2>&1; then
  zip -r -q "$OUT" "${FILES[@]}" -x '*.DS_Store'
else
  # Only a libarchive tar can write a .zip. On Windows that is the system
  # tar.exe; the `tar` first on PATH in Git Bash is GNU tar, which cannot.
  BSDTAR=""
  for c in /c/Windows/System32/tar.exe tar bsdtar; do
    if command -v "$c" >/dev/null 2>&1 && "$c" --version 2>/dev/null | grep -qi 'bsdtar\|libarchive'; then
      BSDTAR="$c"; break
    fi
  done
  if [ -z "$BSDTAR" ]; then
    echo "ABORT: no hay zip ni un tar de libarchive capaz de escribir .zip." >&2
    exit 1
  fi
  STAGE=$(mktemp -d)
  trap 'rm -rf "$STAGE"' EXIT
  for f in "${FILES[@]}"; do cp -R "$f" "$STAGE/"; done
  find "$STAGE" -name '.DS_Store' -delete
  "$BSDTAR" -a -c -f "$(pwd)/$OUT" -C "$STAGE" "${FILES[@]}"
fi


# Paths inside a zip must use forward slashes. A backslash here means the
# archive was built by a tool that does not know that, and Chrome will fail to
# find the icons.
if unzip -l "$OUT" | grep -qF '\'; then
  echo "ABORT: el paquete trae rutas con barra invertida." >&2
  rm -f "$OUT"
  exit 1
fi

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
