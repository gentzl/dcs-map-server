import { createWriteStream } from 'node:fs';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';

/**
 * Zeichnet den WebSocket-Strom eines laufenden Servers auf.
 *
 * Fuer Testdaten aus einer echten DCS-Sitzung, ohne auf der DCS-Maschine
 * selbst etwas anfassen zu muessen: verbindet sich wie ein Browser-Client an
 * /ws und schreibt jede empfangene Snapshot-/Delta-Nachricht mit relativer
 * Zeit in eine JSONL-Datei. Ergaenzt tools/inspect-capture.ts (das die
 * Rohdatagramme des Hooks auswertet) um die gleichwertige Aufzeichnung auf der
 * Client-Seite des Protokolls.
 *
 *   npm run capture-ws -- wss://itstata:8443/ws --out fixture.jsonl --seconds 90 --insecure
 */

const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'capture.jsonl' },
    seconds: { type: 'string', default: '60' },
    insecure: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

const url = process.argv[2]?.startsWith('-') ? undefined : process.argv[2];
if (!url) {
  console.error('Aufruf: capture-ws <wss://host:port/ws> [--out DATEI] [--seconds N] [--insecure]');
  process.exit(2);
}

const sink = createWriteStream(values.out!);
const ws = new WebSocket(url, { rejectUnauthorized: !values.insecure });
const t0 = Date.now();
let count = 0;

ws.on('open', () => console.error(`verbunden mit ${url}, zeichne ${values.seconds}s auf -> ${values.out}`));
ws.on('message', (data) => {
  sink.write(`${JSON.stringify({ t: Date.now() - t0, msg: JSON.parse(data.toString('utf8')) })}\n`);
  count++;
});
ws.on('error', (err) => console.error(`Fehler: ${err.message}`));

setTimeout(() => {
  ws.close();
  sink.end(() => console.error(`fertig: ${count} Nachrichten in ${values.out}`));
}, Number(values.seconds) * 1000);
