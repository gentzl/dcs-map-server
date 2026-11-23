import type { OptionsView } from '../src/shared/types.js';

/**
 * Schreibt Telemetrie-Datagramme in den beiden Formaten, die der Server liest.
 *
 * Gegenstück zu src/server/protocol.ts. Dass beide Seiten dasselbe Format
 * meinen, prüfen die Werkzeuge zur Laufzeit, indem sie ihr erstes Datagramm
 * durch den Parser des Servers schicken -- zwei unabhängige Implementierungen
 * desselben Formats laufen sonst früher oder später auseinander.
 */

export type Schema = 1 | 3;

export interface OwnshipFields {
  id: number;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  /** Bogenmass, 0 = Nord. */
  hdg: number;
  unitName: string;
  groupName: string;
  coalition: number;
  tas: number;
  ralt: number;
  /** 0 in der Luft, 1 Boden, 2 Traegerdeck. */
  wow: number;
  aoa: number;
  accelY: number;
  chaff: number;
  flare: number;
  wind: { x: number; y: number; z: number };
  modelTime: number;
}

export interface UnitFields {
  id: number;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  hdg: number;
  unitName: string;
  groupName: string;
  coalition: number;
  /** Type.level1 aus DCS: 1 Air, 2 Ground, 3 Navy, 4 Weapon, 5 Static. */
  level1: number;
  level2: number;
}

export interface WeaponFields {
  id: number;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  hdg: number;
  coalition: number;
}

const f = (v: number, digits: number): string => v.toFixed(digits);

/** Tabs und Zeilenumbrueche zerlegen Schema 3, Kommata zerlegen Schema 1. */
const clean = (v: string, schema: Schema): string => {
  const stripped = v.replace(/[\t\r\n]/g, ' ');
  return schema === 1 ? stripped.replace(/,/g, ' ') : stripped;
};

export function ownshipLine(o: OwnshipFields, view: OptionsView, schema: Schema): string {
  const c = (v: string) => clean(v, schema);
  if (schema === 1) {
    return [
      'O', o.id, c(o.name), 1, f(o.lat, 6), f(o.lon, 6), f(o.alt, 6), f(o.hdg, 6),
      c(o.unitName), c(o.groupName), o.coalition,
      f(o.wind.x, 6), f(o.wind.y, 6), f(o.wind.z, 6),
      o.chaff, o.flare, f(o.modelTime, 3), f(o.tas, 6), view,
      f(o.ralt, 3), f(o.wow, 6), f(o.accelY, 3), f(o.aoa, 2),
    ].join(',');
  }
  return [
    'O', o.id, c(o.name), f(o.lat, 7), f(o.lon, 7), f(o.alt, 2), f(o.hdg, 5),
    c(o.unitName), c(o.groupName), o.coalition,
    f(o.tas, 2), f(o.ralt, 2), o.wow, f(o.aoa, 3), f(o.accelY, 3),
    o.chaff, o.flare, f(o.wind.x, 2), f(o.wind.y, 2), f(o.wind.z, 2),
  ].join('\t');
}

export function unitLine(u: UnitFields, schema: Schema): string {
  const c = (v: string) => clean(v, schema);
  if (schema === 1) {
    return [
      'A', u.id, c(u.name), u.level2, f(u.lat, 6), f(u.lon, 6), f(u.alt, 6), f(u.hdg, 6),
      c(u.unitName), c(u.groupName), u.coalition,
    ].join(',');
  }
  return [
    'A', u.id, c(u.name), f(u.lat, 6), f(u.lon, 6), f(u.alt, 1), f(u.hdg, 5),
    c(u.unitName), c(u.groupName), u.coalition, u.level1, u.level2,
  ].join('\t');
}

export function weaponLine(w: WeaponFields, schema: Schema): string {
  const c = (v: string) => clean(v, schema);
  if (schema === 1) {
    return ['W', w.id, c(w.name), f(w.lat, 6), f(w.lon, 6), f(w.alt, 6), f(w.hdg, 6), w.coalition].join(',');
  }
  return ['W', w.id, c(w.name), f(w.lat, 6), f(w.lon, 6), f(w.alt, 1), f(w.hdg, 5), w.coalition].join('\t');
}

/** Nur Schema 3 kennt Löschereignisse. */
export const removeLine = (id: number): string => `D\t${id}`;

/**
 * Fasst die Zeilen eines Ticks zu Datagrammen zusammen. Schema 3 bündelt alles
 * hinter einer Kopfzeile, Schema 1 kennt keine und sendet je Zeile einzeln.
 */
export function toDatagrams(
  lines: string[],
  modelTime: number,
  view: OptionsView,
  schema: Schema,
): string[] {
  if (schema === 1) return lines;
  const header = `MM\t3\t${f(modelTime, 3)}\t${view}`;
  return [`${[header, ...lines].join('\n')}\n`];
}
