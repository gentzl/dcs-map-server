/**
 * Where the edge marker for an aircraft outside the view goes (free mode).
 *
 * The marker sits on the line from the screen centre towards the aircraft,
 * pulled in until it lies inside the free part of the map: below the panels
 * at the top (HUD, readout, notices) and above the control bar. Those panels
 * change height with the screen width, the readout's content and the design,
 * so the caller measures them each frame instead of assuming fixed sizes.
 */

export interface EdgeArea {
  /** Lowest bottom edge of the panels along the top, in px from the top. */
  top: number;
  /** Highest top edge of the controls along the bottom, in px from the top. */
  bottom: number;
}

export interface EdgePoint {
  x: number;
  y: number;
}

/** Room the marker needs: half its arrow above the anchor, arrow and label below. */
export const EDGE_CLEARANCE = { top: 22, bottom: 34, side: 36 };

/**
 * Below this much free height the panels are treated as absent: a phone
 * readout can fill half the screen, and a marker squeezed into a sliver --
 * or placed past the centre -- would be worse than one over the readout.
 */
const MIN_FREE_HEIGHT = 80;

/**
 * Clamps the aircraft's screen position `p` to the free area of a `w` x `h`
 * view. `area` holds the measured panels; `fallback` is used for the top
 * when `area` leaves too little room (typically the HUD alone).
 */
export function edgePosition(
  p: EdgePoint,
  w: number,
  h: number,
  area: EdgeArea,
  fallbackTop: number,
): EdgePoint {
  let top = area.top + EDGE_CLEARANCE.top;
  const bottom = area.bottom - EDGE_CLEARANCE.bottom;
  if (bottom - top < MIN_FREE_HEIGHT) top = fallbackTop + EDGE_CLEARANCE.top;

  const left = EDGE_CLEARANCE.side;
  const right = w - EDGE_CLEARANCE.side;
  const cx = w / 2;
  const cy = h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;

  // Room from the centre to each bound along the direction of travel. A bound
  // past the centre (huge panels on a tiny screen) leaves no room on that side.
  const limitX = Math.max(0, dx >= 0 ? right - cx : cx - left);
  const limitY = Math.max(0, dy >= 0 ? bottom - cy : cy - top);
  const scale = Math.min(
    1,
    limitX / Math.max(Math.abs(dx), 1e-6),
    limitY / Math.max(Math.abs(dy), 1e-6),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}
