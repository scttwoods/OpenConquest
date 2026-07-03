# OpenConquest — Implementation Plan

A web recreation of the classic Macintosh strategy game **Strategic Conquest**
(Peter Merrill / PBI Software / Delta Tao, 1984–1996), itself a descendant of the
mainframe game *Empire*. Two ways to play:

- **vs Computer** — runs entirely in the browser, no server involved.
- **Online PvP** — two humans over the internet (you vs. Dad), live over WebSockets:
  create a game, share a join code, watch each other's visible moves in real time.
  Games persist server-side so you can also play a turn whenever and come back later.

Hosted on **Fly.io** (one tiny app serves both the site and the multiplayer server).

> **How to use this plan with Claude Code:** work one phase at a time. Open Claude
> Code in this repo and say, e.g., *"Read PLAN.md and implement Phase 0. Commit when
> done."* Verify each phase's **Definition of Done** before moving on. Each phase
> leaves the game in a playable/deployable state.

---

## 1. What we're building

**Genre:** turn-based war game of exploration and conquest on a procedurally
generated world of islands and oceans, covered by fog of war.

**Core loop:**
1. You start with one city on an unexplored map.
2. Cities produce military units (one at a time; each unit type takes N turns).
3. Units explore, fight, and capture neutral/enemy cities.
4. Captured cities join your production base.
5. Win by capturing/destroying everything the enemy has.

**Scope decisions (defaults — revisit later if desired):**
- Two modes: single-player vs. AI (client-only) and 2-player online PvP.
- PvP uses **alternating turns** (faithful to the original). "Real time" means you
  both stay connected and watch the opponent's moves appear live in your visible
  area as they make them — plus a small in-game chat. Async also works: the server
  keeps the game, so either player can close the tab and take their turn later.
- No accounts. A PvP game is a 6-character join code you text to the other player.
  Reconnecting with the same code + a browser-stored player token resumes your seat.
- vs-AI saves go to `localStorage`; PvP games live on the server.
- Look and feel: retro 1-bit Macintosh aesthetic (black & white, patterned dithering,
  Chicago-style pixel font, System 6 style windows). This is a loving homage —
  **do not copy original artwork, sounds, or the "Strategic Conquest" name/trademark.**
  Game *mechanics* are not copyrightable; assets and branding are. All art is drawn
  fresh (simple pixel sprites are fine and period-appropriate).

---

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Refactor safety for game-state logic |
| Build/dev | Vite | Instant dev server, trivial static build |
| Rendering | HTML5 Canvas 2D | Tile map + sprites; no framework needed for the map |
| UI chrome | Plain DOM + CSS (or Preact if it gets hairy) | Menus, dialogs, production panel |
| State | Plain immutable-ish TS objects; game core is framework-free | Testable, deterministic |
| RNG | Seeded PRNG (e.g. mulberry32) | Reproducible maps & replayable bugs |
| Tests | Vitest | Unit-test the game core (combat, pathing, AI) |
| Server | Node 22 + Fastify (static files) + `ws` (WebSockets) | One small process serves the built client *and* hosts PvP games |
| Hosting | **Fly.io**, single app, auto-stop machine | See §5 — effectively pennies/month; free alternatives listed |

The server is thin on purpose: it imports the same `core/` package the client uses.
Because `core/` is pure TypeScript with no browser globals, it runs in Node unchanged —
that's what makes PvP cheap to build.

### Architecture rule (important)

Keep three layers strictly separated:

```
src/
  core/        # Pure game logic. No DOM, no Canvas, no timers, no network.
               # map generation, units, combat, movement, production,
               # fog of war, victory conditions, save/load serialization.
               # Exposes: applyCommand(state, playerId, command) -> newState
               # and viewFor(state, playerId) -> fogged player view.
  ai/          # Computer opponent. Consumes core's public API only.
  ui/          # Canvas renderer, input handling, panels, dialogs, sound.
  session/     # The seam between ui and a game:
               #   LocalSession  — vs-AI: applies commands in-process
               #   RemoteSession — PvP: sends commands over WebSocket,
               #                    receives fogged views back
  main.ts      # Menu, mode selection, wiring
server/
  index.ts     # Fastify: serves dist/ + /health; upgrades /ws connections
  rooms.ts     # Game rooms: create/join by code, seat tokens, reconnection
  store.ts     # Persistence: JSON snapshots to a Fly volume (or SQLite later)
```

`core/` must be importable in Node (for Vitest and the server) with zero browser
globals. Every rule of the game lives in `core/`; `ui/` only displays state and
forwards player commands.

**The load-bearing decision:** from the very first playable phase, the UI never
mutates game state directly — it emits **serializable command objects**
(`{type:'move', unit:12, to:[34,56]}`) through the `session` interface. In vs-AI
mode those apply locally; in PvP they go over the wire. The server is authoritative
for PvP: it validates each command against the rules, applies it, and sends each
player only their own fogged view — so neither of you can peek under the fog, and
the two clients can never drift out of sync.

---

## 3. Game design spec

These numbers are faithful-in-spirit approximations of Strategic Conquest / Empire.
Tune freely during playtesting; keep them in one `core/rules.ts` config file.

### 3.1 Map
- Rectangular grid, default **60×100** tiles (offer Small/Medium/Large).
- Tile types: `sea`, `land`. Cities sit on land (coastal cities can build ships).
- Generation: seeded noise / random-walk blob growth to make island clusters;
  then scatter ~50–70 neutral cities weighted toward larger landmasses; place the
  two starting cities far apart on decent-sized continents.
- **Fog of war:** three states per tile per player — never seen (black), seen
  previously (drawn from last-known snapshot, may be stale), currently visible.
  Units and cities reveal a radius of 1 (fighters and cities slightly more feels good).

### 3.2 Units

| Unit | Domain | Moves/turn | Hits | Build time (turns) | Notes |
|---|---|---|---|---|---|
| Army | land | 1 | 1 | 5 | Only unit that can capture cities. Can ride Transports. |
| Fighter | air | 4 | 1 | 8 | Range 20 moves of fuel; must land at a friendly city or Carrier or it crashes. Great scout. |
| Transport | sea | 2 | 1 | 15 | Carries up to 6 Armies. Loads/unloads at coast. |
| Destroyer | sea | 2 | 1 | 15 | Cheap escort; can see adjacent Submarines. |
| Submarine | sea | 2 | 1 | 18 | Hidden from enemies unless adjacent to their ships/cities; hits ships hard. |
| Cruiser | sea | 2 | 2 | 30 | Multi-hit warship. |
| Carrier | sea | 2 | 2 | 36 | Landing pad for up to 8 Fighters at sea. |
| Battleship | sea | 2 | 3 | 45 | Strongest warship. |

Multi-hit ships lose 1 hit per lost combat round and repair 1 hit/turn docked in a
friendly city.

### 3.3 Combat
- Attacker moves onto defender's tile → battle resolves immediately.
- Rounds of 50/50 coin flips (modifiable per matchup, e.g. Sub vs ship 3-hits);
  loser of a round loses one hit; repeat until one side is destroyed.
- Winner (if attacker survived) occupies the tile — except an Army attacking a
  **city**: attacking a neutral/enemy city is ~50% capture, else the Army dies.
  Captured city: production resets and any enemy planes based there are destroyed.

### 3.4 Turn structure
1. Active player's turn: each unit with movement points may move/attack/be given
   standing orders (Sentry, Move-to via A* pathfinding, Explore, Patrol). Cities
   with no production assignment prompt for one.
2. End turn → production ticks, fighters burn fuel, docked ships repair.
3. Other side's turn — the AI in vs-Computer mode, the other human in PvP (their
   moves that enter your visible area render live on your screen while you wait).
4. Victory check: a side with no cities and no units (or no cities and no Armies
   plus no Transports carrying Armies) loses. Offer surrender when hopeless.

### 3.5 Quality-of-life (do these — they make or break it)
- Click unit → highlight reachable tiles; click destination → A* path, multi-turn
  Move-to orders persist across turns.
- Keyboard: arrow/vi keys to move, `space` skip, `s` sentry, `Enter` end turn.
- Auto-cycle to next unit awaiting orders; "End turn?" confirm when units still idle.
- Minimap with viewport rectangle; click to jump.
- Production dialog per city with build-time listed; "same as last" default.
- Save/load (multiple slots, `localStorage`), plus export/import save as a file.
- Battle report toast ("Your Destroyer sank an enemy Transport near (34,12)").

---

## 4. Phases

### Phase 0 — Scaffold & deploy pipeline (get "hello world" on the web first)
- `npm create vite@latest` → vanilla-ts template, strict tsconfig, Vitest, ESLint+Prettier.
- Minimal `server/`: Fastify serving `dist/` + a `/health` route + a `/ws` echo
  endpoint (proves WebSockets work end-to-end before any game code exists).
- Dev ergonomics: `npm run dev` runs Vite + server concurrently, Vite proxies `/ws`.
- `Dockerfile` (multi-stage: build client, run server) + `fly.toml` with
  `auto_stop_machines = true`, `auto_start_machines = true`, `min_machines_running = 0`.
- GitHub Actions workflow: on push to `main`, `flyctl deploy` (needs a
  `FLY_API_TOKEN` repo secret — one-time manual step, see §5).
- Placeholder canvas rendering a checkerboard + title screen with the two mode
  buttons (vs Computer / Online PvP) stubbed.
- README with dev instructions (`npm run dev`, `npm test`, `fly deploy`).
- **Done when:** `https://<app>.fly.dev` serves the title screen and a test button
  round-trips a message through the `/ws` echo endpoint.

### Phase 1 — World: map generation, rendering, fog
- `core/`: tile grid, seeded map generator (islands + neutral cities + 2 starts),
  fog-of-war model with last-seen snapshots.
- `ui/`: Canvas tile renderer with camera pan (drag + arrows) and zoom, minimap,
  1-bit tileset (sea dither pattern, land, city glyph).
- Unit tests: map gen invariants (connectivity of each start's continent, city
  counts, determinism per seed).
- **Done when:** "New Game (seed)" shows a fogged map with your one city visible.

### Phase 2 — Armies, cities, combat, capture (first playable!)
- Production system (city builds Army in N turns), unit selection & movement with
  movement points, combat resolution, city capture, turn sequencing, victory check.
- All player input flows as serializable commands through the `session` interface
  (`LocalSession` for now) — this is the seam PvP plugs into in Phase 5.
- Unit cycling, sentry, end-turn flow, production dialog.
- A trivial "dummy" AI (moves armies randomly) so the loop is complete.
- Unit tests: combat math (statistical bounds), capture logic, production timing.
- **Done when:** you can conquer a small all-land map end-to-end against the dummy AI.

### Phase 3 — Navy & air force
- Transports with Army loading/unloading (the heart of the game — get UX right:
  Army moves onto adjacent Transport to board; Transport "unload" order beaches
  its Armies).
- Fighters with fuel, landing on cities/Carriers, crash on empty tank.
- All ship types, multi-hit damage & docked repair, Submarine stealth rules,
  coastal-city shipbuilding restriction.
- A* pathfinding respecting domain (land/sea/air) for Move-to orders.
- **Done when:** you can stage a cross-ocean invasion by hand on a two-continent map.

### Phase 4 — The real AI
Priority-driven, per-city + per-unit heuristics (this is how the original felt):
- Economy: early cities build Armies until continent is saturated, then Transports
  → escorts → capital ships; interior cities skew Armies/Fighters.
- Continent phase: armies swarm nearest unowned city (A* + shared claim map so
  they spread out).
- Naval phase: form invasion groups (Transport + escort), pick target continents
  by (enemy weakness × city count ÷ distance), execute landings.
- Fighters scout fog frontier and intercept.
- Difficulty levels = production discount / info handicaps, explicit and honest.
- Headless AI-vs-AI test harness (run 100 fast games in Node) to catch stalemates,
  crashes, and pathological passivity.
- **Done when:** the AI beats a passive player, expands across oceans, and a
  competent human still has fun beating it on Normal.

### Phase 5 — Online PvP (play with Dad)
- `server/rooms.ts`: **Create Game** → server generates the map, returns a
  6-character join code + a seat token (stored in the creator's `localStorage`).
  **Join Game** → second player enters the code, gets the other seat + token.
- Server-authoritative loop: client sends commands, server validates via `core/`,
  applies, broadcasts each player their updated **fogged view** (never the full
  state). Turn ownership enforced server-side.
- `RemoteSession` in the client implements the same interface as `LocalSession`,
  so the whole Phase 2–3 UI works unmodified in PvP.
- Live spectating of the opponent's turn: events that intersect your visibility
  stream in as they happen; a status bar shows "Dad is moving… (12 units left)".
- Reconnection: refresh/drop → reconnect with code + token → full fogged view
  resync. Games snapshot to disk (Fly volume) on every turn end, survive restarts,
  and expire after ~30 days idle.
- In-game chat sidebar (it's Dad — trash talk is a core feature).
- Simple lobby screen listing your in-progress games (from tokens in `localStorage`).
- Tests: two headless WebSocket clients play a scripted game in CI; illegal-command
  and out-of-turn rejection; reconnect resync equivalence.
- **Done when:** two browsers (one on your machine, one on a phone on cellular)
  can create/join, play alternating turns watching each other's moves live,
  survive a mid-game refresh, and finish a game on the Fly.io URL.

### Phase 6 — Polish: retro UI, sound, saves
- System-6-style menu bar & dialog windows, Chicago-like webfont (there are free
  lookalikes; don't ship Apple's actual font), 1-bit sprite pass for all units.
- Sound: tiny synthesized click/boom/fanfare via WebAudio (no copied samples).
- Save/load slots + autosave each turn; export/import JSON save file.
- New Game dialog: map size, seed, difficulty. In-game help screen with unit table.
- Battle reports, turn counter, casualty stats, end-of-game score screen.
- **Done when:** a stranger can open the URL and learn/play without you explaining.

### Phase 7 — Ship it & extras (optional)
- Merge to `main`, confirm the Fly deploy, playtest on desktop + tablet — then
  play a real game with Dad end-to-end.
- Nice-to-haves in rough priority: turn notifications for async play (email or
  push via a free service) · hotseat 2-player on one machine · replay viewer
  (deterministic core makes this cheap) · map editor · larger maps with
  typed-array perf pass · PWA manifest.

---

## 5. Hosting: Fly.io (and honest cost notes)

**Primary: Fly.io** — one app runs the Node server, which serves both the static
client and the PvP WebSockets. Long-lived WebSocket connections work natively
(no serverless timeout games), and a 256 MB shared-CPU machine is far more than
this game needs.

- **Cost reality:** Fly.io no longer has a free tier for new accounts — it's
  pay-as-you-go. But with `auto_stop_machines`/`auto_start_machines` and
  `min_machines_running = 0`, the machine **stops when nobody is connected and
  cold-starts in ~1 second when someone opens the URL**. A machine that only runs
  during your evening games with Dad costs cents per month; a small persistent
  volume for saved games adds a few cents more. Budget: well under $1–2/month in
  practice. (Verify current pricing at fly.io/docs/about/pricing when implementing.)
- One-time manual setup: install `flyctl`, `fly launch` (creates the app +
  `fly.toml`), `fly volumes create games_data -s 1`, and add a `FLY_API_TOKEN`
  secret to the GitHub repo so Actions can deploy.
- Auto-stop caveat: stopping machines kills in-memory state — which is exactly why
  Phase 5 snapshots every game to the volume at each turn end, and clients
  auto-reconnect/resync. Design for it and the auto-stop is free money.

**Strictly-$0 alternative:** **Render.com free tier** runs the identical Node +
WebSocket app for nothing. Trade-off: free services sleep after 15 min idle and
cold-start in ~30–60 s (fine if you text Dad "game's booting"), and the free disk
is ephemeral — so point `store.ts` at a free external store (e.g. Turso/Neon free
tier) or accept losing unfinished games on redeploys. The code is identical either
way — it's just where the container runs, so switching later is a 30-minute job.

Also fine: **Railway** (usage-based, ~$1/mo at this scale, $5 credit granted
monthly on the Hobby trial), or a free **Oracle Cloud** VM if you enjoy sysadmin.
Cloudflare Workers + Durable Objects can do this on their free tier too, but the
programming model diverges from plain Node — not worth it for v1.

---

## 6. Working agreement for Claude Code sessions

- One phase per session (or less). Always leave `main` deployable; do feature work
  on branches if a phase is long.
- Run `npm test` and `npm run build` before every commit.
- Keep `core/` browser-free, network-free, and deterministic; any new rule gets a
  unit test. All player input stays serializable commands through `session/`.
- Keep all tunable numbers in `core/rules.ts`.
- Update the checklist below as phases complete.

## 7. Progress

- [ ] Phase 0 — Scaffold, server skeleton & Fly.io deploy
- [ ] Phase 1 — Map generation, rendering, fog of war
- [ ] Phase 2 — Armies, cities, combat, capture (first playable)
- [ ] Phase 3 — Navy & air force
- [ ] Phase 4 — AI opponent
- [ ] Phase 5 — Online PvP over WebSockets
- [ ] Phase 6 — Retro UI polish, sound, save/load
- [ ] Phase 7 — Ship it & extras
