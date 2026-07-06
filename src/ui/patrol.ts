/**
 * Patrol route analysis for the planning UI. Pure and testable — no DOM.
 *
 * A patrol cycles its waypoints forever: anchor → wp1 → … → wpN → anchor → …
 * Movement is 8-directional, so the cost between two tiles is their Chebyshev
 * distance. For fighters we also simulate fuel: the plane burns 1 per tile and
 * refuels to full whenever it passes a friendly base (city or carrier). If it
 * would ever hit empty away from a base, the patrol crashes it.
 */

export interface Point {
  x: number;
  y: number;
}

function chebyshev(a: Point, b: Point): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/** Total length of the closed loop through the route, in tiles. */
export function loopLength(route: readonly Point[]): number {
  if (route.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < route.length; i++) {
    total += chebyshev(route[i] as Point, route[(i + 1) % route.length] as Point);
  }
  return total;
}

export interface FuelAnalysis {
  loop: number;
  /** Fighter runs out of fuel somewhere on the loop and crashes. */
  crashes: boolean;
  /** Lowest fuel reached over one loop (from a full tank at the anchor). */
  minFuel: number;
  /** No friendly base anywhere on the route to refuel at. */
  noBase: boolean;
}

/**
 * Simulate one loop of a fighter patrol from a full tank at the anchor,
 * refuelling whenever the path crosses a base tile.
 */
export function analyzeFighterPatrol(
  route: readonly Point[],
  fuelCapacity: number,
  isBase: (x: number, y: number) => boolean,
): FuelAnalysis {
  const loop = loopLength(route);
  if (route.length < 2) {
    return { loop, crashes: false, minFuel: fuelCapacity, noBase: true };
  }

  let fuel = fuelCapacity;
  let minFuel = fuel;
  let crashes = false;
  let sawBase = isBase((route[0] as Point).x, (route[0] as Point).y);

  for (let i = 0; i < route.length; i++) {
    const from = route[i] as Point;
    const to = route[(i + 1) % route.length] as Point;
    let cx = from.x;
    let cy = from.y;
    const steps = chebyshev(from, to);
    for (let s = 0; s < steps; s++) {
      cx += sign(to.x - cx);
      cy += sign(to.y - cy);
      fuel -= 1;
      if (isBase(cx, cy)) {
        sawBase = true;
        fuel = fuelCapacity; // land and top up while passing over
      } else if (fuel <= 0) {
        crashes = true;
      }
      minFuel = Math.min(minFuel, fuel);
    }
  }

  return { loop, crashes, minFuel, noBase: !sawBase };
}
