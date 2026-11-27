import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, describe } from 'node:test';
import { DEFAULT_UDP_PORT, HOOK_CONFIG_FILE, parseHookConfig, parsePort, readUdpPort } from '../tools/hook-config.js';

function withSavedGames(fn: (dir: string) => void): void {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hook-config-test-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeConfig(savedGames: string, variant: string, text: string): string {
  const file = path.join(savedGames, variant, HOOK_CONFIG_FILE);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

describe('parseHookConfig', () => {
  test('reads key = value lines, ignoring comments, blanks and CRLF', () => {
    const text = '# settings\r\n\r\nudp_port = 50001   # moved, SRS wanted it\r\nother=x\r\n';
    assert.deepEqual(parseHookConfig(text), { udp_port: '50001', other: 'x' });
  });

  test('a commented-out line sets nothing', () => {
    assert.deepEqual(parseHookConfig('# udp_port = 50001\n'), {});
  });
});

describe('parsePort', () => {
  test('accepts whole numbers in range only', () => {
    assert.equal(parsePort('50001'), 50001);
    assert.equal(parsePort('0'), null);
    assert.equal(parsePort('65536'), null);
    assert.equal(parsePort('5000.5'), null);
    assert.equal(parsePort('abc'), null);
    assert.equal(parsePort(''), null);
  });
});

describe('readUdpPort', () => {
  test('without a file it is the default, so a normal install needs nothing', () => {
    withSavedGames((sg) => {
      assert.deepEqual(readUdpPort(sg), { port: DEFAULT_UDP_PORT, file: null, conflicts: [], invalid: [] });
    });
  });

  test('takes the port from the file', () => {
    withSavedGames((sg) => {
      const file = writeConfig(sg, 'DCS', 'udp_port = 50123\n');
      assert.deepEqual(readUdpPort(sg), { port: 50123, file, conflicts: [], invalid: [] });
    });
  });

  test('an invalid value falls back to the default and is reported', () => {
    withSavedGames((sg) => {
      const file = writeConfig(sg, 'DCS', 'udp_port = fifty\n');
      const r = readUdpPort(sg);
      assert.equal(r.port, DEFAULT_UDP_PORT);
      assert.deepEqual(r.invalid, [{ file, value: 'fifty' }]);
    });
  });

  test('variants that disagree are reported, the first one wins', () => {
    withSavedGames((sg) => {
      writeConfig(sg, 'DCS', 'udp_port = 50001\n');
      const beta = writeConfig(sg, 'DCS.openbeta', 'udp_port = 50002\n');
      const r = readUdpPort(sg);
      assert.equal(r.port, 50001);
      assert.deepEqual(r.conflicts, [{ file: beta, port: 50002 }]);
    });
  });
});
