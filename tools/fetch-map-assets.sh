#!/usr/bin/env bash
# Laedt Glyphen und Sprites fuer die Kartenbeschriftung nach public/.
#
# Alles wird lokal vorgehalten, damit zur Laufzeit kein fremder Host noetig ist.
# Quelle: protomaps/basemaps-assets, offen und ohne Zugangsschluessel.
set -euo pipefail
cd "$(dirname "$0")/.."
BASE="https://protomaps.github.io/basemaps-assets"

# Unicode-Bloecke, die in DCS-Karten vorkommen. Je Eintrag 256 Codepoints.
#   0-511      Latein
#   512-767    Latein erweitert (tuerkische Diakritika)
#   768-1023   Kombinierende Zeichen und Griechisch
#   1024-1535  Kyrillisch, Armenisch, Hebraeisch
#   1536-2047  Arabisch
#   4096-4351  Georgisch   <- noetig fuer Kaukasus
# Kontaktsymbole kommen nicht aus Glyphen: Noto Sans deckt die geometrischen
# Formen (U+25A0 ff.) nicht ab. Sie werden im Client gezeichnet, siehe symbols.ts.
RANGES=(0-255 256-511 512-767 768-1023 1024-1279 1280-1535 1536-1791 1792-2047 4096-4351)
FONTS=("Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic")

for font in "${FONTS[@]}"; do
  enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$font")
  mkdir -p "public/fonts/$font"
  for r in "${RANGES[@]}"; do
    out="public/fonts/$font/$r.pbf"
    [ -s "$out" ] && continue
    curl -sSf --max-time 30 -o "$out" "$BASE/fonts/$enc/$r.pbf" \
      || { rm -f "$out"; echo "  fehlt: $font $r"; }
  done
done

mkdir -p public/sprites
for f in light.json light.png light@2x.json light@2x.png; do
  [ -s "public/sprites/$f" ] || curl -sSf --max-time 30 -o "public/sprites/$f" "$BASE/sprites/v4/$f"
done

echo "Glyphen: $(find public/fonts -name '*.pbf' | wc -l | tr -d ' ') Dateien, $(du -sh public/fonts | cut -f1)"
