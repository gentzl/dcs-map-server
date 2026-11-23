import type { Category, Coalition } from '../../shared/types.js';
import { type Draw, SIZE, type SymbolSet, newCanvas } from './types.js';

/**
 * Symbolsatz nach der Kartendarstellung des Spiels.
 *
 * Nachgebaut anhand von Bildschirmaufnahmen der F10-Karte. Die Originalgrafiken
 * liegen als geschützte Texturen in der Installation und werden hier nicht
 * mitgeliefert; nachgezeichnet sind Form, Farbgebung und Aufbau.
 *
 * Aufbau: Die Form trägt die Domäne, der Inhalt den Typ.
 *   Luft   Schild mit Rollenbuchstabe (F Jäger, C Transport, K Tanker, W Frühwarnung, H Drehflügler)
 *   Boden  Rechteck mit Piktogramm
 *   See    Kreis mit Kürzel oder Piktogramm
 *
 * Farbe folgt der Koalition, nicht der Zugehörigkeit zum Betrachter -- Blau
 * bleibt Blau, auch im Rotflug. Das ist der wesentliche Unterschied zur Norm.
 *
 * Bewusst weggelassen: der grüne Zustandsbalken über Boden- und
 * Wasserfahrzeugen. Der Export-Hook liefert keinen Zustand, und ein immer
 * voller Balken behauptete "unbeschädigt", ohne es zu wissen.
 */

interface Palette {
  fill: string;
  edge: string;
  ink: string;
}

const PALETTE: Record<Coalition, Palette> = {
  0: { fill: '#c9c9c4', edge: '#55564f', ink: '#23241f' },
  1: { fill: '#e8706b', edge: '#8d2b27', ink: '#2a0f0e' },
  2: { fill: '#8ad2e6', edge: '#2a6b80', ink: '#0f2a33' },
};

/** Für Bodenfahrzeuge ist die Füllung gedämpfter als für Luft und See. */
const GROUND_FILL: Record<Coalition, string> = {
  0: '#b8bab2',
  1: '#e8706b',
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

/** Wappenform: gerade Schultern, nach unten zulaufend. */
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
 * Kürzel im Rahmen, wie sie auf der Karte des Spiels erscheinen.
 *
 * 'F' galt bisher für jedes Starrflügelflugzeug -- ein C-130 erschien damit
 * genauso wie ein Jäger. Referenzaufnahme zeigt DCS trennt auch hier: ein
 * C-130 führt ein eigenes Kürzel statt des Jäger-Buchstabens.
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

/** Piktogramme für Bodenziele; der Rahmen ist bereits gezeichnet. */
const GLYPHS: Partial<Record<Category, Draw>> = {
  /**
   * Ovaler Ring mit gefülltem Mittelpunkt: Fahrzeug mit Hauptwaffe.
   *
   * Referenzaufnahmen zu 2S1 und PLZ05 (beides Selbstfahrlafetten) zeigen
   * genau dieses Symbol -- kein Turm-mit-Rohr wie zuvor angenommen. Der Punkt
   * wird als eigener Teilpfad sofort gefüllt, der Ring bleibt als letzter
   * offener Pfad stehen, damit ihn der gemeinsame Stroke-Aufruf danach trifft.
   */
  armor: (c, s) => {
    c.beginPath();
    c.arc(s * 0.5, s * 0.5, s * 0.045, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(s * 0.5, s * 0.5, s * 0.22, s * 0.13, 0, 0, Math.PI * 2);
  },
  // Aufgerichtetes Rohr, wie bei Flugabwehrgeschützen.
  sam: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.42, s * 0.64);
    c.lineTo(s * 0.42, s * 0.5);
    c.lineTo(s * 0.62, s * 0.38);
    c.moveTo(s * 0.36, s * 0.64);
    c.lineTo(s * 0.5, s * 0.64);
  },
  /**
   * Derselbe ovale Ring wie bei Selbstfahrlafetten, aber ohne Punkt: Fahrzeug
   * ohne eigene Hauptwaffe. Referenz: MT59, ein unbewaffneter Transporter, der
   * auf der Karte des Spiels denselben Ring ohne Mittelpunkt führt.
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

  // Waffen bleiben ein Punkt: Auf der Karte des Spiels sind Flugkörper
  // winzige Marken ohne Rahmen.
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
    // Im Schild sitzt die Schrift etwas höher, weil die Form unten zuläuft.
    ctx.fillText(letter, SIZE * 0.5, SIZE * (shape === 'shield' ? 0.47 : 0.5));
  }

  const glyph = GLYPHS[category];
  if (glyph) {
    // Vorab gesetzt, falls ein Piktogramm (wie armor) einen eigenen Teilpfad
    // sofort füllt, statt nur den gemeinsamen Stroke-Aufruf unten zu nutzen.
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
  // Die Karte des Spiels dreht die Marken nicht mit dem Kurs.
  rotates: () => false,
  key: (category, _affiliation, coalition) => `${category}-c${coalition}`,
};
