#!/usr/bin/env bash
# Generate build/icons/* from public/icon-win.png for Linux packaging.
# electron-builder installs these into /usr/share/icons/hicolor/<size>/apps/.
#
# Requires ImageMagick (`convert`). Run from repo root:
#   ./scripts/generate-linux-icons.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/public/icon-win.png"
OUT_DIR="$ROOT/build/icons"

if command -v magick >/dev/null 2>&1; then
  CONVERT=(magick)
elif command -v convert >/dev/null 2>&1; then
  CONVERT=(convert)
else
  echo "error: ImageMagick is required (magick or convert)" >&2
  exit 1
fi

if [[ ! -f "$SOURCE" ]]; then
  echo "error: source icon not found: $SOURCE" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
for size in 16 32 48 64 128 256 512; do
  "${CONVERT[@]}" "$SOURCE" -resize "${size}x${size}!" "$OUT_DIR/${size}x${size}.png"
  echo "wrote build/icons/${size}x${size}.png"
done
