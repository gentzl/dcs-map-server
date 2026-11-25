import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDescribe } from '../src/server/version.js';

test('commits since the tag become the build number', () => {
  assert.deepEqual(parseDescribe('v0.4319-12-gabc1234\n'), { version: '0.4319.12', commit: 'abc1234' });
});

test('a local checkout with uncommitted changes is marked dirty', () => {
  assert.deepEqual(parseDescribe('v0.4319-12-gabc1234-dirty'), { version: '0.4319.12-dirty', commit: 'abc1234' });
});

test('a bare tag, as the ZIP placeholder yields on the tagged commit, is build 0', () => {
  assert.deepEqual(parseDescribe('v1.2'), { version: '1.2.0', commit: null });
});

test('an unexpanded archive placeholder or a foreign tag is not a version', () => {
  assert.equal(parseDescribe('$Format:%(describe:tags=true,match=v[0-9]*)$'), null);
  assert.equal(parseDescribe('release-3-g1234567'), null);
  assert.equal(parseDescribe(''), null);
});
