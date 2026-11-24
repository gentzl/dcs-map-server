import type { Category, Coalition } from '../../shared/types.js';
import {
  type Affiliation,
  type Draw,
  SIZE,
  type SymbolSet,
  newCanvas,
} from './types.js';

/**
 * Contact symbols based on NATO APP-6 / MIL-STD-2525.
 *
 * Based on, not conforming to: the frames are drawn as solid bodies here,
 * where the standard leaves them unfilled. On a moving map read at arm's
 * length over cluttered terrain, a tinted outline simply does not carry --
 * which is also why the game's own map fills its symbols. Everything else
 * follows the standard.
 *
 * Structure of the standard: the frame carries affiliation and dimension,
 * the icon inside it the object type.
 *   Affiliation  friend rectangle (sea: circle), hostile diamond,
 *                neutral square, unknown quatrefoil
 *   Dimension    air open at the bottom, land and sea surface closed,
 *                underwater open at the top
 *
 * Important consequence: a hostile tank and a hostile ship are both a
 * diamond -- distinguished only by the icon. That's intentional, because in
 * combat affiliation is the more important piece of information.
 *
 * Affiliation is relative to the viewer: your own coalition is friend.
 */

type Dimension = 'air' | 'land' | 'sea' | 'sub';

interface Palette {
  /** Body of the frame. */
  fill: string;
  /** Outline around the body. */
  edge: string;
  /** Letters and icons, drawn on top of the fill. */
  ink: string;
}

/**
 * One palette per affiliation. Dark ink on a saturated body, the same way
 * the game's own map does it -- a glyph in the frame's own colour would
 * vanish the moment the frame stopped being mostly transparent.
 */
const COLORS: Record<Affiliation, Palette> = {
  friend: { fill: '#5bb0f2', edge: '#10395f', ink: '#06182b' },
  hostile: { fill: '#ec4a42', edge: '#5d1512', ink: '#280705' },
  neutral: { fill: '#5cc595', edge: '#14472f', ink: '#05231a' },
  unknown: { fill: '#edc860', edge: '#5a4410', ink: '#2a1f05' },
};

const DIMENSION: Record<Category, Dimension> = {
  air: 'air',
  cargo: 'air',
  tanker: 'air',
  awacs: 'air',
  helo: 'air',
  weapon: 'air',
  armor: 'land',
  ground: 'land',
  sam: 'land',
  naval: 'sea',
  carrier: 'sea',
  submarine: 'sub',
  static: 'land',
  destroyed: 'land',
  unknown: 'land',
};


/** Frame per affiliation and dimension. Air frames end open at the bottom. */
const FRAMES: Record<Affiliation, Record<Dimension, Draw>> = {
  friend: {
    // Arc with an open underside.
    air: (c, s) => {
      c.beginPath();
      c.moveTo(s * 0.18, s * 0.74);
      c.lineTo(s * 0.18, s * 0.46);
      c.arc(s * 0.5, s * 0.46, s * 0.32, Math.PI, 0);
      c.lineTo(s * 0.82, s * 0.74);
    },
    land: (c, s) => {
      c.beginPath();
      c.rect(s * 0.14, s * 0.26, s * 0.72, s * 0.48);
    },
    sea: (c, s) => {
      c.beginPath();
      c.arc(s * 0.5, s * 0.5, s * 0.34, 0, Math.PI * 2);
    },
    // Underwater: open at the top, i.e. the mirrored friend arc.
    sub: (c, s) => {
      c.beginPath();
      c.moveTo(s * 0.18, s * 0.26);
      c.lineTo(s * 0.18, s * 0.54);
      c.arc(s * 0.5, s * 0.54, s * 0.32, Math.PI, 0, true);
      c.lineTo(s * 0.82, s * 0.26);
    },
  },
  hostile: {
    // Pointed arch, also open at the bottom.
    air: (c, s) => {
      c.beginPath();
      c.moveTo(s * 0.14, s * 0.76);
      c.lineTo(s * 0.5, s * 0.16);
      c.lineTo(s * 0.86, s * 0.76);
    },
    land: (c, s) => {
      c.beginPath();
      c.moveTo(s * 0.5, s * 0.12);
      c.lineTo(s * 0.88, s * 0.5);
      c.lineTo(s * 0.5, s * 0.88);
      c.lineTo(s * 0.12, s * 0.5);
      c.closePath();
    },
    sea: (c, s) => FRAMES.hostile.land(c, s),
    // Diamond open at the bottom.
    sub: (c, s) => {
      c.beginPath();
      c.moveTo(s * 0.14, s * 0.24);
      c.lineTo(s * 0.5, s * 0.84);
      c.lineTo(s * 0.86, s * 0.24);
    },
  },
  neutral: {
    air: (c, s) => {
      c.beginPath();
      c.moveTo(s * 0.18, s * 0.78);
      c.lineTo(s * 0.18, s * 0.22);
      c.lineTo(s * 0.82, s * 0.22);
      c.lineTo(s * 0.82, s * 0.78);
    },
    land: (c, s) => {
      c.beginPath();
      c.rect(s * 0.2, s * 0.2, s * 0.6, s * 0.6);
    },
    sea: (c, s) => FRAMES.neutral.land(c, s),
    sub: (c, s) => {
      c.beginPath();
      c.moveTo(s * 0.18, s * 0.22);
      c.lineTo(s * 0.18, s * 0.78);
      c.lineTo(s * 0.82, s * 0.78);
      c.lineTo(s * 0.82, s * 0.22);
    },
  },
  unknown: {
    // Quatrefoil, simplified to four arcs.
    air: (c, s) => FRAMES.unknown.land(c, s),
    sub: (c, s) => FRAMES.unknown.land(c, s),
    land: (c, s) => {
      const r = s * 0.19;
      c.beginPath();
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        c.moveTo(s * 0.5 + dx * r + r, s * 0.5 + dy * r);
        c.arc(s * 0.5 + dx * r, s * 0.5 + dy * r, r, 0, Math.PI * 2);
      }
    },
    sea: (c, s) => FRAMES.unknown.land(c, s),
  },
};

/**
 * Letter code instead of a pictogram.
 *
 * The standard explicitly allows this -- a symbol consists of a frame and
 * "an icon or letter code centered inside the frame". Used for aircraft
 * carriers because no reliable pictogram geometry could be sourced for one;
 * a made-up icon would be worse than the standard's own letter code.
 */
const LETTERS: Partial<Record<Category, string>> = {
  carrier: 'CV',
};

/** Icons by object type. Empty where the standard calls for "unspecified". */
// Propeller: two counter-rotating blades. Also covers transport/tanker/
// AWACS -- the standard has no dedicated pictogram for those, just the
// general fixed-wing symbol.
const fixedWingIcon: Draw = (c, s) => {
  c.beginPath();
  c.ellipse(s * 0.5, s * 0.47, s * 0.2, s * 0.07, 0, 0, Math.PI * 2);
};

const ICONS: Partial<Record<Category, Draw>> = {
  air: fixedWingIcon,
  cargo: fixedWingIcon,
  tanker: fixedWingIcon,
  awacs: fixedWingIcon,
  // Rotor blades: crossed, to suggest the spinning motion.
  // A filled rotor disc (like the fixed-wing's propeller), with the crossed
  // strokes as rotor blades on top. Without the disc the helicopter was left
  // with only thin crossed lines, where fixed-wing already had its filled
  // propeller to carry the symbol.
  helo: (c, s) => {
    c.beginPath();
    c.ellipse(s * 0.5, s * 0.47, s * 0.25, s * 0.25, 0, 0, Math.PI * 2);
  },
  // Track suggestion: a lying oval. Under the standard this belongs to main
  // battle tanks alone; other ground targets carry an empty frame, which
  // means "unspecified" and is thus the more honest statement.
  armor: (c, s) => {
    c.beginPath();
    c.ellipse(s * 0.5, s * 0.5, s * 0.22, s * 0.12, 0, 0, Math.PI * 2);
  },
  // Protective dome over a baseline.
  sam: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.28, s * 0.6);
    c.arc(s * 0.5, s * 0.6, s * 0.22, Math.PI, 0);
    c.lineTo(s * 0.28, s * 0.6);
  },
  /**
   * Hull -- a deliberate departure from the standard.
   *
   * There, a surface combatant carries no entry of its own, which would
   * leave a hostile ship and a hostile ground target as the same empty
   * diamond. Unacceptable on a map, hence the hull.
   */
  naval: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.32, s * 0.45);
    c.lineTo(s * 0.68, s * 0.45);
    c.lineTo(s * 0.6, s * 0.58);
    c.lineTo(s * 0.4, s * 0.58);
    c.closePath();
  },
  weapon: (c, s) => {
    c.beginPath();
    c.arc(s * 0.5, s * 0.5, s * 0.09, 0, Math.PI * 2);
  },
  destroyed: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.3, s * 0.3);
    c.lineTo(s * 0.7, s * 0.7);
    c.moveTo(s * 0.7, s * 0.3);
    c.lineTo(s * 0.3, s * 0.7);
  },
};

/** Icons that get filled; the rest stay strokes. */
const FILLED = new Set<Category>(['armor', 'sam', 'weapon', 'air', 'cargo', 'tanker', 'awacs', 'naval', 'helo']);

function render(category: Category, affiliation: Affiliation): ImageData {
  const { ctx, px } = newCanvas();

  const { fill, edge, ink } = COLORS[affiliation];
  const dim = DIMENSION[category];

  // Dark backing first, so the frame carries equally on the light
  // aeronautical chart and in night mode.
  FRAMES[affiliation][dim](ctx, SIZE);
  ctx.strokeStyle = 'rgba(12,16,20,0.85)';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Solid body. A 20 % tint used to leave only the 2 px outline carrying any
  // colour at all, which disappeared against anything but plain terrain.
  // Air frames are filled too: the path closes along the bottom while the
  // outline stays open there, so the dimension cue survives.
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = 2;
  ctx.stroke();

  const letter = LETTERS[category];
  if (letter) {
    ctx.font = `700 ${Math.round(SIZE * 0.3)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.fillText(letter, SIZE * 0.5, SIZE * 0.52);
  }

  const icon = ICONS[category];
  if (icon) {
    icon(ctx, SIZE);
    if (FILLED.has(category)) {
      ctx.fillStyle = ink;
      ctx.fill();
    }
    // Thin: at small render sizes a thick outline ate up almost the entire
    // fill area -- a filled rotor disc turned into a thin ring on the map.
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  return ctx.getImageData(0, 0, px, px);
}


/** Category labels for the legend. */

/**
 * Draws a symbol as a data URL for the legend.
 *
 * Uses the same routine as the map symbols -- so the legend can't drift from
 * the actual rendering.
 */

const AIR: ReadonlySet<Category> = new Set<Category>(['air', 'cargo', 'tanker', 'awacs', 'helo', 'weapon']);

export const natoSet: SymbolSet = {
  id: 'nato',
  render: (category, affiliation) => render(category, affiliation),
  // Only aircraft are rotated to heading; for ground targets the orientation
  // is mostly meaningless and only added visual noise.
  rotates: (category) =>
    category === 'air' || category === 'cargo' || category === 'tanker' ||
    category === 'awacs' || category === 'helo',
  key: (category, affiliation) => `${category}-${affiliation}`,
};

export const natoDimensionIsAir = (category: Category): boolean => AIR.has(category);
