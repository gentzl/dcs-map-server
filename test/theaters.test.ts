import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { theaterAt, theaterContains } from '../src/shared/theaters.js';

const ALL = ['caucasus', 'syria', 'persiangulf', 'sinai', 'normandy', 'marianas', 'kola', 'iraq', 'afghanistan'];

describe('picking the theater from a position', () => {
  test('Anapa is in the Caucasus', () => {
    // The own aircraft's position in the recorded fixture session.
    assert.equal(theaterAt(45.005, 37.366, ALL), 'caucasus');
  });

  test('a theater without tiles is not a candidate', () => {
    assert.equal(theaterAt(45.005, 37.366, ['syria', 'marianas']), null);
  });

  test('outside every theater there is no match', () => {
    assert.equal(theaterAt(0, 0, ALL), null);
  });

  test('where Syria and Iraq overlap, the smaller one wins', () => {
    const lat = 35;
    const lon = 40;
    assert.ok(theaterContains('syria', lat, lon) && theaterContains('iraq', lat, lon));
    assert.equal(theaterAt(lat, lon, ALL), 'syria');
    assert.equal(theaterAt(lat, lon, ['iraq']), 'iraq');
  });

  test('an unknown theater name contains nothing', () => {
    assert.equal(theaterContains('nowhere', 45, 37), false);
  });
});
