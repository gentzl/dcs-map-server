import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';

/**
 * Which DCS maps the player owns, asked once by bootstrap.js and saved to
 * theaters.json so later runs of start.bat don't ask again. Re-asked only by
 * reconfigure-maps.bat, for when a new map is bought later.
 */

export const THEATERS = [
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

function configPath(root) {
  return path.join(root, 'theaters.json');
}

export function readOwnedTheaters(root) {
  if (!existsSync(configPath(root))) return null;
  try {
    const parsed = JSON.parse(readFileSync(configPath(root), 'utf8'));
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter((t) => THEATERS.includes(t));
    return valid.length > 0 ? valid : null;
  } catch {
    return null;
  }
}

export function saveOwnedTheaters(root, theaters) {
  writeFileSync(configPath(root), `${JSON.stringify(theaters, null, 2)}\n`);
}

/** Asks which maps to fetch tiles for, pre-filled with what's already owned. */
export async function promptTheaters(current = []) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const hint = current.length > 0 ? ` (currently: ${current.join(', ')})` : '';
  const answer = (
    await rl.question(
      `Which DCS maps do you own?${hint}\n` +
        `Available: ${THEATERS.join(', ')}\n` +
        `Comma-separated, e.g. "caucasus,syria" (Enter = caucasus): `,
    )
  ).trim();
  rl.close();

  if (!answer) return current.length > 0 ? current : ['caucasus'];

  const entries = answer
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const valid = [...new Set(entries.filter((t) => THEATERS.includes(t)))];
  const invalid = entries.filter((t) => !THEATERS.includes(t));
  if (invalid.length > 0) console.log(`Unknown map(s) ignored: ${invalid.join(', ')}`);

  return valid.length > 0 ? valid : current.length > 0 ? current : ['caucasus'];
}
