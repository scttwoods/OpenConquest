import type { Command } from '../core/game';
import type { MapSizeKey } from '../core/rules';
import type { PlayerId } from '../core/state';
import type { WireView } from '../core/view';

/** Client → server messages. */
export type ClientMessage =
  | { t: 'echo'; payload?: unknown }
  | { t: 'create'; sizeKey: MapSizeKey }
  | { t: 'join'; code: string }
  | { t: 'reconnect'; code: string; token: string }
  | { t: 'getView' }
  | { t: 'command'; command: Command }
  | { t: 'chat'; text: string };

/** Server → client messages. */
export type ServerMessage =
  | { t: 'echo'; payload?: unknown }
  | { t: 'seat'; code: string; token: string; player: PlayerId }
  | { t: 'view'; view: WireView; opponentConnected: boolean; bothSeated: boolean }
  | { t: 'chat'; from: PlayerId; text: string }
  | { t: 'error'; message: string };
