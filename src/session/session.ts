import type { Command } from '../core/game';
import type { PlayerId } from '../core/state';
import type { PlayerView } from '../core/view';

/**
 * The seam between the UI and a running game. The UI never touches GameState:
 * it renders PlayerViews and emits Commands, whether the opponent is the
 * local AI or a human across the internet.
 */
export interface Session {
  readonly you: PlayerId;
  /** Send a command. The result arrives as a view update (or an error). */
  send(command: Command): void;
  /** Fired whenever a fresh view is available (including after send()). */
  onView(handler: (view: PlayerView) => void): void;
  /** Fired when a command is rejected or the connection reports a problem. */
  onError(handler: (message: string) => void): void;
  /** PvP chat; no-op in local games. */
  sendChat(text: string): void;
  onChat(handler: (from: string, text: string) => void): void;
  /** Ask for a fresh view (e.g. after reconnect or screen setup). */
  requestView(): void;
  dispose(): void;
}
