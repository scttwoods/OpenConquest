/**
 * All tunable game numbers live here (PLAN.md working agreement).
 * Dimensions are in tiles; width = columns, height = rows.
 */

export const MAP_SIZES = {
  small: { width: 64, height: 44, cityCount: 30 },
  medium: { width: 100, height: 60, cityCount: 55 },
  large: { width: 128, height: 80, cityCount: 80 },
} as const;

export type MapSizeKey = keyof typeof MAP_SIZES;

/**
 * Difficulty for vs-Computer games. The lever is the AI's production speed —
 * an honest handicap, not fog cheating: on Hard the computer builds units
 * faster, on Easy slower. `aiRate` is its production multiplier.
 */
export const DIFFICULTIES = {
  easy: { label: 'Easy', aiRate: 0.6 },
  normal: { label: 'Normal', aiRate: 1.0 },
  hard: { label: 'Hard', aiRate: 1.6 },
} as const;

export type DifficultyKey = keyof typeof DIFFICULTIES;

/** Fraction of the map that should be land. */
export const LAND_FRACTION = 0.3;

/** Minimum Chebyshev distance between any two cities. */
export const MIN_CITY_DISTANCE = 4;

/** A starting continent must have at least this many land tiles. */
export const MIN_START_CONTINENT = 50;

/** Continents smaller than this get no cities at all. */
export const MIN_CITY_CONTINENT = 15;

/** Vision radius (Chebyshev) granted by a city. */
export const VISION_CITY = 2;

/** Chance an army's assault on a city succeeds (per attempt). */
export const CITY_CAPTURE_CHANCE = 0.5;

/** Chance the attacker wins each combat round. */
export const COMBAT_ROUND_CHANCE = 0.5;

export type UnitDomain = 'land' | 'sea' | 'air';

export interface UnitSpec {
  name: string;
  /** Map glyph. */
  letter: string;
  domain: UnitDomain;
  moves: number;
  hits: number;
  buildTime: number;
  vision: number;
  /** Damage dealt per combat round won. */
  damage: number;
  /** Fighters only: total moves before needing to land. */
  fuel?: number;
  /** Transports carry armies, carriers carry fighters. */
  capacity?: { type: 'army' | 'fighter'; count: number };
}

export const UNIT_TYPES = [
  'army',
  'fighter',
  'transport',
  'destroyer',
  'submarine',
  'cruiser',
  'carrier',
  'battleship',
] as const;

export type UnitType = (typeof UNIT_TYPES)[number];

export const UNIT_SPECS: Record<UnitType, UnitSpec> = {
  army: {
    name: 'Army',
    letter: 'A',
    domain: 'land',
    moves: 1,
    hits: 1,
    buildTime: 5,
    vision: 1,
    damage: 1,
  },
  fighter: {
    name: 'Fighter',
    letter: 'F',
    domain: 'air',
    // Fast and far-ranging: 10 tiles per turn, 20 fuel = 2 full turns aloft
    // before it must land at a city or Carrier to refuel (or it crashes).
    moves: 10,
    hits: 1,
    buildTime: 8,
    vision: 2,
    damage: 1,
    fuel: 20,
  },
  transport: {
    name: 'Transport',
    letter: 'T',
    domain: 'sea',
    moves: 2,
    hits: 1,
    buildTime: 15,
    vision: 1,
    damage: 1,
    capacity: { type: 'army', count: 6 },
  },
  destroyer: {
    name: 'Destroyer',
    letter: 'D',
    domain: 'sea',
    moves: 3,
    // 2 hits: a proper escort that can trade with a transport or sub and live,
    // not a paper boat that dies to the first unlucky roll.
    hits: 2,
    buildTime: 15,
    vision: 1,
    damage: 1,
  },
  submarine: {
    name: 'Submarine',
    letter: 'S',
    domain: 'sea',
    moves: 2,
    hits: 1,
    buildTime: 18,
    vision: 1,
    damage: 2,
  },
  cruiser: {
    name: 'Cruiser',
    letter: 'R',
    domain: 'sea',
    moves: 2,
    hits: 2,
    buildTime: 30,
    vision: 1,
    damage: 1,
  },
  carrier: {
    name: 'Carrier',
    letter: 'C',
    domain: 'sea',
    moves: 2,
    hits: 2,
    buildTime: 36,
    vision: 1,
    damage: 1,
    capacity: { type: 'fighter', count: 8 },
  },
  battleship: {
    name: 'Battleship',
    letter: 'B',
    domain: 'sea',
    moves: 2,
    hits: 3,
    buildTime: 45,
    vision: 1,
    damage: 1,
  },
};

/** Enemy submarines are only spotted this close to one of your vision sources. */
export const SUB_DETECTION_RADIUS = 1;
