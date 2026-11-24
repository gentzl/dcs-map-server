import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { buildLeaders } from '../src/client/overlays.js';
import { M_PER_NM, bearingTo, distanceTo, toDeg, toRad } from '../src/client/geo.js';
import type { Category, Coalition, Unit } from '../src/shared/types.js';

const OWN_COALITION = 2;

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
    assert.equal(buildLeaders(units, OWN_COALITION).features.length, 3);
  });

  test('a contact slower than walking pace gets none', () => {
    // Below that the heading is noise from the position deltas it comes
    // from, so the stub would point somewhere arbitrary.
    assert.equal(buildLeaders([contact('air', 1)], OWN_COALITION).features.length, 0);
    assert.equal(buildLeaders([contact('air', 0)], OWN_COALITION).features.length, 0);
  });

  test('the stub is one minute of flying, in the direction of travel', () => {
    const speed = 250; // m/s
    const [f] = buildLeaders([contact('air', speed, { hdg: toRad(90) })], OWN_COALITION).features;
    assert.ok(f && f.geometry.type === 'LineString');
    if (!f || f.geometry.type !== 'LineString') return;

    const [from, to] = f.geometry.coordinates as [number, number][];
    assert.ok(from && to);
    if (!from || !to) return;

    const metres = distanceTo(from[1], from[0], to[1], to[0]);
    assert.ok(Math.abs(metres - speed * 60) < 1, `${metres} m, expected ${speed * 60}`);
    assert.ok(Math.abs(metres / M_PER_NM - 8.1) < 0.1, 'about 8 nm at 250 m/s');
    assert.ok(Math.abs(toDeg(bearingTo(from[1], from[0], to[1], to[0])) - 90) < 0.01);
  });

  test('affiliation is relative to the viewer, like the symbols', () => {
    const own = buildLeaders([contact('air', 250, { coalition: 2 })], OWN_COALITION);
    const other = buildLeaders([contact('air', 250, { coalition: 1 })], OWN_COALITION);
    assert.equal(own.features[0]?.properties?.['affiliation'], 'friend');
    assert.equal(other.features[0]?.properties?.['affiliation'], 'hostile');
  });

  test('a contact that has gone quiet is marked stale, not dropped', () => {
    const [f] = buildLeaders([contact('air', 250, { ageMs: 9000 })], OWN_COALITION).features;
    assert.equal(f?.properties?.['stale'], true);
  });
});
