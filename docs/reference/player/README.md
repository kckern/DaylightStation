# Player Subsystem

The Player is the shared media-playback engine behind every surface that plays
video, audio, slideshows, or ambient music — the fitness display, the living-room
TV, kiosk screens, ArtMode, and the interactive MediaApp. It takes a resolved
playable (a URL plus metadata) and is responsible for getting pixels and sound on
screen and **keeping them there** through transcode warmup, dead sessions, dropped
frames, network blips, autoplay blocks, and stalls — without an operator touching
anything.

**Depends on:** Plex transcode proxy (`/api/v1/proxy/plex/*`), the queue API
(`/api/v1/queue`), the structured logging framework, and `dash-video-element`
(the `<dash-video>` web component wrapping dash.js).

---

## How It Fits

```
Resolved playable (url + meta)
        │
        ▼
Player.jsx ──────────────── resilience orchestration (overlays, remount, recovery)
        │
        ▼
SinglePlayer ───── picks a renderer by mediaType
        │
   ┌────┴───────────┬──────────────┬───────────────┐
   ▼                ▼              ▼               ▼
VideoPlayer     AudioPlayer    SlideShow       RemuxPlayer
(<dash-video>   (<audio>)      (images)        (MSE remux)
 / <video>)
        │
        ▼
useCommonMediaController ── DOM access, transport, seek, stall state, quality
        │
        ▼
useMediaResilience ── recovery state machine ── usePlaybackHealth (telemetry)
```

The controller hook owns the imperative side (the media element, seeking,
transport, quality sampling). The resilience hook sits above it as a state
machine that watches health telemetry and escalates to progressively more
destructive recoveries. `Player.jsx` is the conductor: it holds resilience state,
renders overlays, and decides when to remount the renderer.

---

## Two directories, two responsibilities

The Player code lives in two places. They are not duplicates — one is the engine,
the other is a small kit of pure/leaf helpers consumed by it and by ArtMode.

### `frontend/src/modules/Player/` — the engine

This is the real subsystem: the entry component, the renderers, the controller and
resilience hooks, and the recovery library.

| Area | Role |
|------|------|
| `Player.jsx` | Entry point + resilience conductor. Holds playback metrics, registers media accessors, drives overlays, owns the remount hammer. |
| `renderers/VideoPlayer.jsx` | Renders `<dash-video>` (Plex DASH) or `<video>` (files). Wires dash.js diagnostics, the stale-session watchdog, dash-error recovery, autoplay-block detection, and `hardReset`. |
| `renderers/AudioPlayer.jsx`, `SlideShow.jsx`, `RemuxPlayer.jsx` | Audio, image slideshow, and MSE-remux renderers. |
| `hooks/useCommonMediaController.js` | The imperative core: DOM/shadow-DOM element access, transport API, seek-to-offset, stall detection, quality/dropped-frame sampling, keyboard. |
| `hooks/useMediaResilience.js` | Recovery state machine. Maps health signals → reload requests → overlay props. |
| `hooks/usePlaybackHealth.js` | Telemetry source — progress tokens, element signals, frame info that the state machine resets timers against. |
| `lib/` | Recovery primitives: stale-session watchdog, dash-error recovery decision, dash cleanup, stall verdict, end-of-content / close watchdogs, seek trace, playback logger. |
| `utils/` | Cross-cutting helpers: media identity, pause arbiter, telemetry. |
| `components/` | Overlays (loading, paused), progress bar, quality readout. |

See `frontend/src/modules/Player/README.md` and
`frontend/src/modules/Player/hooks/README.md` for the in-tree control-flow
diagrams, and `README.media-resilience.md` for the resilience change log.

### `frontend/src/lib/Player/` — leaf helpers

Small, mostly pure modules with no resilience concerns. Used by the engine and by
ArtMode's ambient-music feature.

| File | Role |
|------|------|
| `mediaTransportAdapter.js` | Normalizes a media element / controller into a uniform transport (play, pause, seek, volume) with clamping. |
| `useMediaKeyboardHandler.js` | Keyboard-shortcut handler (delegates to the central keyboard manager; legacy seam). |
| `useBackgroundMusic.js` + `playlist.js` | Config-driven ambient audio for ArtMode — resolves a queue, drives a hidden `<audio>`, advances/loops/skips, exposes the current track for the on-frame music plaque. |
| `useCenterByWidest.js`, `useDynamicDimensions.js` | Layout/measurement hooks for text and dynamic sizing. |

---

## Resilience layers

Playback resilience is defense-in-depth: several independent watchdogs, each
tuned to a different failure mode, escalating from cheap in-place fixes to a full
remount and finally to an operator-facing retry surface.

### The shared recovery ledger

Since Milestone B (2026-07) there is exactly **one recovery accounting
authority**: `lib/recoveryLedger.js`, a session-scoped ledger shared by every
actuator. Its budget model:

- **Session cap 5** (`RECOVERY_MAX_ATTEMPTS`) — total recovery attempts across
  all actors for one playback session; hitting it drives the `exhausted`
  overlay.
- **Cooldown with backoff** — 4s × 3ⁿ between attempts, anchored at the first
  retry (attempt 2 waits 4s, attempt 3 waits 12s, …). Denied callers get a
  `waitMs` they can reschedule against.
- **Per-mount sub-budget** — dash-error URL refreshes get 3 attempts per mount
  (a remount mints a new Plex session, so that actor earns a fresh sub-budget,
  but every attempt still counts toward the session cap).
- **`recordSuccess`** — real playback progress resets the ledger, so a
  recovered session gets its full budget back.

Every actuator asks the ledger before acting: the resilience state machine's
startup/warmup deadlines, the stall-jolt rungs, VideoPlayer's dash-error
resets, the user-facing forceReload, and the controller's nudge and
duration-lost softReinit (softReinit bypasses the cooldown but is still
cap-bounded). No actuator retries outside the ledger's accounting.

### The layers

| Layer | Watches for | Response |
|-------|-------------|----------|
| **Transcode warmup** | Consecutive 0-byte / empty segments while Plex spins up its encoder | Emits `transcodewarming` / `transcodewarmed`; the loading overlay stays up instead of failing |
| **Stale-session watchdog** | `dash.error` code-28 bursts (3 within 10s) — MPD points at a dead Plex session | Escalates `stale-session-detected` before the startup deadline fires |
| **Dash-error recovery** | `dash.error` 27 (segment unavailable) / 28 (manifest/init unavailable) | `hardReset({ refreshUrl: true })` — cache-busts the `src` so the proxy mints a fresh transcode session. Ledger-gated: 3 per mount, counts toward the session cap |
| **Controller stall detection + nudge** | Soft/hard stall timers on the media element | Detection lives in `useCommonMediaController`; its only in-place actuator is a ledger-gated **nudge** (±1ms seek to kick the buffer). If the nudge is denied or fails, escalation belongs to the resilience jolt ladder — the controller has no ladder of its own |
| **Duration-lost softReinit** | Stalled with `duration` gone (dead pipeline) | Ledger-gated soft reinit of the dash element (cooldown-bypassed, cap-bounded) |
| **Resilience jolt ladder** | Unrecovered stall past the grace deadline | Rung 1: `hardReset({ refreshUrl })` in place → rung 2: full renderer remount. Each rung asks the ledger; a cooldown denial reschedules the rung at `waitMs` |
| **Stall exhaustion** | Session cap reached | Enters `exhausted`, renders the retry button; `retryFromExhausted` resets the ledger and restarts |
| **User forceReload** | Operator reload request | Records a ledger attempt like everything else — reload-hammering lands on the exhausted overlay (which still offers retry) instead of looping raw reloads |
| **Autoplay block** | Browser `NotAllowedError` (Firefox won't fire `canplay`) | Click-to-play overlay; resumes from a user gesture |
| **End-of-content / close / stale-session watchdogs** | Natural end, manual close, abandoned sessions | Clean teardown (`dashCleanup`) to prevent SourceBuffer orphans |

> 2026-07-09: the Shaka-era "buffer resilience" layer (`useBufferResilience`/`BufferResilienceManager`) was removed as dead code — it was never mounted after the move to dash.js; the live 0-byte detector is VideoPlayer's transcode-warmup emitter. The unreachable quality/ABR engine and `stallConfig` strategy-override machinery were removed at the same time (see `docs/_wip/audits/2026-07-09-player-module-sedimentary-fixes-audit.md` §4).
>
> 2026-07-09 (Milestone B): the controller's private `_recoveryTracker` and VideoPlayer's `dashErrorRefreshAttemptsRef` were replaced by the shared `recoveryLedger`; the controller's internal escalation ladder was demoted to detection + nudge/softReinit, with all escalation owned by the resilience jolt ladder. See the audit's §8 Phase 1 DONE note for the behavior-change register.

**The loading/buffering spinner never sits over visibly-playing video.** The health
layer samples the media clock directly and exposes an *advancing* signal — whether
`currentTime` actually moved forward between samples while not paused or ended. That
signal is the authority for "it's really playing": any lingering `waiting` /
`buffering` flag (e.g. a `waiting` event whose matching `playing` was missed because
a recovery swapped the element out) is treated as stale and suppressed while frames
advance. The clock poll is self-contained, so it keeps reporting the truth even when
the metrics bridge goes quiet during a stall — exactly when the spinner decision
matters most.

The escalation ladder is deliberate: nudge in place → refresh the URL in place
(jolt rung 1) → remount the renderer at the last known position (jolt rung 2) →
operator retry from the exhausted overlay. Each step is more disruptive than
the last, the ledger paces every climb, and real progress (`recordSuccess`)
resets the whole budget.

---

## Diagnostics

The renderer emits structured `dash.*` and `playback.*` events through the logging
framework — they are the primary tool for diagnosing a stall. Key events:

| Event | Meaning |
|-------|---------|
| `dash.buffer-level` | Sampled buffer depth per track (10% sample) |
| `dash.fragment-loading` / `dash.fragment-loaded` | Per-segment fetch start/finish + byte count |
| `dash.transcode-warming` / `dash.transcode-warmed` | Encoder behind / caught up |
| `dash.playback-stalled`, `dash.waiting` | Rendering stalled / starved |
| `dash.error` | dash.js error with code (27/28 = dead session) |
| `playback.video-ready` | First frame painted |
| `playback.fps_stats` | Periodic dropped-frame / fps snapshot |
| `playback.stale-session-detected` | Stale-session watchdog tripped |
| `playback.stream-url-refreshed` | `src` cache-busted, fresh session requested |

A buffer that drains to zero on **both** audio and video together, with
~one-segment depth and ~1.5s segment fetches, is the encode-bound signature — see
the encoding-resilience doc.

---

## Related docs

- `docs/reference/player/playback-encoding-resilience.md` — Plex transcode decision pipeline, native-60fps direct-stream fix, MSE codec constraints
- `docs/reference/player/hardware-decoding.md` — GPU decode/encode offload, the AMD Cezanne AV1-decode boundary, and a benchmark plan for SW vs HW transcode
- `docs/reference/player/lessons-and-gotchas.md` — recurring failure modes, breakthroughs, and traps mined from audits/bugs/plans + git history (read before changing Player code)
- `docs/reference/media/dash-video-resilience.md` — stall/seek troubleshooting runbook (warmup, recovery seek, stale sessions)
- `docs/reference/content/content-playback.md` — content resolution → playable → stream URL
- `docs/runbooks/fitness-player-recovery.md` — operator-facing recovery troubleshooting
- In-tree: `frontend/src/modules/Player/README.md`, `hooks/README.md`, `README.media-resilience.md`
