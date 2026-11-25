import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initLogFile, ok, warn } from './cli-log.js';
import { DCS_VARIANTS, savedGamesDir as findSavedGamesDir } from './dcs-paths.js';

/**
 * Copies the DCS export hook into every installed DCS variant's Hooks folder.
 *
 * An existing file is only replaced when it is recognisably an older version
 * of this project's own hook -- by the header line every version has carried
 * ("dcs-map-server -- Export Hook", "Export-Hook" in the earliest) -- and the
 * replaced file is kept next to it as .bak. Anything else at that path is
 * someone else's file and is left alone: guessing wrong would silently break
 * a setup that already works. Without the update, a player re-running
 * start.bat kept the old hook, and with it none of what a newer map needs
 * (mission clock, airbases, zones).
 */

export const HOOK_NAME = 'dcs-map-server.lua';

export { DCS_VARIANTS };

export type HookAction = 'installed' | 'updated' | 'already-current' | 'left-alone' | 'not-found';

const OWN_HOOK_HEADER = /^--\s*dcs-map-server\s*--\s*Export[- ]Hook/m;

/** Whether a file's content is a version of this project's own hook. */
export function isOwnHook(content: string): boolean {
  // Only the head of the file: the marker sits in the opening comment block.
  return OWN_HOOK_HEADER.test(content.split(/\r?\n/).slice(0, 8).join('\n'));
}

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
export function decideHookAction(destExists: boolean, destMatchesSource: boolean, destIsOwnHook = false): HookAction {
  if (!destExists) return 'installed';
  if (destMatchesSource) return 'already-current';
  return destIsOwnHook ? 'updated' : 'left-alone';
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
    const current = destExists ? readFileSync(dest) : null;
    const action = decideHookAction(
      destExists,
      current !== null && current.equals(source),
      current !== null && isOwnHook(current.toString('utf8')),
    );

    if (action === 'installed') {
      mkdirSync(hooksDir, { recursive: true });
      copyFileSync(sourcePath, dest);
    } else if (action === 'updated') {
      // Keep the replaced version, in case it had local edits worth having.
      copyFileSync(dest, `${dest}.bak`);
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
    case 'updated':
      return `${r.variant}: hook updated at ${r.dest} (previous version kept as ${HOOK_NAME}.bak) -- restart DCS to load it`;
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
// realpathSync throws for a path that doesn't exist (a script piped in on
// stdin reports "-"); that simply means "not run directly".
const isMain = (() => {
  try {
    return process.argv[1] !== undefined && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  initLogFile();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '..', '..');
  const source = path.join(root, 'dcs/Scripts/Hooks', HOOK_NAME);
  // Honours a Saved Games folder moved to another drive, not just the default.
  const savedGamesDir = findSavedGamesDir();

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
      if (r.action === 'installed' || r.action === 'updated' || r.action === 'already-current') {
        ok(describe(r));
      } else {
        console.log(describe(r));
      }
    }
  }
}
