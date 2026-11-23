import type { Delta, OptionsView, Ownship, Snapshot, Unit } from '../shared/types.js';

/** Ohne Update gilt ein Objekt als veraltet bzw. verschwunden. */
const STALE_MS = 5_000;
const DROP_MS = 30_000;

interface Tracked {
  unit: Unit;
  lastSeen: number;
  dirty: boolean;
}

/**
 * Haelt den Weltzustand und bildet pro Tick Deltas.
 *
 * Eingehende UDP-Pakete werden hier nur eingesammelt; der Versand an Clients
 * laeuft ueber einen eigenen, festen Takt. Das entkoppelt die Client-Last von
 * der DCS-Framerate und erlaubt ueberhaupt erst Delta-Bildung.
 */
export class World {
  private units = new Map<number, Tracked>();
  private own: Ownship | null = null;
  private ownDirty = false;
  private seq = 0;

  optionsView: OptionsView = 'optview_all';
  lastPacketAt = 0;

  upsertUnit(unit: Unit, now = Date.now()): void {
    const prev = this.units.get(unit.id);

    // Der Hook sendet Fremdeinheiten im Round-Robin erneut, auch wenn sie sich
    // nicht bewegt haben. Ohne diesen Vergleich waere jedes "Delta" ein
    // Voll-Dump -- bei stehenden Zielen (SAM-Stellungen, geparkte Flugzeuge)
    // also fast die gesamte Last ohne jeden Informationsgewinn.
    const moved =
      !prev ||
      Math.abs(prev.unit.lat - unit.lat) > 1e-6 ||
      Math.abs(prev.unit.lon - unit.lon) > 1e-6 ||
      Math.abs(prev.unit.alt - unit.alt) > 0.5 ||
      Math.abs(prev.unit.hdg - unit.hdg) > 1e-4;

    // lastSeen wird immer fortgeschrieben: das Objekt ist gesehen worden,
    // auch wenn es sich nicht bewegt hat.
    this.units.set(unit.id, { unit, lastSeen: now, dirty: moved || (prev?.dirty ?? false) });
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
  }

  private removed = new Set<number>();

  /** Fog of War wird hier angewandt, nicht im Client -- dort waere sie wirkungslos. */
  private visible(unit: Unit): boolean {
    switch (this.optionsView) {
      case 'optview_onlymap':
        return false;
      case 'optview_myaircraft':
        return false;
      case 'optview_allies':
      case 'optview_onlyallies':
        return this.own ? unit.coalition === this.own.coalition : false;
      case 'optview_extended':
        // DCS' "Fog Of War"-Ansicht: zeigt eigentlich nur tatsaechlich
        // geortete Objekte zusaetzlich zu allen eigenen. Echte Ortung liefert
        // LoGetWorldObjects() nicht -- es gibt keine Detection-Information.
        // Bis dahin wie Allies-only behandelt: zeigt nie gegnerische
        // Positionen, verletzt also die Fairness-Garantie nicht, auch wenn es
        // weniger zeigt als DCS eigentlich vorsieht.
        return this.own ? unit.coalition === this.own.coalition : false;
      case 'optview_all':
        return true;
      default:
        // Ein unbekannter Laufzeitwert faellt durch den Switch, weil der
        // Parser optionsView per Typumwandlung uebernimmt, nicht geprueft.
        // Ohne diesen Fallback liefe das still auf "alles unsichtbar" hinaus --
        // genau der Fehler, den optview_extended vor dieser Aenderung ausloeste.
        // Sicherster Default aus Sicht der Fairness-Garantie ist Allies-only,
        // nicht "alles zeigen".
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
      own: this.own,
      units,
    };
  }

  /** Gibt das Delta seit dem letzten Aufruf zurueck, oder null wenn nichts anliegt. */
  tick(now = Date.now()): Delta | null {
    this.prune(now);

    const units: Unit[] = [];
    for (const t of this.units.values()) {
      if (t.dirty && this.visible(t.unit)) units.push(t.unit);
      t.dirty = false;
    }
    const removed = [...this.removed];
    this.removed.clear();

    const hasOwn = this.ownDirty && this.own;
    if (!hasOwn && units.length === 0 && removed.length === 0) return null;

    this.seq++;
    this.ownDirty = false;

    const delta: Delta = {
      type: 'delta',
      seq: this.seq,
      serverTime: now,
      optionsView: this.optionsView,
    };
    if (hasOwn && this.own) delta.own = this.own;
    if (units.length) delta.units = units;
    if (removed.length) delta.removed = removed;
    return delta;
  }

  get stats() {
    return { units: this.units.size, hasOwn: this.own !== null, seq: this.seq };
  }
}
