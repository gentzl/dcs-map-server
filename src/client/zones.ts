import type { Airbase, Zone } from '../shared/types.js';
import { destination, distanceTo, toRad } from './geo.js';

/**
 * The mission's trigger zones, as far as they are worth drawing.
 *
 * A large mission has a thousand of them, nearly all technical: every
 * objective comes with numbered sub-zones and spawn points ("FOB Monday-1"
 * to "-4", "FOB Monday-sp", "-hsp", "Damascus-runway-1"). The objective itself
 * is the zone with the bare name -- "FOB Monday", "FOB Vulture", "Kobuleti" --
 * and those are the ones the F10 map labels. Hidden zones are skipped as the
 * mission builder intended, though in practice most missions hide none.
 *
 * A naming convention, not a rule DCS enforces: a mission built differently
 * just shows more or other zones, which is why the layer can be switched off.
 */
const SUB_ZONE = /[-_ ](\d+|h?sp)$/i;

export const isMainZone = (z: Zone): boolean => !z.hidden && !SUB_ZONE.test(z.name.trim());

/**
 * What a zone is, as far as the data tells -- it carries no type and no
 * owner, so this goes by size and name:
 *
 * - sector: the large areas, ship and patrol sectors (A-H in the BSC
 *   missions, 50-130 km across). Every objective is a few km at most, with
 *   nothing in between, so 10 km separates them cleanly.
 * - airfield: named like one of DCS's airbases; takes that base's side.
 * - objective: everything else -- towns, FOBs, Alpha to Kilo.
 */
export type ZoneKind = 'sector' | 'airfield' | 'objective';

const SECTOR_M = 10_000;

/** The shorter side of a quad, or a circle's diameter. */
function extentM(z: Zone): number {
  if (z.shape === 'quad' && z.vertices && z.vertices.length >= 3) {
    const [a, b, c] = z.vertices as [[number, number], [number, number], [number, number]];
    return Math.min(distanceTo(a[0], a[1], b[0], b[1]), distanceTo(b[0], b[1], c[0], c[1]));
  }
  return 2 * z.radiusM;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function zoneKind(z: Zone, airbaseNames: ReadonlySet<string>): ZoneKind {
  if (extentM(z) > SECTOR_M) return 'sector';
  if (airbaseNames.has(norm(z.name))) return 'airfield';
  return 'objective';
}

/**
 * The side a zone is drawn in. Who holds a zone is runtime state of the
 * mission's script, out of reach of a player's PC, so objectives are drawn
 * red, the colour F10 shows them in. An airfield zone follows its airbase
 * when DCS reports that base as blue -- the one ownership signal that proved
 * right; "neutral" from the export did not (see airbases.ts).
 */
function zoneSide(kind: ZoneKind, base: Airbase | undefined): 'red' | 'blue' | 'none' {
  if (kind === 'sector') return 'none';
  if (kind === 'airfield' && base?.coalition === 2) return 'blue';
  return 'red';
}

/** A circle as a polygon, close enough to round at any zoom. */
function ring(z: Zone): [number, number][] {
  const pts: [number, number][] = [];
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const [lat, lon] = destination(z.lat, z.lon, toRad((i * 360) / n), z.radiusM);
    pts.push([lon, lat]);
  }
  return pts;
}

export function buildZones(zones: Iterable<Zone>, airbases: Iterable<Airbase> = []): GeoJSON.FeatureCollection {
  const baseByName = new Map<string, Airbase>();
  for (const b of airbases) baseByName.set(norm(b.name), b);
  const names = new Set(baseByName.keys());

  const features: GeoJSON.Feature[] = [];
  for (const z of zones) {
    if (!isMainZone(z)) continue;
    const kind = zoneKind(z, names);
    const coords =
      z.shape === 'quad' && z.vertices
        ? [...z.vertices.map(([lat, lon]) => [lon, lat] as [number, number]), [z.vertices[0]![1], z.vertices[0]![0]] as [number, number]]
        : ring(z);
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [coords] },
      properties: { name: z.name, kind, side: zoneSide(kind, baseByName.get(norm(z.name))) },
    });
  }
  return { type: 'FeatureCollection', features };
}
