import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DCS_VARIANTS } from './dcs-paths.js';

/**
 * The optional settings file the DCS hook reads:
 * Saved Games\<variant>\Config\dcs-map-server.cfg. Read here as well so the
 * server listens where the hook sends, with one file for a power user to
 * edit and nothing at all for everyone else. The parser mirrors read_port()
 * in dcs/Scripts/Hooks/dcs-map-server.lua -- keep the two in step.
 *
 * Plain JS with no build step, because bootstrap.js needs it before
 * anything has been compiled.
 */

export const HOOK_CONFIG_FILE = path.join('Config', 'dcs-map-server.cfg');
export const DEFAULT_UDP_PORT = 50000;

/** `key = value` lines, `#` comments, values as raw strings -- validation is the caller's. */
export function parseHookConfig(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(\w+)\s*=\s*(.*?)\s*$/.exec(raw.replace(/#.*$/, ''));
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** A port number as the hook accepts it, or null. */
export function parsePort(value) {
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n >= 1 && n <= 65535 ? n : null;
}

/**
 * The UDP port to listen on, from the first DCS variant that sets one.
 * `conflicts` lists variants that set a different port: the hook in each
 * variant reads its own file, but the server can only listen on one.
 */
export function readUdpPort(savedGames) {
  let chosen = null;
  const conflicts = [];
  const invalid = [];
  for (const variant of DCS_VARIANTS) {
    const file = path.join(savedGames, variant, HOOK_CONFIG_FILE);
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const value = parseHookConfig(text).udp_port;
    if (value === undefined) continue;
    const port = parsePort(value);
    if (port === null) {
      invalid.push({ file, value });
    } else if (chosen === null) {
      chosen = { port, file };
    } else if (port !== chosen.port) {
      conflicts.push({ file, port });
    }
  }
  return { port: chosen?.port ?? DEFAULT_UDP_PORT, file: chosen?.file ?? null, conflicts, invalid };
}
