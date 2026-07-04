import type { Rng } from './rng';
import { DIRS4, chebyshev, dist2, inBounds, tileIndex } from './grid';
import { LAND_FRACTION, MIN_CITY_CONTINENT, MIN_CITY_DISTANCE, MIN_START_CONTINENT } from './rules';

export const TERRAIN_SEA = 0;
export const TERRAIN_LAND = 1;

export interface City {
  id: number;
  x: number;
  y: number;
}

export interface World {
  width: number;
  height: number;
  /** TERRAIN_SEA / TERRAIN_LAND per tile. */
  terrain: Uint8Array;
  cities: City[];
  /** cityAt[tileIndex] = city id, or -1. Derivable from cities; kept for O(1) lookup. */
  cityAt: Int32Array;
  /** City ids of the two starting cities: [player 0, player 1]. */
  starts: [number, number];
  /**
   * Whether each city (by id) is a port that can build ships. True only when
   * the city touches genuine open sea — NOT merely the thin ocean border ring
   * at the map edge, which is the map's boundary rather than a harbor.
   */
  coastal: boolean[];
}

/** Width of the guaranteed ocean border, and the keep-out zone for walks. */
function borderMargin(width: number, height: number): { mx: number; my: number } {
  return {
    mx: Math.max(2, Math.floor(width * 0.06)),
    my: Math.max(2, Math.floor(height * 0.06)),
  };
}

export interface WorldGenOptions {
  width: number;
  height: number;
  cityCount: number;
}

export interface Continent {
  /** Label used in the labels array. */
  id: number;
  size: number;
  /** Tile indices belonging to this continent. */
  tiles: number[];
}

/**
 * Connected components of land (4-neighbor).
 * Returns per-tile labels (-1 for sea) plus a Continent record per component.
 */
export function findContinents(
  terrain: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; continents: Continent[] } {
  const labels = new Int32Array(terrain.length).fill(-1);
  const continents: Continent[] = [];
  const stack: number[] = [];

  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] !== TERRAIN_LAND || labels[i] !== -1) continue;
    const id = continents.length;
    const tiles: number[] = [];
    stack.push(i);
    labels[i] = id;
    while (stack.length > 0) {
      const t = stack.pop() as number;
      tiles.push(t);
      const x = t % width;
      const y = Math.floor(t / width);
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny, width, height)) continue;
        const n = tileIndex(nx, ny, width);
        if (terrain[n] === TERRAIN_LAND && labels[n] === -1) {
          labels[n] = id;
          stack.push(n);
        }
      }
    }
    continents.push({ id, size: tiles.length, tiles });
  }
  return { labels, continents };
}

/**
 * Count land tiles in the 8-neighborhood of (x,y). Out-of-bounds counts as sea.
 */
function landNeighbors8(terrain: Uint8Array, width: number, height: number, x: number, y: number): number {
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(nx, ny, width, height) && terrain[tileIndex(nx, ny, width)] === TERRAIN_LAND) {
        n++;
      }
    }
  }
  return n;
}

/**
 * One cellular-automaton smoothing pass (the standard "cave" rule): a tile
 * becomes land if a majority of its neighborhood is land. This rounds off
 * coastlines and, crucially, erodes single-tile nubs and diagonal pinch points
 * while filling one-tile gaps — so no filaments or 1-wide arms survive.
 * Border tiles are forced to sea to keep islands off the map edge.
 */
function smooth(terrain: Uint8Array, width: number, height: number, mx: number, my: number): Uint8Array {
  const next = new Uint8Array(terrain.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x < mx || y < my || x >= width - mx || y >= height - my) {
        continue; // border stays sea
      }
      const i = tileIndex(x, y, width);
      const n = landNeighbors8(terrain, width, height, x, y);
      const isLand = terrain[i] === TERRAIN_LAND;
      // Land needs >=4 land neighbors to stay (a 1-wide arm has <=3, so it
      // erodes); sea flips to land only when clearly enclosed (>=5).
      next[i] = (isLand ? n >= 4 : n >= 5) ? TERRAIN_LAND : TERRAIN_SEA;
    }
  }
  return next;
}

/**
 * Grow chunky islands: random walks painted with a 3x3 brush (so land is never
 * thinner than three tiles), then cellular-automaton smoothing to round the
 * coastlines and remove any residual thin arms.
 */
function generateTerrain(rng: Rng, width: number, height: number): Uint8Array {
  let terrain: Uint8Array = new Uint8Array(width * height).fill(TERRAIN_SEA);
  const target = Math.floor(width * height * LAND_FRACTION);
  // Keep walks away from the map border so the world reads as an ocean map.
  // Paint and smoothing share one margin so there is no thin sea "moat"
  // between the land and the true edge — just a clean ocean border.
  const { mx: marginX, my: marginY } = borderMargin(width, height);
  let land = 0;

  const paintBrush = (cx: number, cy: number): void => {
    // 3x3 stamp — guarantees a minimum land width of three tiles.
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < marginX || y < marginY || x >= width - marginX || y >= height - marginY) continue;
        const i = tileIndex(x, y, width);
        if (terrain[i] === TERRAIN_SEA) {
          terrain[i] = TERRAIN_LAND;
          land++;
        }
      }
    }
  };

  // Aim a bit below target; smoothing nudges the final land area back up.
  const walkTarget = Math.floor(target * 0.85);
  while (land < walkTarget) {
    let x = marginX + rng.int(width - 2 * marginX);
    let y = marginY + rng.int(height - 2 * marginY);
    const walkLength = 25 + rng.int(55);
    for (let step = 0; step < walkLength && land < walkTarget; step++) {
      paintBrush(x, y);
      const dir = DIRS4[rng.int(4)] as readonly [number, number];
      x = Math.min(width - 1 - marginX, Math.max(marginX, x + dir[0]));
      y = Math.min(height - 1 - marginY, Math.max(marginY, y + dir[1]));
    }
  }

  // Two smoothing passes clean up coastlines and kill any thin arms.
  terrain = smooth(terrain, width, height, marginX, marginY);
  terrain = smooth(terrain, width, height, marginX, marginY);
  return terrain;
}

/**
 * Scatter cities across continents, proportional to continent size, keeping
 * MIN_CITY_DISTANCE between any two cities. May place slightly fewer than
 * requested on cramped maps.
 */
function placeCities(rng: Rng, width: number, continents: Continent[], cityCount: number): City[] {
  const eligible = continents.filter((c) => c.size >= MIN_CITY_CONTINENT);
  const totalLand = eligible.reduce((sum, c) => sum + c.size, 0);
  const cities: City[] = [];

  const farEnough = (x: number, y: number): boolean =>
    cities.every((c) => chebyshev(c.x, c.y, x, y) >= MIN_CITY_DISTANCE);

  for (const continent of eligible) {
    const quota = Math.max(1, Math.round((cityCount * continent.size) / totalLand));
    for (let q = 0; q < quota; q++) {
      for (let attempt = 0; attempt < 300; attempt++) {
        const t = continent.tiles[rng.int(continent.tiles.length)] as number;
        const x = t % width;
        const y = Math.floor(t / width);
        if (farEnough(x, y)) {
          cities.push({ id: cities.length, x, y });
          break;
        }
      }
    }
  }
  return cities;
}

/**
 * Pick two starting cities: far apart, each on a continent big enough to be
 * worth holding and (ideally) with neighbors to conquer. Returns null when
 * this world has no acceptable pair — caller regenerates.
 */
function pickStarts(
  world: { width: number; height: number; cities: City[] },
  labels: Int32Array,
  continents: Continent[],
): [number, number] | null {
  const diag = Math.sqrt(world.width * world.width + world.height * world.height);
  const cityCountByContinent = new Map<number, number>();
  for (const city of world.cities) {
    const label = labels[tileIndex(city.x, city.y, world.width)] as number;
    cityCountByContinent.set(label, (cityCountByContinent.get(label) ?? 0) + 1);
  }

  // Try strict requirements first, then relax.
  const stages = [
    { minSize: MIN_START_CONTINENT, minCities: 3 },
    { minSize: MIN_START_CONTINENT, minCities: 2 },
    { minSize: MIN_CITY_CONTINENT, minCities: 1 },
  ];

  for (const stage of stages) {
    const eligible = world.cities.filter((city) => {
      const label = labels[tileIndex(city.x, city.y, world.width)] as number;
      const continent = continents[label];
      return (
        continent !== undefined &&
        continent.size >= stage.minSize &&
        (cityCountByContinent.get(label) ?? 0) >= stage.minCities
      );
    });

    let best: { a: City; b: City; score: number } | null = null;
    for (let i = 0; i < eligible.length; i++) {
      for (let j = i + 1; j < eligible.length; j++) {
        const a = eligible[i] as City;
        const b = eligible[j] as City;
        const labelA = labels[tileIndex(a.x, a.y, world.width)];
        const labelB = labels[tileIndex(b.x, b.y, world.width)];
        // Prefer starts on different continents — a shared home continent
        // makes the early game a pure land rush.
        const score = dist2(a.x, a.y, b.x, b.y) * (labelA === labelB ? 0.25 : 1);
        if (best === null || score > best.score) {
          best = { a, b, score };
        }
      }
    }

    if (best !== null) {
      const distance = Math.sqrt(dist2(best.a.x, best.a.y, best.b.x, best.b.y));
      if (distance >= 0.3 * diag) {
        return [best.a.id, best.b.id];
      }
    }
  }
  return null;
}

/**
 * Generate a complete world: terrain, neutral cities, and two starting cities.
 * Deterministic for a given rng state. Throws if no acceptable world emerges
 * after many attempts (indicates broken tuning, not bad luck).
 */
export function generateWorld(rng: Rng, opts: WorldGenOptions): World {
  const { width, height, cityCount } = opts;

  for (let attempt = 0; attempt < 60; attempt++) {
    const terrain = generateTerrain(rng, width, height);
    const { labels, continents } = findContinents(terrain, width, height);
    const cities = placeCities(rng, width, continents, cityCount);
    if (cities.length < Math.max(4, cityCount * 0.5)) continue;

    const starts = pickStarts({ width, height, cities }, labels, continents);
    if (starts === null) continue;

    const cityAt = new Int32Array(width * height).fill(-1);
    for (const city of cities) {
      cityAt[tileIndex(city.x, city.y, width)] = city.id;
    }

    const coastal = computePorts(width, height, terrain, cities);
    return { width, height, terrain, cities, cityAt, starts, coastal };
  }
  throw new Error(`Map generation failed for ${width}x${height} with ${cityCount} cities`);
}

/**
 * A city is a port (can build ships) only if it touches genuine open sea — a
 * sea tile inside the playable area, not the map-edge border ring, which is
 * the map's boundary rather than a harbour. This is what stops edge cities
 * with no real water beside them from building ships.
 */
export function computePorts(
  width: number,
  height: number,
  terrain: Uint8Array,
  cities: readonly City[],
): boolean[] {
  const { mx, my } = borderMargin(width, height);
  const isOpenSea = (x: number, y: number): boolean =>
    x >= mx &&
    y >= my &&
    x < width - mx &&
    y < height - my &&
    terrain[tileIndex(x, y, width)] === TERRAIN_SEA;
  return cities.map((city) => {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (isOpenSea(city.x + dx, city.y + dy)) return true;
      }
    }
    return false;
  });
}
