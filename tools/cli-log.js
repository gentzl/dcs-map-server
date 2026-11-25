import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Minimal green-checkmark styling plus a mirrored log file, shared by the
 * plain-JS install scripts. No npm dependency: bootstrap.js has to log
 * before `npm install` has even run, so this can only use what Node itself
 * already provides.
 */

const supportsColor = Boolean(process.stdout.isTTY);
const ANSI = /\x1b\[[0-9;]*m/g;

// This file lives directly in tools/, one level below the project root.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logPath = path.join(root, 'setup.log');

function appendToLogFile(line) {
  const stamp = new Date().toISOString().slice(11, 19);
  appendFileSync(logPath, `[${stamp}] ${line.replace(ANSI, '')}\n`);
}

/**
 * Starts (or continues) this run's log file and makes every console.log /
 * console.error in this process also land in it -- so a failed setup can be
 * diagnosed from setup.log without the user having to copy the terminal.
 * Only the two real entry points (bootstrap.js, reconfigure-theaters.js)
 * truncate, since they're where a run begins; every tool invoked as their
 * child process (or run standalone) just appends.
 */
export function initLogFile({ truncate = false } = {}) {
  if (truncate) writeFileSync(logPath, '');
  const realLog = console.log.bind(console);
  const realError = console.error.bind(console);
  console.log = (...args) => {
    realLog(...args);
    appendToLogFile(args.join(' '));
  };
  console.error = (...args) => {
    realError(...args);
    appendToLogFile(args.join(' '));
  };
}

export function ok(msg) {
  console.log(supportsColor ? `\x1b[32m✓\x1b[0m ${msg}` : `✓ ${msg}`);
}

export function warn(msg) {
  console.error(supportsColor ? `\x1b[31m✗\x1b[0m ${msg}` : `✗ ${msg}`);
}
