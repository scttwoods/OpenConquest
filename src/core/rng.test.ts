import { describe, expect, it } from 'vitest';
import { createRng, seedFromString } from './rng';

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('next() stays in [0, 1)', () => {
    const rng = createRng(999);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('int(n) stays in [0, n) and hits every value eventually', () => {
    const rng = createRng(42);
    const seen = new Set<number>();
    for (let i = 0; i < 1_000; i++) {
      const v = rng.int(6);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });

  it('int rejects non-positive or fractional n', () => {
    const rng = createRng(7);
    expect(() => rng.int(0)).toThrow();
    expect(() => rng.int(-3)).toThrow();
    expect(() => rng.int(2.5)).toThrow();
  });

  it('chance(p) approximates p over many trials', () => {
    const rng = createRng(2024);
    let hits = 0;
    const trials = 20_000;
    for (let i = 0; i < trials; i++) {
      if (rng.chance(0.5)) hits++;
    }
    expect(hits / trials).toBeGreaterThan(0.47);
    expect(hits / trials).toBeLessThan(0.53);
  });

  it('pick returns elements from the array and throws on empty', () => {
    const rng = createRng(5);
    const items = ['a', 'b', 'c'] as const;
    for (let i = 0; i < 100; i++) {
      expect(items).toContain(rng.pick(items));
    }
    expect(() => rng.pick([])).toThrow();
  });
});

describe('seedFromString', () => {
  it('is stable and distinguishes strings', () => {
    expect(seedFromString('dad')).toBe(seedFromString('dad'));
    expect(seedFromString('dad')).not.toBe(seedFromString('son'));
    expect(seedFromString('')).toBeTypeOf('number');
  });
});
