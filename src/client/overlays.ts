import type { Unit } from '../shared/types.js';
import { M_PER_NM, destination, metersToNm, toRad } from './geo.js';

/**
 * Taktische Overlays: Entfernungsringe und Peilstriche um das eigene Flugzeug.
 *
 * Die Ringe sind geodätisch gezogen, nicht als Bildschirmkreise. Bei
 * Heading-up-Darstellung und hohen Breiten wäre ein Bildschirmkreis sonst
 * sichtbar verzerrt – und ein Entfernungsring, der die Entfernung nicht
 * einhält, ist schlimmer als keiner.
 */

/**
 * Ringradien in Seemeilen. Gezeichnet werden nur die, die in die gewählte
 * Entfernungsstufe passen -- Nahbereichsringe wären auf 160 nm nur Rauschen.
 */
export const RING_RADII_NM = [2.5, 5, 10, 20, 40, 80, 160];

const CIRCLE_SEGMENTS = 128;

function geodesicRing(lat: number, lon: number, radiusM: number): [number, number][] {
  const coords: [number, number][] = [];
  for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
    const brg = (i / CIRCLE_SEGMENTS) * 2 * Math.PI;
    const [la, lo] = destination(lat, lon, brg, radiusM);
    coords.push([lo, la]);
  }
  return coords;
}

export function buildRings(lat: number, lon: number, maxNm: number): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];

  for (const nm of RING_RADII_NM) {
    if (nm > maxNm) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: geodesicRing(lat, lon, nm * M_PER_NM) },
      properties: { nm, kind: 'ring' },
    });
  }

  // Peilstriche alle 30°, die Hauptrichtungen länger. Sie ersetzen die
  // Kompassrose, ohne das Bild zuzustellen.
  const outer = Math.min(maxNm, RING_RADII_NM[RING_RADII_NM.length - 1]!);
  for (let deg = 0; deg < 360; deg += 30) {
    const major = deg % 90 === 0;
    const from = outer * (major ? 0.9 : 0.95);
    const [la1, lo1] = destination(lat, lon, toRad(deg), from * M_PER_NM);
    const [la2, lo2] = destination(lat, lon, toRad(deg), outer * M_PER_NM);
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[lo1, la1], [lo2, la2]] },
      properties: { kind: 'tick', major },
    });
  }

  return { type: 'FeatureCollection', features };
}

export function buildBullseye(lat: number, lon: number): GeoJSON.FeatureCollection {
  // Nur der Punkt. Die Erkennbarkeit liefert ein gezeichnetes Symbol fester
  // Bildschirmgröße -- geodätische Ringe um das Bullseye konkurrierten mit den
  // Entfernungsringen des eigenen Flugzeugs und überdeckten bei kleinen Stufen
  // die halbe Ansicht.
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: {} }],
  };
}



/**
 * Wirkungsbereiche der Flugabwehr als Flächen.
 *
 * Bewusst Polygone statt Linien: Die Aussage ist „dieser Bereich ist gefährdet",
 * und eine Fläche sagt das unmittelbar, während ein bloßer Kreisumriss erst
 * gelesen werden muss. Geodätisch gezogen wie die Entfernungsringe -- ein Ring,
 * der die Reichweite nicht einhält, wäre schlimmer als keiner.
 */
export function buildThreatRings(
  units: Array<{ unit: Unit; lat: number; lon: number; ageMs: number }>,
  mode: 'hostile' | 'all' | 'none',
  ownCoalition: number,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (mode === 'none') return { type: 'FeatureCollection', features };

  for (const u of units) {
    const range = u.unit.threatM;
    if (!range) continue;
    if (mode === 'hostile' && u.unit.coalition === ownCoalition) continue;

    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [geodesicRing(u.lat, u.lon, range)] },
      properties: {
        affiliation: u.unit.coalition === ownCoalition ? 'friend' : 'hostile',
        label: `${u.unit.threatLabel ?? ''} ${Math.round(metersToNm(range))}`,
        stale: u.ageMs > 5000,
      },
    });
  }

  return { type: 'FeatureCollection', features };
}
