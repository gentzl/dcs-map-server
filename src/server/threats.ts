/**
 * Air defence engagement ranges.
 *
 * The values are approximations of the maximum engagement range against an
 * airborne target at medium altitude. In DCS they depend on variant,
 * altitude, aspect and game version, and are therefore deliberately kept
 * coarse: what matters for map work is the order of magnitude, not the third
 * digit. The ring says "don't fly in here", not "the danger ends exactly at
 * this meter".
 *
 * Order matters -- the first matching substring wins, so more specific
 * patterns come before more general ones.
 */

interface ThreatEntry {
  /** Substring in the DCS type name, lowercased. */
  match: string;
  /** Maximum engagement range in kilometres. */
  km: number;
  /** Short label for the ring annotation. */
  label: string;
}

const THREATS: ThreatEntry[] = [
  // Long range
  { match: 's-200', km: 130, label: 'SA-5' },
  { match: 'patriot', km: 100, label: 'PATRIOT' },
  { match: 's-300', km: 75, label: 'SA-10' },
  // Medium range
  { match: 'hawk', km: 40, label: 'HAWK' },
  { match: 's_75', km: 34, label: 'SA-2' },
  { match: 's-75', km: 34, label: 'SA-2' },
  { match: 'volhov', km: 34, label: 'SA-2' },
  { match: 'buk', km: 35, label: 'SA-11' },
  { match: 'kub', km: 25, label: 'SA-6' },
  { match: 'nasams', km: 25, label: 'NASAMS' },
  { match: 's-125', km: 18, label: 'SA-3' },
  { match: 's_125', km: 18, label: 'SA-3' },
  // Short range
  { match: 'tor ', km: 12, label: 'SA-15' },
  { match: 'sa-15', km: 12, label: 'SA-15' },
  { match: 'hq-7', km: 12, label: 'HQ-7' },
  { match: 'osa', km: 10, label: 'SA-8' },
  { match: 'roland', km: 8, label: 'ROLAND' },
  { match: 'chaparral', km: 8, label: 'CHAPARRAL' },
  { match: 'tunguska', km: 8, label: 'SA-19' },
  { match: 'rapier', km: 7, label: 'RAPIER' },
  { match: 'strela-10', km: 5, label: 'SA-13' },
  { match: 'strela', km: 4.5, label: 'SA-9' },
  { match: 'igla', km: 5, label: 'SA-18' },
  { match: 'stinger', km: 4.8, label: 'STINGER' },
  { match: 'avenger', km: 4.8, label: 'AVENGER' },
  { match: 'linebacker', km: 4.8, label: 'LINEBACKER' },
  // Gun systems
  { match: 'gepard', km: 3, label: 'GEPARD' },
  { match: 'shilka', km: 2.5, label: 'ZSU-23-4' },
  { match: 'zsu', km: 2.5, label: 'ZSU-23-4' },
  { match: 'zu-23', km: 2.5, label: 'ZU-23' },
];

/**
 * Pure radar units get no ring: they don't shoot, and a ring around every
 * element of a site would clutter the map without saying anything. Recognised
 * by the DCS name suffixes for search, fire-control and tracking radar.
 */
const RADAR_SUFFIXES = [' sr', ' tr', ' str', 'snr', 'radar', 'cp ', ' cc'];

export interface Threat {
  rangeM: number;
  label: string;
}

export function threatOf(name: string): Threat | null {
  const n = name.toLowerCase();
  if (RADAR_SUFFIXES.some((s) => n.includes(s))) return null;

  const hit = THREATS.find((t) => n.includes(t.match));
  return hit ? { rangeM: hit.km * 1000, label: hit.label } : null;
}
