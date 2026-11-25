import type { OptionsView } from '../src/shared/types.js';

/**
 * Writes telemetry datagrams in the two formats the server reads.
 *
 * Counterpart to src/server/protocol.ts. That both sides agree on the format
 * is checked by the tools at runtime, by sending their first datagram
 * through the server's own parser -- two independent implementations of one
 * format otherwise drift apart sooner or later.
 */

export type Schema = 1 | 3;

export interface OwnshipFields {
  id: number;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  /** Radians, 0 = north. */
  hdg: number;
  unitName: string;
  groupName: string;
  coalition: number;
  tas: number;
  ralt: number;
  /** 0 airborne, 1 ground, 2 carrier deck. */
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
  /** Type.level1 from DCS: 1 Air, 2 Ground, 3 Navy, 4 Weapon, 5 Static. */
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

/** Tabs and line breaks would split schema 3, commas would split schema 1. */
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

/** Only schema 3 knows removal events. */
export const removeLine = (id: number): string => `D\t${id}`;

export interface AirbaseFields {
  id: number;
  name: string;
  lat: number;
  lon: number;
  alt: number;
  hdg: number;
  coalition: number;
  level2: number;
}

export interface ZoneFields {
  id: number;
  name: string;
  hidden: boolean;
  /** 0 circle, 2 quad -- DCS's own numbers. */
  type: 0 | 2;
  radius: number;
  lat: number;
  lon: number;
  color: [number, number, number, number];
  vertices?: [number, number][];
}

/** Only schema 3 knows zones. */
export const zoneLine = (z: ZoneFields): string =>
  [
    'Z', z.id, clean(z.name, 3), z.hidden ? 1 : 0, z.type, f(z.radius, 1), f(z.lat, 6), f(z.lon, 6),
    z.color.map((c) => f(c, 2)).join(','),
    (z.vertices ?? []).map(([la, lo]) => `${f(la, 6)},${f(lo, 6)}`).join(';'),
  ].join('\t');

/** Only schema 3 knows airbases. */
export const airbaseLine = (b: AirbaseFields): string =>
  ['B', b.id, clean(b.name, 3), f(b.lat, 6), f(b.lon, 6), f(b.alt, 1), f(b.hdg, 5), b.coalition, b.level2].join('\t');

/**
 * Bundles a tick's lines into datagrams. Schema 3 bundles everything behind
 * one header line, schema 1 has none and sends each line separately.
 */
export function toDatagrams(
  lines: string[],
  modelTime: number,
  view: OptionsView,
  schema: Schema,
  /** Mission start, seconds after midnight. Omitted gives the older four-field header. */
  missionStart?: number,
): string[] {
  if (schema === 1) return lines;
  const start = missionStart === undefined ? '' : `\t${Math.round(missionStart)}`;
  const header = `MM\t3\t${f(modelTime, 3)}\t${view}${start}`;
  return [`${[header, ...lines].join('\n')}\n`];
}
