# Homeline Videocall Production Testing Audit

**Date:** 2026-02-22
**Context:** Production testing of videocall hardening changes (commits `7b1b28cd`..`ad09a2a8`)
**Environment:** Phone (Android 10, Chrome 145) → livingroom-tv (Shield TV, Fully Kiosk)

---

## Summary

Four production test attempts revealed five distinct issues. Two are code bugs introduced during hardening, two are infrastructure/operational issues, and one is a pre-existing hardware reliability issue. The signaling layer (WebRTC offer/answer) is now working correctly after the hardening changes.

---

## Issue 1: Deploy-Time 502 Gap (Infrastructure)

**Status:** Open — operational concern
**Severity:** High — breaks all in-progress and new calls during deploy

### Evidence

Container restart at `21:49:32.467` (host changed from `7b1b8b31fc97` to `e14774472222`):
```
{"event":"router.backend_loaded","data":{"message":"DDD backend loaded"},"host":"e14774472222"}
{"event":"server.started","data":{"port":3111,"mode":"production"},"host":"e14774472222"}
```

During the ~5s restart window, the openresty reverse proxy returned 502 for all API calls:
```
{"event":"wake-failed","data":{"targetDeviceId":"livingroom-tv",
  "error":"HTTP 502: <html><head><title>502 Bad Gateway</title></head>..."}}
```

All WebSocket connections dropped simultaneously across all devices:
```
{"event":"console.error","data":{"args":["[WebSocketService] Error:",{"isTrusted":true}]}}
```
— from Shield TV, office Firefox, phone Android Chrome, Mac Chrome — all within 3 seconds.

### Root Cause

`deploy.sh` restarts the Docker container, which:
1. Kills the Node.js process (dropping all WS connections)
2. Creates a 3-5s gap where openresty has no upstream → 502
3. Destroys all in-memory state (CallStateService active calls Map)

### Impact

- Users mid-call get disconnected with no feedback
- Users initiating calls get silent failures (wake-failed)
- All devices lose WS connections and must reconnect via exponential backoff

### Recommendations

- Add health check endpoint; openresty should wait for healthy upstream before routing
- Or: rolling restart (start new container, health check, swap traffic, stop old)
- CallApp should show "Server restarting..." when API returns 502

---

## Issue 2: dropIn Retry Storm (Code Bug)

**Status:** Open — code fix needed
**Severity:** High — floods API with requests, confusing UX

### Evidence

Seven `drop-in-start` events in 1.2 seconds from the same phone tab:
```
05:49:31.011 drop-in-start  livingroom-tv
05:49:31.244 drop-in-start  livingroom-tv
05:49:31.486 drop-in-start  livingroom-tv
05:49:31.684 drop-in-start  livingroom-tv
05:49:31.870 drop-in-start  livingroom-tv
05:49:32.075 drop-in-start  livingroom-tv
05:49:32.253 drop-in-start  livingroom-tv
```

Each produced a `wake-failed` (502), which returned state to idle, which allowed immediate re-invocation.

### Root Cause

`CallApp.jsx` `dropIn()` function:
```javascript
const dropIn = useCallback(async (targetDeviceId) => {
    if (waking || status !== 'idle') return;  // guard
    // ...
    try {
      await DaylightAPI(`/api/v1/device/${targetDeviceId}/load?...`);
    } catch (err) {
      setWaking(false);                    // ← returns to idle
      connectedDeviceRef.current = null;
      setActiveDeviceId(null);
      return;                              // ← user can immediately tap again
    }
```

The guard `if (waking || status !== 'idle') return` prevents concurrent calls, but `wake-failed` clears `waking` synchronously, making the button immediately available. With the user tapping the button rapidly (or holding it down), each tap fires a new dropIn within ~200ms.

Additionally, each `wake-failed` triggers `setActiveDeviceId(null)`, which triggers `useCallOwnership`'s effect to close and reopen the BroadcastChannel, generating a `call-ownership-claimed` event for each attempt.

### Recommended Fix

```javascript
// In dropIn, after catch:
setWaking(false);
setWakeError('Could not reach server — try again');
// Don't return to idle immediately; show error state with manual retry
```

Or add a cooldown:
```javascript
const [cooldown, setCooldown] = useState(false);
// In catch:
setCooldown(true);
setTimeout(() => setCooldown(false), 3000);
// In guard:
if (waking || status !== 'idle' || cooldown) return;
```

---

## Issue 3: Camera Preview Not Showing After UI Refactor (Code Bug)

**Status:** Open — needs investigation
**Severity:** Medium — user sees black screen instead of camera

### Evidence

User reported "no camera" after deploy of commit `ad09a2a8` (UI refactor to show camera from start). No `webcam.access-error-final` logs appeared, suggesting the stream was acquired but not displayed.

### Analysis

The UI refactor moved the local video element from conditional rendering (only in connected view) to always-rendered. The `useWebcamStream` hook sets `srcObject` during `startStream()`:

```javascript
// useWebcamStream.js:45-49
if (videoRef.current) {
  videoRef.current.srcObject = new MediaStream(localStream.getVideoTracks());
}
```

With the always-mounted video element, `videoRef.current` should exist when `startStream()` runs. However:

1. **Race with React mounting:** If `startStream()` completes before React commits the video element to the DOM (first render), `videoRef.current` may still be null
2. **The backup effect** was changed from `[stream, status]` to `[stream]` only — but since the video is always mounted, this should still fire correctly when `stream` first becomes non-null
3. **CSS issue possible:** The `.call-app__local--full` div uses `flex: 1` inside a flex column, with the video using `height: 100%`. If the parent's height isn't resolving, the video may render at 0 height

### Possible CSS Fix

```scss
&__local {
  &--full {
    flex: 1;
    min-height: 0;
    position: relative;  // establish containing block

    .call-app__video {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
  }
}
```

### Investigation Needed

- Check browser DevTools on phone: is the video element present with correct srcObject?
- Is the video element's computed height > 0?
- Is there a stale cache issue (old JS bundle served after deploy)?

---

## Issue 4: TV Wake Gives False Positive (Code + Hardware)

**Status:** Open — false positive in backend `/load` endpoint
**Severity:** High — system reports success but TV display stays dark

### Evidence

Every test attempt showed the backend reporting full success:
```
{"event":"device.ha.powerOn","data":{"displayId":"tv","script":"script.living_room_tv_on"}}
ha.callService.success { domain: 'script', service: 'turn_on' }
{"event":"fullykiosk.prepareForContent.foregroundConfirmed","data":{"attempt":1,"elapsedMs":2616}}
{"event":"fullykiosk.load.success","data":{"loadTimeMs":687}}
{"event":"device.router.load.complete","data":{"deviceId":"livingroom-tv","ok":true,"totalElapsedMs":3312}}
```

Phone received `wake-success` and proceeded to signaling. Call connected successfully.

**But the physical TV display never turned on.** The user saw nothing on the TV screen.

### Root Cause: Three Layers of False Positives

1. **HA `callService.success`** — Means Home Assistant accepted the script command, NOT that the TV responded to CEC. HA has no feedback loop for CEC power state.

2. **`fullykiosk.prepareForContent.foregroundConfirmed`** — Means the Shield (Android TV box) brought Fully Kiosk to the foreground. The Shield runs independently of the physical display. It can run apps while the TV screen is off.

3. **`fullykiosk.load.success`** — Means the Shield's WebView loaded the URL. Again, Shield operates regardless of display state.

The backend's `/load` endpoint chains these three operations and reports `{"ok": true}` when all three "succeed." But none of them verify the physical display is on. The backend is giving a false positive.

### The CEC Timing Problem

In test #3, the TV was powered off 6 seconds before power-on:
```
21:38:32.345 device.router.powerOff  livingroom-tv
21:38:38.949 device.ha.powerOn       livingroom-tv
```

CEC power-on commands can be silently dropped if the TV is still shutting down. The Shield doesn't know or care — it keeps running.

### Recommendations

**Short-term:**
- Query the actual TV power state from HA after sending power-on (e.g., `media_player.living_room_tv` state)
- Retry CEC power-on if state still shows "off" after 3-5 seconds
- Return actual display state in the `/load` response so the phone knows if the screen is on

**Medium-term:**
- Add a display state check endpoint: `GET /api/v1/device/:id/status` returning `{ displayOn: boolean }`
- CallApp can poll this and show "TV display not responding" instead of proceeding to signaling

**Long-term:**
- Consider HDMI-CEC alternatives (IP control, IR blaster) for more reliable display control
- Add a minimum delay between power-off and power-on (e.g., 10s cooldown)

---

## Issue 5: Spurious Power-Off During Active Call — FIXED

**Status:** Fixed (commit `8b4e6ec7`)

### Evidence (Pre-Fix)

In test attempt #2 (21:21), the TV was powered off 152ms after the call connected:
```
21:21:19.899 call-state.started     livingroom-tv
21:21:20.051 device.router.powerOff.forced  livingroom-tv  (152ms later!)
21:21:20.069 device.router.powerOff         livingroom-tv
21:21:20.355 device.router.powerOff         livingroom-tv
```

Three separate power-off commands within 300ms.

### Root Cause

The `beforeunload` cleanup effect in `CallApp.jsx` depended on `[endCall, isOwner]`. When `endCall`'s identity changed mid-call (due to `reset` depending on `stream`, which changes), React re-ran the effect. The effect destructor fired first, which checked `connectedDeviceRef.current` (set during `dropIn`), found it truthy, and sent the power-off API call.

```javascript
// BEFORE fix — effect re-ran whenever endCall identity changed
useEffect(() => {
    // ...
    return () => {
      const devId = connectedDeviceRef.current;
      if (devId && isOwner()) {
        DaylightAPI(`/api/v1/device/${devId}/off?force=true`);  // ← spurious!
      }
    };
  }, [endCall, isOwner]);  // ← endCall changes mid-call
```

### Fix Applied

```javascript
// AFTER fix — ref breaks the dependency, effect only runs on mount/unmount
const endCallRef = useRef(endCall);
endCallRef.current = endCall;

useEffect(() => {
    const handleBeforeUnload = () => endCallRef.current();
    // ...
    return () => { /* cleanup only on actual unmount */ };
  }, []);  // ← empty deps = mount/unmount only
```

### Verification

Test attempt #3 (21:38) showed **no spurious power-off** after call-connected. The fix works.

---

## Test Timeline

### Attempt 1 (21:18) — Pre-deploy baseline
- WS errors across all devices
- Camera failed ("Could not start video source", fallback succeeded)
- No signaling flow occurred

### Attempt 2 (21:21) — After hardening deploy (commits 7b1b28cd..bc20ff99)
- Signaling worked: offer → answer → call-connected
- **TV powered off 152ms after connection** (Issue 5, now fixed)
- Camera fallback worked but local preview not shown (video element not mounted in lobby)

### Attempt 3 (21:38) — After cleanup-effect fix (8b4e6ec7) + local-stream fix (a334079b)
- Signaling worked perfectly, no spurious power-off
- **TV physical display did not turn on** (Issue 4)
- Phone camera confirmed working ("phone camera works now")

### Attempt 4 (21:49) — After UI refactor (ad09a2a8)
- Deploy restarted container → **502 Bad Gateway for ~5s** (Issue 1)
- **dropIn fired 7 times in 1.2s** during 502 window (Issue 2)
- After 502 cleared: signaling succeeded, call-connected
- User reported "no camera" (Issue 3)
- TV display status unclear

---

## Signaling Health

The WebRTC signaling layer is now healthy. All post-fix tests show correct flow:
```
Phone: drop-in-start → wake-success → connect-waiting-for-tv → ready-sent
TV:    frontend-start → videocall mounted → heartbeat-start
Phone: tv-ready → offer-sent
TV:    offer-received
Phone: answer-received → call-connected
```

Typical end-to-end latency: ~5s (wake) + ~1s (signaling) = ~6s total.

---

## Open Items Priority

| # | Issue | Type | Effort | Impact |
|---|-------|------|--------|--------|
| 4 | TV wake false positive — no display verification | Code + HW | Medium | High — silent failure |
| 2 | dropIn retry storm on wake failure | Code bug | Small | High — API flood |
| 3 | Camera not showing in preview mode | Code bug | Small | High — broken UX |
| 1 | Deploy-time 502 gap | Infrastructure | Medium | High — breaks calls |
