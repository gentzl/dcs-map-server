import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Minimal green-checkmark styling plus a mirrored log file, shared by the
 * compiled tool scripts (install-hook, fetch-tiles, fetch-map-assets). Kept
 * dependency-free, same as its plain-JS counterpart cli-log.js used by the
 * pre-build scripts.
 */

const supportsColor = Boolean(process.stdout.isTTY);
const ANSI = /\x1b\[[0-9;]*m/g;

// Compiled two levels below the project root -- see fetch-tiles.ts's own
// comment on why (tsconfig.tools.json's rootDir keeps tools/ under
// dist-tools/).
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const logPath = path.join(root, 'setup.log');

function appendToLogFile(line: string): void {
  const stamp = new Date().toISOString().slice(11, 19);
  appendFileSync(logPath, `[${stamp}] ${line.replace(ANSI, '')}\n`);
}

/**
 * Makes every console.log / console.error in this process also land in
 * setup.log -- so a failed setup can be diagnosed from the file without the
 * user having to copy the terminal. Never truncates: only the two real
 * entry points (bootstrap.js, reconfigure-theaters.js) do that, since
 * they're where a run begins; these tools are always either their child
 * process or run standalone, so they just append.
 */
export function initLogFile(): void {
  const realLog = console.log.bind(console);
  const realError = console.error.bind(console);
  console.log = (...args: unknown[]) => {
    realLog(...args);
    appendToLogFile(args.join(' '));
  };
  console.error = (...args: unknown[]) => {
    realError(...args);
    appendToLogFile(args.join(' '));
  };
}

export function ok(msg: string): void {
  console.log(supportsColor ? `\x1b[32m✓\x1b[0m ${msg}` : `✓ ${msg}`);
}
