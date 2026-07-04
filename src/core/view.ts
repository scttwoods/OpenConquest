import { chebyshev } from './grid';
import { FOG_UNSEEN, FOG_VISIBLE, OWNER_UNKNOWN } from './fog';
import { SUB_DETECTION_RADIUS, type MapSizeKey, type UnitType } from './rules';
import {
  cargoOf,
  isCoastalCity,
  spec,
  visionSourcesFor,
  type GameEvent,
  type GameState,
  type PlayerId,
  type Production,
} from './state';

/** A city as one player knows it (possibly stale intel). */
export interface ViewCity {
  id: number;
  x: number;
  y: number;
  /** -1 neutral, 0/1 player — as last seen by this player. */
  owner: number;
}

export interface ViewUnit {
  id: number;
  type: UnitType;
  owner: PlayerId;
  x: number;
  y: number;
  hits: number;
  movesLeft: number;
  fuel: number;
  aboard: number | null;
  mode: 'awake' | 'sentry' | 'moveto' | 'patrol';
  dest: { x: number; y: number } | null;
  /** Patrol route (own units only), for drawing the loop. */
  patrolRoute: { x: number; y: number }[] | null;
  cargoCount: number;
}

export interface ViewOwnCity {
  id: number;
  x: number;
  y: number;
  coastal: boolean;
  production: Production | null;
}

/**
 * Everything one player is allowed to know. This is the ONLY thing the
 * renderer consumes and the ONLY thing the PvP server sends a client —
 * fog enforcement happens here, in one place.
 */
export interface PlayerView {
  you: PlayerId;
  turn: number;
  currentPlayer: PlayerId;
  winner: PlayerId | null;
  width: number;
  height: number;
  /** FOG_* per tile. */
  fog: Uint8Array;
  /** Terrain per tile; only meaningful where fog > FOG_UNSEEN. */
  terrain: Uint8Array;
  cities: ViewCity[];
  units: ViewUnit[];
  yourCities: ViewOwnCity[];
  events: GameEvent[];
}

/** Derive `player`'s fogged view. Drains that player's pending events. */
export function viewFor(state: GameState, player: PlayerId): PlayerView {
  const { world } = state;
  const fog = state.fogs[player];

  const terrain = new Uint8Array(world.terrain.length);
  for (let i = 0; i < terrain.length; i++) {
    terrain[i] = fog.state[i] === FOG_UNSEEN ? 0 : (world.terrain[i] as number);
  }

  const cities: ViewCity[] = [];
  const yourCities: ViewOwnCity[] = [];
  for (const city of world.cities) {
    const known = fog.cityOwner[city.id] as number;
    if (known === OWNER_UNKNOWN) continue;
    cities.push({ id: city.id, x: city.x, y: city.y, owner: known });
    if (state.cityOwners[city.id] === player) {
      yourCities.push({
        id: city.id,
        x: city.x,
        y: city.y,
        coastal: isCoastalCity(world, city.id),
        production: state.production[city.id] ?? null,
      });
    }
  }

  const mySources = visionSourcesFor(state, player);
  const units: ViewUnit[] = [];
  for (const unit of state.units.values()) {
    if (unit.owner !== player) {
      if (unit.aboard !== null) continue; // enemy cargo is never shown
      const i = unit.y * world.width + unit.x;
      if (fog.state[i] !== FOG_VISIBLE) continue;
      // Submarines run silent: only spotted right next to your forces.
      if (
        unit.type === 'submarine' &&
        !mySources.some((s) => chebyshev(s.x, s.y, unit.x, unit.y) <= SUB_DETECTION_RADIUS)
      ) {
        continue;
      }
    }
    units.push({
      id: unit.id,
      type: unit.type,
      owner: unit.owner,
      x: unit.x,
      y: unit.y,
      hits: unit.hits,
      movesLeft: unit.movesLeft,
      fuel: unit.fuel,
      aboard: unit.aboard,
      mode: unit.mode,
      dest: unit.dest === null ? null : { ...unit.dest },
      patrolRoute:
        unit.owner === player && unit.patrol !== null
          ? unit.patrol.route.map((p) => ({ ...p }))
          : null,
      cargoCount: spec(unit.type).capacity === undefined ? 0 : cargoOf(state, unit.id).length,
    });
  }

  const events = state.pendingEvents[player];
  state.pendingEvents[player] = [];

  return {
    you: player,
    turn: state.turn,
    currentPlayer: state.currentPlayer,
    winner: state.winner,
    width: world.width,
    height: world.height,
    fog: new Uint8Array(fog.state),
    terrain,
    cities,
    units,
    yourCities,
    events,
  };
}

/** JSON-safe form of a PlayerView, for the PvP wire protocol. */
export interface WireView extends Omit<PlayerView, 'fog' | 'terrain'> {
  fog: number[];
  terrain: number[];
  sizeKey: MapSizeKey;
}

export function toWire(view: PlayerView, sizeKey: MapSizeKey): WireView {
  return { ...view, fog: Array.from(view.fog), terrain: Array.from(view.terrain), sizeKey };
}

export function fromWire(wire: WireView): PlayerView {
  return { ...wire, fog: new Uint8Array(wire.fog), terrain: new Uint8Array(wire.terrain) };
}
