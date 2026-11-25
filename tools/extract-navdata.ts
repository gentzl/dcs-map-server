import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initLogFile, ok } from './cli-log.js';
import { findInstallDirs } from './dcs-paths.js';
import { TERRAIN_FOLDER_NAMES } from './detect-owned-theaters.js';
import { buildAirfields, parseBeacons, parseRadio } from './navdata.js';

/**
 * Reads every installed theater's airfield radio and navaid data from the
 * local DCS install into navdata/<theater>.json, which the server hands to
 * the map.
 *
 * Local only, on purpose: Radio.lua and Beacons.lua are Eagle Dynamics'
 * files. They are read on the player's own machine, the result stays there
 * (navdata/ is git-ignored), and nothing of them is redistributed -- the
 * same arrangement as the map tiles.
 *
 * Never asks for anything: setup runs it after the DCS install was already
 * found (or not). Without an install it reports that and exits cleanly; the
 * map then simply shows airfields without frequencies.
 */

initLogFile();

// Compiled two levels below the project root (dist-tools/tools/).
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const outDir = path.join(root, 'navdata');

const theaterOf = new Map(
  Object.entries(TERRAIN_FOLDER_NAMES as Record<string, string>).map(([theater, folder]) => [folder.toLowerCase(), theater]),
);

const installs = findInstallDirs(root);
if (installs.length === 0) {
  console.log('No DCS install found -- airfields will show without frequencies.');
  process.exit(0);
}

let written = 0;
for (const install of installs) {
  const terrains = path.join(install, 'Mods', 'terrains');
  let folders: string[];
  try {
    folders = readdirSync(terrains);
  } catch {
    continue;
  }
  for (const folder of folders) {
    const theater = theaterOf.get(folder.toLowerCase());
    const radioFile = path.join(terrains, folder, 'Radio.lua');
    const beaconFile = path.join(terrains, folder, 'Beacons.lua');
    if (!theater || !existsSync(radioFile) || !existsSync(beaconFile)) continue;

    const fields = buildAirfields(
      parseRadio(readFileSync(radioFile, 'utf8')),
      parseBeacons(readFileSync(beaconFile, 'utf8')),
    );
    if (fields.length === 0) {
      console.log(`${theater}: no airfields read from ${folder} -- file layout not recognised`);
      continue;
    }
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, `${theater}.json`), `${JSON.stringify(fields, null, 1)}\n`);
    const withCom = fields.filter((f) => Object.keys(f.com).length > 0).length;
    ok(`Airfield frequencies for ${theater}: ${fields.length} airfields (${withCom} with tower frequencies)`);
    written++;
  }
}
if (written === 0) console.log('No theater radio data found in the DCS install.');
