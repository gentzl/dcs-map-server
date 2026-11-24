import dgram from 'node:dgram';
import { createWriteStream } from 'node:fs';
import { parseDatagram } from './protocol.js';
import type { World } from './world.js';

export interface IngestOptions {
  port: number;
  /** Deliberately loopback only: the LAN hop is WebSocket, not UDP. */
  host: string;
  /**
   * Path for a raw recording of every incoming datagram.
   *
   * For troubleshooting: otherwise there's no way to tell what the hook
   * actually sends -- missing units could be caused by the export, the
   * mission setting, or the hook, and all three look the same from outside.
   */
  capture?: string;
  onError?: (reason: string) => void;
}

export function startIngest(world: World, opts: IngestOptions): dgram.Socket {
  const sock = dgram.createSocket('udp4');
  let errorBudget = 20; // Only report a limited number of bad packets, otherwise it floods the log.
  const capture = opts.capture ? createWriteStream(opts.capture, { flags: 'a' }) : null;

  sock.on('message', (buf) => {
    capture?.write(`${JSON.stringify({ t: Date.now(), p: buf.toString('utf8') })}\n`);
    const { optionsView, items } = parseDatagram(buf.toString('utf8'));

    // Schema 2 carries the visibility rule in the header, so also when the
    // datagram contains no ownship packet.
    if (optionsView) world.optionsView = optionsView;

    for (const parsed of items) {
      if (!parsed) continue;
      switch (parsed.kind) {
        case 'own':
          world.setOwnship(parsed.own, parsed.optionsView);
          break;
        case 'unit':
          world.upsertUnit(parsed.unit);
          break;
        case 'remove':
          world.remove(parsed.id);
          break;
        case 'close':
          world.clear();
          break;
        case 'error':
          if (errorBudget-- > 0) opts.onError?.(parsed.reason);
          break;
      }
    }
  });

  // Without a handler of its own, a bind error ends the process with a stack
  // trace. The most common case is a second instance already running --
  // that deserves an understandable message, not a crash.
  sock.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[ingest] UDP ${opts.host}:${opts.port} is already in use -- is another instance running?`,
      );
      process.exit(1);
    }
    console.error(`[ingest] socket error: ${err.message}`);
    process.exit(1);
  });

  sock.bind(opts.port, opts.host);
  return sock;
}
