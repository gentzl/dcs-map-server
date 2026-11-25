import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initLogFile, ok } from './cli-log.js';
import { detectOwnedTheaters } from './detect-owned-theaters.js';
import { runNpm } from './npm-runtime.js';
import { promptTheaters, readOwnedTheaters, saveOwnedTheaters } from './theater-config.js';

/**
 * Manual fallback for the rare case bootstrap.js can't detect which maps are
 * owned by itself (an install the registry doesn't know about, say). Run via
 * configure-maps.bat.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  initLogFile({ truncate: true });
  console.log(`Logging this run in detail to ${path.join(root, 'setup.log')}`);

  const detected = detectOwnedTheaters();
  let theaters;
  if (detected) {
    ok(`Your DCS installation already reports which maps you own: ${detected.join(', ')}`);
    console.log('start.bat picks this up by itself -- nothing to set here.');
    theaters = detected;
  } else {
    const current = readOwnedTheaters(root) ?? [];
    theaters = await promptTheaters(current);
  }
  saveOwnedTheaters(root, theaters);

  for (const theater of theaters) {
    const tilePath = path.join(root, 'tiles', `${theater}.pmtiles`);
    if (!existsSync(tilePath)) {
      console.log(`Downloading map tiles for ${theater} to ${tilePath} (one-time, roughly 100-150 MB)...`);
      runNpm(['run', 'fetch-tiles', '--', theater]);
      ok(`Tiles ready for ${theater}`);
    } else {
      ok(`Tiles already present for ${theater}`);
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
