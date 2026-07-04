import { createRng, type Rng } from './rng';
import { generateWorld, type World } from './mapgen';
import { createFog, refreshFog, type Fog, type VisionSource } from './fog';
import { inBounds, tileIndex } from './grid';
import { MAP_SIZES, UNIT_SPECS, VISION_CITY, type MapSizeKey, type UnitType } from './rules';

export type PlayerId = 0 | 1;
export const NEUTRAL = -1;

export interface Unit {
  id: number;
  type: UnitType;
  owner: PlayerId;
  x: number;
  y: number;
  hits: number;
  movesLeft: number;
  /** Fighters only: remaining moves before it must land. */
  fuel: number;
  /** Unit id of the transport/carrier this unit is riding, or null. */
  aboard: number | null;
  /**
   * Standing order:
   *  - 'awake'  wants orders / idle
   *  - 'sentry' skips the orders cycle until an enemy comes adjacent
   *  - 'moveto' walking toward `dest`, then goes awake
   *  - 'patrol' cycling `patrol.route` forever until it spots an enemy
   */
  mode: 'awake' | 'sentry' | 'moveto' | 'patrol';
  /** Standing move-to order destination (mode === 'moveto'). */
  dest: { x: number; y: number } | null;
  /** Patrol route + index of the waypoint currently being sought (mode === 'patrol'). */
  patrol: { route: { x: number; y: number }[]; index: number } | null;
}

export interface Production {
  type: UnitType;
  progress: number;
}

export type GameEvent =
  | {
      kind: 'battle';
      at: { x: number; y: number };
      attacker: UnitType;
      attackerOwner: PlayerId;
      defender: UnitType;
      defenderOwner: PlayerId;
      winner: 'attacker' | 'defender';
    }
  | { kind: 'capture'; at: { x: number; y: number }; cityId: number; by: PlayerId }
  | { kind: 'captureFailed'; at: { x: number; y: number }; cityId: number; by: PlayerId }
  | { kind: 'crash'; at: { x: number; y: number }; owner: PlayerId }
  | { kind: 'produced'; cityId: number; owner: PlayerId; unit: UnitType }
  | { kind: 'victory'; winner: PlayerId };

export interface GameState {
  seed: number;
  sizeKey: MapSizeKey;
  world: World;
  /** Owner per city id: NEUTRAL, 0, or 1. */
  cityOwners: Int8Array;
  /** What each city is building (index = city id; null = nothing). */
  production: (Production | null)[];
  units: Map<number, Unit>;
  nextUnitId: number;
  fogs: [Fog, Fog];
  turn: number;
  currentPlayer: PlayerId;
  winner: PlayerId | null;
  /** Events not yet delivered to each player's view. */
  pendingEvents: [GameEvent[], GameEvent[]];
  /** RNG for everything after worldgen (combat rolls, etc.). */
  rng: Rng;
}

export function spec(type: UnitType) {
  return UNIT_SPECS[type];
}

/** The unit occupying a tile (cargo aboard other units doesn't occupy). */
export function unitAt(state: GameState, x: number, y: number): Unit | undefined {
  for (const unit of state.units.values()) {
    if (unit.aboard === null && unit.x === x && unit.y === y) return unit;
  }
  return undefined;
}

export function unitsAt(state: GameState, x: number, y: number): Unit[] {
  const result: Unit[] = [];
  for (const unit of state.units.values()) {
    if (unit.aboard === null && unit.x === x && unit.y === y) result.push(unit);
  }
  return result;
}

export function cargoOf(state: GameState, carrierId: number): Unit[] {
  const result: Unit[] = [];
  for (const unit of state.units.values()) {
    if (unit.aboard === carrierId) result.push(unit);
  }
  return result;
}

export function cityIdAt(state: GameState, x: number, y: number): number {
  if (!inBounds(x, y, state.world.width, state.world.height)) return -1;
  return state.world.cityAt[tileIndex(x, y, state.world.width)] as number;
}

/** Cities with at least one 8-adjacent sea tile can build and host ships. */
export function isCoastalCity(world: World, cityId: number): boolean {
  // Precomputed at generation time: true only for cities beside genuine open
  // sea, not the map-edge border ring. See generateWorld.
  return world.coastal[cityId] ?? false;
}

export function spawnUnit(
  state: GameState,
  type: UnitType,
  owner: PlayerId,
  x: number,
  y: number,
): Unit {
  const s = spec(type);
  const unit: Unit = {
    id: state.nextUnitId++,
    type,
    owner,
    x,
    y,
    hits: s.hits,
    movesLeft: 0,
    fuel: s.fuel ?? 0,
    aboard: null,
    mode: 'awake',
    dest: null,
    patrol: null,
  };
  state.units.set(unit.id, unit);
  return unit;
}

export function removeUnit(state: GameState, unitId: number): void {
  // Anything riding a destroyed carrier goes down with it.
  for (const cargo of cargoOf(state, unitId)) {
    state.units.delete(cargo.id);
  }
  state.units.delete(unitId);
}

/** Everything currently granting a player vision: cities + surface units. */
export function visionSourcesFor(state: GameState, player: PlayerId): VisionSource[] {
  const sources: VisionSource[] = [];
  for (const city of state.world.cities) {
    if (state.cityOwners[city.id] === player) {
      sources.push({ x: city.x, y: city.y, radius: VISION_CITY });
    }
  }
  for (const unit of state.units.values()) {
    if (unit.owner === player && unit.aboard === null) {
      sources.push({ x: unit.x, y: unit.y, radius: spec(unit.type).vision });
    }
  }
  return sources;
}

export function refreshPlayerFog(state: GameState, player: PlayerId): void {
  refreshFog(state.fogs[player], state.world, state.cityOwners, visionSourcesFor(state, player));
}

export function refreshAllFog(state: GameState): void {
  refreshPlayerFog(state, 0);
  refreshPlayerFog(state, 1);
}

export function emitEvent(state: GameState, event: GameEvent, players: PlayerId[]): void {
  for (const player of players) {
    state.pendingEvents[player].push(event);
  }
}

/** Players who currently see the given tile (for event visibility). */
export function playersSeeing(state: GameState, x: number, y: number): PlayerId[] {
  const i = tileIndex(x, y, state.world.width);
  const result: PlayerId[] = [];
  for (const player of [0, 1] as const) {
    if (state.fogs[player].state[i] === 2) result.push(player);
  }
  return result;
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
    production: world.cities.map(() => null),
    units: new Map(),
    nextUnitId: 1,
    fogs: [createFog(world), createFog(world)],
    turn: 1,
    currentPlayer: 0,
    winner: null,
    pendingEvents: [[], []],
    rng,
  };
  refreshAllFog(state);
  return state;
}
