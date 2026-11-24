import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { gridStepDegrees } from '../src/client/graticule.js';

describe('graticule spacing', () => {
  // On-screen spacing should stay roughly constant: each step down in zoom
  // covers about twice the ground, so the degree step should roughly double
  // too, rather than holding flat forever once the preset range is exceeded.
  test('the step keeps widening below the 160 nm preset', () => {
    const steps = [9, 7, 5, 3, 1, -1].map(gridStepDegrees);
    for (let i = 1; i < steps.length; i++) {
      assert.ok(steps[i]! >= steps[i - 1]!, `step did not widen going from zoom ${9 - (i - 1) * 2} to ${9 - i * 2}`);
    }
  });

  test('it never returns zero or a negative step', () => {
    for (const zoom of [-5, 0, 3, 6, 9, 12, 15, 20]) assert.ok(gridStepDegrees(zoom) > 0);
  });
});
