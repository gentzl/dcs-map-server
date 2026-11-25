import type { Map as MLMap } from 'maplibre-gl';
import type { Airbase, AirfieldNav, Coalition, NavAid } from '../shared/types.js';
import { bearing3, bearingTo, distanceTo, toDeg, toMagnetic, toRad } from './geo.js';
import { DPR, SIZE, newCanvas } from './symbols/types.js';

/**
 * DCS's own airbases (LoGetWorldObjects('airdromes')), drawn the way an
 * aeronautical chart draws an aerodrome: a ring with the runway through it,
 * turned to the runway's heading.
 *
 * Coloured by what the export reports, read as: red and blue are believed,
 * neutral means "unknown". In a multiplayer mission (2026-11-25, as a blue
 * client) F10 showed every airfield blue; the export reported 13 of 21 blue
 * -- all of them right -- and the other 8 neutral, which F10 showed blue too.
 * A mission script most likely sets ownership at runtime, and the export only
 * follows part of it. So a field the export calls neutral is drawn grey, the
 * colour that claims nothing, rather than as neutral ground.
 */
const SHOW_OWNERSHIP = true;

/**
 * Grey for "owner unknown" -- dark enough to stand out on light terrain, and
 * deliberately no hue: an earlier magenta read as red, i.e. hostile.
 */
const COLOURS: Record<Coalition, { body: string; edge: string }> = {
  0: { body: '#68737e', edge: '#1c2228' },
  1: { body: '#e63946', edge: '#4a0d11' },
  2: { body: '#4895ef', edge: '#0d2a4a' },
};

/** Label colour per map mode: neutral ink, since the symbol carries the side. */
export const AIRBASE_LABEL = { chart: '#1f2a33', night: '#e6edf3' } as const;

export const airbaseImage = (coalition: Coalition): string => `airbase-${coalition}`;

/**
 * A filled disc with the runway across it, past the disc at both ends -- the
 * chart symbol for an aerodrome with a hard runway. Filled rather than a
 * ring, since a thin ring was hard to spot and harder to hit with a finger.
 * Drawn pointing north; MapLibre turns it to the runway heading.
 */
function render(coalition: Coalition): ImageData {
  const { ctx, px } = newCanvas();
  const s = SIZE;
  const { body, edge } = COLOURS[coalition];
  const cx = s * 0.5;
  const cy = s * 0.5;
  const r = s * 0.27;
  const runway = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.45);
    ctx.lineTo(cx, cy + s * 0.45);
  };

  // Dark casing under the runway ends, so they part from any terrain.
  runway();
  ctx.strokeStyle = 'rgba(10,14,18,0.85)';
  ctx.lineWidth = 6;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // The runway itself: white across the disc and beyond it.
  runway();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.stroke();

  return ctx.getImageData(0, 0, px, px);
}

export function registerAirbaseImages(map: MLMap): void {
  for (const c of [0, 1, 2] as const) {
    const id = airbaseImage(c);
    if (!map.hasImage(id)) map.addImage(id, render(c), { pixelRatio: DPR });
  }
}

/**
 * DCS's Type.level2 for helipads and FARPs without a runway. It lists them
 * among the airdromes, all named "woRunWay" -- about half the entries in
 * Caucasus -- while the same pads already arrive as ordinary static objects
 * (SINGLE_HELIPAD, FARP_SINGLE_01). Drawn as airfields they'd be a few dozen
 * runway symbols labelled "woRunWay".
 */
const NO_RUNWAY_LEVEL2 = 18;

/**
 * Features for the airbase layer. Left out: pads without a runway (above),
 * and bases whose id is also a contact -- a carrier can count as a base too,
 * and it already has its own symbol that moves with it.
 */
export function buildAirbases(
  bases: Iterable<Airbase>,
  contactIds: ReadonlySet<number>,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const b of bases) {
    if (b.level2 === NO_RUNWAY_LEVEL2 || contactIds.has(b.id)) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [b.lon, b.lat] },
      properties: { id: b.id, name: b.name, icon: airbaseImage(SHOW_OWNERSHIP ? b.coalition : 0), hdgDeg: toDeg(b.hdg) },
    });
  }
  return { type: 'FeatureCollection', features };
}

// --- Radio and navaid data ---------------------------------------------------

/** Lower case, letters and digits only: "Mineralnye Vody" matches "MineralnyeVody". */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Farther than this from an airfield, a set of beacons belongs to another one. */
const MATCH_RADIUS_M = 10_000;

/**
 * The radio/navaid entry for one of DCS's airbases: by name first (the
 * beacon files spell fields the way the export does, give or take spaces),
 * else the entry whose beacons sit nearest, if close enough.
 */
export function matchNav(base: Airbase, fields: readonly AirfieldNav[]): AirfieldNav | null {
  const n = norm(base.name);
  const byName = fields.find((f) => norm(f.name) === n || f.aliases.some((a) => norm(a) === n));
  if (byName) return byName;
  let best: AirfieldNav | null = null;
  let bestM = MATCH_RADIUS_M;
  for (const f of fields) {
    if (f.lat === undefined || f.lon === undefined) continue;
    const m = distanceTo(base.lat, base.lon, f.lat, f.lon);
    if (m < bestM) {
      best = f;
      bestM = m;
    }
  }
  return best;
}

const mhz = (v: number): string => v.toFixed(3);

/**
 * Tower frequencies, the way a chart's communication box lists them: the
 * service, then each band. Bands are named because aircraft differ in which
 * radios they carry -- the Hornet talks UHF/VHF, a Huey also low VHF.
 */
export function formatCom(com: AirfieldNav['com']): string | null {
  const parts = [
    com.vhf !== undefined ? `VHF ${mhz(com.vhf)}` : null,
    com.uhf !== undefined ? `UHF ${mhz(com.uhf)}` : null,
    com.vhfLow !== undefined ? `LO ${mhz(com.vhfLow)}` : null,
    com.hf !== undefined ? `HF ${mhz(com.hf)}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length ? `TWR ${parts.join('  ')}` : null;
}

/** "477", "300.5": whole kHz without a decimal, a half kHz with one. */
const khz = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/**
 * One navaid as a chart writes it: type, identifier, frequency or channel,
 * and for an approach aid its final approach course, magnetic.
 */
export function formatNavAid(n: NavAid, magVarDeg: number): string {
  const crs = n.courseTrue !== undefined ? ` CRS ${bearing3(toMagnetic(toRad(n.courseTrue), magVarDeg))}°M` : '';
  switch (n.kind) {
    case 'ILS':
      return `ILS ${n.ident} ${n.mhz?.toFixed(2) ?? '?'}${crs}`;
    case 'PRMG':
      return `PRMG ${n.ident}${n.channel !== undefined ? ` ch ${n.channel}` : ''}${crs}`;
    case 'TCN':
      return `TCN ${n.ident} ${n.channel ?? '?'}X`;
    case 'VOR':
      return `VOR ${n.ident} ${n.mhz?.toFixed(2) ?? '?'}`;
    case 'RSBN':
      return `RSBN ${n.ident}${n.channel !== undefined ? ` ch ${n.channel}` : ''}`;
    case 'NDB':
      return `NDB ${n.ident} ${n.khz !== undefined ? khz(n.khz) : '?'}`;
  }
}

// --- Airfield panel ------------------------------------------------------------

const NB = '\u00a0';
/** Pads with non-breaking spaces, which the readout box keeps (it collapses ordinary runs). */
const pad = (s: string, n: number): string => s + NB.repeat(Math.max(1, n - s.length));

const COALITION_NAME: Record<Coalition, string> = { 0: 'NEUTRAL', 1: 'RED', 2: 'BLUE' };

/** Which runway direction (0 or 1, see airfieldPanel) a navaid serves, or null. */
function runwayEnd(n: NavAid, base: Airbase, endsTrue: [number, number]): 0 | 1 | null {
  let course: number | undefined;
  if (n.courseTrue !== undefined) {
    course = n.courseTrue;
  } else if (n.role && n.lat !== undefined && n.lon !== undefined) {
    // An approach NDB stands before the threshold, on the side you come
    // from: seen from the field it lies opposite the approach course.
    course = (toDeg(bearingTo(base.lat, base.lon, n.lat, n.lon)) + 180) % 360;
  }
  if (course === undefined) return null;
  const off = (a: number): number => Math.abs((((course! - a) % 360) + 540) % 360 - 180);
  const [d0, d1] = [off(endsTrue[0]), off(endsTrue[1])];
  if (Math.min(d0, d1) > 60) return null;
  return d0 <= d1 ? 0 : 1;
}

const valueOf = (n: NavAid): string => {
  switch (n.kind) {
    case 'ILS':
    case 'VOR':
      return `${n.mhz?.toFixed(2) ?? '?'} (${n.ident})`;
    case 'TCN':
      return `${n.channel ?? '?'}X (${n.ident})`;
    case 'RSBN':
    case 'PRMG':
      return `ch ${n.channel ?? '?'} (${n.ident})`;
    case 'NDB':
      return `${n.khz !== undefined ? khz(n.khz) : '?'} (${n.ident})`;
  }
};

/**
 * The airfield readout, laid out like DCS's own F10 airfield window and
 * reduced to what there is data for: rows without a value are left out
 * (ICAO code, runway length and runway names aren't in any file a hook or
 * the setup can read, so those rows never appear). Approach aids are split
 * by runway direction, one column each, like F10.
 *
 * Runway directions are magnetic headings, lower first -- F10's runway
 * names don't follow from the heading reliably (see runwayHeadings).
 */
export function airfieldPanel(
  base: Airbase,
  nav: AirfieldNav | null,
  opts: { magVarDeg: number; braa: string; elevFt: number; coords: string },
): string[] {
  const lines: string[] = [base.name.toUpperCase(), opts.braa];
  const L = 13; // label column
  const row = (label: string, value: string): void => { lines.push(pad(label, L) + value); };

  row('COALITION', COALITION_NAME[base.coalition]);
  row('ELEVATION', `${opts.elevFt} ft`);
  row('COORDINATES', opts.coords);

  const aids = nav?.nav ?? [];
  const single = (kind: NavAid['kind']): void => {
    const v = aids.filter((n) => n.kind === kind).map(valueOf);
    if (v.length) row(kind === 'TCN' ? 'TACAN' : kind, v.join(', '));
  };
  single('TCN');
  single('VOR');
  single('RSBN');

  const com = nav?.com;
  if (com) {
    const f = [com.hf, com.vhfLow, com.vhf, com.uhf].filter((x): x is number => x !== undefined).sort((a, b) => a - b);
    if (f.length) row('ATC (MHz AM)', f.map((x) => x.toFixed(3)).join(', '));
  }

  // Runway directions, true, as DCS reports the base; shown magnetic.
  const h = ((toDeg(base.hdg) % 360) + 360) % 360;
  const endsTrue: [number, number] = [h, (h + 180) % 360];
  const mag = (t: number): number => Math.round(((t - opts.magVarDeg) % 360 + 360) % 360) % 360;
  // Lower magnetic heading first, the way runway pairs are written.
  if (mag(endsTrue[0]) > mag(endsTrue[1])) endsTrue.reverse();
  const C = 16; // first runway column
  const cols = (label: string, a: string, b: string): void => { lines.push(pad(label, L) + pad(a, C) + b); };
  cols('RUNWAYS', `${String(mag(endsTrue[0])).padStart(3, '0')}°M`, `${String(mag(endsTrue[1])).padStart(3, '0')}°M`);

  const perEnd = (label: string, pick: (n: NavAid) => boolean): void => {
    const ends: [string[], string[]] = [[], []];
    for (const n of aids.filter(pick)) {
      const e = runwayEnd(n, base, endsTrue);
      if (e !== null) ends[e].push(valueOf(n));
    }
    if (ends[0].length || ends[1].length) cols(label, ends[0].join(', ') || '--', ends[1].join(', ') || '--');
  };
  perEnd('ILS', (n) => n.kind === 'ILS');
  perEnd('PRMG', (n) => n.kind === 'PRMG');
  perEnd('OUTER NDB', (n) => n.kind === 'NDB' && n.role === 'outer');
  perEnd('INNER NDB', (n) => n.kind === 'NDB' && n.role === 'inner');

  // An NDB that serves no particular approach (the airfield's own homer).
  const homers = aids.filter((n) => n.kind === 'NDB' && !n.role).map(valueOf);
  if (homers.length) row('NDB', homers.join(', '));
  return lines;
}
