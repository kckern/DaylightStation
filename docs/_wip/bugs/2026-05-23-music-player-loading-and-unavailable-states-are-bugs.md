# 2026-05-23 — `Loading…` and `Music unavailable` UI states should not exist

**Severity:** High (recurring user-visible failure)
**Component:** `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx` (+ `Player.jsx`, `useQueueController.js`)
**Status:** Diagnostic plumbing landed on branch `fix/music-player-silent-failures` (2026-05-23). Upstream root cause still unknown — next occurrence will produce a specific `fitness.music.player_error` event naming the failed surface. See [Resolution](#resolution) below.

## Premise

**Music is always available when the API is responding.**

The fitness music player has two user-visible failure states (FitnessMusicPlayer.jsx:563-577):

```jsx
{currentTrack?.title || currentTrack?.label || (
  stuck.isStuck
    ? <span>Music unavailable — tap to retry</span>
    : 'Loading…'
)}
```

Per the stated system contract, neither state should ever be visible to the user beyond the first ~1-2 seconds of a playlist load. If they are, **something between the API and the audio element is failing silently**. The 15-second stuck-loading detector (`useStuckLoadingDetector.js`) and the "tap to retry" affordance are recovery scaffolding for a failure mode that should not exist in the first place — but the failure mode keeps showing up.

This report is not about fixing the placeholder text. It is about identifying and eliminating every silent failure path between "user selects a playlist" and "first audio sample plays."

## History

This bug has been chased twice already:

| Date | Doc | Conclusion |
|------|-----|------------|
| 2026-02-03 | [fitness-music-player-not-playable.md](2026-02-03-fitness-music-player-not-playable.md) | Fixed: data-structure mismatch (nested `play.plex` not flattened). Solution B applied — `FitnessMusicPlayer` stopped pre-fetching, passes `queue={{ plex, shuffle }}` to `<Player>` instead. |
| 2026-05-01 | [fitness-music-player-loading-forever.md](2026-05-01-fitness-music-player-loading-forever.md) | "Loading…" reproduced in production logs. `PlayerOverlayLoading` emits `status:Starting…` for hundreds of seconds with `vis:Xms/0ms` — wall clock advances but playable time stays at 0. Root cause not confirmed. The "Music unavailable — tap to retry" affordance was proposed there as a UI recovery action and subsequently added. |

This new report consolidates the premise: **the recovery affordance treats the symptom; the bug is upstream**.

## Failure surfaces between "playlist selected" and "audio plays"

Walking the actual code path so we know where to instrument:

### 1. `FitnessMusicPlayer` props rebuild

```js
// FitnessMusicPlayer.jsx:199
const playerQueueProp = useMemo(() => ({
  contentId: selectedPlaylistId ? `plex:${selectedPlaylistId}` : null,
  plex: selectedPlaylistId,
  shuffle: true
}), [selectedPlaylistId]);
```

Note: this passes **both** `contentId` and `plex`. In `useQueueController`, the `contentRef` (= `contentId`) path wins, so the actual API call is **`/api/v1/queue/plex:${id}?shuffle=true`**, not `/api/v1/item/plex/${id}/playable,shuffle`. The 2026-02-03 fix described the latter endpoint — verify the `/api/v1/queue/...` shape is what we expect and matches the validation downstream.

### 2. `useQueueController.initQueue()` failure handling (the silent-empty trap)

`frontend/src/modules/Player/hooks/useQueueController.js:120-241`

When the API call rejects (line 222 `.catch`), the handler:

1. Logs `queue-init-failed` to the playback logger
2. Restores the previous source signature
3. **Does NOT clear the queue**
4. **Does NOT signal the parent component**
5. **Does NOT retry**

Caller (`FitnessMusicPlayer`) has no way to learn this happened. `currentTrack` stays null → `Loading…` → 15 s → `Music unavailable`.

Equally bad: when the API returns 200 but `items: []`, or items all fail the `validQueue` filter (line 183), the queue is cleared via `clear()` (line 210) and `queue-init-invalid` is logged — again, no caller notification.

### 3. Stale-playlist race

If `selectedPlaylistId` changes during an in-flight fetch, the `isCancelled` flag (line 115) prevents the response from being applied — but the new playlist's effect must trigger a new `initQueue()` cycle. If the signature dedupe on line 111 collides, the new fetch never runs and the queue stays stale.

### 4. Player startup (the `vis:Xms/0ms` symptom from 2026-05-01)

Even when queue init succeeds, `Player.jsx` must:

- Resolve a media URL for the first queue item
- Attach it to a `<video>`/`<audio>` element
- Wait for the element's `canplay` / `playing` events

The 2026-05-01 logs show this gate never closes — `status:Starting…` indefinitely. Failure surfaces here:

| Sub-surface | Failure mode |
|------|--------------|
| `/api/v1/play/plex/...` resolve | Returns 4xx/5xx → media element gets bad src → silent `error` event |
| Plex backend transcode | Stalls / never produces manifest → DASH/HLS load hangs |
| Media element `error` event | Fired but not reported to `onProgress` → caller never learns |
| Resilience loop | `forceSinglePlayerRemount` re-arms repeatedly without success → produces multiple `waitKey`s, all stuck (matches 2026-05-01 evidence) |

### 5. No timeout anywhere

There is no client-side timeout on:
- The queue API call
- The media URL resolution
- The media element load

If any of these hang (TCP stuck-open, Plex unresponsive, DNS slow), the UI sits at `Loading…` indefinitely until the 15 s stuck timer fires.

## Why the existing recovery doesn't fix it

The retry mechanism (FitnessMusicPlayer.jsx:689) is:

```js
key={`${selectedPlaylistId}-${stuck.attempt}`}
```

Bumping `attempt` re-keys the `<Player>` and forces a full remount. **This works only if the failure was transient.** It does not:

- Diagnose which surface failed
- Reset the upstream signature cache in `useQueueController` (the `_signatureCache` is module-level)
- Retry with a different strategy (e.g., refetching a fresh URL, switching endpoints, falling back to a different playlist)

If the underlying problem is deterministic (e.g., the queue endpoint returns garbage for this playlist), retrying produces the same result and the user is permanently stuck.

## Required evidence (Phase 1)

Before proposing any fix, gather:

1. **Reproduce.** Trigger the stuck state in dev. Note: 2026-05-01 reported it during "10 minute muscle program" specifically — try that playlist first.
2. **Capture the playback log around the failure.** Look for `queue-init-failed`, `queue-init-invalid`, `prewarm-redeem-failed`, and any `playback.video-ready` / `playback.overlay-summary` events. We need to know which surface fired.
3. **Inspect the actual API request.** With DevTools network tab open, confirm:
   - Was `/api/v1/queue/plex:${id}?shuffle=true` called?
   - Status code?
   - Response body — `items` length? Item shape (does the validation filter accept them)?
4. **Inspect the audio element.** In the DOM, find the `<audio>` rendered by `<Player>`. Read `audioElement.error`, `readyState`, `networkState`, and `src`. This tells us whether the queue succeeded but media load failed.
5. **Count remounts.** 2026-05-01 saw multiple `waitKey`s. Are we in a resilience-driven remount loop without `playback.video-ready`?

## Fix directions (do not apply blind — verify failure surface first)

Each of these addresses a specific surface above. Match the fix to the evidence.

### Surface 2 — silent queue failure
- Propagate `queue-init-failed` and `queue-init-invalid` back to the parent via a new `onQueueError` callback on `<Player>`.
- `FitnessMusicPlayer` reacts by setting an explicit error state (with the API status code and detail) and exposing a meaningful retry that re-clears the signature cache.

### Surface 3 — stale-playlist race
- Add explicit logging when the signature dedupe rejects a new playlist id.
- Reset `_signatureCache` on `<Player>` remount.

### Surface 4 — Player startup
- Wire the audio element's `error` event into `onProgress` (or a new `onMediaError`) so caller learns about media-level failures.
- Cap the resilience remount loop at N attempts; surface error after that.

### Surface 5 — no timeout
- Add a 10 s client-side timeout on the queue API call. On timeout, fail-loud via the same `onQueueError` path.
- Add a 15 s timeout on `canplay`. If the media element never reaches it, fail-loud.

### UI: stop papering over
Once the failure surfaces signal upward correctly, the `Music unavailable — tap to retry` message should be **replaced with a specific message that names the failure** (e.g., `Music API error 502`, `Playlist empty`, `Media load timed out`). Generic `tap to retry` is a tell that we don't know what went wrong — and our user is right that we should.

## Files involved

| File | Role |
|------|------|
| `frontend/src/modules/Fitness/player/panels/FitnessMusicPlayer.jsx` | Display, queue prop, stuck-loading consumer |
| `frontend/src/modules/Fitness/player/panels/useStuckLoadingDetector.js` | The 15 s timer that flips `isStuck` |
| `frontend/src/modules/Player/Player.jsx` | Media element lifecycle, resilience loop |
| `frontend/src/modules/Player/hooks/useQueueController.js` | Queue fetch + silent error handling |
| `frontend/src/modules/Player/hooks/useMediaResilience.js` | Remount/reload behavior |
| `frontend/src/modules/Player/components/PlayerOverlayLoading.*` | The `Starting…` overlay that emits the diagnostic loop |
| `backend/src/4_api/.../queue.mjs` (or wherever `/api/v1/queue/:contentRef` lives) | Verify response shape for `plex:` refs |

## Success criteria

The fix is done when **all** of these hold:

- [ ] `Loading…` is visible for ≤ 2 seconds on a fast network, and never for more than the actual queue-fetch + media-load round-trip.
- [ ] When the API genuinely fails (offline, 500, malformed), the UI shows a specific error (HTTP status, "empty playlist", "media error") within ≤ 5 seconds — not a 15-second stuck timer.
- [ ] No silent empty-queue path exists in `useQueueController`. Every failure routes to `onQueueError` (or equivalent).
- [ ] No silent media-element error path exists in `Player.jsx`. `error` and `stalled` events route to the caller.
- [ ] Production logs over a one-week window show zero `fitness.music.stuck_loading` events under normal API health (homeserver up, Plex up).
- [ ] If `fitness.music.stuck_loading` does fire, the same time window contains a paired structured error event that names the actual upstream failure.

## Resolution

Plan: `docs/_wip/plans/2026-05-23-music-player-eliminate-silent-failures.md`. Implementation branch: `fix/music-player-silent-failures` (12 commits, +467/-16 across 8 files, 77/77 tests pass).

**What landed (closes silent-failure paths, does NOT fix the unknown upstream cause):**

| Surface | Fix |
|---------|-----|
| 2. silent queue failure | `useQueueController` now emits `onError({ kind: 'fetch-failed' \| 'empty-queue' \| 'invalid-queue' })` |
| 5. no timeout (queue) | `useQueueController` wraps the `DaylightAPI` call in `withTimeout` (10 s default), emits `kind: 'fetch-timeout'` |
| 4. silent media element error | New `useMediaErrorReporter` hook attaches an `error` listener and emits `kind: 'media-error'` with code/networkState/readyState |
| 5. no timeout (media) | Same hook arms a 15 s timer cleared by `canplay`/`playing`; emits `kind: 'media-load-timeout'` |
| UI: stop papering over | `FitnessMusicPlayer` renders a kind-specific message via `formatMusicErrorMessage` instead of generic "tap to retry" |
| Silent-failure detector | The legacy 15 s stuck-loading detector now logs `silentFailure: true` if it fires without a paired `playerError` — that's a bug indicator that we missed instrumentation |

**Surfaces NOT addressed (intentionally out of scope until evidence arrives):**

- Surface 1 (props rebuild path discrepancy — `/api/v1/queue/plex:${id}` vs `/api/v1/item/plex/${id}/playable,shuffle`)
- Surface 3 (signature dedupe stale-playlist race)
- The actual upstream Plex / API failure mode

These are upstream of the now-instrumented surfaces. The next stuck-playback occurrence will produce a `fitness.music.player_error` event naming the failed surface; that telemetry drives the next investigation.

**What to watch in production logs:**

- `fitness.music.player_error` — primary signal, should pair with every visible error UI
- `fitness.music.stuck_loading` with `silentFailure: true` — gap indicator, should be zero under healthy API conditions
- `queue-init-failed` / `queue-init-empty` / `queue-init-invalid` / `queue-init-timeout` from the playback logger

## Related

- [2026-02-03 — fitness music player not playable](2026-02-03-fitness-music-player-not-playable.md)
- [2026-05-01 — fitness music player loading forever](2026-05-01-fitness-music-player-loading-forever.md)
- [Fitness music player reference](../../reference/fitness/fitness-music-player.md)
- [Implementation plan](../plans/2026-05-23-music-player-eliminate-silent-failures.md)
