import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import { applyCommand, type Command } from '../src/core/game';
import { MAP_SIZES, type MapSizeKey } from '../src/core/rules';
import { createGame, type GameState, type PlayerId } from '../src/core/state';
import { deserializeGame, serializeGame } from '../src/core/save';
import { toWire, viewFor } from '../src/core/view';
import type { ServerMessage } from '../src/session/protocol';
import { deleteRoom, loadRooms, saveRoom } from './store';

interface Room {
  code: string;
  state: GameState;
  tokens: [string, string | null];
  sockets: [WebSocket | null, WebSocket | null];
  chat: { from: PlayerId; text: string }[];
}

const rooms = new Map<string, Room>();

/** No 0/O/1/I — codes get read aloud over the phone. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newCode(): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
    if (!rooms.has(code)) return code;
  }
}

function sendTo(socket: WebSocket | null, message: ServerMessage): void {
  if (socket !== null && socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function persist(room: Room): void {
  saveRoom({
    code: room.code,
    tokens: room.tokens,
    game: serializeGame(room.state),
    chat: room.chat.slice(-100),
  });
}

/** Push each seated player their own fogged view. */
function broadcastViews(room: Room): void {
  for (const player of [0, 1] as const) {
    if (room.tokens[player] === null) continue;
    const other = (1 - player) as PlayerId;
    sendTo(room.sockets[player], {
      t: 'view',
      view: toWire(viewFor(room.state, player), room.state.sizeKey),
      opponentConnected: room.sockets[other] !== null,
      bothSeated: room.tokens[1] !== null,
    });
  }
}

export function restoreRooms(): number {
  for (const stored of loadRooms()) {
    try {
      rooms.set(stored.code, {
        code: stored.code,
        state: deserializeGame(stored.game),
        tokens: stored.tokens,
        sockets: [null, null],
        chat: stored.chat as Room['chat'],
      });
    } catch (err) {
      console.error(`failed to restore room ${stored.code}:`, err);
    }
  }
  return rooms.size;
}

export interface Connection {
  room: Room | null;
  player: PlayerId | null;
}

export function createConnection(): Connection {
  return { room: null, player: null };
}

function seat(
  conn: Connection,
  socket: WebSocket,
  room: Room,
  player: PlayerId,
  token: string,
): void {
  // Displace any zombie socket for this seat.
  const existing = room.sockets[player];
  if (existing !== null && existing !== socket) {
    sendTo(existing, { t: 'error', message: 'This seat reconnected elsewhere.' });
    existing.close();
  }
  room.sockets[player] = socket;
  conn.room = room;
  conn.player = player;
  sendTo(socket, { t: 'seat', code: room.code, token, player });
}

export function handleCreate(conn: Connection, socket: WebSocket, sizeKey: MapSizeKey): void {
  if (MAP_SIZES[sizeKey] === undefined) {
    sendTo(socket, { t: 'error', message: 'Unknown map size' });
    return;
  }
  const code = newCode();
  const token = crypto.randomBytes(16).toString('hex');
  const room: Room = {
    code,
    state: createGame(crypto.randomInt(2 ** 31), sizeKey),
    tokens: [token, null],
    sockets: [null, null],
    chat: [],
  };
  rooms.set(code, room);
  seat(conn, socket, room, 0, token);
  persist(room);
  broadcastViews(room);
}

export function handleJoin(conn: Connection, socket: WebSocket, code: string): void {
  const room = rooms.get(code.toUpperCase());
  if (room === undefined) {
    sendTo(socket, { t: 'error', message: 'No game with that code' });
    return;
  }
  if (room.tokens[1] !== null) {
    sendTo(socket, { t: 'error', message: 'That game already has two players' });
    return;
  }
  const token = crypto.randomBytes(16).toString('hex');
  room.tokens[1] = token;
  seat(conn, socket, room, 1, token);
  persist(room);
  broadcastViews(room);
}

export function handleReconnect(
  conn: Connection,
  socket: WebSocket,
  code: string,
  token: string,
): void {
  const room = rooms.get(code.toUpperCase());
  const player = room?.tokens.findIndex((t) => t !== null && t === token) ?? -1;
  if (room === undefined || (player !== 0 && player !== 1)) {
    sendTo(socket, { t: 'error', message: 'Game not found — it may have expired' });
    return;
  }
  seat(conn, socket, room, player, token);
  for (const entry of room.chat.slice(-20)) {
    sendTo(socket, { t: 'chat', from: entry.from, text: entry.text });
  }
  broadcastViews(room);
}

export function handleCommand(conn: Connection, socket: WebSocket, command: Command): void {
  if (conn.room === null || conn.player === null) {
    sendTo(socket, { t: 'error', message: 'Not in a game' });
    return;
  }
  const result = applyCommand(conn.room.state, conn.player, command);
  if (!result.ok) {
    sendTo(socket, { t: 'error', message: result.error ?? 'Illegal command' });
    // Resync the sender in case their client drifted.
    broadcastViews(conn.room);
    return;
  }
  if (
    command.type === 'endTurn' ||
    command.type === 'surrender' ||
    conn.room.state.winner !== null
  ) {
    persist(conn.room);
  }
  if (conn.room.state.winner !== null) {
    deleteRoom(conn.room.code);
  }
  broadcastViews(conn.room);
}

export function handleChat(conn: Connection, text: string): void {
  if (conn.room === null || conn.player === null) return;
  const trimmed = text.slice(0, 500);
  conn.room.chat.push({ from: conn.player, text: trimmed });
  for (const player of [0, 1] as const) {
    sendTo(conn.room.sockets[player], { t: 'chat', from: conn.player, text: trimmed });
  }
}

export function handleGetView(conn: Connection): void {
  if (conn.room !== null) broadcastViews(conn.room);
}

export function handleDisconnect(conn: Connection): void {
  if (conn.room !== null && conn.player !== null && conn.room.sockets[conn.player] !== null) {
    conn.room.sockets[conn.player] = null;
    // Let the opponent see the presence change.
    broadcastViews(conn.room);
    persist(conn.room);
  }
  conn.room = null;
  conn.player = null;
}
