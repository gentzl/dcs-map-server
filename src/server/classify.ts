import type { Category } from '../shared/types.js';

/**
 * Ordnet DCS-Objekte einer Darstellungskategorie zu.
 *
 * Grundlage ist `Type.level1` aus der Export-API, dessen Nummerierung
 * dokumentiert ist:
 *   1 Air, 2 Ground, 3 Navy, 4 Weapon, 5 Static, 6 Destroyed
 *
 * Die Unterebenen sind nicht verlässlich dokumentiert. Flugabwehr wird deshalb
 * über den Typnamen erkannt -- das ist eine Heuristik, aber eine nachprüfbare:
 * Die Namen stammen aus DCS selbst und ändern sich kaum. Die Trennung lohnt
 * sich, weil nur Flugabwehr einen Bedrohungsring bekommt.
 */

/** Teilzeichenfolgen in DCS-Typnamen, die auf Flugabwehr hindeuten. */
const AA_PATTERNS = [
  // Startgeräte und Systeme
  's-300', 's-200', 's-125', 's-75', 'buk', 'kub', 'osa', 'tor ', 'tunguska',
  'strela', 'igla', 'shilka', 'zsu', 'zu-23', 'gepard', 'roland', 'rapier',
  'patriot', 'hawk', 'nasams', 'avenger', 'chaparral', 'linebacker', 'stinger',
  'sa-', 'hq-7', 'silkworm',
  // Radargeräte: Such-, Feuerleit- und Zielfolgeradar
  ' sr', ' tr', ' str', 'snr', 'radar',
];

const hasAaPattern = (name: string): boolean => {
  const n = name.toLowerCase();
  return AA_PATTERNS.some((p) => n.includes(p));
};

/**
 * Kampfpanzer. Aus demselben Grund namensbasiert wie die Flugabwehr: Die
 * Unterebenen der DCS-Typangabe sind nicht dokumentiert. Nur Kettenfahrzeuge mit
 * Hauptwaffe gehören hierher -- das Ketten-Icon der Norm steht ihnen allein zu,
 * sonstige Fahrzeuge führen einen leeren Rahmen.
 */
const ARMOR_PATTERNS = [
  't-55', 't-62', 't-72', 't-80', 't-90', 'abrams', 'm-1 ', 'm1a',
  'leopard', 'leclerc', 'challenger', 'merkava', 'ztz', 'type 59',
  'm-60', 'm60', 'chieftain', 'centurion',
];

const hasArmorPattern = (name: string): boolean => {
  const n = name.toLowerCase();
  return ARMOR_PATTERNS.some((p) => n.includes(p));
};

/**
 * Flugzeugträger und Landungsschiffe mit Flugbetrieb. Nach der Norm bekommen
 * sie als einzige Überwasserfahrzeuge eine eigene Kennzeichnung; ein
 * Kriegsschiff führt einen leeren Rahmen.
 */
const CARRIER_PATTERNS = [
  'cvn', 'cv-', 'cv_', 'stennis', 'roosevelt', 'forrestal', 'kuznetsov',
  'nimitz', 'vinson', 'eisenhower', 'truman', 'washington', 'lincoln',
  'tarawa', 'lha', 'lhd',
];

/** U-Boote liegen in der Dimension unter Wasser und bekommen einen oben offenen Rahmen. */
const SUBMARINE_PATTERNS = ['kilo', 'varshavyanka', 'akula', 'ssk ', 'ssn ', 'submarine', 'u-boat'];

const matches = (name: string, patterns: string[]): boolean => {
  const n = name.toLowerCase();
  return patterns.some((p) => n.includes(p));
};

export interface ClassifyInput {
  name: string;
  /** Type.level1 aus DCS, 0 wenn unbekannt. */
  level1?: number;
  /** Type.level2 aus DCS, 0 wenn unbekannt. */
  level2?: number;
  /** Vorwissen aus dem Protokoll: W-Pakete sind immer Waffen. */
  isWeapon?: boolean;
}

export function classify({ name, level1 = 0, level2 = 0, isWeapon }: ClassifyInput): Category {
  if (isWeapon) return 'weapon';

  switch (level1) {
    case 1:
      // level2 trennt Flugzeug von Hubschrauber. Die genaue Nummerierung ist
      // nicht dokumentiert, der Name ist hier eindeutiger.
      return /ka-|mi-|uh-|ah-|oh-|sa342|ch-|hh-|helicopter/i.test(name) || level2 === 2
        ? 'helo'
        : 'air';
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
      // Ohne Typangabe bleibt nur der Name. Besser eine erkennbare Kategorie
      // als pauschal 'unknown', weil das Symbol sonst nichts aussagt.
      if (hasAaPattern(name)) return 'sam';
      if (hasArmorPattern(name)) return 'armor';
      return 'unknown';
  }
}

/** Aus ACMI-Typ-Tags wie `Ground+AntiAircraft` oder `Air+FixedWing`. */
export function classifyAcmiTags(tags: string, name = ''): Category {
  const t = tags.toLowerCase();
  if (t.includes('weapon') || t.includes('missile') || t.includes('shell') || t.includes('rocket')) return 'weapon';
  if (t.includes('decoy') || t.includes('flare') || t.includes('chaff') || t.includes('shrapnel')) return 'weapon';
  if (t.includes('rotorcraft')) return 'helo';
  if (t.includes('fixedwing')) return 'air';
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
