import type { Airbase, Delta, OptionsView, Ownship, Snapshot, Unit, Zone } from '../shared/types.js';

/** Without an update, an object counts as stale or gone. */
const STALE_MS = 5_000;
const DROP_MS = 30_000;
// Keeps stationary targets under the client's "stale" threshold (5s) even if
// they never go dirty -- otherwise the client permanently dims SAM sites,
// buildings and parked vehicles after a short while, even though their
// position is still current.
const HEARTBEAT_MS = 3_000;

interface Tracked {
  unit: Unit;
  lastSeen: number;
  lastSent: number;
  dirty: boolean;
}

/**
 * Holds world state and builds a delta per tick.
 *
 * Incoming UDP packets are only collected here; sending to clients runs on
 * its own, fixed cadence. That decouples client load from the DCS framerate,
 * and is what makes delta-building possible in the first place.
 */
export class World {
  private units = new Map<number, Tracked>();
  private own: Ownship | null = null;
  private ownDirty = false;
  private seq = 0;

  optionsView: OptionsView = 'optview_all';
  /** The server has object export switched off: no other units will ever arrive. */
  objectsBlocked = false;
  lastPacketAt = 0;

  upsertUnit(unit: Unit, now = Date.now()): void {
    const prev = this.units.get(unit.id);

    // The hook re-sends other units round-robin even when they haven't
    // moved. Without this comparison every "delta" would be a full dump --
    // for stationary targets (SAM sites, parked aircraft) almost all of the
    // load for zero information gain.
    const moved =
      !prev ||
      Math.abs(prev.unit.lat - unit.lat) > 1e-6 ||
      Math.abs(prev.unit.lon - unit.lon) > 1e-6 ||
      Math.abs(prev.unit.alt - unit.alt) > 0.5 ||
      Math.abs(prev.unit.hdg - unit.hdg) > 1e-4;

    // lastSeen is always advanced: the object has been seen, even if it
    // hasn't moved.
    this.units.set(unit.id, {
      unit,
      lastSeen: now,
      lastSent: prev?.lastSent ?? 0,
      dirty: moved || (prev?.dirty ?? false),
    });
  }

  /**
   * Airbases live apart from units: a map feature every player sees on F10,
   * so no fog of war; and they don't go stale -- the hook re-sends the list
   * only once a minute, and an airfield doesn't vanish between two lists.
   * Only a real change (or a new base) is passed on.
   */
  private airbases = new Map<number, Airbase>();
  private airbasesDirty = new Set<number>();
  private airbasesCleared = false;

  upsertAirbase(base: Airbase): void {
    const prev = this.airbases.get(base.id);
    const changed =
      !prev ||
      prev.name !== base.name ||
      prev.coalition !== base.coalition ||
      Math.abs(prev.lat - base.lat) > 1e-5 ||
      Math.abs(prev.lon - base.lon) > 1e-5;
    this.airbases.set(base.id, base);
    if (changed) this.airbasesDirty.add(base.id);
  }

  clearAirbases(): void {
    if (this.airbases.size === 0) return;
    this.airbases.clear();
    this.airbasesDirty.clear();
    this.airbasesCleared = true;
  }

  /**
   * Trigger zones: the same lifecycle as airbases -- a map feature, no fog of
   * war, never stale, passed on only when new or changed. The hook re-sends
   * them every few minutes so a server started mid-mission gets them; the
   * comparison keeps those repeats off the wire.
   */
  private zones = new Map<number, Zone>();
  private zonesDirty = new Set<number>();
  private zonesCleared = false;

  upsertZone(zone: Zone): void {
    const prev = this.zones.get(zone.id);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(zone)) this.zonesDirty.add(zone.id);
    this.zones.set(zone.id, zone);
  }

  clearZones(): void {
    if (this.zones.size === 0) return;
    this.zones.clear();
    this.zonesDirty.clear();
    this.zonesCleared = true;
  }

  setOwnship(own: Ownship, view: OptionsView, now = Date.now()): void {
    this.own = own;
    this.ownDirty = true;
    this.optionsView = view;
    this.lastPacketAt = now;
  }

  remove(id: number): void {
    this.units.delete(id);
    this.removed.add(id);
  }

  clear(): void {
    for (const id of this.units.keys()) this.removed.add(id);
    this.units.clear();
    this.own = null;
    this.clearAirbases();
    this.clearZones();
  }

  private removed = new Set<number>();

  /** Fog of war is applied here, not on the client -- there it would be pointless. */
  private visible(unit: Unit): boolean {
    // LoGetWorldObjects() includes the player's own aircraft too. It already
    // has its own dedicated ownship marker; showing it again as an ordinary
    // contact would draw the same aircraft twice at the same spot. The hook
    // skips it on its own now, but this also covers any upstream source
    // (a relay, an older recording) that still sends it.
    if (this.own && unit.id === this.own.id) return false;

    switch (this.optionsView) {
      case 'optview_onlymap':
        return false;
      case 'optview_myaircraft':
        return false;
      case 'optview_allies':
      case 'optview_onlyallies':
        return this.own ? unit.coalition === this.own.coalition : false;
      case 'optview_extended':
        // DCS' "Fog Of War" view: is actually meant to show only objects
        // that have genuinely been detected, plus everything on your own
        // side. LoGetWorldObjects() provides no real detection data --
        // there's no detection information at all. Treated as allies-only
        // until that changes: never shows enemy positions, so it doesn't
        // violate the fairness guarantee, even though it shows less than
        // DCS actually intends.
        return this.own ? unit.coalition === this.own.coalition : false;
      case 'optview_all':
        return true;
      default:
        // An unrecognised runtime value falls through the switch, because
        // the parser takes over optionsView via a type cast, unchecked.
        // Without this fallback that would silently end up as "nothing
        // visible" -- exactly the bug optview_extended caused before this
        // change. The safest default from the fairness guarantee's
        // perspective is allies-only, not "show everything".
        return this.own ? unit.coalition === this.own.coalition : false;
    }
  }

  prune(now = Date.now()): void {
    for (const [id, t] of this.units) {
      if (now - t.lastSeen > DROP_MS) {
        this.units.delete(id);
        this.removed.add(id);
      }
    }
  }

  snapshot(now = Date.now()): Snapshot {
    const units: Unit[] = [];
    for (const t of this.units.values()) {
      if (now - t.lastSeen <= STALE_MS && this.visible(t.unit)) units.push(t.unit);
    }
    return {
      type: 'snapshot',
      seq: this.seq,
      serverTime: now,
      optionsView: this.optionsView,
      objectsBlocked: this.objectsBlocked,
      own: this.own,
      units,
      airbases: [...this.airbases.values()],
      zones: [...this.zones.values()],
    };
  }

  /** Returns the delta since the last call, or null if there's nothing to send. */
  tick(now = Date.now()): Delta | null {
    this.prune(now);

    const units: Unit[] = [];
    for (const t of this.units.values()) {
      const heartbeatDue = now - t.lastSent > HEARTBEAT_MS;
      if ((t.dirty || heartbeatDue) && this.visible(t.unit)) {
        units.push(t.unit);
        t.lastSent = now;
      }
      t.dirty = false;
    }
    const removed = [...this.removed];
    this.removed.clear();

    const airbases: Airbase[] = [];
    for (const id of this.airbasesDirty) {
      const b = this.airbases.get(id);
      if (b) airbases.push(b);
    }
    this.airbasesDirty.clear();
    const airbasesCleared = this.airbasesCleared;
    this.airbasesCleared = false;

    const zones: Zone[] = [];
    for (const id of this.zonesDirty) {
      const z = this.zones.get(id);
      if (z) zones.push(z);
    }
    this.zonesDirty.clear();
    const zonesCleared = this.zonesCleared;
    this.zonesCleared = false;

    const hasOwn = this.ownDirty && this.own;
    if (
      !hasOwn && units.length === 0 && removed.length === 0 &&
      airbases.length === 0 && !airbasesCleared && zones.length === 0 && !zonesCleared
    ) {
      return null;
    }

    this.seq++;
    this.ownDirty = false;

    const delta: Delta = {
      type: 'delta',
      seq: this.seq,
      serverTime: now,
      optionsView: this.optionsView,
      objectsBlocked: this.objectsBlocked,
    };
    if (hasOwn && this.own) delta.own = this.own;
    if (units.length) delta.units = units;
    if (removed.length) delta.removed = removed;
    if (airbasesCleared) delta.airbasesCleared = true;
    if (airbases.length) delta.airbases = airbases;
    if (zonesCleared) delta.zonesCleared = true;
    if (zones.length) delta.zones = zones;
    return delta;
  }

  get stats() {
    return {
      units: this.units.size,
      airbases: this.airbases.size,
      zones: this.zones.size,
      hasOwn: this.own !== null,
      seq: this.seq,
    };
  }
}
