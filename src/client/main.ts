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
  formatMissionClock,
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
  runwayHeadings,
  altitudeThousands,
  closureMs,
  windFrom,
  M_PER_NM,
} from './geo.js';
import { buildGraticule } from './graticule.js';
import { AIRBASE_LABEL, airfieldPanel, buildAirbases, matchNav, registerAirbaseImages } from './airbases.js';
import type { Airbase, AirfieldNav, Zone } from '../shared/types.js';
import { buildZones } from './zones.js';
import { findPlaces, type Place } from './find.js';
import { buildBullseye, buildLeaders, buildRings, buildThreatRings } from './overlays.js';
import { theaterAt, theaterContains } from '../shared/theaters.js';
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

// Shown at the bottom of the settings panel, so a user reporting a problem
// can say which build they run. Not awaited: nothing else depends on it.
void fetch('/api/version')
  .then((r) => r.json() as Promise<{ version: string }>)
  .then((v) => {
    document.getElementById('version')!.textContent = `DCS Map Server ${v.version}`;
  })
  .catch(() => {});

if (available.length > 0 && !available.includes(settings.theater)) {
  settings = { ...settings, theater: available[0]! };
  cfg.save(settings);
}
const own = new OwnshipEstimator();
const units = new UnitBuffer();

/**
 * Map orientation. North-up by default, like the F10 map and a paper chart:
 * labels and the grid read straight, and a glance shows which way north is.
 * Heading-up is one tap away (HDG) for flying an approach. Remembered in the
 * browser, like the range below (see saveView).
 */
let headingUp = settings.headingUp;

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
let manualZoom: number | null = settings.manualZoom;
let connected = false;
let lastSeq = 0;
/** Visibility rule as DCS reports it. Decides whether contacts come through at all. */
let optionsView: OptionsView = 'optview_all';
/** The server has DCS's object export switched off: no other unit will arrive. */
let objectsBlocked = false;
/**
 * Range step rather than free zoom. The index points into RANGES_NM; the
 * zoom level is computed from it every frame, so "40 nm" means the same
 * distance regardless of window size or latitude.
 */
let rangeIndex = Math.min(Math.max(0, Math.round(settings.rangeIndex)), RANGES_NM.length - 1);

/**
 * Keeps orientation and range in the browser, so the map opens the way it
 * was left. Checked from the render loop rather than wired into every place
 * that changes them (buttons, wheel, pinch, keys): it writes only when
 * something actually changed, and at most twice a second.
 */
let lastViewSave = 0;
function saveView(now: number): void {
  if (now - lastViewSave < 500) return;
  lastViewSave = now;
  const z = manualZoom === null ? null : Math.round(manualZoom * 100) / 100;
  if (settings.headingUp === headingUp && settings.rangeIndex === rangeIndex && settings.manualZoom === z) return;
  settings = { ...settings, headingUp, rangeIndex, manualZoom: z };
  cfg.save(settings);
}
let zoom = 9;
let selectedId: number | null = null;
/** Reference for affiliation: your own coalition is friend. */
let ownCoalition: Coalition = 2;

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * The active entry of the TOOLS menu. A tool takes over a tap on the map,
 * which is why only one can be active and why 'off' is the default: then a
 * tap only selects contacts, and the map stays quiet. Not remembered across
 * reloads -- a tool still armed from last time would just surprise.
 *
 * A menu rather than a modifier because the thing is meant to be used on a
 * tablet, where there is no keyboard to hold anything down with.
 */
type Tool = 'off' | 'measure' | 'coord';
let tool: Tool = 'off';

/**
 * Two-point measurement, while the Measure tool is active: the first tap
 * sets the start, the second the end, and a further tap starts over.
 */
let ruler: { a: { lat: number; lon: number } | null; b: { lat: number; lon: number } | null } | null = null;

/**
 * Where the Coordinates tool was last tapped. The readout floats right
 * there: coordinates, plus bearing and range from the own aircraft and the
 * bullseye.
 */
let clickedPoint: { lat: number; lon: number } | null = null;

/**
 * A fixed ground reference, set by double-clicking open ground: the BRAA
 * box's bearing/range/bullseye/closure, but to a point rather than a
 * contact -- useful for a rally point, a run-in heading, or anywhere you
 * just want the numbers to without waiting for something to fly there.
 *
 * Detected by hand rather than the browser's own dblclick event: that fires
 * after two ordinary click events already ran, which would select a
 * contact on the first click and immediately deselect it again on the
 * second -- a double-click on a contact would silently cancel itself out.
 */
let groundTarget: GroundTarget | null = null;

/**
 * A fixed point to fly to: a double-tapped spot, a zone picked in Find, or
 * an airfield picked by tapping its symbol, which also brings its name,
 * elevation and runway.
 */
interface GroundTarget {
  lat: number;
  lon: number;
  /** Set for an airfield; also what a second tap on it compares against. */
  name?: string;
  /** A zone's name, shown in place of "GROUND REF". */
  label?: string;
  /** The airfield itself, as DCS reports it. */
  base?: Airbase;
  /** Tower frequencies and navaids, if the setup could read them from DCS. */
  nav?: AirfieldNav | null;
}

/**
 * Tracks every click, not just ones on open ground: a double-click on a
 * contact goes through the ordinary single-click toggle twice too (select,
 * then immediately deselect again), so recognising the pair has to cover
 * both branches, not just the ground one.
 */
let lastClickAt: { t: number; pt: [number, number] } | null = null;
const DOUBLE_CLICK_MS = 400;
const DOUBLE_CLICK_PX = 10;

/** The user sets the bullseye themselves -- the export hook doesn't provide one. */
let bullseye: { lat: number; lon: number } = (() => {
  try {
    const raw = localStorage.getItem('dcs-map-server.bullseye');
    if (raw) return JSON.parse(raw) as { lat: number; lon: number };
  } catch {
    /* no stored value, fall through to the default */
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

/**
 * The +/- buttons zoom freely, one zoom level per press (half or double the
 * visible range), the same way the wheel and pinch do -- not between the
 * presets, which only exist as shortcuts. Stepping through the presets
 * stopped dead at 1 nm and 160 nm.
 */
function stepZoom(levels: number): void {
  manualZoom = Math.max(0, Math.min(22, (manualZoom ?? map.getZoom()) + levels));
  // Follow mode applies manualZoom itself every frame; free mode needs it here.
  if (!follow) map.jumpTo({ zoom: manualZoom });
  updateRangeLabel();
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
  // Escape closes the menu, or else switches the active tool off.
  if (e.key === 'Escape') {
    if (!menuPanel.hidden) closeMenu();
    else if (tool !== 'off') setTool('off');
    return;
  }
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

// iOS Safari zooms the whole page on a pinch regardless of user-scalable=no
// and, in some versions, of touch-action too. Its own gesture events are the
// one hook it reliably honours; cancelling them leaves the map's pinch (built
// on pointer events) untouched, since those are separate events.
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

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
  registerAirbaseImages(map);
  const c = CHART_COLORS[settings.mode];
  const ink = c.ink;

  for (const id of ['graticule', 'zones', 'airbases', 'threats', 'rings', 'bullseye', 'track', 'selected-trail', 'braa-line', 'leaders', 'ruler', 'contacts'] as const) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: EMPTY });
  }
  // A restyle drops the layers; the next updateSources refills the new ones.
  airbasesDirty = true;
  zonesDirty = true;

  // Mission zones, drawn the way the F10 map shows them (see zones.ts for
  // the three kinds): objectives as a red translucent area with the name in
  // bold behind a star; an airfield zone blue when DCS reports its base blue;
  // the large ship and patrol sectors as a pale, barely-there area with a
  // thin edge, the way F10 shows them, and never red -- they aren't held by
  // anyone.
  if (!map.getLayer('zones-fill')) {
    const side = (red: string, blue: string, none: string): maplibregl.ExpressionSpecification =>
      ['match', ['get', 'side'], 'red', red, 'blue', blue, none];
    const sectorInk = settings.mode === 'night' ? '#c7d3e0' : '#41566e';
    map.addLayer({
      id: 'zones-fill', type: 'fill', source: 'zones',
      paint: {
        'fill-color': side('#e0303a', '#3b82e0', '#ffffff'),
        'fill-opacity': ['match', ['get', 'kind'], 'sector', 0.18, 0.32],
      },
    });
    map.addLayer({
      id: 'zones-line', type: 'line', source: 'zones',
      paint: {
        'line-color': side('#e0303a', '#3b82e0', sectorInk),
        'line-width': ['match', ['get', 'kind'], 'sector', 1, 1.2],
        'line-opacity': 0.85,
      },
    });
    map.addLayer({
      id: 'zones-label', type: 'symbol', source: 'zones',
      layout: {
        // A star marks something that can be taken; a sector just has a name.
        'text-field': ['match', ['get', 'kind'], 'sector', ['get', 'name'], ['concat', '★ ', ['get', 'name']]],
        'text-font': ['Noto Sans Medium'],
        'text-size': ['match', ['get', 'kind'], 'sector', 14, 12],
        // Beside an objective, like F10; in the middle of a sector.
        'text-anchor': ['match', ['get', 'kind'], 'sector', 'center', 'left'],
        'text-offset': ['match', ['get', 'kind'], 'sector', ['literal', [0, 0]], ['literal', [1.2, 0]]],
        'text-optional': true,
      },
      paint: {
        'text-color': side('#b3121c', '#1f5fb8', sectorInk),
        'text-halo-color': settings.mode === 'night' ? '#1a1d22' : '#f4efe6',
        'text-halo-width': 2.2,
      },
    });
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

  // DCS's airbases: below every contact and overlay, above the base map.
  if (!map.getLayer('airbases-icon')) {
    map.addLayer({
      id: 'airbases-icon', type: 'symbol', source: 'airbases',
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-rotate': ['get', 'hdgDeg'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        // Grows as you zoom in: modest in the overview, where there are many
        // and they shouldn't crowd the picture; large close in, where you
        // look for one field and want to hit it with a finger.
        'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.95, 9, 1.2, 12, 1.6],
      },
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

  // Airfield names last, above everything: the symbols sit under the
  // contacts (so they hide no unit), but a name under a contact's label was
  // unreadable exactly where it matters -- fields are crowded with parked
  // aircraft and vehicles.
  if (!map.getLayer('airbases-label')) {
    map.addLayer({
      id: 'airbases-label', type: 'symbol', source: 'airbases',
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11.5, 12, 14],
        'text-anchor': 'top',
        'text-offset': ['interpolate', ['linear'], ['zoom'], 6, ['literal', [0, 1.3]], 12, ['literal', [0, 1.9]]],
        // Always shown: a few dozen per theater, and the one thing on the
        // map you navigate by. As text-optional it lost out to a town name or
        // a contact label next to it and quietly vanished.
        'text-allow-overlap': true,
      },
      paint: { 'text-color': AIRBASE_LABEL[settings.mode], 'text-halo-color': c.earth, 'text-halo-width': 1.8 },
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
  vis('airbases-label', settings.mapLabels);
  vis('zones-fill', settings.zones);
  vis('zones-line', settings.zones);
  vis('zones-label', settings.zones && settings.mapLabels);
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

/**
 * The theater the own aircraft was last found in. Switching only when this
 * changes, not on every update, keeps a theater picked by hand in the
 * settings: it holds until the aircraft turns up in a different theater.
 */
let autoTheater: string | null = null;

/**
 * Switches the map to the theater the own aircraft is in, so the right tiles
 * load without anyone having to pick them. Only theaters with tiles on the
 * server are candidates; outside all of them nothing changes.
 */
function followTheater(lat: number, lon: number): void {
  const found = theaterContains(settings.theater, lat, lon) ? settings.theater : theaterAt(lat, lon, available);
  if (!found || found === autoTheater) return;
  autoTheater = found;
  if (found === settings.theater) return;

  settings = { ...settings, theater: found };
  cfg.save(settings);
  const sel = panel.querySelector<HTMLSelectElement>('[data-key="theater"]');
  if (sel) sel.value = found;
  restyle();
}

// --- WebSocket -------------------------------------------------------------

let ws: WebSocket | null = null;
let backoff = 500;
const trackPoints: Array<[number, number]> = [];
/** Trail of the selected contact. Cleared whenever the selection changes. */
let selectedTrail: Array<[number, number]> = [];

/**
 * Airfield frequencies and navaids for the current theater, from the server
 * (read from the local DCS install at setup). Fetched once per theater; an
 * empty list when there are none, and the map works the same without.
 */
let navFields: AirfieldNav[] = [];
let navTheater: string | null = null;

function loadNavFor(theater: string): void {
  if (navTheater === theater) return;
  navTheater = theater;
  navFields = [];
  void fetch(`/api/navdata/${encodeURIComponent(theater)}`)
    .then((r) => r.json() as Promise<AirfieldNav[]>)
    .then((fields) => {
      if (navTheater === theater) navFields = Array.isArray(fields) ? fields : [];
    })
    .catch(() => {});
}

/** The mission's trigger zones, by id; static per mission. */
const zones = new Map<number, Zone>();
let zonesDirty = false;

function updateZones(): void {
  if (!zonesDirty || !map.getSource('zones')) return;
  zonesDirty = false;
  setData('zones', buildZones(zones.values(), airbases.values()));
}

/** DCS's own airbases, by id. Rebuilt into the map layer when dirty, see updateAirbases. */
const airbases = new Map<number, Airbase>();
let airbasesDirty = false;
let lastAirbaseBuild = 0;

/**
 * Rebuilds the airbase layer on a change, and every few seconds anyway: the
 * carrier filter in buildAirbases depends on which contacts exist, and a
 * carrier's own unit can arrive after its base entry.
 *
 * While DCS supplies airbases, the OpenStreetMap airfield names are hidden --
 * those are the real world's airfields, which DCS's don't always match, and
 * both at once would put two names on most fields.
 */
function updateAirbases(now: number, contactIds: ReadonlySet<number>): void {
  loadNavFor(settings.theater);
  if (!airbasesDirty && now - lastAirbaseBuild < 5000) return;
  airbasesDirty = false;
  lastAirbaseBuild = now;
  // Airfield zones take their base's side, so they follow airbase changes.
  zonesDirty = true;
  setData('airbases', buildAirbases(airbases.values(), contactIds));
  if (map.getLayer('aero-airfield')) {
    map.setLayoutProperty('aero-airfield', 'visibility', airbases.size > 0 ? 'none' : 'visible');
  }
}

/** When the last live ownship update arrived (performance.now()); null before the first. */
let lastOwnAt: number | null = null;
/** Matches the server's console: quieter than this, and DCS is paused, loading or gone. */
const DCS_QUIET_MS = 10_000;
const linkEl = document.getElementById('link')!;

/**
 * Says why the map isn't moving: no server, or no data from DCS. Neutral
 * wording on purpose -- a paused or loading DCS is normal, nothing is broken.
 * Runs every frame, outside the own.ready block, so it also shows before
 * the first data ever arrives.
 */
function updateLink(now: number): void {
  let text: string | null = null;
  if (!connected) text = 'CONNECTING TO MAP SERVER …';
  else if (lastOwnAt === null) text = 'WAITING FOR DCS …';
  else if (now - lastOwnAt > DCS_QUIET_MS) {
    text = `WAITING FOR DCS · last data ${Math.round((now - lastOwnAt) / 1000)} s ago`;
  }
  linkEl.hidden = text === null;
  if (text !== null && linkEl.textContent !== text) linkEl.textContent = text;
}

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
      airbases.clear();
      for (const b of msg.airbases ?? []) airbases.set(b.id, b);
      airbasesDirty = true;
      zones.clear();
      for (const z of msg.zones ?? []) zones.set(z.id, z);
      zonesDirty = true;
      if (msg.own) { own.update(msg.own); ownCoalition = msg.own.coalition; followTheater(msg.own.lat, msg.own.lon); }
    } else {
      // Deltas only: a snapshot repeats the server's last known ownship even
      // when DCS has long gone quiet, so it says nothing about live data.
      if (msg.own) lastOwnAt = now;
      if (msg.own) { own.update(msg.own); ownCoalition = msg.own.coalition; followTheater(msg.own.lat, msg.own.lon); }
      if (msg.airbasesCleared) { airbases.clear(); airbasesDirty = true; }
      for (const b of msg.airbases ?? []) { airbases.set(b.id, b); airbasesDirty = true; }
      if (msg.zonesCleared) { zones.clear(); zonesDirty = true; }
      for (const z of msg.zones ?? []) { zones.set(z.id, z); zonesDirty = true; }
      for (const u of msg.units ?? []) units.push(u, now);
      for (const id of msg.removed ?? []) units.remove(id);
    }
    lastSeq = msg.seq;
    optionsView = msg.optionsView;
    if (msg.objectsBlocked !== undefined) objectsBlocked = msg.objectsBlocked;
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
      // Heading-up: the aircraft sits in the lower third, so more of the view
      // lies ahead. A third of the height as top padding moves the padded
      // centre there. North-up stays centred.
      const top = headingUp ? Math.round(map.getCanvas().clientHeight / 3) : 0;
      map.jumpTo({ center: [own.lon, own.lat], bearing: headingUp ? toDeg(own.hdg) : 0, zoom, padding: { top, bottom: 0, left: 0, right: 0 } });
    }

    // The symbol's own heading minus however much the map itself is already
    // rotated (the bearing is the compass direction pointing up) -- not a
    // fixed per-mode case. Heading-up follow sets the map's bearing to the
    // heading, which makes this always resolve to 0 there (the
    // map rotates under the symbol instead). North-up follow and free mode
    // (which now keeps whatever bearing was active on leaving follow,
    // rather than forcing north-up) fall out of the same formula without
    // needing their own case.
    const symbolRotation = toDeg(own.hdg) - map.getBearing();
    ownshipEl.style.transform = `translate(-50%, -55%) rotate(${symbolRotation.toFixed(1)}deg)`;
    placeOwnship();

    if (now - lastSources > 1000 / SOURCE_HZ) {
      lastSources = now;
      updateSources(now);
    }
    updateHud(now);
  }

  // The graticule depends on the view, not on time; once a second or on a
  // zoom change is enough. Reads the map's own zoom rather than `zoom`, which
  // only follow mode keeps current -- a wheel zoom in free mode left the grid
  // at the old, finer step. Outside the own.ready block, so the grid also
  // follows the view before any telemetry has arrived.
  if (!document.hidden) updateLink(now);
  saveView(now);

  const mapZoom = map.getZoom();
  if (!document.hidden && (now - lastGrid > 1000 || Math.abs(mapZoom - lastZoomForGrid) > 0.01)) {
    lastGrid = now;
    lastZoomForGrid = mapZoom;
    updateGraticule();
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
  updateAirbases(now, new Set(contacts.map((u) => u.unit.id)));
  updateZones();

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
        // Moving like something flying, not taxiing or parked -- decides
        // whether a tap on an airfield picks this contact or the field.
        flying: AIRBORNE.has(u.unit.category) && u.spdMs > FLYING_MS,
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
  } else if (groundTarget) {
    // A fixed point has no trail of its own to draw -- just the line to it.
    braaLine = [[own.lon, own.lat], [groundTarget.lon, groundTarget.lat]];
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
    map.getZoom(),
  ));
}

// --- Display -----------------------------------------------------------------

const hud = document.getElementById('hud')!;
const braaBox = document.getElementById('braa')!;
// On a small screen the readout can cover half the map: a tap folds it down to
// its title line. The state is the user's, so it survives the refresh that
// rewrites the content (it only changes the class, not the children).
braaBox.addEventListener('click', () => {
  if (window.matchMedia('(max-width: 480px)').matches) braaBox.classList.toggle('min');
});
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
    ownshipEl.style.top = headingUp ? `${200 / 3}%` : '50%';
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
    // Mission clock time, as on the F10 map -- not the wall clock, which every
    // device already shows, and not elapsed time, which means nothing in the
    // cockpit. Doubles as a feed-health check: if it stops advancing, so has
    // everything else.
    nbsp(`${connected ? '●' : '○'} ${formatMissionClock(own.missionStart, own.modelTime)}`),
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
  //
  // Two different causes, said differently: the mission restricting the view
  // (a setting of the mission), or the server not handing DCS's objects out at
  // all (a setting of the server) -- there the map is empty of every other
  // unit, friend and foe, whatever the view.
  const withheld = optionsView === 'optview_onlymap' || optionsView === 'optview_myaircraft';
  const warning = objectsBlocked
    ? 'SERVER BLOCKS OTHER UNITS (object export disabled)'
    : withheld
      ? `CONTACTS WITHHELD BY MISSION (${optionsView})`
      : null;
  warnEl.hidden = warning === null;
  if (warning !== null && warnEl.textContent !== warning) warnEl.textContent = warning;

  updateBraa(now);
  updateRuler();
  updateClickInfo();
}

const rulerBox = document.getElementById('ruler')!;
const clickInfoBox = document.getElementById('clickinfo')!;
const coordMark = document.getElementById('coordmark')!;

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
    coordMark.hidden = true;
    return;
  }
  clickInfoBox.hidden = false;
  // The cross sits exactly on the spot and follows it as the map moves or
  // turns; unlike the readout it isn't clamped to the screen -- off screen,
  // the spot is simply off screen.
  const at = map.project([clickedPoint.lon, clickedPoint.lat]);
  coordMark.hidden = false;
  coordMark.style.left = `${at.x}px`;
  coordMark.style.top = `${at.y}px`;
  const p = clickedPoint;
  // Bearing and range *to* the point, the way you'd fly or call it.
  const braTo = (from: { lat: number; lon: number }): string =>
    `${bearing3(refBearing(bearingTo(from.lat, from.lon, p.lat, p.lon)))}${refSuffix}` +
    ` / ${metersToNm(distanceTo(from.lat, from.lon, p.lat, p.lon)).toFixed(1)} nm`;
  const lines = [`${formatDDM(p.lat, 'NS')} ${formatDDM(p.lon, 'EW')}`];
  if (own.ready) lines.push(`OWN   ${braTo(own)}`);
  lines.push(`BULLS ${braTo(bullseye)}`);
  clickInfoBox.textContent = lines.join('\n');
  // High enough above the spot to clear the cross's upper arm.
  placeFloatingBox(clickInfoBox, clickedPoint.lon, clickedPoint.lat, -30, 130);
}

/**
 * Room for a proper readout: on a large monitor the BRA data is laid out as
 * label/value pairs in two columns, in the order it goes over the radio --
 * bearing, range, altitude, aspect, then speed, closure, time, bullseye --
 * the way an MFD page or a kneeboard card shows it. A phone or narrow tablet
 * keeps the single wrapping line, which costs far less of the map.
 */
const wideReadout = window.matchMedia('(min-width: 900px) and (min-height: 560px)');

function renderReadout(title: string, pairs: Array<[string, string]>, position: string): void {
  const head = document.createElement('div');
  head.className = 'ro-head';
  head.textContent = title;
  const grid = document.createElement('div');
  grid.className = 'ro-grid';
  for (const [label, value] of pairs) {
    const l = document.createElement('span');
    l.className = 'ro-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'ro-value';
    v.textContent = value;
    grid.append(l, v);
  }
  const pos = document.createElement('div');
  pos.className = 'ro-pos';
  pos.textContent = position;
  braaBox.replaceChildren(head, grid, pos);
}

function updateBraa(now: number): void {
  if (selectedId === null) {
    if (groundTarget) updateGroundTargetBraa(groundTarget);
    else braaBox.hidden = true;
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

  braaBox.hidden = false;
  if (wideReadout.matches) {
    renderReadout(`${u.name} — ${aff} ${roleLabel}`, [
      ['BRG', `${bearing3(refBearing(brg))}°${refSuffix}`], ['RNG', `${rng.toFixed(1)} nm`],
      ['ALT', `${contactAltitude(u.category, u.alt)} ${AIRBORNE.has(u.category) ? 'thousand' : 'ft'}`],
      ['ASPECT', `${aspectLabel(asp)} ${Math.round(asp)}°`],
      ['SPD', `${Math.round(msToKnots(sel.spdMs))} kt`], ['Vc', `${Math.round(msToKnots(vc))} kt`],
      ['TIME', ttgMin !== null && ttgMin < 60 ? `${ttgMin.toFixed(1)} min` : '—'],
      ['BULLS', `${bearing3(refBearing(bullBrg))}${refSuffix}/${Math.round(bullRng)}`],
    ], `${formatDDM(sel.lat, 'NS')} ${formatDDM(sel.lon, 'EW')}`);
    return;
  }
  // Each group non-breaking inside, regular spaces between -- same reason
  // as the HUD bar: wraps to further lines on a narrow screen instead of
  // either tearing a group apart or scrolling sideways.
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

/**
 * The BRAA box for a fixed ground reference instead of a contact: no name,
 * category, altitude, aspect or speed, since none of that applies to a
 * point -- but bearing, range, bullseye position and closure still mean
 * exactly the same thing, closure here being simply how fast you yourself
 * are covering the ground towards it (the point has no speed of its own to
 * net out, so passing zero for both leaves only your own along-track
 * component).
 */
function updateGroundTargetBraa(target: GroundTarget): void {
  const brg = bearingTo(own.lat, own.lon, target.lat, target.lon);
  const rng = metersToNm(distanceTo(own.lat, own.lon, target.lat, target.lon));
  const bullBrg = bearingTo(bullseye.lat, bullseye.lon, target.lat, target.lon);
  const bullRng = metersToNm(distanceTo(bullseye.lat, bullseye.lon, target.lat, target.lon));
  const vc = closureMs(own.track, own.groundSpeed, 0, 0, brg);
  const ttgMin = vc > 1 ? (rng * M_PER_NM) / vc / 60 : null;

  const coords = nbsp(`${formatDDM(target.lat, 'NS')} ${formatDDM(target.lon, 'EW')}`);
  const braa = [
    nbsp(`BRAA ${bearing3(refBearing(brg))}${refSuffix} / ${rng.toFixed(1)} nm`),
    nbsp(`BULLS ${bearing3(refBearing(bullBrg))}${refSuffix}/${Math.round(bullRng)}`),
    nbsp(`Vc ${Math.round(msToKnots(vc))}`),
    nbsp(ttgMin !== null && ttgMin < 60 ? `T ${ttgMin.toFixed(1)} min` : 'T —'),
  ].join('   ');

  braaBox.hidden = false;
  if (target.name === undefined) {
    if (wideReadout.matches) {
      renderReadout(target.label ?? 'GROUND REF', [
        ['BRG', `${bearing3(refBearing(brg))}°${refSuffix}`], ['RNG', `${rng.toFixed(1)} nm`],
        ['Vc', `${Math.round(msToKnots(vc))} kt`],
        ['TIME', ttgMin !== null && ttgMin < 60 ? `${ttgMin.toFixed(1)} min` : '—'],
        ['BULLS', `${bearing3(refBearing(bullBrg))}${refSuffix}/${Math.round(bullRng)}`],
      ], `${formatDDM(target.lat, 'NS')} ${formatDDM(target.lon, 'EW')}`);
      return;
    }
    braaBox.textContent = [nbsp(target.label ?? 'GROUND REF'), coords, braa].join('   ');
    return;
  }

  // An airfield: the rows of DCS's own F10 airfield window, as far as there
  // is data for them, with the line to it on top -- see airfieldPanel.
  if (!target.base) return;
  braaBox.textContent = airfieldPanel(target.base, target.nav ?? null, {
    magVarDeg: magVar(),
    braa,
    elevFt: Math.round(metersToFeet(target.base.alt)),
    coords,
  }).join('\n');
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

  if (tool === 'coord') {
    // The Coordinates tool owns the tap, contacts included: you are asking
    // where that spot is, not selecting what happens to sit on it.
    const ll = map.unproject(pt);
    clickedPoint = { lat: ll.lat, lon: ll.lng };
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
  // An airfield is almost always covered by parked aircraft, vehicles and
  // buildings; if every contact beat it, an airfield could never be picked.
  // So an airfield wins over anything on the ground -- a parked jet included
  // -- and only something actually flying wins over the airfield.
  const base = airbaseAt(pt);
  const airborneHit = hits.find((h) => h.properties?.['flying'] === true);
  const id = base && !airborneHit ? undefined : (airborneHit ?? hits[0])?.properties?.['id'];

  const now = performance.now();
  const isDoubleClick =
    lastClickAt !== null &&
    now - lastClickAt.t < DOUBLE_CLICK_MS &&
    Math.hypot(pt[0] - lastClickAt.pt[0], pt[1] - lastClickAt.pt[1]) < DOUBLE_CLICK_PX;
  lastClickAt = { t: now, pt };

  if (typeof id === 'number') {
    // A contact. The first click of a double-click already toggles the
    // selection; re-running that same toggle on the second click would
    // just undo it, so the second click is a no-op here -- its only job is
    // to not get in the way, since a double-click's real effect (should the
    // user actually be double-clicking open ground nearby) happens below.
    if (!isDoubleClick) {
      selectedId = id === selectedId ? null : id;
      selectedTrail = [];
    }
    // A contact takes priority over any ground reference point showing.
    groundTarget = null;
  } else if (base) {
    // An airfield: the same line and readout as a ground reference point,
    // plus its name, elevation, runway and frequencies -- what an approach
    // needs. Tapping the same field again drops it, like tapping a selected
    // contact. The second tap of a double-click is ignored, as for contacts.
    if (!isDoubleClick) {
      groundTarget = groundTarget?.name === base.name
        ? null
        : { lat: base.lat, lon: base.lon, name: base.name, base, nav: matchNav(base, navFields) };
      selectedId = null;
      selectedTrail = [];
    }
  } else if (zoneAt(pt)) {
    // A mission zone (FOB, objective): BRA to its centre, named. Tapping the
    // same zone again drops it. Sectors don't count -- they're huge, and a
    // tap anywhere inside would pick one.
    const z = zoneAt(pt)!;
    if (!isDoubleClick) {
      groundTarget = groundTarget?.label === z.label ? null : z;
      selectedId = null;
      selectedTrail = [];
    }
  } else if (isDoubleClick) {
    // Empty ground. A single stray tap does nothing -- it must never
    // silently drop the BRA line, only clicking the selected contact again
    // does that; coordinates are the Coordinates tool's job. A double-click
    // sets a BRAA reference point right there, the ground equivalent of
    // selecting a contact.
    const ll = map.unproject(pt);
    groundTarget = { lat: ll.lat, lon: ll.lng };
    selectedId = null;
    selectedTrail = [];
  }
});

/** Above this ground speed (about 60 kt) an aircraft counts as flying, not taxiing. */
const FLYING_MS = 30;

/** The objective zone under a screen point, as a ground target at its centre, if any. */
function zoneAt(pt: [number, number]): GroundTarget | null {
  if (!map.getLayer('zones-fill') || !settings.zones) return null;
  const hit = map
    .queryRenderedFeatures([[pt[0] - 6, pt[1] - 6], [pt[0] + 6, pt[1] + 6]], { layers: ['zones-fill'] })
    .find((f) => f.properties?.['kind'] !== 'sector');
  const name = hit?.properties?.['name'];
  if (typeof name !== 'string') return null;
  const z = [...zones.values()].find((x) => x.name === name);
  return z ? { lat: z.lat, lon: z.lon, label: `★ ${z.name.toUpperCase()}` } : null;
}

/** The airfield whose symbol is under a screen point, if any. */
function airbaseAt(pt: [number, number]): Airbase | null {
  if (!map.getLayer('airbases-icon')) return null;
  const hit = map.queryRenderedFeatures([[pt[0] - 14, pt[1] - 14], [pt[0] + 14, pt[1] + 14]], { layers: ['airbases-icon'] })[0];
  const id = hit?.properties?.['id'];
  return typeof id === 'number' ? airbases.get(id) ?? null : null;
}

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
// --- Menu: tools and settings ---------------------------------------------------
//
// One button for both, to save room in the bar: the tools sit at the top of
// the settings panel. The button stays the place that shows an active tool
// (yellow, named after it), since that is what explains why a tap on the map
// isn't selecting a contact.

const menuToggle = document.getElementById('menu-toggle')!;
const menuPanel = document.getElementById('settings')!;
const toolsMenu = document.getElementById('tools-menu')!;
const TOOL_LABEL: Record<Tool, string> = { off: 'MENU', measure: 'MEAS', coord: 'COORD' };

/** The status bar along the top; the menu must not reach under it. */
const MENU_TOP_PX = 52;

/**
 * Fits the menu between the status bar and the control bar, in what is
 * actually visible: the visual viewport, without a mobile browser's own
 * toolbars, and above the control bar at whatever height it has wrapped to
 * (two rows on a phone). With a fixed offset and 100vh it ran off the top of
 * a tablet, cutting off the tools.
 */
function placeMenu(): void {
  const viewH = window.visualViewport?.height ?? window.innerHeight;
  const barTop = document.getElementById('controls')!.getBoundingClientRect().top;
  const bottom = Math.max(8, window.innerHeight - barTop + 8);
  menuPanel.style.bottom = `${bottom}px`;
  menuPanel.style.maxHeight = `${Math.max(160, viewH - bottom - MENU_TOP_PX)}px`;
}

function openMenu(): void {
  menuPanel.hidden = false;
  menuToggle.setAttribute('aria-expanded', 'true');
  placeMenu();
  updateStatus();
  buildLegend();
}

// Rotating the tablet or a toolbar sliding in changes the room it has.
for (const target of [window, window.visualViewport].filter(Boolean) as EventTarget[]) {
  target.addEventListener('resize', () => { if (!menuPanel.hidden) placeMenu(); });
}

function closeMenu(): void {
  menuPanel.hidden = true;
  menuToggle.setAttribute('aria-expanded', 'false');
}

/**
 * Switches the active tool. Each switch starts clean: a half-finished
 * measurement or a coordinate readout from the previous tool would just be
 * clutter next to the new one.
 */
function setTool(next: Tool): void {
  tool = next;
  ruler = next === 'measure' ? { a: null, b: null } : null;
  clickedPoint = null;
  if (next !== 'off') groundTarget = null;
  menuToggle.textContent = `☰ ${TOOL_LABEL[next]}`;
  menuToggle.setAttribute('aria-pressed', String(next !== 'off'));
  for (const item of Array.from(toolsMenu.querySelectorAll<HTMLButtonElement>('[data-tool]'))) {
    item.setAttribute('aria-checked', String(item.dataset['tool'] === next));
  }
  // Picking a tool means the next thing is a tap on the map, so the menu
  // gets out of the way. Off leaves it open -- you may be there for settings.
  if (next !== 'off') closeMenu();
}

menuToggle.addEventListener('click', () => {
  if (menuPanel.hidden) openMenu();
  else closeMenu();
});
toolsMenu.addEventListener('click', (e) => {
  const item = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tool]');
  if (item) setTool(item.dataset['tool'] as Tool);
});
// A tap on the map closes the menu without changing anything. Only the
// map: a tap on the bar (zooming, say) leaves the settings open.
canvas.addEventListener('pointerdown', () => {
  if (!menuPanel.hidden) closeMenu();
});

btnCtr.addEventListener('click', () => setFollow(true));
btnFree.addEventListener('click', () => { setFollow(false); applyFreeZoom(); });
setFollow(true);
// Step buttons in addition to the direct-pick buttons: on a tablet, the
// large tap targets are easier to hit than a specific number. They zoom
// freely, past the smallest and largest preset.
document.getElementById('range-out')!.addEventListener('click', () => stepZoom(-1));
document.getElementById('range-in')!.addEventListener('click', () => stepZoom(1));
for (const nm of RANGE_PRESETS_NM) {
  document.getElementById(`range-${nm}`)!.addEventListener('click', () => setRange(nm));
}
updateRangeLabel();

// --- Find --------------------------------------------------------------------
//
// Search box at the top of the menu: zones and airfields by name. Picking a
// hit jumps there -- free mode, zoomed in on it -- and selects it, so the line
// and readout point at it at once; CTR brings the view back to the aircraft.

const findInput = document.getElementById('find') as HTMLInputElement;
const findResults = document.getElementById('find-results')!;
/** How close a jump zooms in: about 10 nm across the short side of the screen. */
const FIND_RANGE_NM = 10;

function renderFind(): void {
  const hits = findPlaces(findInput.value, zones.values(), airbases.values());
  findResults.replaceChildren(
    ...hits.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      const name = document.createElement('span');
      name.textContent = p.name;
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = p.kind === 'airfield' ? 'airfield' : 'zone';
      b.append(name, kind);
      b.addEventListener('click', () => jumpTo(p));
      return b;
    }),
  );
  if (findInput.value.trim() && hits.length === 0) {
    const none = document.createElement('div');
    none.className = 'kind';
    none.textContent = zones.size || airbases.size ? 'nothing found' : 'no zones or airfields yet';
    findResults.replaceChildren(none);
  }
}

function jumpTo(p: Place): void {
  setFollow(false);
  const shortSide = Math.min(map.getCanvas().clientWidth, map.getCanvas().clientHeight);
  manualZoom = Math.max(map.getZoom(), zoomForRange(FIND_RANGE_NM, p.lat, shortSide));
  map.jumpTo({ center: [p.lon, p.lat], zoom: manualZoom });
  selectedId = null;
  selectedTrail = [];
  if (tool !== 'off') setTool('off');
  groundTarget = p.base
    ? { lat: p.lat, lon: p.lon, name: p.base.name, base: p.base, nav: matchNav(p.base, navFields) }
    : { lat: p.lat, lon: p.lon, label: p.name.toUpperCase() };
  closeMenu();
}

findInput.addEventListener('input', renderFind);
findInput.addEventListener('keydown', (e) => {
  // Enter takes the first hit, the quick way on a keyboard.
  if (e.key === 'Enter') {
    const first = findPlaces(findInput.value, zones.values(), airbases.values(), 1)[0];
    if (first) jumpTo(first);
  }
});

const panel = menuPanel;
const statusLine = document.getElementById('status')!;

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
// "HTTPS on a LAN" in docs/DEVELOPERS.md. The lock object is released by the browser on
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
