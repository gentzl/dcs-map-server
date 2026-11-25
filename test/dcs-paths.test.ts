import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, describe } from 'node:test';
import {
  CONFIG_FILE,
  expandEnv,
  findInstallDirs,
  installPathFromLog,
  normalizeTypedPath,
} from '../tools/dcs-paths.js';

function withTmpDir(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'dcs-paths-test-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const logLine = (exe: string) =>
  `2026-11-24 15:16:12.030 INFO    APP (Main): Command line: "${exe}" --restarted\n`;

function writeLog(savedGames: string, variant: string, file: string, text: string): void {
  const dir = path.join(savedGames, variant, 'Logs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, file), text);
}

function fakeInstall(dir: string, bin = 'bin'): void {
  mkdirSync(path.join(dir, bin), { recursive: true });
  writeFileSync(path.join(dir, bin, 'DCS.exe'), '');
}

describe('installPathFromLog', () => {
  test('reads the install root from the Command line entry', () => {
    withTmpDir((sg) => {
      writeLog(sg, 'DCS', 'dcs.log', logLine('D:\\Games\\DCS World\\bin\\DCS.exe'));
      assert.equal(installPathFromLog('DCS', sg), 'D:\\Games\\DCS World');
    });
  });

  test('understands the multithreaded bin-mt build', () => {
    withTmpDir((sg) => {
      writeLog(sg, 'DCS', 'dcs.log', logLine('E:\\DCS\\bin-mt\\DCS.exe'));
      assert.equal(installPathFromLog('DCS', sg), 'E:\\DCS');
    });
  });

  test('falls back to dcs.log.old when dcs.log has no entry', () => {
    withTmpDir((sg) => {
      writeLog(sg, 'DCS', 'dcs.log', 'nothing useful\n');
      writeLog(sg, 'DCS', 'dcs.log.old', logLine('C:\\DCS World\\bin\\DCS.exe'));
      assert.equal(installPathFromLog('DCS', sg), 'C:\\DCS World');
    });
  });

  test('returns null when no log exists', () => {
    withTmpDir((sg) => {
      assert.equal(installPathFromLog('DCS.openbeta', sg), null);
    });
  });
});

describe('findInstallDirs', () => {
  const noRegistry = () => null;

  test('falls back to the registry when there is no log', () => {
    withTmpDir((tmp) => {
      const install = path.join(tmp, 'DCS World');
      fakeInstall(install);
      const fromRegistry = (variant: string) => (variant === 'DCS' ? install : null);
      assert.deepEqual(findInstallDirs(tmp, path.join(tmp, 'Saved Games'), fromRegistry), [install]);
    });
  });

  test('takes the folder from dcs.log when it really contains DCS', () => {
    withTmpDir((tmp) => {
      const install = path.join(tmp, 'Games', 'DCS World');
      fakeInstall(install);
      const sg = path.join(tmp, 'Saved Games');
      writeLog(sg, 'DCS', 'dcs.log', logLine(path.join(install, 'bin', 'DCS.exe')));
      assert.deepEqual(findInstallDirs(tmp, sg, noRegistry), [install]);
    });
  });

  test('ignores a logged folder that no longer contains DCS', () => {
    withTmpDir((tmp) => {
      const sg = path.join(tmp, 'Saved Games');
      writeLog(sg, 'DCS', 'dcs.log', logLine(path.join(tmp, 'gone', 'bin', 'DCS.exe')));
      assert.deepEqual(findInstallDirs(tmp, sg, noRegistry), []);
    });
  });

  test('uses the folder the player typed in earlier', () => {
    withTmpDir((tmp) => {
      const install = path.join(tmp, 'DCS');
      fakeInstall(install, 'bin-mt');
      writeFileSync(path.join(tmp, CONFIG_FILE), JSON.stringify({ installDir: install }));
      assert.deepEqual(findInstallDirs(tmp, path.join(tmp, 'Saved Games'), noRegistry), [install]);
    });
  });

  test('lists a folder found by several sources only once', () => {
    withTmpDir((tmp) => {
      const install = path.join(tmp, 'DCS World');
      fakeInstall(install);
      const sg = path.join(tmp, 'Saved Games');
      writeLog(sg, 'DCS', 'dcs.log', logLine(path.join(install, 'bin', 'DCS.exe')));
      writeLog(sg, 'DCS.openbeta', 'dcs.log', logLine(path.join(install, 'bin', 'DCS.exe')));
      writeFileSync(path.join(tmp, CONFIG_FILE), JSON.stringify({ installDir: install }));
      assert.deepEqual(findInstallDirs(tmp, sg, noRegistry), [install]);
    });
  });
});

describe('normalizeTypedPath', () => {
  test('strips quotes and a trailing bin\\DCS.exe', () => {
    assert.equal(normalizeTypedPath('"D:\\Games\\DCS World\\bin\\DCS.exe"'), path.resolve('D:\\Games\\DCS World'));
  });

  test('empty input means skip', () => {
    assert.equal(normalizeTypedPath('   '), null);
  });
});

describe('expandEnv', () => {
  test('expands %VAR% and leaves unknown ones alone', () => {
    assert.equal(
      expandEnv('%USERPROFILE%\\Saved Games\\%NOPE%', { USERPROFILE: 'C:\\Users\\x' }),
      'C:\\Users\\x\\Saved Games\\%NOPE%',
    );
  });
});
