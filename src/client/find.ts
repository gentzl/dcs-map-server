import type { Airbase, Zone } from '../shared/types.js';
import { isMainZone } from './zones.js';

/**
 * Find in the menu: looks up the mission's zones and DCS's airfields by name
 * -- "FOB", "Damascus", "Alpha" -- for a jump to them.
 *
 * Searches only what the map draws: main zones, and airfields with a runway.
 * Where a zone and an airfield share a name (the airfield zone around a
 * base), only the airfield is listed: picking it gives the full airfield
 * readout, frequencies included, which the zone alone can't.
 */

export interface Place {
  name: string;
  kind: 'airfield' | 'zone';
  lat: number;
  lon: number;
  base?: Airbase;
}

const NO_RUNWAY_LEVEL2 = 18;
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function findPlaces(query: string, zones: Iterable<Zone>, airbases: Iterable<Airbase>, limit = 8): Place[] {
  const q = norm(query);
  if (!q) return [];

  const places = new Map<string, Place>();
  for (const b of airbases) {
    if (b.level2 === NO_RUNWAY_LEVEL2) continue;
    places.set(norm(b.name), { name: b.name, kind: 'airfield', lat: b.lat, lon: b.lon, base: b });
  }
  for (const z of zones) {
    if (!isMainZone(z) || places.has(norm(z.name))) continue;
    places.set(norm(z.name), { name: z.name, kind: 'zone', lat: z.lat, lon: z.lon });
  }

  // Names starting with what was typed first, then any containing it, each
  // alphabetical: typing "fob" should list the FOBs, not every name with
  // "fob" somewhere in the middle ahead of them.
  const hits = [...places.entries()].filter(([key]) => key.includes(q));
  hits.sort(([a, pa], [b, pb]) => {
    const sa = a.startsWith(q) ? 0 : 1;
    const sb = b.startsWith(q) ? 0 : 1;
    return sa - sb || pa.name.localeCompare(pb.name);
  });
  return hits.slice(0, limit).map(([, p]) => p);
}
