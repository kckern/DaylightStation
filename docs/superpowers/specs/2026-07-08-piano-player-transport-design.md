# Piano kiosk video Player — transport UX + guaranteed stop

**Date:** 2026-07-08
**Area:** `frontend/src/modules/Piano/PianoKiosk/modes/Videos/` (PianoVideoPlayer, PianoVideoChrome, useResolvedMediaEl) — piano path only
**Status:** Design approved — ready for implementation plan

---

## Problem

Two coupled defects in the piano-kiosk video Player:

1. **Tap does the wrong thing.** Tapping the video toggles browser **fullscreen** (`PianoVideoPlayer.jsx:212` wrapper `onClick={toggleFullscreen}`). On a practice kiosk the overwhelmingly common need is **pause** (and looping a passage), not fullscreen.
2. **A video can keep playing with no way to stop it.** When the FKB screen sleeps then wakes and the app returns to the menu, audio keeps playing with no transport bound to it. Root cause is a two-fault chain (confirmed by code investigation):
   - **Stale `playing`:** `PianoVideoPlayer` binds `play`/`pause` listeners to a media element resolved **once** by `useResolvedMediaEl` (deps never change). When the Player's resilience layer swaps the underlying `<video>` (soft-reinit / remount), the listeners stay on the dead element → `playing` latches false while the new element emits audio.
   - **No stop on unmount:** with `playing` false, `useInactivityReturn` navigates to the menu (unmounts the Player). The only unmount pause path is `cleanupDashElement`, which **no-ops for a native `<video>`** (it only pauses shadow-DOM `<dash-video>`). React detaches the element; a detached `HTMLMediaElement` keeps playing.

## Decisions (locked)

- **Tap video = play/pause** (`ctrl.toggle()`); fullscreen leaves the tap.
- **Fullscreen becomes a button** in the chrome bar (reusing the existing `toggleFullscreen`).
- **Paused = an overlay loop cluster** over the dimmed video: large **−30 / −15 / ▶ / +15 / +30** controls; tapping the video (or ▶) resumes. Shown only while paused.
- **Skip set: −30 / −15 / +15 / +30.**
- **Safety fix scoped to the piano path only** (no change to the shared Player engine / `cleanupDashElement`, which the TV and other surfaces depend on).

## Design

### A. Transport UX
- Move `toggleFullscreen` off the video wrapper's `onClick`; wire the wrapper tap to `ctrl.toggle()` (play/pause). Guard so a tap that lands on the paused overlay's buttons doesn't double-fire.
- Add a **Fullscreen button** to `PianoVideoChrome` (calls a passed `onToggleFullscreen`).
- Extend the skip controls to **−30 / −15 / +15 / +30**. `handleSkip(delta)` already exists (`PianoVideoPlayer.jsx:176`, reads `getCurrentTime()` and seeks to the clamped sum); the chrome already has −15/+15 — add −30/+30.
- New **`PausedLoopOverlay`** component, rendered inside the video wrapper when `!isPlaying`: dims the video, shows the −30/−15/▶/+15/+30 cluster (large touch targets, per the no-sliders touch-UI rule), calls `onSkip(delta)` and `onResume` (= `ctrl.toggle()`).

### B. Guaranteed stop (bug fix)
- **Unmount pause (primary safety net):** in `PianoVideoPlayer`, an unmount cleanup that unconditionally pauses/releases the media — `ctrl.pause()` and `getMediaElement()?.pause()` — so leaving the route always silences audio, regardless of `playing` state or element type. This directly kills the reported symptom.
- **Accurate `playing` (root cause):** make `useResolvedMediaEl` / the `playing`-listener binding **re-resolve and re-bind when the media element identity changes** (mirror the engine's `elementGeneration` idea) so `playing` tracks the live element. This keeps `useInactivityReturn`/`keepAlive` from prematurely navigating away while a video is actually playing.

## Component/among-file map (piano path only)

| File | Change |
|---|---|
| `PianoVideoPlayer.jsx` | tap→`ctrl.toggle`; pass `onToggleFullscreen` to chrome; add −30/+30 wiring; render `PausedLoopOverlay` when paused; unmount pause cleanup; consume a re-binding `playing`. |
| `PianoVideoChrome.jsx` | add Fullscreen button; add −30/+30 skip buttons. |
| `PausedLoopOverlay.jsx` | NEW — dimmed overlay + big loop cluster. |
| `useResolvedMediaEl.js` | re-resolve/re-emit on element identity change (so listeners rebind). |

## Out of scope (YAGNI)
- No change to the shared Player engine (`Player.jsx`, `VideoPlayer.jsx`, `dashCleanup.js`, `useCommonMediaController.js`) — the fix is fully in the piano path.
- No change to the A-B loop, rate, or mix controls (already present).
- The subcourses drill-in redesign (separate branch, held).

## Testing
- Unit/component: tapping the video toggles play/pause (not fullscreen); fullscreen button calls the fullscreen handler; skip buttons call `onSkip` with −30/−15/+15/+30; paused overlay renders only when paused and its controls fire resume/skip; unmounting `PianoVideoPlayer` calls pause on the media element (assert via a mock player handle); `useResolvedMediaEl` re-emits when the element identity changes.
- On-device (manual, hold for word): play a lecture → sleep/wake the screen → confirm audio stops when returning to menu and never strands; tap to pause; loop with −15/−30.

## Reference (investigation, 2026-07-08)
- Tap→fullscreen: `PianoVideoPlayer.jsx:111-118, 212`. Transport bar (already persistent): `PianoVideoChrome.jsx` (play/pause `:53`, −15 `:52`, +15 `:54`, restart `:49`, scrubber `:43-47`, rate `:57`, A-B `:59-64`). Controller: `modules/Player/usePlayerController.js:8-31` (`play/pause/toggle/seek/getCurrentTime/getDuration`). `handleSkip`: `PianoVideoPlayer.jsx:176-180`. `playing` binding: `PianoVideoPlayer.jsx:142-166` on a once-resolved `useResolvedMediaEl` (`useResolvedMediaEl.js:15-28`). Unmount pause gap: `cleanupDashElement` (`modules/Player/lib/dashCleanup.js:24-25`) returns before pause for native `<video>`. Menu navigation on inactivity: `useInactivityReturn` via `Apps/PianoApp.jsx:215-221`, gated on `playing`.
