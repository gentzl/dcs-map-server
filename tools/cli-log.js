/**
 * Minimal green-checkmark styling shared by the plain-JS install scripts.
 * No npm dependency: bootstrap.js has to log before `npm install` has even
 * run, so this can only use what Node itself already provides.
 */

const supportsColor = Boolean(process.stdout.isTTY);

export function ok(msg) {
  console.log(supportsColor ? `\x1b[32m✓\x1b[0m ${msg}` : `✓ ${msg}`);
}
