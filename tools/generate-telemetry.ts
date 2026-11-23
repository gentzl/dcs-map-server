import { createSocket } from 'node:dgram';
import { createWriteStream, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseDatagram } from '../src/server/protocol.js';
import type { OptionsView } from '../src/shared/types.js';
import { bearingTo, destination, distanceTo, shortestAngle, toRad } from '../src/client/geo.js';
import { type Schema, ownshipLine, toDatagrams, unitLine, weaponLine } from './wire.js';

/**
 * Synthetische DCS-Telemetrie fuer die Entwicklung.
 *
 * Erzeugt protokollkonforme Datagramme und sendet sie an den Server, damit
 * Darstellung und Interpolation ohne laufendes DCS geprueft werden koennen.
 *
 *   node dist/tools/tools/generate-telemetry.js --send
 *   npm run telemetry -- --send --units 20
 *
 * Die Kinematik ist bewusst stetig (begrenzte Dreh- und Steigrate): Eine
 * Sprungspur liesse Dead Reckoning faelschlich gut aussehen.
 */

const G = 9.80665;

/** Kaukasus, Kuestenabschnitt Batumi-Sochi. Realwelt-Naeherungen, nicht aus DCS gelesen. */
const WAYPOINTS: Array<[number, number, number]> = [
  [41.61, 41.6, 20],
  [41.93, 41.86, 2400],
  [42.24, 42.05, 4600],
  [42.18, 42.48, 5800],
  [42.7, 41.7, 6100],
  [42.86, 41.13, 5200],
  [42.3, 40.9, 3800],
  [41.8, 41.2, 2600],
];

/** [Name, level1, Lat, Lon, Koalition, UnitName, GroupName] */
const STATICS: Array<[string, number, number, number, number, string, string]> = [
  ['S-300PS 5P85C LN', 2, 42.845, 41.115, 1, 'SAM-1-1', 'Sukhumi SAM'],
  ['S-300PS 5P85D LN', 2, 42.848, 41.122, 1, 'SAM-1-2', 'Sukhumi SAM'],
  ['SA-11 BUK LN 9A310M1', 2, 42.512, 41.603, 1, 'BUK-1', 'Centre BUK'],
  ['OSA 9A33 LN', 2, 42.205, 42.06, 1, 'OSA-1', 'Senaki AD'],
  ['HAWK LN', 2, 41.615, 41.605, 2, 'HAWK-1', 'Batumi AD'],
  ['PATRIOT LN', 2, 41.625, 41.59, 2, 'PAT-1', 'Batumi AD'],
  ['T-72B', 2, 42.3, 41.9, 1, 'ARM-1', 'Armour-1'],
  ['T-72B', 2, 42.304, 41.906, 1, 'ARM-2', 'Armour-1'],
  ['Frigate', 3, 42.4, 40.8, 1, 'SHIP-1', 'Naval-1'],
  ['CVN-71 Theodore Roosevelt', 3, 42.25, 40.7, 2, 'CVN-71', 'CSG-1'],
  ['TICONDEROGA', 3, 42.27, 40.74, 2, 'CG-1', 'CSG-1'],
  ['Kilo', 3, 42.18, 40.65, 1, 'SSK-1', 'Subsurface-1'],
  ['MiG-29A', 1, 42.6, 41.4, 1, 'MIG-1', 'Bandit-1'],
  ['Ka-50', 1, 42.1, 41.75, 1, 'HELO-1', 'Rotary-1'],
];

class Ownship {
  lat = WAYPOINTS[0]![0];
  lon = WAYPOINTS[0]![1];
  alt = WAYPOINTS[0]![2];
  hdg: number;
  tas = 60;
  accelY = 1;
  chaff = 60;
  flare = 60;
  t = 0;
  private wp = 1;

  /** Standardkurve und begrenzte Steigrate, damit die Spur interpolierbar bleibt. */
  private static readonly MAX_TURN = toRad(3);
  private static readonly MAX_CLIMB = 18;

  constructor(readonly id = 1000) {
    this.hdg = bearingTo(this.lat, this.lon, WAYPOINTS[1]![0], WAYPOINTS[1]![1]);
  }

  step(dt: number): void {
    const [tLat, tLon, tAlt] = WAYPOINTS[this.wp]!;
    if (distanceTo(this.lat, this.lon, tLat, tLon) < 1500) {
      this.wp = (this.wp + 1) % WAYPOINTS.length;
    }

    const want = bearingTo(this.lat, this.lon, tLat, tLon);
    const limit = Ownship.MAX_TURN * dt;
    const turn = Math.max(-limit, Math.min(limit, shortestAngle(this.hdg, want)));
    this.hdg = (this.hdg + turn + 2 * Math.PI) % (2 * Math.PI);

    // Lastvielfaches aus der Kurvenrate: tan(bank) = omega * v / g
    const bank = Math.atan2((turn / dt) * Math.max(this.tas, 1), G);
    this.accelY = 1 / Math.max(Math.cos(bank), 0.2);

    const climb = Ownship.MAX_CLIMB * dt;
    this.alt += Math.max(-climb, Math.min(climb, tAlt - this.alt));
    const targetTas = 90 + this.alt / 30;
    this.tas += Math.max(-4 * dt, Math.min(4 * dt, targetTas - this.tas));

    [this.lat, this.lon] = destination(this.lat, this.lon, this.hdg, this.tas * dt);
    this.t += dt;
    if (this.t % 37 < dt) {
      this.chaff = Math.max(0, this.chaff - 1);
      this.flare = Math.max(0, this.flare - 1);
    }
  }

  get ralt(): number {
    return Math.max(0, this.alt - 15);
  }
  get wow(): number {
    return this.ralt > 10 ? 0 : 1;
  }
  get aoa(): number {
    return Math.max(1.5, 14 - (this.tas - 60) / 18);
  }

  line(view: OptionsView, schema: Schema): string {
    return ownshipLine(
      {
        id: this.id, name: 'FA-18C_hornet', lat: this.lat, lon: this.lon, alt: this.alt,
        hdg: this.hdg, unitName: 'Hornet-1-1', groupName: 'Hornet-1', coalition: 2,
        tas: this.tas, ralt: this.ralt, wow: this.wow, aoa: this.aoa, accelY: this.accelY,
        chaff: this.chaff, flare: this.flare, wind: { x: 3.2, y: 0, z: -1.8 }, modelTime: this.t,
      },
      view,
      schema,
    );
  }
}

/** Bewegte Bodenziele -- stehende allein pruefen das Stale-Handling nicht. */
class Mover {
  constructor(
    readonly id: number,
    public lat: number,
    public lon: number,
    public hdg: number,
    readonly speed: number,
    readonly coalition: number,
    readonly unitName: string,
    readonly groupName: string,
  ) {}

  step(dt: number, rand: () => number): void {
    this.hdg = (this.hdg + toRad((rand() * 3 - 1.5) * dt) + 2 * Math.PI) % (2 * Math.PI);
    [this.lat, this.lon] = destination(this.lat, this.lon, this.hdg, this.speed * dt);
  }

  line(schema: Schema): string {
    return unitLine(
      {
        id: this.id, name: 'M6 LINEBACKER', lat: this.lat, lon: this.lon, alt: 120,
        hdg: this.hdg, unitName: this.unitName, groupName: this.groupName,
        coalition: this.coalition, level1: 2, level2: 0,
      },
      schema,
    );
  }
}

class Missile {
  life = 14;
  constructor(
    readonly id: number,
    public lat: number,
    public lon: number,
    public alt: number,
    readonly hdg: number,
    readonly coalition: number,
  ) {}

  step(dt: number): void {
    [this.lat, this.lon] = destination(this.lat, this.lon, this.hdg, 700 * dt);
    this.alt = Math.max(0, this.alt - 40 * dt);
    this.life -= dt;
  }

  line(schema: Schema): string {
    return weaponLine(
      { id: this.id, name: 'AIM_120C', lat: this.lat, lon: this.lon, alt: this.alt, hdg: this.hdg, coalition: this.coalition },
      schema,
    );
  }
}

/** Reproduzierbarer Zufall, damit Laeufe vergleichbar bleiben. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class World {
  /**
   * Obergrenze an Einheiten je Tick. Sie praegt das Alterungsverhalten, gegen
   * das die Interpolation getestet werden muss: Objekte am Ende eines
   * Durchlaufs sind aelter als die am Anfang.
   */
  private static readonly UNITS_PER_TICK = 30;

  readonly own = new Ownship();
  private movers: Mover[] = [];
  private missiles: Missile[] = [];
  private queue: string[] = [];
  private nextId = 2000;
  private rand: () => number;

  constructor(
    extraUnits: number,
    readonly view: OptionsView,
    seed: number,
    readonly schema: Schema,
  ) {
    this.rand = mulberry32(seed);
    for (let i = 0; i < extraUnits; i++) {
      this.movers.push(
        new Mover(
          this.nextId++,
          41.9 + (this.rand() * 1.2 - 0.3),
          41.6 + (this.rand() * 1.2 - 0.4),
          this.rand() * 2 * Math.PI,
          4 + this.rand() * 10,
          this.rand() < 0.5 ? 1 : 2,
          `Ground-${i}`,
          `Convoy-${Math.floor(i / 4)}`,
        ),
      );
    }
  }

  step(dt: number): void {
    this.own.step(dt);
    for (const m of this.movers) m.step(dt, this.rand);
    for (const w of this.missiles) w.step(dt);
    this.missiles = this.missiles.filter((w) => w.life > 0);
    if (this.rand() < dt * 0.08) {
      this.missiles.push(
        new Missile(this.nextId++, this.own.lat, this.own.lon, this.own.alt, this.own.hdg, 2),
      );
    }
  }

  /** Ownship jeden Tick, Fremdeinheiten rundenweise ueber mehrere Ticks. */
  tickLines(): string[] {
    const out = [this.own.line(this.view, this.schema)];
    if (this.view === 'optview_onlymap' || this.view === 'optview_myaircraft') return out;

    if (this.queue.length === 0) {
      this.queue = [
        ...STATICS.map(([name, level1, lat, lon, coalition, unitName, groupName], i) =>
          unitLine(
            { id: 3000 + i, name, lat, lon, alt: 50, hdg: 0, unitName, groupName, coalition, level1, level2: 0 },
            this.schema,
          ),
        ),
        ...this.movers.map((m) => m.line(this.schema)),
        ...this.missiles.map((w) => w.line(this.schema)),
      ];
    }
    out.push(...this.queue.splice(0, World.UNITS_PER_TICK));
    return out;
  }
}

// --- Selbstprüfung ---------------------------------------------------------

/**
 * Schickt ein Datagramm durch den Parser des Servers. Zwei unabhaengige
 * Implementierungen desselben Formats laufen sonst auseinander, ohne dass es
 * jemandem auffaellt.
 */
function verify(datagram: string): void {
  const { items } = parseDatagram(datagram);
  const errors = items.filter((i) => i?.kind === 'error');
  if (errors.length > 0) {
    const reasons = errors.map((e) => (e?.kind === 'error' ? e.reason : '')).join('; ');
    throw new Error(`erzeugtes Datagramm ist nicht lesbar: ${reasons}`);
  }
  if (items.length === 0) throw new Error('erzeugtes Datagramm enthaelt keine Datensaetze');
}

// --- Ablauf ----------------------------------------------------------------

const { values } = parseArgs({
  options: {
    send: { type: 'boolean', default: false },
    stdout: { type: 'boolean', default: false },
    dump: { type: 'string' },
    replay: { type: 'string' },
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '50000' },
    rate: { type: 'string', default: '10' },
    ticks: { type: 'string', default: '0' },
    units: { type: 'string', default: '24' },
    'options-view': { type: 'string', default: 'optview_allies' },
    seed: { type: 'string', default: '1' },
    schema: { type: 'string', default: '3' },
    fast: { type: 'boolean', default: false },
  },
});

if (!values.send && !values.stdout && !values.dump && !values.replay) {
  console.error('mindestens eines von --send, --stdout, --dump, --replay');
  process.exit(2);
}

const port = Number(values.port);
const host = values.host!;
const rate = Number(values.rate);
const dt = 1 / rate;
const maxTicks = Number(values.ticks);
const schema = Number(values.schema) as Schema;
const view = values['options-view'] as OptionsView;

const sock = values.send || values.replay ? createSocket('udp4') : null;
const sink = values.dump ? createWriteStream(values.dump) : null;

if (values.replay) {
  const lines = readFileSync(values.replay, 'utf8').split('\n').filter(Boolean);
  const start = Date.now();
  for (const line of lines) {
    const rec = JSON.parse(line) as { t: number; p: string };
    const wait = rec.t * 1000 - (Date.now() - start);
    if (wait > 0) await sleep(wait);
    sock!.send(rec.p, port, host);
  }
  sock!.close();
  process.exit(0);
}

const world = new World(Number(values.units), view, Number(values.seed), schema);
let ticks = 0;
let verified = false;
let wall = Date.now();

process.on('SIGINT', () => {
  sock?.send('close_socket', port, host, () => process.exit(0));
});

while (maxTicks === 0 || ticks < maxTicks) {
  world.step(dt);
  const datagrams = toDatagrams(world.tickLines(), ticks * dt, view, schema);

  if (!verified && schema === 3) {
    verify(datagrams[0]!);
    verified = true;
  }

  for (const d of datagrams) {
    sock?.send(d, port, host);
    sink?.write(`${JSON.stringify({ t: Number((ticks * dt).toFixed(3)), p: d })}\n`);
    if (values.stdout) process.stdout.write(`${d.endsWith('\n') ? d : `${d}\n`}`);
  }

  ticks++;
  if (sock && !values.fast) {
    wall += dt * 1000;
    const lag = wall - Date.now();
    if (lag > 0) await sleep(lag);
  }
}

sink?.end();
if (sock) {
  sock.send('close_socket', port, host, () => sock.close());
}
console.error(`${ticks} Ticks (${(ticks * dt).toFixed(1)} s Simulationszeit)`);
