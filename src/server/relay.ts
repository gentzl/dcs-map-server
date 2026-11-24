import { WebSocket } from 'ws';
import type { ServerMessage } from '../shared/types.js';
import type { World } from './world.js';

/**
 * Feeds the world state from another running server instead of from UDP.
 *
 * Meant for a second instance -- e.g. developing against real DCS data
 * without having to copy every code change onto the DCS machine.
 * Deliberately a WebSocket client to the other server, not a second UDP
 * receiver: the LAN hop stays WebSocket, just like for the browser client.
 * Sending raw UDP over the LAN is the architecture this project deliberately
 * rejected -- lossy, unencrypted, fragmented beyond ~1500 bytes.
 *
 * The received snapshot/delta messages are fed in through World's public
 * API (upsertUnit/setOwnship/remove/clear) -- the same methods the UDP
 * ingest also uses. World itself knows nothing about the source and builds
 * its own deltas for its own clients as usual.
 */

export interface RelayOptions {
  url: string;
  /** Accepts a self-signed certificate from the source server -- common on a LAN. */
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
      opts.onStatus?.(`connected to ${opts.url}`);
    });

    ws.on('message', (data) => {
      try {
        apply(world, JSON.parse(data.toString('utf8')) as ServerMessage);
      } catch {
        // A malformed packet must not tear down the connection.
      }
    });

    const retry = (): void => {
      opts.onStatus?.(`lost connection to ${opts.url}, retrying in ${backoff}ms`);
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 10_000);
    };
    ws.on('close', retry);
    ws.on('error', () => ws.close());
  }

  connect();
}
