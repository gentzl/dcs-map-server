import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolves a file path typed on the command line the way the user meant it.
 *
 * `npm run <script>` always runs in the project folder, whichever folder it
 * was typed in -- so a relative path given from a subfolder ("from dcs\,
 * .\test\fixtures\x.jsonl") was looked up from the project root and not
 * found. npm passes the folder the command was typed in as INIT_CWD; that
 * comes first, then the current folder, then the project root (for paths
 * written relative to it, as in the docs).
 *
 * Returns the first candidate that exists, and every candidate tried, for an
 * error message that shows where it looked.
 */
export function resolveUserPath(p: string, root: string): { found: string | null; tried: string[] } {
  const bases = path.isAbsolute(p) ? [''] : [process.env['INIT_CWD'], process.cwd(), root];
  const tried = [...new Set(bases.filter((b): b is string => b !== undefined).map((b) => path.resolve(b, p)))];
  return { found: tried.find((c) => existsSync(c)) ?? null, tried };
}
