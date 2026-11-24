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

  // The role can come last in the name, and the separator varies by unit set.
  // A substring list with a space baked in on one side missed all of these,
  // so a Patriot site drew five stacked 100 km rings -- one per vehicle.
  const support = [
    'Patriot cp',
    'Patriot AMG',
    'Patriot ECS',
    'Patriot EPP',
    'Hawk pcp',
    'Hawk cwar',
    'NASAMS_Command_Post',
    'S-300PS 54K6 cp',
    'HQ-7_STR_SP',
  ];
  for (const name of support) {
    test(`${name} does not shoot and gets no ring`, () => {
      assert.equal(threatOf(name), null);
    });
  }

  test('the launcher of a site keeps its ring while its support does not', () => {
    assert.equal(threatOf('HQ-7_LN_SP')?.label, 'HQ-7');
    assert.equal(threatOf('NASAMS_LN_B')?.label, 'NASAMS');
    assert.equal(threatOf('Patriot ln')?.label, 'PATRIOT');
  });

  test('underscore-separated names are read like hyphenated ones', () => {
    // The SA-2 launcher is spelled S_75M_Volhov where the table says s-75.
    assert.deepEqual(threatOf('S_75M_Volhov'), { rangeM: 34_000, label: 'SA-2' });
  });

  test('a gun system gets its short ring rather than none', () => {
    assert.deepEqual(threatOf('HEMTT_C-RAM_Phalanx'), { rangeM: 2_000, label: 'C-RAM' });
    assert.deepEqual(threatOf('ZSU-23-4 Shilka'), { rangeM: 2_500, label: 'ZSU-23-4' });
  });

  test('a unit that is not air defence gets no ring', () => {
    assert.equal(threatOf('BMP-1'), null);
    assert.equal(threatOf('T-72B'), null);
  });
});
