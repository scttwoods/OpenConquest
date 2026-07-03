import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import { findContinents, generateWorld, TERRAIN_LAND, type World } from './mapgen';
import { LAND_FRACTION, MAP_SIZES, MIN_CITY_DISTANCE, type MapSizeKey } from './rules';
import { chebyshev, dist2, tileIndex } from './grid';

function gen(seed: number, sizeKey: MapSizeKey = 'medium'): World {
  const size = MAP_SIZES[sizeKey];
  return generateWorld(createRng(seed), {
    width: size.width,
    height: size.height,
    cityCount: size.cityCount,
  });
}

const SEEDS = [1, 2, 3, 4, 5];
const SIZES: MapSizeKey[] = ['small', 'medium', 'large'];

describe('generateWorld', () => {
  it('is fully deterministic for a given seed', () => {
    const a = gen(42);
    const b = gen(42);
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(a.cities).toEqual(b.cities);
    expect(a.starts).toEqual(b.starts);
  });

  it('differs across seeds', () => {
    const a = gen(1);
    const b = gen(2);
    expect(Array.from(a.terrain)).not.toEqual(Array.from(b.terrain));
  });

  it.each(SIZES)('generates every size for a spread of seeds (%s)', (sizeKey) => {
    for (const seed of SEEDS) {
      expect(() => gen(seed, sizeKey)).not.toThrow();
    }
  });

  it('hits a sane land fraction', () => {
    for (const seed of SEEDS) {
      const world = gen(seed);
      const land = world.terrain.reduce((n, t) => n + t, 0);
      const fraction = land / world.terrain.length;
      expect(fraction).toBeGreaterThan(LAND_FRACTION * 0.8);
      expect(fraction).toBeLessThan(LAND_FRACTION * 1.2);
    }
  });

  it('places a reasonable number of cities, all on land, all spaced out', () => {
    for (const seed of SEEDS) {
      const world = gen(seed);
      const target = MAP_SIZES.medium.cityCount;
      expect(world.cities.length).toBeGreaterThanOrEqual(target * 0.5);
      expect(world.cities.length).toBeLessThanOrEqual(target * 1.5);

      for (const city of world.cities) {
        expect(world.terrain[tileIndex(city.x, city.y, world.width)]).toBe(TERRAIN_LAND);
        expect(world.cityAt[tileIndex(city.x, city.y, world.width)]).toBe(city.id);
      }
      for (let i = 0; i < world.cities.length; i++) {
        for (let j = i + 1; j < world.cities.length; j++) {
          const a = world.cities[i]!;
          const b = world.cities[j]!;
          expect(chebyshev(a.x, a.y, b.x, b.y)).toBeGreaterThanOrEqual(MIN_CITY_DISTANCE);
        }
      }
    }
  });

  it('picks two distinct, distant starting cities on real continents', () => {
    for (const seed of SEEDS) {
      const world = gen(seed);
      const [aId, bId] = world.starts;
      expect(aId).not.toBe(bId);
      const a = world.cities[aId]!;
      const b = world.cities[bId]!;

      const diag = Math.sqrt(world.width ** 2 + world.height ** 2);
      expect(Math.sqrt(dist2(a.x, a.y, b.x, b.y))).toBeGreaterThanOrEqual(0.3 * diag);

      // Each start's continent is connected by construction; check it is
      // big enough to be worth holding and has at least one city to conquer.
      const { labels, continents } = findContinents(world.terrain, world.width, world.height);
      for (const start of [a, b]) {
        const label = labels[tileIndex(start.x, start.y, world.width)]!;
        const continent = continents[label]!;
        expect(continent.size).toBeGreaterThanOrEqual(15);
        const citiesHere = world.cities.filter(
          (c) => labels[tileIndex(c.x, c.y, world.width)] === label,
        );
        expect(citiesHere.length).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('findContinents', () => {
  it('labels components correctly on a handcrafted map', () => {
    // 5x3: two islands — left 2x2 block, right single tile.
    const width = 5;
    const height = 3;
    const terrain = new Uint8Array(width * height);
    terrain[tileIndex(0, 0, width)] = TERRAIN_LAND;
    terrain[tileIndex(1, 0, width)] = TERRAIN_LAND;
    terrain[tileIndex(0, 1, width)] = TERRAIN_LAND;
    terrain[tileIndex(1, 1, width)] = TERRAIN_LAND;
    terrain[tileIndex(4, 2, width)] = TERRAIN_LAND;

    const { labels, continents } = findContinents(terrain, width, height);
    expect(continents.length).toBe(2);
    const sizes = continents.map((c) => c.size).sort((x, y) => x - y);
    expect(sizes).toEqual([1, 4]);
    expect(labels[tileIndex(0, 0, width)]).toBe(labels[tileIndex(1, 1, width)]);
    expect(labels[tileIndex(0, 0, width)]).not.toBe(labels[tileIndex(4, 2, width)]);
    expect(labels[tileIndex(2, 0, width)]).toBe(-1); // sea
  });
});
