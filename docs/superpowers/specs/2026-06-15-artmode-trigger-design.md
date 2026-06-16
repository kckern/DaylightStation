# Triggered ArtMode Scene (via `display`) — Design

**Date:** 2026-06-15
**Status:** Approved design, ready for implementation plan

## Context

**Sub-project 3 of 4** in the ArtMode rework. Sub-project 1 (collections) and 2
(presets + config extraction) are shipped. This adds the ability to **trigger** an
ArtMode presentation — a preset, with music — onto a screen via the device load API,
distinct from the silent passive screensaver.

## Orientation (decided)

ArtMode is a **category-3 OS/shell scene** — the screen-framework screensaver surface
(splash / lock / screensaver). It is **not**:
- an AppContainer app (category 1: Webcam, WeeklyReview, `open=`, `APP_REGISTRY`), nor
- a Player content renderer (category 2: SlideShow / SingalongScroller, `media:queue`,
  the format→renderer registry, `contentRenderers.jsx`).

So triggering ArtMode means **imperatively engaging the screensaver scene** with a
chosen preset — not playing a content item and not opening an app. ArtMode stays in
`frontend/src/screen-framework/widgets/ArtMode.jsx`; the passive screensaver and the
triggered scene are the same widget with different presets.

## Dispatch verb: `display`

The trigger uses the existing **`display`** autoplay verb (the "put a visual on the
screen" channel / `displayable` capability) — not a bespoke param. `display=` already
parses (`parseAutoplayParams` → `{ display: { id } }`) and `ScreenAutoplay` already
emits `bus.emit('display:content', { id })`. That action currently has **no handler**
(`ScreenActionHandler` handles `display:overlay/volume/shader/sleep` and `media:*`, but
nothing consumes `display:content`). This sub-project wires the handler for `art:`
scene ids. The content id is `art:<preset>` — a **scene/preset reference**, resolved by
the sub-project-2 `presetResolver` from `artmode.yml`.

## Dispatch flow

```
GET /api/v1/device/livingroom-tv/load?display=art:classical-evening
  → WakeAndLoadService forwards the query unchanged
  → FullyKioskContentAdapter loads  /screen/living-room?display=art:classical-evening
  → ScreenAutoplay parses display=  →  bus.emit('display:content', { id: 'art:classical-evening' })
  → display:content handler: id starts with 'art:'
       →  GET /api/v1/art/preset/classical-evening  →  { collection, music, frame, ambient, ... }
  → ScreenScreensaver engages the ArtMode scene with those override props (foreground, with music)
```

No load-API code change is required — `display` is already forwarded to the screen URL.

## Components

### Backend — preset props endpoint

`GET /api/v1/art/preset/:key` → the resolved props for a named preset:
`resolvePreset(presets, key)` (reuses sub-project 2), reading `artmode.yml` **fresh per
request** (consistent with the screens router). Unknown key → `404`. This is the
frontend's way to turn an `art:<preset>` scene id into ArtMode props.

### Frontend — `display:content` handler for `art:` scenes

`ScreenScreensaver` (the controller that owns the screensaver overlay) subscribes to the
`display:content` action. When the payload `id` matches `art:<preset>`:
1. fetch `GET /api/v1/art/preset/<preset>`,
2. on success, engage the ArtMode scene immediately with the fetched props as
   **override props** (instead of the default `config.props`),
3. on 404 / fetch failure, log and do nothing (the screen stays on the menu/default).

Non-`art:` `display:content` ids are ignored here (left for a future Player/slideshow
path — generic `display` is out of scope).

### Frontend — `ScreenScreensaver` override-props engagement

Today `ScreenScreensaver` shows its widget from the static `config.props` (the default
`gallery-silent` preset) on idle/boot. Add an imperative path: "engage now with these
override props." The override applies to the single triggered showing; the default
`config.props` remains the source for idle/boot showings.

## Behavior — one-shot (decided)

A `display=art:<preset>` dispatch engages scene X **immediately, once** (with music).
On exit/dismiss (the widget's own onExit, or any input in non-interactive mode), the
screensaver closes and the **idle timer resumes the default** `gallery-silent` for
subsequent idle showings. The dispatched preset is **not** sticky — it does not become
the new default. (Matches "dispatch it like playing a video.")

## Error handling

- Unknown preset (`404` from the endpoint) → handler logs `artmode.scene.unknown` and
  engages nothing.
- A `display=art:<preset>` device load carries no `queue`/`open` content; the wake/load
  cycle (power → verify → volume → prepare → load) must still complete and navigate the
  kiosk to the screen URL. Verified live (prewarm is skipped when there's no `queue`).
- Fetch failure (backend down) → handler logs and no-ops; the passive screensaver still
  works on idle.

## Out of scope

- Generic `display:content` for arbitrary image/canvas ids (Player/slideshow path).
- Sticky / persistent scene selection (one-shot only).
- Menu-launching ArtMode and the broader registry question (sub-project 4) — though a
  menu entry could simply emit the same `display:content` `art:<preset>`.

## Testing

- **Backend** `GET /api/v1/art/preset/:key`: known key → resolved props (matches
  `resolvePreset`); unknown key → 404. (Reads a fixture `artmode.yml`.)
- **Frontend** `display:content` handler: an `art:<preset>` payload triggers a fetch of
  `/api/v1/art/preset/<preset>` and engages the screensaver scene with the returned
  props; a non-`art:` payload is ignored; a 404/failed fetch engages nothing.
- **`ScreenScreensaver`**: engaging with override props shows the ArtMode widget with
  those props (e.g. the music preset), distinct from the default `config.props`.
- **Live** (post-deploy): `GET /api/v1/device/livingroom-tv/load?display=art:classical-evening`
  wakes the TV and shows framed art **with** the classical music; idle afterward returns
  to the silent `gallery-silent` screensaver.

Run unit specs via `./node_modules/.bin/vitest run --config vitest.config.mjs <file>`.
