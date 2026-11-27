import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { teeToLog } from './cli-log.js';

/**
 * Shared by bootstrap.js and reconfigure-theaters.js: both drive npm through
 * the portable Node runtime start.bat sets up, before anything else (the
 * compile step, typechecking) can be relied on.
 */

export function npmCliPath() {
  const nodeDir = path.dirname(process.execPath);
  const candidate = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(candidate)) throw new Error(`npm not found next to node at ${candidate}`);
  return candidate;
}

// npm's own lifecycle scripts (e.g. esbuild's install.js) are run in a child
// shell that resolves `node` via PATH, not via our process.execPath -- so the
// portable runtime's node dir has to be on PATH too, or those scripts fail
// with "'node' is not recognized" on machines without a system-wide Node.
export function npmEnv() {
  const nodeDir = path.dirname(process.execPath);
  return { ...process.env, PATH: `${nodeDir}${path.delimiter}${process.env.PATH ?? ''}` };
}

export function runNpm(args) {
  execFileSync(process.execPath, [npmCliPath(), ...args], { stdio: 'inherit', env: npmEnv() });
}

/**
 * runNpm, but with npm's own output also in setup.log. Only for commands
 * that don't log there themselves -- `npm install` above all, whose error
 * (no network, a locked file, a virus scanner) is otherwise only in a
 * terminal window the player has usually closed by the time they report it.
 * The compiled tools log on their own, and teeing them too would write
 * every line twice.
 */
export function runNpmLogged(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCliPath(), ...args], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: npmEnv(),
    });
    teeToLog(child.stdout, process.stdout);
    teeToLog(child.stderr, process.stderr);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(' ')} exited with code ${code}`));
    });
  });
}
