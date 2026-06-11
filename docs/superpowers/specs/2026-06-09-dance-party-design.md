# Dance Party Widget — Design Spec

**Date:** 2026-06-09
**Status:** Approved (brainstorming) — ready for implementation planning
**Surface:** Garage fitness display (fullscreen Firefox kiosk, `/fitness`)

## Overview

A fullscreen "Party Mode" Fitness widget: a looping disco **video** playlist fills the
screen, a music **audio** playlist plays through the existing fitness music wiring, and the
garage **ambient Hue strips** "dance" (smooth color cycle + occasional strobe accents) while
the **main white lights** drop. Everything is **config-driven with graceful fallbacks** — a
missing piece degrades (no video → CSS backdrop; no strips → lights skipped) rather than
breaking the experience.

## Guiding Principle: Config-Driven With Fallback

Follow this pattern everywhere in this feature (and as a general house pattern):

- Read all tunables from a dedicated `dance_party:` config section in `fitness.yml`.
- Every value has a sensible **default** applied in code; absent config never throws.
- Missing capability **degrades gracefully** and logs, it does not crash the widget:
  - No `dance_party` section / `enabled: false` → widget is not offered.
  - No `video_playlist_id` → fall back to an animated CSS disco backdrop (no video layer).
  - No `audio_playlist_id` → fall back to the first entry in `plex.music_playlists`.
  - No `lighting.color_strips` → lighting is skipped (party still runs, logged).
  - No `lighting.white_lights` → white-light dimming is skipped.
  - Missing `accent.*` / `base_effect` → defaults below.

## Components

### 1. Frontend — `DancePartyWidget` (fullscreen orchestrator)

Location: `frontend/src/modules/Fitness/widgets/DancePartyWidget/`

- A fullscreen widget, registered/launched like the other fullscreen Fitness widgets
  (CycleGame, JumpingJackGame) from the Fitness menu/selector.
- Owns the lifecycle: on mount → start party (lights + media); on exit/unmount → stop party
  (restore lights, tear down media).
- Composes three layers:
  - **Video layer** (back): the disco Plex playlist, **muted, looping, shuffled**, rendered
    via the shared `@/modules/Player/Player.jsx`. Falls back to an animated CSS disco
    backdrop when no `video_playlist_id` is configured.
  - **Audio layer**: the music Plex playlist, played through the same mechanism as
    `FitnessMusicPlayer` (shared `Player`, distinct Plex client session, shuffle +
    auto-advance). Extract the reusable audio-playback piece if needed so the dance widget
    and the existing sidebar player share it (DRY) without the dance widget inheriting the
    sidebar's workout-specific UI.
  - **Now-playing bar** (front, composition "B"): a translucent bottom bar showing album
    art + title/artist + transport (⏮ ⏸ ⏭), a **Next** button, and an **exit ✕** in the
    **top-right**. Reuses the presentational `MusicPlayerWidget` shell where practical.

Files (indicative):
- `DancePartyWidget.jsx` — orchestrator (lifecycle, lighting API calls, exit handling).
- `DanceNowPlayingBar.jsx` — the bottom now-playing/transport bar + Next + exit ✕.
- `useDanceLighting.js` — small hook that POSTs start/accent/stop and fires accents on track
  change (debounced by the backend's `min_interval_ms`).
- `DancePartyWidget.scss`.
- `index.jsx`.

Logging: use the structured logging framework (`getLogger().child({ component: 'dance-party' })`)
for lifecycle (mount/exit), media (track change, video fallback), and lighting API
start/accent/stop + failures.

### 2. Backend — `DanceLightingController`

Location: `backend/src/1_adapters/fitness/DanceLightingController.mjs` (sibling to
`AmbientLedAdapter`; **does not** modify the zone-driven adapter).

- Constructed with an `IHomeAutomationGateway` and a `loadFitnessConfig` function (same
  injection style as `AmbientLedAdapter`).
- Reads the `dance_party.lighting` config (with fallbacks) per call.
- Methods:
  - `start(householdId)` — `light.turn_off` the `white_lights`; `light.turn_on` the
    `color_strips` with `{ effect: base_effect }` (default `colorloop` — the Hue bridge runs
    the smooth cycle locally, no call-storm).
  - `accent(householdId)` — a short strobe pop on the `color_strips`
    (`light.turn_on { flash: 'short' }` by default; `mode` configurable: `flash`/`breathe`/
    `blink`). **Rate-capped**: ignores calls within `min_interval_ms` of the last accent
    (default 4000ms) and re-asserts `base_effect` afterward so colorloop resumes.
  - `stop(householdId)` — restore simple: `light.turn_on` the `white_lights`,
    `light.turn_off` the `color_strips`. (No prior-state snapshot — confirmed simple restore.)
- Reuses the resilience posture worth keeping from `AmbientLedAdapter`: a small failure
  counter / circuit-breaker so a flaky HA call can't wedge the party, and structured metrics
  (`start/accent/stop/failure` counts). Keep it lean — this is not zone-sync.

### 3. API — fitness router

Location: `backend/src/4_api/v1/routers/fitness.mjs`

- `POST /api/v1/fitness/dance/start`
- `POST /api/v1/fitness/dance/accent`
- `POST /api/v1/fitness/dance/stop`

Each resolves `householdId` and delegates to the controller. Responses mirror the
adapter's `{ ok, skipped?, reason?, ... }` shape. When lighting is unconfigured, endpoints
return `{ ok: true, skipped: true, reason: 'lighting_not_configured' }` (graceful no-op).

### 4. Config — `dance_party:` in `fitness.yml`

```yaml
dance_party:
  enabled: true
  audio_playlist_id: 463801          # Plex music playlist (fallback: first plex.music_playlists)
  video_playlist_id: 0               # Plex disco-visual playlist (fallback: CSS disco backdrop)
  shuffle: true
  strobe_bpm: 60                     # strobe beat fallback (default 60); live BPM detection from the music overrides it once locked
  lighting:
    color_strips:                    # colorloop + strobe targets (fallback: [] → lighting skipped)
      - light.garage_ceiling_led_strip
      - light.garage_front_led_strip
      - light.garage_north_night_light
      - light.garage_south_night_light
    white_lights:                    # off during party, restored on exit (fallback: [] → skip)
      - light.garage_light_switch
    base_effect: colorloop           # fallback: colorloop
    bpm_entity: input_number.garage_party_bpm  # HA input_number mirroring live music BPM (fallback: none → skipped)
    bpm_min_interval_ms: 2000        # server-side rate cap on set_value (fallback: 2000)
    accent:
      mode: flash                    # flash | breathe | blink (fallback: flash)
      on_track_change: true          # fallback: true
      interval_ms: 20000             # periodic accent cadence (fallback: 20000; 0 disables periodic)
      min_interval_ms: 4000          # safety floor between accents (fallback: 4000)
```

## Data Flow

1. User launches Dance Party from the Fitness menu → `DancePartyWidget` mounts.
2. Widget reads config (via the fitness context / API it already uses), resolves playlists
   with fallbacks, starts the video (muted/looping/shuffled) and audio (shuffled) layers.
3. `useDanceLighting` POSTs `/dance/start` → controller drops white lights + starts colorloop.
4. On each audio **track change** (and every `interval_ms`), the hook POSTs `/dance/accent`
   → controller fires a rate-capped strobe pop, then re-asserts colorloop.
5. User taps **✕** (or Back/Esc, or navigates away) → widget unmounts → POST `/dance/stop`
   → controller restores white lights on, strips off; media torn down.

## Error Handling & Edge Cases

- **Lighting failures** never affect playback: API calls are fire-and-forget from the
  widget's perspective; failures are logged and the controller's circuit-breaker prevents
  hammering HA.
- **Guaranteed stop:** the stop call fires on the React unmount cleanup (not only the ✕
  handler), so any exit path (navigation, crash-to-menu, reload) restores the lights. As a
  backstop, document that `/dance/stop` is idempotent and safe to call when not started.
- **Video unavailable / playlist empty:** fall back to the CSS disco backdrop; the party
  continues with audio + lights.
- **Audio unavailable:** show the now-playing bar in an error/empty state (reuse the music
  player's existing error formatting) but keep video + lights running.
- **Accent storm:** the `min_interval_ms` floor in the controller is the single source of
  truth for rate-limiting; the frontend may call freely on every track change.

## Testing Strategy (vitest)

- **`DanceLightingController`** (unit, mock gateway):
  - `start` calls `turn_off(white_lights)` + `turn_on(color_strips, { effect })`.
  - `accent` fires a flash, and a second `accent` within `min_interval_ms` is skipped.
  - `stop` calls `turn_on(white_lights)` + `turn_off(color_strips)`.
  - Missing/empty config → graceful skip (no gateway calls, `{ skipped: true }`).
  - Fallback defaults applied (base_effect, accent mode/intervals).
- **Config resolution helper** (pure): defaults + fallbacks for playlist ids, strips, accent.
- **Frontend** (component/hook): lifecycle posts start on mount and stop on unmount; track
  change triggers an accent; no-video config renders the CSS backdrop.

## Out of Scope (YAGNI)

- True beat/BPM-synced lighting (HA latency + no beat feed make tight sync impractical).
- Prior-light-state snapshot/restore (simple restore confirmed).
- Multi-room / non-garage lighting.
- External NFC/button trigger (can layer on the menu launch later).

## File Structure Summary

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `frontend/src/modules/Fitness/widgets/DancePartyWidget/DancePartyWidget.jsx` | Fullscreen orchestrator + lifecycle | Create |
| `.../DancePartyWidget/DanceNowPlayingBar.jsx` | Now-playing bar + Next + exit ✕ | Create |
| `.../DancePartyWidget/useDanceLighting.js` | start/accent/stop API + accent triggers | Create |
| `.../DancePartyWidget/DancePartyWidget.scss` + `index.jsx` | Styles + export | Create |
| Reusable audio-playback piece from `FitnessMusicPlayer` | Shared audio engine (extract if needed) | Modify/Extract |
| Fitness menu/selector registration | Launch entry for the widget | Modify |
| `backend/src/1_adapters/fitness/DanceLightingController.mjs` | HA lighting control (start/accent/stop) | Create |
| `backend/src/4_api/v1/routers/fitness.mjs` | `/dance/{start,accent,stop}` endpoints | Modify |
| `data/household/config/fitness.yml` | `dance_party:` section (in-container) | Modify |
