import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { ClientMessage } from '../src/session/protocol';
import {
  createConnection,
  handleChat,
  handleCommand,
  handleCreate,
  handleDisconnect,
  handleGetView,
  handleJoin,
  handleReconnect,
  restoreRooms,
} from './rooms';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

// In the Docker image the layout is /app/dist-server/index.js + /app/dist/.
// In dev (tsx watch server/index.ts) it's <repo>/server/index.ts + <repo>/dist/,
// but dev clients use Vite's server anyway — Fastify only handles /ws and /health.
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../dist');

const app = Fastify({ logger: true });

await app.register(fastifyWebsocket);

app.get('/health', () => ({ status: 'ok', service: 'openconquest' }));

app.register(async (instance) => {
  instance.get('/ws', { websocket: true }, (socket) => {
    const conn = createConnection();
    socket.on('message', (raw: Buffer) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        socket.send(JSON.stringify({ t: 'error', message: 'Bad message' }));
        return;
      }
      try {
        switch (message.t) {
          case 'echo':
            socket.send(JSON.stringify({ t: 'echo', payload: message.payload ?? null }));
            break;
          case 'create':
            handleCreate(conn, socket, message.sizeKey);
            break;
          case 'join':
            handleJoin(conn, socket, message.code);
            break;
          case 'reconnect':
            handleReconnect(conn, socket, message.code, message.token);
            break;
          case 'command':
            handleCommand(conn, socket, message.command);
            break;
          case 'chat':
            handleChat(conn, String(message.text ?? ''));
            break;
          case 'getView':
            handleGetView(conn);
            break;
          default:
            socket.send(JSON.stringify({ t: 'error', message: 'Unknown message type' }));
        }
      } catch (err) {
        app.log.error(err);
        socket.send(JSON.stringify({ t: 'error', message: 'Server error' }));
      }
    });
    socket.on('close', () => handleDisconnect(conn));
  });
});

await app.register(fastifyStatic, { root: clientDist, wildcard: false });

// SPA fallback: any unknown GET serves the client shell.
app.setNotFoundHandler((request, reply) => {
  if (request.method === 'GET' && !request.url.startsWith('/ws')) {
    return reply.sendFile('index.html');
  }
  return reply.code(404).send({ error: 'not found' });
});

const restored = restoreRooms();
app.log.info(`restored ${restored} saved game(s)`);

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
