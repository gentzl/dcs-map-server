#!/usr/bin/env bash
# Fetches the map tiles for a DCS theater as PMTiles.
#
# Pulls only the region's bytes via HTTP range requests out of the public
# Protomaps planet build. No Java, no access key.
# Requires: brew install pmtiles
set -euo pipefail
cd "$(dirname "$0")/.."

THEATER="${1:-caucasus}"
MAXZOOM="${2:-12}"

# minLon,minLat,maxLon,maxLat
case "$THEATER" in
  caucasus)      BBOX="36.0,40.0,47.0,46.0" ;;
  syria)         BBOX="32.0,31.5,42.5,37.5" ;;
  persiangulf)   BBOX="50.0,22.5,60.0,30.0" ;;
  sinai)         BBOX="30.0,27.0,36.5,32.5" ;;
  normandy)      BBOX="-3.5,48.0,2.0,51.5"  ;;
  marianas)      BBOX="144.0,12.5,147.5,16.0" ;;
  kola)          BBOX="20.0,64.0,42.0,71.0" ;;
  iraq)          BBOX="38.0,29.0,49.0,38.0" ;;
  afghanistan)   BBOX="60.0,29.0,75.0,39.0" ;;
  *) echo "unknown theater: $THEATER"; exit 1 ;;
esac

command -v pmtiles >/dev/null || { echo "pmtiles is missing: brew install pmtiles"; exit 1; }

# Protomaps only keeps a rolling window, so search backwards.
PLANET=""
for back in 2 3 4 5 6 7 8; do
  d=$(date -v-"${back}"d +%Y%m%d 2>/dev/null || date -d "-${back} days" +%Y%m%d)
  if curl -sSf -o /dev/null -r 0-16 "https://build.protomaps.com/$d.pmtiles" 2>/dev/null; then
    PLANET="https://build.protomaps.com/$d.pmtiles"; break
  fi
done
[ -n "$PLANET" ] || { echo "no reachable planet build found"; exit 1; }

mkdir -p tiles
echo "Source:  $PLANET"
echo "Region:  $THEATER  bbox $BBOX  maxzoom $MAXZOOM"
pmtiles extract "$PLANET" "tiles/$THEATER.pmtiles" --bbox="$BBOX" --maxzoom="$MAXZOOM"
ls -lh "tiles/$THEATER.pmtiles"
