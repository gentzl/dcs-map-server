import type { Category, Coalition } from '../../shared/types.js';

export type Affiliation = 'friend' | 'hostile' | 'neutral' | 'unknown';
export type SymbolSetId = 'nato' | 'dcs';

/** Edge length of the drawn symbols, in CSS pixels. */
export const SIZE = 34;
/** Drawn at double resolution; MapLibre gets pixelRatio 2. */
export const DPR = 2;

export type Draw = (c: CanvasRenderingContext2D, s: number) => void;

export interface SymbolSet {
  id: SymbolSetId;
  /**
   * Draws a symbol. Gets both: affiliation (relative to the viewer) and
   * coalition (absolute) -- the two sets use different references. The
   * standard colours by affiliation, DCS by coalition.
   */
  render: (category: Category, affiliation: Affiliation, coalition: Coalition) => ImageData;
  /** Whether the symbol is rotated to heading. */
  rotates: (category: Category) => boolean;
  /** Key component that makes the rendering unique. */
  key: (category: Category, affiliation: Affiliation, coalition: Coalition) => string;
}

export function newCanvas(): { ctx: CanvasRenderingContext2D; px: number } {
  const px = SIZE * DPR;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(DPR, DPR);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return { ctx, px };
}

export function affiliationOf(coalition: Coalition, ownCoalition: Coalition): Affiliation {
  if (coalition === 0) return 'neutral';
  return coalition === ownCoalition ? 'friend' : 'hostile';
}

/** Category labels for the legend. */
export const CATEGORY_LABELS: Array<[Category, string]> = [
  ['air', 'Fixed wing'],
  ['cargo', 'Transport'],
  ['tanker', 'Tanker'],
  ['awacs', 'AWACS / early warning'],
  ['helo', 'Rotary wing'],
  ['armor', 'Armour'],
  ['ground', 'Ground, unspecified'],
  ['sam', 'Air defence'],
  ['naval', 'Surface vessel'],
  ['carrier', 'Carrier'],
  ['submarine', 'Submarine'],
  ['weapon', 'Weapon'],
];
