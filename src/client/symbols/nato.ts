import type { Category, Coalition } from '../../shared/types.js';
import {
  type Affiliation,
  type Draw,
  SIZE,
  type SymbolSet,
  newCanvas,
} from './types.js';

/**
 * Kontaktsymbole nach NATO APP-6 / MIL-STD-2525.
 *
 * Aufbau der Norm: Der Rahmen trägt Zugehörigkeit und Dimension, das Icon darin
 * die Objektart.
 *   Zugehörigkeit  Freund Rechteck (See: Kreis), Feind Raute,
 *                  Neutral Quadrat, Unbekannt Vierpass
 *   Dimension      Luft unten offen, Land und Seeoberfläche geschlossen,
 *                  unter Wasser oben offen
 *
 * Wichtige Folge: Ein feindlicher Panzer und ein feindliches Schiff sind beide
 * eine Raute -- unterschieden allein durch das Icon. Das ist gewollt, weil die
 * Zugehörigkeit im Gefecht die wichtigere Information ist.
 *
 * Zugehörigkeit ist relativ zum Betrachter: Die eigene Koalition ist Freund.
 */

type Dimension = 'air' | 'land' | 'sea' | 'sub';

const COLORS: Record<Affiliation, string> = {
  friend: '#4895ef',
  hostile: '#e63946',
  neutral: '#52b788',
  unknown: '#e9c46a',
};

const DIMENSION: Record<Category, Dimension> = {
  air: 'air',
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


/** Rahmen je Zugehörigkeit und Dimension. Luftrahmen enden offen nach unten. */
const FRAMES: Record<Affiliation, Record<Dimension, Draw>> = {
  friend: {
    // Bogen mit offener Unterseite.
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
    // Unter Wasser: oben offen, also der gespiegelte Freundbogen.
    sub: (c, s) => {
      c.beginPath();
      c.moveTo(s * 0.18, s * 0.26);
      c.lineTo(s * 0.18, s * 0.54);
      c.arc(s * 0.5, s * 0.54, s * 0.32, Math.PI, 0, true);
      c.lineTo(s * 0.82, s * 0.26);
    },
  },
  hostile: {
    // Spitzbogen, ebenfalls unten offen.
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
    // Nach unten offene Raute.
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
    // Vierpass, auf vier Bögen vereinfacht.
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
 * Buchstabenkürzel statt Piktogramm.
 *
 * Die Norm lässt das ausdrücklich zu -- ein Symbol besteht aus Rahmen und
 * "an icon or letter code centered inside the frame". Für Flugzeugträger wird
 * das genutzt, weil sich dafür keine verlässliche Piktogramm-Geometrie
 * beschaffen ließ; ein erfundenes Icon wäre schlechter als das genormte Kürzel.
 */
const LETTERS: Partial<Record<Category, string>> = {
  carrier: 'CV',
};

/** Icons nach Objektart. Leer, wo die Norm "nicht näher bestimmt" vorsieht. */
const ICONS: Partial<Record<Category, Draw>> = {
  // Luftschraube: zwei gegenläufige Blätter.
  air: (c, s) => {
    c.beginPath();
    c.ellipse(s * 0.5, s * 0.47, s * 0.2, s * 0.07, 0, 0, Math.PI * 2);
  },
  // Rotorblätter: gekreuzt, als Andeutung der Drehbewegung.
  // Gefuellte Rotorscheibe (wie beim Starrfluegler die Luftschraube), darauf
  // die Kreuzstriche als Rotorblaetter. Ohne die Flaeche blieb vom Symbol nur
  // ein duenner Strich, weil der Luftrahmen selbst nach APP-6 unten offen und
  // daher ungefuellt ist -- beim Starrfluegler kompensiert das die gefuellte
  // Luftschraube, beim Hubschrauber fehlte das Gegenstueck.
  helo: (c, s) => {
    c.beginPath();
    c.ellipse(s * 0.5, s * 0.47, s * 0.19, s * 0.19, 0, 0, Math.PI * 2);
  },
  // Kettenandeutung: liegendes Oval. Steht nach der Norm allein Kampfpanzern
  // zu; sonstige Bodenziele führen einen leeren Rahmen, was "nicht näher
  // bestimmt" bedeutet und damit die ehrlichere Aussage ist.
  armor: (c, s) => {
    c.beginPath();
    c.ellipse(s * 0.5, s * 0.5, s * 0.22, s * 0.12, 0, 0, Math.PI * 2);
  },
  // Schutzkuppel über einer Grundlinie.
  sam: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.28, s * 0.6);
    c.arc(s * 0.5, s * 0.6, s * 0.22, Math.PI, 0);
    c.lineTo(s * 0.28, s * 0.6);
  },
  /**
   * Schiffsrumpf -- eine bewusste Abweichung von der Norm.
   *
   * Dort trägt ein Überwasser-Kampfschiff keinen eigenen Eintrag, womit ein
   * feindliches Schiff und ein feindliches Bodenziel dieselbe leere Raute
   * ergäben. Auf einer Karte ist das nicht hinnehmbar, deshalb der Rumpf.
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

/** Icons, die gefüllt werden; die übrigen bleiben Striche. */
const FILLED = new Set<Category>(['armor', 'sam', 'weapon', 'air', 'naval', 'helo']);

function render(category: Category, affiliation: Affiliation): ImageData {
  const { ctx, px } = newCanvas();

  const color = COLORS[affiliation];
  const dim = DIMENSION[category];

  // Dunkle Unterlegung zuerst, damit der Rahmen auf heller Fliegerkarte und im
  // Nachtmodus gleichermaßen trägt.
  FRAMES[affiliation][dim](ctx, SIZE);
  ctx.strokeStyle = 'rgba(12,16,20,0.85)';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Leicht eingefärbte Füllung: hebt das Symbol vom Gelände ab, ohne es
  // zuzudecken. Luftrahmen sind offen und werden deshalb nicht gefüllt.
  if (dim !== 'air') {
    ctx.fillStyle = `${color}33`;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  const letter = LETTERS[category];
  if (letter) {
    ctx.font = `600 ${Math.round(SIZE * 0.3)}px ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(12,16,20,0.85)';
    ctx.strokeText(letter, SIZE * 0.5, SIZE * 0.52);
    ctx.fillStyle = color;
    ctx.fillText(letter, SIZE * 0.5, SIZE * 0.52);
  }

  const icon = ICONS[category];
  if (icon) {
    icon(ctx, SIZE);
    ctx.strokeStyle = 'rgba(12,16,20,0.85)';
    ctx.lineWidth = 3.4;
    ctx.stroke();
    if (FILLED.has(category)) {
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  return ctx.getImageData(0, 0, px, px);
}


/** Beschriftung der Kategorien für die Legende. */

/**
 * Zeichnet ein Symbol als Data-URL für die Legende.
 *
 * Nutzt dieselbe Routine wie die Kartensymbole -- so kann die Legende nicht von
 * der tatsächlichen Darstellung abweichen.
 */

const AIR: ReadonlySet<Category> = new Set<Category>(['air', 'helo', 'weapon']);

export const natoSet: SymbolSet = {
  id: 'nato',
  render: (category, affiliation) => render(category, affiliation),
  // Nur Luftfahrzeuge werden auf den Kurs gedreht; bei Bodenzielen ist die
  // Ausrichtung meist bedeutungslos und erzeugte nur Unruhe.
  rotates: (category) => category === 'air' || category === 'helo',
  key: (category, affiliation) => `${category}-${affiliation}`,
};

export const natoDimensionIsAir = (category: Category): boolean => AIR.has(category);
