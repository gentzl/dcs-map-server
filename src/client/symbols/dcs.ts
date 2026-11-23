import type { Category, Coalition } from '../../shared/types.js';
import { type Draw, SIZE, type SymbolSet, newCanvas } from './types.js';

/**
 * Symbolsatz in Anlehnung an die DCS-Kartendarstellung.
 *
 * ACHTUNG, ANNÄHERUNG: Die Originalgrafiken liegen als Texturen in der
 * DCS-Installation und sind urheberrechtlich geschützt -- mitliefern käme
 * ohnehin nicht in Frage. Eine belastbare Vorlage war über die zugänglichen
 * Quellen nicht zu beschaffen: Die Dateiseite von Eagle Dynamics antwortet mit
 * 403, das Modding-Wiki steht hinter einer Bezahlschranke.
 *
 * Diese Umsetzung folgt daher nur den gesicherten Merkmalen der
 * DCS-Darstellung:
 *   - gefüllte, kompakte Formen statt Rahmen mit Innen-Icon
 *   - Farbe nach Koalition, absolut (Blau bleibt Blau, auch im Rotflug) --
 *     anders als in der Norm, die relativ zum Betrachter färbt
 *   - Luftfahrzeuge als gerichtete Form, auf den Kurs gedreht
 *
 * Für eine echte Nachbildung fehlt eine Bildvorlage. Siehe README.
 */

/** DCS färbt nach Koalition, nicht nach Zugehörigkeit zum Betrachter. */
const COALITION_COLORS: Record<Coalition, string> = {
  0: '#cfcfcf',
  1: '#e03131',
  2: '#1c7ed6',
};

const SHAPES: Record<Category, Draw> = {
  // Flugzeug in Draufsicht: Rumpf mit Tragflächen und Leitwerk.
  air: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.16);
    c.lineTo(s * 0.57, s * 0.42);
    c.lineTo(s * 0.86, s * 0.56);
    c.lineTo(s * 0.86, s * 0.63);
    c.lineTo(s * 0.56, s * 0.58);
    c.lineTo(s * 0.54, s * 0.74);
    c.lineTo(s * 0.68, s * 0.82);
    c.lineTo(s * 0.68, s * 0.87);
    c.lineTo(s * 0.5, s * 0.83);
    c.lineTo(s * 0.32, s * 0.87);
    c.lineTo(s * 0.32, s * 0.82);
    c.lineTo(s * 0.46, s * 0.74);
    c.lineTo(s * 0.44, s * 0.58);
    c.lineTo(s * 0.14, s * 0.63);
    c.lineTo(s * 0.14, s * 0.56);
    c.lineTo(s * 0.43, s * 0.42);
    c.closePath();
  },
  // Hubschrauber: gedrungener Rumpf, Rotorkreis angedeutet.
  helo: (c, s) => {
    c.beginPath();
    c.ellipse(s * 0.5, s * 0.52, s * 0.17, s * 0.3, 0, 0, Math.PI * 2);
    c.moveTo(s * 0.5, s * 0.82);
    c.lineTo(s * 0.5, s * 0.92);
  },
  armor: (c, s) => {
    c.beginPath();
    c.rect(s * 0.22, s * 0.3, s * 0.56, s * 0.4);
    c.moveTo(s * 0.5, s * 0.3);
    c.lineTo(s * 0.5, s * 0.14);
  },
  ground: (c, s) => {
    c.beginPath();
    c.rect(s * 0.26, s * 0.34, s * 0.48, s * 0.32);
  },
  sam: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.5, s * 0.14);
    c.lineTo(s * 0.8, s * 0.7);
    c.lineTo(s * 0.2, s * 0.7);
    c.closePath();
    c.moveTo(s * 0.26, s * 0.78);
    c.lineTo(s * 0.74, s * 0.78);
  },
  naval: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.16, s * 0.42);
    c.lineTo(s * 0.84, s * 0.42);
    c.lineTo(s * 0.68, s * 0.68);
    c.lineTo(s * 0.32, s * 0.68);
    c.closePath();
    c.moveTo(s * 0.5, s * 0.42);
    c.lineTo(s * 0.5, s * 0.24);
  },
  carrier: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.12, s * 0.38);
    c.lineTo(s * 0.88, s * 0.38);
    c.lineTo(s * 0.74, s * 0.68);
    c.lineTo(s * 0.26, s * 0.68);
    c.closePath();
    c.moveTo(s * 0.2, s * 0.53);
    c.lineTo(s * 0.8, s * 0.53);
  },
  submarine: (c, s) => {
    c.beginPath();
    c.ellipse(s * 0.5, s * 0.55, s * 0.34, s * 0.14, 0, 0, Math.PI * 2);
    c.moveTo(s * 0.5, s * 0.41);
    c.lineTo(s * 0.5, s * 0.26);
  },
  weapon: (c, s) => {
    c.beginPath();
    c.arc(s * 0.5, s * 0.5, s * 0.1, 0, Math.PI * 2);
  },
  static: (c, s) => {
    c.beginPath();
    c.rect(s * 0.3, s * 0.3, s * 0.4, s * 0.4);
  },
  destroyed: (c, s) => {
    c.beginPath();
    c.moveTo(s * 0.26, s * 0.26);
    c.lineTo(s * 0.74, s * 0.74);
    c.moveTo(s * 0.74, s * 0.26);
    c.lineTo(s * 0.26, s * 0.74);
  },
  unknown: (c, s) => {
    c.beginPath();
    c.arc(s * 0.5, s * 0.5, s * 0.24, 0, Math.PI * 2);
  },
};

/** Umrissformen; alles Übrige wird gefüllt. */
const OUTLINE_ONLY: ReadonlySet<Category> = new Set<Category>(['destroyed', 'unknown', 'helo']);

function render(category: Category, coalition: Coalition): ImageData {
  const { ctx, px } = newCanvas();
  const color = COALITION_COLORS[coalition];

  SHAPES[category](ctx, SIZE);

  // Dunkle Unterlegung, damit die Form auf heller Karte und im Nachtmodus trägt.
  ctx.strokeStyle = 'rgba(10,14,18,0.85)';
  ctx.lineWidth = 3.2;
  ctx.stroke();

  if (!OUTLINE_ONLY.has(category)) {
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
  ctx.stroke();

  return ctx.getImageData(0, 0, px, px);
}

export const dcsSet: SymbolSet = {
  id: 'dcs',
  render: (category, _affiliation, coalition) => render(category, coalition),
  // Gerichtete Formen: Flugzeug, Hubschrauber und Schiffe zeigen die Fahrtrichtung.
  rotates: (category) =>
    category === 'air' || category === 'helo' || category === 'naval' || category === 'carrier',
  key: (category, _affiliation, coalition) => `${category}-c${coalition}`,
};
