# 2026-03-08 Audio Autoplay Failure Audit

## Goal

Queue `plex:642120` (539 hymn tracks) on the living room Shield TV via `GET /api/v1/device/livingroom-tv/load?queue=plex:642120&shader=dark&shuffle=1` and confirm audio plays.

## What Happened

Audio never played. Multiple hours of debugging produced a code fix that was deployed but never confirmed working on the actual device.

## Root Cause Analysis

### 1. `<audio autoPlay>` Silently Fails

**File:** `frontend/src/modules/Player/hooks/useCommonMediaController.js`

The `loadedmetadata` handler sets `mediaEl.autoplay = true` (line ~1164) but never calls `play()` explicitly. The `<audio autoPlay>` attribute on the element (in `AudioPlayer.jsx:257`) is the sole mechanism for starting playback.

**Playwright confirmed:** The audio element loads correctly (`readyState: 4`, `duration` set), queue resolves (539 tracks), but `paused: true`. Manual `audio.play()` succeeds immediately.

**Diagnosis:** On some WebViews and headless browsers, the `autoplay` attribute/property silently fails without throwing `NotAllowedError`. FKB has `autoplayAudio: true` and `autoplayVideos: true` in its settings, which should disable the restriction, but the behavior was never confirmed on the actual device because of infrastructure failures (see below).

**Fix deployed:** Added explicit `play()` call at the end of `loadedmetadata` handler:
```javascript
if (!snapshot?.wasPaused && mediaEl.paused) {
  mediaEl.play().catch((err) => {
    if (err.name === 'NotAllowedError') {
      mcLog().warn('playback.autoplay-blocked', { mediaKey: assetId, error: err.message });
    }
  });
}
```

**Status:** Deployed to Docker. NOT confirmed working on the Shield TV.

### 2. Infrastructure Failures Blocked Verification

#### FKB REST API Unreliability
- FKB's REST API (`10.0.0.11:2323`) is extremely slow after cold boot (30s+ response times, frequent socket hang ups)
- The `injectJavascript` command timed out repeatedly, preventing remote diagnostic injection
- Node `fetch` default timeouts are too short; need 30s+ for FKB

#### WiFi Kill (Self-Inflicted)
- Attempted `adb shell svc wifi disable && sleep 3 && svc wifi enable` to reset Shield networking
- The `disable` command killed the WiFi (and ADB-over-WiFi connection) before `enable` could execute
- Shield went completely offline; required physical smart plug power cycle via HA
- **Lesson:** Never disable WiFi via ADB-over-WiFi. There is no recovery path without physical access.

#### Shield Cold Boot Delays
- After smart plug power cycle, Shield takes ~90s to boot
- ADB shows "device still authorizing" for 30-60s after boot
- FKB REST API is unreachable for 2-3 minutes after boot
- Multiple impatient retry attempts compounded the problem

### 3. No Frontend Logs from Shield TV

Zero frontend WebSocket logs reached the backend from the Shield TV throughout the entire session. Possible causes:
- Old cached JS bundle (pre-fix) — FKB cache wasn't cleared before the WiFi kill
- WebSocket connection to `wss://daylightlocal.kckern.net/ws` failing
- DNS resolution issues (`daylightlocal.kckern.net` resolves through CNAME chain to `10.0.0.10`, which the Shield couldn't ping even before the WiFi incident)

## Unresolved Questions

1. **Does the explicit `play()` fix work on FKB's WebView?** — The Playwright test shows `NotAllowedError` in headless Chromium, but FKB's `autoplayAudio: true` setting should bypass this. Never confirmed.
2. **Why couldn't the Shield ping `10.0.0.10` even before the WiFi kill?** — 100% packet loss on `ping 10.0.0.10` from the Shield was observed early in the session. This suggests a pre-existing networking issue.
3. **Is the new JS bundle being served to the Shield?** — The old build was `index-Bni8uxA1.js`, new build is `index-Cpiir1uk.js`. After the FKB force-stop and power cycle, the Shield should have the new bundle, but this was never confirmed.

## What Should Have Happened

1. Research the autoplay behavior on FKB's WebView before writing code
2. Confirm FKB's `autoplayAudio` setting actually works by testing via `injectJavascript` BEFORE deploying a code fix
3. Never touch WiFi via ADB-over-WiFi
4. Use the smart plug power cycle from the start instead of ADB force-stop
5. Build in generous timeouts (30s+) for all FKB REST operations
6. Confirm the JS bundle hash changed on the device before testing playback

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/modules/Player/hooks/useCommonMediaController.js` | Added explicit `play()` after `loadedmetadata` handler |

## Next Steps

1. Confirm Shield is online and FKB is serving the new bundle
2. Fire `GET /api/v1/device/livingroom-tv/load?queue=plex:642120&shader=dark&shuffle=1`
3. Check frontend logs for `playback.autoplay-blocked` or `playback.start-time-applied` events from the Shield's user agent
4. If `play()` throws `NotAllowedError`, investigate FKB WebView settings or use FKB's `injectJavascript` to simulate a tap
5. Investigate the pre-existing Shield-to-server network issue (ping failure)
