import dgram from 'node:dgram';
import { createWriteStream } from 'node:fs';
import { parseDatagram } from './protocol.js';
import type { World } from './world.js';

export interface IngestOptions {
  port: number;
  /** Bewusst nur Loopback: der LAN-Hop ist WebSocket, nicht UDP. */
  host: string;
  /**
   * Pfad fuer eine Rohaufzeichnung aller eingehenden Datagramme.
   *
   * Zur Fehlersuche: Was der Hook tatsaechlich sendet, laesst sich sonst nicht
   * nachvollziehen -- fehlende Einheiten koennen am Export, an der
   * Missionseinstellung oder am Hook liegen, und das sieht von aussen gleich aus.
   */
  capture?: string;
  onError?: (reason: string) => void;
}

export function startIngest(world: World, opts: IngestOptions): dgram.Socket {
  const sock = dgram.createSocket('udp4');
  let errorBudget = 20; // Fehlerhafte Pakete nur begrenzt melden, sonst flutet das Log.
  const capture = opts.capture ? createWriteStream(opts.capture, { flags: 'a' }) : null;

  sock.on('message', (buf) => {
    capture?.write(`${JSON.stringify({ t: Date.now(), p: buf.toString('utf8') })}\n`);
    const { optionsView, items } = parseDatagram(buf.toString('utf8'));

    // Schema 2 traegt die Sichtbarkeitsregel im Kopf, also auch dann, wenn das
    // Datagramm kein Ownship-Paket enthaelt.
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

  // Ohne eigenen Handler beendet ein Bindefehler den Prozess mit Stacktrace.
  // Der haeufigste Fall ist eine bereits laufende zweite Instanz -- das gehoert
  // verstaendlich gemeldet, nicht als Absturz.
  sock.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[ingest] UDP ${opts.host}:${opts.port} ist belegt -- laeuft bereits eine Instanz?`,
      );
      process.exit(1);
    }
    console.error(`[ingest] Socket-Fehler: ${err.message}`);
    process.exit(1);
  });

  sock.bind(opts.port, opts.host);
  return sock;
}
