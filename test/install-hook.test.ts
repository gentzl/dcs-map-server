import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, describe } from 'node:test';
import { decideHookAction, installHook, isOwnHook } from '../tools/install-hook.js';

describe('decideHookAction', () => {
  test('installs when nothing is there yet', () => {
    assert.equal(decideHookAction(false, false), 'installed');
  });

  test('leaves a byte-identical file alone, reported as already current', () => {
    assert.equal(decideHookAction(true, true), 'already-current');
  });

  test('never overwrites someone else\'s file', () => {
    assert.equal(decideHookAction(true, false, false), 'left-alone');
  });

  test('updates an older version of this project\'s own hook', () => {
    assert.equal(decideHookAction(true, false, true), 'updated');
  });
});

describe('isOwnHook', () => {
  test('recognises every header this hook has carried', () => {
    const dashes = '-'.repeat(79);
    assert.equal(isOwnHook(`${dashes}\n-- dcs-map-server -- Export Hook\n--\n`), true);
    // The earliest versions, from when the comments were German.
    assert.equal(isOwnHook(`${dashes}\r\n-- dcs-map-server -- Export-Hook\r\n--\r\n`), true);
  });

  test('anything else is not ours -- including our own temporary probes', () => {
    assert.equal(isOwnHook('-- some other tool\nlocal x = 1\n'), false);
    assert.equal(isOwnHook('-- dcs-map-server -- TEMPORARY route probe\n'), false);
  });
});

describe('installHook', () => {
  function withTmpDir(fn: (dir: string) => void): void {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'dcs-hook-test-'));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('installs into every DCS variant actually present, skips the rest', () => {
    withTmpDir((tmp) => {
      const source = path.join(tmp, 'source.lua');
      writeFileSync(source, 'our hook');

      const savedGames = path.join(tmp, 'Saved Games');
      mkdirSync(path.join(savedGames, 'DCS'), { recursive: true });
      mkdirSync(path.join(savedGames, 'DCS.openbeta'), { recursive: true });
      // DCS.openalpha deliberately not created: that variant isn't installed.

      const results = installHook(source, savedGames);
      assert.deepEqual(
        results.map((r) => [r.variant, r.action]),
        [
          ['DCS', 'installed'],
          ['DCS.openbeta', 'installed'],
        ],
      );
      assert.equal(readFileSync(results[0]!.dest, 'utf8'), 'our hook');
      assert.equal(readFileSync(results[1]!.dest, 'utf8'), 'our hook');
    });
  });

  test('replaces an older version of its own hook, keeping it as .bak', () => {
    withTmpDir((tmp) => {
      const source = path.join(tmp, 'source.lua');
      writeFileSync(source, '-- dcs-map-server -- Export Hook\n-- new version\n');

      const savedGames = path.join(tmp, 'Saved Games');
      const hooksDir = path.join(savedGames, 'DCS', 'Scripts', 'Hooks');
      mkdirSync(hooksDir, { recursive: true });
      const dest = path.join(hooksDir, 'dcs-map-server.lua');
      writeFileSync(dest, '-- dcs-map-server -- Export-Hook\n-- old version\n');

      const results = installHook(source, savedGames);
      assert.equal(results[0]!.action, 'updated');
      assert.equal(readFileSync(dest, 'utf8'), '-- dcs-map-server -- Export Hook\n-- new version\n');
      assert.equal(readFileSync(`${dest}.bak`, 'utf8'), '-- dcs-map-server -- Export-Hook\n-- old version\n');
    });
  });

  test('never overwrites someone else\'s file at that path', () => {
    withTmpDir((tmp) => {
      const source = path.join(tmp, 'source.lua');
      writeFileSync(source, 'the new hook content');

      const savedGames = path.join(tmp, 'Saved Games');
      const hooksDir = path.join(savedGames, 'DCS', 'Scripts', 'Hooks');
      mkdirSync(hooksDir, { recursive: true });
      const dest = path.join(hooksDir, 'dcs-map-server.lua');
      writeFileSync(dest, 'someone else\'s existing hook');

      const results = installHook(source, savedGames);
      assert.equal(results[0]!.action, 'left-alone');
      assert.equal(readFileSync(dest, 'utf8'), 'someone else\'s existing hook');
    });
  });

  test('reports an identical existing file as already current, without rewriting it', () => {
    withTmpDir((tmp) => {
      const source = path.join(tmp, 'source.lua');
      writeFileSync(source, 'identical content');

      const savedGames = path.join(tmp, 'Saved Games');
      const hooksDir = path.join(savedGames, 'DCS', 'Scripts', 'Hooks');
      mkdirSync(hooksDir, { recursive: true });
      const dest = path.join(hooksDir, 'dcs-map-server.lua');
      writeFileSync(dest, 'identical content');

      const results = installHook(source, savedGames);
      assert.equal(results[0]!.action, 'already-current');
    });
  });

  test('never invents a Saved Games folder for a DCS variant that was never installed', () => {
    withTmpDir((tmp) => {
      const source = path.join(tmp, 'source.lua');
      writeFileSync(source, 'our hook');
      const savedGames = path.join(tmp, 'Saved Games'); // left empty: no DCS variant at all

      const results = installHook(source, savedGames);
      assert.deepEqual(results, []);
    });
  });
});
