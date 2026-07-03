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

    let choice: (typeof UNIT_SPECS)['army'] extends never ? never : keyof typeof UNIT_SPECS;
    if (!coastal) {
      choice = fighters < armies / 6 ? 'fighter' : 'army';
    } else if (continentNeedsArmies(labelAt(city.x, city.y))) {
      choice = 'army';
    } else if (transports < 1 + Math.floor(armies / 5)) {
      choice = 'transport';
    } else if (warships < transports) {
      choice = state.rng.chance(0.5) ? 'destroyer' : 'submarine';
    } else {
      choice = state.rng.chance(0.4) ? 'army' : state.rng.chance(0.5) ? 'fighter' : 'transport';
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
      // 1. Nearest known target city on my continent.
      const target = knownTargets
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
      // 2. Explore my continent's unseen land.
      const unseen = findNearest(
        world.width,
        world.height,
        unit.x,
        unit.y,
        (x, y) => landAt(x, y),
        (x, y) => landAt(x, y) && fogAt(x, y) === FOG_UNSEEN && labelAt(x, y) === myLabel,
      );
      if (unseen !== null) {
        applyCommand(state, me, { type: 'order', unitId: unit.id, order: { moveTo: unseen } });
        continue;
      }
      // 3. Continent conquered: board any adjacent transport with room.
      let boarded = false;
      for (const t of myUnits('transport')) {
        if (
          chebyshev(unit.x, unit.y, t.x, t.y) === 1 &&
          cargoOf(state, t.id).length < (spec('transport').capacity?.count ?? 6)
        ) {
          boarded = applyCommand(state, me, {
            type: 'move',
            unitId: unit.id,
            to: { x: t.x, y: t.y },
          }).ok;
          if (boarded) break;
        }
      }
      if (!boarded) {
        // Walk toward the nearest of my coastal cities to await pickup.
        const port = world.cities.find(
          (c) =>
            state.cityOwners[c.id] === me &&
            isCoastalCity(world, c.id) &&
            labelAt(c.x, c.y) === myLabel,
        );
        if (port !== undefined && !(unit.x === port.x && unit.y === port.y)) {
          applyCommand(state, me, {
            type: 'order',
            unitId: unit.id,
            order: { moveTo: { x: port.x, y: port.y } },
          });
        } else {
          applyCommand(state, me, { type: 'order', unitId: unit.id, order: 'skip' });
        }
      }
      continue;
    }

    if (unit.type === 'transport') {
      const cargo = cargoOf(state, unit.id).length;
      if (cargo >= 4 || (cargo >= 2 && state.turn > 40)) {
        // Sail toward the nearest known target city across the water.
        const target = knownTargets.sort(
          (a, b) => chebyshev(unit.x, unit.y, a.x, a.y) - chebyshev(unit.x, unit.y, b.x, b.y),
        )[0];
        if (target !== undefined) {
          applyCommand(state, me, {
            type: 'order',
            unitId: unit.id,
            order: { moveTo: { x: target.x, y: target.y } },
          });
          continue;
        }
        // Nothing known: probe the nearest unseen sea.
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
        }
        continue;
      }
      // Waiting for troops: dock at my nearest coastal city.
      const port = world.cities.find(
        (c) => state.cityOwners[c.id] === me && isCoastalCity(world, c.id),
      );
      if (port !== undefined && !(unit.x === port.x && unit.y === port.y)) {
        applyCommand(state, me, {
          type: 'order',
          unitId: unit.id,
          order: { moveTo: { x: port.x, y: port.y } },
        });
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
