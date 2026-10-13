# 2026-02-08 — Player Module Full Audit

## Scope
Full code audit of `frontend/src/modules/Player/` — all components, hooks, utilities, and styles.

**Files reviewed:** Player.jsx, SinglePlayer.jsx, AudioPlayer.jsx, VideoPlayer.jsx, CompositePlayer.jsx, VisualRenderer.jsx, ProgressBar.jsx, PlayerOverlayLoading.jsx, PlayerOverlayPaused.jsx, PlayerOverlayStateDebug.jsx, useCommonMediaController.js, useQueueController.js, useMediaResilience.js, usePlaybackSession.js, usePlaybackHealth.js, useBufferResilience.js, useAdvanceController.js, useShaderDiagnostics.js, useImageUpscaleBlur.js, useUpscaleEffects.js, useRenderFpsMonitor.js, useResilienceConfig.js, useResilienceState.js, transport/useMediaTransportAdapter.js, lib/helpers.js, lib/api.js, lib/playbackLogger.js, lib/mediaDiagnostics.js, lib/BufferResilienceManager.js, lib/waitKeyLabel.js, utils/mediaIdentity.js, utils/pauseArbiter.js, utils/telemetry.js, Player.scss

**Prod logs reviewed:** 2026-02-08 shader diagnostics, playback lifecycle events, FragmentController warnings, stall/error/remount events.

---

## Bug 1: Shader overlay 2.5px gap (hasGap=true in prod)

**Severity:** Low (cosmetic)  
**Status:** Active in production  
**Related code:** `Player.scss` (.shader class), `AudioPlayer.jsx`, `useShaderDiagnostics.js`

**Symptom:** Shader overlay dimensions (1024×580) do not match viewport (1024×575). The shader is positioned at y=-2.5, creating a 2.5px gap at top and bottom. Prod logs consistently report `hasGap: true`.

**Root cause:** The `.player` container is set to `height: 100%` inside `.tv-app`, which resolves to 580px (likely due to the Android TV WebView chrome adding 5px). The shader is `position: absolute; top: 0; left: 0; width: 100%; height: 100%`, inheriting the container's 580px height rather than clamping to `100vh`. The -2.5px offset suggests the container is vertically centered relative to the viewport.

**Impact:** During `blackout` shader, thin non-black strips may be visible at top/bottom edges. For `default`/`focused`/`night` shaders, the gap is cosmetically insignificant since the shader fades in/out.

**Fix suggestion:** Use `inset: 0` plus `width: 100vw; height: 100vh` on `.shader` for viewport-fixed coverage, or set the shader to `position: fixed` when in blackout mode. Alternative: add `-2px` margin overflow on all sides.

---

## Bug 2: FragmentController "No bytes to push" spam on Firefox (dash-video)

**Severity:** Medium (log noise, potential playback issue)  
**Status:** Active in production  
**Related code:** `VideoPlayer.jsx`, `useCommonMediaController.js` (DASH path), external `dash-video` web component

**Symptom:** Prod logs show continuous `[FragmentController] No audio bytes to push or stream is inactive` and `No video bytes to push` warnings every ~3 seconds on Firefox/Linux client. 

**Root cause:** The dash-video element's internal DASH.js player continues requesting fragments after the media has been paused or the stream has ended. Firefox's MediaSource implementation may not signal stream inactivity to DASH.js properly.

**Impact:** Significant log volume (hundreds of entries per session). Could indicate the DASH player is not properly cleaning up after playback ends or pauses. May also contribute to elevated CPU usage on the Firefox client.

**Fix suggestion:** 
1. Investigate if the dash-video element's `destroy()` method is being called on unmount.
2. Add an `ended` event handler to pause the DASH player's fragment fetching.
3. Consider filtering these warnings at the logger level to reduce noise.

---

## Bug 3: Global mutable state on `useCommonMediaController` function object

**Severity:** Medium (architectural/correctness risk)  
**Status:** Latent  
**Related code:** `useCommonMediaController.js` lines 48-50

**Symptom:** Three global dictionaries are attached directly to the function object:
```javascript
if (!useCommonMediaController.__appliedStartByKey) useCommonMediaController.__appliedStartByKey = Object.create(null);
if (!useCommonMediaController.__lastPosByKey) useCommonMediaController.__lastPosByKey = Object.create(null);
if (!useCommonMediaController.__lastSeekByKey) useCommonMediaController.__lastSeekByKey = Object.create(null);
```

**Root cause:** These are used to persist playback position and start-time application state across React remounts. While they correctly survive component teardown/remount, they are effectively a memory leak — keys are never evicted.

**Impact:**
- In long sessions with many tracks (prod shows queues of 539 items), these maps grow unboundedly.
- If two media items share the same `assetId`, the "applied start" flag persists incorrectly (start time is skipped on second play of the same track).
- NonHMR-safe: in dev mode, HMR would re-create these maps, losing sticky state.

**Fix suggestion:** Use a bounded LRU cache (e.g., last 50 keys), or attach cleanup to the hook's unmount lifecycle. For the duplicate-assetId issue, include the queue GUID in the key.

---

## Bug 4: `useEffect` dependency array includes `isStalled` state in media event listener setup

**Severity:** Medium (performance / correctness)  
**Status:** Latent  
**Related code:** `useCommonMediaController.js` line ~1082 (the massive useEffect with event listeners)

**Symptom:** The effect that sets up `timeupdate`, `ended`, `loadedmetadata`, `playing`, `pause`, `seeking`, etc. has `isStalled` in its dependency array. Every time stall state toggles, all event listeners are torn down and re-added.

**Root cause:** The `onProgress` callback reads `isStalled` in its closure, pulling it into the dependency array.

**Impact:** During stall recovery cycles, event listeners churn rapidly. This can cause missed events during the teardown/re-add window, potentially leading to stuck playback detection or duplicate `ended` calls.

**Fix suggestion:** Move `isStalled` into a ref (`isStalledRef`) and read from the ref inside the callback. This eliminates it from the dependency array and prevents the churn.

---

## Bug 5: Video `play` event listeners leak (addEventListener without corresponding removeEventListener)

**Severity:** Low-Medium (memory leak)  
**Status:** Latent  
**Related code:** `useCommonMediaController.js` lines ~870-880

**Symptom:** Inside `onLoadedMetadata` handler:
```javascript
mediaEl.addEventListener('play', () => { mediaEl.playbackRate = playbackRate; }, { once: false });
mediaEl.addEventListener('seeked', () => { mediaEl.playbackRate = playbackRate; }, { once: false });
```
These are added every time `loadedmetadata` fires but never removed.

**Root cause:** Anonymous function references make it impossible to remove them. Each metadata load adds another pair of listeners.

**Impact:** Over time, `playbackRate` is set redundantly by N accumulated listeners on each `play`/`seeked` event. During stall recovery that triggers reloads, `loadedmetadata` fires again, compounding the leak.

**Fix suggestion:** Use named function references stored in refs and remove them before adding new ones, or use `{ once: true }` with a re-registration pattern.

---

## Bug 6: Race condition in `fetchVideoInfoCallback` and `onResolvedMeta`

**Severity:** Low-Medium  
**Status:** Latent  
**Related code:** `SinglePlayer.jsx` lines ~240-310

**Symptom:** `fetchVideoInfoCallback` is async and calls `setMediaInfo` + `setIsReady(true)` on completion. A separate `useEffect` watches `[isReady, mediaInfo]` and calls `onResolvedMeta`. If the component remounts between the fetch start and completion (e.g., queue advance + remount), the stale fetch result may set state on an unmounted component or overwrite new media info.

**Root cause:** No cancellation token or version check on the fetch callback. The `useEffect` for queue initialization in `useQueueController` has `isCancelled` tracking, but `SinglePlayer`'s fetch does not.

**Impact:** Possible "Cannot update state on an unmounted component" warning (React 18 suppresses this). More critically, a stale media info response could briefly flash incorrect content before the new fetch completes.

**Fix suggestion:** Add an `AbortController` or version counter to `fetchVideoInfoCallback`. On unmount or re-trigger, cancel the previous request.

---

## Bug 7: `moment` dependency for trivial time formatting

**Severity:** Low (bundle size)  
**Status:** Tech debt  
**Related code:** `lib/helpers.js` line 1

**Symptom:** `moment` (330KB minified) is imported solely for `formatTime()`, which produces `MM:SS` or `HH:MM:SS` output.

**Root cause:** Historical dependency, never refactored.

**Impact:** Adds ~70KB gzipped to the bundle for functionality achievable in ~10 lines of vanilla JS.

**Fix suggestion:** Replace with:
```javascript
export function formatTime(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}
```

---

## Bug 8: Audio player shader state uses percent < 0.1 (not 10%)

**Severity:** Low (cosmetic/logic)  
**Status:** Active in production  
**Related code:** `AudioPlayer.jsx` line 121

**Symptom:** The shader state computation:
```javascript
const shaderState = percent < 0.1 || seconds > duration - 2 ? 'on' : 'off';
```
`percent` is computed as `((seconds / duration) * 100).toFixed(1)` — so it's already in 0–100 range. `percent < 0.1` means the shader is only "on" for the first 0.1% of the track (< 0.27s for a 4.5min track), not 10%.

**Root cause:** Likely intended as `percent < 10` (first 10% of track). The `.toFixed(1)` also returns a string, making the `<` comparison coerce via parseFloat, which works but is fragile.

**Impact:** The fade-in shader at track start is barely visible since it turns off after a fraction of a second. Only the end-of-track fade-out (last 2 seconds) is meaningful.

**Fix suggestion:** Change to `percent < 10` if intent is 10%, or `seconds < 2` if the intent is first 2 seconds (symmetric with end behavior).

---

## Bug 9: `CompositePlayer` audio playback state never updated

**Severity:** Medium (broken feature)  
**Status:** Active  
**Related code:** `CompositePlayer.jsx` lines 35-41 (`NewFormatComposite`)

**Symptom:** `audioPlaybackState` is initialized with `useState` but `setAudioPlaybackState` is never called in the component. This means the `useAdvanceController` always sees `{ currentTime: 0, trackEnded: false, isPlaying: false }`.

**Root cause:** The audio `<Player>` component doesn't wire `onProgress` back to `setAudioPlaybackState`.

**Impact:** The `useAdvanceController` modes `synced` and `onTrackEnd` are non-functional in `NewFormatComposite`. Only `timed` and `manual` advance modes work.

**Fix suggestion:** Pass an `onProgress` callback to the audio Player that calls `setAudioPlaybackState` with the current time, ended status, and playing state.

---

## Bug 10: `useQueueController` doesn't respect `playbackRate` from queue items

**Severity:** Low  
**Status:** Latent  
**Related code:** `useQueueController.js` line 237

**Symptom:** The returned `playbackRate` is resolved from the top-level `play`/`queue` object:
```javascript
playbackRate: play?.playbackRate || play?.playbackrate || queue?.playbackRate || queue?.playbackrate || 1,
```
But individual queue items may have their own `playbackRate`. This is ignored.

**Root cause:** Queue-level playback rate is returned as a single value; per-item overrides are not considered.

**Impact:** If a queue mixes items with different desired playback rates (e.g., sped-up intros), all play at the queue-level rate.

**Fix suggestion:** Resolve `playbackRate` from `playQueue[0].playbackRate` first, falling back to the queue-level value. This is partially handled in `Player.jsx` via `currentItemPlaybackRate`, but the hook's return value is misleading.

---

## Bug 11: CSS `.focused` shader hides all `<p>` and `<h2>` elements globally within `.player`

**Severity:** Low (cosmetic)  
**Status:** Active  
**Related code:** `Player.scss` lines ~280-287

**Symptom:** The `.focused` rule uses `p, h2, h3, .progress-bar { display: none; }` which hides ALL paragraph and heading elements inside any child with class `focused`, including overlay text.

**Root cause:** Overly broad CSS selector. The intent is to hide audio metadata and progress, but it catches all descendants.

**Impact:** If overlays (loading, paused) render `<p>` text inside a `.focused` shader context, they are hidden.

**Fix suggestion:** Scope the hiding to `.audio-player p`, `.audio-player h2`, etc., rather than bare tag selectors.

---

## Bug 12: `watchedDuration` localStorage not cleaned up for completed tracks

**Severity:** Low  
**Status:** Latent  
**Related code:** `SinglePlayer.jsx` lines ~170-185

**Symptom:** `watchedDuration:*` localStorage entries are removed when `percent >= 99`, but if a track ends via `onEnd` (queue advance) before `handleProgress` fires at 99%, the entry persists.

**Root cause:** The cleanup is inside the `handleProgress` callback, which depends on a `timeupdate` event firing near 99%. For tracks that end abruptly (stall → skip, or network interruption), the last reported percent may be < 99%.

**Impact:** Over time, localStorage accumulates stale `watchedDuration` entries. On devices with limited storage (Android TV), this could become problematic.

**Fix suggestion:** Add cleanup in the `onEnd` / `advance` path, or use `sessionStorage` instead of `localStorage` for this ephemeral data.

---

## Bug 13: `hardReset` not registered for VideoPlayer

**Severity:** Low  
**Status:** Latent  
**Related code:** `VideoPlayer.jsx` line ~143

**Symptom:** VideoPlayer registers `hardReset: null` with the resilience bridge:
```javascript
resilienceBridge.onRegisterMediaAccess({
  getMediaEl,
  hardReset: null,  // <-- always null
  fetchVideoInfo: fetchVideoInfo || null
});
```

**Root cause:** Unlike AudioPlayer which passes the hook's `hardReset`, VideoPlayer never wires it.

**Impact:** `Player.jsx`'s `handleResilienceReload` checks `mediaAccess.hardReset` and invokes it before scheduling a remount. For video, this always falls through to the remount path, making recovery slightly slower (full remount vs. in-place reset).

**Fix suggestion:** Pass `hardReset` from `useCommonMediaController`'s return value through to the bridge registration.

---

## Bug 14: `isPaused` derived from live DOM query on every render

**Severity:** Low (performance)  
**Status:** Latent  
**Related code:** `useCommonMediaController.js` return block (line ~1315)

**Symptom:**
```javascript
isPaused: !seconds ? false : getMediaEl()?.paused || false,
```
This is evaluated on every render cycle. `getMediaEl()` traverses shadow DOM for dash-video elements.

**Root cause:** `isPaused` is not tracked in React state; it's read live from the DOM.

**Impact:** Shadow DOM traversal on every render is slightly expensive. The returned value can be stale or inconsistent with other returned values computed at different times in the same render.

**Fix suggestion:** Track `isPaused` in `useState`, updated from `pause`/`play`/`playing` events (similar to how `seconds` is tracked from `timeupdate`).

---

## Bug 15: `useEffect` cleanup for FPS logging interval uses stale deps

**Severity:** Low  
**Status:** Latent  
**Related code:** `VideoPlayer.jsx` lines ~195-210

**Symptom:** The FPS logging `setInterval` callback references `seconds`, `quality`, `droppedFramePct`, `currentMaxKbps`, etc. from closure, but these are stale because the effect's dependency array is `[isPaused, isStalled, displayReady, quality?.supported]`.

**Root cause:** Intentional optimization to avoid timer thrashing — only recreate the interval when play/pause state changes. Uses `latestDataRef` pattern to read current values inside the interval.

**Impact:** The `latestDataRef` pattern is correctly implemented (updated via separate effect), but the interval callback still directly references some values from `useEffect` scope rather than reading from the ref. The `quality` and `media` refs used in the interval are from the outer closure, not from `latestDataRef`.

**Fix suggestion:** Ensure the interval callback reads all dynamic values from `latestDataRef.current` rather than mixing closure values and ref values.

---

## Observations (not bugs)

### 1. Module complexity
The Player module totals ~5,500 lines across 30+ files. `useCommonMediaController.js` alone is 1,332 lines handling stall detection, quality adaptation, bitrate management, start time logic, recovery strategies, and event listeners. This is a candidate for decomposition.

### 2. Resilience architecture duplication
Both `useCommonMediaController` (stall detection + recovery) and `useMediaResilience` (higher-level health monitoring) implement overlapping concern domains. The "external stall state" passthrough pattern bridges them but adds complexity. Consider consolidating.

### 3. Prod health — currently stable
Production logs show clean playback lifecycle: `playback.started` → `queue-advance` → `playback.started` for audio tracks with no stalls, errors, or remounts in the recent session. Video playback on Mac Chrome also shows clean lifecycle. The FragmentController noise on Firefox is the only active warning pattern.

### 4. Telemetry volume
The `blackout.dimensions` and `audio-shader.dimensions` diagnostics log at `warn` level on every shader state change and mount. For a 539-item audio queue, this generates ~1,600 diagnostic log entries per full playthrough. Consider downgrading to `debug` level or sampling.

---

Related code:
- `frontend/src/modules/Player/` (entire module)
- `frontend/src/lib/Player/useMediaKeyboardHandler.js`
- `frontend/src/lib/logging/Logger.js`
- `frontend/src/lib/reloadGuard.js`
