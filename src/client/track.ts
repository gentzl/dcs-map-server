import type { Ownship, Unit } from '../shared/types.js';
import { bearingTo, destination, distanceTo, shortestAngle } from './geo.js';

/**
 * Own aircraft: dead reckon forward instead of delaying.
 *
 * A render delay would be disruptive here, since the symbol sits at the
 * centre of the screen and any discontinuity stands out. Instead it
 * extrapolates from heading and TAS and blends in the deviation to the next
 * sample smoothly -- so motion stays smooth even through packet loss.
 */
export class OwnshipEstimator {
  lat = 0;
  lon = 0;
  alt = 0;
  hdg = 0;
  tas = 0;
  private have = false;
  private correction = { lat: 0, lon: 0, hdg: 0 };

  /** Time constant of the blend. Shorter judders, longer lets the error linger. */
  private static readonly BLEND_MS = 220;

  update(own: Ownship): void {
    if (!this.have) {
      this.lat = own.lat;
      this.lon = own.lon;
      this.hdg = own.hdg;
      this.have = true;
    } else {
      // The difference from the estimate isn't jumped to, but worked off.
      this.correction.lat += own.lat - this.lat;
      this.correction.lon += own.lon - this.lon;
      this.correction.hdg += shortestAngle(this.hdg, own.hdg);
    }
    this.alt = own.alt;
    this.tas = own.tas;
  }

  step(dtMs: number): void {
    if (!this.have) return;
    const dt = dtMs / 1000;

    const [lat, lon] = destination(this.lat, this.lon, this.hdg, this.tas * dt);
    this.lat = lat;
    this.lon = lon;

    const f = Math.min(1, dtMs / OwnshipEstimator.BLEND_MS);
    this.lat += this.correction.lat * f;
    this.lon += this.correction.lon * f;
    this.hdg += this.correction.hdg * f;
    this.correction.lat *= 1 - f;
    this.correction.lon *= 1 - f;
    this.correction.hdg *= 1 - f;
  }

  get ready(): boolean {
    return this.have;
  }
}

interface Sample {
  t: number;
  lat: number;
  lon: number;
  hdg: number;
}

/**
 * Other contacts: deliberately render ~150 ms in the past and interpolate
 * between the bracketing samples. That way a target value is usually
 * already available, and jitter on the Wi-Fi doesn't show.
 *
 * When that's not enough, it dead-reckons forward from the last two real
 * samples -- the same technique as for the own aircraft, just without its
 * running correction. That was initially left out on purpose ("an honestly
 * stale position beats a made-up one"), but turned out to fall short against
 * real DCS data: the export hook sends other units in a round-robin with a
 * fixed object count per tick (SWEEP_BUDGET). With many objects in the
 * mission -- about every 300 ms instead of every 100 ms at 333 objects,
 * observed for real -- a contact stood still most of the time and then
 * "raced" to its new position in the last 150 ms, because no second sample
 * was available to bracket it. The estimate closes exactly that gap, but
 * stays bounded by EXTRAPOLATE_CAP_MS: after a longer absence the position
 * should honestly freeze rather than keep running indefinitely.
 */
export class UnitBuffer {
  static readonly DELAY_MS = 150;
  /** Beyond this it no longer extrapolates, just holds the last position. */
  private static readonly EXTRAPOLATE_CAP_MS = 3000;
  private static readonly KEEP = 4;

  private samples = new Map<number, Sample[]>();
  meta = new Map<number, Unit>();

  push(unit: Unit, now: number): void {
    this.meta.set(unit.id, unit);
    const list = this.samples.get(unit.id) ?? [];
    list.push({ t: now, lat: unit.lat, lon: unit.lon, hdg: unit.hdg });
    if (list.length > UnitBuffer.KEEP) list.shift();
    this.samples.set(unit.id, list);
  }

  remove(id: number): void {
    this.samples.delete(id);
    this.meta.delete(id);
  }

  clear(): void {
    this.samples.clear();
    this.meta.clear();
  }

  /** Interpolated state at render time, plus age in ms and ground speed in m/s. */
  at(now: number): Array<{ unit: Unit; lat: number; lon: number; hdg: number; ageMs: number; spdMs: number }> {
    const target = now - UnitBuffer.DELAY_MS;
    const out = [];

    for (const [id, list] of this.samples) {
      const unit = this.meta.get(id);
      const last = list[list.length - 1];
      if (!unit || !last) continue;

      if (target >= last.t) {
        const prevSample = list.length >= 2 ? list[list.length - 2]! : null;
        const gap = last.t - (prevSample?.t ?? last.t);
        const overdue = Math.min(target - last.t, UnitBuffer.EXTRAPOLATE_CAP_MS);

        // Without a second sample, or at a standstill (gap<=0, e.g. on first
        // appearance), no direction can be derived -- then honestly stay at
        // the last position instead of guessing.
        if (!prevSample || gap <= 0 || overdue <= 0) {
          out.push({ unit, lat: last.lat, lon: last.lon, hdg: last.hdg, ageMs: now - last.t, spdMs: 0 });
          continue;
        }

        const speed = distanceTo(prevSample.lat, prevSample.lon, last.lat, last.lon) / (gap / 1000);
        const heading = bearingTo(prevSample.lat, prevSample.lon, last.lat, last.lon);
        const [lat, lon] = destination(last.lat, last.lon, heading, speed * (overdue / 1000));
        out.push({ unit, lat, lon, hdg: last.hdg, ageMs: now - last.t, spdMs: speed });
        continue;
      }

      let a = list[0]!;
      let b = last;
      for (let i = 0; i < list.length - 1; i++) {
        const cur = list[i]!;
        const next = list[i + 1]!;
        if (cur.t <= target && target <= next.t) {
          a = cur;
          b = next;
          break;
        }
      }
      const span = b.t - a.t;
      const f = span > 0 ? (target - a.t) / span : 0;
      out.push({
        unit,
        lat: a.lat + (b.lat - a.lat) * f,
        lon: a.lon + (b.lon - a.lon) * f,
        hdg: a.hdg + shortestAngle(a.hdg, b.hdg) * f,
        ageMs: now - last.t,
        spdMs: span > 0 ? distanceTo(a.lat, a.lon, b.lat, b.lon) / (span / 1000) : 0,
      });
    }
    return out;
  }
}
