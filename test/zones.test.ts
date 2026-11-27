import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { parseDatagram } from '../src/server/protocol.js';
import { World } from '../src/server/world.js';
import { buildZones, isMainZone } from '../src/client/zones.js';
import { toDatagrams, zoneLine } from '../tools/wire.js';
import type { Zone } from '../src/shared/types.js';

const parse = (line: string) => parseDatagram(toDatagrams([line], 0, 'optview_all', 3)[0]!).items[0];

describe('trigger zones', () => {
  test('a circle survives a write/parse roundtrip', () => {
    const item = parse(zoneLine({ id: 18744, name: 'FOB Vulture', hidden: false, type: 0, radius: 762, lat: 44.37, lon: 39.83, color: [1, 1, 1, 0.15] }));
    assert.equal(item?.kind, 'zone');
    if (item?.kind !== 'zone') return;
    assert.equal(item.zone.name, 'FOB Vulture');
    assert.equal(item.zone.shape, 'circle');
    assert.equal(item.zone.radiusM, 762);
    assert.equal(item.zone.hidden, false);
    assert.deepEqual(item.zone.color, [1, 1, 1, 0.15]);
  });

  test('a quad keeps its corners', () => {
    const vertices: [number, number][] = [[42, 41], [42.01, 41], [42.01, 41.01], [42, 41.01]];
    const item = parse(zoneLine({ id: 1, name: 'A', hidden: true, type: 2, radius: 0, lat: 42.005, lon: 41.005, color: [1, 1, 1, 0.15], vertices }));
    assert.equal(item?.kind, 'zone');
    if (item?.kind !== 'zone') return;
    assert.equal(item.zone.shape, 'quad');
    assert.equal(item.zone.hidden, true);
    assert.deepEqual(item.zone.vertices, vertices);
  });

  const zone = (name: string, over: Partial<Zone> = {}): Zone =>
    ({ id: name.length, name, hidden: false, shape: 'circle', lat: 44, lon: 40, radiusM: 500, color: [1, 1, 1, 0.15], ...over });

  test('only the objective itself, not its numbered parts and spawn points', () => {
    assert.equal(isMainZone(zone('FOB Vulture')), true);
    assert.equal(isMainZone(zone('Kobuleti')), true);
    for (const n of ['FOB Monday-1', 'FOB Monday-sp', 'FOB Monday-hsp', 'Kutaisi-4', 'Victor 3']) {
      assert.equal(isMainZone(zone(n)), false, n);
    }
  });

  test('a zone the mission hides stays hidden', () => {
    assert.equal(isMainZone(zone('FOB Vulture', { hidden: true })), false);
  });

  test('a circle becomes a closed polygon of the right size', () => {
    const fc = buildZones([zone('FOB Vulture', { radiusM: 762 })]);
    assert.equal(fc.features.length, 1);
    const ring = (fc.features[0]!.geometry as GeoJSON.Polygon).coordinates[0]!;
    assert.deepEqual(ring[0], ring.at(-1));
    // East edge: 762 m at 44N is about 0.00953 deg of longitude.
    const maxLon = Math.max(...ring.map((p) => p[0]!));
    assert.ok(Math.abs(maxLon - 40 - 0.00953) < 0.0002, String(maxLon));
  });

  test('three kinds: large sectors, airfields, objectives -- each with its side', () => {
    // A ship sector like BSC's "A": about 50 x 74 km.
    const sector = zone('A', {
      shape: 'quad', radiusM: 0,
      vertices: [[33.0, 34.0], [33.45, 34.0], [33.45, 34.67], [33.0, 34.67]],
    });
    const base = { id: 9, name: 'Ramat David', lat: 32.66, lon: 35.18, alt: 0, hdg: 0, coalition: 2 as const, level2: 13 };
    const fc = buildZones(
      [sector, zone('Ramat David', { radiusM: 2100 }), zone('Jisr Ash Shughur', { radiusM: 1500 })],
      [base],
    );
    const props = Object.fromEntries(fc.features.map((f) => [f.properties!['name'], f.properties]));
    assert.deepEqual([props['A']!['kind'], props['A']!['side']], ['sector', 'none']);
    assert.deepEqual([props['Ramat David']!['kind'], props['Ramat David']!['side']], ['airfield', 'blue']);
    assert.deepEqual([props['Jisr Ash Shughur']!['kind'], props['Jisr Ash Shughur']!['side']], ['objective', 'red']);
  });

  test('a narrow sector is still a sector, a long airfield still an objective', () => {
    // As in the live BSC Caucasus mission: sector "F" is a strip of 8.0 x 86.8 km,
    // and its shorter side once made it look like an objective (drawn red).
    // Corners along a line north-northwest from Poti, 8 km wide.
    const f = zone('F', {
      shape: 'quad', radiusM: 0,
      vertices: [[42.0, 41.4], [42.0, 41.497], [42.78, 41.497], [42.78, 41.4]],
    });
    // The longest airfield zone in that mission, Mineralnye: 2.2 x 5.8 km.
    const field = zone('Some Field', {
      shape: 'quad', radiusM: 0,
      vertices: [[44.2, 43.0], [44.2, 43.0276], [44.252, 43.0276], [44.252, 43.0]],
    });
    const props = Object.fromEntries(buildZones([f, field]).features.map((x) => [x.properties!['name'], x.properties]));
    assert.deepEqual([props['F']!['kind'], props['F']!['side']], ['sector', 'none']);
    assert.deepEqual([props['Some Field']!['kind'], props['Some Field']!['side']], ['objective', 'red']);
  });

  test('the server passes them on once and keeps them, like airbases', () => {
    const w = new World();
    w.upsertZone(zone('FOB Vulture'));
    assert.equal(w.tick(1000)?.zones?.length, 1);
    w.upsertZone(zone('FOB Vulture')); // the hook's periodic repeat
    assert.equal(w.tick(2000)?.zones, undefined);
    assert.equal(w.snapshot(999_999).zones?.length, 1);
    w.clear();
    assert.equal(w.tick(3000)?.zonesCleared, true);
  });
});
