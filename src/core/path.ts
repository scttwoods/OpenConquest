import { TERRAIN_LAND, TERRAIN_SEA } from './mapgen';
import { inBounds, tileIndex } from './grid';
import type { UnitDomain } from './rules';
import { isCoastalCity, type GameState } from './state';

/** Movement is 8-directional, as in the original. */
export const DIRS8: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/**
 * Can a unit of this domain occupy the tile, terrain-wise?
 * (Occupancy by other units is checked at move time, not here.)
 */
export function terrainPassable(
  state: GameState,
  domain: UnitDomain,
  x: number,
  y: number,
): boolean {
  const { world } = state;
  if (!inBounds(x, y, world.width, world.height)) return false;
  if (domain === 'air') return true;
  const i = tileIndex(x, y, world.width);
  const cityId = world.cityAt[i] as number;
  if (domain === 'land') return world.terrain[i] === TERRAIN_LAND;
  // Sea units: open sea, or coastal city tiles (ports).
  if (world.terrain[i] === TERRAIN_SEA) return true;
  return cityId >= 0 && isCoastalCity(world, cityId);
}

/**
 * BFS from (sx,sy) toward `dest`, over terrain the domain can cross.
 * Returns the first step to take, or null if unreachable. Other units are
 * ignored here — collisions are resolved when the step executes.
 */
export function nextStepToward(
  state: GameState,
  domain: UnitDomain,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
): { x: number; y: number } | null {
  const { width, height } = state.world;
  if (sx === dx && sy === dy) return null;

  const cameFrom = new Int32Array(width * height).fill(-2);
  const start = tileIndex(sx, sy, width);
  const goal = tileIndex(dx, dy, width);
  cameFrom[start] = -1;
  let frontier = [start];

  while (frontier.length > 0 && cameFrom[goal] === -2) {
    const next: number[] = [];
    for (const t of frontier) {
      const tx = t % width;
      const ty = Math.floor(t / width);
      for (const [ox, oy] of DIRS8) {
        const nx = tx + ox;
        const ny = ty + oy;
        if (!inBounds(nx, ny, width, height)) continue;
        const n = tileIndex(nx, ny, width);
        if (cameFrom[n] !== -2) continue;
        // The destination itself is always allowed (attacks, captures,
        // boarding) — only intermediate tiles need to be passable.
        if (n !== goal && !terrainPassable(state, domain, nx, ny)) continue;
        cameFrom[n] = t;
        next.push(n);
      }
    }
    frontier = next;
  }

  if (cameFrom[goal] === -2) return null;
  let t = goal;
  while (cameFrom[t] !== start && cameFrom[t] !== -1) {
    t = cameFrom[t] as number;
  }
  if (cameFrom[t] === -1) return null;
  return { x: t % width, y: Math.floor(t / width) };
}

/**
 * BFS to the nearest tile satisfying `goal`, over tiles satisfying `passable`.
 * Returns the goal tile, or null. Used by the AI for "nearest X" decisions.
 */
export function findNearest(
  width: number,
  height: number,
  sx: number,
  sy: number,
  passable: (x: number, y: number) => boolean,
  goal: (x: number, y: number) => boolean,
  maxRadius = Infinity,
): { x: number; y: number } | null {
  const visited = new Uint8Array(width * height);
  let frontier = [tileIndex(sx, sy, width)];
  visited[frontier[0] as number] = 1;
  let radius = 0;

  while (frontier.length > 0 && radius <= maxRadius) {
    for (const t of frontier) {
      const tx = t % width;
      const ty = Math.floor(t / width);
      if (goal(tx, ty)) return { x: tx, y: ty };
    }
    const next: number[] = [];
    for (const t of frontier) {
      const tx = t % width;
      const ty = Math.floor(t / width);
      for (const [ox, oy] of DIRS8) {
        const nx = tx + ox;
        const ny = ty + oy;
        if (!inBounds(nx, ny, width, height)) continue;
        const n = tileIndex(nx, ny, width);
        if (visited[n] === 1) continue;
        visited[n] = 1;
        if (passable(nx, ny) || goal(nx, ny)) next.push(n);
      }
    }
    frontier = next;
    radius++;
  }
  return null;
}
