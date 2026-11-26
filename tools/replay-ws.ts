import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveUserPath } from './user-path.js';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import type { Route, ServerMessage } from '../src/shared/types.js';

/**
 * Replays a capture-ws.ts recording as a WebSocket source, so the real
 * server can relay it (MM_UPSTREAM) and a browser client sees exactly what
 * was recorded, at the original pacing. Counterpart to capture-ws.ts.
 *
 *   npm run replay-ws -- dcs\test\fixtures\real-session-2026-11-23.jsonl --port 8766
 *
 * then, in a second PowerShell window:
 *
 *   $env:MM_UPSTREAM = "ws://127.0.0.1:8766/ws"
 *   npm run dev
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
    // Used by demo.ts, which starts the server itself, so the "next steps" hint would mislead.
    quiet: { type: 'boolean', default: false },
    // Fills in what the bundled recordings can't show, so the demo has it
    // on screen: a made-up flight plan when there is none, and the human
    // flag on the anonymised players (Player-N), which predate the flag.
    'demo-extras': { type: 'boolean', default: false },
  },
});

const asTyped = positionals[0];
if (!asTyped) {
  console.error('usage: replay-ws <file.jsonl> [--port N] [--once] [--quiet]');
  process.exit(2);
}

// Compiled to dist-tools/tools/, two levels below the project root. A path
// typed in a subfolder is found from there too, see resolveUserPath.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { found: path, tried } = resolveUserPath(asTyped, root);
if (!path) {
  console.error(`replay-ws: recording not found: ${asTyped}\nLooked in:\n${tried.map((t) => `  ${t}`).join('\n')}`);
  process.exit(1);
}

// A byte-order mark is stripped first: Notepad and PowerShell 5.1 write one
// when saving UTF-8, and a recording trimmed or edited that way otherwise
// failed on its very first line. Same for the CR of CRLF line endings.
const records: Rec[] = readFileSync(path, 'utf8')
  .replace(/^﻿/, '')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Rec);

if (records.length === 0) {
  console.error(`${path}: empty recording`);
  process.exit(1);
}

/**
 * A plausible strike route from where the recording starts: out along the
 * initial heading, a dogleg to an IP and target, and back home. Flat-earth
 * offsets are plenty at these distances. The aircraft source with next = 1
 * shows the HUD's WP readout too, which a mission route alone wouldn't.
 */
function demoRoute(lat: number, lon: number, hdg: number): Route {
  const at = (from: [number, number], brg: number, km: number): [number, number] => [
    from[0] + (km * 1000 * Math.cos(brg)) / 111_320,
    from[1] + (km * 1000 * Math.sin(brg)) / (111_320 * Math.cos((from[0] * Math.PI) / 180)),
  ];
  const home: [number, number] = [lat, lon];
  const p1 = at(home, hdg, 35);
  const p2 = at(p1, hdg + 0.6, 30);
  const p3 = at(p2, hdg + 1.4, 18);
  const p4 = at(p3, hdg + 2.6, 40);
  const legs: Array<[[number, number], number, string]> = [
    [home, 0, 'HOME'], [p1, 6100, ''], [p2, 6100, 'IP'], [p3, 4500, 'TGT'], [p4, 7600, ''], [home, 0, 'HOME'],
  ];
  return {
    source: 'aircraft',
    next: 1,
    points: legs.map(([[la, lo], alt, name]) => ({ lat: la, lon: lo, alt, name })),
  };
}

if (values['demo-extras'] && !records.some((r) => r.msg.units?.some((u) => u.human))) {
  let marked = 0;
  for (const r of records) {
    for (const u of r.msg.units ?? []) {
      if (/^Player-\d+$/.test(u.unitName ?? '')) { u.human = true; marked++; }
    }
  }
  if (marked) console.error('replay-ws: no human flags in the recording, marking the Player-N units as players');
}

if (values['demo-extras'] && !records.some((r) => r.msg.route)) {
  const first = records.find((r) => r.msg.own)?.msg.own;
  if (first) {
    const route = demoRoute(first.lat, first.lon, first.hdg);
    // On the first message of every loop: the relay takes a snapshot's
    // route as the whole truth, and a delta's as a change.
    records[0]!.msg = { ...records[0]!.msg, route } as ServerMessage;
    console.error('replay-ws: no flight plan in the recording, adding a demo route');
  }
}

const port = Number(values.port);
const wss = new WebSocketServer({ port, path: '/ws' });
const upstream = `ws://127.0.0.1:${port}/ws`;
const mapUrl = `http://localhost:${process.env.MM_HTTP_PORT ?? '8080'}`;
console.error(
  `replay-ws: ${records.length} messages, ${(records.at(-1)!.t / 1000).toFixed(1)}s, ` +
    `serving ${upstream}${values.once ? ' (once)' : ' (looping)'}`,
);
if (!values.quiet) console.error(
  [
    '',
    'Next: start the map server in a second PowerShell window, in this same folder:',
    '',
    `  cd "${process.cwd()}"`,
    `  $env:MM_UPSTREAM = "${upstream}"`,
    '  npm run dev',
    '',
    `Then open the map:  ${mapUrl}`,
    '',
    'Keep this window open. Ctrl+C stops the replay.',
    '',
  ].join('\n'),
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
