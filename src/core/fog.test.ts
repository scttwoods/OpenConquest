import { describe, expect, it } from 'vitest';
import {
  createFog,
  FOG_REMEMBERED,
  FOG_UNSEEN,
  FOG_VISIBLE,
  OWNER_UNKNOWN,
  refreshFog,
} from './fog';
import { TERRAIN_LAND, type World } from './mapgen';
import { tileIndex } from './grid';

/** Handcrafted 10x10 all-land world with one city at (5,5). */
function makeWorld(): World {
  const width = 10;
  const height = 10;
  const cityAt = new Int32Array(width * height).fill(-1);
  cityAt[tileIndex(5, 5, width)] = 0;
  return {
    width,
    height,
    terrain: new Uint8Array(width * height).fill(TERRAIN_LAND),
    cities: [{ id: 0, x: 5, y: 5 }],
    cityAt,
    starts: [0, 0],
  };
}

describe('fog of war', () => {
  it('starts fully unseen with unknown cities', () => {
    const fog = createFog(makeWorld());
    expect(fog.state.every((s) => s === FOG_UNSEEN)).toBe(true);
    expect(fog.cityOwner[0]).toBe(OWNER_UNKNOWN);
  });

  it('marks a Chebyshev disc visible around a source', () => {
    const world = makeWorld();
    const fog = createFog(world);
    const owners = new Int8Array([0]);
    refreshFog(fog, world, owners, [{ x: 5, y: 5, radius: 2 }]);

    expect(fog.state[tileIndex(5, 5, world.width)]).toBe(FOG_VISIBLE);
    expect(fog.state[tileIndex(7, 7, world.width)]).toBe(FOG_VISIBLE); // corner of disc
    expect(fog.state[tileIndex(8, 5, world.width)]).toBe(FOG_UNSEEN); // just outside
    expect(fog.state[tileIndex(0, 0, world.width)]).toBe(FOG_UNSEEN);

    const visibleCount = fog.state.reduce((n, s) => n + (s === FOG_VISIBLE ? 1 : 0), 0);
    expect(visibleCount).toBe(25); // full 5x5 disc
  });

  it('clips vision at the map edge', () => {
    const world = makeWorld();
    const fog = createFog(world);
    refreshFog(fog, world, new Int8Array([0]), [{ x: 0, y: 0, radius: 2 }]);
    const visibleCount = fog.state.reduce((n, s) => n + (s === FOG_VISIBLE ? 1 : 0), 0);
    expect(visibleCount).toBe(9); // 3x3 corner clip
  });

  it('downgrades to remembered when vision moves away', () => {
    const world = makeWorld();
    const fog = createFog(world);
    const owners = new Int8Array([0]);
    refreshFog(fog, world, owners, [{ x: 5, y: 5, radius: 1 }]);
    refreshFog(fog, world, owners, [{ x: 0, y: 0, radius: 1 }]);

    expect(fog.state[tileIndex(5, 5, world.width)]).toBe(FOG_REMEMBERED);
    expect(fog.state[tileIndex(0, 0, world.width)]).toBe(FOG_VISIBLE);
    expect(fog.state[tileIndex(9, 9, world.width)]).toBe(FOG_UNSEEN);
  });

  it('keeps stale city intel: remembered owner does not update out of sight', () => {
    const world = makeWorld();
    const fog = createFog(world);
    const owners = new Int8Array([0]);

    // See the city while player 0 owns it.
    refreshFog(fog, world, owners, [{ x: 5, y: 5, radius: 1 }]);
    expect(fog.cityOwner[0]).toBe(0);

    // Lose sight; ownership flips to player 1. Memory must stay stale.
    owners[0] = 1;
    refreshFog(fog, world, owners, [{ x: 0, y: 0, radius: 1 }]);
    expect(fog.cityOwner[0]).toBe(0);

    // Regain sight: memory updates.
    refreshFog(fog, world, owners, [{ x: 5, y: 5, radius: 1 }]);
    expect(fog.cityOwner[0]).toBe(1);
  });
});
