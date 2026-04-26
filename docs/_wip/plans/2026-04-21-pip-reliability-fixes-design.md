# PIP — Reliability Fixes — Design

**Status:** Design validated, ready for implementation
**Date:** 2026-04-21
**Follows up:** `2026-04-21-pip-panel-takeover-design.md`

Two independent reliability issues surfaced by the first live exercise of the panel-takeover feature. Bundled into one spec because they share implementation/testing scope (the doorbell ring end-to-end path).

- **Section 1** — panel mode falls back to corner PIP when the slot is occluded by a fullscreen overlay.
- **Section 2** — the HLS `stream.m3u8` endpoint has a race that causes the second of two concurrent clients (common when multiple screens subscribe to the same doorbell broadcast) to get an ENOENT 502 that hls.js treats as fatal.

---

## Section 1 — Fullscreen-Aware Fallback

## Problem

The panel-takeover mode (`mode: panel`, `target: <slot>`) portals an overlay into a named layout slot and CSS-hides the slot's native children. That works when the screen is rendering its default home layout. It fails when a fullscreen overlay (video player, piano, camera fullscreen, etc.) is active: the panel portal still mounts and the slot still exists, but the entire slot is visually covered by the fullscreen overlay, so the user never sees the takeover.

The original "corner PIP" mode (`mode: pip`) does not have this problem — it renders at a fixed screen corner above all layout, and therefore is visible over a fullscreen overlay.

## Goal

When a panel-mode subscription fires while a fullscreen overlay is active, automatically fall back to corner PIP mode so the event is visible to the user.

## Non-Goals

- No mid-flight transitions. Fullscreen opening *after* a panel is already showing leaves the panel as-is (occluded). Fullscreen closing while a fallback corner PIP is showing leaves the corner PIP in the corner until its own timeout.
- No change to the "missing slot" behavior — that remains warn + no-op (see original design Q6). Missing slot ≠ occluded slot.
- No change to the YAML subscription schema. Callers do not need to declare a fallback; it is automatic.

## Decision

Detect occlusion by reading `hasOverlay` from `ScreenOverlayProvider`. When `show()` is called with `mode: 'panel'` and `hasOverlay === true`, coerce the call to corner mode using the screen-level `pip:` config block.

This choice over alternatives:

- *Slot-visibility detection (getBoundingClientRect / offsetParent)* — rejected as over-engineered. The only occluder that exists today is the overlay system; if we add another occlusion vector later, we can extend then.
- *Explicit YAML fallback per subscription* — rejected. We expect every panel subscription to want this behavior. Making it opt-in is YAML boilerplate for no benefit.

## Behavior

### Trigger
`pip.show(Component, props, callConfig)` is invoked with `callConfig.mode === 'panel'` and a `target`.

### Detection
At the top of `show()`, read `hasOverlay` (already provided by the existing `useScreenOverlay()` hook that `PipManager` consumes).

### Fallback rule
```
IF mode === 'panel' AND hasOverlay IS true:
  mode := 'corner'
  callConfig := corner-merged config (see below)
  emit log: pip.panel-fallback-to-corner { target, reason: 'fullscreen-active' }
  proceed down the existing corner-mode branch
```

### Corner-merged config derivation
When falling back, the corner branch needs `position`, `size`, `margin`, `timeout`:

- `position`, `size`, `margin` → screen-level `pip:` config (already merged via `DEFAULTS` in `mergeConfig`). No subscription-level change required.
- `timeout` → `callConfig.timeout` if present (i.e. value the subscription passed in its `panel:` block). Otherwise `DEFAULTS.timeout` (30s).

The `target` field is dropped on the fallback path.

### Missing-slot path (unchanged)
If `mode === 'panel'` and `hasOverlay === false`, existing logic runs: slot lookup, warn + no-op if slot missing. Fallback does NOT trigger on missing slot — only on fullscreen occlusion.

### State during / after fallback
- The corner PIP runs on the existing corner-mode lifecycle (slide-in, timer, slide-out).
- The corner PIP's timeout is independent of the fullscreen overlay's lifetime. If the fullscreen overlay dismisses mid-corner-PIP, the corner PIP stays in the corner until its own timeout (the user picked option A; no animated re-promotion to panel).
- If `show()` is called again while the corner PIP from fallback is still visible, existing corner-mode behavior applies (refresh timer, update content).

## Logging

New event: `pip.panel-fallback-to-corner`

| Field | Value |
|---|---|
| `target` | slot id that *would* have been used |
| `reason` | `'fullscreen-active'` (leaves room for future reasons) |
| `timeout` | the corner timeout applied |

Existing events (`pip.show`, `pip.dismiss`) fire as usual down the corner branch.

## Code Touch Points

Single file: `frontend/src/screen-framework/pip/PipManager.jsx`

- Pull `hasOverlay` out of the existing `useScreenOverlay()` destructure.
- In `show()`, before the `mode === 'panel'` branch, check `mode === 'panel' && hasOverlay` and coerce mode + strip target.
- Emit the new log event on coercion.

No changes to:
- `PanelRenderer.jsx` (slot registration unchanged)
- `useScreenSubscriptions.js` (subscription normalization unchanged)
- Any YAML (`office.yml`, etc.)
- CSS

## Validation

On an office screen with a fullscreen overlay already active (e.g., piano MIDI session):
1. Fire: `curl -sS -X POST http://localhost:3111/api/v1/camera/doorbell/event -H "Content-Type: application/json" -d '{"event":"ring"}'`
2. Expected console log sequence:
   - `subscription.show-panel` (topic=doorbell, target=main-content) — from useScreenSubscriptions
   - `pip.panel-fallback-to-corner` (target=main-content, reason=fullscreen-active) — NEW
   - `pip.show` (mode=corner, position=bottom-right, size=25, timeout=30)
   - `cameraOverlay.direct` (cameraId=doorbell)
   - `hls.start` → `hls.playing`
3. Visually: bottom-right corner PIP appears above the fullscreen overlay, slides in, plays camera, slides out after 30s.
4. If the fullscreen overlay is dismissed mid-PIP, the corner PIP stays in the corner until its own timeout.

On an office screen with no fullscreen overlay, the panel mode continues to work as before (regression check).

---

## Section 2 — HLS First-Playlist Race

### Problem

When a doorbell ring fans out to multiple subscribers (e.g., Shield TV *and* office screen both render `CameraOverlay` for the same `cameraId`), their `GET /api/v1/camera/:id/live/stream.m3u8` requests arrive within ~50–500 ms of each other. The second request returns `ENOENT` for the playlist file, the router sends `502`, and hls.js on the second client treats it as `manifestLoadError { fatal: true }` and gives up — the user sees only the snapshot warmup.

Observed:

- Both rings (2026-04-21 evening) produced `camera.live.playlistError: ENOENT /tmp/camera/doorbell/stream.m3u8` for ~1 s.
- Shield TV recovered (`hls.playing` ~10 s after ring). Linux/Chromium office client hit fatal `manifestLoadError` and never recovered.

### Root Cause

`backend/src/1_adapters/camera/HlsStreamManager.mjs:42-46`:

```js
const existing = this.#streams.get(streamId);
if (existing) {
  this.#resetTimer(streamId);
  return existing.dir;    // returns before playlist file is written
}
```

First caller spawns ffmpeg, inserts the entry into `#streams` synchronously, and *then* awaits `#waitForPlaylist` (polls every 500 ms until the `.m3u8` appears). Second caller arrives in that window, hits the `existing` branch, and gets `dir` immediately. The router's subsequent `fs.readFile(dir + '/stream.m3u8')` throws `ENOENT` because ffmpeg hasn't written the playlist yet.

### Decision

Dedup concurrent `ensureStream` calls by storing the "playlist-ready" promise on the entry. Every caller — first or Nth — awaits the same promise before getting the directory back.

Rejected alternatives:
- *Loop `readFile` with retry in the router.* Defensive, but doesn't fix the adapter contract; future callers will trip on the same bug.
- *Set a client-side retry config in hls.js.* Plausible, but papers over a backend bug and doesn't help non-hls.js consumers.

### Behavior

In `ensureStream(streamId, rtspUrl)`:

1. If `existing` entry present: `await existing.readyPromise`, then return `existing.dir`.
2. Otherwise: spawn ffmpeg, create entry with `readyPromise = #waitForPlaylist(playlistPath, PLAYLIST_TIMEOUT_MS)`, insert entry *before* awaiting, then await and return.
3. On `readyPromise` rejection, call `stop(streamId)` and rethrow — existing behavior.

Postcondition of `ensureStream`: by the time it resolves, the playlist file exists on disk. The router can read it without defensive retry.

### Logging

Existing `hls.*` events unchanged. No new events.

### Code Touch Points

Single file: `backend/src/1_adapters/camera/HlsStreamManager.mjs`

- Add `readyPromise` to the entry shape.
- In the `existing` branch, `await existing.readyPromise` before returning `dir`.
- In the spawn branch, assign `entry.readyPromise = this.#waitForPlaylist(...)` and await it.

No changes to:
- Router (`camera.mjs`) — its `readFile` call is now guaranteed to find the file.
- Frontend `useHlsStream` or `CameraRenderer`.
- The `touch` / `stop` / `isActive` methods.

### Validation

1. Fire the doorbell webhook on a configuration where both Shield TV and office are subscribed.
2. Expected backend log sequence:
   - First GET → `hls.ffmpeg.spawn`, then `hls.ffmpeg.stderr` lines, eventually playlist resolves, first response 200.
   - Second GET → waits on the same promise, resolves at the same time, second response 200.
   - No `camera.live.playlistError` entries.
3. Expected client logs (both clients):
   - `hls.start` → `hls.playing` (no `hls.error` with `fatal:true`).
4. Regression: a single-client ring continues to work (doesn't hang waiting on an entry that never existed).

---

## Scope Check

- Section 1 changes one frontend file.
- Section 2 changes one backend file.
- The two fixes share no code, but they share the doorbell-ring end-to-end test path, which is why they live in one spec.
