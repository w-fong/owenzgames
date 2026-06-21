# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the site

Fully static — no build step. Serve from the repo root:

```bash
npx serve .
```

Then open `http://localhost:3000`. The game requires an internet connection on first load to fetch Three.js from jsDelivr CDN.

## Architecture

`index.html` at the root is the home page. Each game lives under `games/<name>/` and is self-contained (its own `index.html`, `style.css`, and JS).

### Subway Driver (`games/subway/`)

- **`data.js`** — pure data: `LINES` (station arrays for the `1` and `R` trains with transfer bullets, `el` flag for elevated stations, and fun facts), `ROUTE_COLORS`, `DARK_TEXT_ROUTES`.
- **`game.js`** — everything else: Three.js scene construction, physics, game state machine, audio, UI wiring. Imported as an ES module via `<script type="module">` with an importmap pointing Three.js at the CDN.
- **`style.css`** — scoped to the game page; uses `.hidden` class and the `[hidden]` attribute (both forced to `display:none !important`) for toggling visibility. The `.loadfail` element uses `display:flex` so the `[hidden]` rule is required to keep it hidden when loading succeeds.

#### Game state machine

`game.state` flows through: `menu` → `ready` → `run` ↔ `braking` → `creep` → `doors` → (last stop) `done` → back to `menu` or `ready`.

- **`menu`**: 3D backdrop renders with a parked train; player picks line/direction/trip length.
- **`ready`**: train is at the first station; GO starts the run.
- **`run`**: physics active; throttle accelerates, releasing decelerates gently. STOP button pulses when the player should brake.
- **`braking`**: deceleration applied. Three modes: `scored` (timed well, awards 3–5 stars), `manual` (pressed too early, returns to `run` when stopped), `auto` (emergency guardian-angel brake, awards 2 stars).
- **`creep`**: overshot or undershot by a small amount — train rolls to the exact stop point.
- **`doors`**: 6-second dwell; passengers animate on/off; STOP panel shows stars + transfers + fact.
- **`done`**: end screen with confetti and final rating saved to `localStorage`.

#### World construction

`buildWorld(line, stations)` builds the entire Three.js scene from scratch each run. Track, ties, and rails span the full length. Each station zone and inter-station segment is built as either underground (tunnel walls/ceiling) or elevated (viaduct deck, girders, railings, buildings, clouds) based on `station.el`. Geometry is reused via `THREE.InstancedMesh` for ties, lamps, columns, and legs. Textures (train sides, front face, station signs) are procedurally generated onto `<canvas>` elements.

#### Serving quirk

`npx serve` strips `index.html` and the trailing slash from directory URLs, landing on e.g. `/games/subway` (no slash). `games/subway/index.html` has `<base href="/games/subway/">` to fix relative path resolution for `style.css`, `game.js`, and dynamic imports.

## Adding a new game

1. Create `games/<name>/index.html`, `style.css`, and JS under that directory.
2. Add `<base href="/games/<name>/">` inside `<head>` of the game's `index.html`.
3. Add a `.game-card` entry to the root `index.html`.
