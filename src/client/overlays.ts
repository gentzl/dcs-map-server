import type { Unit } from '../shared/types.js';
import { AIRBORNE } from '../shared/types.js';
import { M_PER_NM, RANGES_NM, destination, metersToNm, toRad } from './geo.js';

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
 * standard BVR working ranges, 40 nm a CAP-station overview scale. 80 and
 * 160 are past any employment range and serve navigation instead -- but the
 * wide steps need a reference out there too, see RINGS_FOR_RANGE.
 */
export const RING_RADII_NM = [2.5, 5, 10, 20, 40, 80, 160] as const;

/**
 * Which of those rings are shown per selected MFD range step. The key maps
 * 1:1 to RANGES_NM in geo.ts.
 *
 * The pattern is the half-range ring plus the step itself, the way an
 * HSI/HSD scales -- the display edge already is the selected range, so the
 * half-range ring is the reference you read against it. Two exceptions: the
 * 1 nm step gets none, because half of it is finer than the symbols
 * themselves, and the 50 nm step borrows 20/40 rather than inventing a 25 nm
 * ring, since 50 is an extra quick pick here and not a classic MFD step
 * anyway.
 *
 * Capped at two either way. Showing every ring up to the selected range (the
 * old behaviour) crowded the display -- seven overlapping rings near the
 * centre say nothing useful mid-fight.
 */
const RINGS_FOR_RANGE: Record<number, readonly number[]> = {
  1: [],
  5: [2.5, 5],
  10: [5, 10],
  20: [10, 20],
  50: [20, 40],
  80: [40, 80],
  160: [80, 160],
};

/**
 * Floors an arbitrary displayed range (e.g. mid-pinch, between presets) to
 * the largest preset step at or below it -- so which rings are shown
 * tracks what's actually visible, not just whichever range button was last
 * pressed.
 */
function ringStepFor(nm: number): number {
  let step: number = RANGES_NM[0];
  for (const r of RANGES_NM) {
    if (r <= nm + 1e-4) step = r;
  }
  return step;
}

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

  for (const nm of RINGS_FOR_RANGE[ringStepFor(rangeNm)] ?? []) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: geodesicRing(lat, lon, nm * M_PER_NM) },
      properties: { nm, kind: 'ring' },
    });
  }

  // Bearing ticks every 30°, the cardinal directions longer. They replace
  // the compass rose without cluttering the view. Always out to the edge of
  // the current view, independent of which specific rings are shown above --
  // except past the widest preset (160 nm), where there is no larger preset
  // for ringStepFor to float up to: the rings freeze there, so the ticks
  // have to as well, or stepless zoom-out drags them far outside the rings
  // they are meant to sit on, reading as a handful of stray, oddly angled
  // marks disconnected from anything.
  const outer = Math.min(rangeNm, Math.max(...RANGES_NM));
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
 * Velocity leader lines: a stub ahead of each airborne contact, as long as
 * the ground it covers in LEADER_SECONDS.
 *
 * This is what every radar display draws, and the reason is geometry at a
 * glance -- who is converging on whom, who is running, whether two tracks
 * will meet. Reading that off static symbols means selecting them one at a
 * time.
 *
 * Airborne contacts only. A mission puts a few dozen aircraft on the map and
 * several hundred vehicles, and a stub on every parked truck would bury the
 * picture it is meant to clarify.
 */
const LEADER_SECONDS = 60;

export function buildLeaders(
  units: Array<{ unit: Unit; lat: number; lon: number; hdg: number; ageMs: number; spdMs: number }>,
  ownCoalition: number,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const u of units) {
    if (!AIRBORNE.has(u.unit.category)) continue;
    // Below walking pace the heading is noise from the position deltas it is
    // derived from, and the stub would point somewhere arbitrary.
    if (u.spdMs < 5) continue;

    const [lat, lon] = destination(u.lat, u.lon, u.hdg, u.spdMs * LEADER_SECONDS);
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[u.lon, u.lat], [lon, lat]] },
      properties: {
        affiliation: u.unit.coalition === ownCoalition ? 'friend' : 'hostile',
        stale: u.ageMs > 5000,
      },
    });
  }

  return { type: 'FeatureCollection', features };
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
