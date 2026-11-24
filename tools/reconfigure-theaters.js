import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNpm } from './npm-runtime.js';
import { promptTheaters, readOwnedTheaters, saveOwnedTheaters } from './theater-config.js';

/**
 * Lets a player add (or change) which DCS maps the server fetches tiles for,
 * without redoing the whole first-run setup -- for when a map is bought
 * after start.bat already asked and saved an answer. Run via
 * configure-maps.bat.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  const current = readOwnedTheaters(root) ?? [];
  const theaters = await promptTheaters(current);
  saveOwnedTheaters(root, theaters);

  for (const theater of theaters) {
    if (!existsSync(path.join(root, 'tiles', `${theater}.pmtiles`))) {
      console.log(`Downloading map tiles for ${theater} (one-time, roughly 100-150 MB)...`);
      runNpm(['run', 'fetch-tiles', '--', theater]);
    }
  }

  console.log('\nDone. Double-click start.bat to play.');
}

try {
  await main();
} catch (err) {
  console.error('\nReconfiguration failed:', err.message ?? err);
  process.exitCode = 1;
}
