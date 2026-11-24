import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { World } from '../src/server/world.js';
import type { Coalition, Ownship, OptionsView, Unit } from '../src/shared/types.js';
import { allUnits, firstSnapshot } from './fixtures.js';

const T0 = 1_700_000_000_000;

const unit = (id: number, over: Partial<Unit> = {}): Unit => ({
  id,
  kind: 'unit',
  name: 'BMP-1',
  lat: 42,
  lon: 41,
  alt: 100,
  hdg: 1,
  coalition: 1,
  category: 'ground',
  ...over,
});

const ownship = (over: Partial<Ownship> = {}): Ownship => ({
  ...unit(1, { name: 'A-10A', category: 'air', coalition: 2 }),
  modelTime: 0,
  tas: 100,
  ralt: 50,
  wow: 0,
  aoa: 0,
  accelY: 1,
  chaff: 0,
  flare: 0,
  wind: { x: 0, y: 0, z: 0 },
  ...over,
});

/** A world with an ownship of the given coalition under the given view. */
function worldWith(view: OptionsView | string, ownCoalition: Coalition = 2): World {
  const w = new World();
  w.setOwnship(ownship({ coalition: ownCoalition }), view as OptionsView, T0);
  return w;
}

describe('fog of war', () => {
  // Filtering happens here and nowhere else. On the client it would be
  // defeated with the developer tools in seconds, which would turn the
  // project into a cheat tool -- see docs/DEVELOPERS.md, Contributing.
  const cases: Array<[string, string[]]> = [
    ['optview_all', ['friend', 'enemy', 'neutral']],
    ['optview_allies', ['friend']],
    ['optview_onlyallies', ['friend']],
    ['optview_extended', ['friend']],
    ['optview_myaircraft', []],
    ['optview_onlymap', []],
    ['optview_something_new_from_a_dcs_patch', ['friend']],
  ];

  for (const [view, expected] of cases) {
    test(`${view} shows ${expected.length ? expected.join(' + ') : 'nothing'}`, () => {
      const w = worldWith(view);
      w.upsertUnit(unit(10, { coalition: 2, name: 'friend' }), T0);
      w.upsertUnit(unit(11, { coalition: 1, name: 'enemy' }), T0);
      w.upsertUnit(unit(12, { coalition: 0, name: 'neutral' }), T0);

      const names = w.snapshot(T0).units.map((u) => u.name).sort();
      assert.deepEqual(names, [...expected].sort());
    });
  }

  test('an unknown view falls back to allies-only, not to showing everything', () => {
    // The parser casts optionsView through unchecked, so a value DCS invents
    // later arrives here unrecognised. Allies-only is the safe default.
    const w = worldWith('optview_invented_tomorrow');
    w.upsertUnit(unit(11, { coalition: 1 }), T0);
    assert.deepEqual(w.snapshot(T0).units, []);
  });

  test('with no ownship, a restrictive view shows nothing rather than everything', () => {
    const w = new World();
    w.optionsView = 'optview_allies';
    w.upsertUnit(unit(11, { coalition: 1 }), T0);
    assert.deepEqual(w.snapshot(T0).units, []);
  });

  test('deltas are filtered the same way the snapshot is', () => {
    const w = worldWith('optview_allies');
    w.upsertUnit(unit(10, { coalition: 2 }), T0);
    w.upsertUnit(unit(11, { coalition: 1 }), T0);

    const delta = w.tick(T0);
    assert.deepEqual(delta?.units?.map((u) => u.id), [10]);
  });

  test('the ownship is never also emitted as an ordinary contact', () => {
    // LoGetWorldObjects() includes the player's own aircraft; it already has
    // its own marker, so a second one would draw the same aircraft twice.
    const w = worldWith('optview_all');
    w.upsertUnit(unit(1, { coalition: 2, name: 'A-10A' }), T0);
    w.upsertUnit(unit(10, { coalition: 2, name: 'wingman' }), T0);

    assert.deepEqual(w.snapshot(T0).units.map((u) => u.name), ['wingman']);
  });

  for (const fixture of ['real-session-2026-11-23', 'real-session-2026-11-23-multiplayer'] as const) {
    test(`no enemy from ${fixture} leaks through a restrictive view`, () => {
      const snap = firstSnapshot(fixture);
      assert.ok(snap.own, 'fixture has no ownship');
      const own = snap.own;

      for (const view of ['optview_myaircraft', 'optview_onlymap'] as const) {
        const w = new World();
        w.setOwnship(own, view, T0);
        for (const u of allUnits(fixture)) w.upsertUnit(u, T0);
        assert.deepEqual(w.snapshot(T0).units, [], `${view} leaked units`);
      }

      const allies = new World();
      allies.setOwnship(own, 'optview_allies', T0);
      const units = allUnits(fixture);
      for (const u of units) allies.upsertUnit(u, T0);

      const shown = allies.snapshot(T0).units;
      assert.ok(shown.length > 0, 'fixture has no friendly units to show at all');
      assert.ok(shown.length < units.length, 'allies-only showed everything');
      assert.ok(
        shown.every((u) => u.coalition === own.coalition),
        'a unit of another coalition was shown under allies-only',
      );
    });
  }
});

describe('delta building', () => {
  test('a unit that has not moved is not re-sent on the next tick', () => {
    // The hook re-sends every unit round-robin whether it moved or not.
    // Without this, every "delta" would be a full dump.
    const w = worldWith('optview_all');
    w.upsertUnit(unit(10, { coalition: 2 }), T0);
    assert.equal(w.tick(T0)?.units?.length, 1);

    w.upsertUnit(unit(10, { coalition: 2 }), T0 + 1000);
    assert.equal(w.tick(T0 + 1000), null);
  });

  test('a unit that moved is re-sent', () => {
    const w = worldWith('optview_all');
    w.upsertUnit(unit(10, { coalition: 2 }), T0);
    w.tick(T0);

    w.upsertUnit(unit(10, { coalition: 2, lat: 42.5 }), T0 + 100);
    assert.equal(w.tick(T0 + 100)?.units?.length, 1);
  });

  test('a stationary unit is re-sent on the heartbeat so the client stops dimming it', () => {
    const w = worldWith('optview_all');
    w.upsertUnit(unit(10, { coalition: 2 }), T0);
    w.tick(T0);

    w.upsertUnit(unit(10, { coalition: 2 }), T0 + 2000);
    assert.equal(w.tick(T0 + 2000), null, 'resent before the heartbeat was due');

    w.upsertUnit(unit(10, { coalition: 2 }), T0 + 3500);
    assert.equal(w.tick(T0 + 3500)?.units?.length, 1, 'heartbeat did not fire');
  });

  test('a removal reaches the client exactly once', () => {
    const w = worldWith('optview_all');
    w.upsertUnit(unit(10, { coalition: 2 }), T0);
    w.tick(T0);

    w.remove(10);
    assert.deepEqual(w.tick(T0 + 10)?.removed, [10]);
    assert.equal(w.tick(T0 + 20), null);
  });

  test('a unit that stops being reported is dropped and reported as removed', () => {
    const w = worldWith('optview_all');
    w.upsertUnit(unit(10, { coalition: 2 }), T0);
    w.tick(T0);

    // Past DROP_MS without an update.
    const delta = w.tick(T0 + 31_000);
    assert.deepEqual(delta?.removed, [10]);
    assert.equal(w.stats.units, 0);
  });

  test('a unit goes stale out of the snapshot before it is dropped', () => {
    const w = worldWith('optview_all');
    w.upsertUnit(unit(10, { coalition: 2 }), T0);

    assert.equal(w.snapshot(T0 + 4_000).units.length, 1);
    assert.equal(w.snapshot(T0 + 6_000).units.length, 0, 'stale unit still in the snapshot');
    assert.equal(w.stats.units, 1, 'stale unit was dropped too early');
  });

  test('seq advances only when something is actually sent', () => {
    const w = worldWith('optview_all');
    w.tick(T0); // ownship is dirty from setOwnship
    const afterOwn = w.stats.seq;

    assert.equal(w.tick(T0 + 10), null);
    assert.equal(w.stats.seq, afterOwn, 'seq advanced on an empty tick');

    w.upsertUnit(unit(10, { coalition: 2 }), T0 + 20);
    w.tick(T0 + 20);
    assert.equal(w.stats.seq, afterOwn + 1);
  });

  test('clear reports everything it drops as removed', () => {
    const w = worldWith('optview_all');
    w.upsertUnit(unit(10, { coalition: 2 }), T0);
    w.upsertUnit(unit(11, { coalition: 2 }), T0);
    w.tick(T0);

    w.clear();
    assert.deepEqual(w.tick(T0 + 10)?.removed?.sort(), [10, 11]);
    assert.equal(w.stats.hasOwn, false);
  });
});
