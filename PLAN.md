# OpenConquest — Implementation Plan

A web recreation of the classic Macintosh strategy game **Strategic Conquest**
(Peter Merrill / PBI Software / Delta Tao, 1984–1996), itself a descendant of the
mainframe game *Empire*. Runs entirely in the browser, deployed free on GitHub Pages.

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
- Single-player vs. one computer opponent. (Hotseat 2-player is a cheap Phase-6 add.)
- Entirely client-side: no server, no accounts. Saves go to `localStorage`.
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
| Hosting | **GitHub Pages** via GitHub Actions | Free, zero config beyond a workflow file, same repo |

**No backend.** The whole game is a static site. This is what makes free hosting trivial.

### Architecture rule (important)

Keep three layers strictly separated:

```
src/
  core/        # Pure game logic. No DOM, no Canvas, no timers.
               # map generation, units, combat, movement, production,
               # fog of war, victory conditions, save/load serialization
  ai/          # Computer opponent. Consumes core's public API only.
  ui/          # Canvas renderer, input handling, panels, dialogs, sound.
  main.ts      # Wires ui <-> core, game loop / turn sequencing
```

`core/` must be importable in Node (for Vitest) with zero browser globals. Every
rule of the game lives in `core/`, and `ui/` merely displays state and forwards
player commands.

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
1. Player turn: each unit with movement points may move/attack/be given standing
   orders (Sentry, Move-to via A* pathfinding, Explore, Patrol). Cities with no
   production assignment prompt for one.
2. End turn → production ticks, fighters burn fuel, docked ships repair.
3. AI turn (same rules, no cheating on fog of war — or at least: AI info advantages
   only as an explicit difficulty setting).
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
- Set Vite `base: '/OpenConquest/'` (required for project-site GitHub Pages).
- GitHub Actions workflow `.github/workflows/deploy.yml`: on push to `main`,
  build and deploy `dist/` with `actions/deploy-pages` (official Vite/GH-Pages recipe).
- Placeholder canvas rendering a checkerboard + title screen.
- README with dev instructions (`npm run dev`, `npm test`).
- **Done when:** repo Settings → Pages set to "GitHub Actions"; pushing to `main`
  publishes to `https://<user>.github.io/OpenConquest/` and the page renders.

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

### Phase 5 — Polish: retro UI, sound, saves
- System-6-style menu bar & dialog windows, Chicago-like webfont (there are free
  lookalikes; don't ship Apple's actual font), 1-bit sprite pass for all units.
- Sound: tiny synthesized click/boom/fanfare via WebAudio (no copied samples).
- Save/load slots + autosave each turn; export/import JSON save file.
- New Game dialog: map size, seed, difficulty. In-game help screen with unit table.
- Battle reports, turn counter, casualty stats, end-of-game score screen.
- **Done when:** a stranger can open the URL and learn/play without you explaining.

### Phase 6 — Ship it & extras (optional)
- Merge to `main`, confirm the Pages deploy, playtest on desktop + tablet.
- Nice-to-haves in rough priority: hotseat 2-player · replay viewer (deterministic
  core makes this cheap) · map editor · larger maps with typed-array perf pass ·
  PWA manifest for offline play.

---

## 5. Free-hosting notes

**Primary: GitHub Pages** — already where the code lives; the Phase-0 workflow makes
every push to `main` auto-deploy. Free for public repos, custom domain optional.

Fallbacks (equally free for a static Vite site, if Pages ever chafes):
- **Cloudflare Pages** — generous free tier, fast CDN, connect the GitHub repo.
- **Netlify / Vercel** — same one-click connect; watch free-tier build minutes.

If online multiplayer ever becomes a goal, that's the point a backend (or WebRTC
with a free signaling relay) enters the picture — explicitly out of scope for v1.

---

## 6. Working agreement for Claude Code sessions

- One phase per session (or less). Always leave `main` deployable; do feature work
  on branches if a phase is long.
- Run `npm test` and `npm run build` before every commit.
- Keep `core/` browser-free and deterministic; any new rule gets a unit test.
- Keep all tunable numbers in `core/rules.ts`.
- Update the checklist below as phases complete.

## 7. Progress

- [ ] Phase 0 — Scaffold & GitHub Pages deploy
- [ ] Phase 1 — Map generation, rendering, fog of war
- [ ] Phase 2 — Armies, cities, combat, capture (first playable)
- [ ] Phase 3 — Navy & air force
- [ ] Phase 4 — AI opponent
- [ ] Phase 5 — Retro UI polish, sound, save/load
- [ ] Phase 6 — Ship it & extras
