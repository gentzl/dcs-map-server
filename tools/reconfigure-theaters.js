import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initLogFile, ok, warn } from './cli-log.js';
import { resolveInstallDirs } from './dcs-paths.js';
import { detectOwnedTheaters } from './detect-owned-theaters.js';
import { runNpm } from './npm-runtime.js';
import { promptTheaters, readOwnedTheaters, saveOwnedTheaters } from './theater-config.js';

/**
 * Manual fallback for the rare case bootstrap.js can't detect which maps are
 * owned by itself (no DCS install found and the folder prompt skipped, say). Run via
 * configure-maps.bat.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  initLogFile({ truncate: true });
  console.log(`Logging this run in detail to ${path.join(root, 'setup.log')}`);
  console.log(
    `Node ${process.version}  ${process.platform}/${process.arch}  user ${os.userInfo().username}  ` +
      `home ${os.homedir()}  project ${root}`,
  );

  const detected = detectOwnedTheaters(await resolveInstallDirs(root));
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
  warn(`Reconfiguration failed: ${err.message ?? err}`);
  process.exitCode = 1;
}
