import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { hostname, networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, type WebSocket } from 'ws';
import { World } from './world.js';
import { startIngest } from './ingest.js';
import { startRelay } from './relay.js';
import { resolveVersion } from './version.js';

const HTTP_PORT = Number(process.env.MM_HTTP_PORT ?? 8080);
const HTTPS_PORT = Number(process.env.MM_HTTPS_PORT ?? 8443);
const UDP_PORT = Number(process.env.MM_UDP_PORT ?? 50000);
const UDP_HOST = process.env.MM_UDP_HOST ?? '127.0.0.1';
const TICK_HZ = Number(process.env.MM_TICK_HZ ?? 10);

/** Beyond this send-buffer fill level, a client counts as overloaded. */
const BACKPRESSURE_BYTES = 256 * 1024;

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../../public');
const tilesDir = path.resolve(here, '../../tiles');
/** Airfield frequencies, written locally by tools/extract-navdata.ts at setup. */
const navdataDir = path.resolve(here, '../../navdata');
const certsDir = path.resolve(here, '../../certs');
const VERSION = resolveVersion(path.resolve(here, '../..'));

/**
 * HTTPS as soon as a certificate is present.
 *
 * Not for confidentiality -- that's secondary on a home network -- but
 * because the Screen Wake Lock API requires a secure context. There's none
 * over http://<LAN-IP>, and a tablet whose display turns off mid-flight is
 * useless. Generating a certificate: "HTTPS on a LAN" in docs/DEVELOPERS.md
 */
async function loadCerts(): Promise<{ key: Buffer; cert: Buffer } | null> {
  // Can be turned off: for troubleshooting, and for users who deliberately
  // want to run without TLS on their own network. Wake Lock then stays off.
  if (process.env.MM_TLS === 'off') return null;
  try {
    const [key, cert] = await Promise.all([
      readFile(path.join(certsDir, 'key.pem')),
      readFile(path.join(certsDir, 'cert.pem')),
    ]);
    return { key, cert };
  } catch {
    return null;
  }
}

const certs = await loadCerts();
const world = new World();
// Only one call with an optional https property: two separate Fastify calls
// would produce a union type of the HTTP and HTTPS instance, on which the
// route methods are no longer callable.
const app = Fastify({ logger: false, ...(certs ? { https: certs } : {}) });

await app.register(fastifyStatic, { root: publicDir });

// PMTiles is read via HTTP range requests; @fastify/static serves ranges too.
// Own prefix, since the archive doesn't live in the public directory.
await app.register(fastifyStatic, {
  root: tilesDir,
  prefix: '/tiles/',
  decorateReply: false,
  cacheControl: true,
  maxAge: '7d',
});

/**
 * Which theaters can actually be served.
 *
 * Without this information the client might pick a theater whose archive is
 * missing and silently show an empty map -- a fault users can't diagnose.
 */
app.get('/api/theaters', async () => {
  try {
    const files = await readdir(tilesDir);
    return { theaters: files.filter((f) => f.endsWith('.pmtiles')).map((f) => f.replace(/\.pmtiles$/, '')) };
  } catch {
    return { theaters: [] };
  }
});

/**
 * Airfield radio and navaid data for a theater, read from the local DCS
 * install at setup. An empty list when there is none (no DCS found, theater
 * not installed): the map then shows airfields without frequencies.
 */
app.get<{ Params: { theater: string } }>('/api/navdata/:theater', async (req) => {
  const { theater } = req.params;
  if (!/^[a-z]+$/.test(theater)) return [];
  try {
    return JSON.parse(await readFile(path.join(navdataDir, `${theater}.json`), 'utf8')) as unknown;
  } catch {
    return [];
  }
});

app.get('/api/version', async () => VERSION);

app.get('/health', async () => ({
  ok: true,
  version: VERSION.version,
  ...world.stats,
  lastPacketAgeMs: world.lastPacketAt ? Date.now() - world.lastPacketAt : null,
}));

const server = app.server;
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set<WebSocket>();

// Logged because "the tablet can't connect" is otherwise undiagnosable from
// a report: no line at all means the request never got here (Wi-Fi,
// firewall, wrong address), a line means the network is fine.
wss.on('connection', (ws, req) => {
  clients.add(ws);
  const who = req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? 'unknown';
  console.log(`[clients] ${who} connected (${clients.size} open)`);
  ws.send(JSON.stringify(world.snapshot()));
  const drop = () => {
    if (clients.delete(ws)) console.log(`[clients] ${who} disconnected (${clients.size} open)`);
  };
  ws.on('close', drop);
  ws.on('error', drop);
});

setInterval(() => {
  const delta = world.tick();
  if (!delta || clients.size === 0) return;
  const payload = JSON.stringify(delta);

  for (const ws of clients) {
    if (ws.readyState !== ws.OPEN) continue;
    // Slow clients skip ticks instead of backing up the server. They catch
    // up again at the next snapshot.
    if (ws.bufferedAmount > BACKPRESSURE_BYTES) continue;
    ws.send(payload);
  }
}, 1000 / TICK_HZ);

/**
 * Alternative source: instead of taking the world from the own DCS hook via
 * UDP, mirror it from another running server over WebSocket. For a second
 * instance developing against real data without having to copy every code
 * change onto the DCS machine -- see relay.ts for the reasoning against UDP
 * over the LAN.
 */
const UPSTREAM = process.env.MM_UPSTREAM;

/**
 * Whether the hook is still actually talking, not just whether DCS once
 * sent a packet -- a crashed DCS or an unloaded hook looks silent from here,
 * same as one that never started. Only meaningful for a direct UDP ingest;
 * a relay reports its own status via onStatus above.
 */
let lastPacketAt = 0;
// Far above the hook's 10 Hz send rate on purpose: the hook goes quiet for
// a few seconds in ordinary play -- a paused single-player mission stops
// model time and with it the sends, and so do loading hitches, slot changes
// and respawns. At 3 s each of those printed a scary "not connected".
const HOOK_TIMEOUT_MS = 10_000;

/**
 * Reports the hook's state on change. Started only after the startup block
 * below has printed, so the first status line lands under "Ready" instead of
 * above the addresses, where it read like a startup failure.
 */
function watchHook(): void {
  let hookConnected = false;
  let everConnected = false;
  console.log('\x1b[33m⚠ Hook not connected\x1b[0m -- waiting for DCS (start or join a flight)');
  // What the mission lets through, logged when it changes: "no contacts on
  // the map" is most often the mission's view setting or a server with
  // object export off, and with this a report says which.
  // Reset on every disconnect, so each new flight states it again.
  let reportedVisibility = '';
  setInterval(() => {
    const connected = Date.now() - lastPacketAt < HOOK_TIMEOUT_MS;
    if (connected !== hookConnected) {
      hookConnected = connected;
      if (connected) {
        everConnected = true;
        console.log('\x1b[32m✓ Hook connected\x1b[0m -- receiving data from DCS');
      } else {
        reportedVisibility = '';
        console.log(
          `\x1b[33m⚠ No data from DCS for ${HOOK_TIMEOUT_MS / 1000} s\x1b[0m -- ` +
            (everConnected
              ? 'paused, loading, changing slot, or the flight ended'
              : 'waiting for DCS (start or join a flight)'),
        );
      }
    }
    if (!connected) return;
    const visibility = `view ${world.optionsView}` + (world.objectsBlocked ? ', server blocks object export' : '');
    if (visibility !== reportedVisibility) {
      reportedVisibility = visibility;
      console.log(`[hook] mission: ${visibility}`);
    }
  }, 1000);
}

if (UPSTREAM) {
  startRelay(world, {
    url: UPSTREAM,
    insecure: process.env.MM_UPSTREAM_INSECURE === '1',
    onStatus: (msg) => console.log(`[relay] ${msg}`),
  });
} else {
  startIngest(world, {
    port: UDP_PORT,
    host: UDP_HOST,
    capture: process.env.MM_CAPTURE,
    onError: (reason) => console.warn(`[ingest] dropped: ${reason}`),
    onPacket: () => {
      lastPacketAt = Date.now();
    },
  });
}

const port = certs ? HTTPS_PORT : HTTP_PORT;
await app.listen({ port, host: '0.0.0.0' });

if (certs) {
  // The plaintext port stays up as a redirect, so a bookmarked http address
  // doesn't just fail.
  http
    .createServer((req, res) => {
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      res.writeHead(301, { location: `https://${host}:${HTTPS_PORT}${req.url ?? '/'}` });
      res.end();
    })
    .listen(HTTP_PORT, '0.0.0.0');
}

/** Non-internal IPv4 addresses -- what a phone or tablet on the same Wi-Fi reaches this PC by. */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address);
}

const scheme = certs ? 'https' : 'http';
console.log(`DCS Map Server ${VERSION.version}${VERSION.commit ? ` (${VERSION.commit})` : ''}`);
console.log(`${scheme.toUpperCase().padEnd(5)} ${scheme}://localhost:${port}`);
for (const addr of lanAddresses()) console.log(`      ${scheme}://${addr}:${port}  (from another device)`);
// hostname() can already come back fully-qualified (e.g. a router-assigned
// domain) -- only the first label is a valid plain mDNS name.
const shortHost = hostname().split('.')[0];
console.log(`      ${scheme}://${shortHost}.local:${port}  (same, if your network supports mDNS/Bonjour)`);
if (certs) console.log(`HTTP  http://localhost:${HTTP_PORT}  (redirect)`);
else console.log('      no certificate -- Wake Lock stays off, see "HTTPS on a LAN" in docs/DEVELOPERS.md');
if (UPSTREAM) console.log(`Relay <- ${UPSTREAM}`);
else console.log(`UDP   ${UDP_HOST}:${UDP_PORT}  (loopback only)`);
console.log(`Tick  ${TICK_HZ} Hz`);
if (process.env.MM_CAPTURE) console.log(`Capture  ${process.env.MM_CAPTURE}`);

// A plain status dump above doesn't tell a non-technical user that setup
// actually worked -- this is the one line meant to be read, not just logged.
console.log();
console.log(`\x1b[32m✓ Ready\x1b[0m -- start or join a flight in DCS, then open ${scheme}://localhost:${port}`);
if (!UPSTREAM) watchHook();
