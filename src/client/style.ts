import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import { CHART_COLORS, aeroLayers, reliefLayers } from './chart.js';
import type { Settings } from './settings.js';

/**
 * Assembles the map style from three parts: Protomaps' OSM geography, the
 * relief on top of it, and the aviation-related elements on top of that.
 *
 * The order is critical. The relief belongs immediately above the base fill,
 * so water, roads and labels stay readable above it; runways and airfields
 * belong right at the top, since they're the most important thing on an
 * aeronautical chart.
 */

const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export function buildStyle(s: Settings): StyleSpecification {
  const flavor = namedFlavor(s.mode === 'chart' ? 'light' : 'dark');
  // English place names: aviation operates in English throughout, and Latin
  // script reads better in the cockpit than the local script.
  const base = layers('proto', flavor, { lang: 'en' });
  const c = CHART_COLORS[s.mode];

  // Adjust the base fill and water to the mode. Against near-black the relief
  // has nothing to shade, against pure white the elevation tints disappear.
  for (const [id, key] of [
    ['earth', 'earth'],
    ['water', 'water'],
  ] as const) {
    const l = base.find((x) => x.id === id);
    if (l && 'paint' in l && l.paint) {
      (l.paint as Record<string, unknown>)['fill-color'] = c[key];
    }
  }

  if (!s.mapLabels) {
    // Remove labels entirely instead of hiding them: on a tablet this also
    // saves the glyph rendering.
    for (let i = base.length - 1; i >= 0; i--) {
      if (base[i]!.type === 'symbol') base.splice(i, 1);
    }
  }

  const earthAt = base.findIndex((x) => x.id === 'earth');
  base.splice(earthAt + 1, 0, ...reliefLayers(s));
  base.push(...aeroLayers(s));

  return {
    version: 8,
    glyphs: '/fonts/{fontstack}/{range}.pbf',
    sprite: `${location.origin}/sprites/light`,
    sources: {
      proto: {
        type: 'vector',
        url: `pmtiles:///tiles/${s.theater}.pmtiles`,
        attribution: '© OpenStreetMap contributors (ODbL)',
      },
      'terrain-dem': {
        type: 'raster-dem',
        tiles: [TERRAIN_TILES],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 13,
        attribution: 'Terrain: AWS Terrain Tiles (SRTM/GMTED, PD)',
      },
    },
    layers: base,
  } as StyleSpecification;
}
