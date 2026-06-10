# Owenz Games 🚇

A small collection of browser games made for Owen — starting with **Subway Driver NYC**,
a gentle 3D game where you drive real New York City subway trains.

## Games

### Subway Driver NYC (`games/subway/`)

Drive the **1 train** (Broadway–7 Av Local) or the **R train** (Broadway Local) along
their real routes, with every real station in order — from Van Cortlandt Park–242 St
to South Ferry, and Forest Hills–71 Av to Bay Ridge–95 St.

Designed so a 5-year-old can play it:

- **Two giant buttons** — green **GO** and red **STOP**. That's the whole game.
  (Keyboard works too: ↑/Space = go, ↓ = stop.)
- **No way to lose.** If you forget to stop, the friendly auto-brake stops the train
  for you. Stop a little late and the train rolls back into place.
- **5-star rating system** — each station stop earns 1–5 stars for how well-timed the
  stop was, and the whole trip gets a final star rating with confetti. Best ratings
  are saved on the device.
- **Real subway details** for older train fans: correct stations and order, transfer
  bullets at every stop ("Change here for ②③"), the elevated stretch of the 1 in the
  Bronx and at 125 St, a third rail, door chimes, and spoken announcements
  ("This is 34 St–Penn Station…") using the browser's speech synthesis.
- **Short ride (5 stops)** or the **whole line** (37 or 44 stops), in either direction.

## Running the site

It's a fully static site — no build step. Serve the repo root with any static server:

```bash
npx serve .            # or: python3 -m http.server
```

then open `http://localhost:3000` (or `:8000`). It also works great on **GitHub Pages**:
repo Settings → Pages → deploy from the `main` branch root.

> Note: the game loads the Three.js 3D engine from the jsDelivr CDN, so it needs an
> internet connection the first time it loads.

## Structure

```
index.html              # Owenz Games home page
assets/site.css
games/subway/
  index.html            # game shell + HUD
  style.css
  data.js               # real station data for the 1 and R lines
  game.js               # 3D engine, driving physics, scoring
```
