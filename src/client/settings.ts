/** Benutzereinstellungen, im Browser gespeichert. */

export interface Settings {
  /**
   * Symbolsatz. 'nato' folgt APP-6/MIL-STD-2525, 'dcs' lehnt sich an die
   * Kartendarstellung des Spiels an (Annäherung, siehe symbols/dcs.ts).
   */
  symbolSet: 'nato' | 'dcs';
  /** Fliegerkarte (hell, Kartenkonvention) oder Nachtdarstellung (dunkel, blendarm). */
  mode: 'chart' | 'night';
  elevationTint: boolean;
  hillshade: boolean;
  /** 0 bis 1. Höher zeigt mehr Relief, überstrahlt aber die Höhenstufen. */
  hillshadeStrength: number;
  rings: boolean;
  /**
   * Wirkungsbereiche der Flugabwehr. Vorgabe ist nur die Gegenseite: Eine
   * eigene PATRIOT-Stellung deckt mit 100 km die halbe Karte zu, ohne dass die
   * Information im Flug gebraucht würde.
   */
  threats: 'hostile' | 'all' | 'none';
  graticule: boolean;
  bullseye: boolean;
  /** Kampfpiloten geben missweisend durch; rechtweisend nur für Kartenarbeit. */
  bearingRef: 'magnetic' | 'true';
  mapLabels: boolean;
  /** Name und Höhe neben jedem Kontakt. Bei vielen Objekten schnell zu viel. */
  contactLabels: boolean;
  contacts: 'all' | 'air' | 'none';
  theater: string;
}

export const DEFAULTS: Settings = {
  symbolSet: 'nato',
  mode: 'chart',
  elevationTint: true,
  hillshade: true,
  hillshadeStrength: 0.5,
  rings: true,
  threats: 'hostile',
  graticule: true,
  bullseye: true,
  bearingRef: 'magnetic',
  mapLabels: true,
  contactLabels: true,
  contacts: 'all',
  theater: 'caucasus',
};

const KEY = 'dcs-map-server.settings';

export function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    // Unbekannte Felder aus älteren Ständen werden stillschweigend verworfen,
    // fehlende aus den Vorgaben ergänzt -- sonst bricht ein Update die Ansicht.
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Privater Modus o. ä. -- die Ansicht funktioniert auch ohne Speicherung.
  }
}
