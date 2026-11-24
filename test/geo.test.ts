import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  M_PER_NM,
  aspect,
  altitudeThousands,
  aspectLabel,
  bearing3,
  bearingTo,
  closureMs,
  destination,
  distanceTo,
  groundTrack,
  formatAltitude,
  formatDDM,
  metersToFeet,
  metersToNm,
  msToKnots,
  rangeForZoom,
  shortestAngle,
  toDeg,
  toMagnetic,
  toRad,
  zoomForRange,
} from '../src/client/geo.js';

const near = (actual: number, expected: number, eps: number): void =>
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${actual} to be within ${eps} of ${expected}`,
  );

describe('great-circle maths', () => {
  test('going out and measuring back returns the same distance', () => {
    const [lat, lon] = destination(45, 37, toRad(123), 50 * M_PER_NM);
    near(metersToNm(distanceTo(45, 37, lat, lon)), 50, 0.01);
  });

  test('going out and looking back gives the reciprocal bearing', () => {
    const [lat, lon] = destination(45, 37, toRad(90), 20 * M_PER_NM);
    near(toDeg(bearingTo(45, 37, lat, lon)), 90, 0.01);
    // Not exactly 270: a great circle's bearing changes along the track.
    near(toDeg(bearingTo(lat, lon, 45, 37)), 270, 0.5);
  });

  test('a destination across the antimeridian stays a valid longitude', () => {
    const [, lon] = destination(0, 179.9, toRad(90), 100 * M_PER_NM);
    assert.ok(lon >= -180 && lon <= 180, `longitude out of range: ${lon}`);
    assert.ok(lon < 0, 'crossing east past 180 should come out negative');
  });

  test('bearings come out as three digits, the way they are spoken', () => {
    assert.equal(bearing3(toRad(5)), '005');
    assert.equal(bearing3(toRad(90)), '090');
    assert.equal(bearing3(toRad(359.6)), '000');
    assert.equal(bearing3(0), '000');
  });

  test('the shortest turn across north is a small one, not an almost-full circle', () => {
    near(toDeg(shortestAngle(toRad(350), toRad(10))), 20, 1e-9);
    near(toDeg(shortestAngle(toRad(10), toRad(350))), -20, 1e-9);
  });

  test('magnetic bearing is the true one less the variation', () => {
    near(toDeg(toMagnetic(toRad(90), 6.5)), 83.5, 1e-9);
    // Westerly variation, and the wrap below zero.
    near(toDeg(toMagnetic(toRad(2), -0.5)), 2.5, 1e-9);
    near(toDeg(toMagnetic(toRad(2), 6.5)), 355.5, 1e-9);
  });
});

describe('aspect', () => {
  test('a contact flying at us is hot, one flying away is cold', () => {
    // Contact heads north; we are due north of it, so it is pointing at us.
    near(aspect(toRad(0), toRad(0)), 0, 1e-9);
    near(aspect(toRad(0), toRad(180)), 180, 1e-9);
  });

  test('the labels sit on the standard boundaries', () => {
    assert.equal(aspectLabel(0), 'HOT');
    assert.equal(aspectLabel(30), 'HOT');
    assert.equal(aspectLabel(31), 'FLANK');
    assert.equal(aspectLabel(60), 'FLANK');
    assert.equal(aspectLabel(61), 'BEAM');
    assert.equal(aspectLabel(120), 'BEAM');
    assert.equal(aspectLabel(121), 'DRAG');
    assert.equal(aspectLabel(150), 'DRAG');
    assert.equal(aspectLabel(151), 'COLD');
    assert.equal(aspectLabel(180), 'COLD');
  });
});

describe('ground track', () => {
  test('with no wind the aircraft travels along its heading at airspeed', () => {
    const g = groundTrack(toRad(90), 200, { x: 0, z: 0 });
    near(toDeg(g.track), 90, 1e-9);
    near(g.speed, 200, 1e-9);
  });

  test('a tailwind adds to the ground speed and leaves the track alone', () => {
    // Heading north, wind blowing north (DCS x is north).
    const g = groundTrack(toRad(0), 200, { x: 30, z: 0 });
    near(toDeg(g.track), 0, 1e-9);
    near(g.speed, 230, 1e-9);
  });

  test('a headwind takes from it', () => {
    near(groundTrack(toRad(0), 200, { x: -30, z: 0 }).speed, 170, 1e-9);
  });

  test('a crosswind pushes the track off the heading', () => {
    // Heading north, wind from the west (blowing east, DCS z is east):
    // drifts right, and the ground speed is the hypotenuse.
    const g = groundTrack(toRad(0), 200, { x: 0, z: 50 });
    near(toDeg(g.track), toDeg(Math.atan2(50, 200)), 1e-9);
    near(g.speed, Math.hypot(200, 50), 1e-9);
    assert.ok(g.track > 0, 'a wind from the west should drift the track east');
  });

  test('stationary in still air keeps the heading rather than an arbitrary track', () => {
    const g = groundTrack(toRad(123), 0, { x: 0, z: 0 });
    near(toDeg(g.track), 123, 1e-9);
    near(g.speed, 0, 1e-9);
  });

  test('with no airspeed the result is the wind itself', () => {
    // The function knows nothing about wheels: it answers what a body moving
    // with the air does. Whether that applies is the caller's business --
    // track.ts withholds the wind while the aircraft is on the ground, or a
    // parked one would drift across the apron.
    const g = groundTrack(toRad(0), 0, { x: 0, z: 2 });
    near(toDeg(g.track), 90, 1e-9);
    near(g.speed, 2, 1e-9);
  });
});

describe('closure', () => {
  // Contact due north of us throughout, so the line of sight is bearing 000
  // and the geometry is easy to read off the headings.
  const N = toRad(0);

  test('head-on adds both speeds', () => {
    near(closureMs(toRad(0), 200, toRad(180), 150, N), 350, 1e-9);
  });

  test('a tail chase at matched speed closes on nothing', () => {
    near(closureMs(toRad(0), 200, toRad(0), 200, N), 0, 1e-9);
  });

  test('a contact running faster than us opens the range', () => {
    assert.ok(closureMs(toRad(0), 200, toRad(0), 300, N) < 0);
  });

  test('a contact crossing our nose neither closes nor opens on its own', () => {
    // Beaming: all of its speed is across the line of sight, so only our own
    // speed counts towards the range.
    near(closureMs(toRad(0), 200, toRad(90), 250, N), 200, 1e-9);
  });

  test('turning away from a contact stops us closing on it', () => {
    near(closureMs(toRad(90), 200, toRad(90), 0, N), 0, 1e-9);
  });
});

describe('cockpit formatting', () => {
  test('coordinates read as degrees and decimal minutes', () => {
    assert.equal(formatDDM(45.5, 'NS'), "N45°30.000'");
    assert.equal(formatDDM(-45.5, 'NS'), "S45°30.000'");
    // Longitude gets three degree digits, latitude two.
    assert.equal(formatDDM(7.25, 'EW'), "E007°15.000'");
    assert.equal(formatDDM(-7.25, 'EW'), "W007°15.000'");
    // Minutes below ten keep their leading zero: 06.000, not 6.000.
    assert.equal(formatDDM(45.1, 'NS'), "N45°06.000'");
  });

  test('altitude becomes a flight level above the transition', () => {
    assert.equal(formatAltitude(0), '0 ft');
    assert.equal(formatAltitude(1000), '3300 ft');
    assert.equal(formatAltitude(18_000 / 3.28084), 'FL180');
    assert.equal(formatAltitude(30_000 / 3.28084), 'FL300');
  });

  test('a contact altitude reads as thousands of feet', () => {
    // "thirty-one thousand nine hundred", the way it goes over the radio.
    assert.equal(altitudeThousands(31_900 / 3.28084), '31.9');
    assert.equal(altitudeThousands(0), '0.0');
  });

  test('unit conversions', () => {
    near(metersToFeet(1000), 3280.84, 0.01);
    near(metersToNm(1852), 1, 1e-9);
    near(msToKnots(1), 1.94384, 1e-5);
  });
});

describe('range and zoom', () => {
  test('a range turned into a zoom and back is the same range', () => {
    for (const rangeNm of [1, 10, 40, 160]) {
      for (const lat of [0, 45, 60]) {
        for (const px of [400, 1080]) {
          near(rangeForZoom(zoomForRange(rangeNm, lat, px), lat, px), rangeNm, 1e-9);
        }
      }
    }
  });

  test('the same range fills the same fraction of screen on a bigger display', () => {
    // "40 nm" has to mean the same thing on a phone and on a 4K monitor, so
    // the zoom differs while the range does not.
    const small = zoomForRange(40, 45, 400);
    const large = zoomForRange(40, 45, 1600);
    assert.ok(large > small, 'a larger viewport should zoom in further');
    near(large - small, 2, 1e-9); // four times the pixels is two zoom levels
  });

  // Pins the convention the range steps rest on, which a round trip between
  // the two functions cannot: they agreed with each other while both were
  // one zoom level out, and the view showed half the range it claimed.
  test('zoom 0 fits the whole world across 512 pixels, the way MapLibre scales it', () => {
    const halfWorldNm = 40_075_016.686 / 2 / M_PER_NM;
    near(rangeForZoom(0, 0, 512), halfWorldNm, 1);
  });

  test('a range step reaches the edge of the shorter screen axis', () => {
    // 20 nm on a 707 pixel tall viewport: the top of the screen is 20 nm
    // away, not 10.
    const zoom = zoomForRange(20, 43.78, 707);
    near(rangeForZoom(zoom, 43.78, 707), 20, 1e-9);
    // And one zoom level further in is half of it -- the error that was here.
    near(rangeForZoom(zoom + 1, 43.78, 707), 10, 1e-9);
  });

  test('a zero-width viewport does not produce a non-finite zoom', () => {
    assert.ok(Number.isFinite(zoomForRange(40, 45, 0)));
  });
});
