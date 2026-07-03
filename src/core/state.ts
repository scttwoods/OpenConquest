import { createRng, type Rng } from './rng';
import { generateWorld, type World } from './mapgen';
import { createFog, refreshFog, type Fog, type VisionSource } from './fog';
import { MAP_SIZES, VISION_CITY, type MapSizeKey } from './rules';

export type PlayerId = 0 | 1;
export const NEUTRAL = -1;

export interface GameState {
  seed: number;
  sizeKey: MapSizeKey;
  world: World;
  /** Owner per city id: NEUTRAL, 0, or 1. */
  cityOwners: Int8Array;
  fogs: [Fog, Fog];
  turn: number;
  /** RNG for everything after worldgen (combat rolls, etc.). */
  rng: Rng;
}

/** Everything currently granting a player vision. Units join this in Phase 2. */
export function visionSourcesFor(state: GameState, player: PlayerId): VisionSource[] {
  const sources: VisionSource[] = [];
  for (const city of state.world.cities) {
    if (state.cityOwners[city.id] === player) {
      sources.push({ x: city.x, y: city.y, radius: VISION_CITY });
    }
  }
  return sources;
}

export function refreshPlayerFog(state: GameState, player: PlayerId): void {
  refreshFog(state.fogs[player], state.world, state.cityOwners, visionSourcesFor(state, player));
}

export function createGame(seed: number, sizeKey: MapSizeKey): GameState {
  const size = MAP_SIZES[sizeKey];
  const rng = createRng(seed);
  const world = generateWorld(rng, {
    width: size.width,
    height: size.height,
    cityCount: size.cityCount,
  });

  const cityOwners = new Int8Array(world.cities.length).fill(NEUTRAL);
  cityOwners[world.starts[0]] = 0;
  cityOwners[world.starts[1]] = 1;

  const state: GameState = {
    seed,
    sizeKey,
    world,
    cityOwners,
    fogs: [createFog(world), createFog(world)],
    turn: 1,
    rng,
  };
  refreshPlayerFog(state, 0);
  refreshPlayerFog(state, 1);
  return state;
}
