import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { OwnshipEstimator } from '../src/client/track.js';
import type { Ownship } from '../src/shared/types.js';

/** A parked aircraft (no speed, wheels down), so only the corrections move it. */
const parked = (lat: number, lon: number): Ownship =>
  ({ id: 1, name: 'F-16C_50', lat, lon, alt: 0, hdg: 0, tas: 0, wow: 1, wind: { x: 0, z: 0 }, modelTime: 0 }) as unknown as Ownship;

/** Runs the estimator for `ms` of frames at 60 fps. */
function frames(est: OwnshipEstimator, ms: number): void {
  for (let t = 0; t < ms; t += 16) est.step(16);
}

describe('own aircraft estimate', () => {
  test('settles on the reported position', () => {
    const est = new OwnshipEstimator();
    est.update(parked(43.0, 42.0));
    est.update(parked(43.01, 42.0));
    frames(est, 2000);
    assert.ok(Math.abs(est.lat - 43.01) < 1e-6, String(est.lat));
  });

  test('many updates while no frame is drawn do not pile up', () => {
    // A tab in the background or a locked phone: the browser stops drawing
    // frames, but the WebSocket keeps delivering positions. When drawing
    // resumes, the estimate must land on the last report -- not on the sum
    // of every difference reported in between.
    const est = new OwnshipEstimator();
    est.update(parked(43.0, 42.0));
    for (let i = 0; i < 50; i++) est.update(parked(43.01, 42.0));
    frames(est, 2000);
    assert.ok(Math.abs(est.lat - 43.01) < 1e-6, `ended at ${est.lat}, expected 43.01`);
  });

  test('a turn reported while no frame is drawn is applied once', () => {
    const est = new OwnshipEstimator();
    est.update({ ...parked(43.0, 42.0), hdg: 0 });
    for (let i = 0; i < 20; i++) est.update({ ...parked(43.0, 42.0), hdg: 0.5 });
    frames(est, 2000);
    // The blend works the rest off exponentially; after 2 s it is within 0.01 degrees.
    assert.ok(Math.abs(est.hdg - 0.5) < 2e-4, `heading ${est.hdg}, expected 0.5`);
  });
});
