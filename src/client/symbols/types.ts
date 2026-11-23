import type { Category, Coalition } from '../../shared/types.js';

export type Affiliation = 'friend' | 'hostile' | 'neutral' | 'unknown';
export type SymbolSetId = 'nato' | 'dcs';

/** Kantenlänge der gezeichneten Symbole in CSS-Pixeln. */
export const SIZE = 34;
/** Zeichnung in doppelter Auflösung; MapLibre bekommt pixelRatio 2. */
export const DPR = 2;

export type Draw = (c: CanvasRenderingContext2D, s: number) => void;

export interface SymbolSet {
  id: SymbolSetId;
  /**
   * Zeichnet ein Symbol. Bekommt beides: Zugehörigkeit (relativ zum Betrachter)
   * und Koalition (absolut) -- die Sätze nutzen unterschiedliche Bezüge. Die
   * Norm färbt nach Zugehörigkeit, DCS nach Koalition.
   */
  render: (category: Category, affiliation: Affiliation, coalition: Coalition) => ImageData;
  /** Ob das Symbol auf den Kurs gedreht wird. */
  rotates: (category: Category) => boolean;
  /** Schlüsselbestandteil, der die Darstellung eindeutig macht. */
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

/** Beschriftung der Kategorien für die Legende. */
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
