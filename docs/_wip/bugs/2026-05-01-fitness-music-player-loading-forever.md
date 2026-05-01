# 2026-05-01 — Fitness music player stuck on "Loading…" forever

## Symptom

The fitness sidebar music player displays "Loading…" indefinitely and never starts playing audio. User reports it has been observed:

- During a fitness module program (specifically the "10 minute muscle program" workout)
- Sometimes on the FitnessChart screen (the end-of-episode summary chart)

## Evidence (production logs, 2026-05-01)

`PlayerOverlayLoading` emits `playback.overlay-summary` with `status:Starting…` continuously for hundreds of seconds on a single `waitKey`, never transitioning to `ready` / `playing`:

```
waitKey:0083c74f4b status:Starting… vis:613651ms/0ms ... vis:651730ms/0ms (no progress)
waitKey:0037af097a status:Starting… vis:0ms/0ms      ... vis:10003ms/0ms  (new instance, also stuck)
```

The second value of the `vis:X/Y` pair is the elapsed *playable* time — it stays at `0ms` while the wall-clock side grows. Multiple `waitKey` values appear, suggesting the Player remounts or re-arms but never gets media to a playable state.

## Why the UI says "Loading…"

`frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx:535`

```jsx
{currentTrack?.title || currentTrack?.label || 'Loading...'}
```

`currentTrack` is set by `handleProgress(progressData)` on line 227, which fires only when the underlying `<Player>` component reports progress. If the Player is stuck in its "Starting…" startup phase, `onProgress` never fires, `currentTrack` stays `null`, and the UI shows the placeholder forever.

## Likely root cause direction (needs verification)

Loading is gated upstream of `FitnessMusicPlayer` — inside `Player.jsx` / `useQueueController.js`. The music player passes:

```js
queue = { contentId: `plex:${selectedPlaylistId}`, plex: selectedPlaylistId, shuffle: true }
```

If the Plex playlist resolve hangs, returns an empty queue, or the resilience-reload loop in `Player.jsx` ~L554+ keeps remounting the media element before it becomes ready, we end up in this exact "Starting forever / vis:0ms" pattern.

Suspected investigations to run:

1. Add a warn/error log path in `useQueueController` when the playlist resolve takes longer than N seconds, including the playlist id and HTTP response status.
2. Check Plex API response for the playlists used during the 10-minute muscle program — was the playlist non-empty at the time?
3. Check the Player resilience state — `onResilienceState` callbacks and `forceSinglePlayerRemount` calls in `Player.jsx`. If we see repeated remount triggers without `playback.video-ready`, that is the loop.
4. Confirm whether `selectedPlaylistId` is changing under the player while it's still loading (would explain new `waitKey`s).

## Why "sometimes on fitness chart"

The music player lives in `FitnessSidebar` and stays mounted across the chart-overlay state — when `showChart` is true, the chart renders *over* the player but the music player is still alive in the DOM. So a music player that got stuck during the workout will continue to display "Loading…" once the chart appears. This is the same bug, just the user noticing it on a different screen.

## Files involved

- `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx` (display + queue prop)
- `frontend/src/modules/Player/Player.jsx` (startup / resilience)
- `frontend/src/modules/Player/hooks/useQueueController.js` (queue resolve)
- `frontend/src/modules/Player/components/PlayerOverlayLoading.*` (the Starting… overlay)

## Repro / mitigation candidates (do NOT apply blind)

- Add a startup timeout in `useQueueController` — after N seconds in "Starting…", force a reload of the playlist (different from current resilience-reload path) and log the failure.
- Surface the loading failure in the music player UI ("Music unavailable — tap to retry") instead of "Loading…" so the user has a recovery action.
- Verify that `selectedPlaylistId` is not flipping null during workout transitions; if it is, debounce.

Root cause is **not yet confirmed** — Phase 1 evidence-gathering still needed for the actual Plex / Player startup path. Don't ship a fix until we know which of the candidates above is the real failure mode.
