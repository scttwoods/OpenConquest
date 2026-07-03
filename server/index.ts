import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';

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

// Phase 0: a plain echo endpoint proving WebSockets work end-to-end through
// dev proxy / Docker / Fly. Phase 5 replaces this with the game-room protocol.
app.register(async (instance) => {
  instance.get('/ws', { websocket: true }, (socket) => {
    socket.on('message', (raw: Buffer) => {
      socket.send(`echo: ${raw.toString()}`);
    });
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

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
