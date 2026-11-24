import type { Unit } from '../shared/types.js';
import { M_PER_NM, destination, metersToNm, toRad } from './geo.js';

/**
 * Tactical overlays: range rings and bearing ticks around the own aircraft.
 *
 * The rings are drawn geodesically, not as screen circles. In heading-up
 * presentation and at high latitudes a screen circle would otherwise be
 * visibly distorted -- and a range ring that doesn't hold its range is worse
 * than none at all.
 */

/**
 * Ring radii in nautical miles, tied to the distances a fighter pilot
 * actually uses them for: 2.5 nm close tactical/formation distance and
 * rejoin, 5 nm a typical IR Rmax and the rough BVR/WVR transition, 10/20 nm
 * standard BVR working ranges, 40 nm a CAP-station overview scale.
 */
export const RING_RADII_NM = [2.5, 5, 10, 20, 40] as const;

/**
 * Which of those rings are shown per selected MFD range step.
 *
 * Showing every ring up to the selected range (the old behaviour) crowded
 * the display at wide range steps -- seven overlapping rings near the
 * centre say nothing useful mid-fight. Capped at the one or two bands
 * actually relevant to that step instead; the key maps 1:1 to RANGES_NM
 * in geo.ts.
 */
const RINGS_FOR_RANGE: Record<number, readonly number[]> = {
  1: [],
  5: [2.5, 5],
  10: [5, 10],
  20: [10, 20],
  50: [20, 40],
  80: [40],
  160: [40],
};

const CIRCLE_SEGMENTS = 128;

function geodesicRing(lat: number, lon: number, radiusM: number): [number, number][] {
  const coords: [number, number][] = [];
  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const brg = (i / CIRCLE_SEGMENTS) * 2 * Math.PI;
    const [la, lo] = destination(lat, lon, brg, radiusM);
    coords.push([lo, la]);
  }
  return coords;
}

export function buildRings(lat: number, lon: number, rangeNm: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const nm of RINGS_FOR_RANGE[rangeNm] ?? []) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: geodesicRing(lat, lon, nm * M_PER_NM) },
      properties: { nm, kind: 'ring' },
    });
  }

  // Bearing ticks every 30°, the cardinal directions longer. They replace
  // the compass rose without cluttering the view. Always out to the edge of
  // the current view, independent of which specific rings are shown above.
  const outer = rangeNm;
  for (let deg = 0; deg < 360; deg += 30) {
    const major = deg % 90 === 0;
    const from = outer * (major ? 0.9 : 0.95);
    const [la1, lo1] = destination(lat, lon, toRad(deg), from * M_PER_NM);
    const [la2, lo2] = destination(lat, lon, toRad(deg), outer * M_PER_NM);
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[lo1, la1], [lo2, la2]] },
      properties: { kind: 'tick', major },
    });
  }

  return { type: 'FeatureCollection', features };
}

export function buildBullseye(lat: number, lon: number): GeoJSON.FeatureCollection {
  // Just the point. Visibility comes from a drawn symbol of fixed screen
  // size -- geodesic rings around the bullseye competed with the own
  // aircraft's range rings and covered half the view at small range steps.
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }],
  };
}



/**
 * Air defence engagement ranges, as filled areas.
 *
 * Deliberately polygons rather than lines: the message is "this area is
 * dangerous", and a filled area says that immediately, while a bare circle
 * outline has to be read first. Drawn geodesically like the range rings -- a
 * ring that doesn't hold its range would be worse than none.
 */
export function buildThreatRings(
  units: Array<{ unit: Unit; lat: number; lon: number; ageMs: number }>,
  mode: 'hostile' | 'all' | 'none',
  ownCoalition: number,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (mode === 'none') return { type: 'FeatureCollection', features };

  for (const u of units) {
    const range = u.unit.threatM;
    if (!range) continue;
    if (mode === 'hostile' && u.unit.coalition === ownCoalition) continue;

    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [geodesicRing(u.lat, u.lon, range)] },
      properties: {
        affiliation: u.unit.coalition === ownCoalition ? 'friend' : 'hostile',
        label: `${u.unit.threatLabel ?? ''} ${Math.round(metersToNm(range))}`,
        stale: u.ageMs > 5000,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}
