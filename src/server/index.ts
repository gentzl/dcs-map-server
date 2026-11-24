import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, type WebSocket } from 'ws';
import { World } from './world.js';
import { startIngest } from './ingest.js';
import { startRelay } from './relay.js';

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
const certsDir = path.resolve(here, '../../certs');

/**
 * HTTPS as soon as a certificate is present.
 *
 * Not for confidentiality -- that's secondary on a home network -- but
 * because the Screen Wake Lock API requires a secure context. There's none
 * over http://<LAN-IP>, and a tablet whose display turns off mid-flight is
 * useless. Generate a certificate: tools/make-cert.sh
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

app.get('/health', async () => ({
  ok: true,
  ...world.stats,
  lastPacketAgeMs: world.lastPacketAt ? Date.now() - world.lastPacketAt : null,
}));

const server = app.server;
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set<WebSocket>();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify(world.snapshot()));
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
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
console.log(`${scheme.toUpperCase().padEnd(5)} ${scheme}://localhost:${port}`);
for (const addr of lanAddresses()) console.log(`      ${scheme}://${addr}:${port}  (from another device)`);
if (certs) console.log(`HTTP  http://localhost:${HTTP_PORT}  (redirect)`);
else console.log('      no certificate -- Wake Lock stays off, see tools/make-cert.sh');
if (UPSTREAM) console.log(`Relay <- ${UPSTREAM}`);
else console.log(`UDP   ${UDP_HOST}:${UDP_PORT}  (loopback only)`);
console.log(`Tick  ${TICK_HZ} Hz`);
if (process.env.MM_CAPTURE) console.log(`Capture  ${process.env.MM_CAPTURE}`);
