import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import { CHART_COLORS, aeroLayers, reliefLayers } from './chart.js';
import type { Settings } from './settings.js';

/**
 * Setzt den Kartenstil aus drei Teilen zusammen: der OSM-Geografie von
 * Protomaps, dem Relief darüber und den luftfahrtbezogenen Elementen zuoberst.
 *
 * Die Reihenfolge ist entscheidend. Das Relief gehört unmittelbar über die
 * Grundfläche, damit Gewässer, Straßen und Beschriftung lesbar darüber liegen;
 * Bahnen und Flugplätze gehören ganz nach oben, weil sie auf einer Fliegerkarte
 * das Wichtigste sind.
 */

const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export function buildStyle(s: Settings): StyleSpecification {
  const flavor = namedFlavor(s.mode === 'chart' ? 'light' : 'dark');
  // Englische Ortsnamen: Luftfahrt arbeitet durchgaengig auf Englisch, und
  // lateinische Umschrift ist im Cockpit lesbarer als Landesschrift.
  const base = layers('proto', flavor, { lang: 'en' });
  const c = CHART_COLORS[s.mode];

  // Grundfläche und Wasser an den Modus anpassen. Auf nahezu Schwarz hat das
  // Relief nichts zu schattieren, auf reinem Weiß verschwinden die Höhenstufen.
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
    // Beschriftung vollständig entfernen statt auszublenden: Auf dem Tablet
    // spart das auch das Glyphen-Rendering.
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
