/**
 * Lat/lon graticule over the visible view.
 *
 * On printed aviation charts the grid carries the coordinate reading. The
 * spacing follows the scale: whole degrees at overview zoom, tenth- and
 * two-minute steps up close -- so the on-screen spacing stays roughly
 * constant instead of collapsing at wide zoom.
 */

export function gridStepDegrees(zoom: number): number {
  if (zoom >= 12) return 1 / 30; // 2'
  if (zoom >= 10) return 1 / 6; // 10'
  if (zoom >= 8) return 0.5; // 30'
  if (zoom >= 6) return 1; // 1 degree -- the widest range preset, 160 nm, sits here
  // Below the widest preset there's still stepless wheel/pinch zoom, all the
  // way out to zoom 0. Without these tiers the grid stayed at a flat 1
  // degree no matter how far out that went -- fine at the 160 nm preset,
  // packed solid a few pinch-outs further, since 1 degree covers fewer and
  // fewer screen pixels the further out you go.
  if (zoom >= 4) return 2;
  if (zoom >= 2) return 5;
  return 10;
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

  // Extend a bit past the edge, so rotating the map doesn't bring cut-off
  // lines into view.
  const pad = step * 2;
  const w = Math.floor((bounds.west - pad) / step) * step;
  const e = Math.ceil((bounds.east + pad) / step) * step;
  const sLat = Math.max(-85, Math.floor((bounds.south - pad) / step) * step);
  const nLat = Math.min(85, Math.ceil((bounds.north + pad) / step) * step);

  // Upper bound against outliers: for an unexpected view, better no grid at
  // all than ten thousand lines that block the renderer.
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
