# Bug: Morning/office program video never plays — spinner persists after audio intro

**Date:** 2026-03-24
**Severity:** Critical — both morning programs broken, no video content ever plays
**Affected:** office-tv (Chrome/Linux), livingroom-tv (Shield TV/FKB)
**Deployed build:** `5dd6953a` (2026-03-23T17:37:27Z)
**Related:** `2026-03-17-morning-program-spinner-audio-plays.md` — same symptom, fixes deployed but bug recurs

---

## Summary

Audio intro plays fine on both devices. When the queue advances to the first video track, the video never plays. The **loading spinner overlay persists** (not the pause overlay). Three separate attempts across two devices all fail. This is a regression of the March 17 bug pattern despite targeted fixes being deployed.

---

## Three Failure Cases

### Case 1: Office-tv — office-program (WebSocket trigger, 08:27 UTC)

| Field | Value |
|-------|-------|
| Device | office-tv (Chrome 145, X11 Linux) |
| Content | `files:news/aljazeera/20260323.mp4` |
| Trigger | WebSocket `media:queue` from scheduled automation |
| readyState | **0** (HAVE_NOTHING) — never loaded |
| networkState | 1 (NETWORK_IDLE) |
| paused | true |
| currentTime | 0.0 |
| Overlay | Recovering… for 18+ minutes |
| Recovery | Never triggered (stall detection skips paused, loadedmetadata never fires) |

### Case 2: Shield TV — morning-program (FKB URL autoplay, 15:44 UTC)

| Field | Value |
|-------|-------|
| Device | livingroom-tv (Shield TV, FKB WebView Chrome 146) |
| Content | `files:news/aljazeera/20260323.mp4` (same as office-program first video) |
| Trigger | FKB `loadURL` with `?queue=morning-program` |
| readyState | 0 → 0 (never loaded) |
| networkState | 2 (NETWORK_LOADING) → 2 |
| Overlay | Starting… → Recovering… |
| Recovery | Resilience fired `startup-deadline-exceeded` at 16s, remounted Player |
| Result | `AbortError: play() interrupted because media removed from document` → back to readyState=0 |

### Case 3: Shield TV — morning-program (user menu selection, 15:56 UTC)

| Field | Value |
|-------|-------|
| Device | livingroom-tv (same Shield, user-initiated from menu) |
| Content | `files:video/news/world_az/20260324.mp4` |
| Trigger | User selected "Morning Program" from screen menu |
| Audio intro | **Played successfully** — `files:sfx/intro`, 11s, `playback.started` confirmed |
| Queue advance | Audio finished → track 2: "20260324" at 15:57:03 |
| readyState | 0 → 4 (fully loaded) |
| currentTime | **0.7** (played briefly) |
| paused | true |
| Overlay | **Loading spinner** visible (not pause overlay) |
| displayReady | Appears to be false (spinner showing, video invisible under `.video-element` opacity:0) |

---

## Key Evidence

### Audio autoplay works — rules out browser policy
```
15:56:52.277Z playback.started { title: "Good Morning", mediaType: "audio", mediaKey: "files:sfx/intro" }
```
Audio autoplayed without any user gesture on the same Shield session. Chrome's autoplay policy is not blocking media playback.

### Backend and media serving are healthy
```bash
# Queue API returns valid mediaUrl
$ curl http://localhost:3111/api/v1/queue/office-program | jq '.items[0].mediaUrl'
"/api/v1/proxy/media/stream/news%2Faljazeera%2F20260323.mp4"

# Streaming endpoint works (HTTP 206)
$ curl -o /dev/null -w "%{http_code}" "http://localhost:3111/api/v1/proxy/media/stream/news%2Faljazeera%2F20260323.mp4" -H "Range: bytes=0-1023"
206

# File exists (33MB)
$ docker exec daylight-station ls -la media/video/news/aljazeera/20260323.mp4
-rw-rw-r-- 1 node node 33365846 Mar 24 03:05 20260323.mp4
```

### Case 3 proves the video CAN load and play
`readyState=4` and `currentTime=0.7` on Shield case 3 proves the file is servable, decodable, and briefly plays. The failure is in the Player's handling of the audio→video transition, not in the media pipeline.

### Spinner overlay visible, not pause overlay
The `PlayerOverlayLoading` component renders the spinner. The `PlayerOverlayPaused` does not render. This means the issue is in the display lifecycle (`displayReady`), not in playback state management.

---

## Root Cause Investigation

### What we know
1. Audio plays → video doesn't → issue is specific to audio→video queue transition
2. Video loads and plays briefly (case 3) → not a network/codec/autoplay issue
3. Spinner persists → `displayReady` never set to true, or is reset after being set
4. This is the same symptom pattern as the March 17 bug

### Bugs found in code audit

#### Bug A: `AudioPlayer` uses removed `mediaInstanceKey`

**`AudioPlayer.jsx:51`** destructures `mediaInstanceKey` from `useCommonMediaController`, but it was removed from the controller's return value (commit `0555884d`). The `<audio>` element renders with `key={undefined}`:

```jsx
// AudioPlayer.jsx:254
<audio key={mediaInstanceKey} ref={containerRef} src={mediaUrl} autoPlay />
// mediaInstanceKey is UNDEFINED — React treats as no key
```

**Impact:** React may not properly track/unmount the audio element during the audio→video format switch. This could leave orphan refs or prevent clean handoff to VideoPlayer.

#### Bug B: `displayReady` race condition in VideoPlayer

When the queue advances from audio to video, `mediaUrl` changes. This triggers:

```javascript
// VideoPlayer.jsx:210-213
useEffect(() => {
    setDisplayReady(false);  // ← resets display readiness
}, [mediaUrl, media?.maxVideoBitrate]);
```

If `onCanPlay`/`onPlaying` fires BEFORE or in the same render cycle as this effect, `displayReady` gets set to true then immediately reset to false. The video element plays (t=0.7s) but remains invisible (opacity:0, visibility:hidden) under the spinner:

```scss
// Player.scss:40-56
.video-element { opacity: 0; visibility: hidden; }
.video-element.show { opacity: 1; visibility: visible; }
```

Without `displayReady = true`, the `.show` class is never added.

#### Bug C: No `onError` handler on `<video>` element

```jsx
// VideoPlayer.jsx:501-511
<video autoPlay ref={containerRef} src={mediaUrl}
  onCanPlay={...} onPlaying={...}
  // NO onError handler — media errors are silently swallowed
/>
```

If the video encounters a decode error after loading (which could explain the pause at 0.7s), there's no logging and no recovery.

### What I don't know yet

1. **Why readyState=0 on office-tv** — the video never even starts loading, despite the same endpoint working from curl. Could be a Chrome connection pool issue, or the video element's src isn't being set (need to verify).
2. **What pauses the video at 0.7s on Shield** — could be the displayReady race, could be something calling `.pause()`, could be a media error. No `onError` handler means we can't tell.
3. **Whether the March 17 phantom-entry fixes are working** — case 3 shows only ONE overlay instance (good), but cases 1-2 still show two overlay instances (the idle→active transition may still create issues).

---

## Relationship to March 17 Bug

The March 17 bug (`2026-03-17-morning-program-spinner-audio-plays.md`) documented the same audio-plays-video-doesn't pattern, caused by phantom queue entries creating stale Player instances whose resilience timers killed the working player.

Fixes deployed between then and now:
```
04c8c0fa fix(player): cancel stale resilience timers on guid change
fc8ae169 fix(player): guard resilience reload against phantom queue entries
2ea58bfc fix(player): don't arm resilience deadline for phantom entries
0e8bf7bd fix(player): suppress phantom queue-track-changed emissions
213e7a9e fix(screen): eliminate dual-autoplay spinner overlay bug
24685de0 fix(screen): queue autoplay, stale overlays, menu timer, cache-busting reload
```

These fixes address the phantom-entry vector. Today's case 3 (user menu selection, single overlay instance) confirms the phantom suppression works. **But a new/different failure vector exists** in the audio→video transition that these fixes don't address.

---

## Proposed Investigation Steps

1. **Add `onError` handler to `<video>`** — we're flying blind on media errors
2. **Add structured logging to `displayReady` lifecycle** — log when set true, when reset false, and why
3. **Fix AudioPlayer `key={undefined}`** — use `elementKey` (which the controller does return)
4. **Verify video element `src` attribute** — add logging to confirm `mediaUrl` is being set on the DOM element, not just passed as a React prop
5. **Check if `displayReady` reset effect fires after `onCanPlay`** — add timestamps to both paths to determine ordering

---

## Files

| File | Role |
|------|------|
| `frontend/src/modules/Player/renderers/VideoPlayer.jsx:210-213` | `displayReady` reset on mediaUrl change |
| `frontend/src/modules/Player/renderers/VideoPlayer.jsx:501-511` | `<video>` element — no onError, no muted, no preload |
| `frontend/src/modules/Player/renderers/AudioPlayer.jsx:51,254` | Uses removed `mediaInstanceKey` → key={undefined} |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js:793-796` | Stall detection skips paused video |
| `frontend/src/modules/Player/hooks/useCommonMediaController.js:1242` | Stall detection only scheduled from loadedmetadata |
| `frontend/src/modules/Player/components/PlayerOverlayLoading.jsx` | No timeout on spinner |
| `frontend/src/modules/Player/styles/Player.scss:40-56` | Video hidden by default, shown via displayReady |
