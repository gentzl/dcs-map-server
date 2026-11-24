import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import type { ServerMessage } from '../src/shared/types.js';

/**
 * Replays a capture-ws.ts recording as a WebSocket source, so the real
 * server can relay it (MM_UPSTREAM) and a browser client sees exactly what
 * was recorded, at the original pacing. Counterpart to capture-ws.ts.
 *
 *   npm run replay-ws -- dcs/test/fixtures/real-session-2026-11-23.jsonl --port 8766
 *   MM_UPSTREAM=ws://127.0.0.1:8766/ws MM_UPSTREAM_INSECURE=1 npm run dev
 */

interface Rec {
  t: number;
  msg: ServerMessage;
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    port: { type: 'string', default: '8766' },
    once: { type: 'boolean', default: false },
  },
});

const path = positionals[0];
if (!path) {
  console.error('usage: replay-ws <file.jsonl> [--port N] [--once]');
  process.exit(2);
}

const records: Rec[] = readFileSync(path, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Rec);

if (records.length === 0) {
  console.error(`${path}: empty recording`);
  process.exit(1);
}

const port = Number(values.port);
const wss = new WebSocketServer({ port, path: '/ws' });
console.error(
  `replay-ws: ${records.length} messages, ${(records.at(-1)!.t / 1000).toFixed(1)}s, ` +
    `serving ws://127.0.0.1:${port}/ws${values.once ? ' (once)' : ' (looping)'}`,
);

wss.on('connection', (ws) => {
  console.error('client connected, replaying...');
  let cancelled = false;
  ws.on('close', () => {
    cancelled = true;
  });

  void (async () => {
    do {
      const start = Date.now();
      for (const rec of records) {
        if (cancelled || ws.readyState !== ws.OPEN) return;
        const wait = rec.t - (Date.now() - start);
        if (wait > 0) await sleep(wait);
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(rec.msg));
      }
    } while (!values.once && !cancelled);
    if (!cancelled) ws.close();
  })();
});
