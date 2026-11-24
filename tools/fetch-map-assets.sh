#!/usr/bin/env bash
# Fetches glyphs and sprites for map labelling into public/.
#
# Everything is kept locally, so no third-party host is needed at runtime.
# Source: protomaps/basemaps-assets, open and without an access key.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="https://protomaps.github.io/basemaps-assets"

# Unicode blocks that occur on DCS maps. 256 code points per entry.
#   0-511      Latin
#   512-767    Latin extended (Turkish diacritics)
#   768-1023   Combining characters and Greek
#   1024-1535  Cyrillic, Armenian, Hebrew
#   1536-2047  Arabic
#   4096-4351  Georgian   <- needed for the Caucasus
# Contact symbols don't come from glyphs: Noto Sans doesn't cover the
# geometric shapes (U+25A0 ff.). They're drawn client-side, see symbols.ts.
RANGES=(0-255 256-511 512-767 768-1023 1024-1279 1280-1535 1536-1791 1792-2047 4096-4351)
FONTS=("Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic")

for font in "${FONTS[@]}"; do
  # Only spaces need encoding; the fontstack names contain nothing else that
  # would cause trouble in a path. Saves a Python dependency.
  enc="${font// /%20}"
  mkdir -p "public/fonts/$font"
  for r in "${RANGES[@]}"; do
    out="public/fonts/$font/$r.pbf"
    [ -s "$out" ] && continue
    curl -sSf --max-time 30 -o "$out" "$BASE/fonts/$enc/$r.pbf" \
      || { rm -f "$out"; echo "  missing: $font $r"; }
  done
done

mkdir -p public/sprites
for f in light.json light.png light@2x.json light@2x.png; do
  [ -s "public/sprites/$f" ] || curl -sSf --max-time 30 -o "public/sprites/$f" "$BASE/sprites/v4/$f"
done

echo "Glyphs: $(find public/fonts -name '*.pbf' | wc -l | tr -d ' ') files, $(du -sh public/fonts | cut -f1)"
