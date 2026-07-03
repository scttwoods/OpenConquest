import { describe, expect, it } from 'vitest';
import { aiTakeTurn } from './ai';
import { applyCommand, countCities } from '../core/game';
import { createGame } from '../core/state';

describe('aiTakeTurn', () => {
  it('AI vs AI: no crashes, real expansion, moderate length', () => {
    const state = createGame(99, 'small');
    const maxTurns = 120;
    while (state.winner === null && state.turn < maxTurns) {
      aiTakeTurn(state);
    }
    // Both sides should have grabbed neutral cities.
    const total = countCities(state, 0) + countCities(state, 1);
    expect(total).toBeGreaterThan(4);
    // Both sides should have fielded units at some point (production works).
    expect(state.nextUnitId).toBeGreaterThan(10);
  });

  it('AI always ends its turn (never deadlocks the game)', () => {
    const state = createGame(5, 'small');
    for (let i = 0; i < 10; i++) {
      const before = state.currentPlayer;
      aiTakeTurn(state);
      if (state.winner !== null) break;
      expect(state.currentPlayer).toBe((1 - before) as 0 | 1);
    }
  });

  it('plays sensibly as the second player after a human-style turn', () => {
    const state = createGame(31, 'medium');
    applyCommand(state, 0, { type: 'setProduction', cityId: state.world.starts[0], unit: 'army' });
    applyCommand(state, 0, { type: 'endTurn' });
    expect(state.currentPlayer).toBe(1);
    aiTakeTurn(state);
    expect(state.currentPlayer).toBe(0);
    // The AI must have set production in its start city.
    expect(state.production[state.world.starts[1]]).not.toBe(null);
  });
});
