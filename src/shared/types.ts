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
  /**
   * Flown by a person rather than the AI (DCS's Flags.Human). Then unitName
   * is the player's name. Absent for AI and from older hooks and recordings.
   */
  human?: true;
}

export interface Ownship extends Unit {
  /** Model time from DCS. Serves the client as its time base, not the wall clock. */
  modelTime: number;
  /**
   * Mission start time in seconds after midnight, from the hook's header.
   * Start plus modelTime is the mission's clock time, as on the F10 map.
   * Absent from older hooks and recordings.
   */
  missionStart?: number;
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

/**
 * An airbase as DCS itself knows it -- airfield, and whatever else DCS lists
 * under LoGetWorldObjects('airdromes'). A map feature, not a contact: every
 * player sees DCS's airfields on the F10 map, so no fog of war applies.
 */
export interface Airbase {
  id: number;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  /** Heading in radians, as DCS reports it for the base. */
  hdg: number;
  /** As DCS reports it; whether that tracks a base changing hands is not yet confirmed. */
  coalition: Coalition;
  /** DCS Type.level2, kept to tell kinds of base apart later. */
  level2: number;
}

/**
 * A trigger zone from the mission file, already in lat/lon. Static for the
 * whole mission. Like airbases a map feature, not a contact: no fog of war.
 */
export interface Zone {
  id: number;
  name: string;
  /** As the mission builder set it; which zones to draw is the client's call. */
  hidden: boolean;
  shape: 'circle' | 'quad';
  /** Circles: centre and radius in metres. */
  lat: number;
  lon: number;
  radiusM: number;
  /** Quads: the corners, [lat, lon]. */
  vertices?: [number, number][];
  /** The zone's own colour in the mission, r/g/b/a 0..1. */
  color: [number, number, number, number];
}

/** One waypoint of the player's own flight plan, already in lat/lon. */
export interface Waypoint {
  lat: number;
  lon: number;
  /** Metres above sea level, as planned; 0 where the source has none. */
  alt: number;
  /** As the mission builder named it; usually empty. */
  name: string;
}

/**
 * The player's own flight plan. Only fixed, planned waypoints:
 *
 * - 'mission': the route the mission builder gave the player's group in the
 *   editor. Missing for dynamic-spawn slots, which aren't in the mission file.
 * - 'aircraft': LoGetRoute(), the route the aircraft itself reports. Only some
 *   aircraft do; modules with their own navigation computer (F-16C and the
 *   like) report nothing, so waypoints entered in the cockpit (STPT) or with
 *   the F10 route tool never reach the map.
 */
export interface Route {
  source: 'mission' | 'aircraft';
  /** Index into points of the waypoint being flown to, or -1 when unknown. */
  next: number;
  points: Waypoint[];
}

/**
 * Radio and navaid data for one airfield, read from the theater's own files
 * in the local DCS install (Radio.lua, Beacons.lua) at setup. Fixed per map,
 * not per mission: a mission's own beacons (tanker or carrier TACAN) aren't
 * in here.
 */
export interface AirfieldNav {
  /** DCS's own key, "airfield25" -- shared by the radio and beacon entries. */
  key: string;
  /** As the beacons name the field -- the same spelling the export uses. */
  name: string;
  /** Other spellings (the radio callsigns), for matching. */
  aliases: string[];
  /** Mean position of the field's beacons, for matching by distance. */
  lat?: number;
  lon?: number;
  /** Tower frequencies in MHz, per band. */
  com: { vhf?: number; uhf?: number; vhfLow?: number; hf?: number };
  nav: NavAid[];
}

export interface NavAid {
  kind: 'ILS' | 'TCN' | 'VOR' | 'NDB' | 'RSBN' | 'PRMG';
  ident: string;
  /** VHF/UHF navaids. */
  mhz?: number;
  /** NDBs. */
  khz?: number;
  channel?: number;
  /** ILS/PRMG: final approach course, true, degrees. */
  courseTrue?: number;
  /** NDBs on an approach: the outer (far) or inner (near) homer. */
  role?: 'outer' | 'inner';
  /** Where the beacon stands -- decides which runway direction it serves. */
  lat?: number;
  lon?: number;
}

export interface Snapshot {
  type: 'snapshot';
  seq: number;
  serverTime: number;
  optionsView: OptionsView;
  /**
   * The server has DCS's object export switched off, so no other unit will
   * ever arrive. Absent from older servers and recordings.
   */
  objectsBlocked?: boolean;
  own: Ownship | null;
  units: Unit[];
  /** Absent from older servers and recordings. */
  airbases?: Airbase[];
  zones?: Zone[];
  /** The player's flight plan; null when there is none. Absent from older servers. */
  route?: Route | null;
  /**
   * The server's version, set by the server for its own clients (not part of
   * World's state). Absent from older servers and recordings.
   */
  version?: string;
}

export interface Delta {
  type: 'delta';
  seq: number;
  serverTime: number;
  optionsView: OptionsView;
  objectsBlocked?: boolean;
  own?: Ownship;
  units?: Unit[];
  removed?: number[];
  /** New or changed airbases. */
  airbases?: Airbase[];
  /** The mission ended: drop every airbase before applying anything else. */
  airbasesCleared?: true;
  /** New or changed trigger zones. */
  zones?: Zone[];
  /** The mission ended: drop every zone. */
  zonesCleared?: true;
  /** Present only when the flight plan changed; null means it is gone. */
  route?: Route | null;
}

export type ServerMessage = Snapshot | Delta;
