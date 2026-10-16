#!/usr/bin/env bash
# Generate build/icon.icns from the macOS app artwork using Apple's native
# iconutil pipeline. Keep hand-tuned 16px/32px 1x artwork: shrinking the
# large macOS artwork turns its subtle highlight into a bright one-pixel frame.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/public/icon.png"
VECTOR_SOURCE="$ROOT/public/icon.svg"
OUTPUT="$ROOT/build/icon.icns"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/netcatty-mac-icon.XXXXXX")"
ICONSET="$TEMP_ROOT/icon.iconset"
SMALL_VECTOR="$TEMP_ROOT/icon-small.svg"
SMALL_RASTER="$TEMP_ROOT/icon-small.png"

cleanup() {
  find "$TEMP_ROOT" -type f -delete
  rmdir "$ICONSET" "$TEMP_ROOT"
}
trap cleanup EXIT

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: generating ICNS requires macOS iconutil and sips" >&2
  exit 1
fi
for source in "$SOURCE" "$VECTOR_SOURCE"; do
  if [[ ! -f "$source" ]]; then
    echo "error: source icon not found: $source" >&2
    exit 1
  fi
done

mkdir -p "$ICONSET"
# The large artwork has a subtle outer highlight. At 1x it collapses into a
# bright one-pixel frame, so omit only that final SVG rect for 16px/32px.
awk '
  BEGIN { skip = 0 }
  /<rect x="104\.0" y="104\.0"/ { skip = 1 }
  !skip { print }
  skip && /\/>/ { skip = 0 }
' "$VECTOR_SOURCE" > "$SMALL_VECTOR"
sips -s format png "$SMALL_VECTOR" --out "$SMALL_RASTER" >/dev/null

for size in 16 32 128 256 512; do
  retina_size=$((size * 2))
  if [[ "$size" = 16 || "$size" = 32 ]]; then
    sips -z "$size" "$size" "$SMALL_RASTER" \
      --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  else
    sips -z "$size" "$size" "$SOURCE" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  fi
  sips -z "$retina_size" "$retina_size" "$SOURCE" \
    --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil --convert icns "$ICONSET" --output "$OUTPUT"
echo "wrote build/icon.icns"
