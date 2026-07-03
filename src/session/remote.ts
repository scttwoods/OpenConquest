import type { Command } from '../core/game';
import type { MapSizeKey } from '../core/rules';
import type { PlayerId } from '../core/state';
import { fromWire, type PlayerView } from '../core/view';
import type { ClientMessage, ServerMessage } from './protocol';
import type { Session } from './session';

const PVP_KEY = 'openconquest.pvp';

export interface PvpCredentials {
  code: string;
  token: string;
  player: PlayerId;
}

export function savedPvpGame(): PvpCredentials | null {
  try {
    const raw = localStorage.getItem(PVP_KEY);
    return raw === null ? null : (JSON.parse(raw) as PvpCredentials);
  } catch {
    return null;
  }
}

export function clearSavedPvpGame(): void {
  try {
    localStorage.removeItem(PVP_KEY);
  } catch {
    /* ignore */
  }
}

export type RemoteMode =
  | { mode: 'create'; sizeKey: MapSizeKey }
  | { mode: 'join'; code: string }
  | { mode: 'resume'; credentials: PvpCredentials };

export interface RemoteSession extends Session {
  /** Fires once the server assigns (or confirms) our seat. */
  onSeat(handler: (credentials: PvpCredentials) => void): void;
  /** Fires with opponent presence info on every view. */
  onPresence(handler: (opponentConnected: boolean, bothSeated: boolean) => void): void;
}

/** PvP session: commands go over a WebSocket; views come back fogged. */
export function createRemoteSession(init: RemoteMode): RemoteSession {
  let viewHandler: ((view: PlayerView) => void) | null = null;
  let errorHandler: ((message: string) => void) | null = null;
  let chatHandler: ((from: string, text: string) => void) | null = null;
  let seatHandler: ((credentials: PvpCredentials) => void) | null = null;
  let presenceHandler: ((opponentConnected: boolean, bothSeated: boolean) => void) | null = null;

  let credentials: PvpCredentials | null = init.mode === 'resume' ? init.credentials : null;
  let you: PlayerId = credentials?.player ?? 0;
  let ws: WebSocket | null = null;
  let disposed = false;
  let reconnectDelay = 1000;

  function send(message: ClientMessage): void {
    if (ws !== null && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  function connect(): void {
    if (disposed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);

    ws.addEventListener('open', () => {
      reconnectDelay = 1000;
      if (credentials !== null) {
        send({ t: 'reconnect', code: credentials.code, token: credentials.token });
      } else if (init.mode === 'create') {
        send({ t: 'create', sizeKey: init.sizeKey });
      } else if (init.mode === 'join') {
        send({ t: 'join', code: init.code.toUpperCase() });
      }
    });

    ws.addEventListener('message', (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      switch (message.t) {
        case 'seat': {
          credentials = { code: message.code, token: message.token, player: message.player };
          you = message.player;
          try {
            localStorage.setItem(PVP_KEY, JSON.stringify(credentials));
          } catch {
            /* ignore */
          }
          seatHandler?.(credentials);
          break;
        }
        case 'view': {
          presenceHandler?.(message.opponentConnected, message.bothSeated);
          const view = fromWire(message.view);
          if (view.winner !== null) clearSavedPvpGame();
          viewHandler?.(view);
          break;
        }
        case 'chat':
          chatHandler?.(message.from === you ? 'You' : 'Opponent', message.text);
          break;
        case 'error':
          errorHandler?.(message.message);
          break;
        case 'echo':
          break;
      }
    });

    ws.addEventListener('close', () => {
      if (disposed) return;
      // Only auto-reconnect once we actually hold a seat.
      if (credentials !== null) {
        errorHandler?.('Connection lost — reconnecting…');
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 15000);
      } else {
        errorHandler?.('Could not reach the server.');
      }
    });
  }

  connect();

  return {
    get you(): PlayerId {
      return you;
    },
    send(command: Command): void {
      send({ t: 'command', command });
    },
    onView(handler): void {
      viewHandler = handler;
    },
    onError(handler): void {
      errorHandler = handler;
    },
    sendChat(text: string): void {
      send({ t: 'chat', text });
    },
    onChat(handler): void {
      chatHandler = handler;
    },
    onSeat(handler): void {
      seatHandler = handler;
      if (credentials !== null) handler(credentials);
    },
    onPresence(handler): void {
      presenceHandler = handler;
    },
    requestView(): void {
      send({ t: 'getView' });
    },
    dispose(): void {
      disposed = true;
      ws?.close();
      viewHandler = null;
    },
  };
}
