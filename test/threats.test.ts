import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { threatOf } from '../src/server/threats.js';

describe('threat rings', () => {
  test('a launcher gets its system\'s engagement range', () => {
    assert.deepEqual(threatOf('S-300PS 5P85C ln'), { rangeM: 75_000, label: 'SA-10' });
    assert.deepEqual(threatOf('SA-11 Buk LN 9A310M1'), { rangeM: 35_000, label: 'SA-11' });
    assert.deepEqual(threatOf('Patriot ln'), { rangeM: 100_000, label: 'PATRIOT' });
  });

  // A ring around every element of a site would clutter the map without
  // saying anything -- radars don't shoot.
  const radars = ['S-300PS 40B6M tr', 'S-300PS 64H6E sr', 'Kub 1S91 str', 'SNR_75V', 'Roland Radar', 'Patriot str', 'Hawk sr', 'Dog Ear radar'];
  for (const name of radars) {
    test(`${name} gets no ring`, () => {
      assert.equal(threatOf(name), null);
    });
  }

  test('a more specific system wins over a more general one', () => {
    // Order in the table matters: 'strela-10' must be found before 'strela'.
    assert.equal(threatOf('Strela-10M3')?.label, 'SA-13');
    assert.equal(threatOf('Strela-1 9P31')?.label, 'SA-9');
  });

  test('a unit that is not air defence gets no ring', () => {
    assert.equal(threatOf('BMP-1'), null);
    assert.equal(threatOf('T-72B'), null);
  });
});
