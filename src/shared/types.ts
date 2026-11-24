/** Visibility rule from DCS (missionOptions.difficulty.optionsView). */
export type OptionsView =
  | 'optview_onlymap'
  | 'optview_myaircraft'
  | 'optview_allies'
  | 'optview_onlyallies'
  | 'optview_extended'
  | 'optview_all';

export type Coalition = 0 | 1 | 2; // 0 = neutral, 1 = red, 2 = blue

/**
 * Category for display. Coarse enough to tell apart at a glance, fine
 * enough to separate air defence from other ground targets -- only the
 * latter gets a threat ring.
 */
export type Category =
  | 'air'
  | 'cargo'
  | 'tanker'
  | 'awacs'
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

/**
 * Categories that are airborne, and whose altitude is therefore worth calling.
 * Weapons count: a missile's altitude is read the same way an aircraft's is.
 */
export const AIRBORNE: ReadonlySet<Category> = new Set<Category>([
  'air', 'cargo', 'tanker', 'awacs', 'helo', 'weapon',
]);

export interface Unit {
  id: number;
  kind: 'unit' | 'weapon';
  name: string;
  lat: number;
  lon: number;
  alt: number;
  /** Radians, 0 = north -- as supplied by LoGetSelfData(). */
  hdg: number;
  coalition: Coalition;
  category: Category;
  unitName?: string;
  groupName?: string;
  /** Engagement range in metres, only for air defence of a known type. */
  threatM?: number;
  /** Short label of the system for the ring's annotation. */
  threatLabel?: string;
}

export interface Ownship extends Unit {
  /** Model time from DCS. Serves the client as its time base, not the wall clock. */
  modelTime: number;
  tas: number;
  ralt: number;
  /** 0 = airborne, 1 = ground, 2 = carrier deck. */
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
