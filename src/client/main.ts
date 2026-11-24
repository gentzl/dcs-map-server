import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import type { Category, Coalition, OptionsView, ServerMessage, Unit } from '../shared/types.js';
import { AIRBORNE } from '../shared/types.js';
import { CHART_COLORS } from './chart.js';
import {
  MAG_VAR_DEG,
  aspect,
  aspectLabel,
  bearing3,
  bearingTo,
  distanceTo,
  formatAltitude,
  formatMissionTime,
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
  altitudeThousands,
  closureMs,
  windFrom,
  M_PER_NM,
} from './geo.js';
import { buildGraticule } from './graticule.js';
import { buildBullseye, buildLeaders, buildRings, buildThreatRings } from './overlays.js';
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

// Register PMTiles as a protocol: MapLibre reads the tiles directly out of
// the archive via HTTP range requests, no tile server needed.
maplibregl.addProtocol('pmtiles', new Protocol().tile);

let settings = cfg.load();

/**
 * Which theaters the server can serve. Fetched before the map is built; a
 * theater without an archive would otherwise just produce a blank map with
 * no indication why.
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
 * Follow the aircraft, or pan freely.
 *
 * Deliberately not persisted: landing in some random free-panned view on the
 * next open would be the wrong default.
 */
let follow = true;
/**
 * Zoom level set by pinch or wheel, overriding the preset-driven zoom while
 * still following the aircraft. Pinch/wheel used to kick the view into FREE
 * mode like a drag does, but zooming while centred is a different gesture
 * from panning away -- only an actual pan should give up centring.
 * Cleared by picking a range preset, which is the explicit way back to a
 * known distance.
 */
let manualZoom: number | null = null;
let connected = false;
let lastSeq = 0;
/** Visibility rule as DCS reports it. Decides whether contacts come through at all. */
let optionsView: OptionsView = 'optview_all';
/**
 * Range step rather than free zoom. The index points into RANGES_NM; the
 * zoom level is computed from it every frame, so "40 nm" means the same
 * distance regardless of window size or latitude.
 */
let rangeIndex = 2;
let zoom = 9;
let selectedId: number | null = null;
/** Reference for affiliation: your own coalition is friend. */
let ownCoalition: Coalition = 2;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * Two-point measurement. Off until MEAS is pressed; the first tap then sets
 * the start, the second the end, and a further tap starts over.
 *
 * A button rather than a modifier because the thing is meant to be used on a
 * tablet, where there is no keyboard to hold anything down with.
 */
let ruler: { a: { lat: number; lon: number } | null; b: { lat: number; lon: number } | null } | null = null;

/**
 * Coordinates of the last plain click on open map, shown right next to
 * where you tapped. Cleared the moment a contact gets selected instead --
 * the BRAA box takes over then, with the contact's own coordinates in it --
 * and when MEAS is armed, since a stale coordinate label floating next to
 * a fresh measurement would just be clutter.
 */
let clickedPoint: { lat: number; lon: number } | null = null;

/** The user sets the bullseye themselves -- the export hook doesn't provide one. */
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

// --- Camera ------------------------------------------------------------------
//
// The render loop sets the camera every frame; jumpTo cancels any running
// animation while doing so, which would make MapLibre's own scroll zoom
// ineffective. Rather than work against that, the camera is entirely ours.

map.scrollZoom.disable();
map.touchZoomRotate.disable();
map.dragPan.disable();
// Panning is driven directly from raw pointer events below instead of
// MapLibre's own dragPan: on at least one real mouse/trackpad setup, a held
// button drag produced no movement at all even with dragPan enabled --
// MapLibre's internal gesture recognition never saw it. Pointer events also
// unify mouse, touch and pen under one implementation, and let pinch share
// the same pointer bookkeeping as the pan below.

function stepRange(delta: number): void {
  rangeIndex = Math.max(0, Math.min(RANGES_NM.length - 1, rangeIndex + delta));
  updateRangeLabel();
  applyFreeZoom();
}

/**
 * In free mode the render loop leaves the camera alone, so it doesn't fight
 * the drag. A scale change therefore has to be applied here instead -- around
 * the current centre, not the aircraft.
 *
 * A preset button is the explicit return to a known distance, so it clears
 * any previous pinch/wheel zoom.
 */
function applyFreeZoom(): void {
  manualZoom = null;
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

// Close enough in zoom levels to count as "on" a preset -- accounts for
// floating-point jitter, not for an intentional pinch/wheel away from it.
const PRESET_ZOOM_EPS = 0.02;

/**
 * Highlights whichever preset button matches the actual current zoom, not
 * whichever was last pressed. After a stepless pinch or wheel zoom the view
 * usually sits between two presets, and then none should show as active --
 * a highlighted button that doesn't match what's on screen is misleading.
 */
function updateRangeLabel(): void {
  const shortSide = Math.min(map.getCanvas().clientWidth, map.getCanvas().clientHeight);
  const z = map.getZoom();
  const lat = map.getCenter().lat;
  for (const nm of RANGE_PRESETS_NM) {
    const active = Math.abs(zoomForRange(nm, lat, shortSide) - z) < PRESET_ZOOM_EPS;
    document.getElementById(`range-${nm}`)?.setAttribute('aria-pressed', String(active));
  }
}

const canvas = map.getCanvas();
// Wheel zooms steplessly, same as pinch -- see the pinch handler below for
// why. The scale (deltaY unit is pixels in most browsers) roughly matches one
// zoom level per wheel notch.
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  // Zooming is not panning -- stays centred on the aircraft in follow mode,
  // see manualZoom. Only free mode needs an explicit jumpTo here; in follow
  // mode the render loop applies manualZoom itself every frame.
  const z = (manualZoom ?? map.getZoom()) - e.deltaY * 0.01;
  manualZoom = Math.max(0, Math.min(22, z));
  if (!follow) map.jumpTo({ zoom: manualZoom });
}, { passive: false });

/**
 * Arrow keys pan the map, for a second screen driven from a keyboard rather
 * than a touchscreen or mouse. Behaves like a drag: switches to FREE on the
 * first press, same fixed pixel step regardless of zoom so repeated presses
 * feel consistent.
 *
 * Listens on the window, not the canvas: the canvas is not a focusable
 * element, so it would never receive key events at all.
 */
const PAN_STEP_PX = 80;
window.addEventListener('keydown', (e) => {
  const delta: Record<string, [number, number]> = {
    ArrowUp: [0, -PAN_STEP_PX],
    ArrowDown: [0, PAN_STEP_PX],
    ArrowLeft: [-PAN_STEP_PX, 0],
    ArrowRight: [PAN_STEP_PX, 0],
  };
  const d = delta[e.key];
  if (!d) return;
  // Don't steal the arrow keys from an input/select (the theater dropdown,
  // a future text field) -- only pan while nothing is being typed into.
  const tag = (document.activeElement as HTMLElement | null)?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

  e.preventDefault();
  if (follow) setFollow(false);
  map.panBy(d, { animate: false });
});

// Prevents the browser's own touch scrolling/pinch-zoom/pull-to-refresh from
// competing with the pointer handling below.
canvas.style.touchAction = 'none';

/**
 * The attribution control's compact toggle is a native <details>/<summary>,
 * which browsers never auto-close on an outside click or tap -- the only way
 * to dismiss one is clicking the summary again. On a small screen the
 * expanded panel can end up covering or crowding that same summary, which
 * makes it awkward or impossible to hit a second time. A tap anywhere else
 * closes it explicitly instead of relying on that.
 */
document.addEventListener(
  'pointerdown',
  (e) => {
    const attrib = document.querySelector('details.maplibregl-ctrl-attrib[open]');
    if (attrib && !attrib.contains(e.target as Node)) attrib.removeAttribute('open');
  },
  { capture: true },
);

/**
 * Panning and pinch-zoom, built directly on pointer events rather than
 * MapLibre's own dragPan/touchZoomRotate (both disabled above). One pointer
 * down drags the map -- the point under the cursor at the start stays under
 * it, same feel as any slippy map. A second pointer switches to pinch-zoom,
 * same stepless behaviour as the wheel. Pointer events cover mouse, touch
 * and pen in one implementation instead of three separate ones.
 */
const activePointers = new Map<number, [number, number]>();
let pan: { x: number; y: number; startX: number; startY: number } | null = null;
let pinch: { dist: number; zoom: number } | null = null;

/**
 * Long-press sets the bullseye, the touch equivalent of shift-click: there is
 * no shift key on a tablet. Guarded the same way a drag is told apart from a
 * stationary tap -- any movement past the threshold, a second finger joining,
 * or the gesture ending early all cancel it.
 */
const LONG_PRESS_MS = 550;
let longPress: { timer: ReturnType<typeof setTimeout>; at: [number, number] } | null = null;
let longPressFired = false;

function cancelLongPress(): void {
  if (longPress) clearTimeout(longPress.timer);
  longPress = null;
}

function armLongPress(pt: [number, number]): void {
  cancelLongPress();
  longPress = {
    at: pt,
    timer: setTimeout(() => {
      const ll = map.unproject(pt);
      bullseye = { lat: ll.lat, lon: ll.lng };
      try { localStorage.setItem('dcs-map-server.bullseye', JSON.stringify(bullseye)); } catch { /* doesn't matter */ }
      longPressFired = true;
      longPress = null;
    }, LONG_PRESS_MS),
  };
}

const pointerAt = (e: PointerEvent): [number, number] => {
  const rect = canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
};
const pinchDist = (): number => {
  const [a, b] = [...activePointers.values()];
  return Math.hypot(a![0] - b![0], a![1] - b![1]);
};

canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  activePointers.set(e.pointerId, pointerAt(e));

  if (activePointers.size === 1) {
    const [x, y] = pointerAt(e);
    pan = { x, y, startX: x, startY: y };
    pinch = null;
    if (!ruler) armLongPress([x, y]);
  } else if (activePointers.size === 2) {
    pan = null;
    pinch = { dist: pinchDist(), zoom: manualZoom ?? map.getZoom() };
    cancelLongPress();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, pointerAt(e));

  if (pan && activePointers.size === 1) {
    const [x, y] = pointerAt(e);
    // Against the gesture's start, to tell a drag apart from a stationary
    // click (contact selection) before committing to leaving follow mode.
    const fromStart = Math.hypot(x - pan.startX, y - pan.startY);
    if (fromStart > 3) cancelLongPress();
    if (follow && fromStart > 3) setFollow(false);

    if (!follow) {
      // Incremental, read fresh from the current state every step -- not a
      // pixel anchor cached at gesture start. project/unproject are only
      // consistent within one bearing, so a cached anchor would silently
      // go stale if anything else ever changes the bearing mid-drag.
      const dx = x - pan.x;
      const dy = y - pan.y;
      const centerPx = map.project(map.getCenter());
      map.jumpTo({ center: map.unproject([centerPx.x - dx, centerPx.y - dy]) });
    }
    pan.x = x;
    pan.y = y;
  } else if (pinch && activePointers.size === 2) {
    // Doubling the finger distance is one zoom level.
    const z = pinch.zoom + Math.log2(pinchDist() / pinch.dist);
    manualZoom = Math.max(0, Math.min(22, z));
    if (!follow) map.jumpTo({ zoom: manualZoom });
  }
});

function endPointer(e: PointerEvent): void {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 1) {
    pan = null;
    cancelLongPress();
    // A pan changes latitude, and how much ground a preset covers depends on
    // it, so re-fit the preset now that the gesture is over. Only while the
    // view is actually on a preset: a stepless pinch or wheel zoom has to
    // survive the next gesture, and a stationary click is one of those.
    if (manualZoom === null) applyFreeZoom();
  }
  if (activePointers.size < 2) pinch = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

// --- Own layers --------------------------------------------------------------

function addOverlayLayers(): void {
  registerSymbols(map);
  const c = CHART_COLORS[settings.mode];
  const ink = c.ink;

  for (const id of ['graticule', 'threats', 'rings', 'bullseye', 'track', 'selected-trail', 'braa-line', 'leaders', 'ruler', 'contacts'] as const) {
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
        // Barely a tint. The outline below carries the boundary; the fill
        // only has to keep a dangerous area from reading as empty ground,
        // and a layered air-defence setup stacks many of these on top of
        // each other -- even a faint value compounds fast once four or five
        // rings overlap, which is most of what made "all" mode read as a
        // solid wash of blue. Friend is weaker still: that mode shows your
        // own side's air defence too, and a mission usually fields far more
        // of it than the enemy.
        'fill-opacity': [
          'case', ['get', 'stale'], 0.008,
          ['==', ['get', 'affiliation'], 'hostile'], 0.025,
          0.012,
        ],
      },
    });
    map.addLayer({
      id: 'threats-line', type: 'line', source: 'threats',
      paint: {
        'line-color': ['case', ['==', ['get', 'affiliation'], 'hostile'], '#e63946', '#4895ef'],
        'line-width': 1.2,
        'line-opacity': [
          'case', ['get', 'stale'], 0.2,
          ['==', ['get', 'affiliation'], 'hostile'], 0.6,
          0.45,
        ],
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
    // Trail of a selected contact -- accumulated from real positions over
    // time, not read from a mission waypoint. A tanker orbiting traces out
    // its own racetrack pattern after a lap or two this way, without having
    // to read DCS' own scripting markup (the one the F10 map uses for tanker
    // routes) -- which wouldn't be reachable from the export API anyway.
    map.addLayer({
      id: 'selected-trail-line', type: 'line', source: 'selected-trail',
      paint: { 'line-color': '#ffd166', 'line-width': 1.5, 'line-opacity': 0.75, 'line-dasharray': [2, 2] },
    });
  }

  if (!map.getLayer('braa-line-line')) {
    // Straight line from the aircraft to a selected contact -- the BRAA
    // readout gives the numbers, this gives the direction at a glance.
    // Solid, unlike the dashed trail above, so the two don't read as the same thing.
    //
    // Dark casing under a full-strength core. The line crosses whatever the
    // terrain happens to be, and a thin translucent yellow vanished against
    // the pale elevation tints -- the casing is what keeps it readable there
    // without having to pick a colour that fights the contact symbols.
    map.addLayer({
      id: 'braa-line-casing', type: 'line', source: 'braa-line',
      paint: { 'line-color': 'rgba(0,0,0,0.45)', 'line-width': 4.2 },
    });
    // Dashed core on a solid casing, the way a measured bearing is drawn on a
    // chart. The dashes are deliberately much coarser than the selected
    // contact's trail above, which is fine-dashed in the same colour -- at the
    // same pitch the two would read as one kind of line.
    map.addLayer({
      id: 'braa-line-line', type: 'line', source: 'braa-line',
      paint: { 'line-color': '#ffd166', 'line-width': 1.8, 'line-dasharray': [6, 3] },
    });
  }

  if (!map.getLayer('ruler-line')) {
    // Cyan, like the own track: this is a line you drew, not something the
    // mission put there.
    map.addLayer({
      id: 'ruler-casing', type: 'line', source: 'ruler',
      paint: { 'line-color': 'rgba(0,0,0,0.45)', 'line-width': 4.2 },
    });
    map.addLayer({
      id: 'ruler-line', type: 'line', source: 'ruler',
      paint: { 'line-color': '#4cc9f0', 'line-width': 2.2, 'line-dasharray': [4, 2] },
    });
    map.addLayer({
      id: 'ruler-point', type: 'circle', source: 'ruler',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: {
        'circle-radius': 4,
        'circle-color': '#4cc9f0',
        'circle-stroke-color': 'rgba(0,0,0,0.6)',
        'circle-stroke-width': 1.5,
      },
    });
  }

  if (!map.getLayer('leaders-line')) {
    // Under the symbols, so a stub never covers the contact it belongs to.
    map.addLayer({
      id: 'leaders-line', type: 'line', source: 'leaders',
      paint: {
        'line-color': ['case', ['==', ['get', 'affiliation'], 'hostile'], '#e63946', '#4895ef'],
        'line-width': 1.4,
        'line-opacity': ['case', ['get', 'stale'], 0.3, 0.9],
      },
    });
  }

  if (!map.getLayer('contacts-dot')) {
    // Selection ring under the symbol, so it doesn't cover it.
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
    // Two layers, because the orientation can't be expressed in one: aircraft
    // are rotated to heading relative to the map, all other symbols must
    // stand upright relative to the screen. With uniformly map-relative
    // orientation they'd tilt along as soon as the map rotates -- a tilted
    // standard frame is simply wrong.
    const iconSize: maplibregl.DataDrivenPropertyValueSpecification<number> = [
      'interpolate', ['linear'], ['zoom'], 6, 0.55, 11, 0.9,
    ];
    // Stale contacts are dimmed instead of removed -- a made-up position
    // would be worse than a visibly old one.
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
  vis('braa-line-casing', settings.contacts !== 'none');
  vis('braa-line-line', settings.contacts !== 'none');
  vis('leaders-line', settings.contacts !== 'none');
  vis('contacts-dot', settings.contacts !== 'none');
  vis('contacts-air', settings.contacts !== 'none');
  vis('contacts-selected', settings.contacts !== 'none');
  vis('contacts-label', settings.contacts !== 'none' && settings.contactLabels);
}

map.on('load', addOverlayLayers);

/**
 * Style switch: setStyle discards all our own sources and layers, they have
 * to be recreated afterwards.
 *
 * Deliberately by polling rather than an event. `idle` never fires here,
 * since the render loop redraws the map every frame, and `styledata` fires
 * multiple times, some before the style is usable. Polling only runs for a
 * few hundred milliseconds after a switch.
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
/** Trail of the selected contact. Cleared whenever the selection changes. */
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
      // The zoom level follows the selected range and the window size, so
      // the value means the same distance on every device -- unless pinch or
      // wheel have just set their own zoom: zooming while following is not
      // leaving the mode, only panning is.
      const shortSide = Math.min(map.getCanvas().clientWidth, map.getCanvas().clientHeight);
      zoom = manualZoom ?? zoomForRange(currentRange(), own.lat, shortSide);
      map.jumpTo({ center: [own.lon, own.lat], bearing: headingUp ? -toDeg(own.hdg) : 0, zoom });
    }

    // The symbol's own heading plus however much the map itself is already
    // rotated -- not a fixed per-mode case. Heading-up follow sets the map's
    // bearing to -heading, which makes this always resolve to 0 there (the
    // map rotates under the symbol instead). North-up follow and free mode
    // (which now keeps whatever bearing was active on leaving follow,
    // rather than forcing north-up) fall out of the same formula without
    // needing their own case.
    const symbolRotation = toDeg(own.hdg) + map.getBearing();
    ownshipEl.style.transform = `translate(-50%, -55%) rotate(${symbolRotation.toFixed(1)}deg)`;
    placeOwnship();

    if (now - lastSources > 1000 / SOURCE_HZ) {
      lastSources = now;
      updateSources(now);
    }
    // The graticule depends on the view, not on time; once a second or on a
    // zoom change is enough.
    if (now - lastGrid > 1000 || Math.abs(zoom - lastZoomForGrid) > 0.01) {
      lastGrid = now;
      lastZoomForGrid = zoom;
      updateGraticule();
    }
    updateHud(now);
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

  // Evaluate once and pass it on: interpolation is the most expensive part
  // of the tick, doing it twice per frame would be pure waste.
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
        // Affiliation is relative: your own coalition is friend, the other
        // hostile. Setting red and blue absolutely would be wrong under the
        // standard -- the DCS set does exactly that, so it gets both passed in.
        symbol: symbolId(
          settings.symbolSet,
          u.unit.category,
          affiliationOf(u.unit.coalition, ownCoalition),
          u.unit.coalition,
        ),
        affiliation: affiliationOf(u.unit.coalition, ownCoalition),
        // Degrees, not radians: icon-rotate expects degrees.
        hdgDeg: (u.hdg * 180) / Math.PI,
        rotates: symbolRotates(settings.symbolSet, u.unit.category),
        label: `${u.unit.name}  ${contactAltitude(u.unit.category, u.unit.alt)}`,
        stale: u.ageMs > 5000,
        selected: u.unit.id === selectedId,
      },
    })),
  });

  setData('leaders', buildLeaders(contacts, ownCoalition, map.getZoom()));
  setData('threats', buildThreatRings(contacts, settings.threats, ownCoalition));
  // The actual displayed range, not the last-pressed preset -- otherwise a
  // pinch or wheel zoom away from a button leaves the rings frozen at
  // whichever step was last clicked.
  if (settings.rings) setData('rings', buildRings(own.lat, own.lon, displayedRangeNm()));
  if (settings.bullseye) setData('bullseye', buildBullseye(bullseye.lat, bullseye.lon));

  const last = trackPoints[trackPoints.length - 1];
  if (!last || Math.abs(last[0] - own.lon) > 1e-4 || Math.abs(last[1] - own.lat) > 1e-4) {
    trackPoints.push([own.lon, own.lat]);
    if (trackPoints.length > 3000) trackPoints.shift();
    setData('track', { type: 'Feature', geometry: { type: 'LineString', coordinates: trackPoints }, properties: {} });
  }

  let braaLine: [number, number][] = [];
  if (selectedId !== null) {
    const sel = contacts.find((c) => c.unit.id === selectedId);
    if (sel) {
      const lastSel = selectedTrail[selectedTrail.length - 1];
      if (!lastSel || Math.abs(lastSel[0] - sel.lon) > 1e-4 || Math.abs(lastSel[1] - sel.lat) > 1e-4) {
        selectedTrail.push([sel.lon, sel.lat]);
        if (selectedTrail.length > 3000) selectedTrail.shift();
      }
      braaLine = [[own.lon, own.lat], [sel.lon, sel.lat]];
    }
  }
  setData('selected-trail', {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: selectedId === null ? [] : selectedTrail },
    properties: {},
  });
  setData('braa-line', { type: 'Feature', geometry: { type: 'LineString', coordinates: braaLine }, properties: {} });
}

function updateGraticule(): void {
  if (!settings.graticule || !map.getSource('graticule')) return;
  const b = map.getBounds();
  setData('graticule', buildGraticule(
    { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() },
    zoom,
  ));
}

// --- Display -----------------------------------------------------------------

const hud = document.getElementById('hud')!;
const braaBox = document.getElementById('braa')!;
const ownshipEl = document.getElementById('ownship')!;
const edgeEl = document.getElementById('offscreen')!;
const warnEl = document.getElementById('warning')!;

/**
 * Edge marker's margin to the screen edges, different per edge: the HUD bar
 * sits at the top, the control bar at the bottom -- with a uniform margin
 * the marker would disappear right underneath them.
 */
const EDGE_MARGIN = { top: 58, right: 36, bottom: 82, left: 36 };

/**
 * Places the ownship symbol and, if it has wandered out of view, an edge
 * marker with bearing and range.
 *
 * Losing your own position on a navigation display is the worst failure
 * mode of a free mode -- so the edge marker always shows where the aircraft is.
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

  // Clamp to the screen edge along the line from centre to the aircraft.
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
  // The arrow points from the edge towards the aircraft; 0 degrees is up.
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

/**
 * Altitude as it would be called: thousands of feet for anything in the air,
 * plain feet for anything on the surface, where a figure like "0.6" would
 * say nothing.
 */
const contactAltitude = (category: Category, meters: number): string =>
  AIRBORNE.has(category)
    ? altitudeThousands(meters)
    : String(Math.round(metersToFeet(meters) / 100) * 100);

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

function updateHud(now: number): void {
  // Runs every frame so a preset button un-highlights immediately once a
  // pinch or wheel zoom moves the view away from it, not just on the next
  // button press.
  updateRangeLabel();

  const brgToUs = bearingTo(bullseye.lat, bullseye.lon, own.lat, own.lon);
  const bullRange = metersToNm(distanceTo(bullseye.lat, bullseye.lon, own.lat, own.lon));
  const wind = windFrom(own.wind.x, own.wind.z);

  // Each group has non-breaking spaces inside, regular ones in between -- so
  // the bar wraps to two lines on phone width instead of tearing a group
  // apart mid-way or scrolling sideways.
  hud.textContent = [
    // Mission elapsed time, from DCS' own model time -- not the wall clock,
    // which every device already shows. Doubles as a feed-health check: if
    // it stops advancing, so has everything else.
    nbsp(`${connected ? '●' : '○'} ${formatMissionTime(own.modelTime)}`),
    nbsp(`${formatDDM(own.lat, 'NS')} ${formatDDM(own.lon, 'EW')}`),
    nbsp(formatAltitude(own.alt)),
    nbsp(`${Math.round(msToKnots(own.tas))} kt`),
    nbsp(`HDG ${bearing3(refBearing(own.hdg))}${refSuffix}`),
    // Below 3 kt the direction is noise off a near-zero vector, not signal
    // -- a METAR calls this "variable" rather than print a precise-looking
    // bearing nobody could act on.
    nbsp(msToKnots(wind.speedMs) < 3
      ? `WIND VRB/${Math.round(msToKnots(wind.speedMs))}`
      : `WIND ${bearing3(refBearing(wind.bearing))}${refSuffix}/${Math.round(msToKnots(wind.speedMs))}`),
    nbsp(`BULLS ${bearing3(refBearing(brgToUs))}/${Math.round(bullRange)}`),
    nbsp(`${displayedRangeNm()} NM`),
  ].join('   ');

  // If the mission withholds other units, this needs to be shown. Otherwise
  // you'd look for the fault in yourself, even though the display is working correctly.
  const withheld = optionsView === 'optview_onlymap' || optionsView === 'optview_myaircraft';
  warnEl.hidden = !withheld;
  if (withheld) warnEl.textContent = `CONTACTS WITHHELD BY MISSION (${optionsView})`;

  updateBraa(now);
  updateRuler();
  updateClickInfo();
}

const rulerBox = document.getElementById('ruler')!;
const clickInfoBox = document.getElementById('clickinfo')!;

/**
 * Places the ruler readout at a point in the map, clamped to stay fully
 * inside the canvas -- a label that runs off the edge the moment you
 * measure towards a corner would be worse than a fixed one.
 */
function placeFloatingBox(el: HTMLElement, lon: number, lat: number, offsetY: number, halfBox: number): void {
  const p = map.project([lon, lat]);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const x = Math.min(Math.max(p.x, halfBox + 4), w - halfBox - 4);
  const y = Math.min(Math.max(p.y + offsetY, 24), h - 24);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
}

function updateRuler(): void {
  if (!ruler) {
    rulerBox.hidden = true;
    setData('ruler', { type: 'FeatureCollection', features: [] });
    return;
  }

  const points = [ruler.a, ruler.b].filter((p) => p !== null);
  const features: GeoJSON.Feature[] = points.map((p) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: {},
  }));

  rulerBox.hidden = false;
  if (!ruler.a) {
    // No point to anchor to yet -- the aircraft itself is as good a default
    // as any, since that is where the first tap usually lands anyway.
    rulerBox.textContent = 'MEAS  —  tap the start point';
    placeFloatingBox(rulerBox, own.lon, own.lat, -40, 150);
  } else if (!ruler.b) {
    rulerBox.textContent = 'MEAS  —  tap the end point';
    placeFloatingBox(rulerBox, ruler.a.lon, ruler.a.lat, -24, 150);
  } else {
    const { a, b } = ruler;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] },
      properties: {},
    });

    const brg = bearingTo(a.lat, a.lon, b.lat, b.lon);
    const nm = metersToNm(distanceTo(a.lat, a.lon, b.lat, b.lon));
    // Time to fly it at what we are doing now -- the number a leg is
    // actually planned on, and useless to work out in your head mid-flight.
    // Over the ground, which is what a leg is flown in.
    const min = own.groundSpeed > 1 ? (nm * M_PER_NM) / own.groundSpeed / 60 : null;
    rulerBox.textContent = [
      nbsp(`MEAS ${bearing3(refBearing(brg))}${refSuffix} / ${nm.toFixed(1)} nm`),
      nbsp(min !== null && min < 600 ? `${min.toFixed(1)} min` : '— min'),
    ].join('   ');
    // Next to the line's midpoint, the same spot regardless of which end
    // was tapped first or last.
    placeFloatingBox(rulerBox, (a.lon + b.lon) / 2, (a.lat + b.lat) / 2, -24, 150);
  }

  setData('ruler', { type: 'FeatureCollection', features });
}

function updateClickInfo(): void {
  if (!clickedPoint) {
    clickInfoBox.hidden = true;
    return;
  }
  clickInfoBox.hidden = false;
  clickInfoBox.textContent = `${formatDDM(clickedPoint.lat, 'NS')} ${formatDDM(clickedPoint.lon, 'EW')}`;
  placeFloatingBox(clickInfoBox, clickedPoint.lon, clickedPoint.lat, -20, 130);
}

function updateBraa(now: number): void {
  if (selectedId === null) {
    braaBox.hidden = true;
    return;
  }
  // Not units.meta (the last raw sample) but the same interpolated position
  // the symbol is actually drawn at, so the readout matches what's on
  // screen, and so a speed is available at all -- units.meta has none.
  const sel = units.at(now).find((c) => c.unit.id === selectedId);
  if (!sel) {
    braaBox.hidden = true;
    return;
  }
  const u = sel.unit;
  const brg = bearingTo(own.lat, own.lon, sel.lat, sel.lon);
  const rng = metersToNm(distanceTo(own.lat, own.lon, sel.lat, sel.lon));
  const asp = aspect(sel.hdg, bearingTo(sel.lat, sel.lon, own.lat, own.lon));

  // The contact's own bullseye position, not ours. A BVR call gives where
  // the bandit is relative to the reference point -- "bullseye 270/45" --
  // and reading it off a display that only knows your own offset means
  // doing the geometry in your head while someone waits on the radio.
  const bullBrg = bearingTo(bullseye.lat, bullseye.lon, sel.lat, sel.lon);
  const bullRng = metersToNm(distanceTo(bullseye.lat, bullseye.lon, sel.lat, sel.lon));

  // Closure and the time it leaves. Range alone does not say whether there is
  // time to think: 40 nm is two and a half minutes head-on and never at all
  // behind a contact that is faster than you.
  //
  // Both sides over the ground: the contact's speed comes from its position
  // deltas, so ours has to be the wind-corrected one rather than airspeed,
  // or the two would not be in the same frame.
  const vc = closureMs(own.track, own.groundSpeed, sel.hdg, sel.spdMs, brg);
  const ttgMin = vc > 1 ? (rng * M_PER_NM) / vc / 60 : null;

  const roleLabel = CATEGORY_LABELS.find(([cat]) => cat === u.category)?.[1] ?? u.category;
  const aff = affiliationOf(u.coalition, ownCoalition).toUpperCase();

  // Each group non-breaking inside, regular spaces between -- same reason
  // as the HUD bar: wraps to further lines on a narrow screen instead of
  // either tearing a group apart or scrolling sideways.
  braaBox.hidden = false;
  braaBox.textContent = [
    nbsp(`${u.name}  —  ${aff} ${roleLabel}`),
    nbsp(`${formatDDM(sel.lat, 'NS')} ${formatDDM(sel.lon, 'EW')}`),
    nbsp(`BRAA ${bearing3(refBearing(brg))}${refSuffix} / ${rng.toFixed(1)} nm`),
    nbsp(`BULLS ${bearing3(refBearing(bullBrg))}${refSuffix}/${Math.round(bullRng)}`),
    nbsp(`${contactAltitude(u.category, u.alt)} ${AIRBORNE.has(u.category) ? 'thousand' : 'ft'}`),
    nbsp(`${aspectLabel(asp)} ${Math.round(asp)}°`),
    nbsp(`${Math.round(msToKnots(sel.spdMs))} kt`),
    nbsp(`Vc ${Math.round(msToKnots(vc))}`),
    nbsp(ttgMin !== null && ttgMin < 60 ? `T ${ttgMin.toFixed(1)} min` : 'T —'),
  ].join('   ');
}

// --- Controls ----------------------------------------------------------------

canvas.addEventListener('click', (e) => {
  if (longPressFired) {
    // The long press already set the bullseye; the click that follows
    // releasing the finger is the same gesture, not a second tap.
    longPressFired = false;
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const pt: [number, number] = [e.clientX - rect.left, e.clientY - rect.top];

  if (ruler) {
    // While measuring, a tap places a point instead of selecting a contact:
    // the two would fight over the same gesture, and you are usually
    // measuring to something rather than from nothing.
    const ll = map.unproject(pt);
    const at = { lat: ll.lat, lon: ll.lng };
    ruler = ruler.b || !ruler.a ? { a: at, b: null } : { a: ruler.a, b: at };
    return;
  }

  if (e.shiftKey) {
    // Shift-click sets the bullseye -- the hook doesn't provide it.
    const ll = map.unproject(pt);
    bullseye = { lat: ll.lat, lon: ll.lng };
    try { localStorage.setItem('dcs-map-server.bullseye', JSON.stringify(bullseye)); } catch { /* doesn't matter */ }
    return;
  }

  const hits = map.queryRenderedFeatures([[pt[0] - 12, pt[1] - 12], [pt[0] + 12, pt[1] + 12]], { layers: ['contacts-dot', 'contacts-air'] });
  const id = hits[0]?.properties?.['id'];

  if (typeof id === 'number') {
    // A contact: toggle it off if it's the one already selected, otherwise
    // switch the readout to it. Either way the BRAA box gets its own
    // coordinate line, so the floating one here would be redundant.
    selectedId = id === selectedId ? null : id;
    selectedTrail = [];
    clickedPoint = null;
  } else {
    // Empty ground. A stray tap elsewhere must never silently drop the BRA
    // line -- only clicking the selected contact again does that -- so the
    // selection is left exactly as it was; this only adds the coordinate
    // readout at the point itself.
    const ll = map.unproject(pt);
    clickedPoint = { lat: ll.lat, lon: ll.lng };
  }
});

const btnCtr = document.getElementById('mode-centre')!;
const btnFree = document.getElementById('mode-free')!;

function setFollow(on: boolean): void {
  follow = on;
  btnCtr.setAttribute('aria-pressed', String(on));
  btnFree.setAttribute('aria-pressed', String(!on));
  for (const el of [btnHdg, btnNorth]) el.toggleAttribute('disabled', !on);
  if (on) ownshipEl.hidden = false;
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
const btnMeasure = document.getElementById('mode-measure')!;
btnMeasure.addEventListener('click', () => {
  ruler = ruler ? null : { a: null, b: null };
  btnMeasure.setAttribute('aria-pressed', String(ruler !== null));
  if (ruler) clickedPoint = null;
});

btnCtr.addEventListener('click', () => setFollow(true));
btnFree.addEventListener('click', () => { setFollow(false); applyFreeZoom(); });
setFollow(true);
// Step buttons in addition to the direct-pick buttons: on a tablet, the
// large tap targets are easier to hit than a specific number.
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

/** Mode and labelling require a new style, everything else just visibility. */
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
 * Symbol legend. Answers the question of what a symbol means right where it
 * comes up -- standard symbology is only an advantage if you can look it up.
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

      // The legend draws from the selected set and has to be rebuilt on a
      // switch -- otherwise it kept showing the previous set.
      if (key === 'symbolSet') buildLegend();
    });
  }
}
bindControls();

// --- Keeping the display awake ----------------------------------------------
//
// Without a wake lock the tablet's display turns off mid-flight. The API is
// only available in a secure context -- so not over http://<LAN-IP>, see
// tools/make-cert.sh. The lock object is released by the browser on
// backgrounding and has to be re-requested afterwards.

let wakeLock: WakeLockSentinel | null = null;

async function acquireWakeLock(): Promise<void> {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    // Refused or not permitted -- the map still works regardless.
    wakeLock = null;
  }
}

export function wakeLockState(): 'active' | 'unavailable' | 'off' {
  if (!('wakeLock' in navigator)) return 'unavailable';
  return wakeLock ? 'active' : 'off';
}

void acquireWakeLock();

// Re-sync on return instead of playing back stale frames.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    units.clear();
    ws?.close();
    void acquireWakeLock();
  }
});

requestAnimationFrame(frame);
