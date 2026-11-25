import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';

/**
 * Where DCS lives on this machine: its Saved Games folder (hook, dcs.log) and
 * its install folder (Mods\terrains). Shared by bootstrap.js,
 * reconfigure-theaters.js and install-hook.ts. Plain JS with no local imports,
 * so it runs before the first build and compiles cleanly into dist-tools too.
 *
 * Install folder, per DCS variant, first hit wins:
 *   1. dcs.log -- DCS writes its own exe path there on every launch, so it's
 *      current even after Windows was reinstalled with the game drive kept
 *      (which wipes the registry) or the install was moved.
 *   2. Registry -- written once by the ED installer; can be missing or stale.
 * Plus a folder the player typed in once (dcs-install.json), for an install
 * neither source knows about. Every candidate must contain bin\DCS.exe.
 */

/** Saved Games subfolder -> registry subkey under HKCU\Software\Eagle Dynamics. */
const REGISTRY_KEYS = {
  DCS: 'DCS World',
  'DCS.openbeta': 'DCS World OpenBeta',
  'DCS.openalpha': 'DCS World 2 OpenAlpha', // branded "DCS World 2" -- not a typo
};

/** DCS variants, each with its own Saved Games subfolder. */
export const DCS_VARIANTS = Object.keys(REGISTRY_KEYS);

export const CONFIG_FILE = 'dcs-install.json';

// Windows' known-folder id for "Saved Games". Its location lives under User
// Shell Folders only once the user has moved it; absent means the default.
const SAVED_GAMES_ID = '{4C5C32FF-BB9D-43B0-B5B4-2D72E54EAAA4}';
const USER_SHELL_FOLDERS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders';

// DCS logs e.g.  INFO    APP (Main): Command line: "D:\Games\DCS World\bin\DCS.exe" --restarted
const COMMAND_LINE_RE = /Command line:\s*"?(.+?)[\\/]bin(?:-mt)?[\\/]DCS\.exe/i;

function regValue(key, name) {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg', ['query', key, '/v', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`${escaped}\\s+REG_(?:EXPAND_)?SZ\\s+(.+)`).exec(out)?.[1]?.trim() ?? null;
  } catch {
    return null; // key or value not there
  }
}

/** Expands %VAR% the way Windows does for REG_EXPAND_SZ values. */
export function expandEnv(value, env = process.env) {
  return value.replace(/%([^%]+)%/g, (whole, name) => env[name] ?? whole);
}

/** The real Saved Games folder, honouring a move to another drive. */
export function savedGamesDir() {
  const moved = regValue(USER_SHELL_FOLDERS, SAVED_GAMES_ID);
  return moved ? path.resolve(expandEnv(moved)) : path.join(os.homedir(), 'Saved Games');
}

export function isInstallDir(dir) {
  return ['bin', 'bin-mt'].some((bin) => existsSync(path.join(dir, bin, 'DCS.exe')));
}

/** Install folder from the newest "Command line:" entry in a variant's dcs.log(.old). */
export function installPathFromLog(variant, savedGames) {
  for (const file of ['dcs.log', 'dcs.log.old']) {
    let text;
    try {
      text = readFileSync(path.join(savedGames, variant, 'Logs', file), 'utf8');
    } catch {
      continue;
    }
    const found = COMMAND_LINE_RE.exec(text)?.[1]?.trim();
    if (found) return found;
  }
  return null;
}

function installPathFromRegistry(variant) {
  return regValue(`HKCU\\Software\\Eagle Dynamics\\${REGISTRY_KEYS[variant]}`, 'Path');
}

function readSavedInstallDir(root) {
  try {
    return JSON.parse(readFileSync(path.join(root, CONFIG_FILE), 'utf8')).installDir ?? null;
  } catch {
    return null;
  }
}

/**
 * Every DCS install folder that can be found without asking; may be empty.
 * `readRegistry` is swappable so tests don't depend on this machine's registry.
 */
export function findInstallDirs(root, savedGames = savedGamesDir(), readRegistry = installPathFromRegistry) {
  const found = new Map();
  const consider = (dir, source) => {
    if (!dir) return false;
    const resolved = path.resolve(dir);
    if (!isInstallDir(resolved)) {
      console.log(`${source} points to ${resolved}, but there is no bin\\DCS.exe -- ignored`);
      return false;
    }
    if (!found.has(resolved.toLowerCase())) {
      console.log(`Found DCS at ${resolved} (${source})`);
      found.set(resolved.toLowerCase(), resolved);
    }
    return true;
  };

  console.log(`Looking for DCS: dcs.log under ${savedGames}, then the registry`);
  for (const variant of DCS_VARIANTS) {
    if (consider(installPathFromLog(variant, savedGames), `${variant} dcs.log`)) continue;
    if (consider(readRegistry(variant), `${variant} registry`)) continue;
    console.log(`${variant}: no install found`);
  }
  consider(readSavedInstallDir(root), CONFIG_FILE);
  return [...found.values()];
}

/** Turns what the player pasted into an install folder: quotes off, a trailing \bin\DCS.exe off. */
export function normalizeTypedPath(answer) {
  const unquoted = answer.trim().replace(/^"(.*)"$/, '$1');
  return unquoted ? path.resolve(unquoted.replace(/[\\/]bin(?:-mt)?[\\/]DCS\.exe$/i, '')) : null;
}

/** Asks once for the install folder and remembers it; null if skipped. */
export async function promptInstallDir(root) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Line iterator rather than rl.question(): it buffers lines that arrive
  // before the next prompt and ends cleanly when stdin closes, where
  // question() would drop the line or wait forever.
  const lines = rl[Symbol.asyncIterator]();
  try {
    for (;;) {
      process.stdout.write(
        'Where is DCS installed? Paste the folder that contains bin\\DCS.exe\n' +
          '(e.g. D:\\Games\\DCS World), or press Enter to skip: ',
      );
      const next = await lines.next();
      const dir = next.done ? null : normalizeTypedPath(next.value);
      if (!dir) return null;
      if (isInstallDir(dir)) {
        writeFileSync(path.join(root, CONFIG_FILE), `${JSON.stringify({ installDir: dir }, null, 2)}\n`);
        console.log(`Remembered in ${CONFIG_FILE}, so you won't be asked again.`);
        return dir;
      }
      console.log(`No bin\\DCS.exe in ${dir} -- please try again.`);
    }
  } finally {
    rl.close();
  }
}

/** findInstallDirs, and if that comes up empty, ask. */
export async function resolveInstallDirs(root) {
  const dirs = findInstallDirs(root);
  if (dirs.length > 0) return dirs;
  const typed = await promptInstallDir(root);
  return typed ? [typed] : [];
}
