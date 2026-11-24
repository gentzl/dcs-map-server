import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { THEATERS } from './theater-config.js';

/**
 * Reads which DCS maps are installed straight from the game's own records,
 * so bootstrap.js doesn't have to ask -- checked fresh on every run rather
 * than asked once, so a map bought later just shows up on the next start.
 *
 * DCS registers each variant's install path in the registry, and its
 * installer/updater tracks installed terrains in autoupdate.cfg at that
 * path's root, under the same module IDs `DCS_updater.exe install` takes.
 * Neither is officially documented, so every failure mode here -- missing
 * key, missing file, a shape we don't recognise -- falls back to null
 * rather than guessing; the caller then falls back to asking.
 */

// Saved Games subfolder name (install-hook.ts's DCS_VARIANTS) -> registry
// subkey under HKCU\Software\Eagle Dynamics\<name>\Path. OpenAlpha is
// branded "DCS World 2", unlike the other two -- not a typo.
const REGISTRY_VARIANTS = {
  DCS: 'DCS World',
  'DCS.openbeta': 'DCS World OpenBeta',
  'DCS.openalpha': 'DCS World 2 OpenAlpha',
};

// DCS_updater.exe's module ID for each theater this project supports.
const TERRAIN_MODULE_IDS = {
  caucasus: 'CAUCASUS_terrain',
  syria: 'SYRIA_terrain',
  persiangulf: 'PERSIANGULF_terrain',
  sinai: 'SINAIMAP_terrain',
  normandy: 'NORMANDY_terrain',
  marianas: 'MARIANAISLANDS_terrain',
  kola: 'KOLA_terrain',
  iraq: 'IRAQ_terrain',
  afghanistan: 'AFGHANISTAN_terrain',
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

function installedModules(installPath) {
  const cfgPath = path.join(installPath, 'autoupdate.cfg');
  if (!existsSync(cfgPath)) return null;
  try {
    const modules = JSON.parse(readFileSync(cfgPath, 'utf8')).modules;
    return Array.isArray(modules) ? modules : null;
  } catch {
    return null;
  }
}

/**
 * The theaters this player owns, or null if that can't be determined (no
 * DCS install found via the registry, or none of their autoupdate.cfg files
 * could be read) -- null means "fall back to asking", not "owns nothing".
 */
export function detectOwnedTheaters() {
  const paths = installPaths();
  if (paths.length === 0) return null;

  const modules = new Set();
  let readAny = false;
  for (const installPath of paths) {
    const found = installedModules(installPath);
    if (found) {
      readAny = true;
      for (const m of found) modules.add(m);
    }
  }
  if (!readAny) return null;

  const owned = THEATERS.filter((t) => modules.has(TERRAIN_MODULE_IDS[t]));
  if (!owned.includes('caucasus')) owned.unshift('caucasus'); // free for everyone
  return owned;
}
