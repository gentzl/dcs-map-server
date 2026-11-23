import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { WebSocketServer, type WebSocket } from 'ws';
import { World } from './world.js';
import { startIngest } from './ingest.js';

const HTTP_PORT = Number(process.env.MM_HTTP_PORT ?? 8080);
const HTTPS_PORT = Number(process.env.MM_HTTPS_PORT ?? 8443);
const UDP_PORT = Number(process.env.MM_UDP_PORT ?? 50000);
const UDP_HOST = process.env.MM_UDP_HOST ?? '127.0.0.1';
const TICK_HZ = Number(process.env.MM_TICK_HZ ?? 10);

/** Ab dieser Sendepufferfuellung gilt ein Client als ueberlastet. */
const BACKPRESSURE_BYTES = 256 * 1024;

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '../../public');
const tilesDir = path.resolve(here, '../../tiles');
const certsDir = path.resolve(here, '../../certs');

/**
 * HTTPS, sobald ein Zertifikat vorliegt.
 *
 * Nicht aus Vertraulichkeitsgründen -- im Heimnetz ist das nachrangig --,
 * sondern weil die Screen-Wake-Lock-API einen Secure Context verlangt. Über
 * http://<LAN-IP> gibt es den nicht, und ein Tablet, dessen Display mitten im
 * Flug ausgeht, ist unbrauchbar. Zertifikat erzeugen: tools/make-cert.sh
 */
async function loadCerts(): Promise<{ key: Buffer; cert: Buffer } | null> {
  // Abschaltbar: fuer die Fehlersuche und fuer Nutzer, die im eigenen Netz
  // bewusst ohne TLS fahren wollen. Wake Lock bleibt dann aus.
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
// Nur ein Aufruf mit optionaler https-Eigenschaft: Zwei getrennte
// Fastify-Aufrufe ergaeben einen Union-Typ aus HTTP- und HTTPS-Instanz, auf dem
// die Routen-Methoden nicht mehr aufrufbar sind.
const app = Fastify({ logger: false, ...(certs ? { https: certs } : {}) });

await app.register(fastifyStatic, { root: publicDir });

// PMTiles wird per HTTP-Range gelesen; @fastify/static liefert Ranges mit aus.
// Eigener Prefix, weil das Archiv nicht im Public-Verzeichnis liegt.
await app.register(fastifyStatic, {
  root: tilesDir,
  prefix: '/tiles/',
  decorateReply: false,
  cacheControl: true,
  maxAge: '7d',
});

/**
 * Welche Theater tatsaechlich ausgeliefert werden koennen.
 *
 * Ohne diese Auskunft waehlt der Client ein Theater, dessen Archiv fehlt, und
 * zeigt wortlos eine leere Karte -- der Fehler ist fuer Nutzer nicht erkennbar.
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
    // Langsame Clients ueberspringen Ticks, statt den Server zu stauen. Sie
    // holen beim naechsten Snapshot wieder auf.
    if (ws.bufferedAmount > BACKPRESSURE_BYTES) continue;
    ws.send(payload);
  }
}, 1000 / TICK_HZ);

startIngest(world, {
  port: UDP_PORT,
  host: UDP_HOST,
  onError: (reason) => console.warn(`[ingest] verworfen: ${reason}`),
});

const port = certs ? HTTPS_PORT : HTTP_PORT;
await app.listen({ port, host: '0.0.0.0' });

if (certs) {
  // Der Klartext-Port bleibt als Weiterleitung bestehen, damit eine gemerkte
  // http-Adresse nicht ins Leere läuft.
  http
    .createServer((req, res) => {
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      res.writeHead(301, { location: `https://${host}:${HTTPS_PORT}${req.url ?? '/'}` });
      res.end();
    })
    .listen(HTTP_PORT, '0.0.0.0');
}

const scheme = certs ? 'https' : 'http';
console.log(`${scheme.toUpperCase().padEnd(5)} ${scheme}://localhost:${port}`);
if (certs) console.log(`HTTP  http://localhost:${HTTP_PORT}  (Weiterleitung)`);
else console.log('      kein Zertifikat -- Wake Lock bleibt aus, s. tools/make-cert.sh');
console.log(`UDP   ${UDP_HOST}:${UDP_PORT}  (nur Loopback)`);
console.log(`Tick  ${TICK_HZ} Hz`);
