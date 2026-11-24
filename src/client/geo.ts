/** Geodetic helper functions. Angles in radians, distances in metres. */

export const R_EARTH = 6_371_000;
export const M_PER_NM = 1852;

/**
 * Magnetic variation for converting true to magnetic.
 *
 * Fighter pilots call out bearings magnetic, not true -- a bullseye call in
 * true would simply be wrong for the intended audience. The proper fix
 * would be the world magnetic model; until then, a fixed value per theater
 * that's correct at the map centre and drifts by fractions of a degree at the edges.
 */
export const MAG_VAR_DEG: Record<string, number> = {
  caucasus: 6.5,
  syria: 4.8,
  persiangulf: 2.3,
  sinai: 4.6,
  normandy: -0.5,
  marianas: 1.0,
  kola: 14.0,
  iraq: 4.2,
  afghanistan: 3.3,
};

export const toRad = (deg: number): number => (deg * Math.PI) / 180;
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Destination point along the great circle. */
export function destination(lat: number, lon: number, bearing: number, dist: number): [number, number] {
  const p1 = toRad(lat);
  const l1 = toRad(lon);
  const d = dist / R_EARTH;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(bearing));
  const l2 = l1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [toDeg(p2), ((toDeg(l2) + 540) % 360) - 180];
}

/** True initial bearing from 1 to 2, in radians. */
export function bearingTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  return (
    (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) +
      2 * Math.PI) %
    (2 * Math.PI)
  );
}

export function distanceTo(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = p2 - p1;
  const dl = toRad(lon2 - lon1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

export const shortestAngle = (a: number, b: number): number =>
  ((((b - a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

/** Three-digit degree figure, as spoken on the radio: 005, 090, 350. */
export const bearing3 = (rad: number): string =>
  String(Math.round(((toDeg(rad) % 360) + 360) % 360) % 360).padStart(3, '0');

/** True to magnetic. */
export const toMagnetic = (trueRad: number, magVarDeg: number): number =>
  (trueRad - toRad(magVarDeg) + 2 * Math.PI) % (2 * Math.PI);

/**
 * Aspect angle: angle between the contact's heading and the line of sight to us.
 * 0 = flying straight at us (hot), 180 = away (cold).
 */
export function aspect(contactHdg: number, bearingFromContactToUs: number): number {
  return Math.abs(toDeg(shortestAngle(contactHdg, bearingFromContactToUs)));
}

/**
 * Track over the ground and ground speed, from heading, true airspeed and
 * the wind.
 *
 * An aircraft points where its heading says and travels somewhere else: the
 * air it is flying through is moving too. Without this the symbol creeps off
 * the real position between updates, and a closing speed computed from
 * airspeed is wrong by the wind along the line of sight.
 *
 * The one assumption here is the frame DCS reports wind in. Its world axes
 * are x north, y up, z east, and LoGetVectorWindVelocity gives the velocity
 * of the air, so the two vectors simply add. Neither recorded session can
 * confirm that -- the aircraft is parked in both and there is no wind worth
 * the name -- so it is taken from the export API and wants one flight in a
 * strong crosswind to be sure of. If it is ever found to be wrong, it is
 * wrong only here.
 */
export function groundTrack(
  hdg: number,
  tas: number,
  wind: { x: number; z: number },
): { track: number; speed: number } {
  const north = tas * Math.cos(hdg) + wind.x;
  const east = tas * Math.sin(hdg) + wind.z;
  const speed = Math.hypot(north, east);
  // Standing still over the ground has no track; keep the heading rather
  // than let atan2(0, 0) decide.
  const track = speed < 1e-9 ? hdg : (Math.atan2(east, north) + 2 * Math.PI) % (2 * Math.PI);
  return { track, speed };
}

/**
 * Wind speed and the direction it is blowing FROM, in metres per second and
 * radians -- the convention a METAR or a radio call uses ("270 at 15"), not
 * the direction the air itself is moving toward, which is what the raw
 * vector gives you.
 */
export function windFrom(x: number, z: number): { bearing: number; speedMs: number } {
  const speedMs = Math.hypot(x, z);
  // Reversed: a vector pointing where the air moves TO becomes the bearing
  // it moves FROM once you negate it.
  const bearing = speedMs < 1e-9 ? 0 : (Math.atan2(-z, -x) + 2 * Math.PI) % (2 * Math.PI);
  return { bearing, speedMs };
}

/**
 * Closing speed along the line of sight, in m/s: positive closing, negative
 * opening. A radar display calls this Vc, and it is what the decision to
 * commit or to turn away is actually made on -- a contact 40 nm out means
 * something quite different at 900 knots of closure than at 100.
 */
export function closureMs(
  ownHdg: number,
  ownSpeed: number,
  contactHdg: number,
  contactSpeed: number,
  bearingOwnToContact: number,
): number {
  const ownAlong = ownSpeed * Math.cos(ownHdg - bearingOwnToContact);
  const contactAlong = contactSpeed * Math.cos(contactHdg - bearingOwnToContact);
  return ownAlong - contactAlong;
}

export function aspectLabel(deg: number): string {
  if (deg <= 30) return 'HOT';
  if (deg <= 60) return 'FLANK';
  if (deg <= 120) return 'BEAM';
  if (deg <= 150) return 'DRAG';
  return 'COLD';
}

export const metersToFeet = (m: number): number => m * 3.28084;
export const metersToNm = (m: number): number => m / M_PER_NM;
export const msToKnots = (ms: number): number => ms * 1.94384;

/**
 * Altitude in thousands of feet, one decimal -- how a contact's altitude is
 * called on the radio ("thirty-one thousand") and what the game's own map
 * puts beside an air contact. Surface contacts keep plain feet: "0.6" for a
 * vehicle on a hill tells you nothing.
 */
export const altitudeThousands = (meters: number): string =>
  (metersToFeet(meters) / 1000).toFixed(1);

/** Degrees and decimal minutes -- the format of DCS cockpits and radio traffic. */
export function formatDDM(value: number, axis: 'NS' | 'EW'): string {
  const hemi = axis === 'NS' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${hemi}${String(deg).padStart(axis === 'NS' ? 2 : 3, '0')}°${min.toFixed(3).padStart(6, '0')}'`;
}

/** Flight level, otherwise altitude in feet -- as noted on a kneeboard. */
export function formatAltitude(meters: number): string {
  const ft = metersToFeet(meters);
  if (ft >= 18_000) return `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
  return `${Math.round(ft / 100) * 100} ft`;
}

/**
 * Mission elapsed time as HH:MM:SS, from DCS' own model time -- not the
 * wall clock, which every device already shows on its own and which has no
 * relationship to the mission. A bare sequence counter sat here before and
 * meant nothing to look at; this is what a mission clock actually is, and it
 * still reveals a stalled feed the same way a counter would: if it stops
 * advancing, nothing more is coming in.
 */
export function formatMissionTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

/**
 * Range steps like on an MFD.
 *
 * 5/10/20/80/160 nm is the scaling of the Hornet's and Viper's HSI/HSD
 * displays. Stepless zoom is convenient on the ground but a hindrance in
 * flight: you want a known distance at the press of a button, not just some
 * scale. 1 nm and 50 nm aren't part of the classic staffing, but are wanted
 * here as extra quick picks -- 1 nm for taxiing, 50 nm as a step between 20
 * and 80.
 */
export const RANGES_NM = [1, 5, 10, 20, 50, 80, 160] as const;

/** Steps with a direct button -- all of them. */
export const RANGE_PRESETS_NM = RANGES_NM;

/**
 * Web Mercator resolution at zoom 0: metres per pixel at the equator.
 *
 * MapLibre scales its zoom to 512 pixel tiles, so at zoom 0 the whole world
 * spans 512 pixels and this is the equatorial circumference divided by that.
 * The widely quoted 156_543.034 is the same figure for 256 pixel tiles; used
 * here it made every range step come out one zoom level too close, so the
 * view showed half the distance the button and the readout claimed.
 */
const MPP_ZOOM0 = 40_075_016.686 / 512;

/**
 * Zoom level at which the given range reaches from the centre to the edge
 * of the shorter screen axis -- so "40" means the same thing on every device.
 */
export function zoomForRange(rangeNm: number, lat: number, viewportShortPx: number): number {
  const halfPx = Math.max(viewportShortPx, 1) / 2;
  const metersPerPixel = (rangeNm * M_PER_NM) / halfPx;
  return Math.log2((MPP_ZOOM0 * Math.cos(toRad(lat))) / metersPerPixel);
}

/** Inverse of zoomForRange -- the actual range at a freely chosen zoom, e.g. after a pinch. */
export function rangeForZoom(zoom: number, lat: number, viewportShortPx: number): number {
  const halfPx = Math.max(viewportShortPx, 1) / 2;
  const metersPerPixel = (MPP_ZOOM0 * Math.cos(toRad(lat))) / 2 ** zoom;
  return (metersPerPixel * halfPx) / M_PER_NM;
}
