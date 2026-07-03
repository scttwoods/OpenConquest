# OpenConquest

A web homage to the classic Macintosh strategy game of exploration, production,
and conquest. Play against the computer in your browser, or online against
another human. See [PLAN.md](PLAN.md) for the full design and roadmap.

## Development

Requires Node 22+.

```sh
npm install
npm run dev        # Vite client on :5173 + Fastify server on :8080 (proxied)
npm test           # Vitest unit tests
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint
```

Open http://localhost:5173. The **Test Connection** button round-trips a message
through the server's WebSocket echo endpoint.

## Production build

```sh
npm run build      # client -> dist/, server bundle -> dist-server/
npm start          # serves everything on :8080
```

Or with Docker: `docker build -t openconquest . && docker run -p 8080:8080 openconquest`

## Deploying to Fly.io (one-time setup)

1. Install [flyctl](https://fly.io/docs/flyctl/install/) and `fly auth login`.
2. `fly launch --no-deploy` — reuse the checked-in `fly.toml` when prompted
   (pick your own app name; update `app =` in `fly.toml` to match).
3. `fly volumes create games_data --size 1` (persistent storage for PvP games).
4. `fly deploy` — first manual deploy.
5. `fly tokens create deploy` → add the token as a `FLY_API_TOKEN` secret in the
   GitHub repo (Settings → Secrets and variables → Actions).

After that, every push to `main` runs tests and deploys automatically via
`.github/workflows/deploy.yml`.

## Project layout

```
src/core/     Pure game logic — deterministic, no browser/network APIs
src/ai/       Computer opponent (Phase 4)
src/ui/       Canvas renderer & UI (Phase 1+)
src/session/  Local vs remote game session seam (Phase 2/5)
server/       Fastify + WebSocket server; serves the built client
```
