import type { World } from './mapgen';
import { inBounds, tileIndex } from './grid';

/** Per-tile fog states, per player. */
export const FOG_UNSEEN = 0;
export const FOG_REMEMBERED = 1;
export const FOG_VISIBLE = 2;

/** Sentinel for "this player has never seen this city". */
export const OWNER_UNKNOWN = -2;

export interface VisionSource {
  x: number;
  y: number;
  /** Chebyshev radius. */
  radius: number;
}

export interface Fog {
  /** FOG_* per tile. */
  state: Uint8Array;
  /**
   * Last-seen owner per city id (OWNER_UNKNOWN, -1 neutral, or player id).
   * This is the "stale intel" the player sees on remembered tiles — it does
   * NOT update while the city is out of sight.
   */
  cityOwner: Int8Array;
}

export function createFog(world: World): Fog {
  return {
    state: new Uint8Array(world.width * world.height).fill(FOG_UNSEEN),
    cityOwner: new Int8Array(world.cities.length).fill(OWNER_UNKNOWN),
  };
}

/**
 * Recompute current visibility from the given sources. Previously visible
 * tiles fall back to remembered; cities inside vision get their owner
 * snapshotted into the player's memory.
 */
export function refreshFog(
  fog: Fog,
  world: World,
  cityOwners: Int8Array,
  sources: readonly VisionSource[],
): void {
  const { width, height, cityAt } = world;

  for (let i = 0; i < fog.state.length; i++) {
    if (fog.state[i] === FOG_VISIBLE) {
      fog.state[i] = FOG_REMEMBERED;
    }
  }

  for (const source of sources) {
    for (let dy = -source.radius; dy <= source.radius; dy++) {
      for (let dx = -source.radius; dx <= source.radius; dx++) {
        const x = source.x + dx;
        const y = source.y + dy;
        if (!inBounds(x, y, width, height)) continue;
        const i = tileIndex(x, y, width);
        fog.state[i] = FOG_VISIBLE;
        const cityId = cityAt[i] as number;
        if (cityId >= 0) {
          fog.cityOwner[cityId] = cityOwners[cityId] as number;
        }
      }
    }
  }
}
