import { WebSocket } from 'ws';
import type { ServerMessage } from '../shared/types.js';
import type { World } from './world.js';

/**
 * Speist den Weltzustand aus einem anderen laufenden Server statt aus UDP.
 *
 * Gedacht fuer eine zweite Instanz -- etwa zum Entwickeln gegen echte DCS-Daten,
 * ohne jeden Codestand auf den DCS-Rechner kopieren zu muessen. Bewusst als
 * WebSocket-Client zum fremden Server, nicht als zweiter UDP-Empfaenger: Der
 * LAN-Hop bleibt WebSocket, genau wie beim Browser-Client. Rohes UDP uebers LAN
 * zu schicken ist die Architektur, die dieses Projekt bewusst verworfen hat --
 * verlustbehaftet, unverschluesselt, ab ~1500 Byte fragmentiert.
 *
 * Die empfangenen Snapshot-/Delta-Nachrichten werden ueber die oeffentliche
 * World-API eingespielt (upsertUnit/setOwnship/remove/clear) -- dieselben
 * Methoden, die auch der UDP-Ingest nutzt. World selbst weiss nichts von der
 * Quelle und bildet daraus wie gewohnt eigene Deltas fuer die eigenen Clients.
 */

export interface RelayOptions {
  url: string;
  /** Akzeptiert ein selbstsigniertes Zertifikat des Quellservers -- im LAN ueblich. */
  insecure?: boolean;
  onStatus?: (msg: string) => void;
}

function apply(world: World, msg: ServerMessage): void {
  if (msg.type === 'snapshot') {
    world.clear();
    for (const u of msg.units) world.upsertUnit(u);
  } else {
    for (const u of msg.units ?? []) world.upsertUnit(u);
    for (const id of msg.removed ?? []) world.remove(id);
  }
  if (msg.own) world.setOwnship(msg.own, msg.optionsView);
  else world.optionsView = msg.optionsView;
}

export function startRelay(world: World, opts: RelayOptions): void {
  let backoff = 500;

  function connect(): void {
    const ws = new WebSocket(opts.url, { rejectUnauthorized: !opts.insecure });

    ws.on('open', () => {
      backoff = 500;
      opts.onStatus?.(`verbunden mit ${opts.url}`);
    });

    ws.on('message', (data) => {
      try {
        apply(world, JSON.parse(data.toString('utf8')) as ServerMessage);
      } catch {
        // Ein verformtes Paket darf die Verbindung nicht abreissen lassen.
      }
    });

    const retry = (): void => {
      opts.onStatus?.(`Verbindung zu ${opts.url} verloren, erneuter Versuch in ${backoff}ms`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 10_000);
    };
    ws.on('close', retry);
    ws.on('error', () => ws.close());
  }

  connect();
}
