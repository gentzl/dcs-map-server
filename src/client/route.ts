import type { Route } from '../shared/types.js';

/**
 * The player's own flight plan as map features: one line through all
 * waypoints, and a point per waypoint labelled with its number (and the
 * mission builder's name, where there is one). Numbered from 0 like the
 * mission editor and most cockpits do, so "WP2" on the map is "WP2" in the
 * aircraft.
 *
 * Only fixed waypoints arrive here -- see Route in shared/types.ts for which
 * ones DCS doesn't hand out.
 */
export function buildRoute(route: Route | null): GeoJSON.FeatureCollection {
  if (!route || route.points.length === 0) return { type: 'FeatureCollection', features: [] };
  const features: GeoJSON.Feature[] = [];
  if (route.points.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: route.points.map((p) => [p.lon, p.lat]) },
      properties: { kind: 'leg' },
    });
  }
  route.points.forEach((p, i) => {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        kind: 'wp',
        label: p.name ? `${i} ${p.name}` : String(i),
        next: i === route.next,
      },
    });
  });
  return { type: 'FeatureCollection', features };
}
