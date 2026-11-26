/** User settings, stored in the browser. */

export interface Settings {
  /**
   * Symbol set. 'nato' is based on APP-6/MIL-STD-2525 (see symbols/nato.ts
   * for where it departs), 'dcs' approximates the game's own map
   * presentation (an approximation, see symbols/dcs.ts).
   */
  symbolSet: 'nato' | 'dcs';
  /** Aeronautical chart (light, map convention) or night presentation (dark, low-glare). */
  mode: 'chart' | 'night';
  elevationTint: boolean;
  hillshade: boolean;
  /** 0 to 1. Higher shows more relief, but washes out the elevation tints. */
  hillshadeStrength: number;
  rings: boolean;
  /**
   * Air defence engagement ranges. Default is the opposing side only: a
   * friendly PATRIOT site covers half the map at 100 km, without that
   * information being needed in flight.
   */
  threats: 'hostile' | 'all' | 'none';
  graticule: boolean;
  bullseye: boolean;
  /** The mission's objective zones (FOBs, targets), see zones.ts. */
  zones: boolean;
  /** The player's own fixed waypoints, see route.ts. */
  route: boolean;
  /** Fighter pilots call out magnetic; true only for map work. */
  bearingRef: 'magnetic' | 'true';
  mapLabels: boolean;
  /** Name and altitude next to every contact. Quickly too much with many objects. */
  contactLabels: boolean;
  contacts: 'all' | 'air' | 'none';
  theater: string;
  /**
   * The view as last left, from the control bar: orientation and range.
   * Follow vs. free is not kept -- a free view restored after a reload would
   * show wherever the map happened to be, not the aircraft.
   */
  headingUp: boolean;
  /** Index into RANGES_NM of the last range preset. */
  rangeIndex: number;
  /** A wheel/pinch/step zoom on top of the preset, or null for the preset itself. */
  manualZoom: number | null;
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
  zones: true,
  route: true,
  bearingRef: 'magnetic',
  mapLabels: true,
  contactLabels: true,
  contacts: 'all',
  theater: 'caucasus',
  headingUp: false,
  rangeIndex: 2,
  manualZoom: null,
};

const KEY = 'dcs-map-server.settings';

export function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    // Unknown fields from older versions are silently discarded, missing
    // ones filled in from the defaults -- otherwise an update would break the view.
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function save(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Private browsing or similar -- the view works fine without saving too.
  }
}
