/**
 * Gradnetz über den sichtbaren Ausschnitt.
 *
 * Auf gedruckten Luftfahrtkarten trägt das Netz die Koordinatenablesung. Die
 * Teilung richtet sich nach dem Maßstab: ganze Grad im Überblick, Zehntel- und
 * Zweiminutenschritte im Nahbereich – so bleibt der Abstand am Bildschirm
 * ungefähr gleich, statt bei weitem Zoom zuzulaufen.
 */

export function gridStepDegrees(zoom: number): number {
  if (zoom >= 12) return 1 / 30; // 2'
  if (zoom >= 10) return 1 / 6; // 10'
  if (zoom >= 8) return 0.5; // 30'
  return 1;
}

export function formatGridLabel(value: number, axis: 'NS' | 'EW'): string {
  const hemi = axis === 'NS' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const abs = Math.abs(value);
  const deg = Math.floor(abs + 1e-9);
  const min = Math.round((abs - deg) * 60);
  return min === 0 ? `${hemi}${deg}°` : `${hemi}${deg}°${String(min).padStart(2, '0')}'`;
}

export function buildGraticule(
  bounds: { west: number; south: number; east: number; north: number },
  zoom: number,
): GeoJSON.FeatureCollection {
  const step = gridStepDegrees(zoom);
  const features: GeoJSON.Feature[] = [];

  // Etwas über den Rand hinaus ziehen, damit beim Drehen der Karte keine
  // abgeschnittenen Linien ins Bild wandern.
  const pad = step * 2;
  const w = Math.floor((bounds.west - pad) / step) * step;
  const e = Math.ceil((bounds.east + pad) / step) * step;
  const sLat = Math.max(-85, Math.floor((bounds.south - pad) / step) * step);
  const nLat = Math.min(85, Math.ceil((bounds.north + pad) / step) * step);

  // Obergrenze gegen Ausreißer: Bei unerwarteten Ausschnitten lieber kein Netz
  // als zehntausend Linien, die den Renderer blockieren.
  const maxLines = 400;
  if ((e - w) / step > maxLines || (nLat - sLat) / step > maxLines) {
    return { type: 'FeatureCollection', features };
  }

  for (let lon = w; lon <= e; lon += step) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [lon, sLat],
          [lon, nLat],
        ],
      },
      properties: { label: formatGridLabel(lon, 'EW'), axis: 'lon' },
    });
  }
  for (let lat = sLat; lat <= nLat; lat += step) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [w, lat],
          [e, lat],
        ],
      },
      properties: { label: formatGridLabel(lat, 'NS'), axis: 'lat' },
    });
  }

  return { type: 'FeatureCollection', features };
}
