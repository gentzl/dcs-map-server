import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { findPlaces } from '../src/client/find.js';
import type { Airbase, Zone } from '../src/shared/types.js';

const zone = (name: string): Zone =>
  ({ id: name.length, name, hidden: false, shape: 'circle', lat: 35, lon: 36, radiusM: 900, color: [1, 1, 1, 0.15] });
const base = (name: string, level2 = 13): Airbase =>
  ({ id: name.length, name, lat: 33.4, lon: 36.5, alt: 600, hdg: 0, coalition: 0, level2 });

const zones = [zone('FOB Vulture'), zone('FOB Monday'), zone('FOB Monday-1'), zone('Old FOB'), zone('Damascus'), zone('Alpha')];
const airbases = [base('Damascus'), base('woRunWay', 18)];

describe('find', () => {
  test('names starting with the query first, then any containing it', () => {
    assert.deepEqual(findPlaces('fob', zones, airbases).map((p) => p.name), ['FOB Monday', 'FOB Vulture', 'Old FOB']);
  });

  test('ignores case, spaces and punctuation', () => {
    assert.deepEqual(findPlaces('fobvult', zones, airbases).map((p) => p.name), ['FOB Vulture']);
  });

  test('an airfield and its zone of the same name come up once, as the airfield', () => {
    const hits = findPlaces('damascus', zones, airbases);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.kind, 'airfield');
    assert.equal(hits[0]!.base?.name, 'Damascus');
  });

  test('only what the map draws: no sub-zones, no runway-less pads', () => {
    assert.equal(findPlaces('monday-1', zones, airbases).length, 0);
    assert.equal(findPlaces('worunway', zones, airbases).length, 0);
  });

  test('an empty query finds nothing', () => {
    assert.deepEqual(findPlaces('  ', zones, airbases), []);
  });
});
