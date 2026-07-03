import { describe, expect, it } from 'vitest';
import { createGame, NEUTRAL } from './state';
import { FOG_VISIBLE } from './fog';
import { tileIndex } from './grid';

describe('createGame', () => {
  it('assigns the two starting cities and leaves the rest neutral', () => {
    const state = createGame(7, 'medium');
    const [a, b] = state.world.starts;
    expect(state.cityOwners[a]).toBe(0);
    expect(state.cityOwners[b]).toBe(1);
    const neutral = Array.from(state.cityOwners).filter((o) => o === NEUTRAL).length;
    expect(neutral).toBe(state.world.cities.length - 2);
  });

  it("each player starts seeing their own city but not the opponent's", () => {
    const state = createGame(7, 'medium');
    const cityA = state.world.cities[state.world.starts[0]]!;
    const cityB = state.world.cities[state.world.starts[1]]!;

    const fogA = state.fogs[0];
    expect(fogA.state[tileIndex(cityA.x, cityA.y, state.world.width)]).toBe(FOG_VISIBLE);
    expect(fogA.state[tileIndex(cityB.x, cityB.y, state.world.width)]).not.toBe(FOG_VISIBLE);
    expect(fogA.cityOwner[cityA.id]).toBe(0);

    const fogB = state.fogs[1];
    expect(fogB.state[tileIndex(cityB.x, cityB.y, state.world.width)]).toBe(FOG_VISIBLE);
    expect(fogB.cityOwner[cityB.id]).toBe(1);
  });

  it('most of the map starts unseen', () => {
    const state = createGame(7, 'medium');
    for (const player of [0, 1] as const) {
      const fog = state.fogs[player];
      const seen = fog.state.reduce((n, s) => n + (s !== 0 ? 1 : 0), 0);
      expect(seen).toBeLessThan(fog.state.length * 0.02);
    }
  });
});
