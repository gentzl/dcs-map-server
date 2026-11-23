import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import type { Coalition, OptionsView, ServerMessage, Unit } from '../shared/types.js';
import { CHART_COLORS } from './chart.js';
import {
  MAG_VAR_DEG,
  aspect,
  aspectLabel,
  bearing3,
  bearingTo,
  distanceTo,
  formatAltitude,
  formatDDM,
  metersToFeet,
  metersToNm,
  msToKnots,
  RANGES_NM,
  RANGE_PRESETS_NM,
  rangeForZoom,
  zoomForRange,
  toDeg,
  toMagnetic,
} from './geo.js';
import { buildGraticule } from './graticule.js';
import { buildBullseye, buildRings, buildThreatRings } from './overlays.js';
import * as cfg from './settings.js';
import {
  CATEGORY_LABELS,
  affiliationOf,
  registerSymbols,
  symbolDataUrl,
  symbolId,
  symbolRotates,
  BULLSEYE_IMAGE,
} from './symbols/index.js';
import { buildStyle } from './style.js';
import { OwnshipEstimator, UnitBuffer } from './track.js';

// PMTiles als Protokoll registrieren: MapLibre liest die Kacheln per
// HTTP-Range direkt aus dem Archiv, es braucht keinen Tile-Server.
maplibregl.addProtocol('pmtiles', new Protocol().tile);

let settings = cfg.load();

/**
 * Welche Theater der Server ausliefern kann. Wird vor dem Kartenaufbau geholt;
 * ein Theater ohne Archiv ergaebe sonst eine leere Karte ohne Hinweis darauf.
 */
const available: string[] = await fetch('/api/theaters')
  .then((r) => r.json() as Promise<{ theaters: string[] }>)
  .then((j) => j.theaters)
  .catch(() => []);

if (available.length > 0 && !available.includes(settings.theater)) {
  settings = { ...settings, theater: available[0]! };
  cfg.save(settings);
}
const own = new OwnshipEstimator();
const units = new UnitBuffer();

let headingUp = true;

/**
 * Verfolgen oder frei bewegen.
 *
 * Bewusst nicht gespeichert: Beim naechsten Oeffnen in einem freien Ausschnitt
 * irgendwo auf der Karte zu landen waere die falsche Vorgabe.
 */
let follow = true;
let connected = false;
let lastSeq = 0;
/** Sichtbarkeitsregel, wie DCS sie meldet. Entscheidet, ob Kontakte kommen. */
let optionsView: OptionsView = 'optview_all';
/**
 * Entfernungsstufe statt freiem Zoom. Der Index zeigt in RANGES_NM; die
 * Zoomstufe wird daraus je Frame berechnet, damit "40 nm" unabhängig von
 * Fenstergröße und Breitengrad dieselbe Entfernung bedeutet.
 */
let rangeIndex = 2;
let zoom = 9;
let selectedId: number | null = null;
/** Bezugsgröße für die Zugehörigkeit: eigene Koalition ist Freund. */
let ownCoalition: Coalition = 2;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Bullseye setzt der Nutzer selbst – der Export-Hook liefert es nicht mit. */
let bullseye: { lat: number; lon: number } = (() => {
  try {
    const raw = localStorage.getItem('dcs-map-server.bullseye');
    if (raw) return JSON.parse(raw) as { lat: number; lon: number };
  } catch {
    /* ohne gespeicherten Wert weiter */
  }
  return { lat: 42.18, lon: 42.48 };
})();

const map: MLMap = new maplibregl.Map({
  container: 'map',
  style: buildStyle(settings),
  center: [41.6, 41.6],
  zoom,
  attributionControl: false,
  interactive: false,
});
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
(window as unknown as { __map: MLMap }).__map = map;

// --- Kamera ----------------------------------------------------------------
//
// Die Render-Schleife setzt die Kamera pro Frame; jumpTo bricht dabei laufende
// Animationen ab, womit MapLibres eigener Scroll-Zoom wirkungslos wäre. Statt
// dagegen zu arbeiten, gehört die Kamera vollständig uns.

map.scrollZoom.disable();
map.touchZoomRotate.disable();
// interactive: false schaltet beim Aufbau alle Handler ab, dragPan muss daher
// ausdruecklich eingeschaltet werden.
map.dragPan.enable();
// dragPan bleibt in beiden Modi aktiv. Im Verfolgen-Modus ueberschreibt die
// Render-Schleife die Mitte zwar jeden Frame, aber MapLibres eigenes
// dragstart-Ereignis schaltet vorher auf frei um -- so greift schon der erste
// Zug, statt erst nach einem Knopfdruck.
map.on('dragstart', () => {
  if (follow) setFollow(false);
});

function stepRange(delta: number): void {
  rangeIndex = Math.max(0, Math.min(RANGES_NM.length - 1, rangeIndex + delta));
  updateRangeLabel();
  applyFreeZoom();
}

/**
 * Im freien Modus ruehrt die Render-Schleife die Kamera nicht an, damit sie
 * nicht gegen das Ziehen arbeitet. Eine Massstabsaenderung muss deshalb hier
 * angewandt werden -- um die aktuelle Mitte, nicht um das Flugzeug.
 */
function applyFreeZoom(): void {
  if (follow) return;
  const shortSide = Math.min(map.getCanvas().clientWidth, map.getCanvas().clientHeight);
  map.jumpTo({ zoom: zoomForRange(currentRange(), map.getCenter().lat, shortSide) });
}

const currentRange = (): number => RANGES_NM[rangeIndex]!;

function setRange(nm: number): void {
  const i = RANGES_NM.indexOf(nm as (typeof RANGES_NM)[number]);
  if (i >= 0) rangeIndex = i;
  updateRangeLabel();
  applyFreeZoom();
}

function updateRangeLabel(): void {
  // Keine separate Zahlenanzeige mehr: Jede Stufe hat eine eigene Taste, die
  // hervorgehobene zeigt den eingestellten Wert.
  for (const nm of RANGE_PRESETS_NM) {
    document
      .getElementById(`range-${nm}`)
      ?.setAttribute('aria-pressed', String(currentRange() === nm));
  }
}

const canvas = map.getCanvas();
// Wheel zooms steplessly, same as pinch -- see the pinch handler below for
// why. The scale (deltaY unit is pixels in most browsers) roughly matches one
// zoom level per wheel notch.
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (follow) setFollow(false);
  const z = map.getZoom() - e.deltaY * 0.01;
  map.jumpTo({ zoom: Math.max(0, Math.min(22, z)) });
}, { passive: false });

// Pinch zooms steplessly, unlike the wheel and the buttons -- when nudging
// your own position on the map you want to feel the actual finger movement,
// not jump to the next MFD step. The buttons stay the quick pick for known
// ranges, pinch the free fine-tuning.
let pinch: { dist: number; zoom: number } | null = null;
const touchDist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) {
    // Same as dragging: pinch is a free gesture, follow mode would just
    // overwrite the zoom level every frame.
    if (follow) setFollow(false);
    pinch = { dist: touchDist(e.touches), zoom: map.getZoom() };
  }
});
canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 2 && pinch) {
    e.preventDefault();
    // Doubling the finger distance is one zoom level.
    const z = pinch.zoom + Math.log2(touchDist(e.touches) / pinch.dist);
    map.jumpTo({ zoom: Math.max(0, Math.min(22, z)) });
  }
}, { passive: false });
canvas.addEventListener('touchend', () => { pinch = null; });

// --- Eigene Layer ----------------------------------------------------------

function addOverlayLayers(): void {
  registerSymbols(map);
  const c = CHART_COLORS[settings.mode];
  const ink = c.ink;

  for (const id of ['graticule', 'threats', 'rings', 'bullseye', 'track', 'selected-trail', 'contacts'] as const) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  }

  if (!map.getLayer('graticule-line')) {
    map.addLayer({
      id: 'graticule-line', type: 'line', source: 'graticule',
      paint: { 'line-color': ink, 'line-width': 0.6, 'line-opacity': 0.3, 'line-dasharray': [4, 4] },
    });
    map.addLayer({
      id: 'graticule-label', type: 'symbol', source: 'graticule',
      layout: {
        'text-field': ['get', 'label'], 'text-font': ['Noto Sans Regular'], 'text-size': 10,
        'symbol-placement': 'line', 'text-rotation-alignment': 'viewport', 'text-keep-upright': true,
      },
      paint: { 'text-color': ink, 'text-opacity': 0.55, 'text-halo-color': c.earth, 'text-halo-width': 1.2 },
    });
  }

  if (!map.getLayer('threats-fill')) {
    map.addLayer({
      id: 'threats-fill', type: 'fill', source: 'threats',
      paint: {
        'fill-color': ['case', ['==', ['get', 'affiliation'], 'hostile'], '#e63946', '#4895ef'],
        // Schwach genug, dass sich überlappende Bereiche noch unterscheiden
        // lassen -- bei einer gestaffelten Flugabwehr liegen viele übereinander.
        'fill-opacity': ['case', ['get', 'stale'], 0.04, 0.1],
      },
    });
    map.addLayer({
      id: 'threats-line', type: 'line', source: 'threats',
      paint: {
        'line-color': ['case', ['==', ['get', 'affiliation'], 'hostile'], '#e63946', '#4895ef'],
        'line-width': 1.2,
        'line-opacity': ['case', ['get', 'stale'], 0.3, 0.8],
        'line-dasharray': [3, 2],
      },
    });
    map.addLayer({
      id: 'threats-label', type: 'symbol', source: 'threats',
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Medium'],
        'text-size': 10,
        'symbol-placement': 'line',
        'text-rotation-alignment': 'viewport',
        'text-keep-upright': true,
        'text-optional': true,
      },
      paint: {
        'text-color': ['case', ['==', ['get', 'affiliation'], 'hostile'], '#e63946', '#4895ef'],
        'text-halo-color': c.earth,
        'text-halo-width': 1.5,
      },
    });
  }

  if (!map.getLayer('rings-line')) {
    map.addLayer({
      id: 'rings-line', type: 'line', source: 'rings',
      paint: {
        'line-color': ink,
        'line-width': ['case', ['==', ['get', 'kind'], 'tick'], ['case', ['get', 'major'], 1.4, 0.8], 1],
        'line-opacity': 0.45,
      },
    });
    map.addLayer({
      id: 'rings-label', type: 'symbol', source: 'rings',
      filter: ['==', ['get', 'kind'], 'ring'],
      layout: {
        'text-field': ['concat', ['to-string', ['get', 'nm']], ' nm'],
        'text-font': ['Noto Sans Regular'], 'text-size': 10,
        'symbol-placement': 'line', 'text-rotation-alignment': 'viewport', 'text-keep-upright': true,
      },
      paint: { 'text-color': ink, 'text-opacity': 0.7, 'text-halo-color': c.earth, 'text-halo-width': 1.4 },
    });
  }

  if (!map.getLayer('bullseye-ring')) {
    map.addLayer({
      id: 'bullseye-center', type: 'symbol', source: 'bullseye',
      layout: {
        'icon-image': BULLSEYE_IMAGE,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotation-alignment': 'viewport',
        'text-field': 'BULLSEYE',
        'text-font': ['Noto Sans Medium'],
        'text-size': 10,
        'text-anchor': 'top',
        'text-offset': [0, 1.1],
        'text-letter-spacing': 0.08,
        'text-optional': true,
      },
      paint: {
        'text-color': '#ffb703',
        'text-halo-color': 'rgba(10,14,18,0.85)',
        'text-halo-width': 1.8,
      },
    });
  }

  if (!map.getLayer('track-line')) {
    map.addLayer({
      id: 'track-line', type: 'line', source: 'track',
      paint: { 'line-color': '#4cc9f0', 'line-width': 1.5, 'line-opacity': 0.65 },
    });
  }

  if (!map.getLayer('selected-trail-line')) {
    // Spur eines angewaehlten Kontakts -- aus echten Positionen ueber Zeit
    // angesammelt, nicht aus einer Missionsvorgabe gelesen. Ein Tanker im
    // Orbit zeichnet so nach ein, zwei Runden sein Rennbahnmuster von selbst
    // nach, ohne dass DCS' eigenes Scripting-Markup (das die F10-Karte fuer
    // Tankerrouten zeigt) ausgelesen werden muesste -- das waere aus der
    // Export-API ohnehin nicht erreichbar.
    map.addLayer({
      id: 'selected-trail-line', type: 'line', source: 'selected-trail',
      paint: { 'line-color': '#ffd166', 'line-width': 1.5, 'line-opacity': 0.75, 'line-dasharray': [2, 2] },
    });
  }

  if (!map.getLayer('contacts-dot')) {
    // Auswahlring unter dem Symbol, damit er es nicht überdeckt.
    map.addLayer({
      id: 'contacts-selected', type: 'circle', source: 'contacts',
      filter: ['==', ['get', 'selected'], true],
      paint: {
        'circle-radius': 14,
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffd166',
      },
    });
    // Zwei Layer, weil sich die Ausrichtung nicht in einem ausdrücken lässt:
    // Luftfahrzeuge werden kartenbezogen auf den Kurs gedreht, alle übrigen
    // Symbole müssen bildschirmbezogen aufrecht stehen. Mit einheitlich
    // kartenbezogener Ausrichtung kippen sie mit, sobald die Karte gedreht ist --
    // ein schiefer Normrahmen ist schlicht falsch.
    const iconSize: maplibregl.DataDrivenPropertyValueSpecification<number> = [
      'interpolate', ['linear'], ['zoom'], 6, 0.55, 11, 0.9,
    ];
    // Veraltete Kontakte werden abgeblendet statt entfernt -- eine erfundene
    // Position wäre schlimmer als eine sichtbar alte.
    const iconOpacity: maplibregl.DataDrivenPropertyValueSpecification<number> = [
      'case', ['get', 'stale'], 0.35, 1,
    ];

    map.addLayer({
      id: 'contacts-dot', type: 'symbol', source: 'contacts',
      filter: ['!', ['get', 'rotates']],
      layout: {
        'icon-image': ['get', 'symbol'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotation-alignment': 'viewport',
        'icon-size': iconSize,
      },
      paint: { 'icon-opacity': iconOpacity },
    });
    map.addLayer({
      id: 'contacts-air', type: 'symbol', source: 'contacts',
      filter: ['get', 'rotates'],
      layout: {
        'icon-image': ['get', 'symbol'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-rotate': ['get', 'hdgDeg'],
        'icon-rotation-alignment': 'map',
        'icon-size': iconSize,
      },
      paint: { 'icon-opacity': iconOpacity },
    });
    map.addLayer({
      id: 'contacts-label', type: 'symbol', source: 'contacts',
      filter: ['!=', ['get', 'category'], 'weapon'],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 10,
        'text-anchor': 'left',
        'text-offset': [0.9, 0],
        'text-optional': true,
      },
      paint: {
        'text-color': ink,
        'text-halo-color': c.earth,
        'text-halo-width': 1.4,
        'text-opacity': ['case', ['get', 'stale'], 0.4, 0.95],
      },
    });
  }

  applyVisibility();
}

function applyVisibility(): void {
  const vis = (id: string, on: boolean) => {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  };
  vis('graticule-line', settings.graticule);
  vis('graticule-label', settings.graticule && settings.mapLabels);
  const threatsOn = settings.threats !== 'none';
  vis('threats-fill', threatsOn);
  vis('threats-line', threatsOn);
  vis('threats-label', threatsOn && settings.mapLabels);
  vis('rings-line', settings.rings);
  vis('rings-label', settings.rings);
  vis('bullseye-center', settings.bullseye);
  vis('selected-trail-line', settings.contacts !== 'none');
  vis('contacts-dot', settings.contacts !== 'none');
  vis('contacts-air', settings.contacts !== 'none');
  vis('contacts-selected', settings.contacts !== 'none');
  vis('contacts-label', settings.contacts !== 'none' && settings.contactLabels);
}

map.on('load', addOverlayLayers);

/**
 * Stilwechsel: setStyle verwirft alle eigenen Quellen und Layer, sie müssen
 * danach neu angelegt werden.
 *
 * Bewusst per Abfrage statt über ein Ereignis. `idle` feuert hier nie, weil die
 * Render-Schleife die Karte jeden Frame neu zeichnet, und `styledata` feuert
 * mehrfach, teils bevor der Stil benutzbar ist. Gepollt wird nur für wenige
 * hundert Millisekunden nach einem Wechsel.
 */
function restyle(): void {
  map.setStyle(buildStyle(settings));
  const tryAdd = (): void => {
    if (map.isStyleLoaded() && map.getLayer('earth')) addOverlayLayers();
    else window.setTimeout(tryAdd, 60);
  };
  tryAdd();
}

// --- WebSocket -------------------------------------------------------------

let ws: WebSocket | null = null;
let backoff = 500;
const trackPoints: Array<[number, number]> = [];
/** Spur des angewaehlten Kontakts. Wird bei jedem Auswahlwechsel geleert. */
let selectedTrail: Array<[number, number]> = [];

function connect(): void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => { connected = true; backoff = 500; };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data as string) as ServerMessage;
    const now = performance.now();
    if (msg.type === 'snapshot') {
      units.clear();
      trackPoints.length = 0;
      for (const u of msg.units) units.push(u, now);
      if (msg.own) { own.update(msg.own); ownCoalition = msg.own.coalition; }
    } else {
      if (msg.own) { own.update(msg.own); ownCoalition = msg.own.coalition; }
      for (const u of msg.units ?? []) units.push(u, now);
      for (const id of msg.removed ?? []) units.remove(id);
    }
    lastSeq = msg.seq;
    optionsView = msg.optionsView;
  };
  const retry = () => {
    connected = false;
    ws = null;
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 10_000);
  };
  ws.onclose = retry;
  ws.onerror = () => ws?.close();
}
connect();

// --- Render ----------------------------------------------------------------

let lastFrame = performance.now();
let lastSources = 0;
let lastGrid = 0;
let lastZoomForGrid = -1;
const SOURCE_HZ = 20;

function frame(now: number): void {
  const dt = now - lastFrame;
  lastFrame = now;

  if (!document.hidden && own.ready) {
    own.step(dt);

    if (follow) {
      // Die Zoomstufe folgt der gewählten Entfernung und der Fenstergröße, damit
      // die Angabe auf jedem Gerät dieselbe Strecke bedeutet.
      const shortSide = Math.min(map.getCanvas().clientWidth, map.getCanvas().clientHeight);
      zoom = zoomForRange(currentRange(), own.lat, shortSide);
      map.jumpTo({ center: [own.lon, own.lat], bearing: headingUp ? -toDeg(own.hdg) : 0, zoom });
    }

    // Verfolgend steht das Symbol fest in der Bildmitte: In Heading-up dreht
    // sich die Karte darunter, genordet muss das Symbol selbst den Kurs zeigen.
    // Frei bewegt wandert es mit der Karte und zeigt immer den Kurs.
    const symbolRotation = follow && headingUp ? 0 : toDeg(own.hdg);
    ownshipEl.style.transform = `translate(-50%, -55%) rotate(${symbolRotation.toFixed(1)}deg)`;
    placeOwnship();

    if (now - lastSources > 1000 / SOURCE_HZ) {
      lastSources = now;
      updateSources(now);
    }
    // Das Gradnetz hängt am Ausschnitt, nicht an der Zeit; einmal pro Sekunde
    // oder bei Zoomwechsel genügt.
    if (now - lastGrid > 1000 || Math.abs(zoom - lastZoomForGrid) > 0.01) {
      lastGrid = now;
      lastZoomForGrid = zoom;
      updateGraticule();
    }
    updateHud();
  }
  requestAnimationFrame(frame);
}

function setData(id: string, data: GeoJSON.FeatureCollection | GeoJSON.Feature): void {
  (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data);
}

function visibleContacts(now: number) {
  return units.at(now).filter((u) => settings.contacts !== 'air' || u.unit.alt > 150);
}

function updateSources(now: number): void {
  if (!map.getSource('contacts')) return;

  // Einmal auswerten und weiterreichen: Die Interpolation ist der teuerste
  // Teil des Ticks, zweimal pro Frame wäre reine Verschwendung.
  const contacts = visibleContacts(now);

  setData('contacts', {
    type: 'FeatureCollection',
    features: contacts.map((u) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [u.lon, u.lat] },
      properties: {
        id: u.unit.id,
        kind: u.unit.kind,
        category: u.unit.category,
        coalition: u.unit.coalition,
        name: u.unit.name,
        // Zugehörigkeit ist relativ: die eigene Koalition ist Freund, die andere
        // Feind. Rot und Blau absolut zu setzen wäre in der Norm falsch -- der
        // DCS-Satz tut genau das und bekommt deshalb beides übergeben.
        symbol: symbolId(
          settings.symbolSet,
          u.unit.category,
          affiliationOf(u.unit.coalition, ownCoalition),
          u.unit.coalition,
        ),
        affiliation: affiliationOf(u.unit.coalition, ownCoalition),
        // Grad statt Bogenmass: icon-rotate erwartet Grad.
        hdgDeg: (u.hdg * 180) / Math.PI,
        rotates: symbolRotates(settings.symbolSet, u.unit.category),
        label: `${u.unit.name}  ${Math.round(metersToFeet(u.unit.alt) / 100) * 100}`,
        stale: u.ageMs > 5000,
        selected: u.unit.id === selectedId,
      },
    })),
  });

  setData('threats', buildThreatRings(contacts, settings.threats, ownCoalition));
  if (settings.rings) setData('rings', buildRings(own.lat, own.lon, currentRange()));
  if (settings.bullseye) setData('bullseye', buildBullseye(bullseye.lat, bullseye.lon));

  const last = trackPoints[trackPoints.length - 1];
  if (!last || Math.abs(last[0] - own.lon) > 1e-4 || Math.abs(last[1] - own.lat) > 1e-4) {
    trackPoints.push([own.lon, own.lat]);
    if (trackPoints.length > 3000) trackPoints.shift();
    setData('track', { type: 'Feature', geometry: { type: 'LineString', coordinates: trackPoints }, properties: {} });
  }

  if (selectedId !== null) {
    const sel = contacts.find((c) => c.unit.id === selectedId);
    if (sel) {
      const lastSel = selectedTrail[selectedTrail.length - 1];
      if (!lastSel || Math.abs(lastSel[0] - sel.lon) > 1e-4 || Math.abs(lastSel[1] - sel.lat) > 1e-4) {
        selectedTrail.push([sel.lon, sel.lat]);
        if (selectedTrail.length > 3000) selectedTrail.shift();
      }
    }
  }
  setData('selected-trail', {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: selectedId === null ? [] : selectedTrail },
    properties: {},
  });
}

function updateGraticule(): void {
  if (!settings.graticule || !map.getSource('graticule')) return;
  const b = map.getBounds();
  setData('graticule', buildGraticule(
    { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
    zoom,
  ));
}

// --- Anzeige ---------------------------------------------------------------

const hud = document.getElementById('hud')!;
const braaBox = document.getElementById('braa')!;
const ownshipEl = document.getElementById('ownship')!;
const edgeEl = document.getElementById('offscreen')!;
const warnEl = document.getElementById('warning')!;

/**
 * Abstaende der Randmarke zu den Bildkanten, je Kante verschieden: Oben liegt
 * die HUD-Leiste, unten die Bedienleiste -- mit einem einheitlichen Abstand
 * verschwindet die Marke genau dort darunter.
 */
const EDGE_MARGIN = { top: 58, right: 36, bottom: 82, left: 36 };

/**
 * Setzt das Ownship-Symbol und, falls es aus dem Bild gewandert ist, eine
 * Randmarke mit Peilung und Entfernung.
 *
 * Die eigene Position auf einer Navigationsanzeige zu verlieren ist der
 * schlimmste Fehlerfall eines freien Modus -- deshalb zeigt der Rand immer an,
 * wo das Flugzeug steht.
 */
function placeOwnship(): void {
  const canvasEl = map.getCanvas();
  const w = canvasEl.clientWidth;
  const h = canvasEl.clientHeight;

  if (follow) {
    ownshipEl.style.left = '50%';
    ownshipEl.style.top = '50%';
    edgeEl.hidden = true;
    return;
  }

  const p = map.project([own.lon, own.lat]);
  const inside = p.x >= 0 && p.x <= w && p.y >= 0 && p.y <= h;
  ownshipEl.style.left = `${p.x}px`;
  ownshipEl.style.top = `${p.y}px`;
  ownshipEl.hidden = !inside;

  if (inside) {
    edgeEl.hidden = true;
    return;
  }

  // Auf den Bildrand entlang der Linie von der Mitte zum Flugzeug klemmen.
  const cx = w / 2;
  const cy = h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const limitX = dx >= 0 ? w - EDGE_MARGIN.right - cx : cx - EDGE_MARGIN.left;
  const limitY = dy >= 0 ? h - EDGE_MARGIN.bottom - cy : cy - EDGE_MARGIN.top;
  const scale = Math.min(
    limitX / Math.max(Math.abs(dx), 1e-6),
    limitY / Math.max(Math.abs(dy), 1e-6),
  );
  edgeEl.style.left = `${cx + dx * scale}px`;
  edgeEl.style.top = `${cy + dy * scale}px`;
  // Pfeil zeigt vom Rand aus zum Flugzeug; 0 Grad ist nach oben.
  edgeEl.style.setProperty('--angle', `${toDeg(Math.atan2(dy, dx)) + 90}deg`);

  const centre = map.getCenter();
  const nm = metersToNm(distanceTo(centre.lat, centre.lng, own.lat, own.lon));
  const brg = bearingTo(centre.lat, centre.lng, own.lat, own.lon);
  edgeEl.dataset['label'] = `${bearing3(refBearing(brg))}${refSuffix} ${Math.round(nm)}`;
  edgeEl.hidden = false;
}

const magVar = () => MAG_VAR_DEG[settings.theater] ?? 0;
const refBearing = (trueRad: number) =>
  settings.bearingRef === 'magnetic' ? toMagnetic(trueRad, magVar()) : trueRad;
const refSuffix = settings.bearingRef === 'magnetic' ? 'M' : 'T';

/** Replaces regular spaces with non-breaking ones so a group stays together when wrapping. */
const nbsp = (s: string): string => s.replace(/ /g, ' ');

/**
 * Actual range at the current zoom, not the last preset chosen.
 *
 * After a (stepless) pinch, currentRange() no longer matches the map view --
 * the display should show what's actually visible, not which button was
 * last pressed.
 */
function displayedRangeNm(): number {
  const shortSide = Math.min(map.getCanvas().clientWidth, map.getCanvas().clientHeight);
  const nm = rangeForZoom(map.getZoom(), map.getCenter().lat, shortSide);
  return nm >= 10 ? Math.round(nm) : Math.round(nm * 10) / 10;
}

function updateHud(): void {
  const brgToUs = bearingTo(bullseye.lat, bullseye.lon, own.lat, own.lon);
  const bullRange = metersToNm(distanceTo(bullseye.lat, bullseye.lon, own.lat, own.lon));

  // Each group has non-breaking spaces inside, regular ones in between -- so
  // the bar wraps to two lines on phone width instead of tearing a group
  // apart mid-way or scrolling sideways.
  hud.textContent = [
    nbsp(`${connected ? '●' : '○'} ${lastSeq}`),
    nbsp(`${formatDDM(own.lat, 'NS')} ${formatDDM(own.lon, 'EW')}`),
    nbsp(formatAltitude(own.alt)),
    nbsp(`${Math.round(msToKnots(own.tas))} kt`),
    nbsp(`HDG ${bearing3(refBearing(own.hdg))}${refSuffix}`),
    nbsp(`BULLS ${bearing3(refBearing(brgToUs))}/${Math.round(bullRange)}`),
    nbsp(`${displayedRangeNm()} NM`),
    nbsp(`${units.meta.size} CONTACTS`),
  ].join('   ');

  // Wenn die Mission Fremdeinheiten zurueckhaelt, muss das dastehen. Sonst
  // sucht man den Fehler bei sich, obwohl die Anzeige korrekt arbeitet.
  const withheld = optionsView === 'optview_onlymap' || optionsView === 'optview_myaircraft';
  warnEl.hidden = !withheld;
  if (withheld) warnEl.textContent = `CONTACTS WITHHELD BY MISSION (${optionsView})`;

  updateBraa();
}

function updateBraa(): void {
  if (selectedId === null) {
    braaBox.hidden = true;
    return;
  }
  const u = units.meta.get(selectedId);
  if (!u) {
    braaBox.hidden = true;
    return;
  }
  const brg = bearingTo(own.lat, own.lon, u.lat, u.lon);
  const rng = metersToNm(distanceTo(own.lat, own.lon, u.lat, u.lon));
  const asp = aspect(u.hdg, bearingTo(u.lat, u.lon, own.lat, own.lon));

  braaBox.hidden = false;
  braaBox.textContent =
    `${u.name}  —  BRAA ${bearing3(refBearing(brg))}${refSuffix} / ${rng.toFixed(1)} nm / ` +
    `${Math.round(metersToFeet(u.alt) / 100) * 100} ft / ${aspectLabel(asp)} ${Math.round(asp)}°`;
}

// --- Bedienung -------------------------------------------------------------

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const pt: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];

  if (e.shiftKey) {
    // Umschalt-Klick setzt das Bullseye -- der Hook liefert es nicht.
    const ll = map.unproject(pt);
    bullseye = { lat: ll.lat, lon: ll.lng };
    try { localStorage.setItem('dcs-map-server.bullseye', JSON.stringify(bullseye)); } catch { /* egal */ }
    return;
  }

  const hits = map.queryRenderedFeatures([[pt[0] - 12, pt[1] - 12], [pt[0] + 12, pt[1] + 12]], { layers: ['contacts-dot', 'contacts-air'] });
  const id = hits[0]?.properties?.['id'];
  selectedId = typeof id === 'number' && id !== selectedId ? id : null;
  selectedTrail = [];
});

const btnCtr = document.getElementById('mode-centre')!;
const btnFree = document.getElementById('mode-free')!;

/**
 * Frei bewegt wird immer genordet dargestellt.
 *
 * Eine Karte zu schieben, die sich gleichzeitig unter der Hand dreht, ist
 * unbrauchbar, und die Gitterbeschriftung liest sich nur genordet richtig. Die
 * Einstellung HDG/N bleibt erhalten und gilt beim Zurueckschalten wieder.
 */
function setFollow(on: boolean): void {
  follow = on;
  btnCtr.setAttribute('aria-pressed', String(on));
  btnFree.setAttribute('aria-pressed', String(!on));
  for (const el of [btnHdg, btnNorth]) el.toggleAttribute('disabled', !on);

  if (!on) {
    map.jumpTo({ bearing: 0 });
    applyFreeZoom();
  } else {
    ownshipEl.hidden = false;
  }
}

const btnHdg = document.getElementById('mode-hdg')!;
const btnNorth = document.getElementById('mode-north')!;

function setOrientation(up: boolean): void {
  headingUp = up;
  btnHdg.setAttribute('aria-pressed', String(up));
  btnNorth.setAttribute('aria-pressed', String(!up));
}
btnHdg.addEventListener('click', () => setOrientation(true));
btnNorth.addEventListener('click', () => setOrientation(false));
setOrientation(headingUp);
btnCtr.addEventListener('click', () => setFollow(true));
btnFree.addEventListener('click', () => setFollow(false));
setFollow(true);
// Schrittasten zusätzlich zu den Direkttasten: Auf dem Tablet sind die großen
// Flächen leichter zu treffen als eine bestimmte Zahl.
document.getElementById('range-out')!.addEventListener('click', () => stepRange(1));
document.getElementById('range-in')!.addEventListener('click', () => stepRange(-1));
for (const nm of RANGE_PRESETS_NM) {
  document.getElementById(`range-${nm}`)!.addEventListener('click', () => setRange(nm));
}
updateRangeLabel();

const panel = document.getElementById('settings')!;
const statusLine = document.getElementById('status')!;

document.getElementById('toggle-settings')!.addEventListener('click', () => {
  panel.hidden = !panel.hidden;
  if (!panel.hidden) {
    updateStatus();
    buildLegend();
  }
});

function updateStatus(): void {
  const secure = window.isSecureContext;
  const lock =
    !('wakeLock' in navigator) ? 'not supported'
    : wakeLock ? 'on'
    : secure ? 'off' : 'needs HTTPS';
  statusLine.textContent =
    `Map view: ${optionsView}\n` +
    `Screen lock: ${lock} · ${secure ? 'secure context' : 'insecure context'}`;
}

/** Modus und Beschriftung erfordern einen neuen Stil, alles andere nur Sichtbarkeit. */
const NEEDS_RESTYLE = new Set(['mode', 'mapLabels', 'elevationTint', 'hillshade', 'hillshadeStrength', 'theater']);

function markTheaterAvailability(): void {
  const sel = panel.querySelector<HTMLSelectElement>('[data-key="theater"]');
  if (!sel || available.length === 0) return;
  for (const opt of Array.from(sel.options)) {
    const ok = available.includes(opt.value);
    opt.disabled = !ok;
    if (!ok && !opt.textContent?.includes('(')) opt.textContent = `${opt.textContent} (no tiles)`;
  }
}

/**
 * Symbollegende. Beantwortet die Frage, was ein Symbol bedeutet, dort wo sie
 * aufkommt -- Normsymbolik ist nur dann im Vorteil, wenn man sie nachschlagen kann.
 */
function buildLegend(): void {
  const host = document.getElementById('legend');
  if (!host) return;
  host.replaceChildren();

  const table = document.createElement('table');
  const head = table.insertRow();
  head.insertCell().textContent = '';
  for (const label of ['friend', 'hostile']) {
    const cell = head.insertCell();
    cell.textContent = label;
    cell.className = 'legend-head';
  }

  for (const [category, label] of CATEGORY_LABELS) {
    const row = table.insertRow();
    row.insertCell().textContent = label;
    for (const [affiliation, coalition] of [['friend', 2], ['hostile', 1]] as const) {
      const img = new Image(26, 26);
      img.src = symbolDataUrl(settings.symbolSet, category, affiliation, coalition);
      img.alt = `${label}, ${affiliation}`;
      row.insertCell().append(img);
    }
  }
  host.append(table);
}

function bindControls(): void {
  markTheaterAvailability();
  for (const el of Array.from(panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-key]'))) {
    const key = el.dataset['key'] as keyof cfg.Settings;
    const current = settings[key];

    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(current);
    else el.value = String(current);

    el.addEventListener('change', () => {
      const value =
        el instanceof HTMLInputElement && el.type === 'checkbox'
          ? el.checked
          : el instanceof HTMLInputElement && el.type === 'range'
            ? Number(el.value)
            : el.value;
      settings = { ...settings, [key]: value } as cfg.Settings;
      cfg.save(settings);

      if (NEEDS_RESTYLE.has(key)) restyle();
      else applyVisibility();

      // Die Legende zeichnet aus dem gewählten Satz und muss beim Wechsel neu
      // aufgebaut werden -- sonst zeigte sie den vorigen Satz weiter.
      if (key === 'symbolSet') buildLegend();
    });
  }
}
bindControls();

// --- Display wachhalten ----------------------------------------------------
//
// Ohne Wake Lock geht dem Tablet mitten im Flug das Display aus. Die API gibt
// es nur im Secure Context -- über http://<LAN-IP> also nicht, siehe
// tools/make-cert.sh. Das Sperrobjekt wird beim Wegblenden vom Browser
// freigegeben und muss danach neu angefordert werden.

let wakeLock: WakeLockSentinel | null = null;

async function acquireWakeLock(): Promise<void> {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    // Verweigert oder nicht erlaubt -- die Karte funktioniert trotzdem.
    wakeLock = null;
  }
}

export function wakeLockState(): 'aktiv' | 'nicht verfügbar' | 'aus' {
  if (!('wakeLock' in navigator)) return 'nicht verfügbar';
  return wakeLock ? 'aktiv' : 'aus';
}

void acquireWakeLock();

// Beim Zurückkommen neu synchronisieren statt alte Frames abzuspielen.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    units.clear();
    ws?.close();
    void acquireWakeLock();
  }
});

requestAnimationFrame(frame);
