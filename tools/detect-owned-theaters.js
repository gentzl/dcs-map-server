import { readdirSync } from 'node:fs';
import path from 'node:path';
import { THEATERS } from './theater-config.js';

/**
 * Reads which DCS maps are installed straight from the game's own files, so
 * bootstrap.js doesn't have to ask -- checked fresh on every run rather than
 * asked once, so a map bought later just shows up on the next start.
 *
 * Every terrain that's actually playable ships a folder under the install's
 * `Mods\terrains\`, named after the map -- the ground truth for what's
 * installed, unlike the installer's own undocumented `autoupdate.cfg`
 * bookkeeping. Finding the install folder itself is dcs-paths.js's job.
 * Folder names aren't officially documented, so anything unreadable or
 * unrecognised falls back to null rather than guessing; the caller then asks.
 */

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

function installedTerrainFolders(installPath) {
  const terrainsDir = path.join(installPath, 'Mods', 'terrains');
  try {
    const names = readdirSync(terrainsDir);
    console.log(`${terrainsDir}: ${names.join(', ')}`);
    return names.map((name) => name.toLowerCase());
  } catch (err) {
    console.log(`${terrainsDir}: could not read (${err.message})`);
    return null;
  }
}

/**
 * The theaters owned across the given install folders, or null if that can't
 * be determined (no folders, or none of their `Mods\terrains` readable) --
 * null means "fall back to asking", not "owns nothing".
 */
export function detectOwnedTheaters(installDirs) {
  const folders = new Set();
  let readAny = false;
  for (const installPath of installDirs) {
    const found = installedTerrainFolders(installPath);
    if (found) {
      readAny = true;
      for (const name of found) folders.add(name);
    }
  }
  if (!readAny) return null;

  const unrecognised = [...folders].filter((f) => !Object.values(TERRAIN_FOLDER_NAMES).includes(f));
  if (unrecognised.length > 0) {
    console.log(
      `Terrain folder(s) found but not recognised by this tool, so not auto-detected: ${unrecognised.join(', ')}`,
    );
  }

  const owned = THEATERS.filter((t) => folders.has(TERRAIN_FOLDER_NAMES[t]));
  if (!owned.includes('caucasus')) owned.unshift('caucasus'); // free for everyone
  console.log(`Detected theaters: ${owned.join(', ')}`);
  return owned;
}
