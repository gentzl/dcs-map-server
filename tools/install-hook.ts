import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initLogFile, ok, warn } from './cli-log.js';

/**
 * Copies the DCS export hook into every installed DCS variant's Hooks folder.
 *
 * Must never overwrite a hook file that's already there: it might be an
 * older copy of this project's own hook mid-upgrade, or someone else's hook
 * entirely, and guessing wrong would silently break a setup that already
 * works. The only case this ever writes into an existing file is when it's
 * byte-identical to what would be installed anyway.
 */

export const HOOK_NAME = 'dcs-map-server.lua';

/** DCS variants that write into their own Saved Games subfolder. */
export const DCS_VARIANTS = ['DCS', 'DCS.openbeta', 'DCS.openalpha'];

export type HookAction = 'installed' | 'already-current' | 'left-alone' | 'not-found';

export interface HookResult {
  variant: string;
  action: HookAction;
  dest: string;
}

/**
 * Pure decision: given what's already at the destination, what should
 * happen. Kept separate from the filesystem calls so the one rule that
 * matters -- never clobber someone else's file -- can be tested directly.
 */
export function decideHookAction(destExists: boolean, destMatchesSource: boolean): HookAction {
  if (!destExists) return 'installed';
  return destMatchesSource ? 'already-current' : 'left-alone';
}

/** Installs the hook into every DCS variant found under `savedGamesDir`. */
export function installHook(sourcePath: string, savedGamesDir: string): HookResult[] {
  const source = readFileSync(sourcePath);
  const results: HookResult[] = [];

  for (const variant of DCS_VARIANTS) {
    const dcsDir = path.join(savedGamesDir, variant);
    // Only touch a variant DCS has itself already created -- never invent a
    // Saved Games folder for a DCS install that isn't there.
    if (!existsSync(dcsDir)) continue;

    const hooksDir = path.join(dcsDir, 'Scripts', 'Hooks');
    const dest = path.join(hooksDir, HOOK_NAME);
    const destExists = existsSync(dest);
    const action = decideHookAction(destExists, destExists && readFileSync(dest).equals(source));

    if (action === 'installed') {
      mkdirSync(hooksDir, { recursive: true });
      copyFileSync(sourcePath, dest);
    }
    results.push({ variant, action, dest });
  }

  return results;
}

function describe(r: HookResult): string {
  switch (r.action) {
    case 'installed':
      return `${r.variant}: hook installed to ${r.dest}`;
    case 'already-current':
      return `${r.variant}: hook already up to date at ${r.dest}`;
    case 'left-alone':
      return (
        `${r.variant}: a different file is already at ${r.dest} -- left untouched. ` +
        `If you want this project's hook there instead, copy it yourself.`
      );
    case 'not-found':
      return `${r.variant}: not installed, skipped`;
  }
}

// Only run as a CLI when executed directly, not when imported for its pure
// functions by tests. Compared as resolved native paths, not raw
// `file://${process.argv[1]}` strings: on Windows that comparison can never
// match (backslashes, no `file:///` scheme/encoding), which silently turned
// this whole block into a no-op -- no output, no hook installed, exit 0.
const isMain =
  process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  initLogFile();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '..', '..');
  const source = path.join(root, 'dcs/Scripts/Hooks', HOOK_NAME);
  const savedGamesDir = path.join(os.homedir(), 'Saved Games');

  console.log(`Checking for DCS variants (${DCS_VARIANTS.join(', ')}) under ${savedGamesDir}`);
  const results = installHook(source, savedGamesDir);

  const checked = new Set(results.map((r) => r.variant));
  for (const variant of DCS_VARIANTS) {
    if (!checked.has(variant)) console.log(`${variant}: not installed, skipped`);
  }

  if (results.length === 0) {
    warn(`No DCS installation found under ${savedGamesDir}.`);
    console.log(`Once it's installed, copy ${source} into its Scripts\\Hooks\\ folder yourself.`);
  } else {
    for (const r of results) {
      if (r.action === 'installed' || r.action === 'already-current') {
        ok(describe(r));
      } else {
        console.log(describe(r));
      }
    }
  }
}
