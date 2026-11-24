import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

/**
 * Runs the whole setup and starts the server, via the portable Node
 * start.bat just bootstrapped. Plain JS, not TypeScript: the very first
 * thing this does is `npm install`, so no compile step (which needs
 * typescript as a devDependency) can be relied on yet.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

function npmCliPath() {
  const nodeDir = path.dirname(process.execPath);
  const candidate = path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!existsSync(candidate)) throw new Error(`npm not found next to node at ${candidate}`);
  return candidate;
}

function runNpm(args) {
  execFileSync(process.execPath, [npmCliPath(), ...args], { stdio: 'inherit' });
}

const THEATERS = [
  'caucasus',
  'syria',
  'persiangulf',
  'sinai',
  'normandy',
  'marianas',
  'kola',
  'iraq',
  'afghanistan',
];

async function pickTheater() {
  const fromArgs = process.argv[2];
  if (fromArgs) return fromArgs;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (
    await rl.question(`Which DCS theater do you fly? [${THEATERS.join(', ')}] (Enter = caucasus): `)
  ).trim();
  rl.close();
  return answer || 'caucasus';
}

async function main() {
  console.log('Installing dependencies (first run only, a couple of minutes)...');
  runNpm(['install']);

  const cssDest = path.join(root, 'public', 'maplibre-gl.css');
  if (!existsSync(cssDest)) {
    mkdirSync(path.dirname(cssDest), { recursive: true });
    copyFileSync(path.join(root, 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl.css'), cssDest);
  }

  console.log('Fetching map labels and symbols...');
  runNpm(['run', 'fetch-assets']);

  let theater = await pickTheater();
  if (!THEATERS.includes(theater)) {
    console.log(`Unknown theater "${theater}", using caucasus instead.`);
    theater = 'caucasus';
  }

  if (!existsSync(path.join(root, 'tiles', `${theater}.pmtiles`))) {
    console.log(`Downloading map tiles for ${theater} (one-time, roughly 100-150 MB)...`);
    runNpm(['run', 'fetch-tiles', '--', theater]);
  }

  console.log('Installing the DCS export hook...');
  runNpm(['run', 'install-hook']);

  console.log('Starting the server...');
  const server = spawn(process.execPath, [npmCliPath(), 'run', 'dev'], {
    stdio: ['inherit', 'pipe', 'pipe'],
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
