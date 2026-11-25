import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { buildLeaders } from '../src/client/overlays.js';
import { M_PER_NM, bearingTo, distanceTo, metersPerPixel, toDeg, toRad } from '../src/client/geo.js';
import type { Category, Coalition, Unit } from '../src/shared/types.js';

const OWN_COALITION = 2;
const FAR_OUT_ZOOM = 0; // metres per pixel is so large here that the cap never binds

const contact = (
  category: Category,
  spdMs: number,
  over: { hdg?: number; coalition?: Coalition; ageMs?: number } = {},
) => ({
  unit: {
    id: 1,
    kind: 'unit',
    name: 'X',
    lat: 43,
    lon: 44,
    alt: 5000,
    hdg: over.hdg ?? 0,
    coalition: over.coalition ?? 2,
    category,
  } satisfies Unit,
  lat: 43,
  lon: 44,
  hdg: over.hdg ?? 0,
  ageMs: over.ageMs ?? 0,
  spdMs,
});

describe('velocity leader lines', () => {
  // A mission puts a few dozen aircraft on the map and several hundred
  // vehicles. A stub on every parked truck would bury the picture.
  test('only airborne contacts get one', () => {
    const units = [
      contact('air', 250),
      contact('helo', 60),
      contact('weapon', 600),
      contact('armor', 10),
      contact('ground', 10),
      contact('naval', 10),
      contact('static', 0),
    ];
    assert.equal(buildLeaders(units, OWN_COALITION, FAR_OUT_ZOOM).features.length, 3);
  });

  test('a contact slower than walking pace gets none', () => {
    // Below that the heading is noise from the position deltas it comes
    // from, so the stub would point somewhere arbitrary.
    assert.equal(buildLeaders([contact('air', 1)], OWN_COALITION, FAR_OUT_ZOOM).features.length, 0);
    assert.equal(buildLeaders([contact('air', 0)], OWN_COALITION, FAR_OUT_ZOOM).features.length, 0);
  });

  test('the stub is half a minute of flying, in the direction of travel', () => {
    const speed = 250; // m/s
    const [f] = buildLeaders([contact('air', speed, { hdg: toRad(90) })], OWN_COALITION, FAR_OUT_ZOOM).features;
    assert.ok(f && f.geometry.type === 'LineString');
    if (!f || f.geometry.type !== 'LineString') return;

    const [from, to] = f.geometry.coordinates as [number, number][];
    assert.ok(from && to);
    if (!from || !to) return;

    const metres = distanceTo(from[1], from[0], to[1], to[0]);
    assert.ok(Math.abs(metres - speed * 30) < 1, `${metres} m, expected ${speed * 30}`);
    assert.ok(Math.abs(metres / M_PER_NM - 4.05) < 0.1, 'about 4 nm at 250 m/s');
    assert.ok(Math.abs(toDeg(bearingTo(from[1], from[0], to[1], to[0])) - 90) < 0.01);
  });

  // At a close range step, 30 seconds of a fast jet's travel is a real
  // geographic distance many times the icon's own pixel size -- correct,
  // but reads as a stray line rather than a contact. Capped at one and a
  // half icon-widths on screen, which needs the current zoom to convert into
  // the matching real-world distance.
  test('the stub is capped at 1.5 icon-widths on screen, zoomed in close', () => {
    const CLOSE_ZOOM = 12;
    const lat = 43;
    const speed = 250; // m/s -- 7,500 m of raw travel, far past the cap here
    const [f] = buildLeaders([contact('air', speed, { hdg: toRad(90) })], OWN_COALITION, CLOSE_ZOOM).features;
    assert.ok(f && f.geometry.type === 'LineString');
    if (!f || f.geometry.type !== 'LineString') return;

    const [from, to] = f.geometry.coordinates as [number, number][];
    assert.ok(from && to);
    if (!from || !to) return;

    const metres = distanceTo(from[1], from[0], to[1], to[0]);
    const expectedCap = 1.5 * 34 * metersPerPixel(CLOSE_ZOOM, lat); // 34 = symbols/types.ts SIZE
    assert.ok(metres < speed * 30, 'the cap did not shorten the stub at all');
    assert.ok(Math.abs(metres - expectedCap) < 1, `${metres} m, expected the ${expectedCap} m cap`);
  });

  test('affiliation is relative to the viewer, like the symbols', () => {
    const own = buildLeaders([contact('air', 250, { coalition: 2 })], OWN_COALITION, FAR_OUT_ZOOM);
    const other = buildLeaders([contact('air', 250, { coalition: 1 })], OWN_COALITION, FAR_OUT_ZOOM);
    assert.equal(own.features[0]?.properties?.['affiliation'], 'friend');
    assert.equal(other.features[0]?.properties?.['affiliation'], 'hostile');
  });

  test('a contact that has gone quiet is marked stale, not dropped', () => {
    const [f] = buildLeaders([contact('air', 250, { ageMs: 9000 })], OWN_COALITION, FAR_OUT_ZOOM).features;
    assert.equal(f?.properties?.['stale'], true);
  });
});
