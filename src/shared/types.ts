/** Sichtbarkeitsregel aus DCS (missionOptions.difficulty.optionsView). */
export type OptionsView =
  | 'optview_onlymap'
  | 'optview_myaircraft'
  | 'optview_allies'
  | 'optview_onlyallies'
  | 'optview_all';

export type Coalition = 0 | 1 | 2; // 0 = neutral, 1 = rot, 2 = blau

/**
 * Kategorie für die Darstellung. Grob genug, um auf einen Blick unterscheidbar
 * zu sein, fein genug, um Flugabwehr von sonstigen Bodenzielen zu trennen --
 * nur Letztere bekommt einen Bedrohungsring.
 */
export type Category =
  | 'air'
  | 'helo'
  | 'armor'
  | 'ground'
  | 'sam'
  | 'naval'
  | 'carrier'
  | 'submarine'
  | 'weapon'
  | 'static'
  | 'destroyed'
  | 'unknown';

export interface Unit {
  id: number;
  kind: 'unit' | 'weapon';
  name: string;
  lat: number;
  lon: number;
  alt: number;
  /** Bogenmass, 0 = Nord -- wie von LoGetSelfData() geliefert. */
  hdg: number;
  coalition: Coalition;
  category: Category;
  unitName?: string;
  groupName?: string;
  /** Wirkungsbereich in Metern, nur bei Flugabwehr mit bekanntem Typ. */
  threatM?: number;
  /** Kurzbezeichnung des Systems für die Beschriftung des Rings. */
  threatLabel?: string;
}

export interface Ownship extends Unit {
  /** Modellzeit aus DCS. Dient dem Client als Zeitbasis, nicht die Wanduhr. */
  modelTime: number;
  tas: number;
  ralt: number;
  /** 0 = in der Luft, 1 = Boden, 2 = Traegerdeck. */
  wow: 0 | 1 | 2;
  aoa: number;
  accelY: number;
  chaff: number;
  flare: number;
  wind: { x: number; y: number; z: number };
}

export interface Snapshot {
  type: 'snapshot';
  seq: number;
  serverTime: number;
  optionsView: OptionsView;
  own: Ownship | null;
  units: Unit[];
}

export interface Delta {
  type: 'delta';
  seq: number;
  serverTime: number;
  optionsView: OptionsView;
  own?: Ownship;
  units?: Unit[];
  removed?: number[];
}

export type ServerMessage = Snapshot | Delta;
