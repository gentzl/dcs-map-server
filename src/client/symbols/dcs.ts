import type { Category, Coalition } from '../../shared/types.js';
import { type Draw, SIZE, type SymbolSet, newCanvas } from './types.js';

/**
 * Symbol set following the game's own map presentation.
 *
 * Redrawn from screenshots of the F10 map. The original artwork ships as
 * protected textures in the installation and isn't redistributed here; shape,
 * colouring and structure are redrawn from reference.
 *
 * Structure: shape carries the domain, content carries the type.
 *   Air    shield with a role letter (F fighter, C transport, K tanker,
 *          W AWACS, H rotary wing)
 *   Ground rectangle with a pictogram
 *   Sea    circle with a code or pictogram
 *
 * Colour follows the coalition, not the viewer's affiliation -- blue stays
 * blue even when flying red. That's the key difference from the standard.
 *
 * Deliberately left out: the green condition bar above ground and naval
 * markers. The export hook carries no condition, and a permanently full bar
 * would claim "undamaged" without knowing it.
 */

interface Palette {
  fill: string;
  edge: string;
  ink: string;
}

const PALETTE: Record<Coalition, Palette> = {
  0: { fill: '#c9c9c4', edge: '#55564f', ink: '#23241f' },
  1: { fill: '#e0453e', edge: '#7a201c', ink: '#2a0f0e' },
  2: { fill: '#8ad2e6', edge: '#2a6b80', ink: '#0f2a33' },
};

/** Ground vehicles get a more muted fill than air and sea. */
const GROUND_FILL: Record<Coalition, string> = {
  0: '#b8bab2',
  1: '#e0453e',
  2: '#93c4b4',
};

type Shape = 'shield' | 'rect' | 'circle';

const SHAPES: Record<Category, Shape> = {
  air: 'shield',
  cargo: 'shield',
  tanker: 'shield',
  awacs: 'shield',
  helo: 'shield',
  weapon: 'shield',
  armor: 'rect',
  ground: 'rect',
  sam: 'rect',
  static: 'rect',
  destroyed: 'rect',
  unknown: 'rect',
  naval: 'circle',
  carrier: 'circle',
  submarine: 'circle',
};

/** Shield shape: straight shoulders, tapering towards the bottom. */
const shield: Draw = (c, s) => {
  c.beginPath();
  c.moveTo(s * 0.26, s * 0.22);
  c.lineTo(s * 0.74, s * 0.22);
  c.lineTo(s * 0.74, s * 0.56);
  c.quadraticCurveTo(s * 0.74, s * 0.74, s * 0.5, s * 0.82);
  c.quadraticCurveTo(s * 0.26, s * 0.74, s * 0.26, s * 0.56);
  c.closePath();
};

const rect: Draw = (c, s) => {
  c.beginPath();
  c.rect(s * 0.22, s * 0.3, s * 0.56, s * 0.4);
};

const circle: Draw = (c, s) => {
  c.beginPath();
  c.arc(s * 0.5, s * 0.5, s * 0.26, 0, Math.PI * 2);
};

const FRAME: Record<Shape, Draw> = { shield, rect, circle };

/**
 * Letter codes in the frame, as they appear on the game's own map.
 *
 * 'F' used to apply to every fixed-wing aircraft -- a C-130 looked the same
 * as a fighter. A reference screenshot shows DCS separates these too: a
 * C-130 carries its own letter instead of the fighter letter.
 */
const LETTERS: Partial<Record<Category, string>> = {
  air: 'F',
  cargo: 'C',
  tanker: 'K',
  awacs: 'W',
  helo: 'H',
  naval: 'CC',
  carrier: 'CV',
  submarine: 'SS',
};

/** Pictograms for ground targets; the frame is already drawn. */
const GLYPHS: Partial<Record<Category, Draw>> = {
  /**
   * Oval ring with a filled centre point: a vehicle with a main gun.
   *
   * Reference screenshots of the 2S1 and PLZ05 (both self-propelled guns)
   * show exactly this symbol -- not the turret-with-barrel assumed earlier.
   * The point is filled immediately as its own sub-path; the ring is left as
   * the last open path so the shared stroke call afterwards picks it up.
   */
  armor: (c, s) => {
    c.beginPath();
    c.arc(s * 0.5, s * 0.5, s * 0.045, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(s * 0.5, s * 0.5, s * 0.22, s * 0.13, 0, 0, Math.PI * 2);
  },
  // An upright barrel, as on anti-aircraft guns.
  sam: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.42, s * 0.64);
    c.lineTo(s * 0.42, s * 0.5);
    c.lineTo(s * 0.62, s * 0.38);
    c.moveTo(s * 0.36, s * 0.64);
    c.lineTo(s * 0.5, s * 0.64);
  },
  /**
   * The same oval ring as for self-propelled guns, but without the point: a
   * vehicle with no main gun of its own. Reference: MT59, an unarmed
   * transporter that carries the same ring without a centre point on the
   * game's own map.
   */
  ground: (c, s) => {
    c.beginPath();
    c.ellipse(s * 0.5, s * 0.5, s * 0.22, s * 0.13, 0, 0, Math.PI * 2);
  },
  static: (c, s) => {
    c.beginPath();
    c.arc(s * 0.5, s * 0.5, s * 0.09, 0, Math.PI * 2);
    c.rect(s * 0.38, s * 0.38, s * 0.24, s * 0.24);
  },
  destroyed: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.3, s * 0.34);
    c.lineTo(s * 0.7, s * 0.66);
    c.moveTo(s * 0.7, s * 0.34);
    c.lineTo(s * 0.3, s * 0.66);
  },
};

function render(category: Category, coalition: Coalition): ImageData {
  const { ctx, px } = newCanvas();
  const p = PALETTE[coalition];
  const shape = SHAPES[category];

  // Weapons stay a point: on the game's own map, munitions are tiny marks
  // without a frame.
  if (category === 'weapon') {
    ctx.beginPath();
    ctx.arc(SIZE * 0.5, SIZE * 0.5, SIZE * 0.09, 0, Math.PI * 2);
    ctx.fillStyle = p.fill;
    ctx.fill();
    ctx.strokeStyle = p.edge;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    return ctx.getImageData(0, 0, px, px);
  }

  FRAME[shape](ctx, SIZE);
  ctx.fillStyle = shape === 'rect' ? GROUND_FILL[coalition] : p.fill;
  ctx.fill();
  ctx.strokeStyle = p.edge;
  ctx.lineWidth = 2.2;
  ctx.stroke();

  const letter = LETTERS[category];
  if (letter) {
    ctx.font = `700 ${Math.round(SIZE * (letter.length > 1 ? 0.24 : 0.3))}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = p.ink;
    // In the shield the text sits a bit higher, since the shape tapers at the bottom.
    ctx.fillText(letter, SIZE * 0.5, SIZE * (shape === 'shield' ? 0.47 : 0.5));
  }

  const glyph = GLYPHS[category];
  if (glyph) {
    // Set up front, in case a pictogram (like armor) fills its own sub-path
    // immediately instead of only relying on the shared stroke call below.
    ctx.fillStyle = p.ink;
    glyph(ctx, SIZE);
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }

  return ctx.getImageData(0, 0, px, px);
}

export const dcsSet: SymbolSet = {
  id: 'dcs',
  render: (category, _affiliation, coalition) => render(category, coalition),
  // The game's own map doesn't rotate markers to heading.
  rotates: () => false,
  key: (category, _affiliation, coalition) => `${category}-c${coalition}`,
};
