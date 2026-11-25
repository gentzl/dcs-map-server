import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { THEATERS } from './theater-config.js';

/**
 * Reads which DCS maps are installed straight from the game's own files, so
 * bootstrap.js doesn't have to ask -- checked fresh on every run rather than
 * asked once, so a map bought later just shows up on the next start.
 *
 * DCS registers each variant's install path in the registry. Every terrain
 * that's actually playable ships a folder under that path's
 * `Mods\terrains\`, named after the map -- the ground truth for what's
 * installed, unlike the installer's own undocumented `autoupdate.cfg`
 * bookkeeping, which can list a terrain that failed to install or omit one
 * installed by other means. Neither the registry key nor the folder names
 * are officially documented, so every failure mode here -- missing registry
 * key, missing `Mods\terrains`, a name we don't recognise -- falls back to
 * null rather than guessing; the caller then falls back to asking.
 */

// Saved Games subfolder name (install-hook.ts's DCS_VARIANTS) -> registry
// subkey under HKCU\Software\Eagle Dynamics\<name>\Path. OpenAlpha is
// branded "DCS World 2", unlike the other two -- not a typo.
const REGISTRY_VARIANTS = {
  DCS: 'DCS World',
  'DCS.openbeta': 'DCS World OpenBeta',
  'DCS.openalpha': 'DCS World 2 OpenAlpha',
};

// Folder name under Mods\terrains for each theater this project supports,
// matched case-insensitively.
const TERRAIN_FOLDER_NAMES = {
  caucasus: 'caucasus',
  syria: 'syria',
  persiangulf: 'persiangulf',
  sinai: 'sinaimap',
  normandy: 'normandy',
  marianas: 'marianaislands',
  kola: 'kola',
  iraq: 'iraq',
  afghanistan: 'afghanistan',
};

function registryPath(key) {
  try {
    const out = execFileSync('reg', ['query', key, '/v', 'Path'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /Path\s+REG_SZ\s+(.+)/.exec(out)?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function installPaths() {
  return Object.values(REGISTRY_VARIANTS)
    .map((sub) => registryPath(`HKCU\\Software\\Eagle Dynamics\\${sub}`))
    .filter((p) => p !== null);
}

function installedTerrainFolders(installPath) {
  try {
    return readdirSync(path.join(installPath, 'Mods', 'terrains')).map((name) => name.toLowerCase());
  } catch {
    return null;
  }
}

/**
 * The theaters this player owns, or null if that can't be determined (no
 * DCS install found via the registry, or none of their `Mods\terrains`
 * folders could be read) -- null means "fall back to asking", not "owns
 * nothing".
 */
export function detectOwnedTheaters() {
  const paths = installPaths();
  if (paths.length === 0) return null;

  const folders = new Set();
  let readAny = false;
  for (const installPath of paths) {
    const found = installedTerrainFolders(installPath);
    if (found) {
      readAny = true;
      for (const name of found) folders.add(name);
    }
  }
  if (!readAny) return null;

  const owned = THEATERS.filter((t) => folders.has(TERRAIN_FOLDER_NAMES[t]));
  if (!owned.includes('caucasus')) owned.unshift('caucasus'); // free for everyone
  return owned;
}
