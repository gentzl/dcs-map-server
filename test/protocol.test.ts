import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { parseDatagram, parsePacket } from '../src/server/protocol.js';
import type { Parsed } from '../src/server/protocol.js';
import type { OptionsView } from '../src/shared/types.js';
import {
  airbaseLine,
  ownshipLine,
  removeLine,
  toDatagrams,
  unitLine,
  weaponLine,
  type OwnshipFields,
  type Schema,
  type UnitFields,
  type WeaponFields,
} from '../tools/wire.js';

// Schema 1 writes most fields with 6 decimals, schema 3 with 2 -- so two
// decimal places is the coarsest rounding any field goes through.
const near = (actual: number, expected: number, eps = 0.01): void =>
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${actual} to be within ${eps} of ${expected}`,
  );

const OWN: OwnshipFields = {
  id: 16777733,
  name: 'A-10A',
  lat: 45.005035,
  lon: 37.3657929,
  alt: 1234.5,
  hdg: 1.40432,
  unitName: 'Itstata',
  groupName: 'Anapa-Vityazevo_A-10A_143',
  coalition: 2,
  tas: 123.45,
  ralt: 456.78,
  wow: 1,
  aoa: -0.3,
  accelY: 1.02,
  chaff: 240,
  flare: 120,
  wind: { x: 0.02, y: -0.05, z: -0.04 },
  modelTime: 18191.74,
};

const UNIT: UnitFields = {
  id: 16835329,
  name: 'SA-11 Buk LN 9A310M1',
  lat: 42.726059,
  lon: 41.468198,
  alt: 10.1,
  hdg: 2.54817,
  unitName: 'SAM Buk 1-1',
  groupName: 'SAM Buk Zugdidi',
  coalition: 1,
  level1: 2,
  level2: 0,
};

const WEAPON: WeaponFields = {
  id: 99001,
  name: 'AIM_120',
  lat: 43.1,
  lon: 40.2,
  alt: 9000.5,
  hdg: 3.14,
  coalition: 2,
};

/** Wraps lines into datagrams the way the live tools do, then parses them back. */
function roundtrip(lines: string[], schema: Schema, view: OptionsView = 'optview_all'): Parsed[] {
  const grams = toDatagrams(lines, OWN.modelTime, view, schema);
  return grams.flatMap((g) => parseDatagram(g).items);
}

for (const schema of [1, 3] as const) {
  describe(`schema ${schema}`, () => {
    test('ownship survives a write/parse roundtrip', () => {
      const [item] = roundtrip([ownshipLine(OWN, 'optview_allies', schema)], schema, 'optview_allies');
      assert.equal(item?.kind, 'own');
      if (item?.kind !== 'own') return;

      const { own } = item;
      assert.equal(item.optionsView, 'optview_allies');
      assert.equal(own.id, OWN.id);
      assert.equal(own.name, OWN.name);
      assert.equal(own.unitName, OWN.unitName);
      assert.equal(own.groupName, OWN.groupName);
      assert.equal(own.coalition, 2);
      assert.equal(own.category, 'air');
      assert.equal(own.kind, 'unit');
      assert.equal(own.wow, 1);
      assert.equal(own.chaff, 240);
      assert.equal(own.flare, 120);
      near(own.lat, OWN.lat, 1e-6);
      near(own.lon, OWN.lon, 1e-6);
      near(own.alt, OWN.alt);
      near(own.hdg, OWN.hdg, 1e-4);
      near(own.tas, OWN.tas);
      near(own.ralt, OWN.ralt);
      near(own.aoa, OWN.aoa);
      near(own.accelY, OWN.accelY);
      near(own.modelTime, OWN.modelTime);
      near(own.wind.x, OWN.wind.x);
      near(own.wind.y, OWN.wind.y);
      near(own.wind.z, OWN.wind.z);
    });

    test('unit survives a write/parse roundtrip, and keeps its threat ring', () => {
      const [item] = roundtrip([unitLine(UNIT, schema)], schema);
      assert.equal(item?.kind, 'unit');
      if (item?.kind !== 'unit') return;

      const { unit } = item;
      assert.equal(unit.id, UNIT.id);
      assert.equal(unit.name, UNIT.name);
      assert.equal(unit.unitName, UNIT.unitName);
      assert.equal(unit.groupName, UNIT.groupName);
      assert.equal(unit.coalition, 1);
      assert.equal(unit.kind, 'unit');
      assert.equal(unit.category, 'sam');
      assert.equal(unit.threatM, 35_000);
      assert.equal(unit.threatLabel, 'SA-11');
      near(unit.lat, UNIT.lat, 1e-6);
      near(unit.lon, UNIT.lon, 1e-6);
      near(unit.alt, UNIT.alt);
      near(unit.hdg, UNIT.hdg, 1e-4);
    });

    test('weapon survives a write/parse roundtrip', () => {
      const [item] = roundtrip([weaponLine(WEAPON, schema)], schema);
      assert.equal(item?.kind, 'unit');
      if (item?.kind !== 'unit') return;

      const { unit } = item;
      assert.equal(unit.id, WEAPON.id);
      assert.equal(unit.name, WEAPON.name);
      assert.equal(unit.kind, 'weapon');
      assert.equal(unit.category, 'weapon');
      assert.equal(unit.coalition, 2);
      near(unit.lat, WEAPON.lat, 1e-6);
      near(unit.lon, WEAPON.lon, 1e-6);
      near(unit.alt, WEAPON.alt);
    });

    test('a non-air-defence ground unit gets no threat ring', () => {
      const [item] = roundtrip([unitLine({ ...UNIT, name: 'BMP-1' }, schema)], schema);
      assert.equal(item?.kind, 'unit');
      if (item?.kind !== 'unit') return;
      assert.equal(item.unit.threatM, undefined);
      assert.equal(item.unit.threatLabel, undefined);
    });
  });
}

describe('schema 1 ambiguity', () => {
  // Fields are comma-separated with names inserted unescaped, so a comma in a
  // name shifts every following field. The writer's defence is to strip commas
  // before they ever reach the wire; this checks that defence, not the
  // parser's after-the-fact recovery.
  test('the writer strips commas out of names', () => {
    const dirty = { ...UNIT, name: 'BMP-1, modded', unitName: 'A,B', groupName: 'C,D' };
    const line = unitLine(dirty, 1);
    assert.equal(line.split(',').length, 11, `field count shifted: ${line}`);

    const [item] = roundtrip([line], 1);
    assert.equal(item?.kind, 'unit');
    if (item?.kind !== 'unit') return;
    assert.equal(item.unit.name, 'BMP-1  modded');
    assert.equal(item.unit.unitName, 'A B');
    assert.equal(item.unit.groupName, 'C D');
    near(item.unit.lat, UNIT.lat, 1e-6);
    near(item.unit.lon, UNIT.lon, 1e-6);
  });

  // Covers lines from a foreign Export.lua, which this writer cannot
  // sanitise. Recovery hinges on the shifted field being non-numeric: the
  // parser locates the coordinate block by looking for four numbers in a row,
  // so a name whose tail reads as a number stays ambiguous.
  test('a weapon line from a foreign source keeps its coordinates despite a comma', () => {
    const item = parsePacket('W,99001,AIM-120, export,43.100000,40.200000,9000.500000,3.140000,2');
    assert.equal(item?.kind, 'unit');
    if (item?.kind !== 'unit') return;
    assert.equal(item.unit.name, 'AIM-120, export');
    near(item.unit.lat, 43.1, 1e-6);
    near(item.unit.lon, 40.2, 1e-6);
    near(item.unit.alt, 9000.5);
  });
});

describe('framing and errors', () => {
  test('schema 3 bundles a tick behind one header, schema 1 sends a line each', () => {
    const lines = [unitLine(UNIT, 3), weaponLine(WEAPON, 3)];
    assert.equal(toDatagrams(lines, 0, 'optview_all', 3).length, 1);
    assert.equal(toDatagrams([unitLine(UNIT, 1), weaponLine(WEAPON, 1)], 0, 'optview_all', 1).length, 2);
  });

  test('schema 3 carries optionsView and modelTime on the header', () => {
    const gram = toDatagrams([ownshipLine(OWN, 'optview_extended', 3)], 4242.5, 'optview_extended', 3)[0];
    assert.ok(gram);
    const { optionsView, items } = parseDatagram(gram);
    assert.equal(optionsView, 'optview_extended');
    assert.equal(items[0]?.kind, 'own');
    if (items[0]?.kind !== 'own') return;
    near(items[0].own.modelTime, 4242.5);
    // The older four-field header carries no start time.
    assert.equal(items[0].own.missionStart, undefined);
  });

  test('the mission start time rides along as an optional fifth header field', () => {
    const gram = toDatagrams([ownshipLine(OWN, 'optview_all', 3)], 100, 'optview_all', 3, 22_800)[0];
    assert.ok(gram);
    const { items } = parseDatagram(gram);
    assert.equal(items[0]?.kind, 'own');
    if (items[0]?.kind !== 'own') return;
    assert.equal(items[0].own.missionStart, 22_800);
  });

  test('an empty start-time field means unknown, not midnight', () => {
    const { items } = parseDatagram(`MM\t3\t1.000\toptview_all\t\n${ownshipLine(OWN, 'optview_all', 3)}`);
    assert.equal(items[0]?.kind, 'own');
    if (items[0]?.kind !== 'own') return;
    assert.equal(items[0].own.missionStart, undefined);
  });

  test('a sixth header field says the server blocks object export', () => {
    const own = ownshipLine(OWN, 'optview_all', 3);
    const parse = (blocked?: boolean) =>
      parseDatagram(toDatagrams([own], 100, 'optview_all', 3, 22_800, blocked)[0]!);
    assert.equal(parse(true).objectsBlocked, true);
    assert.equal(parse(false).objectsBlocked, false);
    // An older hook sends no sixth field: unknown, which must not read as "blocked".
    assert.equal(parse().objectsBlocked, undefined);
    // The flag survives a missing start time too.
    const noStart = parseDatagram(`MM\t3\t1.000\toptview_all\t\t1\n${own}`);
    assert.equal(noStart.objectsBlocked, true);
    assert.equal(noStart.items[0]?.kind, 'own');
  });

  test('an airbase survives a write/parse roundtrip, comma in the name included', () => {
    const base = { id: 5001, name: 'Kutaisi, Kopitnari', lat: 42.17915, lon: 42.495684, alt: 45, hdg: 4.43312, coalition: 2, level2: 13 };
    const [item] = roundtrip([airbaseLine(base)], 3);
    assert.equal(item?.kind, 'airbase');
    if (item?.kind !== 'airbase') return;
    assert.equal(item.airbase.name, 'Kutaisi, Kopitnari');
    near(item.airbase.lat, base.lat, 1e-6);
    near(item.airbase.lon, base.lon, 1e-6);
    near(item.airbase.hdg, base.hdg, 1e-5);
    assert.equal(item.airbase.coalition, 2);
    assert.equal(item.airbase.level2, 13);
  });

  test('a removal is parsed back as a removal', () => {
    const [item] = roundtrip([removeLine(4711)], 3);
    assert.deepEqual(item, { kind: 'remove', id: 4711 });
  });

  test('close_socket ends the session', () => {
    assert.deepEqual(parseDatagram('close_socket').items, [{ kind: 'close' }]);
  });

  test('an unsupported schema version is reported, not guessed at', () => {
    const { items } = parseDatagram('MM\t9\t0.000\toptview_all\nA\t1\tBMP-1\t0\t0\t0\t0');
    assert.equal(items[0]?.kind, 'error');
  });

  test('a malformed line is reported without taking the rest of the datagram down', () => {
    const { items } = parseDatagram(`MM\t3\t0.000\toptview_all\nA\tnope\n${weaponLine(WEAPON, 3)}`);
    assert.equal(items[0]?.kind, 'error');
    assert.equal(items[1]?.kind, 'unit');
  });

  test('an unknown packet type is reported', () => {
    assert.equal(parsePacket('X,1,2,3')?.kind, 'error');
  });

  test('a blank line is ignored', () => {
    assert.equal(parsePacket('   '), null);
  });
});
