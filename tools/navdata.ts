import type { AirfieldNav, NavAid } from '../src/shared/types.js';

/**
 * Reads a DCS theater's Radio.lua and Beacons.lua into per-airfield radio
 * and navaid data.
 *
 * Read as text, never executed: they are Lua that dofile()s other game
 * scripts, so there is nothing to run them in here, and nothing they could
 * do that we'd want anyway. Each entry is a block of `key = value;` lines in
 * a stable layout, which a few patterns read reliably; an entry that doesn't
 * fit is skipped rather than guessed at.
 */

export interface RadioEntry {
  /** "airfield25" -- the radioId without its "_0" suffix. */
  key: string;
  names: string[];
  com: AirfieldNav['com'];
}

export interface BeaconEntry {
  key: string;
  name: string;
  type: string;
  ident: string;
  hz: number;
  channel?: number;
  direction?: number;
  lat?: number;
  lon?: number;
}

/** Splits a file into one chunk per entry, each starting at its marker. */
function chunks(text: string, marker: RegExp): string[] {
  const starts: number[] = [];
  for (const m of text.matchAll(marker)) starts.push(m.index);
  return starts.map((s, i) => text.slice(s, starts[i + 1] ?? text.length));
}

const BANDS: Record<string, keyof AirfieldNav['com']> = {
  VHF_HI: 'vhf',
  UHF: 'uhf',
  VHF_LOW: 'vhfLow',
  HF: 'hf',
};

export function parseRadio(text: string): RadioEntry[] {
  const out: RadioEntry[] = [];
  for (const c of chunks(text, /radioId\s*=\s*'/g)) {
    const id = /radioId\s*=\s*'([^']*)'/.exec(c)?.[1];
    const key = id && /^(airfield\d+)/.exec(id)?.[1];
    if (!key) continue; // not an airfield radio
    const names = [...c.matchAll(/_\("([^"]+)"\)/g)].map((m) => m[1]!.replace(/_/g, ' '));
    const com: AirfieldNav['com'] = {};
    for (const m of c.matchAll(/\[(VHF_HI|UHF|VHF_LOW|HF)\]\s*=\s*\{\s*\w+\s*,\s*([\d.]+)/g)) {
      com[BANDS[m[1]!]!] = Number(m[2]) / 1e6;
    }
    out.push({ key, names, com });
  }
  return out;
}

export function parseBeacons(text: string): BeaconEntry[] {
  const out: BeaconEntry[] = [];
  for (const c of chunks(text, /display_name\s*=/g)) {
    const key = /beaconId\s*=\s*'(airfield\d+)_/.exec(c)?.[1];
    if (!key) continue; // a beacon not belonging to an airfield
    const name = /display_name\s*=\s*_\('((?:[^'\\]|\\.)*)'\)/.exec(c)?.[1] ?? '';
    const type = /type\s*=\s*(BEACON_TYPE_\w+)/.exec(c)?.[1];
    const freq = /frequency\s*=\s*([\d.]+)/.exec(c)?.[1];
    const channel = /channel\s*=\s*(\d+)/.exec(c)?.[1];
    // RSBN and PRMG are defined by channel alone, with no frequency line;
    // an entry needs one or the other.
    if (!type || (freq === undefined && channel === undefined)) continue;
    const hz = freq !== undefined ? Number(freq) : 0;
    const direction = /direction\s*=\s*(-?[\d.]+)/.exec(c)?.[1];
    const lat = /latitude\s*=\s*(-?[\d.]+)/.exec(c)?.[1];
    const lon = /longitude\s*=\s*(-?[\d.]+)/.exec(c)?.[1];
    out.push({
      key,
      name,
      type,
      ident: /callsign\s*=\s*'([^']*)'/.exec(c)?.[1] ?? '',
      hz,
      ...(channel !== undefined ? { channel: Number(channel) } : {}),
      ...(direction !== undefined ? { direction: Number(direction) } : {}),
      ...(lat !== undefined && lon !== undefined ? { lat: Number(lat), lon: Number(lon) } : {}),
    });
  }
  return out;
}

/**
 * One navaid per beacon worth showing, under the label a chart would use.
 * Glideslopes are dropped: they share the localizer's frequency and add
 * nothing to read.
 *
 * A localizer's `direction` points away from the transmitter, i.e. back
 * along the approach: Kutaisi's reads -106°, its final approach course is
 * 074°. Hence +180.
 */
function toNavAid(b: BeaconEntry): NavAid | null {
  const n = baseNavAid(b);
  return n && b.lat !== undefined && b.lon !== undefined ? { ...n, lat: b.lat, lon: b.lon } : n;
}

function baseNavAid(b: BeaconEntry): NavAid | null {
  const course = b.direction !== undefined ? (((b.direction + 180) % 360) + 360) % 360 : undefined;
  switch (b.type) {
    case 'BEACON_TYPE_ILS_LOCALIZER':
      return { kind: 'ILS', ident: b.ident, mhz: b.hz / 1e6, ...(course !== undefined ? { courseTrue: course } : {}) };
    case 'BEACON_TYPE_PRMG_LOCALIZER':
      return { kind: 'PRMG', ident: b.ident, ...(b.channel !== undefined ? { channel: b.channel } : {}), ...(course !== undefined ? { courseTrue: course } : {}) };
    case 'BEACON_TYPE_TACAN':
      return b.channel !== undefined ? { kind: 'TCN', ident: b.ident, channel: b.channel } : null;
    case 'BEACON_TYPE_VOR':
    case 'BEACON_TYPE_VOR_DME':
    case 'BEACON_TYPE_VORTAC':
      return { kind: 'VOR', ident: b.ident, mhz: b.hz / 1e6 };
    case 'BEACON_TYPE_RSBN':
      return { kind: 'RSBN', ident: b.ident, ...(b.channel !== undefined ? { channel: b.channel } : {}) };
    case 'BEACON_TYPE_ILS_FAR_HOMER':
      return { kind: 'NDB', ident: b.ident, khz: b.hz / 1e3, role: 'outer' };
    case 'BEACON_TYPE_ILS_NEAR_HOMER':
      return { kind: 'NDB', ident: b.ident, khz: b.hz / 1e3, role: 'inner' };
    case 'BEACON_TYPE_HOMER':
    case 'BEACON_TYPE_AIRPORT_HOMER':
    case 'BEACON_TYPE_AIRPORT_HOMER_WITH_MARKER':
      return { kind: 'NDB', ident: b.ident, khz: b.hz / 1e3 };
    default:
      return null; // glideslopes and anything not worth a line
  }
}

const ORDER: NavAid['kind'][] = ['ILS', 'PRMG', 'TCN', 'VOR', 'RSBN', 'NDB'];

export function buildAirfields(radio: RadioEntry[], beacons: BeaconEntry[]): AirfieldNav[] {
  const keys = new Set([...radio.map((r) => r.key), ...beacons.map((b) => b.key)]);
  const out: AirfieldNav[] = [];
  for (const key of keys) {
    const r = radio.find((x) => x.key === key);
    const bs = beacons.filter((b) => b.key === key);
    const named = bs.find((b) => b.name)?.name;
    const name = named ?? r?.names[0];
    if (!name) continue;

    const nav: NavAid[] = [];
    const seen = new Set<string>();
    for (const b of bs) {
      const n = toNavAid(b);
      if (!n) continue;
      const sig = `${n.kind}|${n.role ?? ''}|${n.ident}|${n.mhz ?? n.khz ?? n.channel}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      nav.push(n);
    }
    nav.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));

    const placed = bs.filter((b) => b.lat !== undefined && b.lon !== undefined);
    const field: AirfieldNav = {
      key,
      name,
      aliases: [...new Set((r?.names ?? []).filter((a) => a !== name))],
      com: r?.com ?? {},
      nav,
    };
    if (placed.length) {
      field.lat = placed.reduce((s, b) => s + b.lat!, 0) / placed.length;
      field.lon = placed.reduce((s, b) => s + b.lon!, 0) / placed.length;
    }
    out.push(field);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
