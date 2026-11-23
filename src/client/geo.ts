/** Geodätische Hilfsfunktionen. Winkel in Bogenmaß, Strecken in Metern. */

export const R_EARTH = 6_371_000;
export const M_PER_NM = 1852;

/**
 * Missweisung für die Umrechnung rechtweisend → missweisend.
 *
 * Kampfpiloten geben Peilungen missweisend durch, nicht rechtweisend – eine
 * Bullseye-Meldung in True wäre für die Zielgruppe schlicht falsch. Sauber wäre
 * das Weltmagnetfeldmodell; bis dahin ein Festwert je Theater, der für die
 * Kartenmitte stimmt und an den Rändern um Bruchteile eines Grads abweicht.
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

/** Zielpunkt auf dem Großkreis. */
export function destination(lat: number, lon: number, bearing: number, dist: number): [number, number] {
  const p1 = toRad(lat);
  const l1 = toRad(lon);
  const d = dist / R_EARTH;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(bearing));
  const l2 = l1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [toDeg(p2), ((toDeg(l2) + 540) % 360) - 180];
}

/** Rechtweisende Anfangspeilung von 1 nach 2, in Bogenmaß. */
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

/** Dreistellige Gradzahl, wie im Funk gesprochen: 005, 090, 350. */
export const bearing3 = (rad: number): string =>
  String(Math.round(((toDeg(rad) % 360) + 360) % 360) % 360).padStart(3, '0');

/** Rechtweisend nach missweisend. */
export const toMagnetic = (trueRad: number, magVarDeg: number): number =>
  (trueRad - toRad(magVarDeg) + 2 * Math.PI) % (2 * Math.PI);

/**
 * Aspektwinkel: Winkel zwischen Kurs des Kontakts und der Sichtlinie zu uns.
 * 0 = fliegt direkt auf uns zu (hot), 180 = weg (cold).
 */
export function aspect(contactHdg: number, bearingFromContactToUs: number): number {
  return Math.abs(toDeg(shortestAngle(contactHdg, bearingFromContactToUs)));
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

/** Grad und Dezimalminuten – das Format der DCS-Cockpits und des Funkverkehrs. */
export function formatDDM(value: number, axis: 'NS' | 'EW'): string {
  const hemi = axis === 'NS' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  return `${hemi}${String(deg).padStart(axis === 'NS' ? 2 : 3, '0')}°${min.toFixed(3).padStart(6, '0')}'`;
}

/** Flugfläche, sonst Höhe in Fuß – wie auf dem Kniebrett notiert. */
export function formatAltitude(meters: number): string {
  const ft = metersToFeet(meters);
  if (ft >= 18_000) return `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
  return `${Math.round(ft / 100) * 100} ft`;
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

/** Auflösung des Web-Mercator bei Zoom 0, Meter je Pixel am Äquator. */
const MPP_ZOOM0 = 156_543.03392;

/**
 * Zoomstufe, bei der die angegebene Entfernung vom Mittelpunkt bis zum Rand der
 * kürzeren Bildschirmachse reicht -- so bedeutet "40" auf jedem Gerät dasselbe.
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
