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

/** Grow islands by random walks until the target land fraction is reached. */
function generateTerrain(rng: Rng, width: number, height: number): Uint8Array {
  const terrain = new Uint8Array(width * height).fill(TERRAIN_SEA);
  const target = Math.floor(width * height * LAND_FRACTION);
  // Keep walks away from the map border so the world reads as an ocean map.
  const marginX = Math.max(2, Math.floor(width * 0.06));
  const marginY = Math.max(2, Math.floor(height * 0.06));
  let land = 0;

  while (land < target) {
    let x = marginX + rng.int(width - 2 * marginX);
    let y = marginY + rng.int(height - 2 * marginY);
    const walkLength = 40 + rng.int(90);
    for (let step = 0; step < walkLength && land < target; step++) {
      const i = tileIndex(x, y, width);
      if (terrain[i] === TERRAIN_SEA) {
        terrain[i] = TERRAIN_LAND;
        land++;
      }
      const dir = DIRS4[rng.int(4)] as readonly [number, number];
      x = Math.min(width - 1 - marginX, Math.max(marginX, x + dir[0]));
      y = Math.min(height - 1 - marginY, Math.max(marginY, y + dir[1]));
    }
  }
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
    return { width, height, terrain, cities, cityAt, starts };
  }
  throw new Error(`Map generation failed for ${width}x${height} with ${cityCount} cities`);
}
