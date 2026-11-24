import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  M_PER_NM,
  aspect,
  altitudeThousands,
  aspectLabel,
  bearing3,
  bearingTo,
  destination,
  distanceTo,
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

  test('a zero-width viewport does not produce a non-finite zoom', () => {
    assert.ok(Number.isFinite(zoomForRange(40, 45, 0)));
  });
});
