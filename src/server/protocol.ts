import type { Category, Coalition, OptionsView, Ownship, Unit } from '../shared/types.js';
import { classify } from './classify.js';
import { threatOf } from './threats.js';

/**
 * Parser for the DCS hook's UDP format (types O/A/W, plus D).
 *
 * Schema 1 is ambiguous: fields are comma-separated, but names are inserted
 * unescaped. A group name containing a comma shifts every following field.
 * So on a mismatched field count, the contiguous number block (lat/lon/
 * alt/hdg) is searched for, instead of silently misreading the coordinates.
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

/** Field count and index of the first coordinate field, per packet type. */
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
 * Adds the engagement range, if the object is air defence of a known type.
 * In one place, so schema 1 and 3 use the same lookup.
 */
function withThreat(name: string, category: Category) {
  if (category !== 'sam' && category !== 'naval') return { category };
  const t = threatOf(name);
  return t ? { category, threatM: t.rangeM, threatLabel: t.label } : { category };
}

function coalition(v: string | undefined): Coalition {
  const n = Number(v);
  return n === 1 || n === 2 ? n : 0;
}

/**
 * Looks for the offset by which the fields have shifted due to commas in
 * names. Lat/lon/alt/hdg always sit together and are always numbers; that's
 * the only reliable pattern in the packet.
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
    return isNum(f[1]) ? { kind: 'remove', id: num(f[1]) } : { kind: 'error', reason: 'D without ID' };
  }

  if (type !== 'O' && type !== 'A' && type !== 'W') {
    return { kind: 'error', reason: `unknown type "${type}"` };
  }

  const layout = LAYOUT[type];
  const shift = findShift(f, layout.latAt, layout.fields);
  if (shift === null) {
    return { kind: 'error', reason: `${type}: ${f.length} fields, expected ${layout.fields}` };
  }

  // Name fields absorb the shift. Exactly where the comma was can't be
  // reconstructed -- so the name is taken as one contiguous block.
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
        // Schema 1 only carries level2, not level1 -- classification here
        // relies mostly on the name.
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
// Tab-separated, multiple records per datagram, header line with the schema
// version. The hook already strips tabs and line breaks, commas may stay --
// which removes the ambiguity schema 1 is stuck with.
//
// Compared to schema 2, A lines additionally carry Type.level1 and level2,
// without which air defence can't be separated from other ground targets.

const V3_LAYOUT = { O: 20, A: 12, W: 8, D: 2 } as const;

function parseV3Line(line: string, modelTime: number, view: OptionsView): Parsed {
  const f = line.split('\t');
  const type = f[0];
  if (type !== 'O' && type !== 'A' && type !== 'W' && type !== 'D') {
    return { kind: 'error', reason: `v3: unknown type "${type}"` };
  }
  if (f.length !== V3_LAYOUT[type]) {
    return { kind: 'error', reason: `v3 ${type}: ${f.length} fields, expected ${V3_LAYOUT[type]}` };
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
 * Splits apart a datagram. Schema 2 is recognised by its header line,
 * everything else is read as schema 1, the comma-separated format with no header.
 */
export function parseDatagram(raw: string): Datagram {
  const text = raw.trim();
  if (text === 'close_socket') return { items: [{ kind: 'close' }] };

  const lines = text.split('\n');
  const head = lines[0]?.split('\t');

  if (head?.[0] === 'MM') {
    const schema = Number(head[1]);
    if (schema !== 3) {
      return { items: [{ kind: 'error', reason: `unsupported schema ${head[1]}` }] };
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
