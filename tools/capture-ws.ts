import { createWriteStream } from 'node:fs';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';

/**
 * Records the WebSocket stream of a running server.
 *
 * For test data from a real DCS session, without having to touch anything
 * on the DCS machine itself: connects like a browser client to /ws and
 * writes every received snapshot/delta message with relative time into a
 * JSONL file. Complements tools/inspect-capture.ts (which analyses the
 * hook's raw datagrams) with the equivalent recording on the client side of
 * the protocol.
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
  console.error('usage: capture-ws <wss://host:port/ws> [--out FILE] [--seconds N] [--insecure]');
  process.exit(2);
}

const sink = createWriteStream(values.out!);
const ws = new WebSocket(url, { rejectUnauthorized: !values.insecure });
const t0 = Date.now();
let count = 0;

ws.on('open', () => console.error(`connected to ${url}, recording ${values.seconds}s -> ${values.out}`));
ws.on('message', (data) => {
  sink.write(`${JSON.stringify({ t: Date.now() - t0, msg: JSON.parse(data.toString('utf8')) })}\n`);
  count++;
});
ws.on('error', (err) => console.error(`error: ${err.message}`));

setTimeout(() => {
  ws.close();
  sink.end(() => console.error(`done: ${count} messages in ${values.out}`));
}, Number(values.seconds) * 1000);
