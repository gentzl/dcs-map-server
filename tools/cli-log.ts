/**
 * Minimal green-checkmark styling shared by the compiled tool scripts
 * (install-hook, fetch-tiles, fetch-map-assets). Kept dependency-free, same
 * as its plain-JS counterpart cli-log.js used by the pre-build scripts.
 */

const supportsColor = Boolean(process.stdout.isTTY);

export function ok(msg: string): void {
  console.log(supportsColor ? `\x1b[32m✓\x1b[0m ${msg}` : `✓ ${msg}`);
}
