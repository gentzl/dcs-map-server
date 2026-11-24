import type { Category } from '../shared/types.js';

/**
 * Maps a DCS object to a display category.
 *
 * Based on `Type.level1` from the export API, whose numbering is documented:
 *   1 Air, 2 Ground, 3 Navy, 4 Weapon, 5 Static, 6 Destroyed
 *
 * The sub-levels aren't reliably documented. Air defence is therefore
 * recognised by type name -- a heuristic, but a checkable one: the names come
 * from DCS itself and change rarely. The split is worth it because only air
 * defence gets a threat ring.
 */

/**
 * Lowercases and drops hyphens and underscores, so "T-90", the unhyphenated
 * "T90M" (seen on several modded/campaign unit sets) and "S_75M_Volhov" all
 * match the same pattern. DCS uses the two interchangeably as joiners within
 * a type name: the SA-2 launcher is "S_75M_Volhov" where the table spells it
 * "s-75", and without this it was read as an ordinary ground vehicle and
 * drew no threat ring at all.
 *
 * Spaces are kept, deliberately: several patterns end in one to anchor a
 * short word, and hasToken below works on the raw name anyway.
 */
const normalize = (name: string): string => name.toLowerCase().replace(/[-_]/g, '');

/**
 * Matches `token` as a standalone word in `name`, bounded by start/end or any
 * non-alphanumeric character (space, underscore, hyphen -- all common DCS
 * naming separators). A plain substring check on short abbreviations like
 * "str" also matched inside unrelated words such as "Stryker", wrongly
 * flagging M1126/M1128 Stryker variants as air defence.
 */
const hasToken = (name: string, token: string): boolean =>
  new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`, 'i').test(name);

/** Substrings in DCS type names that indicate air defence. */
const AA_PATTERNS = [
  // Launchers and systems
  's-300', 's-200', 's-125', 's-75', 'buk', 'kub', 'osa', 'tor ', 'tunguska',
  'strela', 'igla', 'shilka', 'zsu', 'zu-23', 'gepard', 'roland', 'rapier',
  'patriot', 'hawk', 'nasams', 'avenger', 'chaparral', 'linebacker', 'stinger',
  'hq-7', 'silkworm', 'iris', 'pantsir', 'c-ram', 'phalanx', 'radar',
];

/** Short radar-role abbreviations -- only as a standalone word, see hasToken. */
const AA_TOKENS = ['sr', 'tr', 'str', 'snr'];

const hasAaPattern = (name: string): boolean => {
  const n = normalize(name);
  return (
    AA_PATTERNS.some((p) => n.includes(normalize(p))) ||
    AA_TOKENS.some((t) => hasToken(name, t)) ||
    // NATO reporting names (SA-2, SA-11, SA-18, ...) -- checked on the
    // un-normalized name and anchored to a following digit. Stripping the
    // hyphen like the other patterns above would shrink this to a bare "sa",
    // which also matches "SAU" (a self-propelled gun, not air defence).
    /\bsa-?\d/i.test(name)
  );
};

/**
 * Main battle tanks. Name-based for the same reason as air defence: the
 * sub-levels of the DCS type aren't documented. Only tracked vehicles with a
 * main gun belong here -- the standard's tread icon is reserved for them,
 * other vehicles get an empty frame.
 */
const ARMOR_PATTERNS = [
  't-55', 't-62', 't-72', 't-80', 't-84', 't-90', 'abrams', 'm-1 ', 'm1a',
  'leopard', 'leclerc', 'challenger', 'merkava', 'ztz', 'type-59',
  'm-60', 'm60', 'chieftain', 'centurion',
];

const hasArmorPattern = (name: string): boolean => {
  const n = normalize(name);
  return ARMOR_PATTERNS.some((p) => n.includes(normalize(p)));
};

/**
 * Transport, tanker and AWACS each get their own category. Without this
 * split a C-130 showed the same letter as every fighter -- misleading
 * specifically in the air, where role and armament are otherwise barely
 * visible beyond the symbol. Reference screenshots of the game's own map
 * also show separate letters for tanker (`K`) and AWACS (`W`), apart from
 * the general transport letter (`C`).
 */
const TANKER_PATTERNS = ['kc-135', 'kc-10', 'kc135', 'kc10', 'il-78', 'tanker'];
const AWACS_PATTERNS = ['e-2', 'e-3', 'a-50', 'awacs'];
const CARGO_PATTERNS = [
  'c-130', 'c-17', 'c-5', 'an-12', 'an-26', 'an-30', 'an-72', 'il-76',
  'yak-40', 'tu-134',
];

const hasTankerPattern = (name: string): boolean => {
  const n = name.toLowerCase();
  return TANKER_PATTERNS.some((p) => n.includes(p));
};

const hasAwacsPattern = (name: string): boolean => {
  const n = name.toLowerCase();
  return AWACS_PATTERNS.some((p) => n.includes(p));
};

const hasCargoPattern = (name: string): boolean => {
  const n = name.toLowerCase();
  return CARGO_PATTERNS.some((p) => n.includes(p));
};

/** Role lookup for fixed-wing aircraft that are neither a helicopter nor a weapon. */
const classifyFixedWing = (name: string): Category => {
  if (hasTankerPattern(name)) return 'tanker';
  if (hasAwacsPattern(name)) return 'awacs';
  return hasCargoPattern(name) ? 'cargo' : 'air';
};

/**
 * Aircraft carriers and landing ships with flight operations. Under the
 * standard they're the only surface vessels to get a dedicated marking; a
 * warship carries an empty frame.
 */
const CARRIER_PATTERNS = [
  'cvn', 'cv-', 'cv_', 'stennis', 'roosevelt', 'forrestal', 'kuznetsov',
  // Alternate transliteration seen on some asset packs -- same ship, DCS
  // type name spells it differently from the class name used elsewhere.
  'kuznecow',
  'nimitz', 'vinson', 'eisenhower', 'truman', 'washington', 'lincoln',
  'tarawa', 'lha', 'lhd',
  // Wasp-class LHD carrying its own hull name rather than an LHA/LHD prefix.
  'essex',
];

/** Submarines sit in the underwater dimension and get a frame open at the top. */
const SUBMARINE_PATTERNS = ['kilo', 'varshavyanka', 'akula', 'ssk ', 'ssn ', 'submarine', 'u-boat'];

const matches = (name: string, patterns: string[]): boolean => {
  const n = name.toLowerCase();
  return patterns.some((p) => n.includes(p));
};

export interface ClassifyInput {
  name: string;
  /** Type.level1 from DCS, 0 if unknown. */
  level1?: number;
  /** Type.level2 from DCS, 0 if unknown. */
  level2?: number;
  /** Known from the protocol already: W packets are always weapons. */
  isWeapon?: boolean;
}

export function classify({ name, level1 = 0, level2 = 0, isWeapon }: ClassifyInput): Category {
  if (isWeapon) return 'weapon';

  switch (level1) {
    case 1:
      // level2 separates fixed-wing from helicopter. Its exact numbering
      // isn't documented, the name is more reliable here.
      if (/ka-|mi-|uh-|ah-|oh-|sa342|ch-|hh-|helicopter/i.test(name) || level2 === 2) return 'helo';
      return classifyFixedWing(name);
    case 2:
      if (hasAaPattern(name)) return 'sam';
      return hasArmorPattern(name) ? 'armor' : 'ground';
    case 3:
      if (matches(name, SUBMARINE_PATTERNS)) return 'submarine';
      return matches(name, CARRIER_PATTERNS) ? 'carrier' : 'naval';
    case 4:
      return 'weapon';
    case 5:
      return 'static';
    case 6:
      return 'destroyed';
    default:
      // Without a type, only the name is left. A recognisable category beats
      // a blanket 'unknown', since the symbol would otherwise say nothing.
      if (hasAaPattern(name)) return 'sam';
      if (hasArmorPattern(name)) return 'armor';
      return 'unknown';
  }
}

/** From ACMI type tags like `Ground+AntiAircraft` or `Air+FixedWing`. */
export function classifyAcmiTags(tags: string, name = ''): Category {
  const t = tags.toLowerCase();
  if (t.includes('weapon') || t.includes('missile') || t.includes('shell') || t.includes('rocket')) return 'weapon';
  if (t.includes('decoy') || t.includes('flare') || t.includes('chaff') || t.includes('shrapnel')) return 'weapon';
  if (t.includes('rotorcraft')) return 'helo';
  if (t.includes('fixedwing')) return classifyFixedWing(name);
  if (t.includes('aircraftcarrier')) return 'carrier';
  if (t.includes('submarine')) return 'submarine';
  if (t.includes('watercraft')) {
    if (matches(name, SUBMARINE_PATTERNS)) return 'submarine';
    return matches(name, CARRIER_PATTERNS) ? 'carrier' : 'naval';
  }
  if (t.includes('antiaircraft')) return 'sam';
  if (t.includes('building') || t.includes('static')) return 'static';
  if (t.includes('tank') || t.includes('armor')) return 'armor';
  if (t.includes('ground')) {
    if (hasAaPattern(name)) return 'sam';
    return hasArmorPattern(name) ? 'armor' : 'ground';
  }
  return 'unknown';
}
