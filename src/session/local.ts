import { aiTakeTurn } from '../ai/ai';
import { applyCommand, type Command } from '../core/game';
import { serializeGame } from '../core/save';
import type { GameState } from '../core/state';
import { viewFor } from '../core/view';
import type { Session } from './session';

const AUTOSAVE_KEY = 'openconquest.autosave';

/** vs-Computer session: commands apply in-process; the AI answers end-turns. */
export function createLocalSession(state: GameState): Session {
  let viewHandler: ((view: ReturnType<typeof viewFor>) => void) | null = null;
  let errorHandler: ((message: string) => void) | null = null;

  const pushView = (): void => {
    viewHandler?.(viewFor(state, 0));
  };

  const autosave = (): void => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serializeGame(state)));
    } catch {
      // Storage full or unavailable — the game just isn't saved.
    }
  };

  return {
    you: 0,
    send(command: Command): void {
      const result = applyCommand(state, 0, command);
      if (!result.ok) {
        errorHandler?.(result.error ?? 'Illegal move');
        return;
      }
      if (command.type === 'endTurn' && state.winner === null) {
        aiTakeTurn(state);
        autosave();
      }
      if (state.winner !== null) {
        try {
          localStorage.removeItem(AUTOSAVE_KEY);
        } catch {
          /* ignore */
        }
      }
      pushView();
    },
    onView(handler): void {
      viewHandler = handler;
    },
    onError(handler): void {
      errorHandler = handler;
    },
    sendChat(): void {},
    onChat(): void {},
    requestView(): void {
      pushView();
    },
    dispose(): void {
      viewHandler = null;
      errorHandler = null;
    },
  };
}

export { AUTOSAVE_KEY };
