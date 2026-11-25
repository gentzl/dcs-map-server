import { execFileSync } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initLogFile, ok } from './cli-log.js';
import { readEntries } from './zip.js';
import { THEATER_BOUNDS } from '../src/shared/theaters.js';

/**
 * Fetches the map tiles for a DCS theater as PMTiles, pulling only the
 * region's bytes via HTTP range requests out of the public Protomaps planet
 * build.
 *
 * Node rather than a shell script: see fetch-map-assets.ts for why. This one
 * also needs the `pmtiles` binary itself, which most Windows users won't
 * have and have no `brew` to get -- ensurePmtiles() below downloads the
 * right one automatically instead of requiring it on PATH.
 *
 * DCS only runs on Windows, so this (like every tool and script here) only
 * needs to run there -- no cross-platform fallback.
 */

initLogFile();

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

// west,south,east,north -- the format `pmtiles extract --bbox` takes.
const BBOX: Record<string, string> = Object.fromEntries(
  Object.entries(THEATER_BOUNDS).map(([t, b]) => [t, b.map((v) => v.toFixed(1)).join(',')]),
);

// Pinned rather than resolved against "latest" at runtime: a moved or
// renamed asset should be a deliberate version bump here, not a silent
// breakage for whoever happens to run this the day go-pmtiles changes its
// release layout.
const PMTILES_VERSION = '1.31.2';

/** Finds a reachable recent planet build -- Protomaps only keeps a rolling window. */
async function findPlanet(): Promise<string> {
  for (let back = 2; back <= 8; back++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - back);
    const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    const url = `https://build.protomaps.com/${stamp}.pmtiles`;
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-16' } });
      if (res.ok) {
        await res.arrayBuffer(); // drain, so the connection can be reused/closed cleanly
        return url;
      }
    } catch {
      // try the next day back
    }
  }
  throw new Error('no reachable planet build found');
}

/** Where go-pmtiles publishes the Windows binary for this arch. */
function releaseAsset(): { url: string } {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const base = `https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}`;
  return { url: `${base}/go-pmtiles_${PMTILES_VERSION}_Windows_${arch}.zip` };
}

/** Downloads and caches the go-pmtiles binary, returning its local path. */
async function ensurePmtiles(): Promise<string> {
  const binName = 'pmtiles.exe';
  const runtimeDir = path.join(root, 'runtime');
  const binPath = path.join(runtimeDir, binName);

  if (
    await stat(binPath)
      .then((s) => s.size > 0)
      .catch(() => false)
  ) {
    return binPath;
  }

  const { url } = releaseAsset();
  console.log(`Downloading pmtiles tool from ${url} to ${binPath}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  const archive = Buffer.from(await res.arrayBuffer());

  const entry = readEntries(archive).find((e) => e.name.toLowerCase().endsWith(binName));
  if (!entry) throw new Error(`${binName} not found inside the downloaded archive`);

  await mkdir(runtimeDir, { recursive: true });
  await writeFile(binPath, entry.data);
  ok(`pmtiles tool ready at ${binPath}`);
  return binPath;
}

const theater = process.argv[2] ?? 'caucasus';
const maxzoom = process.argv[3] ?? '12';
const bbox = BBOX[theater];
if (!bbox) {
  console.error(`unknown theater: ${theater}`);
  console.error(`available: ${Object.keys(BBOX).join(', ')}`);
  process.exit(1);
}

const pmtilesPath = await ensurePmtiles();
const planet = await findPlanet();

await mkdir(path.join(root, 'tiles'), { recursive: true });
const out = path.join(root, 'tiles', `${theater}.pmtiles`);
console.log(`Downloading tiles for ${theater} from ${planet}`);
console.log(`Region:  bbox ${bbox}  maxzoom ${maxzoom}  -> ${out}`);
execFileSync(pmtilesPath, ['extract', planet, out, `--bbox=${bbox}`, `--maxzoom=${maxzoom}`], {
  stdio: 'inherit',
});
const size = (await stat(out)).size;
ok(`${out}  (${(size / 1024 / 1024).toFixed(1)} MB)`);
