/**
 * All tunable game numbers live here (PLAN.md working agreement).
 * Dimensions are in tiles; width = columns, height = rows.
 */

export const MAP_SIZES = {
  small: { width: 64, height: 44, cityCount: 30 },
  medium: { width: 100, height: 60, cityCount: 55 },
  large: { width: 128, height: 80, cityCount: 80 },
} as const;

export type MapSizeKey = keyof typeof MAP_SIZES;

/** Fraction of the map that should be land. */
export const LAND_FRACTION = 0.3;

/** Minimum Chebyshev distance between any two cities. */
export const MIN_CITY_DISTANCE = 4;

/** A starting continent must have at least this many land tiles. */
export const MIN_START_CONTINENT = 50;

/** Continents smaller than this get no cities at all. */
export const MIN_CITY_CONTINENT = 15;

/** Vision radius (Chebyshev) granted by a city. */
export const VISION_CITY = 2;
