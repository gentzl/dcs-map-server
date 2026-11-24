import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { buildRings } from '../src/client/overlays.js';
import { M_PER_NM, RANGES_NM, distanceTo } from '../src/client/geo.js';

const LAT = 43.78;
const LON = 44.62;

/** Radii of the range rings shown at a given displayed range, in nm. */
const ringsAt = (rangeNm: number): number[] =>
  buildRings(LAT, LON, rangeNm)
    .features.filter((f) => f.properties?.['kind'] === 'ring')
    .map((f) => f.properties?.['nm'] as number);

describe('which range rings are shown', () => {
  test('the table is what it says it is', () => {
    assert.deepEqual(ringsAt(1), []);
    assert.deepEqual(ringsAt(5), [2.5, 5]);
    assert.deepEqual(ringsAt(10), [5, 10]);
    assert.deepEqual(ringsAt(20), [10, 20]);
    assert.deepEqual(ringsAt(50), [20, 40]); // borrows 20/40, see RINGS_FOR_RANGE
    assert.deepEqual(ringsAt(80), [40, 80]);
    assert.deepEqual(ringsAt(160), [80, 160]);
  });

  // The two widest steps used to stop at 40 nm, which left the outer half --
  // at 160 nm the outer three quarters -- of the display with no distance
  // reference at all.
  test('no step leaves its outer half without a ring', () => {
    for (const nm of RANGES_NM) {
      if (nm === 1) continue;
      const outer = Math.max(...ringsAt(nm));
      assert.ok(outer >= nm / 2, `range step ${nm}: outermost ring is ${outer} nm`);
    }
  });

  test('no ring is drawn beyond the selected range', () => {
    for (const nm of RANGES_NM) {
      for (const r of ringsAt(nm)) assert.ok(r <= nm, `range step ${nm}: ring at ${r} nm`);
    }
  });

  test('never more than two rings, however wide the step', () => {
    for (const nm of RANGES_NM) assert.ok(ringsAt(nm).length <= 2, `range step ${nm}`);
  });

  // Otherwise a pinch or wheel zoom away from a button leaves the rings
  // frozen at whichever step was last pressed.
  test('a range between presets uses the preset at or below it', () => {
    assert.deepEqual(ringsAt(35), ringsAt(20));
    assert.deepEqual(ringsAt(79.9), ringsAt(50));
    assert.deepEqual(ringsAt(500), ringsAt(160));
  });

  test('a range below the smallest preset does not fall off the table', () => {
    assert.deepEqual(ringsAt(0.3), []);
  });
});

describe('ring geometry', () => {
  // Drawn geodesically, not as screen circles: in heading-up presentation and
  // at high latitudes a screen circle would not hold its range.
  test('every point of a ring is its stated distance from the centre', () => {
    const ring = buildRings(LAT, LON, 160).features.find((f) => f.properties?.['nm'] === 80);
    assert.ok(ring, 'no 80 nm ring at the 160 nm step');
    assert.equal(ring.geometry.type, 'LineString');
    if (ring.geometry.type !== 'LineString') return;

    for (const [lon, lat] of ring.geometry.coordinates) {
      const nm = distanceTo(LAT, LON, lat as number, lon as number) / M_PER_NM;
      assert.ok(Math.abs(nm - 80) < 0.01, `point sits at ${nm} nm, not 80`);
    }
  });

  test('a ring closes on itself', () => {
    const ring = buildRings(LAT, LON, 20).features.find((f) => f.properties?.['nm'] === 10);
    assert.ok(ring && ring.geometry.type === 'LineString');
    if (!ring || ring.geometry.type !== 'LineString') return;
    const c = ring.geometry.coordinates;
    assert.deepEqual(c[0], c[c.length - 1]);
  });

  test('every step has 12 bearing ticks, 4 of them cardinals', () => {
    for (const nm of RANGES_NM) {
      const ticks = buildRings(LAT, LON, nm).features.filter((f) => f.properties?.['kind'] === 'tick');
      assert.equal(ticks.length, 12, `range step ${nm}`); // every 30 degrees
      assert.equal(ticks.filter((f) => f.properties?.['major'] === true).length, 4); // cardinals
    }
  });

  const tickOuterRadiusNm = (rangeNm: number): number => {
    const tick = buildRings(LAT, LON, rangeNm).features.find((f) => f.properties?.['kind'] === 'tick');
    assert.ok(tick && tick.geometry.type === 'LineString');
    if (!tick || tick.geometry.type !== 'LineString') return NaN;
    const far = tick.geometry.coordinates[1] as [number, number];
    return distanceTo(LAT, LON, far[1], far[0]) / M_PER_NM;
  };

  // Reported as "weird direction arrows": floating marks with no ring near
  // them, disconnected from anything. Ticks used to reach a uniform
  // geographic radius in every direction ("the edge of the view"), but the
  // view is a wide rectangle, not a circle -- that radius only reaches the
  // true edge along the screen's short axis. Along the long axis it falls
  // well short, stranding ticks in open space. Reproduced at perfectly
  // ordinary zoom (55 nm between the 50 and 80 presets), not just deep
  // stepless zoom-out. Anchoring to the outermost ring that is actually
  // drawn means a tick always touches something, in every direction.
  test('ticks sit exactly on the outermost ring shown, at any range', () => {
    for (const rangeNm of [1, 35, 55, 145, 160, 161, 320, 497, 5000]) {
      const rings = ringsAt(rangeNm);
      const expected = rings.length ? Math.max(...rings) : rangeNm;
      const r = tickOuterRadiusNm(rangeNm);
      assert.ok(Math.abs(r - expected) < 0.1, `range ${rangeNm}: ticks reach ${r} nm, not ${expected}`);
    }
  });
});
