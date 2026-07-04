import { describe, expect, it } from 'vitest';
import { applyCommand, countCities } from './game';
import {
  createGame,
  refreshAllFog,
  spawnUnit,
  unitAt,
  cargoOf,
  NEUTRAL,
  type GameState,
} from './state';
import { TERRAIN_LAND, TERRAIN_SEA } from './mapgen';
import { tileIndex } from './grid';
import { UNIT_SPECS } from './rules';
import { serializeGame, deserializeGame } from './save';
import { viewFor } from './view';

/**
 * Build a small (64x44) game, then bulldoze the terrain into a known layout:
 * land on the top half (rows 0..21), sea on the bottom (rows 22..43), with
 * exactly two cities at (2,2) [player 0] and (10,2) [player 1].
 */
const LAND_Y = 21; // last land row
const SEA_Y = 22; // first sea row

function makeTestState(): GameState {
  const state = createGame(1234, 'small');
  const { world } = state;
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      world.terrain[tileIndex(x, y, world.width)] =
        y < world.height / 2 ? TERRAIN_LAND : TERRAIN_SEA;
    }
  }
  // Clear mapgen's cities off the board except two, repositioned predictably.
  world.cityAt.fill(-1);
  const a = world.cities[world.starts[0]]!;
  const b = world.cities[world.starts[1]]!;
  a.x = 2;
  a.y = 2;
  b.x = 10;
  b.y = 2;
  world.cityAt[tileIndex(a.x, a.y, world.width)] = a.id;
  world.cityAt[tileIndex(b.x, b.y, world.width)] = b.id;
  // Recompute fog for the reshaped world so tests don't depend on the fog that
  // createGame happened to compute for the original (pre-bulldoze) map.
  refreshAllFog(state);
  return state;
}

describe('production', () => {
  it('builds an army in buildTime turns', () => {
    const state = makeTestState();
    const cityId = state.world.starts[0];
    expect(applyCommand(state, 0, { type: 'setProduction', cityId, unit: 'army' }).ok).toBe(true);

    const before = state.units.size;
    for (let i = 0; i < UNIT_SPECS.army.buildTime; i++) {
      expect(applyCommand(state, 0, { type: 'endTurn' }).ok).toBe(true);
      expect(applyCommand(state, 1, { type: 'endTurn' }).ok).toBe(true);
    }
    expect(state.units.size).toBe(before + 1);
    const built = [...state.units.values()][0]!;
    expect(built.type).toBe('army');
    expect(built.owner).toBe(0);
  });

  it('rejects ships in inland cities and enemy cities', () => {
    const state = makeTestState();
    // City A at (2,2) is 4+ tiles from sea (rows 6+) → inland.
    expect(
      applyCommand(state, 0, {
        type: 'setProduction',
        cityId: state.world.starts[0],
        unit: 'destroyer',
      }).ok,
    ).toBe(false);
    expect(
      applyCommand(state, 0, { type: 'setProduction', cityId: state.world.starts[1], unit: 'army' })
        .ok,
    ).toBe(false);
  });
});

describe('movement & turn rules', () => {
  it('enforces turn ownership, adjacency, domain, and move budget', () => {
    const state = makeTestState();
    const army = spawnUnit(state, 'army', 0, 4, LAND_Y);
    army.movesLeft = 1;

    expect(applyCommand(state, 1, { type: 'endTurn' }).ok).toBe(false); // not P1's turn
    expect(
      applyCommand(state, 0, { type: 'move', unitId: army.id, to: { x: 6, y: LAND_Y } }).ok,
    ).toBe(false); // not adjacent
    expect(
      applyCommand(state, 0, { type: 'move', unitId: army.id, to: { x: 4, y: SEA_Y } }).ok,
    ).toBe(false); // sea
    expect(
      applyCommand(state, 0, { type: 'move', unitId: army.id, to: { x: 5, y: LAND_Y } }).ok,
    ).toBe(true);
    expect(
      applyCommand(state, 0, { type: 'move', unitId: army.id, to: { x: 5, y: LAND_Y - 1 } }).ok,
    ).toBe(false); // no moves left
    expect(army.x).toBe(5);
  });

  it('moveTo orders step immediately, then again at the end of each turn', () => {
    const state = makeTestState();
    const army = spawnUnit(state, 'army', 0, 0, 0);
    army.movesLeft = 1;
    expect(
      applyCommand(state, 0, { type: 'order', unitId: army.id, order: { moveTo: { x: 5, y: 0 } } })
        .ok,
    ).toBe(true);
    expect(army.x).toBe(1); // stepped once immediately

    applyCommand(state, 0, { type: 'endTurn' });
    applyCommand(state, 1, { type: 'endTurn' });
    // Back to player 0: the ordered unit has NOT moved yet this turn and keeps
    // its move, so it can be redirected or cancelled before it travels.
    expect(army.x).toBe(1);
    expect(army.movesLeft).toBe(1);
    expect(army.mode).toBe('moveto');

    applyCommand(state, 0, { type: 'endTurn' }); // now it travels
    expect(army.x).toBe(2);
  });

  it('an order can be cancelled, and a manual move overrides the plan', () => {
    const state = makeTestState();
    const army = spawnUnit(state, 'army', 0, 0, 0);
    army.movesLeft = 1;
    applyCommand(state, 0, { type: 'order', unitId: army.id, order: { moveTo: { x: 5, y: 0 } } });
    applyCommand(state, 0, { type: 'endTurn' });
    applyCommand(state, 1, { type: 'endTurn' });
    expect(army.mode).toBe('moveto');

    // Cancel: the unit holds position instead of continuing.
    applyCommand(state, 0, { type: 'order', unitId: army.id, order: 'awake' });
    expect(army.mode).toBe('awake');
    expect(army.dest).toBe(null);
    const restX = army.x;
    applyCommand(state, 0, { type: 'endTurn' });
    applyCommand(state, 1, { type: 'endTurn' });
    expect(army.x).toBe(restX); // did not travel

    // Redirect via a manual one-tile move: overrides any plan.
    applyCommand(state, 0, { type: 'order', unitId: army.id, order: { moveTo: { x: 10, y: 5 } } });
    applyCommand(state, 0, { type: 'endTurn' });
    applyCommand(state, 1, { type: 'endTurn' });
    expect(army.mode).toBe('moveto');
    const before = { x: army.x, y: army.y };
    applyCommand(state, 0, { type: 'move', unitId: army.id, to: { x: before.x, y: before.y + 1 } });
    expect(army.y).toBe(before.y + 1);
    expect(army.mode).toBe('awake');
    expect(army.dest).toBe(null);
  });

  it('friendly units may stack on the same open tile', () => {
    const state = makeTestState();
    const a = spawnUnit(state, 'army', 0, 4, 4);
    spawnUnit(state, 'army', 0, 5, 4); // friendly army already there
    a.movesLeft = 1;
    expect(applyCommand(state, 0, { type: 'move', unitId: a.id, to: { x: 5, y: 4 } }).ok).toBe(
      true,
    );
    expect(a.x).toBe(5);
    // Both armies now occupy (5,4).
    expect(state.units.get(a.id)?.x).toBe(5);
    const here = [...state.units.values()].filter(
      (u) => u.owner === 0 && u.aboard === null && u.x === 5 && u.y === 4,
    );
    expect(here.length).toBe(2);
  });

  it('boarding a transport still beats stacking', () => {
    const state = makeTestState();
    const transport = spawnUnit(state, 'transport', 0, 4, SEA_Y);
    const army = spawnUnit(state, 'army', 0, 4, LAND_Y);
    army.movesLeft = 1;
    expect(
      applyCommand(state, 0, { type: 'move', unitId: army.id, to: { x: 4, y: SEA_Y } }).ok,
    ).toBe(true);
    expect(army.aboard).toBe(transport.id); // boarded, not stacked on the sea tile
  });
});

describe('combat', () => {
  it('exactly one side survives, and combat consumes a move', () => {
    let attackerWins = 0;
    for (let seed = 0; seed < 60; seed++) {
      const state = makeTestState();
      state.rng.setState(seed * 7919);
      const attacker = spawnUnit(state, 'army', 0, 4, 4);
      const defender = spawnUnit(state, 'army', 1, 5, 4);
      attacker.movesLeft = 1;
      expect(
        applyCommand(state, 0, { type: 'move', unitId: attacker.id, to: { x: 5, y: 4 } }).ok,
      ).toBe(true);
      const aliveA = state.units.has(attacker.id);
      const aliveD = state.units.has(defender.id);
      expect(aliveA).not.toBe(aliveD);
      if (aliveA) {
        attackerWins++;
        expect(attacker.x).toBe(5); // advanced into the cleared tile
        expect(attacker.movesLeft).toBe(0);
      }
    }
    // 50/50 rounds, 1 hit each → attacker should win roughly half.
    expect(attackerWins).toBeGreaterThan(15);
    expect(attackerWins).toBeLessThan(45);
  });

  it('ship-vs-ship combat destroys exactly one side', () => {
    const state = makeTestState();
    const ship = spawnUnit(state, 'battleship', 0, 4, SEA_Y + 1);
    const enemy = spawnUnit(state, 'destroyer', 1, 5, SEA_Y + 1);
    ship.movesLeft = 2;
    applyCommand(state, 0, { type: 'move', unitId: ship.id, to: { x: 5, y: SEA_Y + 1 } });
    expect(state.units.has(ship.id) || state.units.has(enemy.id)).toBe(true);
    expect(state.units.has(ship.id) && state.units.has(enemy.id)).toBe(false);
  });

  it('armies cannot attack ships', () => {
    const state = makeTestState();
    const army = spawnUnit(state, 'army', 0, 4, LAND_Y);
    spawnUnit(state, 'destroyer', 1, 4, SEA_Y);
    army.movesLeft = 1;
    expect(
      applyCommand(state, 0, { type: 'move', unitId: army.id, to: { x: 4, y: SEA_Y } }).ok,
    ).toBe(false);
  });
});

describe('city capture', () => {
  it('an army either captures a neutral city or dies trying', () => {
    let captures = 0;
    for (let seed = 0; seed < 40; seed++) {
      const state = makeTestState();
      state.rng.setState(seed * 104729);
      // Repurpose the enemy start city as neutral to attack.
      const cityId = state.world.starts[1];
      state.cityOwners[cityId] = NEUTRAL;
      const city = state.world.cities[cityId]!;
      const army = spawnUnit(state, 'army', 0, city.x - 1, city.y);
      army.movesLeft = 1;
      expect(
        applyCommand(state, 0, { type: 'move', unitId: army.id, to: { x: city.x, y: city.y } }).ok,
      ).toBe(true);
      if (state.cityOwners[cityId] === 0) {
        captures++;
        expect(state.units.has(army.id)).toBe(true);
        expect(state.production[cityId]).toBe(null);
      } else {
        expect(state.units.has(army.id)).toBe(false);
        expect(state.cityOwners[cityId]).toBe(NEUTRAL);
      }
    }
    expect(captures).toBeGreaterThan(8);
    expect(captures).toBeLessThan(32);
  });

  it('capturing the last enemy city wins the game when they have no armies', () => {
    const state = makeTestState();
    const cityId = state.world.starts[1];
    const city = state.world.cities[cityId]!;
    const army = spawnUnit(state, 'army', 0, city.x - 1, city.y);
    army.movesLeft = 1;
    // Force the capture roll to succeed by trying until it does.
    for (let i = 0; i < 50 && state.cityOwners[cityId] !== 0; i++) {
      const a = state.units.get(army.id) ?? spawnUnit(state, 'army', 0, city.x - 1, city.y);
      a.movesLeft = 1;
      applyCommand(state, 0, { type: 'move', unitId: a.id, to: { x: city.x, y: city.y } });
    }
    expect(state.cityOwners[cityId]).toBe(0);
    expect(countCities(state, 1)).toBe(0);
    expect(state.winner).toBe(0);
  });
});

describe('transports', () => {
  it('armies board, ride, and unload from transports', () => {
    const state = makeTestState();
    const transport = spawnUnit(state, 'transport', 0, 4, SEA_Y); // coastal water
    const army = spawnUnit(state, 'army', 0, 4, LAND_Y);
    army.movesLeft = 1;
    transport.movesLeft = 2;

    expect(
      applyCommand(state, 0, { type: 'move', unitId: army.id, to: { x: 4, y: SEA_Y } }).ok,
    ).toBe(true);
    expect(army.aboard).toBe(transport.id);
    expect(cargoOf(state, transport.id).length).toBe(1);

    expect(
      applyCommand(state, 0, { type: 'move', unitId: transport.id, to: { x: 5, y: SEA_Y } }).ok,
    ).toBe(true);
    expect(army.x).toBe(5); // cargo rides along
    expect(army.y).toBe(SEA_Y);

    applyCommand(state, 0, { type: 'endTurn' });
    applyCommand(state, 1, { type: 'endTurn' });
    expect(
      applyCommand(state, 0, { type: 'move', unitId: army.id, to: { x: 5, y: LAND_Y } }).ok,
    ).toBe(true);
    expect(army.aboard).toBe(null);
    expect(unitAt(state, 5, LAND_Y)?.id).toBe(army.id);
  });

  it('cargo dies with its transport', () => {
    const state = makeTestState();
    const transport = spawnUnit(state, 'transport', 1, 5, SEA_Y + 1);
    const rider = spawnUnit(state, 'army', 1, 5, SEA_Y + 1);
    rider.aboard = transport.id;
    const ship = spawnUnit(state, 'battleship', 0, 4, SEA_Y + 1);
    ship.movesLeft = 2;
    applyCommand(state, 0, { type: 'move', unitId: ship.id, to: { x: 5, y: SEA_Y + 1 } });
    if (!state.units.has(transport.id)) {
      expect(state.units.has(rider.id)).toBe(false);
    }
  });

  it('armies board a transport sharing their tile (loading from a city)', () => {
    const state = makeTestState();
    // A coastal city with a transport and two armies all on the same tile.
    const city = state.world.cities[state.world.starts[0]]!; // (2,2), made coastal below
    // Ensure the city tile is coastal by putting sea next to it.
    state.world.terrain[tileIndex(city.x, city.y + 1, state.world.width)] = TERRAIN_SEA;
    const transport = spawnUnit(state, 'transport', 0, city.x, city.y);
    const armyA = spawnUnit(state, 'army', 0, city.x, city.y);
    const armyB = spawnUnit(state, 'army', 0, city.x, city.y);
    armyA.movesLeft = 1;
    armyB.movesLeft = 1;

    expect(
      applyCommand(state, 0, { type: 'board', unitId: armyA.id, carrierId: transport.id }).ok,
    ).toBe(true);
    expect(
      applyCommand(state, 0, { type: 'board', unitId: armyB.id, carrierId: transport.id }).ok,
    ).toBe(true);
    expect(armyA.aboard).toBe(transport.id);
    expect(armyB.aboard).toBe(transport.id);
    expect(cargoOf(state, transport.id).length).toBe(2);

    // The loaded armies move with the transport.
    transport.movesLeft = 2;
    applyCommand(state, 0, {
      type: 'move',
      unitId: transport.id,
      to: { x: city.x, y: city.y + 1 },
    });
    expect(armyA.x).toBe(city.x);
    expect(armyA.y).toBe(city.y + 1);
  });

  it('rejects boarding a full or mismatched carrier', () => {
    const state = makeTestState();
    const transport = spawnUnit(state, 'transport', 0, 5, SEA_Y);
    const fighter = spawnUnit(state, 'fighter', 0, 5, SEA_Y);
    fighter.movesLeft = 4;
    // Transports carry armies, not fighters.
    expect(
      applyCommand(state, 0, { type: 'board', unitId: fighter.id, carrierId: transport.id }).ok,
    ).toBe(false);
    // Not on the same tile.
    const farArmy = spawnUnit(state, 'army', 0, 3, LAND_Y);
    farArmy.movesLeft = 1;
    expect(
      applyCommand(state, 0, { type: 'board', unitId: farArmy.id, carrierId: transport.id }).ok,
    ).toBe(false);
  });
});

describe('fighters', () => {
  it('burn fuel and crash when it runs out away from base', () => {
    const state = makeTestState();
    const fighter = spawnUnit(state, 'fighter', 0, 0, 0);
    fighter.movesLeft = 4;
    fighter.fuel = 1;
    expect(
      applyCommand(state, 0, { type: 'move', unitId: fighter.id, to: { x: 1, y: 0 } }).ok,
    ).toBe(true);
    expect(state.units.has(fighter.id)).toBe(false); // fuel hit 0 mid-flight
  });

  it('refuel when landing in a friendly city', () => {
    const state = makeTestState();
    const city = state.world.cities[state.world.starts[0]]!; // (2,2)
    const fighter = spawnUnit(state, 'fighter', 0, city.x - 1, city.y);
    fighter.movesLeft = 4;
    fighter.fuel = 1;
    expect(
      applyCommand(state, 0, { type: 'move', unitId: fighter.id, to: { x: city.x, y: city.y } }).ok,
    ).toBe(true);
    expect(state.units.has(fighter.id)).toBe(true);
    expect(fighter.fuel).toBe(UNIT_SPECS.fighter.fuel);
  });
});

describe('fog-honest views', () => {
  it('hides enemy units outside vision and unseen terrain', () => {
    const state = makeTestState();
    spawnUnit(state, 'army', 1, 9, 2); // near enemy city, far from player 0
    const view = viewFor(state, 0);
    expect(view.units.filter((u) => u.owner === 1).length).toBe(0);
    expect(view.cities.some((c) => c.id === state.world.starts[1])).toBe(false);
  });

  it('drains events once', () => {
    const state = makeTestState();
    applyCommand(state, 0, { type: 'surrender' });
    const first = viewFor(state, 0);
    expect(first.events.some((e) => e.kind === 'victory')).toBe(true);
    expect(viewFor(state, 0).events.length).toBe(0);
  });

  it('delivers a capture event (by + cityId) to the capturing player — the UI production prompt keys off this', () => {
    const state = makeTestState();
    const cityId = state.world.starts[1];
    state.cityOwners[cityId] = NEUTRAL;
    const city = state.world.cities[cityId]!;
    // Keep player 1 "alive" (a lone army) so neutralizing their city doesn't
    // hand player 0 an instant victory before the assault even resolves.
    spawnUnit(state, 'army', 1, 5, 5);
    // Assault until captured (each attempt spawns a fresh adjacent army).
    for (let i = 0; i < 80 && state.cityOwners[cityId] !== 0; i++) {
      const army = spawnUnit(state, 'army', 0, city.x - 1, city.y);
      army.movesLeft = 1;
      applyCommand(state, 0, { type: 'move', unitId: army.id, to: { x: city.x, y: city.y } });
    }
    expect(state.cityOwners[cityId]).toBe(0);
    const view = viewFor(state, 0);
    const capture = view.events.find((e) => e.kind === 'capture');
    expect(capture).toBeDefined();
    expect(capture).toMatchObject({ kind: 'capture', by: 0, cityId });
    // The captured city has no production yet, so the UI would prompt for it.
    expect(state.production[cityId]).toBe(null);
    expect(view.yourCities.some((c) => c.id === cityId && c.production === null)).toBe(true);
  });
});

describe('save/load round trip', () => {
  it('restores an identical game', () => {
    const state = createGame(777, 'small');
    applyCommand(state, 0, { type: 'setProduction', cityId: state.world.starts[0], unit: 'army' });
    for (let i = 0; i < 12; i++) {
      applyCommand(state, state.currentPlayer, { type: 'endTurn' });
    }
    const restored = deserializeGame(JSON.parse(JSON.stringify(serializeGame(state))));

    expect(restored.turn).toBe(state.turn);
    expect(restored.currentPlayer).toBe(state.currentPlayer);
    expect(Array.from(restored.cityOwners)).toEqual(Array.from(state.cityOwners));
    expect(Array.from(restored.world.terrain)).toEqual(Array.from(state.world.terrain));
    expect([...restored.units.values()]).toEqual([...state.units.values()]);
    expect(restored.production).toEqual(state.production);
    expect(restored.rng.getState()).toBe(state.rng.getState());
    expect(Array.from(restored.fogs[0].state)).toEqual(Array.from(state.fogs[0].state));
  });
});
