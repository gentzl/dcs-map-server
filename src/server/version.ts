import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Version scheme: MAJOR.MINOR.BUILD
 *
 * MAJOR.MINOR is set by hand, as a git tag `vMAJOR.MINOR` (e.g. `v0.4319`).
 * BUILD is the number of commits since that tag, so it counts up with every
 * commit on its own and starts again at 0 with the next tag. Nothing is ever
 * committed to bump it.
 *
 * Two sources, because users get the project in two ways:
 * - a git clone: `git describe` answers directly;
 * - GitHub's "Download ZIP": no .git, but GitHub builds the ZIP with
 *   `git archive`, which fills in the `$Format:...$` placeholder in
 *   VERSION_ARCHIVE (see .gitattributes, export-subst) with the same
 *   describe output.
 */
export interface VersionInfo {
  /** e.g. "0.4319.12", "0.4319.12-dirty", or "0.0.0-unknown". */
  version: string;
  /** Abbreviated commit hash, if known. */
  commit: string | null;
}

const UNKNOWN: VersionInfo = { version: '0.0.0-unknown', commit: null };

const TAG_PATTERN = 'v[0-9]*';

/**
 * Parses `git describe --tags` output, e.g. `v0.4319-12-gabc1234` or
 * `v0.4319-12-gabc1234-dirty`. A bare `v0.4319` means build 0: that is what
 * the archive placeholder yields on the tagged commit itself, since
 * `%(describe)` has no --long option. Returns null for anything else,
 * including an unexpanded `$Format:...$` placeholder.
 */
export function parseDescribe(describe: string): VersionInfo | null {
  const m = /^v(\d+)\.(\d+)(?:-(\d+)-g([0-9a-f]+))?(-dirty)?$/.exec(describe.trim());
  if (!m) return null;
  const [, major, minor, build, commit, dirty] = m;
  return { version: `${major}.${minor}.${build ?? 0}${dirty ? '-dirty' : ''}`, commit: commit ?? null };
}

function fromGit(root: string): VersionInfo | null {
  try {
    const out = execFileSync('git', ['describe', '--tags', '--long', '--dirty', '--match', TAG_PATTERN], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    return parseDescribe(out);
  } catch {
    // No git installed, no repository (ZIP download), or no tag yet.
    return null;
  }
}

function fromArchive(root: string): VersionInfo | null {
  try {
    return parseDescribe(readFileSync(path.join(root, 'VERSION_ARCHIVE'), 'utf8'));
  } catch {
    return null;
  }
}

/** Resolves the version of the checkout or unpacked ZIP at `root`. */
export function resolveVersion(root: string): VersionInfo {
  return fromGit(root) ?? fromArchive(root) ?? UNKNOWN;
}
