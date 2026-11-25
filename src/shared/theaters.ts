/**
 * Geographic extent of each DCS theater, as [west, south, east, north] in
 * degrees. Used by fetch-tiles to cut each theater's tiles out of the planet
 * build, and by the client to pick the theater the own aircraft is in.
 * Real-world approximations of the DCS maps, not read from the game.
 */
export const THEATER_BOUNDS: Record<string, readonly [number, number, number, number]> = {
  caucasus: [36.0, 40.0, 47.0, 46.0],
  syria: [32.0, 31.5, 42.5, 37.5],
  persiangulf: [50.0, 22.5, 60.0, 30.0],
  sinai: [30.0, 27.0, 36.5, 32.5],
  normandy: [-3.5, 48.0, 2.0, 51.5],
  marianas: [144.0, 12.5, 147.5, 16.0],
  kola: [20.0, 64.0, 42.0, 71.0],
  iraq: [38.0, 29.0, 49.0, 38.0],
  afghanistan: [60.0, 29.0, 75.0, 39.0],
};

export function theaterContains(theater: string, lat: number, lon: number): boolean {
  const b = THEATER_BOUNDS[theater];
  if (!b) return false;
  const [west, south, east, north] = b;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

/**
 * The theater a position lies in, among the given candidates (those with
 * tiles). Where extents overlap -- Syria and Iraq share a strip -- the
 * smaller one wins, being the more specific match. Null when none fits.
 */
export function theaterAt(lat: number, lon: number, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestArea = Infinity;
  for (const t of candidates) {
    if (!theaterContains(t, lat, lon)) continue;
    const [west, south, east, north] = THEATER_BOUNDS[t]!;
    const area = (east - west) * (north - south);
    if (area < bestArea) {
      best = t;
      bestArea = area;
    }
  }
  return best;
}
