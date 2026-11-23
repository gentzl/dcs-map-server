import type { Category, Coalition, OptionsView, Ownship, Unit } from '../shared/types.js';
import { classify } from './classify.js';
import { threatOf } from './threats.js';

/**
 * Parser fuer das UDP-Format des DCS-Hooks (Typen O/A/W, zusaetzlich D).
 *
 * Schema 1 ist nicht eindeutig: Felder sind kommagetrennt, Namen werden aber
 * unmaskiert eingesetzt. Ein Gruppenname mit Komma verschiebt alle Folgefelder.
 * Deshalb wird bei abweichender Feldzahl der zusammenhaengende Zahlenblock
 * (Lat/Lon/Alt/HDG) gesucht, statt die Koordinaten still falsch zu lesen.
 */

export interface Datagram {
  optionsView?: OptionsView;
  items: Parsed[];
}

export type Parsed =
  | { kind: 'own'; own: Ownship; optionsView: OptionsView }
  | { kind: 'unit'; unit: Unit }
  | { kind: 'remove'; id: number }
  | { kind: 'close' }
  | { kind: 'error'; reason: string }
  | null;

/** Feldzahl und Index des ersten Koordinatenfeldes je Pakettyp. */
const LAYOUT = {
  O: { fields: 23, latAt: 4 },
  A: { fields: 11, latAt: 4 },
  W: { fields: 8, latAt: 3 },
} as const;

const isNum = (v: string | undefined): boolean =>
  v !== undefined && v !== '' && Number.isFinite(Number(v));

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Ergänzt den Wirkungsbereich, sofern das Objekt Flugabwehr mit bekanntem Typ
 * ist. An einer Stelle, damit Schema 1 und 3 dieselbe Zuordnung verwenden.
 */
function withThreat(name: string, category: Category) {
  if (category !== 'sam') return { category };
  const t = threatOf(name);
  return t ? { category, threatM: t.rangeM, threatLabel: t.label } : { category };
}

function coalition(v: string | undefined): Coalition {
  const n = Number(v);
  return n === 1 || n === 2 ? n : 0;
}

/**
 * Sucht den Versatz, um den sich die Felder durch Kommata in Namen verschoben
 * haben. Lat/Lon/Alt/HDG stehen immer zusammen und sind immer Zahlen; das ist
 * das einzige verlaessliche Muster im Paket.
 */
function findShift(f: string[], latAt: number, expected: number): number | null {
  const max = f.length - expected;
  if (max < 0) return null;
  for (let s = 0; s <= max; s++) {
    const block = [latAt, latAt + 1, latAt + 2, latAt + 3].every((i) => isNum(f[i + s]));
    if (block && isNum(f[f.length - 1])) return s;
  }
  return null;
}

export function parsePacket(raw: string): Parsed {
  const line = raw.trim();
  if (line === '') return null;
  if (line === 'close_socket') return { kind: 'close' };

  const f = line.split(',');
  const type = f[0];

  if (type === 'D') {
    return isNum(f[1]) ? { kind: 'remove', id: num(f[1]) } : { kind: 'error', reason: 'D ohne ID' };
  }

  if (type !== 'O' && type !== 'A' && type !== 'W') {
    return { kind: 'error', reason: `unbekannter Typ "${type}"` };
  }

  const layout = LAYOUT[type];
  const shift = findShift(f, layout.latAt, layout.fields);
  if (shift === null) {
    return { kind: 'error', reason: `${type}: ${f.length} Felder, erwartet ${layout.fields}` };
  }

  // Namensfelder absorbieren den Versatz. Wo genau das Komma stand, laesst sich
  // nicht rekonstruieren -- der Name wird deshalb zusammenhaengend uebernommen.
  const g = (i: number) => f[i + shift];
  const name = f.slice(2, 3 + shift).join(',');

  if (type === 'W') {
    return {
      kind: 'unit',
      unit: {
        id: num(f[1]),
        kind: 'weapon',
        name,
        lat: num(g(3)),
        lon: num(g(4)),
        alt: num(g(5)),
        hdg: num(g(6)),
        coalition: coalition(g(7)),
        category: 'weapon',
      },
    };
  }

  if (type === 'A') {
    return {
      kind: 'unit',
      unit: {
        id: num(f[1]),
        kind: 'unit',
        name,
        lat: num(g(4)),
        lon: num(g(5)),
        alt: num(g(6)),
        hdg: num(g(7)),
        unitName: g(8),
        groupName: g(9),
        coalition: coalition(g(10)),
        // Schema 1 überträgt nur level2, nicht level1 -- die Einordnung stützt
        // sich hier überwiegend auf den Namen.
        ...withThreat(name, classify({ name, level2: num(g(3)) })),
      },
    };
  }

  return {
    kind: 'own',
    optionsView: (g(18) ?? 'optview_all') as OptionsView,
    own: {
      id: num(f[1]),
      kind: 'unit',
      name,
      lat: num(g(4)),
      lon: num(g(5)),
      alt: num(g(6)),
      hdg: num(g(7)),
      unitName: g(8),
      groupName: g(9),
      coalition: coalition(g(10)),
      category: 'air',
      wind: { x: num(g(11)), y: num(g(12)), z: num(g(13)) },
      chaff: num(g(14)),
      flare: num(g(15)),
      modelTime: num(g(16)),
      tas: num(g(17)),
      ralt: num(g(19)),
      wow: (num(g(20)) as 0 | 1 | 2),
      accelY: num(g(21)),
      aoa: num(g(22)),
    },
  };
}

// --- Schema 3 ----------------------------------------------------------------
//
// Tabgetrennt, mehrere Datensaetze je Datagramm, Kopfzeile mit Schemaversion.
// Tabs und Zeilenumbrueche entfernt bereits der Hook, Kommata duerfen bleiben --
// damit entfaellt die Mehrdeutigkeit, die Schema 1 anhaftet.
//
// Gegenueber Schema 2 tragen A-Zeilen zusaetzlich Type.level1 und level2, ohne
// die sich Flugabwehr nicht von sonstigen Bodenzielen trennen laesst.

const V3_LAYOUT = { O: 20, A: 12, W: 8, D: 2 } as const;

function parseV3Line(line: string, modelTime: number, view: OptionsView): Parsed {
  const f = line.split('\t');
  const type = f[0];
  if (type !== 'O' && type !== 'A' && type !== 'W' && type !== 'D') {
    return { kind: 'error', reason: `v3: unbekannter Typ "${type}"` };
  }
  if (f.length !== V3_LAYOUT[type]) {
    return { kind: 'error', reason: `v3 ${type}: ${f.length} Felder, erwartet ${V3_LAYOUT[type]}` };
  }

  if (type === 'D') return { kind: 'remove', id: num(f[1]) };

  const base = {
    id: num(f[1]),
    name: f[2] ?? '',
    lat: num(f[3]),
    lon: num(f[4]),
    alt: num(f[5]),
    hdg: num(f[6]),
  };

  if (type === 'W') {
    return {
      kind: 'unit',
      unit: { ...base, kind: 'weapon', coalition: coalition(f[7]), category: 'weapon' },
    };
  }

  if (type === 'A') {
    return {
      kind: 'unit',
      unit: {
        ...base,
        kind: 'unit',
        unitName: f[7],
        groupName: f[8],
        coalition: coalition(f[9]),
        ...withThreat(base.name, classify({ name: base.name, level1: num(f[10]), level2: num(f[11]) })),
      },
    };
  }

  return {
    kind: 'own',
    optionsView: view,
    own: {
      ...base,
      kind: 'unit',
      unitName: f[7],
      groupName: f[8],
      coalition: coalition(f[9]),
      category: 'air',
      tas: num(f[10]),
      ralt: num(f[11]),
      wow: num(f[12]) as 0 | 1 | 2,
      aoa: num(f[13]),
      accelY: num(f[14]),
      chaff: num(f[15]),
      flare: num(f[16]),
      wind: { x: num(f[17]), y: num(f[18]), z: num(f[19]) },
      modelTime,
    },
  };
}

/**
 * Zerlegt ein Datagramm. Schema 2 wird an der Kopfzeile erkannt, alles andere
 * als Schema 1 gelesen, das kommagetrennte Format ohne Kopfzeile.
 */
export function parseDatagram(raw: string): Datagram {
  const text = raw.trim();
  if (text === 'close_socket') return { items: [{ kind: 'close' }] };

  const lines = text.split('\n');
  const head = lines[0]?.split('\t');

  if (head?.[0] === 'MM') {
    const schema = Number(head[1]);
    if (schema !== 3) {
      return { items: [{ kind: 'error', reason: `nicht unterstuetztes Schema ${head[1]}` }] };
    }
    const modelTime = Number(head[2]) || 0;
    const view = (head[3] || 'optview_all') as OptionsView;
    return {
      optionsView: view,
      items: lines.slice(1).filter(Boolean).map((l) => parseV3Line(l, modelTime, view)),
    };
  }

  return { items: lines.filter(Boolean).map(parsePacket) };
}
