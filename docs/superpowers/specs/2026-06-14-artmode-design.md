# ArtMode — Home / Screensaver Screen

**Date:** 2026-06-14
**Status:** Approved design, ready for implementation plan

## Purpose

A screensaver for room displays that shows a single piece of classic artwork inside
an ornate picture frame. It appears on the home screen at boot and after a period of
inactivity; **any input** dismisses it and reveals the home menu. Calm, museum-like,
low-attention.

## Scope

In scope:
- A backend endpoint that **selects** an artwork and returns its image path + metadata.
- An `ArtMode` widget that composes the art image, the frame overlay, and an
  optional caption.
- A **config-driven screensaver mechanism** in the screen-framework that shows a
  configured widget as a lowest-priority fullscreen overlay on idle / at boot, and
  dismisses it on any input.

Deliberately deferred (NOT in this work):
- **Daily-deterministic selection + memory of recent picks.** For now the endpoint
  picks at **random** on each request. The endpoint is the seam where this becomes
  date-seeded ("one painting per day") later.

### Activation model (decided)

`ArtMode` is **not** a standalone screen. It is a plain `art` widget shown by a
generic, config-driven screensaver layer on the existing home screen
(`living-room`). Rationale:

- The framework has **no idle timer** today, so any auto-appearing screensaver needs
  new idle plumbing regardless of model — a standalone-screen + navigate approach
  would need the same idle work *plus* a full page reload (menu refetch + flash) on
  every wake and every sleep.
- The overlay layer reuses the existing fullscreen overlay slot (with priority +
  `hasOverlay` gate) and mirrors the proven `display:sleep` wake-swallow pattern,
  giving an **instant, reload-free** reveal of the already-mounted home menu.
- Keeping the screensaver generic (it shows any registered widget) means `ArtMode`
  is just content; other widgets can be the screensaver later.

## Assets (verified)

- Frame overlay: `media/img/ui/frame.png` — 1920×1080 (16:9), ornate wooden frame
  with a **fully transparent center** (alpha 0). Inner opening borders ≈ 7% left /
  6.5% right; top/bottom borders are visually thicker (~13%).
- Art library: `media/img/art/classic/` — ~648 subfolders. Each subfolder contains
  one image file plus a `metadata.yaml`:
  ```yaml
  title: Merrymakers in an Inn
  artist: Adriaen van Ostade
  date: '1674'
  origin: Holland
  medium: Oil on panel
  # ... plus width/height/ratio/department/credit/api_id/image_url
  ```
- Image files are served via the existing static route: a `/media/img/...` path is
  auto-rewritten to `/api/v1/static/img/...` on the frontend (`frontend/src/lib/api.mjs`).

## Architecture

### 1. Backend — art selection endpoint

`GET /api/v1/art/featured`

- New thin router `backend/src/4_api/v1/routers/art.mjs`, with the filesystem logic
  in a small `ArtAdapter` (keep `fs` out of the router; follow the existing adapter
  pattern under `backend/src/1_adapters/`).
- Behavior:
  1. List subfolders of `media/img/art/classic/`.
  2. **Pick one at random.** (Selection/memory/daily-determinism deferred — this call
     is the seam for that future logic.)
  3. Read that folder's `metadata.yaml`.
  4. Find the image file in the folder (the non-`.yaml`, non-hidden file).
  5. Return JSON.
- Response shape:
  ```json
  {
    "image": "/media/img/art/classic/<folder>/<file>.jpg",
    "meta": {
      "title": "...",
      "artist": "...",
      "date": "...",
      "origin": "...",
      "medium": "..."
    }
  }
  ```
- `image` uses the `/media/img/...` convention so the frontend rewrites it to the
  static route automatically.
- Error handling: if the art directory is empty/unreadable, return a 4xx/5xx with a
  JSON error (no silent empty success).

### 2. Frontend — `ArtMode` widget

`frontend/src/screen-framework/widgets/ArtMode.jsx`, registered as `art` in
`frontend/src/screen-framework/widgets/builtins.js`.

- On mount, fetches `/api/v1/art/featured` via `DaylightAPI`.
- Renders three stacked layers in a full-size `position: relative` container:
  1. **Art** — `<img>`, absolute inset 0, `object-fit: cover` (fills the frame
     opening regardless of the painting's aspect ratio).
  2. **Frame** — `frame.png`, absolute inset 0, `object-fit: fill` (already 16:9),
     `pointer-events: none`, stacked above the art.
  3. **Placard** (optional) — museum-style caption, e.g. *"Title — Artist, Year"*,
     positioned in a lower-inner corner so it sits inside the frame opening, clear
     of the ~13% bottom border. Subtle styling (semi-transparent dark plate or soft
     text shadow) so it reads over any painting.
- Props (from screen YAML):
  - `placard: true | false` — default `true`; toggles the caption.
- Failure/loading: while loading, render a black background (no white flash). On
  fetch failure, render a quiet black fallback.
- Logging (per project rules — use the logging framework, no raw `console`):
  - `info` on mount and on fetch success (with selected title/artist).
  - `warn`/`error` on fetch failure.

### 3. Screensaver mechanism (screen-framework)

A new generic, config-driven screensaver layer. Driven by a `screensaver` block in
the screen YAML:

```yaml
screensaver:
  widget: art         # registry key — widget to show as the screensaver
  idle: 120           # seconds of inactivity before it appears
  showOnLoad: true    # also show immediately at boot (boot-to-art)
  props:
    placard: true     # passed through to the widget
```

Implementation:

- A renderless controller (e.g. `useScreensaver` hook + a small component, wired into
  `ScreenRenderer`, reading `config.screensaver`). It must mount inside
  `ScreenOverlayProvider` and `MenuNavigationProvider`.
- **Activity tracking:** listen for global activity (keydown / pointer / click /
  gamepad). Any activity resets the idle timer.
- **Show:** when the idle timer fires (or at boot if `showOnLoad`), show the
  configured widget as a **lowest-priority fullscreen overlay** via
  `showOverlay(Component, props, { mode: 'fullscreen' })`.
  - **Suppression:** do nothing if a player or any other fullscreen overlay is
    active (`hasOverlay` gate) — the screensaver never covers active content.
- **Dismiss (wake):** while the screensaver overlay is shown, a one-shot
  capture-phase listener dismisses it on the first input and **swallows that event**
  (`stopPropagation` + `preventDefault`), mirroring `display:sleep`'s wake handler,
  so the waking key/tap does not also trigger a menu action.
- **Reset to home root:** on activation, reset menu navigation to root via
  `MenuNavigationContext` so waking always lands on the home menu root ("the menu /
  current main home").
- Logging (framework, no raw `console`): `info` on show/dismiss, `debug` on idle
  timer reset.

### 4. Home screen config

`data/household/screens/living-room.yml` gains the `screensaver` block above
(`widget: art`, `showOnLoad: true`, an `idle` value, `placard: true`). No separate
`art.yml` screen is created.

## Data Flow

```
living-room.yml (layout: menu widget; screensaver: { widget: art, ... })
  → ScreenRenderer → PanelRenderer → menu widget (home menu, stays mounted)
                   → useScreensaver: idle/boot → showOverlay(ArtMode, fullscreen)
                        → ArtMode widget → GET /api/v1/art/featured
                            → ArtAdapter: list art/classic, random pick,
                              read metadata.yaml + image file
                        ← { image, meta }
                        → render: <img art> + frame.png overlay + optional placard
  → any input → swallow first event + dismissOverlay → live home menu revealed
```

## Testing

- **Backend:** unit-test `ArtAdapter`/router — returns a valid `image` path and a
  populated `meta` for a folder that has `metadata.yaml`; errors cleanly when the
  art directory is empty.
- **Frontend (ArtMode):** component test — renders the art `<img>` and the frame
  overlay; shows the placard when `placard` is true and hides it when false; renders
  a black fallback on fetch failure (no thrown error, no white flash).
- **Frontend (screensaver):** unit-test the controller/hook — shows the overlay at
  boot when `showOnLoad`; shows it after `idle` seconds of no activity; resets the
  idle timer on activity; is suppressed while another fullscreen overlay is active;
  dismisses on input and swallows that first event.

## Open Items / Future

- Daily-deterministic selection + recent-pick memory (date-seeded), swapped in behind
  the same `/api/v1/art/featured` endpoint.
- Midnight rollover refresh for long-running displays.
- Screensaver on other screens (the mechanism is generic; only `living-room` is
  configured for now).
