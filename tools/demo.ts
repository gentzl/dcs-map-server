import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveUserPath } from './user-path.js';

/**
 * One-window demo: replays a recorded session and starts the map server
 * relaying it, so the map shows real traffic without DCS running.
 *
 *   npm run demo
 *   npm run demo -- dcs\test\fixtures\real-session-2026-11-23-multiplayer.jsonl
 *
 * Ctrl+C stops both. If either process exits, the other is stopped too.
 */

// Compiled to dist-tools/tools/, two levels below the project root.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const DEFAULT_RECORDING = path.join('dcs', 'test', 'fixtures', 'real-session-2026-11-23.jsonl');
const asTyped = process.argv[2] ?? DEFAULT_RECORDING;

// Resolved here, and handed on as an absolute path: the replay runs in the
// project root, where a path typed in a subfolder would point elsewhere.
const { found: recording, tried } = resolveUserPath(asTyped, root);
if (!recording) {
  console.error(`demo: recording not found: ${asTyped}\nLooked in:\n${tried.map((t) => `  ${t}`).join('\n')}`);
  process.exit(1);
}

const replayScript = path.join(root, 'dist-tools', 'tools', 'replay-ws.js');
const serverScript = path.join(root, 'dist', 'server', 'index.js');

/** Asks the OS for a free port, so a replay already running elsewhere doesn't collide. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

const children: ChildProcess[] = [];
let stopping = false;

function stopAll(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  process.exitCode = code;
}

const replayPort = await freePort();
const upstream = `ws://127.0.0.1:${replayPort}/ws`;

console.log(`demo: replaying ${recording}`);

const replay = spawn(process.execPath, [replayScript, recording, '--port', String(replayPort), '--quiet', '--demo-extras'], {
  cwd: root,
  stdio: 'inherit',
});
children.push(replay);

const server = spawn(process.execPath, [serverScript], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, MM_UPSTREAM: upstream },
});
children.push(server);

for (const [name, child] of [
  ['replay', replay],
  ['server', server],
] as const) {
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`demo: ${name} stopped (exit code ${code ?? 'none'}), stopping the other one too`);
    }
    stopAll(code ?? 0);
  });
  child.on('error', (err) => {
    console.error(`demo: could not start ${name}: ${err.message}`);
    stopAll(1);
  });
}

process.on('SIGINT', () => stopAll(0));
