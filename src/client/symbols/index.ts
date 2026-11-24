import type { Map as MLMap } from 'maplibre-gl';
import type { Category, Coalition } from '../../shared/types.js';
import { dcsSet } from './dcs.js';
import { natoSet } from './nato.js';
import {
  type Affiliation,
  DPR,
  SIZE,
  type SymbolSet,
  type SymbolSetId,
  newCanvas,
} from './types.js';

export { CATEGORY_LABELS, affiliationOf } from './types.js';
export type { Affiliation, SymbolSetId } from './types.js';

const SETS: Record<SymbolSetId, SymbolSet> = { nato: natoSet, dcs: dcsSet };

const CATEGORIES: Category[] = [
  'air', 'cargo', 'tanker', 'awacs', 'helo', 'armor', 'ground', 'sam', 'naval',
  'carrier', 'submarine', 'weapon', 'static', 'destroyed', 'unknown',
];
const AFFILIATIONS: Affiliation[] = ['friend', 'hostile', 'neutral', 'unknown'];
const COALITIONS: Coalition[] = [0, 1, 2];

export const symbolSet = (id: SymbolSetId): SymbolSet => SETS[id];

/** Image id. Includes the set, so both sets can coexist. */
export function symbolId(
  set: SymbolSetId,
  category: Category,
  affiliation: Affiliation,
  coalition: Coalition,
): string {
  return `sym-${set}-${SETS[set].key(category, affiliation, coalition)}`;
}

export const symbolRotates = (set: SymbolSetId, category: Category): boolean =>
  SETS[set].rotates(category);

/**
 * Creates all images for both sets.
 *
 * Both at once, since switching would otherwise require rebuilding the style
 * -- the memory cost is negligible at a few dozen 68-ish-pixel images.
 */
/**
 * Bullseye symbol: concentric rings with a crosshair.
 *
 * As a fixed-screen-size image rather than geodetic geometry. Rings in world
 * coordinates competed with the aircraft's own range rings and covered half
 * the view at small range steps.
 */
export const BULLSEYE_IMAGE = 'bullseye';

function renderBullseye(): ImageData {
  const { ctx, px } = newCanvas();
  const s = SIZE;
  const draw = (stroke: string, width: number) => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(s * 0.5, s * 0.5, s * 0.16, 0, Math.PI * 2);
    ctx.moveTo(s * 0.5 + s * 0.34, s * 0.5);
    ctx.arc(s * 0.5, s * 0.5, s * 0.34, 0, Math.PI * 2);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      ctx.moveTo(s * 0.5 + dx * s * 0.1, s * 0.5 + dy * s * 0.1);
      ctx.lineTo(s * 0.5 + dx * s * 0.46, s * 0.5 + dy * s * 0.46);
    }
    ctx.stroke();
  };
  draw('rgba(10,14,18,0.85)', 4);
  draw('#ffb703', 1.9);
  return ctx.getImageData(0, 0, px, px);
}export function registerSymbols(map: MLMap): void {
  if (!map.hasImage(BULLSEYE_IMAGE)) {
    map.addImage(BULLSEYE_IMAGE, renderBullseye(), { pixelRatio: DPR });
  }
  for (const id of Object.keys(SETS) as SymbolSetId[]) {
    const set = SETS[id];
    for (const category of CATEGORIES) {
      for (const affiliation of AFFILIATIONS) {
        for (const coalition of COALITIONS) {
          const key = symbolId(id, category, affiliation, coalition);
          if (map.hasImage(key)) continue;
          map.addImage(key, set.render(category, affiliation, coalition), { pixelRatio: DPR });
        }
      }
    }
  }
}

/**
 * Symbol as a data URL for the legend. Uses the same drawing routine as the
 * map, so the legend can't drift from the rendering.
 */
export function symbolDataUrl(
  set: SymbolSetId,
  category: Category,
  affiliation: Affiliation,
  coalition: Coalition,
): string {
  const { ctx, px } = newCanvas();
  ctx.putImageData(SETS[set].render(category, affiliation, coalition), 0, 0);
  return ctx.canvas.toDataURL();
}

export { SIZE };


