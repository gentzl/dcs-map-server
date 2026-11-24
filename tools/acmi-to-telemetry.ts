import { createSocket } from 'node:dgram';
import { createWriteStream, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseDatagram } from '../src/server/protocol.js';
import type { OptionsView } from '../src/shared/types.js';
import { toRad } from '../src/client/geo.js';
import { type Schema, ownshipLine, removeLine, toDatagrams, unitLine, weaponLine } from './wire.js';
import { isZip, readFirstEntry } from './zip.js';

/**
 * Converts a Tacview ACMI recording into telemetry datagrams.
 *
 * Turns a real DCS flight into test data: DCS/Tacview writes a .acmi after
 * every flight, which already contains everything needed.
 *
 *   npm run acmi -- flight.zip.acmi --list     # show objects
 *   npm run acmi -- flight.zip.acmi --send
 *
 * Format per https://www.tacview.net/documentation/acmi/ :
 *   Header   object 0 carries ReferenceLongitude/-Latitude
 *   Frame    "#<seconds>"
 *   Object   "<hexid>,T=lon|lat|alt|roll|pitch|yaw,Name=..,Type=.."
 *   Remove   "-<hexid>"
 *
 * Three pitfalls are handled: empty fields in T= mean "unchanged", not
 * zero; the coordinates are offsets from the reference values; commas in
 * names are escaped.
 */

interface Transform {
  lon?: number;
  lat?: number;
  alt?: number;
  yaw?: number;
}

interface Meta {
  Name?: string;
  Type?: string;
  Coalition?: string;
  Color?: string;
  Pilot?: string;
  Group?: string;
}

interface Frame {
  t: number;
  changed: Map<string, Transform>;
  removed: string[];
}

const HEX_ID = /^[0-9a-fA-F]+$/;

/** Splits on commas, respecting backslash escaping. */
function splitFields(line: string): string[] {
  const out: string[] = [];
  let current = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '\\' && line[i + 1] === ',') {
      current += ',';
      i++;
    } else if (ch === ',') {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

/** Empty fields in T= mean "unchanged" -- the most common parsing mistake. */
function mergeTransform(prev: Transform, raw: string): Transform {
  const f = raw.split('|');
  const out = { ...prev };
  const keys: Array<[keyof Transform, number]> = [['lon', 0], ['lat', 1], ['alt', 2], ['yaw', 5]];
  for (const [key, idx] of keys) {
    const v = f[idx];
    if (v !== undefined && v !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) out[key] = n;
    }
  }
  return out;
}

class Acmi {
  refLon = 0;
  refLat = 0;
  readonly objects = new Map<string, Meta>();
  readonly frames: Frame[] = [];

  constructor(path: string) {
    const raw = readFileSync(path);
    if (!isZip(raw)) {
      this.load(raw.toString('utf8'));
      return;
    }
    // Truncated recordings keep the PK magic bytes but aren't unpackable.
    // Without this check, binary garbage would flow into the parser.
    try {
      this.load(readFirstEntry(raw).data.toString('utf8'));
    } catch (err) {
      throw new Error(
        `${path} is not a readable archive (${(err as Error).message}). ` +
          'Tacview probably didn\'t close the recording cleanly.',
      );
    }
  }

  private load(text: string): void {
    const state = new Map<string, Transform>();
    let t = 0;
    let changed = new Map<string, Transform>();
    let removed: string[] = [];
    let started = false;

    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/^﻿/, '');
      if (!line || line.startsWith('//')) continue;

      if (line.startsWith('#')) {
        if (started) this.frames.push({ t, changed, removed });
        const parsed = Number(line.slice(1));
        if (!Number.isFinite(parsed)) continue;
        t = parsed;
        changed = new Map();
        removed = [];
        started = true;
        continue;
      }

      if (line.startsWith('-')) {
        const oid = line.slice(1).trim();
        removed.push(oid);
        state.delete(oid);
        continue;
      }

      const parts = splitFields(line);
      const oid = parts[0]!;
      if (!HEX_ID.test(oid)) continue; // Header lines like FileType= aren't objects

      const props = new Map<string, string>();
      for (const p of parts.slice(1)) {
        const eq = p.indexOf('=');
        if (eq > 0) props.set(p.slice(0, eq).trim(), p.slice(eq + 1));
      }

      if (oid === '0') {
        this.refLon = Number(props.get('ReferenceLongitude') ?? this.refLon);
        this.refLat = Number(props.get('ReferenceLatitude') ?? this.refLat);
        continue;
      }

      const meta: Meta = this.objects.get(oid) ?? {};
      for (const key of ['Name', 'Type', 'Coalition', 'Color', 'Pilot', 'Group'] as const) {
        const v = props.get(key);
        if (v !== undefined) meta[key] = v;
      }
      this.objects.set(oid, meta);

      const tr = props.get('T');
      if (tr !== undefined) {
        const merged = mergeTransform(state.get(oid) ?? {}, tr);
        state.set(oid, merged);
        changed.set(oid, { ...merged });
      }
    }
    if (started) this.frames.push({ t, changed, removed });
  }

  absolute(tr: Transform): [number, number] {
    return [(tr.lat ?? 0) + this.refLat, (tr.lon ?? 0) + this.refLon];
  }

  /**
   * The aircraft with the most position updates.
   *
   * A Pilot field doesn't work as a criterion: Tacview assigns it to ground
   * units and ships too. The highest sample rate, on the other hand,
   * reliably belongs to the object the player is flying.
   */
  pickOwnship(): string | null {
    const counts = new Map<string, number>();
    for (const frame of this.frames) {
      for (const oid of frame.changed.keys()) counts.set(oid, (counts.get(oid) ?? 0) + 1);
    }
    if (counts.size === 0) return null;

    const air = [...counts.keys()].filter((oid) =>
      /FixedWing|Rotorcraft/.test(this.objects.get(oid)?.Type ?? ''),
    );
    const pool = air.length > 0 ? air : [...counts.keys()];
    return pool.reduce((a, b) => ((counts.get(a) ?? 0) >= (counts.get(b) ?? 0) ? a : b));
  }
}

/** DCS: 1 = red, 2 = blue. ACMI carries Color more reliably than Coalition. */
function coalitionId(meta: Meta): number {
  const c = (meta.Color ?? meta.Coalition ?? '').toLowerCase();
  return c.startsWith('red') || c.includes('enem') ? 1 : 2;
}

/**
 * Maps ACMI type tags onto Type.level1, so the server classifies this the
 * same way it would classify data from the hook.
 */
function level1FromTags(tags = ''): number {
  const t = tags.toLowerCase();
  if (/missile|weapon|bomb|shell|rocket|decoy|flare|shrapnel/.test(t)) return 4;
  if (t.includes('watercraft')) return 3;
  if (/fixedwing|rotorcraft/.test(t)) return 1;
  if (/building|static/.test(t)) return 5;
  if (t.includes('ground')) return 2;
  return 0;
}

const isWeapon = (meta: Meta): boolean => level1FromTags(meta.Type) === 4;

const lerpAngle = (a: number, b: number, f: number): number =>
  (a + (((b - a + 180) % 360) - 180) * f + 360) % 360;

/**
 * Yields (t, datagram) in send order.
 *
 * The ownship is interpolated to the target rate, other objects are held
 * until the next frame. This reflects the real asymmetry, instead of
 * faking a uniform sample rate that never actually exists.
 */
function* build(
  acmi: Acmi,
  ownId: string,
  rate: number,
  emitDelete: boolean,
  view: OptionsView,
  schema: Schema,
): Generator<[number, string]> {
  const dt = 1 / rate;
  const ownSamples: Array<[number, number, number, number, number]> = [];
  for (const frame of acmi.frames) {
    const tr = frame.changed.get(ownId);
    if (tr) {
      const [lat, lon] = acmi.absolute(tr);
      ownSamples.push([frame.t, lat, lon, tr.alt ?? 0, tr.yaw ?? 0]);
    }
  }
  if (ownSamples.length === 0) {
    throw new Error('No ownship track found -- set one with --own <id> (--list shows IDs)');
  }

  const ownMeta = acmi.objects.get(ownId) ?? {};
  const live = new Map<string, Transform>();
  const tEnd = acmi.frames.at(-1)?.t ?? 0;
  let fi = 0;
  let si = 0;
  let lastTas = 0;
  let t = ownSamples[0]![0];

  while (t <= tEnd) {
    const lines: string[] = [];

    while (fi < acmi.frames.length && acmi.frames[fi]!.t <= t) {
      const frame = acmi.frames[fi]!;
      for (const [oid, tr] of frame.changed) live.set(oid, tr);
      for (const oid of frame.removed) {
        if (live.delete(oid) && emitDelete && schema === 3) {
          lines.push(removeLine(Number.parseInt(oid, 16) & 0x7fffffff));
        }
      }
      fi++;
    }

    while (si + 1 < ownSamples.length && ownSamples[si + 1]![0] <= t) si++;
    const a = ownSamples[si]!;
    const b = ownSamples[Math.min(si + 1, ownSamples.length - 1)]!;
    const span = b[0] - a[0];
    const f = span === 0 ? 0 : Math.max(0, Math.min(1, (t - a[0]) / span));
    const lat = a[1] + (b[1] - a[1]) * f;
    const lon = a[2] + (b[2] - a[2]) * f;
    const alt = a[3] + (b[3] - a[3]) * f;
    const yaw = lerpAngle(a[4], b[4], f);

    if (span > 0) {
      lastTas =
        Math.hypot((b[1] - a[1]) * 111320, (b[2] - a[2]) * 111320 * Math.cos(toRad(lat))) / span;
    }

    lines.push(
      ownshipLine(
        {
          id: Number.parseInt(ownId, 16) & 0x7fffffff,
          name: ownMeta.Name ?? 'UNKNOWN',
          lat, lon, alt, hdg: toRad(yaw),
          unitName: ownMeta.Pilot ?? 'Player',
          groupName: ownMeta.Group ?? 'Flight',
          coalition: coalitionId(ownMeta),
          tas: lastTas, ralt: Math.max(0, alt), wow: alt > 25 ? 0 : 1,
          aoa: 0, accelY: 1, chaff: 0, flare: 0,
          wind: { x: 0, y: 0, z: 0 }, modelTime: t,
        },
        view,
        schema,
      ),
    );

    for (const [oid, tr] of live) {
      if (oid === ownId) continue;
      const meta = acmi.objects.get(oid) ?? {};
      const [oLat, oLon] = acmi.absolute(tr);
      const nid = Number.parseInt(oid, 16) & 0x7fffffff;
      const common = { id: nid, lat: oLat, lon: oLon, alt: tr.alt ?? 0, hdg: toRad(tr.yaw ?? 0), coalition: coalitionId(meta) };

      lines.push(
        isWeapon(meta)
          ? weaponLine({ ...common, name: meta.Name ?? 'WEAPON' }, schema)
          : unitLine(
              {
                ...common,
                name: meta.Name ?? 'UNKNOWN',
                unitName: meta.Pilot ?? `Unit-${oid}`,
                groupName: meta.Group ?? `Group-${oid}`,
                level1: level1FromTags(meta.Type),
                level2: 0,
              },
              schema,
            ),
      );
    }

    for (const d of toDatagrams(lines, t, view, schema)) yield [t, d];
    t += dt;
  }
}

// --- Flow ----------------------------------------------------------------

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    list: { type: 'boolean', default: false },
    own: { type: 'string' },
    send: { type: 'boolean', default: false },
    stdout: { type: 'boolean', default: false },
    dump: { type: 'string' },
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '50000' },
    rate: { type: 'string', default: '10' },
    'emit-delete': { type: 'boolean', default: false },
    'options-view': { type: 'string', default: 'optview_all' },
    schema: { type: 'string', default: '3' },
  },
});

const path = positionals[0];
if (!path) {
  console.error('usage: acmi-to-telemetry <file.acmi> [--list|--send|--stdout|--dump FILE]');
  process.exit(2);
}

/** Reports expected failures understandably instead of as a stack trace. */
function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

let acmi: Acmi;
try {
  acmi = new Acmi(path);
} catch (err) {
  fail((err as Error).message);
}
console.error(
  `Frames: ${acmi.frames.length}   Objects: ${acmi.objects.size}   ` +
    `Reference: ${acmi.refLat.toFixed(4)} / ${acmi.refLon.toFixed(4)}   ` +
    `Duration: ${(acmi.frames.at(-1)?.t ?? 0).toFixed(1)} s`,
);

if (values.list) {
  for (const [oid, m] of [...acmi.objects].sort(([a], [b]) => a.localeCompare(b))) {
    const affiliation = m.Color ?? m.Coalition ?? '?';
    const pilot = m.Pilot ? `  <- pilot: ${m.Pilot}` : '';
    console.log(`${oid.padEnd(10)} ${(m.Name ?? '?').padEnd(28)} ${(m.Type ?? '?').padEnd(22)} ${affiliation}${pilot}`);
  }
  process.exit(0);
}

const own = values.own ?? acmi.pickOwnship();
if (!own) fail('No object with position data found');
console.error(`Ownship: ${own} (${acmi.objects.get(own)?.Name ?? '?'})`);

const port = Number(values.port);
const host = values.host!;
const schema = Number(values.schema) as Schema;
const sock = values.send ? createSocket('udp4') : null;
const sink = values.dump ? createWriteStream(values.dump) : null;

let t0: number | null = null;
let count = 0;
let verified = false;
const wall = Date.now();

try {
for (const [t, datagram] of build(acmi, own, Number(values.rate), values['emit-delete'], values['options-view'] as OptionsView, schema)) {
  if (t0 === null) t0 = t;

  if (!verified && schema === 3) {
    const { items } = parseDatagram(datagram);
    const bad = items.filter((i) => i?.kind === 'error');
    if (bad.length > 0) {
      throw new Error(`generated datagram is not readable: ${bad.map((e) => (e?.kind === 'error' ? e.reason : '')).join('; ')}`);
    }
    verified = true;
  }

  if (sock) {
    const lag = (t - t0) * 1000 - (Date.now() - wall);
    if (lag > 0) await sleep(lag);
    sock.send(datagram, port, host);
  }
  sink?.write(`${JSON.stringify({ t: Number((t - t0).toFixed(3)), p: datagram })}\n`);
  if (values.stdout) process.stdout.write(datagram.endsWith('\n') ? datagram : `${datagram}\n`);
  count++;
}

} catch (err) {
  fail((err as Error).message);
}

sink?.end();
if (sock) sock.send('close_socket', port, host, () => sock.close());
console.error(`Datagrams: ${count}`);
