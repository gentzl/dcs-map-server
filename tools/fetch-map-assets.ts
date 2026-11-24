import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fetches glyphs and sprites for map labelling into public/.
 *
 * Node rather than a shell script: a Windows user with only PowerShell or
 * cmd.exe has no bash to run the old one in at all -- a double-click just
 * opened "how do you want to open this file" instead of running anything.
 * `node ...` runs identically everywhere, since Node itself is already a
 * prerequisite for the whole project.
 *
 * Everything is kept locally, so no third-party host is needed at runtime.
 * Source: protomaps/basemaps-assets, open and without an access key.
 */

// fileURLToPath, not new URL(...).pathname: on Windows the latter yields
// "/C:/Users/..." -- a leading slash that makes it an invalid path.
//
// Two levels up, not one: tsconfig.tools.json compiles with rootDir "."
// (so tools/*.ts keeps its folder under dist-tools/), meaning this file
// runs from dist-tools/tools/, two directories below the real project
// root rather than one.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const BASE = 'https://protomaps.github.io/basemaps-assets';

/**
 * Unicode blocks that occur on DCS maps. 256 code points per entry.
 *   0-511      Latin
 *   512-767    Latin extended (Turkish diacritics)
 *   768-1023   Combining characters and Greek
 *   1024-1535  Cyrillic, Armenian, Hebrew
 *   1536-2047  Arabic
 *   4096-4351  Georgian   <- needed for the Caucasus
 * Contact symbols don't come from glyphs: Noto Sans doesn't cover the
 * geometric shapes (U+25A0 ff.). They're drawn client-side, see symbols.ts.
 */
const RANGES = ['0-255', '256-511', '512-767', '768-1023', '1024-1279', '1280-1535', '1536-1791', '1792-2047', '4096-4351'];
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];

async function exists(file: string): Promise<boolean> {
  try {
    return (await stat(file)).size > 0;
  } catch {
    return false;
  }
}

async function fetchTo(url: string, dest: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return false;
    await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

for (const font of FONTS) {
  const enc = font.replace(/ /g, '%20');
  const dir = path.join(root, 'public/fonts', font);
  await mkdir(dir, { recursive: true });
  for (const r of RANGES) {
    const out = path.join(dir, `${r}.pbf`);
    if (await exists(out)) continue;
    if (!(await fetchTo(`${BASE}/fonts/${enc}/${r}.pbf`, out))) {
      console.error(`  missing: ${font} ${r}`);
    }
  }
}

const spritesDir = path.join(root, 'public/sprites');
await mkdir(spritesDir, { recursive: true });
for (const f of ['light.json', 'light.png', 'light@2x.json', 'light@2x.png']) {
  const out = path.join(spritesDir, f);
  if (await exists(out)) continue;
  if (!(await fetchTo(`${BASE}/sprites/v4/${f}`, out))) {
    console.error(`  missing: ${f}`);
  }
}

const fontFiles = (await readdir(path.join(root, 'public/fonts'), { recursive: true })).filter((f) =>
  f.endsWith('.pbf'),
);
console.log(`Glyphs: ${fontFiles.length} files`);
