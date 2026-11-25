import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { buildAirfields, parseBeacons, parseRadio } from '../tools/navdata.js';
import { airfieldPanel, formatCom, formatNavAid, matchNav } from '../src/client/airbases.js';
import type { Airbase } from '../src/shared/types.js';

// Hand-written in the layout of a DCS Radio.lua / Beacons.lua -- not copied
// from the game's files, which stay on the player's machine.
const RADIO = `
radio = {
	{
		-- KUTAISI
		radioId = 'airfield25_0';
		role = {"ground", "tower", "approach"};
		callsign = {{["common"] = {_("Kutaisi"), "Kutaisi"}}};
		frequency = {[HF] = {MODULATIONTYPE_AM, 4400000.000000}, [UHF] = {MODULATIONTYPE_AM, 263000000.000000}, [VHF_HI] = {MODULATIONTYPE_AM, 134000000.000000}, [VHF_LOW] = {MODULATIONTYPE_AM, 41000000.000000}};
	};
	{
		-- a radio that isn't an airfield's
		radioId = 'beacon_x';
		frequency = {[UHF] = {MODULATIONTYPE_AM, 300000000.000000}};
	};
};`;

const BEACONS = `
beacons = {
	{
		display_name = _('Kutaisi');
		beaconId = 'airfield25_0';
		type = BEACON_TYPE_ILS_LOCALIZER;
		callsign = 'IKS';
		frequency = 109750000.000000;
		direction = -105.999085;
		positionGeo = { latitude = 42.18, longitude = 42.46 };
	};
	{
		display_name = _('Kutaisi');
		beaconId = 'airfield25_1';
		type = BEACON_TYPE_ILS_GLIDESLOPE;
		callsign = 'IKS';
		frequency = 109750000.000000;
		positionGeo = { latitude = 42.17, longitude = 42.48 };
	};
	{
		display_name = _('Kutaisi');
		beaconId = 'airfield25_2';
		type = BEACON_TYPE_TACAN;
		callsign = 'KTS';
		frequency = 1005000000.000000;
		channel = 44;
	};
	{
		display_name = _('Kutaisi');
		beaconId = 'airfield25_3';
		type = BEACON_TYPE_AIRPORT_HOMER_WITH_MARKER;
		callsign = 'TI';
		frequency = 477000.000000;
	};
	{
		display_name = _('Kutaisi');
		beaconId = 'airfield25_4';
		type = BEACON_TYPE_RSBN;
		callsign = 'KS';
		channel = 40;
	};
	{
		display_name = _('Some NDB');
		beaconId = 'world_ndb_1';
		type = BEACON_TYPE_HOMER;
		callsign = 'XX';
		frequency = 300500.000000;
	};
};`;

describe('airfield radio and navaid data', () => {
  const fields = buildAirfields(parseRadio(RADIO), parseBeacons(BEACONS));
  const kutaisi = fields[0]!;

  test('only airfield entries, keyed and named the way DCS does', () => {
    assert.equal(fields.length, 1);
    assert.equal(kutaisi.key, 'airfield25');
    assert.equal(kutaisi.name, 'Kutaisi');
  });

  test('tower frequencies per band, in MHz', () => {
    assert.deepEqual(kutaisi.com, { hf: 4.4, uhf: 263, vhf: 134, vhfLow: 41 });
  });

  test('ILS course is the localizer direction turned round: -106 deg -> 074 deg true', () => {
    const ils = kutaisi.nav.find((n) => n.kind === 'ILS');
    assert.ok(ils?.courseTrue !== undefined);
    assert.ok(Math.abs(ils.courseTrue - 74) < 0.01, String(ils.courseTrue));
  });

  test('glideslope dropped, ILS first, then TACAN, RSBN, NDB', () => {
    assert.deepEqual(kutaisi.nav.map((n) => n.kind), ['ILS', 'TCN', 'RSBN', 'NDB']);
  });

  test('an RSBN is read by its channel, though it has no frequency line', () => {
    const rsbn = kutaisi.nav.find((n) => n.kind === 'RSBN');
    assert.equal(rsbn?.channel, 40);
  });

  test('reads as a chart writes it, course magnetic', () => {
    // Caucasus magnetic variation about +6.5 deg: 074 true is 067/068 magnetic.
    const [ils, tcn, , ndb] = kutaisi.nav.map((n) => formatNavAid(n, 6.5));
    assert.match(ils!, /^ILS IKS 109\.75 CRS 06[78]°M$/);
    assert.equal(tcn, 'TCN KTS 44X');
    assert.equal(ndb, 'NDB TI 477');
    assert.equal(formatCom(kutaisi.com), 'TWR VHF 134.000  UHF 263.000  LO 41.000  HF 4.400');
  });

  test('matched to an airbase by name, ignoring spaces and case', () => {
    const base = (name: string, lat = 0, lon = 0): Airbase =>
      ({ id: 1, name, lat, lon, alt: 0, hdg: 0, coalition: 0, level2: 13 });
    assert.equal(matchNav(base('KUTAISI'), fields)?.key, 'airfield25');
    // Different spelling, but the beacons sit right there.
    assert.equal(matchNav(base('Kopitnari', 42.176, 42.47), fields)?.key, 'airfield25');
    assert.equal(matchNav(base('Elsewhere', 40, 40), fields), null);
  });
});

describe('airfield panel', () => {
  // Krasnodar-Center as DCS has it: runway along ~088 deg true, outer and
  // inner NDBs before each threshold. F10 shows OUTER 625 (MB) | 625 (OC),
  // INNER 303 (M) | 303 (O) under runways 9 | 27.
  const base: Airbase = { id: 1, name: 'Krasnodar-Center', lat: 45.0875, lon: 38.925, alt: 30, hdg: (88 * Math.PI) / 180, coalition: 0, level2: 13 };
  // A point a few km along a bearing from the field.
  const at = (brgDeg: number, km: number) => ({
    lat: base.lat + (km / 111) * Math.cos((brgDeg * Math.PI) / 180),
    lon: base.lon + (km / (111 * Math.cos((base.lat * Math.PI) / 180))) * Math.sin((brgDeg * Math.PI) / 180),
  });
  const nav = {
    key: 'airfield13', name: 'Krasnodar-Center', aliases: [],
    com: { hf: 3.8, vhfLow: 38.6, vhf: 122, uhf: 251 },
    nav: [
      { kind: 'PRMG' as const, ident: 'MB', channel: 38, courseTrue: 88 },
      { kind: 'RSBN' as const, ident: 'MB', channel: 40 },
      // Approaching on 088 you come from the west: those homers lie west.
      { kind: 'NDB' as const, ident: 'MB', khz: 625, role: 'outer' as const, ...at(268, 7) },
      { kind: 'NDB' as const, ident: 'M', khz: 303, role: 'inner' as const, ...at(268, 2) },
      { kind: 'NDB' as const, ident: 'OC', khz: 625, role: 'outer' as const, ...at(88, 7) },
      { kind: 'NDB' as const, ident: 'O', khz: 303, role: 'inner' as const, ...at(88, 2) },
    ],
  };
  const lines = airfieldPanel(base, nav, { magVarDeg: 6.5, braa: 'BRAA', elevFt: 98, coords: 'N45 E038' })
    .map((l) => l.replace(/\u00a0+/g, ' '));

  test('rows like the F10 window, empty ones left out', () => {
    assert.deepEqual(lines.map((l) => l.split(' ')[0]), [
      'KRASNODAR-CENTER', 'BRAA', 'COALITION', 'ELEVATION', 'COORDINATES',
      'RSBN', 'ATC', 'RUNWAYS', 'PRMG', 'OUTER', 'INNER',
    ]);
  });

  test('approach aids land under the runway direction they serve', () => {
    assert.ok(lines.includes('RUNWAYS 082°M 262°M'), lines.join('\n'));
    assert.ok(lines.includes('OUTER NDB 625 (MB) 625 (OC)'), lines.join('\n'));
    assert.ok(lines.includes('INNER NDB 303 (M) 303 (O)'), lines.join('\n'));
    assert.ok(lines.includes('PRMG ch 38 (MB) --'), lines.join('\n'));
  });

  test('ATC frequencies ascending, as F10 lists them', () => {
    assert.ok(lines.includes('ATC (MHz AM) 3.800, 38.600, 122.000, 251.000'), lines.join('\n'));
  });
});
