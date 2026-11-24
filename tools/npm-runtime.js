import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

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
