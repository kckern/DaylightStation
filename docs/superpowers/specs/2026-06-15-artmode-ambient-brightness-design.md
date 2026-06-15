# ArtMode Ambient Brightness — Design

**Date:** 2026-06-15
**Status:** Approved design, ready for implementation plan

## Purpose

ArtMode is an ambient screensaver — it should never blast light. Make it track the
room: **bright room → brighter (but still restrained); dark room → very dim** so it
barely registers as a glowing screen. Driven by Home Assistant illuminance sensors.

## Scope

- ArtMode only — reuses its existing `.artmode__dim` black overlay (no screen-wide
  dimming layer in this work).
- Sensors: **max** of `sensor.kitchen_desk_nightlight_illuminance` and
  `sensor.kitchen_night_light_illuminance` (lux), both configurable.

Deferred: whole-screen ambient dimming (player/menu); per-time-of-day curves.

## Architecture

```
HA (illuminance sensors) --websocket--> backend AmbientLight listener
   → max(lux) → eventbus broadcast topic "ambient" {lux, sources}
      → frontend useWebSocketSubscription('ambient')
         → luxToDim(lux, curve) + manual bias → ArtMode .artmode__dim opacity
```

## Backend — ambient lux listener (new)

There is **no HA websocket client today** (HA is REST-only via `HomeAssistantAdapter`).
Add a small HA-websocket listener service (home-automation application layer):

- Connect to `ws://<ha-host>/api/websocket` (host/token from the existing HA
  integration config — same long-lived token the REST adapter uses).
- Handshake: receive `auth_required` → send `{ type: 'auth', access_token }` → on
  `auth_ok`, send `{ id, type: 'subscribe_events', event_type: 'state_changed' }`.
- On each `state_changed` for a configured entity, update a cached `{ entity: lux }`
  map, compute `max` across the configured entities, and **broadcast on the eventbus**
  topic `ambient` with `{ lux, sources: { <entity>: <lux> } }`. Ignore non-numeric /
  `unavailable` states (keep the last good value for that entity).
- Throttle broadcasts to at most ~once/2s and only when the max changes meaningfully
  (≥1 lux), to avoid chatter.
- Reconnect with exponential backoff (1s→30s cap) on close/error; re-auth + re-subscribe.
- On startup, also fetch initial states via the REST adapter so a value is broadcast
  immediately (don't wait for the first change event).

Config (`data/household/config/ambient.yml`):

```yaml
illuminance:
  entities:
    - sensor.kitchen_desk_nightlight_illuminance
    - sensor.kitchen_night_light_illuminance
  topic: ambient        # eventbus topic to broadcast on
```

If the config is absent or empty, the listener does nothing (feature off).

## Frontend — ArtMode maps lux → dim

ArtMode subscribes to the `ambient` topic (`useWebSocketSubscription`). Each message's
`lux` is mapped to the dim-overlay opacity by a **piecewise-linear curve** of control
points, then combined with the manual bias:

```
autoDim   = luxToDim(lux, curve)
finalDim  = clamp(autoDim + manualBias, 0, 0.85)
```

- `.artmode__dim` keeps the black overlay; its CSS transition is slowed to ~1.5s so
  ambient changes glide (no flicker).
- Before the first `ambient` message arrives, `autoDim` uses a configured default lux
  (so the screen opens at a sensible dim, not 0).

### `luxToDim(lux, curve)` — pure helper

`curve` is an array of `{ lux, dim }` points sorted ascending by `lux`:
- `lux ≤ curve[0].lux` → `curve[0].dim` (clamp low).
- `lux ≥ curve[last].lux` → `curve[last].dim` (clamp high).
- otherwise linear-interpolate `dim` between the two bracketing points.
- Each point's `dim` clamped to `[0, 0.85]`; result clamped likewise.
- Degenerate input (empty curve) → a safe default (e.g., 0.4).

The curve is monotonic decreasing in practice (more lux → less dim) but the helper
makes no such assumption.

## Manual nudge interplay

Up/Down adjust a `manualBias` (Up −0.1, Down +0.1, clamped so `finalDim` stays in
`[0, 0.85]`) added on top of `autoDim`. Auto keeps tracking the room from that offset.
Bias resets when ArtMode remounts (per showing).

## Config summary

- **Backend** `data/household/config/ambient.yml`: illuminance entity ids + eventbus topic.
- **Frontend** `screensaver.props.ambient`:

```yaml
ambient:
  defaultLux: 80          # assumed lux until the first reading arrives
  curve:
    - { lux: 0,   dim: 0.92 }   # pitch dark → barely glowing
    - { lux: 5,   dim: 0.85 }
    - { lux: 40,  dim: 0.55 }
    - { lux: 150, dim: 0.32 }   # lit room
    - { lux: 400, dim: 0.15 }   # daylight → brightest (still ambient-restrained)
```

If `ambient`/`curve` is absent, ArtMode ignores `ambient` messages and keeps the
manual-only behavior (backward compatible).

## Error handling

- HA WS down → reconnect with backoff; last broadcast value persists on the frontend.
- Non-numeric/unavailable sensor state → ignored (last good value retained).
- No `ambient` config → backend listener inert; frontend falls back to manual dim.

## Testing

- **Backend (unit):** max-of-two across cached entity readings; ignores non-numeric
  states; throttle suppresses sub-threshold/again-same broadcasts; the HA-frame handler
  (auth_ok → subscribe; state_changed → broadcast) given mocked frames; reconnect
  schedules backoff on close.
- **Frontend (pure):** `luxToDim` — clamps below first / above last point; interpolates
  midpoints; clamps dim to [0, 0.85]; safe default on empty curve.
- **Frontend (component):** an `ambient` WS message sets the dim overlay opacity per the
  curve; a manual Up/Down press biases it; absent curve config → message ignored.

## Open Items / Future

- Whole-screen ambient dimming; time-of-day or per-room curves; smoothing via EMA if
  raw sensors prove jittery.
