import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import dgram from 'node:dgram';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import WebSocket from 'ws';
import type { ServerMessage } from '../src/shared/types.js';
import { ownshipLine, toDatagrams, unitLine } from '../tools/wire.js';

/**
 * The server end to end: a datagram goes in over UDP, messages come out over
 * the WebSocket.
 *
 * Everything else in this suite tests pure functions. That leaves the one
 * seam that actually ships fog of war to a browser untested -- World can be
 * correct while nothing ever reaches a client, or while optionsView never
 * arrives from the parser. This runs the real server binary.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OWN_ID = 100;
const FRIEND_ID = 200;
const HOSTILE_ID = 300;

/** A port nothing else holds right now. */
async function freePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address() as net.AddressInfo;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

const unit = (id: number, coalition: number, name: string) => ({
  id, name, lat: 43 + id / 1000, lon: 44, alt: 500, hdg: 1,
  unitName: name, groupName: 'G', coalition, level1: 2, level2: 0,
});

const own = {
  id: OWN_ID, name: 'A-10A', lat: 43, lon: 44, alt: 1000, hdg: 1,
  unitName: 'Me', groupName: 'G', coalition: 2,
  tas: 100, ralt: 900, wow: 0, aoa: 0, accelY: 1, chaff: 0, flare: 0,
  wind: { x: 0, y: 0, z: 0 }, modelTime: 1,
};

function datagram(view: 'optview_all' | 'optview_allies'): string {
  const lines = [
    ownshipLine(own, view, 3),
    unitLine(unit(FRIEND_ID, 2, 'Friendly BMP'), 3),
    unitLine(unit(HOSTILE_ID, 1, 'Hostile BMP'), 3),
  ];
  return toDatagrams(lines, own.modelTime, view, 3)[0]!;
}

describe('the server, end to end', { timeout: 30_000 }, () => {
  let child: ChildProcess;
  let httpPort = 0;
  let udpPort = 0;
  const udp = dgram.createSocket('udp4');

  const send = (view: 'optview_all' | 'optview_allies') =>
    new Promise<void>((resolve, reject) => {
      udp.send(datagram(view), udpPort, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
    });

  before(async () => {
    httpPort = await freePort();
    udpPort = await freePort();

    // The compiled server, not the test build: it resolves public/ and
    // tiles/ relative to its own location, and only dist/ sits at the depth
    // those paths assume.
    child = spawn(process.execPath, [path.join(ROOT, 'dist/server/index.js')], {
      cwd: ROOT,
      env: {
        ...process.env,
        MM_TLS: 'off',
        MM_HTTP_PORT: String(httpPort),
        MM_UDP_PORT: String(udpPort),
        MM_TICK_HZ: '20',
      },
      stdio: 'ignore',
    });

    const deadline = Date.now() + 20_000;
    for (;;) {
      if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}`);
      try {
        const r = await fetch(`http://127.0.0.1:${httpPort}/health`);
        if (r.ok) break;
      } catch {
        // Not listening yet.
      }
      if (Date.now() > deadline) throw new Error('server did not come up');
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  after(() => {
    udp.close();
    child?.kill();
  });

  /** Collects everything the server sends to a freshly connected client. */
  async function listen(ms: number, afterOpen?: () => Promise<void>): Promise<ServerMessage[]> {
    const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/ws`);
    const messages: ServerMessage[] = [];
    ws.on('message', (raw) => messages.push(JSON.parse(String(raw)) as ServerMessage));
    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });
    if (afterOpen) await afterOpen();
    await new Promise((r) => setTimeout(r, ms));
    ws.close();
    return messages;
  }

  /** Feeds the server and waits for it to have taken the datagram in. */
  async function settle(view: 'optview_all' | 'optview_allies'): Promise<void> {
    await send(view);
    await new Promise((r) => setTimeout(r, 300));
  }

  const idsIn = (messages: ServerMessage[]): Set<number> => {
    const ids = new Set<number>();
    for (const m of messages) for (const u of m.units ?? []) ids.add(u.id);
    return ids;
  };

  test('a client gets a snapshot the moment it connects', async () => {
    const messages = await listen(300);
    assert.equal(messages[0]?.type, 'snapshot');
  });

  test('a datagram reaches a connected browser', async () => {
    const messages = await listen(800, () => settle('optview_all'));
    const ids = idsIn(messages);

    assert.ok(ids.has(FRIEND_ID), 'the friendly unit never arrived');
    assert.ok(ids.has(HOSTILE_ID), 'the hostile unit never arrived');
    assert.ok(
      messages.some((m) => m.own?.id === OWN_ID),
      'the ownship never arrived',
    );
    assert.ok(
      messages.some((m) => m.optionsView === 'optview_all'),
      'optionsView did not survive the trip',
    );
  });

  // The guarantee the whole project rests on. World pins the rule itself;
  // this pins that the rule is still applied on the way to a client.
  //
  // The rule has to be in force before the client connects: the snapshot
  // goes out the moment it does, and it carries whatever the mission was
  // last reported to allow. That is not a leak -- it is the state at the
  // time -- but it does mean the datagram has to land first.
  test('under allies-only, nothing of the other coalition reaches the client', async () => {
    await settle('optview_allies');
    const messages = await listen(600, () => settle('optview_allies'));
    const ids = idsIn(messages);

    assert.ok(ids.has(FRIEND_ID), 'the friendly unit should still be shown');
    assert.ok(!ids.has(HOSTILE_ID), 'a hostile unit leaked to the client');
  });
});
