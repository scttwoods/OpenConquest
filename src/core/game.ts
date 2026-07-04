import { chebyshev, tileIndex } from './grid';
import { TERRAIN_LAND } from './mapgen';
import { CITY_CAPTURE_CHANCE, COMBAT_ROUND_CHANCE, UNIT_SPECS, type UnitType } from './rules';
import { nextStepToward, terrainPassable } from './path';
import {
  cargoOf,
  cityIdAt,
  emitEvent,
  isCoastalCity,
  playersSeeing,
  refreshAllFog,
  removeUnit,
  spawnUnit,
  spec,
  unitsAt,
  NEUTRAL,
  type GameState,
  type PlayerId,
  type Unit,
} from './state';

export type Command =
  | { type: 'move'; unitId: number; to: { x: number; y: number } }
  | { type: 'setProduction'; cityId: number; unit: UnitType }
  | {
      type: 'order';
      unitId: number;
      order:
        | 'sentry'
        | 'awake'
        | 'skip'
        | { moveTo: { x: number; y: number } }
        | { patrol: { x: number; y: number }[] };
    }
  // Load a unit onto a transport/carrier already sharing its tile (e.g. both
  // sitting in a coastal city, where there's no tile to "move onto").
  | { type: 'board'; unitId: number; carrierId: number }
  | { type: 'endTurn' }
  | { type: 'surrender' };

export interface CommandResult {
  ok: boolean;
  error?: string;
}

function fail(error: string): CommandResult {
  return { ok: false, error };
}

const OK: CommandResult = { ok: true };

/** Everyone who should hear about something happening on this tile. */
function audience(state: GameState, x: number, y: number, ...always: PlayerId[]): PlayerId[] {
  const players = new Set<PlayerId>(playersSeeing(state, x, y));
  for (const p of always) players.add(p);
  return [...players];
}

function isBased(state: GameState, unit: Unit): boolean {
  if (unit.aboard !== null) return true;
  const cityId = cityIdAt(state, unit.x, unit.y);
  return cityId >= 0 && state.cityOwners[cityId] === unit.owner;
}

/** Post-move bookkeeping for fighters: burn fuel, refuel or crash. */
function fighterFuelCheck(state: GameState, unit: Unit): void {
  if (unit.type !== 'fighter' || !state.units.has(unit.id)) return;
  if (isBased(state, unit)) {
    unit.fuel = spec('fighter').fuel ?? 0;
    return;
  }
  if (unit.fuel <= 0) {
    emitEvent(
      state,
      { kind: 'crash', at: { x: unit.x, y: unit.y }, owner: unit.owner },
      audience(state, unit.x, unit.y, unit.owner),
    );
    removeUnit(state, unit.id);
  }
}

/** Alternating combat rounds until one side is destroyed. */
function resolveCombat(state: GameState, attacker: Unit, defender: Unit): void {
  while (attacker.hits > 0 && defender.hits > 0) {
    if (state.rng.chance(COMBAT_ROUND_CHANCE)) {
      defender.hits -= spec(attacker.type).damage;
    } else {
      attacker.hits -= spec(defender.type).damage;
    }
  }
  const winner = attacker.hits > 0 ? 'attacker' : 'defender';
  const loser = winner === 'attacker' ? defender : attacker;
  emitEvent(
    state,
    {
      kind: 'battle',
      at: { x: defender.x, y: defender.y },
      attacker: attacker.type,
      attackerOwner: attacker.owner,
      defender: defender.type,
      defenderOwner: defender.owner,
      winner,
    },
    audience(state, defender.x, defender.y, attacker.owner, defender.owner),
  );
  removeUnit(state, loser.id);
}

function canAttack(attacker: Unit, defender: Unit): boolean {
  const a = spec(attacker.type).domain;
  const d = spec(defender.type).domain;
  if (a === 'air') return true;
  if (a === 'land') return d !== 'sea';
  return d !== 'land'; // sea attacks sea units and fighters over water
}

/** Toughest garrison unit defends the stack. */
function pickDefender(garrison: Unit[]): Unit {
  let best = garrison[0] as Unit;
  for (const unit of garrison) {
    if (unit.hits > best.hits) best = unit;
  }
  return best;
}

function moveCargoWith(state: GameState, carrier: Unit): void {
  for (const cargo of cargoOf(state, carrier.id)) {
    cargo.x = carrier.x;
    cargo.y = carrier.y;
  }
}

function enterTile(state: GameState, unit: Unit, x: number, y: number): void {
  unit.aboard = null;
  unit.x = x;
  unit.y = y;
  moveCargoWith(state, unit);
}

/**
 * Execute a single one-tile move (or attack / board / capture attempt).
 * The core rule surface of the whole game lives here.
 */
function moveStep(
  state: GameState,
  player: PlayerId,
  unit: Unit,
  tx: number,
  ty: number,
): CommandResult {
  const s = spec(unit.type);
  if (unit.movesLeft <= 0) return fail('No moves left');
  if (chebyshev(unit.x, unit.y, tx, ty) !== 1) return fail('Destination is not adjacent');
  if (unit.type === 'fighter' && unit.fuel <= 0) return fail('Out of fuel');

  const cityId = cityIdAt(state, tx, ty);
  const cityOwner = cityId >= 0 ? (state.cityOwners[cityId] as number) : null;
  const occupants = unitsAt(state, tx, ty);
  const enemies = occupants.filter((u) => u.owner !== player);
  const friends = occupants.filter((u) => u.owner === player);

  const spendMove = (): void => {
    unit.movesLeft--;
    if (unit.type === 'fighter') unit.fuel--;
  };

  // --- Enemy units on the target tile: attack ---
  if (enemies.length > 0) {
    const defender = pickDefender(enemies);
    if (!canAttack(unit, defender)) return fail(`${s.name} cannot attack that`);
    unit.mode = 'awake';
    unit.dest = null;
    spendMove();
    resolveCombat(state, unit, defender);
    if (state.units.has(unit.id)) {
      // Advance into a cleared tile — but never into a city that still must
      // be captured, and only onto terrain the winner can occupy.
      const cleared = unitsAt(state, tx, ty).filter((u) => u.owner !== player).length === 0;
      const hostileCity = cityId >= 0 && cityOwner !== player;
      if (cleared && !hostileCity && terrainPassable(state, s.domain, tx, ty)) {
        enterTile(state, unit, tx, ty);
      }
      fighterFuelCheck(state, unit);
    }
    refreshAllFog(state);
    checkVictory(state);
    return OK;
  }

  // --- City tiles ---
  if (cityId >= 0 && cityOwner !== player) {
    if (unit.type !== 'army') return fail('Only armies can take cities');
    unit.mode = 'awake';
    unit.dest = null;
    spendMove();
    if (state.rng.chance(CITY_CAPTURE_CHANCE)) {
      state.cityOwners[cityId] = player;
      state.production[cityId] = null;
      enterTile(state, unit, tx, ty);
      emitEvent(
        state,
        { kind: 'capture', at: { x: tx, y: ty }, cityId, by: player },
        cityOwner === NEUTRAL ? audience(state, tx, ty, player) : [0, 1],
      );
    } else {
      emitEvent(
        state,
        { kind: 'captureFailed', at: { x: tx, y: ty }, cityId, by: player },
        audience(state, tx, ty, player),
      );
      removeUnit(state, unit.id);
    }
    refreshAllFog(state);
    checkVictory(state);
    return OK;
  }

  // --- Boarding friendly transports / carriers ---
  // Boarding takes priority over stacking: moving an Army onto a friendly
  // Transport (or a Fighter onto a Carrier) with room loads it as cargo.
  if (friends.length > 0) {
    const carrier = friends.find((f) => {
      const cap = spec(f.type).capacity;
      return cap !== undefined && cap.type === unit.type && cargoOf(state, f.id).length < cap.count;
    });
    if (carrier !== undefined && cityId < 0) {
      spendMove();
      unit.x = carrier.x;
      unit.y = carrier.y;
      unit.aboard = carrier.id;
      if (unit.type === 'fighter') unit.fuel = spec('fighter').fuel ?? 0;
      refreshAllFog(state);
      return OK;
    }
    // Otherwise friendly units freely share a tile — fall through to plain
    // movement, which still enforces terrain (no armies at sea, etc.).
  }

  // --- Plain movement (including into own cities) ---
  if (cityId >= 0 && cityOwner === player) {
    if (s.domain === 'sea' && !isCoastalCity(state.world, cityId)) {
      return fail('That city has no port');
    }
  } else if (!terrainPassable(state, s.domain, tx, ty)) {
    return fail(s.domain === 'land' ? 'Armies cannot enter the sea' : 'Ships cannot cross land');
  }

  spendMove();
  enterTile(state, unit, tx, ty);
  fighterFuelCheck(state, unit);
  refreshAllFog(state);
  return OK;
}

/** Walk a unit along its standing move-to order as far as this turn allows. */
function runMoveToOrder(state: GameState, unit: Unit): void {
  while (
    unit.mode === 'moveto' &&
    unit.dest !== null &&
    unit.movesLeft > 0 &&
    state.units.has(unit.id)
  ) {
    const dest = unit.dest;
    if (unit.x === dest.x && unit.y === dest.y) {
      unit.mode = 'awake';
      unit.dest = null;
      return;
    }
    const step = nextStepToward(state, spec(unit.type).domain, unit.x, unit.y, dest.x, dest.y);
    if (step === null) {
      unit.mode = 'awake';
      unit.dest = null;
      return;
    }
    const isFinal = step.x === dest.x && step.y === dest.y;
    const enemies = unitsAt(state, step.x, step.y).filter((u) => u.owner !== unit.owner);
    const cityId = cityIdAt(state, step.x, step.y);
    const hostileCity = cityId >= 0 && state.cityOwners[cityId] !== unit.owner;
    // Standing orders never start fights on their own — wake and let the
    // player (or AI) decide, unless the fight IS the ordered destination.
    if (!isFinal && (enemies.length > 0 || hostileCity)) {
      unit.mode = 'awake';
      unit.dest = null;
      return;
    }
    const before = unit.movesLeft;
    const result = moveStep(state, unit.owner, unit, step.x, step.y);
    if (!result.ok || unit.movesLeft === before) {
      // Blocked (probably by a friendly unit) — try again next turn.
      return;
    }
    if (isFinal) {
      if (unit.mode === 'moveto') {
        unit.mode = 'awake';
        unit.dest = null;
      }
      return;
    }
  }
}

/** An enemy surface unit within this unit's own vision radius, if any. */
function enemyWithinVision(state: GameState, unit: Unit): Unit | undefined {
  const radius = spec(unit.type).vision;
  for (const other of state.units.values()) {
    if (
      other.owner !== unit.owner &&
      other.aboard === null &&
      chebyshev(unit.x, unit.y, other.x, other.y) <= radius
    ) {
      return other;
    }
  }
  return undefined;
}

/**
 * Advance a patrolling unit along its route this turn. It never starts a
 * fight and never ends the order on its own — it loops the waypoints until
 * it spots an enemy (which wakes it) or the player cancels.
 */
function runPatrolOrder(state: GameState, unit: Unit): void {
  const patrol = unit.patrol;
  if (patrol === null || patrol.route.length < 2) {
    unit.mode = 'awake';
    unit.patrol = null;
    return;
  }
  // Spotting an enemy at any point halts the patrol and hands back control.
  if (enemyWithinVision(state, unit) !== undefined) {
    unit.mode = 'awake';
    return;
  }

  let guard = patrol.route.length + 1; // bound waypoint hops per turn
  while (unit.mode === 'patrol' && unit.movesLeft > 0 && state.units.has(unit.id)) {
    let target = patrol.route[patrol.index] as { x: number; y: number };
    if (unit.x === target.x && unit.y === target.y) {
      patrol.index = (patrol.index + 1) % patrol.route.length;
      target = patrol.route[patrol.index] as { x: number; y: number };
      if (--guard <= 0) return;
    }
    const step = nextStepToward(state, spec(unit.type).domain, unit.x, unit.y, target.x, target.y);
    if (step === null) {
      // This leg is unreachable (e.g. terrain changed hands); skip to the next.
      patrol.index = (patrol.index + 1) % patrol.route.length;
      if (--guard <= 0) return;
      continue;
    }
    // Never walk into a fight while patrolling — wake and let the owner decide.
    const enemies = unitsAt(state, step.x, step.y).filter((u) => u.owner !== unit.owner);
    const cityId = cityIdAt(state, step.x, step.y);
    const hostileCity = cityId >= 0 && state.cityOwners[cityId] !== unit.owner;
    if (enemies.length > 0 || hostileCity) {
      unit.mode = 'awake';
      return;
    }
    const before = unit.movesLeft;
    const result = moveStep(state, unit.owner, unit, step.x, step.y);
    if (!result.ok || unit.movesLeft === before) return; // blocked; retry next turn
    // Moving may have brought a hidden enemy into view.
    if (enemyWithinVision(state, unit) !== undefined) {
      unit.mode = 'awake';
      return;
    }
  }
}

function startTurn(state: GameState, player: PlayerId): void {
  // Production.
  for (const city of state.world.cities) {
    if (state.cityOwners[city.id] !== player) continue;
    const production = state.production[city.id];
    if (production === null || production === undefined) continue;
    production.progress++;
    if (production.progress >= spec(production.type).buildTime) {
      spawnUnit(state, production.type, player, city.x, city.y);
      production.progress = 0;
      emitEvent(
        state,
        { kind: 'produced', cityId: city.id, owner: player, unit: production.type },
        [player],
      );
    }
  }

  // Unit upkeep: fresh moves, repairs, refueling, sentry wake-ups.
  for (const unit of state.units.values()) {
    if (unit.owner !== player) continue;
    unit.movesLeft = spec(unit.type).moves;
    const cityId = cityIdAt(state, unit.x, unit.y);
    const inOwnCity = cityId >= 0 && state.cityOwners[cityId] === player && unit.aboard === null;
    if (inOwnCity && spec(unit.type).domain === 'sea') {
      unit.hits = Math.min(unit.hits + 1, spec(unit.type).hits);
    }
    if (unit.type === 'fighter' && isBased(state, unit)) {
      unit.fuel = spec('fighter').fuel ?? 0;
    }
    if (unit.mode === 'sentry') {
      for (const other of state.units.values()) {
        if (
          other.owner !== player &&
          other.aboard === null &&
          chebyshev(unit.x, unit.y, other.x, other.y) <= 1
        ) {
          unit.mode = 'awake';
          break;
        }
      }
    }
  }

  refreshAllFog(state);
}

/**
 * Advance every one of a player's units that is under a standing move order.
 * This runs when the player ENDS their turn — not at the start — so that
 * during the turn those units still have their moves and can be redirected or
 * have their order cancelled.
 */
function executeStandingOrders(state: GameState, player: PlayerId): void {
  for (const unit of [...state.units.values()]) {
    if (unit.owner !== player || unit.aboard !== null) continue;
    if (unit.mode === 'moveto') runMoveToOrder(state, unit);
    else if (unit.mode === 'patrol') runPatrolOrder(state, unit);
  }
  refreshAllFog(state);
}

export function countArmies(state: GameState, player: PlayerId): number {
  let n = 0;
  for (const unit of state.units.values()) {
    if (unit.owner === player && unit.type === 'army') n++;
  }
  return n;
}

export function countCities(state: GameState, player: PlayerId): number {
  let n = 0;
  for (const owner of state.cityOwners) {
    if (owner === player) n++;
  }
  return n;
}

function checkVictory(state: GameState): void {
  if (state.winner !== null) return;
  for (const player of [0, 1] as const) {
    // No cities and no armies (even aboard transports) means you can never
    // capture anything again — the war is lost.
    if (countCities(state, player) === 0 && countArmies(state, player) === 0) {
      state.winner = (1 - player) as PlayerId;
      emitEvent(state, { kind: 'victory', winner: state.winner }, [0, 1]);
      return;
    }
  }
}

/** Fighters caught in the open with dry tanks at end of turn go down. */
function crashStrandedFighters(state: GameState, player: PlayerId): void {
  for (const unit of [...state.units.values()]) {
    if (
      unit.owner === player &&
      unit.type === 'fighter' &&
      unit.fuel <= 0 &&
      !isBased(state, unit)
    ) {
      emitEvent(
        state,
        { kind: 'crash', at: { x: unit.x, y: unit.y }, owner: player },
        audience(state, unit.x, unit.y, player),
      );
      removeUnit(state, unit.id);
    }
  }
}

/**
 * The single entry point for changing game state. Both the local (vs AI)
 * session and the PvP server funnel every action through here.
 */
export function applyCommand(state: GameState, player: PlayerId, command: Command): CommandResult {
  if (state.winner !== null) return fail('The game is over');
  if (state.currentPlayer !== player) return fail('Not your turn');

  switch (command.type) {
    case 'move': {
      const unit = state.units.get(command.unitId);
      if (unit === undefined || unit.owner !== player) return fail('No such unit');
      const result = moveStep(state, player, unit, command.to.x, command.to.y);
      // A manual move overrides any standing plan, so the unit doesn't keep
      // travelling toward an old destination afterwards.
      if (result.ok && state.units.has(unit.id) && unit.aboard === null) {
        unit.mode = unit.mode === 'sentry' ? 'sentry' : 'awake';
        unit.dest = null;
      }
      return result;
    }

    case 'setProduction': {
      const city = state.world.cities[command.cityId];
      if (city === undefined || state.cityOwners[command.cityId] !== player)
        return fail('Not your city');
      if (UNIT_SPECS[command.unit] === undefined) return fail('Unknown unit type');
      if (spec(command.unit).domain === 'sea' && !isCoastalCity(state.world, command.cityId)) {
        return fail('Inland cities cannot build ships');
      }
      const current = state.production[command.cityId];
      if (current === null || current === undefined || current.type !== command.unit) {
        state.production[command.cityId] = { type: command.unit, progress: 0 };
      }
      return OK;
    }

    case 'order': {
      const unit = state.units.get(command.unitId);
      if (unit === undefined || unit.owner !== player) return fail('No such unit');
      if (command.order === 'sentry') {
        unit.mode = 'sentry';
        unit.dest = null;
        unit.patrol = null;
      } else if (command.order === 'awake') {
        unit.mode = 'awake';
        unit.dest = null;
        unit.patrol = null;
      } else if (command.order === 'skip') {
        unit.movesLeft = 0;
      } else if ('moveTo' in command.order) {
        const dest = command.order.moveTo;
        unit.patrol = null;
        if (dest.x === unit.x && dest.y === unit.y) return OK;
        unit.mode = 'moveto';
        unit.dest = { x: dest.x, y: dest.y };
        if (unit.aboard === null) runMoveToOrder(state, unit);
      } else {
        // Patrol: the unit's current tile anchors the loop, then the given
        // waypoints; it cycles them forever until it spots an enemy.
        const waypoints = command.order.patrol.filter(
          (p) => p.x >= 0 && p.y >= 0 && p.x < state.world.width && p.y < state.world.height,
        );
        const route = [{ x: unit.x, y: unit.y }, ...waypoints].filter(
          (p, i, arr) => i === 0 || p.x !== arr[i - 1]!.x || p.y !== arr[i - 1]!.y,
        );
        if (route.length < 2) return fail('A patrol needs at least one waypoint');
        unit.dest = null;
        unit.mode = 'patrol';
        unit.patrol = { route, index: 1 };
        if (unit.aboard === null) runPatrolOrder(state, unit);
      }
      refreshAllFog(state);
      return OK;
    }

    case 'board': {
      const unit = state.units.get(command.unitId);
      const carrier = state.units.get(command.carrierId);
      if (unit === undefined || unit.owner !== player) return fail('No such unit');
      if (carrier === undefined || carrier.owner !== player) return fail('No such transport');
      if (unit.aboard !== null) return fail('Already aboard');
      if (unit.movesLeft <= 0) return fail('No moves left');
      if (unit.x !== carrier.x || unit.y !== carrier.y) return fail('Not on the same tile');
      const cap = spec(carrier.type).capacity;
      if (cap === undefined || cap.type !== unit.type)
        return fail(`${spec(carrier.type).name} cannot carry that`);
      if (cargoOf(state, carrier.id).length >= cap.count) return fail('Transport is full');
      unit.aboard = carrier.id;
      unit.movesLeft = 0;
      unit.mode = 'awake';
      unit.dest = null;
      if (unit.type === 'fighter') unit.fuel = spec('fighter').fuel ?? 0;
      refreshAllFog(state);
      return OK;
    }

    case 'endTurn': {
      // Units under standing move orders travel now, as the turn closes.
      executeStandingOrders(state, player);
      crashStrandedFighters(state, player);
      checkVictory(state);
      if (state.winner !== null) return OK;
      const next = (1 - player) as PlayerId;
      state.currentPlayer = next;
      if (next === 0) state.turn++;
      startTurn(state, next);
      checkVictory(state);
      return OK;
    }

    case 'surrender': {
      state.winner = (1 - player) as PlayerId;
      emitEvent(state, { kind: 'victory', winner: state.winner }, [0, 1]);
      return OK;
    }
  }
}

/** Land tiles a garrison army could step onto — used by UI hints and the AI. */
export function canUnload(state: GameState, transport: Unit): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const x = transport.x + dx;
      const y = transport.y + dy;
      if (
        terrainPassable(state, 'land', x, y) &&
        state.world.terrain[tileIndex(x, y, state.world.width)] === TERRAIN_LAND
      ) {
        return true;
      }
    }
  }
  return false;
}
