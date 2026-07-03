import { createRng } from './rng';
import { generateWorld } from './mapgen';
import { createFog } from './fog';
import { MAP_SIZES, type MapSizeKey, type UnitType } from './rules';
import type { GameState, PlayerId, Production, Unit } from './state';
import { refreshAllFog } from './state';

/**
 * Serialized game. The world itself is NOT stored — it regenerates
 * deterministically from the seed; only post-worldgen rng state and the
 * mutable pieces are persisted. Used for vs-AI saves and PvP server storage.
 */
export interface SaveData {
  version: 1;
  seed: number;
  sizeKey: MapSizeKey;
  rngState: number;
  turn: number;
  currentPlayer: PlayerId;
  winner: PlayerId | null;
  nextUnitId: number;
  cityOwners: number[];
  production: ({ type: UnitType; progress: number } | null)[];
  units: Unit[];
  fogs: { state: number[]; cityOwner: number[] }[];
}

export function serializeGame(state: GameState): SaveData {
  return {
    version: 1,
    seed: state.seed,
    sizeKey: state.sizeKey,
    rngState: state.rng.getState(),
    turn: state.turn,
    currentPlayer: state.currentPlayer,
    winner: state.winner,
    nextUnitId: state.nextUnitId,
    cityOwners: Array.from(state.cityOwners),
    production: state.production.map((p): SaveData['production'][number] =>
      p === null ? null : { ...p },
    ),
    units: [...state.units.values()].map((u) => ({
      ...u,
      dest: u.dest === null ? null : { ...u.dest },
    })),
    fogs: state.fogs.map((f) => ({
      state: Array.from(f.state),
      cityOwner: Array.from(f.cityOwner),
    })),
  };
}

export function deserializeGame(data: SaveData): GameState {
  const size = MAP_SIZES[data.sizeKey];
  const rng = createRng(data.seed);
  const world = generateWorld(rng, {
    width: size.width,
    height: size.height,
    cityCount: size.cityCount,
  });
  rng.setState(data.rngState);

  const fogs: [ReturnType<typeof createFog>, ReturnType<typeof createFog>] = [
    createFog(world),
    createFog(world),
  ];
  data.fogs.forEach((saved, i) => {
    fogs[i as 0 | 1].state.set(saved.state);
    fogs[i as 0 | 1].cityOwner.set(saved.cityOwner);
  });

  const state: GameState = {
    seed: data.seed,
    sizeKey: data.sizeKey,
    world,
    cityOwners: Int8Array.from(data.cityOwners),
    production: data.production.map((p): Production | null => (p === null ? null : { ...p })),
    units: new Map(
      data.units.map((u) => [u.id, { ...u, dest: u.dest === null ? null : { ...u.dest } }]),
    ),
    nextUnitId: data.nextUnitId,
    fogs,
    turn: data.turn,
    currentPlayer: data.currentPlayer,
    winner: data.winner,
    pendingEvents: [[], []],
    rng,
  };
  refreshAllFog(state);
  return state;
}
