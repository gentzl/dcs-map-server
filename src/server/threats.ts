/**
 * Wirkungsbereiche von Flugabwehrsystemen.
 *
 * Die Werte sind Näherungen der maximalen Bekämpfungsentfernung gegen ein
 * Luftziel in mittlerer Höhe. Sie hängen in DCS von Variante, Höhe, Aspekt und
 * Spielversion ab und sind deshalb bewusst grob gehalten: Für die Kartenarbeit
 * zählt die Größenordnung, nicht die dritte Stelle. Der Ring sagt „hier nicht
 * hineinfliegen", nicht „hier endet die Gefahr auf den Meter".
 *
 * Reihenfolge ist bedeutsam -- die erste passende Teilzeichenfolge gewinnt,
 * deshalb stehen spezifischere Muster vor allgemeineren.
 */

interface ThreatEntry {
  /** Teilzeichenfolge im DCS-Typnamen, kleingeschrieben. */
  match: string;
  /** Maximale Bekämpfungsentfernung in Kilometern. */
  km: number;
  /** Kurzbezeichnung für die Beschriftung. */
  label: string;
}

const THREATS: ThreatEntry[] = [
  // Langstrecke
  { match: 's-200', km: 130, label: 'SA-5' },
  { match: 'patriot', km: 100, label: 'PATRIOT' },
  { match: 's-300', km: 75, label: 'SA-10' },
  // Mittelstrecke
  { match: 'hawk', km: 40, label: 'HAWK' },
  { match: 's_75', km: 34, label: 'SA-2' },
  { match: 's-75', km: 34, label: 'SA-2' },
  { match: 'volhov', km: 34, label: 'SA-2' },
  { match: 'buk', km: 35, label: 'SA-11' },
  { match: 'kub', km: 25, label: 'SA-6' },
  { match: 'nasams', km: 25, label: 'NASAMS' },
  { match: 's-125', km: 18, label: 'SA-3' },
  { match: 's_125', km: 18, label: 'SA-3' },
  // Kurzstrecke
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
  // Rohrwaffen
  { match: 'gepard', km: 3, label: 'GEPARD' },
  { match: 'shilka', km: 2.5, label: 'ZSU-23-4' },
  { match: 'zsu', km: 2.5, label: 'ZSU-23-4' },
  { match: 'zu-23', km: 2.5, label: 'ZU-23' },
];

/**
 * Reine Radargeräte bekommen keinen Ring: Sie schießen nicht, und ein Ring um
 * jedes Element einer Stellung würde die Karte zustellen, ohne etwas zu sagen.
 * Erkennbar an den DCS-Namenszusätzen für Such-, Feuerleit- und Zielfolgeradar.
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
