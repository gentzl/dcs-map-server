import type { LayerSpecification } from 'maplibre-gl';
import type { Settings } from './settings.js';

/**
 * Bestandteile der Fliegerkarten-Darstellung.
 *
 * Ziel ist die Lesbarkeit einer gedruckten Luftfahrtkarte: Höhe über
 * Farbstufen, Gelände über Schummerung, Flugplätze und Gipfelhöhen
 * hervorgehoben, alles Übrige zurückgenommen.
 */

/**
 * Hypsometrische Stufen nach Kartenkonvention: Grün im Flachland über Gelb und
 * Braun bis Grau im Fels. Meter, weil das DEM in Metern liefert.
 */
const TINT_CHART: Array<[number, string]> = [
  [-200, '#b9ccae'],
  [0, '#cfe0c3'],
  [150, '#e2e6c0'],
  [300, '#efe4b8'],
  [600, '#eed9a8'],
  [900, '#e8c893'],
  [1200, '#ddb07e'],
  [1800, '#cf9470'],
  [2400, '#bd7f63'],
  [3000, '#ab6f59'],
  [4000, '#c6b7ae'],
  [5000, '#f0f0ee'],
];

/** Dieselbe Logik, auf Cockpit-Helligkeit abgedunkelt. */
const TINT_NIGHT: Array<[number, string]> = [
  [-200, '#243029'],
  [0, '#35503c'],
  [200, '#41593e'],
  [500, '#55603c'],
  [1000, '#6b6340'],
  [1500, '#7a5f3c'],
  [2000, '#7d5438'],
  [2500, '#7a4c38'],
  [3000, '#7d5a4e'],
  [4000, '#8e8279'],
  [5000, '#c9c9c6'],
];

export const CHART_COLORS = {
  chart: { earth: '#dfe3cf', water: '#a8c8d8', ink: '#2b2b2b', aero: '#1b3f8f' },
  night: { earth: '#3a3f36', water: '#31353f', ink: '#c8d0c0', aero: '#6f9fd8' },
} as const;

export function reliefLayers(s: Settings): LayerSpecification[] {
  const out: LayerSpecification[] = [];
  const ramp = s.mode === 'chart' ? TINT_CHART : TINT_NIGHT;

  if (s.elevationTint) {
    out.push({
      id: 'elevation-tint',
      type: 'color-relief',
      source: 'terrain-dem',
      paint: {
        'color-relief-opacity': 1,
        'color-relief-color': ['interpolate', ['linear'], ['elevation'], ...ramp.flat()],
      },
    } as unknown as LayerSpecification);
  }

  if (s.hillshade) {
    const a = s.hillshadeStrength;
    out.push({
      id: 'hillshade',
      type: 'hillshade',
      source: 'terrain-dem',
      paint: {
        // Halbtransparent, damit die Höhenstufen darunter lesbar bleiben. Ein
        // deckendes helles Highlight macht die Berge weiß und löscht die
        // Höheninformation aus.
        'hillshade-exaggeration': 0.35 + a * 0.45,
        'hillshade-shadow-color': `rgba(8,12,8,${(0.45 + a * 0.4).toFixed(2)})`,
        'hillshade-highlight-color': `rgba(255,255,250,${(a * 0.45).toFixed(2)})`,
        'hillshade-accent-color': `rgba(90,96,80,${(a * 0.5).toFixed(2)})`,
      },
    } as unknown as LayerSpecification);
  }

  return out;
}

/**
 * Luftfahrtbezogene Kartenelemente aus den OSM-Tiles.
 *
 * Start- und Landebahnen liegen bei Protomaps im roads-Layer als
 * `kind: aeroway`; Flugplätze und Gipfel im pois-Layer, allerdings erst in
 * hohen Zoomstufen. Gipfelhöhen werden in Fuß beschriftet, weil Karten und
 * Höhenmesser im Cockpit in Fuß arbeiten.
 */
export function aeroLayers(s: Settings): LayerSpecification[] {
  const c = CHART_COLORS[s.mode];
  const layers: LayerSpecification[] = [
    {
      id: 'aero-runway-casing',
      type: 'line',
      source: 'proto',
      'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'aeroway'],
      paint: {
        'line-color': c.aero,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 11],
        'line-opacity': 0.9,
      },
    },
    {
      id: 'aero-runway',
      type: 'line',
      source: 'proto',
      'source-layer': 'roads',
      filter: ['==', ['get', 'kind'], 'aeroway'],
      paint: {
        'line-color': s.mode === 'chart' ? '#ffffff' : '#e8eef6',
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 5],
      },
    },
  ];

  if (!s.mapLabels) return layers;

  layers.push(
    {
      id: 'aero-airfield',
      type: 'symbol',
      source: 'proto',
      'source-layer': 'pois',
      filter: ['==', ['get', 'kind'], 'aerodrome'],
      layout: {
        // Englischer Name mit Rückfall auf den Lokalnamen: Lateinische
        // Umschrift ist im Cockpit lesbarer als Landesschrift.
        'text-field': [
          'case',
          ['has', 'iata'],
          ['concat', ['coalesce', ['get', 'name:en'], ['get', 'name']], '  ', ['get', 'iata']],
          ['coalesce', ['get', 'name:en'], ['get', 'name']],
        ],
        'text-font': ['Noto Sans Medium'],
        'text-size': 12,
        'text-anchor': 'top',
        'text-offset': [0, 0.8],
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': c.aero,
        'text-halo-color': s.mode === 'chart' ? '#ffffff' : '#101410',
        'text-halo-width': 1.6,
      },
    },
    {
      id: 'spot-elevation',
      type: 'symbol',
      source: 'proto',
      'source-layer': 'pois',
      filter: ['all', ['==', ['get', 'kind'], 'peak'], ['has', 'elevation']],
      layout: {
        // Punkt plus Höhe in Fuß -- die Schreibweise gedruckter Karten.
        'text-field': [
          'concat',
          '▲ ',
          ['to-string', ['round', ['*', ['to-number', ['get', 'elevation']], 3.28084]]],
        ],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': c.ink,
        'text-halo-color': s.mode === 'chart' ? '#ffffff' : '#101410',
        'text-halo-width': 1.4,
      },
    },
  );

  return layers;
}
