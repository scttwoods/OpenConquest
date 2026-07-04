import { applyCommand } from '../core/game';
import { FOG_UNSEEN, FOG_VISIBLE, OWNER_UNKNOWN } from '../core/fog';
import { chebyshev, tileIndex } from '../core/grid';
import { findContinents, TERRAIN_LAND, TERRAIN_SEA } from '../core/mapgen';
import { findNearest } from '../core/path';
import { UNIT_SPECS } from '../core/rules';
import { cargoOf, isCoastalCity, spec, unitsAt, type GameState, type Unit } from '../core/state';

/**
 * Heuristic computer opponent. It plays through the exact same command API
 * as a human and (mostly) honors its own fog of war: targets come from its
 * remembered city intel and visible enemies. It peeks at real terrain only
 * to avoid pathing into undiscovered walls — a pragmatic, minor cheat.
 */
export function aiTakeTurn(state: GameState): void {
  const me = state.currentPlayer;
  const fog = state.fogs[me];
  const { world } = state;
  const { labels } = findContinents(world.terrain, world.width, world.height);

  const labelAt = (x: number, y: number): number => labels[tileIndex(x, y, world.width)] as number;
  const fogAt = (x: number, y: number): number => fog.state[tileIndex(x, y, world.width)] as number;
  const landAt = (x: number, y: number): boolean =>
    world.terrain[tileIndex(x, y, world.width)] === TERRAIN_LAND;
  const seaAt = (x: number, y: number): boolean =>
    world.terrain[tileIndex(x, y, world.width)] === TERRAIN_SEA;

  /** Cities I know about that aren't mine (per my possibly-stale intel). */
  const knownTargets = world.cities.filter((c) => {
    const known = fog.cityOwner[c.id] as number;
    return known !== OWNER_UNKNOWN && known !== me;
  });

  const targetOnContinent = (label: number): boolean =>
    knownTargets.some((c) => labelAt(c.x, c.y) === label);

  const unseenLandOnContinent = (label: number): boolean => {
    for (let i = 0; i < world.terrain.length; i++) {
      if (labels[i] === label && fog.state[i] === FOG_UNSEEN) return true;
    }
    return false;
  };

  const continentNeedsArmies = (label: number): boolean =>
    targetOnContinent(label) || unseenLandOnContinent(label);

  const visibleEnemies = (): Unit[] => {
    const result: Unit[] = [];
    for (const unit of state.units.values()) {
      if (unit.owner !== me && unit.aboard === null && fogAt(unit.x, unit.y) === FOG_VISIBLE) {
        result.push(unit);
      }
    }
    return result;
  };

  const myUnits = (type?: string): Unit[] =>
    [...state.units.values()].filter(
      (u) => u.owner === me && (type === undefined || u.type === type),
    );

  // Continents I hold at least one city on (reachable by land from home).
  const myLabels = new Set<number>();
  for (const city of world.cities) {
    if (state.cityOwners[city.id] === me) myLabels.add(labelAt(city.x, city.y));
  }
  const homeTargets = knownTargets.filter((t) => myLabels.has(labelAt(t.x, t.y)));
  const overseasTargets = knownTargets.filter((t) => !myLabels.has(labelAt(t.x, t.y)));
  const enemy = (1 - me) as 0 | 1;
  // Prefer striking the enemy's own cities over grabbing neutral islands, so the
  // AI actually closes out a win instead of sprawling across empty land.
  const targetRank = (t: { id: number }): number =>
    (fog.cityOwner[t.id] as number) === enemy ? 0 : 1;

  const myCoastalCities = world.cities.filter(
    (c) => state.cityOwners[c.id] === me && isCoastalCity(world, c.id),
  );

  /** Nearest sea tile to a point (an amphibious drop-off near a target coast). */
  const nearestSeaTo = (cx: number, cy: number): { x: number; y: number } | null =>
    findNearest(world.width, world.height, cx, cy, () => true, seaAt, 8);

  // A single shared staging port so armies and transports rendezvous at the
  // SAME place. Prefer the coastal city closest to where the fight is.
  let stagingPort: { x: number; y: number; id: number } | null = null;
  if (myCoastalCities.length > 0) {
    const ref = overseasTargets[0] ?? knownTargets[0] ?? null;
    const sorted = [...myCoastalCities].sort((a, b) =>
      ref !== null
        ? chebyshev(a.x, a.y, ref.x, ref.y) - chebyshev(b.x, b.y, ref.x, ref.y)
        : a.id - b.id,
    );
    stagingPort = sorted[0] ?? null;
  }

  const transportCap = spec('transport').capacity?.count ?? 6;

  // ---------- Production ----------
  for (const city of world.cities) {
    if (state.cityOwners[city.id] !== me) continue;
    if ((state.production[city.id] ?? null) !== null) continue;

    const coastal = isCoastalCity(world, city.id);
    const armies = myUnits('army').length;
    const transports = myUnits('transport').length;
    const fighters = myUnits('fighter').length;
    const warships = myUnits().filter((u) =>
      ['destroyer', 'submarine', 'cruiser', 'battleship'].includes(u.type),
    ).length;
    const label = labelAt(city.x, city.y);
    // Only the home continent still being contested keeps pumping armies.
    const stillFighting = homeTargets.some((t) => labelAt(t.x, t.y) === label);

    let choice: keyof typeof UNIT_SPECS;
    if (!coastal) {
      // Inland: mostly armies (they march to the staging port), a few scouts.
      choice = fighters < armies / 8 && armies > 4 ? 'fighter' : 'army';
    } else if (stillFighting || armies < 6) {
      // Take the home continent first, and keep a minimum invasion force.
      choice = 'army';
    } else if (transports < Math.min(4, Math.max(2, Math.ceil(armies / transportCap)))) {
      // Build enough sealift to actually move the army overseas (but not a fleet
      // of empty boats).
      choice = 'transport';
    } else if (warships < transports) {
      choice = state.rng.chance(0.5) ? 'destroyer' : 'submarine';
    } else if (armies < 16) {
      choice = 'army';
    } else {
      choice = state.rng.chance(0.5) ? 'army' : state.rng.chance(0.5) ? 'fighter' : 'destroyer';
    }
    applyCommand(state, me, { type: 'setProduction', cityId: city.id, unit: choice });
  }

  // ---------- Unit orders ----------
  for (const unit of [...state.units.values()]) {
    if (!state.units.has(unit.id)) continue; // died earlier this loop
    if (unit.owner !== me || unit.movesLeft <= 0) continue;
    if (unit.mode === 'moveto') continue; // standing order already ran

    const s = spec(unit.type);

    // Armies riding a transport: storm any useful adjacent beach.
    if (unit.aboard !== null) {
      if (unit.type !== 'army') continue;
      let landed = false;
      for (let dy = -1; dy <= 1 && !landed; dy++) {
        for (let dx = -1; dx <= 1 && !landed; dx++) {
          if (dx === 0 && dy === 0) continue;
          const x = unit.x + dx;
          const y = unit.y + dy;
          if (!landAt(x, y)) continue;
          if (unitsAt(state, x, y).some((u) => u.owner === me)) continue;
          if (continentNeedsArmies(labelAt(x, y))) {
            landed = applyCommand(state, me, { type: 'move', unitId: unit.id, to: { x, y } }).ok;
          }
        }
      }
      continue;
    }

    if (unit.type === 'army') {
      const myLabel = labelAt(unit.x, unit.y);
      // 1. Assault the nearest known target city on my own continent.
      const target = homeTargets
        .filter((c) => labelAt(c.x, c.y) === myLabel)
        .sort(
          (a, b) => chebyshev(unit.x, unit.y, a.x, a.y) - chebyshev(unit.x, unit.y, b.x, b.y),
        )[0];
      if (target !== undefined) {
        applyCommand(state, me, {
          type: 'order',
          unitId: unit.id,
          order: { moveTo: { x: target.x, y: target.y } },
        });
        // Standing orders stop next to hostile tiles; finish the assault by hand.
        const u = state.units.get(unit.id);
        if (u !== undefined && u.movesLeft > 0 && chebyshev(u.x, u.y, target.x, target.y) === 1) {
          applyCommand(state, me, {
            type: 'move',
            unitId: unit.id,
            to: { x: target.x, y: target.y },
          });
        }
        continue;
      }
      // 2. Scout NEARBY unseen land on my continent (bounded, so armies don't
      //    wander the whole map forever instead of joining the invasion).
      const unseen = findNearest(
        world.width,
        world.height,
        unit.x,
        unit.y,
        (x, y) => landAt(x, y),
        (x, y) => landAt(x, y) && fogAt(x, y) === FOG_UNSEEN && labelAt(x, y) === myLabel,
        18,
      );
      if (unseen !== null) {
        applyCommand(state, me, { type: 'order', unitId: unit.id, order: { moveTo: unseen } });
        continue;
      }
      // 3. Nothing to do on land — muster at the staging port and embark.
      if (stagingPort !== null) {
        const atPort = unit.x === stagingPort.x && unit.y === stagingPort.y;
        if (atPort) {
          // Board a transport docked here that still has room.
          const ride = myUnits('transport').find(
            (t) =>
              t.x === stagingPort!.x &&
              t.y === stagingPort!.y &&
              cargoOf(state, t.id).length < transportCap,
          );
          if (ride !== undefined) {
            applyCommand(state, me, { type: 'board', unitId: unit.id, carrierId: ride.id });
          } else {
            applyCommand(state, me, { type: 'order', unitId: unit.id, order: 'skip' });
          }
        } else {
          applyCommand(state, me, {
            type: 'order',
            unitId: unit.id,
            order: { moveTo: { x: stagingPort.x, y: stagingPort.y } },
          });
        }
      } else {
        applyCommand(state, me, { type: 'order', unitId: unit.id, order: 'skip' });
      }
      continue;
    }

    if (unit.type === 'transport') {
      const cargo = cargoOf(state, unit.id).length;
      // Armies still waiting to embark at the staging port?
      const troopsWaiting =
        stagingPort !== null &&
        myUnits('army').some(
          (a) => a.aboard === null && a.x === stagingPort!.x && a.y === stagingPort!.y,
        );
      // Sail once we have a worthwhile load, or after a while with anyone aboard,
      // or when full — but don't sit empty forever if troops can't reach us.
      const readyToSail =
        cargo >= transportCap ||
        (cargo >= 3 && overseasTargets.length > 0) ||
        (cargo >= 1 && !troopsWaiting) ||
        (cargo >= 1 && state.turn > 60);

      if (readyToSail) {
        // Aim for a sea tile beside the best known target — enemy cities first,
        // then by distance — so the embarked armies storm the beach on arrival.
        const target = [...knownTargets].sort(
          (a, b) =>
            targetRank(a) - targetRank(b) ||
            chebyshev(unit.x, unit.y, a.x, a.y) - chebyshev(unit.x, unit.y, b.x, b.y),
        )[0];
        const drop = target !== undefined ? nearestSeaTo(target.x, target.y) : null;
        const dest =
          drop ??
          findNearest(
            world.width,
            world.height,
            unit.x,
            unit.y,
            (x, y) => seaAt(x, y),
            (x, y) => seaAt(x, y) && fogAt(x, y) === FOG_UNSEEN,
          );
        if (dest !== null) {
          applyCommand(state, me, { type: 'order', unitId: unit.id, order: { moveTo: dest } });
        } else {
          applyCommand(state, me, { type: 'order', unitId: unit.id, order: 'skip' });
        }
        continue;
      }

      // Loading: sit at the staging port so mustering armies can board.
      if (stagingPort !== null) {
        if (unit.x === stagingPort.x && unit.y === stagingPort.y) {
          applyCommand(state, me, { type: 'order', unitId: unit.id, order: 'skip' });
        } else {
          applyCommand(state, me, {
            type: 'order',
            unitId: unit.id,
            order: { moveTo: { x: stagingPort.x, y: stagingPort.y } },
          });
        }
      } else {
        applyCommand(state, me, { type: 'order', unitId: unit.id, order: 'skip' });
      }
      continue;
    }

    if (unit.type === 'fighter') {
      const enemy = visibleEnemies()
        .filter((e) => chebyshev(unit.x, unit.y, e.x, e.y) < unit.fuel - 2)
        .sort(
          (a, b) => chebyshev(unit.x, unit.y, a.x, a.y) - chebyshev(unit.x, unit.y, b.x, b.y),
        )[0];
      if (enemy !== undefined) {
        applyCommand(state, me, {
          type: 'order',
          unitId: unit.id,
          order: { moveTo: { x: enemy.x, y: enemy.y } },
        });
        const u = state.units.get(unit.id);
        if (u !== undefined && u.movesLeft > 0 && chebyshev(u.x, u.y, enemy.x, enemy.y) === 1) {
          applyCommand(state, me, {
            type: 'move',
            unitId: unit.id,
            to: { x: enemy.x, y: enemy.y },
          });
        }
        continue;
      }
      if (unit.fuel > (spec('fighter').fuel ?? 20) / 2) {
        const unseen = findNearest(
          world.width,
          world.height,
          unit.x,
          unit.y,
          () => true,
          (x, y) => fogAt(x, y) === FOG_UNSEEN,
          Math.floor(unit.fuel / 2) - 1,
        );
        if (unseen !== null) {
          applyCommand(state, me, { type: 'order', unitId: unit.id, order: { moveTo: unseen } });
          continue;
        }
      }
      // Head home to refuel.
      const home = world.cities
        .filter((c) => state.cityOwners[c.id] === me)
        .sort(
          (a, b) => chebyshev(unit.x, unit.y, a.x, a.y) - chebyshev(unit.x, unit.y, b.x, b.y),
        )[0];
      if (home !== undefined && !(unit.x === home.x && unit.y === home.y)) {
        applyCommand(state, me, {
          type: 'order',
          unitId: unit.id,
          order: { moveTo: { x: home.x, y: home.y } },
        });
      } else {
        applyCommand(state, me, { type: 'order', unitId: unit.id, order: 'skip' });
      }
      continue;
    }

    if (s.domain === 'sea') {
      // Warships: hunt the nearest visible enemy ship or fighter over water.
      const prey = visibleEnemies()
        .filter((e) => spec(e.type).domain !== 'land')
        .sort(
          (a, b) => chebyshev(unit.x, unit.y, a.x, a.y) - chebyshev(unit.x, unit.y, b.x, b.y),
        )[0];
      if (prey !== undefined) {
        applyCommand(state, me, {
          type: 'order',
          unitId: unit.id,
          order: { moveTo: { x: prey.x, y: prey.y } },
        });
        const u = state.units.get(unit.id);
        if (u !== undefined && u.movesLeft > 0 && chebyshev(u.x, u.y, prey.x, prey.y) === 1) {
          applyCommand(state, me, { type: 'move', unitId: unit.id, to: { x: prey.x, y: prey.y } });
        }
        continue;
      }
      // Escort my furthest-out transport, or probe unseen water.
      const convoy = myUnits('transport')[0];
      if (convoy !== undefined && chebyshev(unit.x, unit.y, convoy.x, convoy.y) > 2) {
        applyCommand(state, me, {
          type: 'order',
          unitId: unit.id,
          order: { moveTo: { x: convoy.x, y: convoy.y } },
        });
      } else {
        const unseenSea = findNearest(
          world.width,
          world.height,
          unit.x,
          unit.y,
          (x, y) => seaAt(x, y),
          (x, y) => seaAt(x, y) && fogAt(x, y) === FOG_UNSEEN,
        );
        if (unseenSea !== null) {
          applyCommand(state, me, { type: 'order', unitId: unit.id, order: { moveTo: unseenSea } });
        } else {
          applyCommand(state, me, { type: 'order', unitId: unit.id, order: 'skip' });
        }
      }
    }
  }

  applyCommand(state, me, { type: 'endTurn' });
}
