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
  { match: 'iris', km: 40, label: 'IRIS-T' },
  { match: 's_75', km: 34, label: 'SA-2' },
  { match: 's-75', km: 34, label: 'SA-2' },
  { match: 'volhov', km: 34, label: 'SA-2' },
  { match: 'buk', km: 35, label: 'SA-11' },
  { match: 'kub', km: 25, label: 'SA-6' },
  { match: 'nasams', km: 25, label: 'NASAMS' },
  { match: 'pantsir', km: 20, label: 'SA-22' },
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
  // Land-based Phalanx. Built to shoot down rockets and mortars rather than
  // aircraft, and its 20 mm reaches barely two kilometres -- but inside that
  // it is lethal, and a ring you can only see once you are nearly on top of
  // it is still worth drawing.
  { match: 'phalanx', km: 2, label: 'C-RAM' },
  { match: 'c-ram', km: 2, label: 'C-RAM' },

  // Surface combatants with a genuine area air-defence system -- an Aegis or
  // S-300F-family radar and missile set, not just a point-defence gun. Kept
  // to hull classes this is confident about; plenty of frigates and
  // corvettes carry a shorter-range system (Shtil, Sea Sparrow, Albatros)
  // that would deserve a smaller ring, but without a verified in-game range
  // for each, a wrong number here would be worse than no ring at all. See
  // "Still open" in docs/DEVELOPERS.md.
  { match: 'ticonderog', km: 70, label: 'AEGIS' },
  { match: 'arleigh_burke', km: 70, label: 'AEGIS' },
  { match: 'arleigh burke', km: 70, label: 'AEGIS' },
  { match: 'kirov', km: 75, label: 'SA-N-6' },
  { match: 'slava', km: 75, label: 'SA-N-6' },
  { match: 'moskva', km: 75, label: 'SA-N-6' },
  // The in-game unit name is the English transliteration, not the class name.
  { match: 'moscow', km: 75, label: 'SA-N-6' },
];

/**
 * Elements of a site that do not shoot: search, tracking and fire-control
 * radars, command posts, power plants, antenna masts. Each sits within metres
 * of the launcher, so a ring apiece stacks half a dozen identical circles on
 * one site and claims a shooter where there is none.
 *
 * Matched as whole words, with space, hyphen and underscore all counting as
 * separators -- DCS spells the same role "Patriot str", "Hawk sr",
 * "p-19 s-125 sr" and "CHAP_IRISTSLM_STR" depending on the unit set. The
 * previous list compared raw substrings with a space baked in on one side,
 * so it missed every name where the role came last: "Patriot cp" drew the
 * launcher's full 100 km ring.
 */
const SUPPORT_TOKENS = [
  // Radars
  'sr', 'tr', 'str', 'snr', 'cwar', 'radar', 'ewr',
  // Command, control and support vehicles
  'cp', 'pcp', 'cc', 'command', 'post', 'amg', 'ecs', 'epp',
];

const isSupport = (name: string): boolean =>
  SUPPORT_TOKENS.some((t) => new RegExp(`(^|[^a-z0-9])${t}([^a-z0-9]|$)`, 'i').test(name));

export interface Threat {
  rangeM: number;
  label: string;
}

export function threatOf(name: string): Threat | null {
  const n = name.toLowerCase();
  if (isSupport(name)) return null;

  const hit = THREATS.find((t) => n.includes(t.match));
  return hit ? { rangeM: hit.km * 1000, label: hit.label } : null;
}
