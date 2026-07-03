/**
 * Deterministic seeded PRNG (mulberry32).
 *
 * Everything random in the game core — map generation, combat rolls — must go
 * through an Rng instance so that a given seed always replays identically.
 * Never use Math.random() inside src/core.
 */
export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniformly chosen element; throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** Internal state, for save/load. */
  getState(): number;
  setState(state: number): void;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(n: number): number {
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`Rng.int requires a positive integer, got ${n}`);
      }
      return Math.floor(next() * n);
    },
    chance(p: number): boolean {
      return next() < p;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) {
        throw new Error('Rng.pick on empty array');
      }
      return items[Math.floor(next() * items.length)] as T;
    },
    getState(): number {
      return a;
    },
    setState(state: number): void {
      a = state >>> 0;
    },
  };
}

/** Derive a numeric seed from an arbitrary string (e.g. user-typed seed). */
export function seedFromString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
