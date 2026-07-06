import { describe, expect, it } from 'vitest';
import { analyzeFighterPatrol, loopLength } from './patrol';

describe('loopLength', () => {
  it('is 0 for fewer than 2 points', () => {
    expect(loopLength([])).toBe(0);
    expect(loopLength([{ x: 3, y: 3 }])).toBe(0);
  });

  it('sums the closed cycle in Chebyshev steps', () => {
    // (0,0) -> (5,0) = 5, back = 5 → 10.
    expect(loopLength([{ x: 0, y: 0 }, { x: 5, y: 0 }])).toBe(10);
    // A right triangle: (0,0)->(4,0)=4, (4,0)->(4,3)=3, (4,3)->(0,0)=4 (diag) → 11.
    expect(loopLength([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }])).toBe(11);
  });
});

describe('analyzeFighterPatrol', () => {
  const noBases = (): boolean => false;

  it('crashes when the loop is longer than the tank with no base', () => {
    // Loop length 30, fuel 20, no base → runs dry.
    const r = analyzeFighterPatrol([{ x: 0, y: 0 }, { x: 15, y: 0 }], 20, noBases);
    expect(r.loop).toBe(30);
    expect(r.crashes).toBe(true);
    expect(r.noBase).toBe(true);
  });

  it('survives when the loop fits inside the tank', () => {
    // Loop length 16 < 20 → never runs out, even without a base.
    const r = analyzeFighterPatrol([{ x: 0, y: 0 }, { x: 8, y: 0 }], 20, noBases);
    expect(r.loop).toBe(16);
    expect(r.crashes).toBe(false);
    expect(r.minFuel).toBe(20 - 16); // lowest back at the anchor after the full loop
  });

  it('a base mid-route refuels a long loop', () => {
    // Loop 30, but a base at (8,0) is passed on the way out and back, so the
    // longest unrefuelled stretch stays under the 20-fuel tank.
    const midBase = (x: number, y: number): boolean =>
      (x === 0 && y === 0) || (x === 8 && y === 0);
    const r = analyzeFighterPatrol([{ x: 0, y: 0 }, { x: 15, y: 0 }], 20, midBase);
    expect(r.loop).toBe(30);
    expect(r.crashes).toBe(false);
    expect(r.noBase).toBe(false);
  });

  it('a single anchor base cannot save a loop longer than the tank', () => {
    // Anchor (0,0) is the only base; the 30-tile loop only refuels once per
    // lap, so it runs dry before returning.
    const atOrigin = (x: number, y: number): boolean => x === 0 && y === 0;
    const r = analyzeFighterPatrol([{ x: 0, y: 0 }, { x: 15, y: 0 }], 20, atOrigin);
    expect(r.crashes).toBe(true);
    expect(r.noBase).toBe(false);
  });

  it('a base too far out still crashes on the way there', () => {
    // Base only at the far end (25,0); getting there is 25 tiles > 20 fuel.
    const farBase = (x: number, y: number): boolean => x === 25 && y === 0;
    const r = analyzeFighterPatrol([{ x: 0, y: 0 }, { x: 25, y: 0 }], 20, farBase);
    expect(r.crashes).toBe(true);
  });
});
