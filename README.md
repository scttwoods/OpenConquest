# OpenConquest

A web homage to the classic Macintosh strategy game of exploration, production,
and conquest. Play against the computer in your browser, or online against
another human. See [PLAN.md](PLAN.md) for the full design and roadmap.

## How to play

Take every city. Cities build units (click one of yours to choose what to
build). Click a unit, then click where it should go — distant tiles become
standing orders that continue across turns. Armies capture cities (roughly half
of assaults succeed); Fighters fly anywhere but must land at cities or Carriers
before their fuel (20 moves) runs out; Armies board Transports to invade across
the sea. Keys: `n` next unit · `space` skip · `s` sentry · `Enter` end turn ·
`Esc` deselect · arrows pan · wheel zoom.

**Online PvP:** one player creates a game and shares the 6-letter code; the
other joins with it. The server is authoritative and each player only ever
receives their own fogged view, so nobody can peek. Close the tab anytime — the
game lives on the server and *Resume Last Game* picks your seat back up.

PvP games persist to the `games_data` volume mounted at `/data`, so they
survive restarts and deploys. Finished games are deleted; idle games expire
after 30 days.

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

## Deploying to Fly.io

Deploys are automatic: every push to a deployed branch runs the tests and, if
they pass, ships to Fly via `.github/workflows/deploy.yml` — no clicking Deploy
in the Fly dashboard. This needs a one-time secret:

1. Create a deploy token: `fly tokens create deploy` (or in the Fly dashboard
   under the app → Tokens).
2. In GitHub, add it as a repository secret named `FLY_API_TOKEN`
   (Settings → Secrets and variables → Actions → New repository secret).

After that, `git push` deploys. The deployed branches are listed in the
workflow's `on.push.branches`; add or change them there.

First-time app setup (only if the app doesn't exist yet): install
[flyctl](https://fly.io/docs/flyctl/install/), `fly auth login`,
`fly launch --no-deploy` (reuse the checked-in `fly.toml`, matching `app =` to
your app name), then `fly deploy` once.

## Project layout

```
src/core/     Pure game logic — deterministic, no browser/network APIs
src/ai/       Computer opponent (Phase 4)
src/ui/       Canvas renderer & UI (Phase 1+)
src/session/  Local vs remote game session seam (Phase 2/5)
server/       Fastify + WebSocket server; serves the built client
```
