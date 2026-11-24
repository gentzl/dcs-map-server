import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test, describe } from 'node:test';
import { classify, classifyAcmiTags } from '../src/server/classify.js';
import { threatOf } from '../src/server/threats.js';
import type { Category } from '../src/shared/types.js';

interface BaselineEntry {
  name: string;
  level1: number;
  category: Category;
  threatM?: number;
  threatLabel?: string;
}

/**
 * Every distinct unit name from the recorded sessions, with the category and
 * threat ring the current heuristics produce for it.
 *
 * Classification is name-based because the DCS type sub-levels aren't
 * documented, so it is a heuristic that breaks in both directions: a new
 * pattern silently reclassifies units it was never meant to touch (a
 * substring check for "str" once turned every Stryker into air defence).
 * Regenerate deliberately after a classification change, and read the diff --
 * it is the list of units whose symbol just changed on the map.
 */
const BASELINE: BaselineEntry[] = JSON.parse(
  readFileSync(new URL('../../test/classification-baseline.json', import.meta.url), 'utf8'),
);

describe('classification of real unit names', () => {
  test('the recorded sessions still classify the way the baseline says', () => {
    const drifted = BASELINE.filter(
      (e) => classify({ name: e.name, level1: e.level1 }) !== e.category,
    ).map((e) => `${e.name}: ${e.category} -> ${classify({ name: e.name, level1: e.level1 })}`);

    assert.deepEqual(drifted, [], `classification changed for ${drifted.length} unit name(s)`);
  });

  test('threat rings on those names still match the baseline', () => {
    const drifted: string[] = [];
    for (const e of BASELINE) {
      if (e.category !== 'sam') continue;
      const t = threatOf(e.name);
      const now = t ? `${t.label} ${t.rangeM}` : 'none';
      const was = e.threatM ? `${e.threatLabel} ${e.threatM}` : 'none';
      if (now !== was) drifted.push(`${e.name}: ${was} -> ${now}`);
    }
    assert.deepEqual(drifted, []);
  });

  test('the baseline still covers every category the symbols draw', () => {
    // A category nothing in the baseline exercises is a blind spot.
    const covered = new Set(BASELINE.map((e) => e.category));
    for (const c of ['air', 'helo', 'armor', 'ground', 'sam', 'naval', 'carrier', 'static'] as const) {
      assert.ok(covered.has(c), `no recorded unit classifies as "${c}"`);
    }
  });
});

describe('air defence is told apart from everything else', () => {
  // Only air defence gets a threat ring, so a false positive draws a danger
  // zone that isn't there and a false negative hides one that is.
  const sam = [
    'S-300PS 5P85C ln',
    'SA-11 Buk LN 9A310M1',
    'Osa 9A33 ln',
    '2S6 Tunguska',
    'Patriot ln',
    'ZSU-23-4 Shilka',
    'SA-18 Igla manpad',
  ];
  for (const name of sam) {
    test(`${name} is air defence`, () => {
      assert.equal(classify({ name, level1: 2 }), 'sam');
    });
  }

  // Short radar-role abbreviations used to be matched as plain substrings,
  // which flagged every Stryker variant as air defence.
  const notSam = ['M1126 Stryker ICV', 'M1128 Stryker MGS', 'SAU Akatsia', 'BMP-1', 'Ural-375'];
  for (const name of notSam) {
    test(`${name} is not air defence`, () => {
      assert.notEqual(classify({ name, level1: 2 }), 'sam');
    });
  }
});

describe('classification without a usable type from DCS', () => {
  test('a name that reads as air defence still classifies as such', () => {
    assert.equal(classify({ name: 'S-300PS 5P85C ln' }), 'sam');
  });

  test('a name that reads as a tank still classifies as such', () => {
    assert.equal(classify({ name: 'T-90' }), 'armor');
  });

  test('an unrecognisable name stays unknown rather than being guessed at', () => {
    assert.equal(classify({ name: 'ammo_cargo' }), 'unknown');
  });

  test('a weapon packet is a weapon regardless of its name', () => {
    assert.equal(classify({ name: 'Patriot ln', isWeapon: true }), 'weapon');
  });
});

describe('ACMI tags', () => {
  test('tags take precedence, names only refine them', () => {
    assert.equal(classifyAcmiTags('Air+FixedWing', 'KC-135'), 'tanker');
    assert.equal(classifyAcmiTags('Air+Rotorcraft', 'Mi-24P'), 'helo');
    assert.equal(classifyAcmiTags('Sea+Watercraft+AircraftCarrier', 'CVN_75'), 'carrier');
    assert.equal(classifyAcmiTags('Sea+Watercraft', 'MOLNIYA'), 'naval');
    assert.equal(classifyAcmiTags('Ground+AntiAircraft', 'Patriot ln'), 'sam');
    assert.equal(classifyAcmiTags('Ground+Vehicle', 'T-72B'), 'armor');
    assert.equal(classifyAcmiTags('Weapon+Missile', 'AIM_120'), 'weapon');
    assert.equal(classifyAcmiTags('Misc+Decoy+Flare', 'flare'), 'weapon');
  });

  test('a ground tag without a recognisable name stays plain ground', () => {
    assert.equal(classifyAcmiTags('Ground+Vehicle', 'Hummer'), 'ground');
  });
});
