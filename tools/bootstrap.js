import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ok } from './cli-log.js';
import { detectOwnedTheaters } from './detect-owned-theaters.js';
import { npmCliPath, npmEnv, runNpm } from './npm-runtime.js';
import { promptTheaters, readOwnedTheaters, saveOwnedTheaters } from './theater-config.js';

/**
 * Runs the whole setup and starts the server, via the portable Node
 * start.bat just bootstrapped. Plain JS, not TypeScript: the very first
 * thing this does is `npm install`, so no compile step (which needs
 * typescript as a devDependency) can be relied on yet.
 */

const BANNER = String.raw`
==============================================================
 ___   ___ ___   __  __   _   ___   ___ ___ _____   _____ ___
|   \ / __/ __| |  \/  | /_\ | _ \ / __| __| _ \ \ / / __| _ \
| |) | (__\__ \ | |\/| |/ _ \|  _/ \__ \ _||   /\ V /| _||   /
|___/ \___|___/ |_|  |_/_/ \_\_|   |___/___|_|_\ \_/ |___|_|_\
        your cockpit position, live, on a real map
==============================================================
`;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

async function main() {
  console.log(BANNER);

  console.log('Installing dependencies (first run only, a couple of minutes)...');
  runNpm(['install']);
  ok('Dependencies installed');

  const cssDest = path.join(root, 'public', 'maplibre-gl.css');
  if (!existsSync(cssDest)) {
    console.log(`Copying MapLibre GL stylesheet to ${cssDest}...`);
    mkdirSync(path.dirname(cssDest), { recursive: true });
    copyFileSync(path.join(root, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl.css'), cssDest);
    ok('Stylesheet copied');
  } else {
    ok('Stylesheet already present');
  }

  console.log('Fetching map labels and symbols...');
  runNpm(['run', 'fetch-assets']);
  ok('Map labels and symbols ready');

  let theaters = detectOwnedTheaters();
  if (theaters) {
    ok(`Maps detected from your DCS installation: ${theaters.join(', ')}`);
  } else {
    console.log('Could not detect installed maps from your DCS installation.');
    theaters = readOwnedTheaters(root) ?? (await promptTheaters());
    saveOwnedTheaters(root, theaters);
    ok(`Will fetch tiles for: ${theaters.join(', ')}`);
  }

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

  console.log('Installing the DCS export hook...');
  runNpm(['run', 'install-hook']);

  console.log('Starting the server...');
  const server = spawn(process.execPath, [npmCliPath(), 'run', 'dev'], {
    stdio: ['inherit', 'pipe', 'pipe'],
    env: npmEnv(),
  });

  // Tees the server's own output to the console and opens the browser at
  // its first printed address, rather than guessing a fixed port.
  let opened = false;
  const urlPattern = /(https?:\/\/localhost:\d+)/;
  const watch = (stream, out) => {
    stream.on('data', (chunk) => {
      out.write(chunk);
      if (opened) return;
      const match = urlPattern.exec(chunk.toString());
      if (match) {
        opened = true;
        execFileSync('cmd', ['/c', 'start', '', match[1]]);
      }
    });
  };
  watch(server.stdout, process.stdout);
  watch(server.stderr, process.stderr);

  await new Promise((resolve) => server.on('exit', resolve));
}

try {
  await main();
} catch (err) {
  console.error('\nSetup failed:', err.message ?? err);
  process.exitCode = 1;
}
