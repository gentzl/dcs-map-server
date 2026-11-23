import type { Ownship, Unit } from '../shared/types.js';
import { destination, shortestAngle } from './geo.js';

/**
 * Eigenes Flugzeug: vorwaerts schaetzen statt verzoegern.
 *
 * Eine Render-Verzoegerung waere hier stoerend, weil das Symbol im Mittelpunkt
 * steht und jede Unstetigkeit auffaellt. Stattdessen wird aus Kurs und TAS
 * extrapoliert und die Abweichung zum naechsten Sample weich ausgeglichen --
 * so bleibt die Bewegung auch bei Paketverlust glatt.
 */
export class OwnshipEstimator {
  lat = 0;
  lon = 0;
  alt = 0;
  hdg = 0;
  tas = 0;
  private have = false;
  private correction = { lat: 0, lon: 0, hdg: 0 };

  /** Zeitkonstante des Ausgleichs. Kuerzer ruckelt, laenger laeuft der Fehler nach. */
  private static readonly BLEND_MS = 220;

  update(own: Ownship): void {
    if (!this.have) {
      this.lat = own.lat;
      this.lon = own.lon;
      this.hdg = own.hdg;
      this.have = true;
    } else {
      // Differenz zur Schaetzung wird nicht gesprungen, sondern abgebaut.
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
 * Fremdeinheiten: bewusst ~150 ms in der Vergangenheit rendern und zwischen den
 * umschliessenden Samples interpolieren. Dadurch liegt immer ein Zielwert vor
 * und Jitter im WLAN faellt nicht auf.
 *
 * Fuer Objekte, die wegen des Round-Robin-Versands laenger kein Update hatten,
 * wird NICHT extrapoliert -- lieber eine ehrlich veraltete Position als eine
 * erfundene.
 */
export class UnitBuffer {
  static readonly DELAY_MS = 150;
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

  /** Interpolierter Zustand zum Renderzeitpunkt, plus Alter in ms. */
  at(now: number): Array<{ unit: Unit; lat: number; lon: number; hdg: number; ageMs: number }> {
    const target = now - UnitBuffer.DELAY_MS;
    const out = [];

    for (const [id, list] of this.samples) {
      const unit = this.meta.get(id);
      const last = list[list.length - 1];
      if (!unit || !last) continue;

      if (list.length === 1 || target >= last.t) {
        out.push({ unit, lat: last.lat, lon: last.lon, hdg: last.hdg, ageMs: now - last.t });
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
      });
    }
    return out;
  }
}
